'use strict';

// Secret provider for core/storage/secrets on top of Electron's safeStorage:
//   macOS: encryption key in the user's Keychain · Windows: DPAPI (user account).
// The encrypted token is stored in <userData>/secrets.json as
//   { "schemaVersion": 1, "notionToken": { "enc": "<base64>", "savedAt": "ISO" } }
// (format unchanged since v0.1).

const { JsonStore } = require('core/storage/jsonStore');

function createElectronSecretProvider(safeStorage, backend, log) {
    const store = new JsonStore(backend, 'secrets.json', { version: 1, defaults: () => ({ notionToken: null }), log });

    return {
        available() {
            return safeStorage.isEncryptionAvailable();
        },
        async load() {
            await store.load();
            const entry = store.get().notionToken;
            if (!entry || !entry.enc) return null;
            return safeStorage.decryptString(Buffer.from(entry.enc, 'base64'));
        },
        async save(token) {
            const enc = safeStorage.encryptString(token).toString('base64');
            store.update((d) => { d.notionToken = { enc, savedAt: new Date().toISOString() }; });
            await store.flush();
        },
        async clear() {
            store.update((d) => { d.notionToken = null; });
            await store.flush();
        },
    };
}

module.exports = { createElectronSecretProvider };
