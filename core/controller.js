'use strict';

// Orchestrates host project state -> association -> Notion content.
// Host-agnostic: the watcher (Resolve polling / Premiere events) and the
// storage backends are injected by each host adapter.
// Emits:
//   'state'   small UI state object (safe to send to the UI layer)
//   'content' the page content being displayed ({ page, blocks, truncated, ... })

const { Emitter } = require('./emitter');
const { loadPageContent } = require('./notion/loader');
const { searchPages, retrievePage, parentTitle } = require('./notion/pages');
const { NotionError, toUserError } = require('./notion/errors');
const { normalizeBlock } = require('./notion/blocks');
const edit = require('./notion/edit');
const C = require('./constants');

function publicPage(p) {
    return { id: p.id, source: p.source || 'notion', title: p.title, url: p.url, icon: p.icon || null, account: p.account || null };
}

// UI view of an association: every tab, plus the active page's fields at top level.
function publicAssociation(a, matchedBy) {
    if (!a) return null;
    const pages = (a.pages || []).map(publicPage);
    const active = pages.find((p) => p.id === a.activePage) || pages[0] || {};
    return {
        key: a.key,
        pages,
        activeId: active.id || null,
        pageId: active.id || null,
        source: active.source || 'notion',
        account: active.account || null,
        title: active.title,
        url: active.url,
        icon: active.icon || null,
        matchedBy: matchedBy || null,
    };
}

class Controller extends Emitter {
    /**
     * @param {{ watcher, associations, secrets, cache, client, log, hostInfo: { id: string, name: string, identification: { uid: string, fallback: string } } }} deps
     */
    constructor({ watcher, associations, secrets, cache, client, log, hostInfo }) {
        super();
        this.watcher = watcher;
        this.associations = associations;
        this.secrets = secrets;
        this.cache = cache;
        this.client = client;
        this.log = log;

        this.currentKey = undefined;
        this.identity = null;
        this.loadSeq = 0;
        this.abort = null;
        this.lastCheck = 0;
        this.lastEditedTime = null;
        this.parentMemo = new Map();
        this.editSeq = 0;
        this.pendingEdits = new Set();

        this.state = {
            host: { ...hostInfo, status: 'connecting', project: null, version: null, uidSupported: null },
            notion: { status: secrets.hasToken() ? 'unchecked' : 'unconfigured', user: null },
            association: null,
            suggestion: null,
            page: { status: 'none', pageId: null, fromCache: false, savedAt: null, refreshing: false, error: null, truncated: false },
            associationCount: associations.count(),
        };
        this.content = null;

        watcher.on('change', (ws) => this._onHostState(ws));
    }

    // ---------- state plumbing ----------

    _set(patch) {
        this.state = { ...this.state, ...patch, associationCount: this.associations.count() };
        this.emit('state', this.state);
    }

    _setPage(patch) {
        this._set({ page: { ...this.state.page, ...patch } });
    }

    _setContent(content) {
        this.content = content;
        this.emit('content', content);
    }

    getSnapshot() {
        return { state: this.state, content: this.content };
    }

    // ---------- editing application ----------

    _onHostState(ws) {
        const host = { ...this.state.host, status: ws.status, project: ws.project, version: ws.version || this.state.host.version, uidSupported: ws.uidSupported };

        // Transient unavailability: keep showing the last project and its page.
        if (ws.status !== 'ok' && ws.status !== 'no_project') {
            this._set({ host: { ...host, project: this.state.host.project } });
            return;
        }

        const key = ws.project ? ws.project.key : null;
        this._set({ host });
        if (key === this.currentKey) return;

        this.log.info(`Active project: ${ws.project ? `"${ws.project.name}" [${ws.project.strategy}]` : 'none'}`);
        this.currentKey = key;
        this.identity = ws.project;
        this._applyAssociation();
    }

    _applyAssociation() {
        this._cancelLoad();
        this._setContent(null);
        this.lastEditedTime = null;

        if (!this.identity) {
            this._set({ association: null, suggestion: null });
            this._setPage({ status: 'none', pageId: null, error: null, fromCache: false, refreshing: false });
            return;
        }

        const { match, matchedBy, suggestion } = this.associations.find(this.identity);
        const sugg = suggestion ? {
            key: suggestion.key,
            projectName: suggestion.projectName,
            location: suggestion.location ? suggestion.location.label : null,
            pageTitle: (suggestion.pages || []).map((p) => p.title).join(', '),
            pageCount: (suggestion.pages || []).length,
        } : null;
        this._set({ association: publicAssociation(match, matchedBy), suggestion: sugg });

        if (match) {
            this._loadPage(this.state.association.pageId);
        } else {
            this._setPage({ status: 'none', pageId: null, error: null, fromCache: false, refreshing: false });
        }
    }

    // ---------- Notion page loading ----------

