'use strict';

// Token holder, one token per account (one per Notion workspace).
//
// The actual secure storage is provided by each host:
//   Resolve (Electron): safeStorage — macOS Keychain / Windows DPAPI
//   Premiere (UXP):     uxp.storage.secureStorage — OS-level secure storage
// Provider interface (key = account id; 'default' is the single token of v0.1/v0.2):
//   available() -> boolean             load(key) -> Promise<string|null>
//   save(key, token) -> Promise<void>  clear(key) -> Promise<void>
//
// Clear-text tokens only live in memory here. They are never sent to the UI
// layer, never logged (see logger.redact / setSecrets) and never written in clear text.

class SecretStore {
    constructor(provider, log, { onChange } = {}) {
        this.provider = provider;
        this.log = log;
        this.onChange = onChange || (() => {});
        this.tokens = new Map();
    }

    get encryptionAvailable() {
        try {
            return !!this.provider.available();
        } catch (_) {
            return false;
        }
    }

    _changed() {
        this.onChange([...this.tokens.values()]);
    }

    /** Loads the tokens of the given keys (missing ones are skipped). */
    async load(keys = ['default']) {
        for (const key of new Set(keys)) {
            try {
                const token = (await this.provider.load(key)) || null;
                if (token) this.tokens.set(key, token); else this.tokens.delete(key);
            } catch (e) {
                this.log.error(`Cannot read a stored token (secure storage access denied?) [${key}]`, e.message);
                this.tokens.delete(key);
            }
        }
        this._changed();
    }

    keys() {
        return [...this.tokens.keys()];
    }

    has(key) {
        return this.tokens.has(key);
    }

    get(key) {
        return this.tokens.get(key) || null;
    }

    async set(key, token) {
        if (!this.encryptionAvailable) {
            const err = new Error('OS secure storage unavailable');
            err.code = 'encryption_unavailable';
            throw err;
        }
        await this.provider.save(key, token);
        this.tokens.set(key, token);
        this._changed();
    }

    async clear(key) {
        await this.provider.clear(key);
        this.tokens.delete(key);
        this._changed();
    }
}

module.exports = { SecretStore };
