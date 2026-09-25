// Sandboxed preload: the only bridge between the renderer and the main process.
// Exposes window.companion with the operations of core/operations.js (keep the
// list in sync) plus state subscriptions. No Node.js, no Resolve object and no
// secret ever reaches the renderer.

const { contextBridge, ipcRenderer } = require('electron/renderer');

const OPERATIONS = [
    'getSnapshot', 'refresh', 'about', 'openLogs', 'openInNotion', 'openExternal', 'openTokenHelp',
    'getSettings', 'patchSettings',
    'saveToken', 'testConnection', 'clearToken', 'search', 'parents',
    'associate', 'associateForKey', 'adoptSuggestion', 'dismissSuggestion', 'dissociate', 'removeAssociation', 'listAssociations',
    'clearCache', 'cacheStats',
];

function subscribe(channel, callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
}

const api = {
    onState: (cb) => subscribe('state', cb),
    onContent: (cb) => subscribe('content', cb),
    onSettings: (cb) => subscribe('settings', cb),
};
for (const name of OPERATIONS) {
    api[name] = (...args) => ipcRenderer.invoke(`op:${name}`, ...args);
}

contextBridge.exposeInMainWorld('companion', api);
