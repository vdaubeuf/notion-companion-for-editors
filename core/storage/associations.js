'use strict';

// Editing project  <->  pages associations (1 to MAX_PAGES pages per project, shown as tabs).
//
// File format (schemaVersion 3):
// {
//   "schemaVersion": 3,
//   "associations": {
//     "<identity key>": {
//       "key": "uid:…" | "name:…" (Resolve fallback) | "path:…" (Premiere fallback),
//       "host": "resolve" | "premiere",
//       "projectUid": "…" | null,
//       "projectName": "Mon documentaire",
//       "location": { "key": "Disk|Local Database" | "/…/Mon documentaire.prproj", "label": "…" },
//       "pages": [                                   1..MAX_PAGES, in tab order
//         { "source": "notion", "id": "…", "title": "…", "url": "…", "icon": { … } | null, "account": "<account id>" | null }
//       ],
//       "activePage": "<id of the tab shown>",
//       "notionPageId", "notionPageTitle", "notionPageUrl", "notionPageIcon":
//           copy of the first Notion page, kept so that an older plugin version can still read the file,
//       "createdAt": "ISO", "updatedAt": "ISO"
//     }
//   }
// }
//
// Matching rules (see find()):
//  1. same uid                                             -> match (renames are followed)
//  2. exact location (Premiere: same .prproj path)         -> match, re-keyed to the new uid
//  3. one side without uid, same name, compatible location -> match (re-keyed to the uid when known)
//  4. same name but different uid / other file             -> *suggestion* only (the user confirms),
//     because two distinct projects can share a name.

const { JsonStore } = require('./jsonStore');
const { compatibleLocation } = require('../identity');

const VERSION = 3;
const MAX_PAGES = require('../constants').MAX_PAGES_PER_PROJECT;

/** Page reference as stored: only known fields, Notion by default. */
function pageRef(page, account) {
    return {
        source: page.source || 'notion',
        id: page.id,
        title: page.title || '',
        url: page.url || null,
        icon: page.icon || null,
        account: account !== undefined ? account : (page.account || null),
    };
}

// Keeps the v2 fields (first Notion page) in sync with `pages`.
function mirrorLegacy(record) {
    const first = (record.pages || []).find((p) => p.source === 'notion') || null;
    record.notionPageId = first ? first.id : null;
    record.notionPageTitle = first ? first.title : null;
    record.notionPageUrl = first ? first.url : null;
    record.notionPageIcon = first ? first.icon : null;
    if (!record.pages.some((p) => p.id === record.activePage)) record.activePage = record.pages[0] ? record.pages[0].id : null;
    return record;
}

const migrations = {
    // v0 -> v1: early flat map { key: record } without wrapper.
    1: (data) => {
        if (data.associations) return data;
        const associations = {};
        for (const [k, v] of Object.entries(data)) {
            if (v && typeof v === 'object' && v.notionPageId) associations[k] = { key: k, ...v };
        }
        return { associations };
    },
    // v1 -> v2: Resolve-only fields -> host-agnostic fields.
    2: (data) => {
        const associations = {};
        for (const [k, a] of Object.entries(data.associations || {})) {
            if (!a || typeof a !== 'object') continue;
            const db = a.resolveDatabase || {};
            associations[k] = {
                key: a.key || k,
                host: a.host || 'resolve',
                projectUid: a.projectUid ?? a.resolveProjectUid ?? null,
                projectName: a.projectName ?? a.resolveProjectName ?? '',
                location: a.location || {
                    key: db.name ? `${db.type || ''}|${db.name}` : '',
                    label: [db.name, a.resolveFolder].filter(Boolean).join(' · ') || null,
                },
                notionPageId: a.notionPageId,
                notionPageTitle: a.notionPageTitle,
                notionPageUrl: a.notionPageUrl,
                notionPageIcon: a.notionPageIcon || null,
                createdAt: a.createdAt || new Date().toISOString(),
                updatedAt: a.updatedAt || new Date().toISOString(),
            };
        }
        return { associations };
    },
    // v2 -> v3: one page -> list of pages (tabs).
    3: (data) => {
        const associations = {};
        for (const [k, a] of Object.entries(data.associations || {})) {
            if (!a || typeof a !== 'object') continue;
            const pages = Array.isArray(a.pages) ? a.pages.filter((p) => p && p.id).map((p) => pageRef(p))
                : a.notionPageId ? [pageRef({ id: a.notionPageId, title: a.notionPageTitle, url: a.notionPageUrl, icon: a.notionPageIcon })] : [];
            if (!pages.length) continue;
            associations[k] = mirrorLegacy({ ...a, pages, activePage: a.activePage || pages[0].id });
        }
        return { associations };
    },
};

