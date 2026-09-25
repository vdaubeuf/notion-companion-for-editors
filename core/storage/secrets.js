'use strict';

// Notion token holder.
//
// The actual secure storage is provided by each host:
//   Resolve (Electron): safeStorage — macOS Keychain / Windows DPAPI
//   Premiere (UXP):     uxp.storage.secureStorage — OS-level secure storage
// Provider interface:
//   available() -> boolean        load() -> Promise<string|null>
//   save(token) -> Promise<void>  clear() -> Promise<void>
//
// The clear-text token only lives in memory here. It is never sent to the UI
// layer, never logged (see logger.redact) and never written in clear text.

class SecretStore {
    constructor(provider, log, { onChange } = {}) {
        this.provider = provider;
        this.log = log;
        this.onChange = onChange || (() => {});
        this.token = null;
    }

    get encryptionAvailable() {
        try {
            return !!this.provider.available();
        } catch (_) {
            return false;
        }
    }

    async load() {
        try {
            this.token = (await this.provider.load()) || null;
        } catch (e) {
            this.log.error('Cannot read the stored Notion token (secure storage access denied?)', e.message);
            this.token = null;
        }
        this.onChange(this.token);
        return this.token;
    }

    hasToken() {
        return !!this.token;
    }

    getToken() {
        return this.token;
    }

    async setToken(token) {
        if (!this.encryptionAvailable) {
            const err = new Error('OS secure storage unavailable');
            err.code = 'encryption_unavailable';
            throw err;
        }
        await this.provider.save(token);
        this.token = token;
        this.onChange(token);
    }

    async clearToken() {
        await this.provider.clear();
        this.token = null;
        this.onChange(null);
    }
}

module.exports = { SecretStore };