    _cancelLoad() {
        this.loadSeq += 1;
        if (this.abort) this.abort.abort();
        this.abort = null;
    }

    async _loadPage(pageId, { preferNetwork = false } = {}) {
        this._cancelLoad();
        const loadId = this.loadSeq;
        const ac = new AbortController();
        this.abort = ac;

        // preferNetwork (Refresh button): keep what is displayed, fetch fresh data behind it.
        const cached = preferNetwork ? null : await this.cache.get(pageId);
        if (loadId !== this.loadSeq) return;
        if (cached) {
            this._setContent({ page: cached.page, blocks: cached.blocks, truncated: cached.truncated, partial: false });
        }
        const prev = this.state.page;
        const keep = !cached && !!this.content;
        this._setPage({
            status: this.content ? 'ready' : 'loading',
            pageId,
            fromCache: cached ? true : (keep ? prev.fromCache : false),
            savedAt: cached ? cached.savedAt : (keep ? prev.savedAt : null),
            refreshing: true,
            error: null,
            truncated: cached ? !!cached.truncated : (keep ? prev.truncated : false),
        });

        if (!this.secrets.getToken()) {
            this._setPage({ status: this.content ? 'ready' : 'error', refreshing: false, error: toUserError(new NotionError('no_token')) });
            return;
        }

        const editSeqAtStart = this.editSeq;
        try {
            const hadContent = !!this.content;
            const result = await loadPageContent(this.client, pageId, {
                signal: ac.signal,
                maxBlocks: C.MAX_BLOCKS_PER_PAGE,
                maxDepth: C.MAX_BLOCK_DEPTH,
                onProgress: (partial) => {
                    // Progressive display only when nothing is shown yet (avoids flicker over the cache).
                    if (loadId !== this.loadSeq || hadContent) return;
                    this._setContent({ ...partial, partial: true });
                    if (this.state.page.status === 'loading') this._setPage({ status: 'ready' });
                },
            });
            if (loadId !== this.loadSeq) return;

            this.cache.put(pageId, result);
            this._setContent({ ...result, partial: false });
            this.lastCheck = Date.now();
            this.lastEditedTime = result.page.lastEditedTime;
            this.associations.refreshPageInfo(pageId, result.page);
            this._syncAssociation();
            if (this.state.notion.status !== 'ok') this._set({ notion: { ...this.state.notion, status: 'ok' } });
            this._setPage({ status: 'ready', fromCache: false, savedAt: new Date().toISOString(), refreshing: false, error: null, truncated: result.truncated });
            // The page was edited from the panel while it was loading: the loaded tree may predate the edit.
            if (this.editSeq !== editSeqAtStart) this._loadPage(pageId, { preferNetwork: true });
        } catch (e) {
            if (loadId !== this.loadSeq || (e && e.code === 'cancelled')) return;
            this.log.warn(`Loading page ${pageId} failed`, e);
            this._noteNotionError(e);
            this._setPage({ status: this.content ? 'ready' : 'error', refreshing: false, error: toUserError(e) });
        }
    }

    _noteNotionError(e) {
        if (!e) return;
        if (e.code === 'unauthorized') this._set({ notion: { ...this.state.notion, status: 'invalid' } });
        else if (e.code === 'network' || e.code === 'timeout') this._set({ notion: { ...this.state.notion, status: 'offline' } });
    }

    // ---------- public actions (see operations.js) ----------

    async refresh() {
        await this.watcher.pollNow();
        if (this.state.notion.status !== 'ok' && this.secrets.hasToken()) this.checkNotion().catch(() => {});
        const a = this.state.association;
        if (a) await this._loadPage(a.pageId, { preferNetwork: true });
    }

    async onWindowFocus() {
        const a = this.state.association;
        const p = this.state.page;
        if (!a || p.refreshing || p.status !== 'ready' || !this.secrets.hasToken()) return;
        if (Date.now() - this.lastCheck < C.FOCUS_RECHECK_MS) return;
        this.lastCheck = Date.now();
        try {
            const meta = await retrievePage(this.client, a.pageId);
            if (this.state.association !== a) return;
            if (this.state.page.fromCache || meta.lastEditedTime !== this.lastEditedTime) {
                this.log.info('Page changed in Notion, reloading');
                this._loadPage(a.pageId, { preferNetwork: true });
            }
        } catch (e) {
            this._noteNotionError(e);
        }
    }

    async checkNotion(token) {
        const res = await this.testToken(token);
        this._set({ notion: { status: 'ok', user: res } });
        return res;
    }

