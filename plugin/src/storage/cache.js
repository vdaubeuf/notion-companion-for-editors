'use strict';

// Local cache of rendered Notion content: one JSON file per page in <userData>/cache.
// Lets the panel show the last known version instantly and while offline.

const fs = require('fs');
const path = require('path');

const VERSION = 1;
const ID_RE = /^[0-9a-f]{32}$/;

class PageCache {
    constructor(dir, { maxPages, log }) {
        this.dir = dir;
        this.maxPages = maxPages;
        this.log = log;
    }

    _file(pageId) {
        const id = String(pageId).replace(/-/g, '').toLowerCase();
        if (!ID_RE.test(id)) throw new Error('invalid page id');
        return path.join(this.dir, `${id}.json`);
    }

    get(pageId) {
        try {
            const data = JSON.parse(fs.readFileSync(this._file(pageId), 'utf8'));
            if (data.schemaVersion !== VERSION) return null;
            return data;
        } catch (_) {
            return null;
        }
    }

    put(pageId, content) {
        try {
            fs.mkdirSync(this.dir, { recursive: true });
            const file = this._file(pageId);
            const tmp = `${file}.tmp`;
            fs.writeFileSync(tmp, JSON.stringify({ schemaVersion: VERSION, savedAt: new Date().toISOString(), ...content }), { mode: 0o600 });
            fs.renameSync(tmp, file);
            this._prune();
        } catch (e) {
            this.log.warn('Cache write failed', e.message);
        }
    }

    _entries() {
        try {
            return fs.readdirSync(this.dir)
                .filter((f) => f.endsWith('.json'))
                .map((f) => {
                    const full = path.join(this.dir, f);
                    const st = fs.statSync(full);
                    return { full, mtime: st.mtimeMs, size: st.size };
                });
        } catch (_) {
            return [];
        }
    }

    _prune() {
        const entries = this._entries().sort((a, b) => b.mtime - a.mtime);
        for (const e of entries.slice(this.maxPages)) {
            try { fs.unlinkSync(e.full); } catch (_) { /* ignore */ }
        }
    }

    stats() {
        const entries = this._entries();
        return { pages: entries.length, bytes: entries.reduce((s, e) => s + e.size, 0) };
    }

    clear() {
        for (const e of this._entries()) {
            try { fs.unlinkSync(e.full); } catch (_) { /* ignore */ }
        }
    }
}

module.exports = { PageCache };
