'use strict';

// Notion token storage.
//
// The token is encrypted with Electron's safeStorage before being written to
// <userData>/secrets.json:
//   - macOS: the encryption key lives in the user's Keychain
//   - Windows: DPAPI (bound to the Windows user account)
// The clear-text token only exists in the main process memory. It is never
// sent to the renderer, never logged (see logger.redact) and never written in
// clear text. If OS encryption is unavailable we refuse to store it.

const { JsonStore } = require('./jsonStore');

class SecretStore {
    constructor(file, safeStorage, log, { onChange } = {}) {
        this.safeStorage = safeStorage;
        this.onChange = onChange || (() => {});
        this.log = log;
        this.store = new JsonStore(file, { version: 1, defaults: () => ({ notionToken: null }), log });
        this.cached = undefined;
    }

    get encryptionAvailable() {
        try {
            return this.safeStorage.isEncryptionAvailable();
        } catch (_) {
            return false;
        }
    }

    hasToken() {
        return !!this.store.get().notionToken;
    }

    getToken() {
        if (this.cached !== undefined) return this.cached;
        const entry = this.store.get().notionToken;
        if (!entry || !entry.enc) {
            this.cached = null;
            return null;
        }
        try {
            this.cached = this.safeStorage.decryptString(Buffer.from(entry.enc, 'base64'));
        } catch (e) {
            this.log.error('Cannot decrypt stored Notion token (keychain access denied or data from another user?)', e.message);
            this.cached = null;
        }
        return this.cached;
    }

    setToken(token) {
        if (!this.encryptionAvailable) {
            const err = new Error('OS encryption unavailable');
            err.code = 'encryption_unavailable';
            throw err;
        }
        const enc = this.safeStorage.encryptString(token).toString('base64');
        this.store.update((d) => { d.notionToken = { enc, savedAt: new Date().toISOString() }; });
        this.cached = token;
        this.onChange(token);
    }

    clearToken() {
        this.store.update((d) => { d.notionToken = null; });
        this.cached = null;
        this.onChange(null);
    }
}

module.exports = { SecretStore };
