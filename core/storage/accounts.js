'use strict';

// Connected accounts (no secrets here: tokens are in SecretStore, keyed by account id).
//
// File format (accounts.json, schemaVersion 1):
// {
//   "schemaVersion": 1,
//   "accounts": [
//     { "id": "default" | "<12 hex>", "kind": "notion" | "google",
//       "name": "Valentin", "workspace": "Sapa", "externalId": "<bot / user id>", "addedAt": "ISO" }
//   ]
// }
// Order = display order; the first Notion account is the default one (pages
// stored before multi-account support have no account and use it).

const { JsonStore } = require('./jsonStore');

const KINDS = new Set(['notion', 'google']);

function randomId() {
    let out = '';
    for (let i = 0; i < 12; i += 1) out += Math.floor(Math.random() * 16).toString(16);
    return out;
}

class AccountStore {
    constructor(backend, log) {
        this.store = new JsonStore(backend, 'accounts.json', { version: 1, defaults: () => ({ accounts: [] }), log });
    }

    load() {
        return this.store.load();
    }

    flush() {
        return this.store.flush();
    }

    _all() {
        const d = this.store.get();
        if (!Array.isArray(d.accounts)) d.accounts = [];
        return d.accounts;
    }

    list(kind) {
        return this._all().filter((a) => !kind || a.kind === kind).map((a) => ({ ...a }));
    }

    ids() {
        return this._all().map((a) => a.id);
    }

    get(id) {
        const a = this._all().find((x) => x.id === id);
        return a ? { ...a } : null;
    }

    defaultId(kind = 'notion') {
        const a = this._all().find((x) => x.kind === kind);
        return a ? a.id : null;
    }

    findByExternalId(kind, externalId) {
        if (!externalId) return null;
        const a = this._all().find((x) => x.kind === kind && x.externalId === externalId);
        return a ? { ...a } : null;
    }

    add({ id, kind, name = null, workspace = null, externalId = null }) {
        if (!KINDS.has(kind)) throw new Error('bad account kind');
        let newId = id || randomId();
        while (!id && this._all().some((a) => a.id === newId)) newId = randomId();
        const record = { id: newId, kind, name, workspace, externalId, addedAt: new Date().toISOString() };
        this.store.update(() => { this._all().push(record); });
        return { ...record };
    }

    update(id, patch) {
        const a = this._all().find((x) => x.id === id);
        if (!a) return null;
        this.store.update(() => {
            for (const k of ['name', 'workspace', 'externalId']) if (patch[k] !== undefined) a[k] = patch[k];
        });
        return { ...a };
    }

    remove(id) {
        const list = this._all();
        const i = list.findIndex((a) => a.id === id);
        if (i === -1) return false;
        this.store.update(() => { list.splice(i, 1); });
        return true;
    }
}

module.exports = { AccountStore };
