'use strict';

// Resolve project  <->  Notion page associations.
//
// File format (schemaVersion 1):
// {
//   "schemaVersion": 1,
//   "associations": {
//     "uid:<Project.GetUniqueId()>" | "name:<dbType>|<dbName>|<projectName>": {
//       "key": "...",
//       "resolveProjectUid": "..." | null,
//       "resolveProjectName": "Mon documentaire",
//       "resolveDatabase": { "type": "Disk", "name": "Local Database" },
//       "resolveFolder": "Documentaires" | null,
//       "notionPageId": "…",
//       "notionPageTitle": "Mon documentaire",
//       "notionPageUrl": "https://www.notion.so/…",
//       "notionPageIcon": { "type": "emoji", "emoji": "🎬" } | null,
//       "createdAt": "ISO", "updatedAt": "ISO"
//     }
//   }
// }
//
// Matching rules (see find()):
//  1. same Resolve unique id                       -> match (a project rename is followed)
//  2. no uid on one side, same database + same name -> match (and re-keyed to the uid when possible)
//  3. both have a uid but they differ, same name    -> *suggestion* only (the user confirms),
//     because two distinct projects can share a name (different folders).

const { JsonStore } = require('./jsonStore');
const { sameDatabase, normalizeDb } = require('../resolve/identity');

const VERSION = 1;

class AssociationStore {
    constructor(file, log) {
        this.store = new JsonStore(file, {
            version: VERSION,
            defaults: () => ({ associations: {} }),
            migrations: {
                // v0 -> v1: early flat map { key: record } without wrapper.
                1: (data) => {
                    if (data.associations) return data;
                    const associations = {};
                    for (const [k, v] of Object.entries(data)) {
                        if (v && typeof v === 'object' && v.notionPageId) associations[k] = { key: k, ...v };
                    }
                    return { associations };
                },
            },
            log,
        });
        this.log = log;
    }

    _all() {
        const data = this.store.get();
        if (!data.associations || typeof data.associations !== 'object') data.associations = {};
        return data.associations;
    }

    list() {
        return Object.values(this._all()).sort((a, b) => a.resolveProjectName.localeCompare(b.resolveProjectName));
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

        if (identity.uid) {
            const direct = all[`uid:${identity.uid}`];
            if (direct) {
                this._refreshProjectInfo(direct, identity);
                return { match: direct, matchedBy: 'uid', suggestion: null };
            }
        } else if (all[identity.key]) {
            return { match: all[identity.key], matchedBy: 'name', suggestion: null };
        }

        const sameName = Object.values(all).filter((a) =>
            a.resolveProjectName === identity.name && sameDatabase(a.resolveDatabase, identity.database));

        // Rule 2: one side has no uid -> safe to match by db + name.
        const legacy = sameName.find((a) => !a.resolveProjectUid || !identity.uid);
        if (legacy) {
            if (identity.uid && !legacy.resolveProjectUid) {
                const migrated = this._rekey(legacy, identity);
                return { match: migrated, matchedBy: 'name', suggestion: null };
            }
            return { match: legacy, matchedBy: 'name', suggestion: null };
        }

        // Rule 3: different uid, same name -> let the user decide.
        const suggestion = sameName[0] || null;
        return { match: null, matchedBy: null, suggestion };
    }

    _refreshProjectInfo(record, identity) {
        const db = normalizeDb(identity.database);
        const changed = record.resolveProjectName !== identity.name
            || (db.name && (record.resolveDatabase?.name !== db.name || record.resolveDatabase?.type !== db.type))
            || (identity.folder && record.resolveFolder !== identity.folder);
        if (!changed) return;
        this.store.update(() => {
            record.resolveProjectName = identity.name;
            if (db.name) record.resolveDatabase = db;
            if (identity.folder) record.resolveFolder = identity.folder;
            record.updatedAt = new Date().toISOString();
        });
    }

    _rekey(record, identity) {
        const next = {
            ...record,
            key: identity.key,
            resolveProjectUid: identity.uid,
            resolveProjectName: identity.name,
            resolveDatabase: normalizeDb(identity.database),
            resolveFolder: identity.folder || record.resolveFolder || null,
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

    /** Create or replace the association for the given Resolve identity. */
    set(identity, page) {
        const now = new Date().toISOString();
        const existing = this._all()[identity.key];
        const record = {
            key: identity.key,
            resolveProjectUid: identity.uid || null,
            resolveProjectName: identity.name,
            resolveDatabase: normalizeDb(identity.database),
            resolveFolder: identity.folder || null,
            notionPageId: page.id,
            notionPageTitle: page.title,
            notionPageUrl: page.url,
            notionPageIcon: page.icon || null,
            createdAt: existing ? existing.createdAt : now,
            updatedAt: now,
        };
        this.store.update(() => { this._all()[identity.key] = record; });
        return record;
    }

    /** Change the Notion page of an existing association (by key). */
    setPage(key, page) {
        const record = this.get(key);
        if (!record) return null;
        this.store.update(() => {
            record.notionPageId = page.id;
            record.notionPageTitle = page.title;
            record.notionPageUrl = page.url;
            record.notionPageIcon = page.icon || null;
            record.updatedAt = new Date().toISOString();
        });
        return record;
    }

    /** Keep the stored title/url/icon in sync when the page is renamed in Notion. */
    refreshPageInfo(pageId, page) {
        const targets = Object.values(this._all()).filter((a) => a.notionPageId === pageId);
        const changed = targets.filter((a) => a.notionPageTitle !== page.title || a.notionPageUrl !== page.url
            || JSON.stringify(a.notionPageIcon || null) !== JSON.stringify(page.icon || null));
        if (!changed.length) return;
        this.store.update(() => {
            for (const a of changed) {
                a.notionPageTitle = page.title;
                a.notionPageUrl = page.url;
                a.notionPageIcon = page.icon || null;
            }
        });
    }

    remove(key) {
        if (!this._all()[key]) return false;
        this.store.update(() => { delete this._all()[key]; });
        return true;
    }
}

module.exports = { AssociationStore };
