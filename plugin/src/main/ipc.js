'use strict';

// IPC surface exposed to the renderer (through preload.js).
// Every handler: checks the sender frame, validates its arguments, and returns
// { ok: true, data } or { ok: false, error: { code, message } } — never a raw
// Error / stack trace.

const { ipcMain } = require('electron');
const { normalizeId } = require('../notion/ids');
const { toUserError } = require('../notion/errors');

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
        const s = v.string(value, 1200);
        if (!/^(uid|name):/.test(s)) throw new InputError('bad key');
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
};

function register({ controller, getWindow, actions, log }) {
    const isTrustedSender = (event) => {
        const win = getWindow();
        const frameUrl = event.senderFrame && event.senderFrame.url;
        return !!win && event.sender === win.webContents && typeof frameUrl === 'string' && frameUrl.startsWith('file://');
    };

    const handle = (channel, fn) => {
        ipcMain.handle(channel, async (event, ...args) => {
            if (!isTrustedSender(event)) {
                log.warn(`Rejected IPC ${channel} from untrusted sender`);
                return { ok: false, error: toUserError({ code: 'invalid_input' }) };
            }
            try {
                return { ok: true, data: await fn(...args) };
            } catch (e) {
                if (!(e instanceof InputError)) log.warn(`IPC ${channel} failed`, e);
                return { ok: false, error: toUserError(e) };
            }
        });
    };

    handle('app:getSnapshot', () => controller.getSnapshot());
    handle('app:refresh', () => controller.refresh());
    handle('app:about', () => actions.about());
    handle('app:openLogs', () => actions.openLogs());
    handle('app:openInNotion', () => actions.openInNotion());
    handle('app:openExternal', (url) => actions.openExternal(v.string(url, 2100)));
    handle('app:openTokenHelp', () => actions.openTokenHelp());

    handle('settings:get', () => actions.getSettings());
    handle('settings:patch', (patch) => {
        if (!patch || typeof patch !== 'object') throw new InputError('bad patch');
        return actions.patchSettings(patch);
    });

    handle('notion:saveToken', (token) => controller.saveToken(v.token(token)));
    handle('notion:testConnection', () => controller.checkNotion());
    handle('notion:clearToken', () => controller.clearToken());
    handle('notion:search', (query, cursor) => controller.search(
        v.string(query, 200, { optional: true }) || '',
        v.string(cursor, 200, { optional: true }),
    ));
    handle('notion:parents', (refs) => controller.parentTitles(v.parentRefs(refs)));

    handle('assoc:set', (pageId) => controller.associate(v.pageId(pageId)));
    handle('assoc:setForKey', (key, pageId) => controller.associateForKey(v.assocKey(key), v.pageId(pageId)));
    handle('assoc:adoptSuggestion', () => controller.adoptSuggestion());
    handle('assoc:dismissSuggestion', () => controller.dismissSuggestion());
    handle('assoc:dissociate', () => controller.dissociate());
    handle('assoc:remove', (key) => controller.removeAssociation(v.assocKey(key)));
    handle('assoc:list', () => controller.listAssociations());

    handle('cache:clear', () => controller.clearCache());
    handle('cache:stats', () => actions.cacheStats());
}

module.exports = { register, validators: v };