    // Validates a token by calling GET /v1/users/me, falling back to a 1-result search.
    async testToken(token) {
        try {
            const me = await this.client.request('GET', '/users/me', { token });
            const name = me && (me.name || (me.bot && me.bot.workspace_name)) || null;
            const workspace = me && me.bot && me.bot.workspace_name ? me.bot.workspace_name : null;
            return { name, workspace };
        } catch (e) {
            if (e.code === 'restricted' || e.code === 'validation' || e.code === 'not_found') {
                await this.client.request('POST', '/search', { token, body: { page_size: 1, filter: { property: 'object', value: 'page' } } });
                return { name: null, workspace: null };
            }
            // A candidate token (not saved yet) must not change the stored token's status.
            if (!token) this._noteNotionError(e);
            throw e;
        }
    }

    async saveToken(token) {
        let user;
        try {
            user = await this.testToken(token);
        } catch (e) {
            if (e.code === 'unauthorized') throw new NotionError('token_rejected', { status: e.status });
            throw e;
        }
        await this.secrets.setToken(token);
        this._set({ notion: { status: 'ok', user } });
        this.log.info('Notion token saved');
        const a = this.state.association;
        if (a) this._loadPage(a.pageId, { preferNetwork: true });
        return user;
    }

    async clearToken() {
        await this.secrets.clearToken();
        this._set({ notion: { status: 'unconfigured', user: null } });
        this.log.info('Notion token removed');
    }

    async search(query, cursor) {
        return searchPages(this.client, { query, cursor });
    }

    async parentTitles(refs) {
        if (this.parentMemo.size > 1000) this.parentMemo.clear();
        const out = {};
        await Promise.all(refs.map(async (ref) => {
            out[`${ref.type}:${ref.id}`] = await parentTitle(this.client, ref, this.parentMemo);
        }));
        return out;
    }

    // Re-reads the current association from the store into the UI state.
    _syncAssociation() {
        const a = this.state.association;
        if (!a) return;
        const record = this.associations.get(a.key);
        this._set({ association: record ? publicAssociation(record, a.matchedBy) : null });
    }

    _requireAssociation() {
        const a = this.state.association;
        if (!a) throw Object.assign(new Error('no association'), { code: 'not_found' });
        return a;
    }

    _showActive() {
        this._syncAssociation();
        const a = this.state.association;
        if (!a) return this._applyAssociation();
        if (this.content && this.content.page && this.content.page.id === a.pageId) return undefined;
        this._setContent(null);
        this.lastEditedTime = null;
        return this._loadPage(a.pageId);
    }

    /** No association yet: creates it. Otherwise: replaces the page of the active tab. */
    async associate(pageId) {
        if (!this.identity) throw Object.assign(new Error('no project'), { code: 'no_project' });
        const page = await retrievePage(this.client, pageId);
        const a = this.state.association;
        if (a && this.associations.get(a.key)) {
            this.associations.replacePage(a.key, page);
            this.log.info(`"${this.identity.name}": tab replaced by page ${page.id}`);
        } else {
            const record = this.associations.set(this.identity, page);
            this.log.info(`Associated "${this.identity.name}" -> page ${page.id}`);
            this._set({ association: publicAssociation(record, 'new'), suggestion: null });
        }
        this._showActive();
        return this.state.association;
    }

    /** Adds a page as a new tab of the current project and shows it. */
    async addPage(pageId) {
        const a = this._requireAssociation();
        const record = this.associations.get(a.key);
        if (record && record.pages.length >= C.MAX_PAGES_PER_PROJECT) throw Object.assign(new Error('too many pages'), { code: 'too_many_pages' });
        const page = await retrievePage(this.client, pageId);
        this.associations.addPage(a.key, page);
        this.log.info(`"${a.key}": page ${page.id} added as a tab`);
        this._showActive();
        return this.state.association;
    }

    removePage(pageId) {
        const a = this._requireAssociation();
        this.associations.removePage(a.key, pageId);
        this._showActive();
        return this.state.association;
    }

    selectPage(pageId) {
        const a = this._requireAssociation();
        if (!a.pages.some((p) => p.id === pageId)) throw Object.assign(new Error('unknown tab'), { code: 'not_found' });
        this.associations.setActivePage(a.key, pageId);
        this._showActive();
        return this.state.association;
    }

    /** Associations view: adds a page to any association (current project or not). */
    async associateForKey(key, pageId) {
        if (this.state.association && key === this.state.association.key) return this.addPage(pageId);
        const page = await retrievePage(this.client, pageId);
        const record = this.associations.addPage(key, page);
        this._set({});
        return publicAssociation(record);
    }

    removePageForKey(key, pageId) {
        if (this.state.association && key === this.state.association.key) return this.removePage(pageId);
        this.associations.removePage(key, pageId);
        this._set({});
        return true;
    }

