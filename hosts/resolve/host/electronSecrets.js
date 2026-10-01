'use strict';

// Secret provider for core/storage/secrets on top of Electron's safeStorage:
//   macOS: encryption key in the user's Keychain · Windows: DPAPI (user account).
// Encrypted tokens are stored in <userData>/secrets.json:
//   { "schemaVersion": 1,
//     "notionToken": { "enc": "<base64>", "savedAt": "ISO" },          key 'default' (format of v0.1 / v0.2)
//     "tokens": { "<account id>": { "enc": "<base64>", "savedAt": "ISO" } } }

const { JsonStore } = require('core/storage/jsonStore');

function createElectronSecretProvider(safeStorage, backend, log) {
    const store = new JsonStore(backend, 'secrets.json', { version: 1, defaults: () => ({ notionToken: null, tokens: {} }), log });
    let loaded = null;
    const ready = () => { loaded = loaded || store.load(); return loaded; };

    const entry = (key) => {
        const d = store.get();
        return key === 'default' ? d.notionToken : (d.tokens || {})[key];
    };
    const setEntry = (key, value) => store.update((d) => {
        if (key === 'default') d.notionToken = value;
        else {
            d.tokens = d.tokens || {};
            if (value) d.tokens[key] = value; else delete d.tokens[key];
        }
    });

    return {
        available() {
            return safeStorage.isEncryptionAvailable();
        },
        async load(key) {
            await ready();
            const e = entry(key);
            if (!e || !e.enc) return null;
            return safeStorage.decryptString(Buffer.from(e.enc, 'base64'));
        },
        async save(key, token) {
            await ready();
            const enc = safeStorage.encryptString(token).toString('base64');
            setEntry(key, { enc, savedAt: new Date().toISOString() });
            await store.flush();
        },
        async clear(key) {
            await ready();
            setEntry(key, null);
            await store.flush();
        },
    };
}

module.exports = { createElectronSecretProvider };
