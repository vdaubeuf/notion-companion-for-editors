'use strict';

// The operations the UI can call, shared by every host:
//   Resolve:  exposed through Electron IPC (hosts/resolve/host/ipc.js + preload.js)
//   Premiere: called in-process (hosts/premiere/host/main.js)
// Each operation validates its arguments. runOperation() returns
// { ok: true, data } or { ok: false, error: { code, message } } — never a raw
// Error / stack trace.

const { normalizeId } = require('./notion/ids');
const { toUserError } = require('./notion/errors');

class InputError extends Error {
    constructor(detail) { super(detail); this.code = 'invalid_input'; }
}

const v = {
    string(value, max, { optional = false } = {}) {
        if (value === undefined || value === null) {
            if (optional) return null;
            throw new InputError('missing string');
        }
        if (typeof value !== 'string' || value.length > max) throw new InputError('bad string');
        return value;
    },
    pageId(value) {
        const id = normalizeId(value);
        if (!id) throw new InputError('bad page id');
        return id;
    },
    assocKey(value) {
        const s = v.string(value, 2000);
        if (!/^(uid|name|path):/.test(s)) throw new InputError('bad key');
        return s;
    },
    parentRefs(value) {
        if (!Array.isArray(value) || value.length > 50) throw new InputError('bad refs');
        const types = new Set(['page_id', 'data_source_id', 'database_id', 'workspace', 'block_id']);
        return value.filter((r) => r && types.has(r.type)).map((r) => ({
            type: r.type,
            id: r.type === 'workspace' ? null : v.pageId(r.id),
        }));
    },
    token(value) {
        const s = v.string(value, 500).trim();
        // Notion tokens are opaque; just reject obvious copy/paste accidents.
        if (s.length < 20 || /\s/.test(s)) {
            const e = new Error('bad token format');
            e.code = 'invalid_token_format';
            throw e;
        }
        return s;
    },
    patch(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError('bad patch');
        return value;
    },
};

const OPERATION_NAMES = [
    'getSnapshot', 'refresh', 'about', 'openLogs', 'openInNotion', 'openExternal', 'openTokenHelp',
    'getSettings', 'patchSettings',
    'saveToken', 'testConnection', 'clearToken', 'search', 'parents',
    'associate', 'associateForKey', 'adoptSuggestion', 'dismissSuggestion', 'dissociate', 'removeAssociation', 'listAssociations',
    'clearCache', 'cacheStats',
];

function createOperations({ controller, actions }) {
    return {
        getSnapshot: () => controller.getSnapshot(),
        refresh: () => controller.refresh(),
        about: () => actions.about(),
        openLogs: () => actions.openLogs(),
        openInNotion: () => actions.openInNotion(),
        openExternal: (url) => actions.openExternal(v.string(url, 2100)),
        openTokenHelp: () => actions.openTokenHelp(),

        getSettings: () => actions.getSettings(),
        patchSettings: (patch) => actions.patchSettings(v.patch(patch)),

        saveToken: (token) => controller.saveToken(v.token(token)),
        testConnection: () => controller.checkNotion(),
        clearToken: () => controller.clearToken(),
        search: (query, cursor) => controller.search(
            v.string(query, 200, { optional: true }) || '',
            v.string(cursor, 200, { optional: true }),
        ),
        parents: (refs) => controller.parentTitles(v.parentRefs(refs)),

        associate: (pageId) => controller.associate(v.pageId(pageId)),
        associateForKey: (key, pageId) => controller.associateForKey(v.assocKey(key), v.pageId(pageId)),
        adoptSuggestion: () => controller.adoptSuggestion(),
        dismissSuggestion: () => controller.dismissSuggestion(),
        dissociate: () => controller.dissociate(),
        removeAssociation: (key) => controller.removeAssociation(v.assocKey(key)),
        listAssociations: () => controller.listAssociations(),

        clearCache: () => controller.clearCache(),
        cacheStats: () => actions.cacheStats(),
    };
}

async function runOperation(ops, name, args, log) {
    const fn = Object.prototype.hasOwnProperty.call(ops, name) ? ops[name] : null;
    if (!fn) return { ok: false, error: toUserError({ code: 'invalid_input' }) };
    try {
        return { ok: true, data: await fn(...(args || [])) };
    } catch (e) {
        if (!(e instanceof InputError) && log) log.warn(`Operation ${name} failed`, e);
        return { ok: false, error: toUserError(e) };
    }
}

module.exports = { createOperations, runOperation, OPERATION_NAMES, validators: v };