class AssociationStore {
    constructor(backend, log) {
        this.store = new JsonStore(backend, 'associations.json', {
            version: VERSION,
            defaults: () => ({ associations: {} }),
            migrations,
            log,
        });
        this.log = log;
    }

    load() {
        return this.store.load();
    }

    flush() {
        return this.store.flush();
    }

    _all() {
        const data = this.store.get();
        if (!data.associations || typeof data.associations !== 'object') data.associations = {};
        return data.associations;
    }

    list() {
        return Object.values(this._all()).sort((a, b) => String(a.projectName).localeCompare(String(b.projectName)));
    }

    count() {
        return Object.keys(this._all()).length;
    }

    get(key) {
        return this._all()[key] || null;
    }

    /**
     * @returns {{ match: object|null, matchedBy: string|null, suggestion: object|null }}
     */
    find(identity) {
        const all = this._all();

        if (identity.uid && all[`uid:${identity.uid}`]) {
            const direct = all[`uid:${identity.uid}`];
            this._refreshProjectInfo(direct, identity);
            return { match: direct, matchedBy: 'uid', suggestion: null };
        }
        if (!identity.uid && all[identity.key]) {
            return { match: all[identity.key], matchedBy: 'fallback', suggestion: null };
        }

        const sameHost = Object.values(all).filter((a) => (a.host || 'resolve') === identity.host);

        // Rule 2: exact location (same project file) -> safe.
        if (identity.exactLocation && identity.location.key) {
            const same = sameHost.find((a) => a.location && a.location.key === identity.location.key);
            if (same) return { match: this._rekey(same, identity), matchedBy: 'location', suggestion: null };
        }

        const sameName = sameHost.filter((a) => a.projectName === identity.name
            && (identity.exactLocation || compatibleLocation(a.location, identity.location)));

        // Rule 3: one side has no uid -> match by name (not for file-based hosts: other file = other project).
        if (!identity.exactLocation) {
            const legacy = sameName.find((a) => !a.projectUid || !identity.uid);
            if (legacy) {
                const match = identity.uid && !legacy.projectUid ? this._rekey(legacy, identity) : legacy;
                return { match, matchedBy: 'fallback', suggestion: null };
            }
        }

        // Rule 4: let the user decide.
        return { match: null, matchedBy: null, suggestion: sameName[0] || null };
    }

    _refreshProjectInfo(record, identity) {
        const loc = identity.location;
        const changed = record.projectName !== identity.name
            || (loc.key && (!record.location || record.location.key !== loc.key || record.location.label !== loc.label));
        if (!changed) return;
        this.store.update(() => {
            record.projectName = identity.name;
            if (loc.key) record.location = { key: loc.key, label: loc.label };
            record.updatedAt = new Date().toISOString();
        });
    }

    _rekey(record, identity) {
        if (record.key === identity.key && record.projectUid === identity.uid) {
            this._refreshProjectInfo(record, identity);
            return record;
        }
        const next = {
            ...record,
            key: identity.key,
            host: identity.host,
            projectUid: identity.uid,
            projectName: identity.name,
            location: identity.location.key ? { key: identity.location.key, label: identity.location.label } : record.location,
            updatedAt: new Date().toISOString(),
        };
        this.store.update(() => {
            const all = this._all();
            delete all[record.key];
            all[next.key] = next;
        });
        this.log && this.log.info(`Association re-keyed ${record.key} -> ${next.key}`);
        return next;
    }

