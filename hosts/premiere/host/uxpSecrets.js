'use strict';

// Secret provider for core/storage/secrets on top of UXP secureStorage
// (require('uxp').storage.secureStorage): OS-level secure storage managed by
// the Adobe host, scoped to this plugin.

const KEY = 'notion-token';

function decode(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') return value;
    // getItem returns a Uint8Array: decode UTF-8 by hand (TextDecoder may be unavailable).
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    let out = '';
    for (let i = 0; i < bytes.length; i += 1) {
        const b = bytes[i];
        if (b < 0x80) out += String.fromCharCode(b);
        else if (b >= 0xc0 && b < 0xe0) out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[++i] & 0x3f));
        else if (b >= 0xe0 && b < 0xf0) out += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[++i] & 0x3f) << 6) | (bytes[++i] & 0x3f));
        else i += 3; // 4-byte sequences never appear in Notion tokens
    }
    return out || null;
}

function createUxpSecretProvider(uxp) {
    const ss = uxp.storage && uxp.storage.secureStorage;
    return {
        available() {
            return !!ss;
        },
        async load() {
            if (!ss) return null;
            try {
                return decode(await ss.getItem(KEY));
            } catch (_) {
                return null; // no item stored yet
            }
        },
        async save(token) {
            await ss.setItem(KEY, token);
        },
        async clear() {
            try { await ss.removeItem(KEY); } catch (_) { /* nothing stored */ }
        },
    };
}

module.exports = { createUxpSecretProvider };
