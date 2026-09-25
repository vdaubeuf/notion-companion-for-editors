'use strict';

// Editing project  <->  Notion page associations.
//
// File format (schemaVersion 2):
// {
//   "schemaVersion": 2,
//   "associations": {
//     "<identity key>": {
//       "key": "uid:…" | "name:…" (Resolve fallback) | "path:…" (Premiere fallback),
//       "host": "resolve" | "premiere",
//       "projectUid": "…" | null,
//       "projectName": "Mon documentaire",
//       "location": { "key": "Disk|Local Database" | "/…/Mon documentaire.prproj", "label": "…" },
//       "notionPageId": "…", "notionPageTitle": "…", "notionPageUrl": "…",
//       "notionPageIcon": { "type": "emoji", "emoji": "🎬" } | null,
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

const VERSION = 2;

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

    /** Create or replace the association for the given project identity. */
    set(identity, page) {
        const now = new Date().toISOString();
        const existing = this._all()[identity.key];
        const record = {
            key: identity.key,
            host: identity.host,
            projectUid: identity.uid || null,
            projectName: identity.name,
            location: { key: identity.location.key, label: identity.location.label },
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
        const changed = Object.values(this._all()).filter((a) => a.notionPageId === pageId
            && (a.notionPageTitle !== page.title || a.notionPageUrl !== page.url
                || JSON.stringify(a.notionPageIcon || null) !== JSON.stringify(page.icon || null)));
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
