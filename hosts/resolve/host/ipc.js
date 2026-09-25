'use strict';

// Exposes core/operations.js to the renderer over Electron IPC ("op:<name>").
// Every call: checks the sender frame, then runs the (validating) operation,
// which returns { ok, data } | { ok: false, error } — never a raw Error.

const { ipcMain } = require('electron');
const { runOperation, OPERATION_NAMES } = require('core/operations');
const { toUserError } = require('core/notion/errors');

function register({ operations, getWindow, log }) {
    const isTrustedSender = (event) => {
        const win = getWindow();
        const frameUrl = event.senderFrame && event.senderFrame.url;
        return !!win && event.sender === win.webContents && typeof frameUrl === 'string' && frameUrl.startsWith('file://');
    };

    for (const name of OPERATION_NAMES) {
        ipcMain.handle(`op:${name}`, async (event, ...args) => {
            if (!isTrustedSender(event)) {
                log.warn(`Rejected IPC ${name} from untrusted sender`);
                return { ok: false, error: toUserError({ code: 'invalid_input' }) };
            }
            return runOperation(operations, name, args, log);
        });
    }
}

module.exports = { register };
