'use strict';

// Local cache of rendered Notion content: one JSON document per page
// ("cache/<pageId>.json" in the host backend). Lets the panel show the last
// known version instantly and while offline.

const VERSION = 1;
const ID_RE = /^[0-9a-f]{32}$/;
const PREFIX = 'cache/';

class PageCache {
    constructor(backend, { maxPages, log }) {
        this.backend = backend;
        this.maxPages = maxPages;
        this.log = log;
    }

    _name(pageId) {
        const id = String(pageId).replace(/-/g, '').toLowerCase();
        if (!ID_RE.test(id)) throw new Error('invalid page id');
        return `${PREFIX}${id}.json`;
    }

    async get(pageId) {
        try {
            const raw = await this.backend.read(this._name(pageId));
            if (!raw) return null;
            const data = JSON.parse(raw);
            return data.schemaVersion === VERSION ? data : null;
        } catch (_) {
            return null;
        }
    }

    async put(pageId, content) {
        try {
            const doc = { schemaVersion: VERSION, savedAt: new Date().toISOString(), ...content };
            await this.backend.write(this._name(pageId), JSON.stringify(doc));
            await this._prune();
        } catch (e) {
            this.log.warn('Cache write failed', e.message);
        }
    }

    async _entries() {
        try {
            return (await this.backend.list(PREFIX)).filter((e) => e.name.endsWith('.json'));
        } catch (_) {
            return [];
        }
    }

    async _prune() {
        const entries = (await this._entries()).sort((a, b) => b.mtime - a.mtime);
        for (const e of entries.slice(this.maxPages)) {
            try { await this.backend.remove(e.name); } catch (_) { /* ignore */ }
        }
    }

    async stats() {
        const entries = await this._entries();
        return { pages: entries.length, bytes: entries.reduce((s, e) => s + (e.size || 0), 0) };
    }

    async clear() {
        for (const e of await this._entries()) {
            try { await this.backend.remove(e.name); } catch (_) { /* ignore */ }
        }
    }
}

module.exports = { PageCache };
