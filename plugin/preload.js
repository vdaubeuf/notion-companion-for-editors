// Sandboxed preload: the only bridge between the renderer and the main process.
// Exposes a small, explicit API. No Node.js, no Resolve object and no secret
// ever reaches the renderer.

const { contextBridge, ipcRenderer } = require('electron/renderer');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

function subscribe(channel, callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('companion', {
    getSnapshot: () => invoke('app:getSnapshot'),
    refresh: () => invoke('app:refresh'),
    about: () => invoke('app:about'),
    openLogs: () => invoke('app:openLogs'),
    openInNotion: () => invoke('app:openInNotion'),
    openExternal: (url) => invoke('app:openExternal', url),
    openTokenHelp: () => invoke('app:openTokenHelp'),

    getSettings: () => invoke('settings:get'),
    patchSettings: (patch) => invoke('settings:patch', patch),

    saveToken: (token) => invoke('notion:saveToken', token),
    testConnection: () => invoke('notion:testConnection'),
    clearToken: () => invoke('notion:clearToken'),
    search: (query, cursor) => invoke('notion:search', query, cursor),
    parents: (refs) => invoke('notion:parents', refs),

    associate: (pageId) => invoke('assoc:set', pageId),
    associateForKey: (key, pageId) => invoke('assoc:setForKey', key, pageId),
    adoptSuggestion: () => invoke('assoc:adoptSuggestion'),
    dismissSuggestion: () => invoke('assoc:dismissSuggestion'),
    dissociate: () => invoke('assoc:dissociate'),
    removeAssociation: (key) => invoke('assoc:remove', key),
    listAssociations: () => invoke('assoc:list'),

    clearCache: () => invoke('cache:clear'),
    cacheStats: () => invoke('cache:stats'),

    onState: (cb) => subscribe('state', cb),
    onContent: (cb) => subscribe('content', cb),
    onSettings: (cb) => subscribe('settings', cb),
});