    /** Create the association for the given project identity (one page), replacing any previous one. */
    set(identity, page, { account } = {}) {
        const now = new Date().toISOString();
        const existing = this._all()[identity.key];
        const ref = pageRef(page, account);
        const record = mirrorLegacy({
            key: identity.key,
            host: identity.host,
            projectUid: identity.uid || null,
            projectName: identity.name,
            location: { key: identity.location.key, label: identity.location.label },
            pages: [ref],
            activePage: ref.id,
            createdAt: existing ? existing.createdAt : now,
            updatedAt: now,
        });
        this.store.update(() => { this._all()[identity.key] = record; });
        return record;
    }

    _mutate(key, fn) {
        const record = this.get(key);
        if (!record) throw Object.assign(new Error('unknown association'), { code: 'not_found' });
        let result;
        this.store.update(() => {
            result = fn(record);
            record.updatedAt = new Date().toISOString();
            mirrorLegacy(record);
        });
        return result === undefined ? record : result;
    }

    /** Adds a page as a new tab (and shows it). */
    addPage(key, page, { account } = {}) {
        return this._mutate(key, (record) => {
            if (record.pages.some((p) => p.id === page.id)) throw Object.assign(new Error('already linked'), { code: 'page_already_linked' });
            if (record.pages.length >= MAX_PAGES) throw Object.assign(new Error('too many pages'), { code: 'too_many_pages' });
            const ref = pageRef(page, account);
            record.pages.push(ref);
            record.activePage = ref.id;
        });
    }

    /** Replaces one tab's page (defaults to the active tab), keeping its position. */
    replacePage(key, page, { account, oldId } = {}) {
        return this._mutate(key, (record) => {
            const target = oldId || record.activePage;
            const i = Math.max(0, record.pages.findIndex((p) => p.id === target));
            const dup = record.pages.findIndex((p) => p.id === page.id);
            if (dup !== -1 && dup !== i) throw Object.assign(new Error('already linked'), { code: 'page_already_linked' });
            const ref = pageRef(page, account);
            record.pages[i] = ref;
            record.activePage = ref.id;
        });
    }

    /** Removes a tab. The last page cannot be removed (remove the association instead). */
    removePage(key, pageId) {
        return this._mutate(key, (record) => {
            if (record.pages.length <= 1) throw Object.assign(new Error('last page'), { code: 'last_page' });
            const i = record.pages.findIndex((p) => p.id === pageId);
            if (i === -1) return;
            record.pages.splice(i, 1);
            if (record.activePage === pageId) record.activePage = record.pages[Math.min(i, record.pages.length - 1)].id;
        });
    }

    setActivePage(key, pageId) {
        const record = this.get(key);
        if (!record || record.activePage === pageId || !record.pages.some((p) => p.id === pageId)) return record;
        return this._mutate(key, (r) => { r.activePage = pageId; });
    }

    /** Change the page of an existing association (by key): replaces its active tab. */
    setPage(key, page, opts = {}) {
        if (!this.get(key)) return null;
        return this.replacePage(key, page, opts);
    }

    /** Keep the stored title/url/icon in sync when a page is renamed. */
    refreshPageInfo(pageId, page) {
        const stale = [];
        for (const a of Object.values(this._all())) {
            for (const p of a.pages || []) {
                if (p.id === pageId && (p.title !== page.title || p.url !== page.url
                    || JSON.stringify(p.icon || null) !== JSON.stringify(page.icon || null))) stale.push([a, p]);
            }
        }
        if (!stale.length) return;
        this.store.update(() => {
            for (const [a, p] of stale) {
                p.title = page.title;
                p.url = page.url;
                p.icon = page.icon || null;
                mirrorLegacy(a);
            }
        });
    }

    remove(key) {
        if (!this._all()[key]) return false;
        this.store.update(() => { delete this._all()[key]; });
        return true;
    }
}

module.exports = { AssociationStore, MAX_PAGES };