    adoptSuggestion() {
        const s = this.state.suggestion;
        if (!s || !this.identity) return null;
        const src = this.associations.get(s.key);
        if (!src) return null;
        const [first, ...rest] = src.pages;
        const record = this.associations.set(this.identity, first);
        for (const p of rest) this.associations.addPage(record.key, p);
        this.associations.setActivePage(record.key, src.activePage);
        this._set({ association: publicAssociation(this.associations.get(record.key), 'new'), suggestion: null });
        this._loadPage(this.state.association.pageId);
        return this.state.association;
    }

    dismissSuggestion() {
        this._set({ suggestion: null });
    }

    dissociate() {
        if (!this.currentKey) return false;
        const a = this.state.association;
        const ok = a ? this.associations.remove(a.key) : false;
        this._applyAssociation();
        return ok;
    }

    removeAssociation(key) {
        const ok = this.associations.remove(key);
        if (this.state.association && this.state.association.key === key) this._applyAssociation();
        else this._set({});
        return ok;
    }

    listAssociations() {
        return this.associations.list().map((a) => ({
            key: a.key,
            projectName: a.projectName,
            location: a.location ? a.location.label : null,
            strategy: a.projectUid ? 'uid' : 'fallback',
            pages: (a.pages || []).map(publicPage),
            isCurrent: a.key === (this.state.association && this.state.association.key),
            updatedAt: a.updatedAt,
        }));
    }

    // ---------- editing (write-back to Notion) ----------

    _editTarget(blockId) {
        const found = this.content && this.content.page ? edit.findNode(this.content.blocks, blockId) : null;
        if (!found) throw new NotionError('not_found');
        if (this.pendingEdits.has(blockId)) throw new NotionError('edit_busy');
        return found;
    }

    // Re-emits the (mutated in place) tree under a new object so the UI re-renders, and refreshes the cache.
    _contentChanged({ persist = false } = {}) {
        const c = this.content;
        this._setContent({ ...c });
        if (persist && !c.partial) this.cache.put(c.page.id, { page: c.page, blocks: c.blocks, truncated: c.truncated });
    }

    _writeError(e) {
        this._noteNotionError(e);
        if (e && e.code === 'restricted') return new NotionError('write_denied');
        if (e && e.code === 'validation') return new NotionError('write_rejected');
        return e;
    }

    // Optimistic edit: apply locally, send, then keep Notion's version (or roll back on failure).
    async _write(blockId, { apply, rollback, send }) {
        this.pendingEdits.add(blockId);
        this.editSeq += 1;
        apply();
        this._contentChanged();
        try {
            const res = await send();
            this.lastCheck = Date.now();
            return res;
        } catch (e) {
            this.log.warn(`Editing block ${blockId} failed`, e);
            if (this.content) { rollback(); }
            throw this._writeError(e);
        } finally {
            this.pendingEdits.delete(blockId);
            if (this.content) this._contentChanged({ persist: true });
        }
    }

    _applyServerBlock(node, raw) {
        if (!raw || raw.object !== 'block') return;
        const fresh = normalizeBlock(raw);
        if (fresh.type !== node.type) return;
        const { children, hasChildren } = node;
        for (const k of Object.keys(node)) delete node[k];
        Object.assign(node, fresh, { children, hasChildren });
    }

    async setTodo(blockId, checked) {
        const { node } = this._editTarget(blockId);
        if (node.type !== 'to_do') throw new NotionError('not_editable');
        const before = node.checked;
        await this._write(blockId, {
            apply: () => { node.checked = checked; },
            rollback: () => { node.checked = before; },
            send: async () => this._applyServerBlock(node,
                await this.client.request('PATCH', `/blocks/${blockId}`, { body: edit.todoPatch(checked) })),
        });
        return { checked: node.checked };
    }

    async editText(blockId, text) {
        const { node } = this._editTarget(blockId);
        if (!edit.canEditText(node)) throw new NotionError('not_editable');
        if (edit.plain(node.rich) === text) return { unchanged: true };
        const before = node.rich;
        const { rich, body } = edit.textPatch(node, text);
        await this._write(blockId, {
            apply: () => { node.rich = rich; },
            rollback: () => { node.rich = before; },
            send: async () => this._applyServerBlock(node,
                await this.client.request('PATCH', `/blocks/${blockId}`, { body })),
        });
        return { unchanged: false };
    }

    async deleteBlock(blockId) {
        const { node, list, index } = this._editTarget(blockId);
        if (!edit.canDelete(node)) throw new NotionError('not_editable');
        await this._write(blockId, {
            apply: () => { list.splice(index, 1); },
            rollback: () => { if (list[index] !== node) list.splice(Math.min(index, list.length), 0, node); },
            // DELETE moves the block to Notion's trash (it can be restored from Notion).
            send: () => this.client.request('DELETE', `/blocks/${blockId}`),
        });
        return true;
    }

    async clearCache() {
        await this.cache.clear();
        if (this.state.page.fromCache) this._setPage({ fromCache: false });
    }
}

module.exports = { Controller };
