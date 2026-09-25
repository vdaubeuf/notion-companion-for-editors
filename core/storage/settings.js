'use strict';

const { JsonStore } = require('./jsonStore');

const DEFAULTS = () => ({
    alwaysOnTop: false,
    // 'none' | 'left' | 'right': snap the window to a screen edge (Resolve only, see hosts/resolve/host/dock.js).
    dock: 'none',
    // 'auto': Notion desktop app when available, else browser.
    openLinksIn: 'auto',
    windowBounds: null,
});

const ALLOWED = {
    alwaysOnTop: (v) => typeof v === 'boolean',
    dock: (v) => ['none', 'left', 'right'].includes(v),
    openLinksIn: (v) => ['auto', 'app', 'browser'].includes(v),
};

class SettingsStore {
    constructor(backend, log) {
        this.store = new JsonStore(backend, 'settings.json', { version: 1, defaults: DEFAULTS, log });
    }

    load() {
        return this.store.load();
    }

    get() {
        return { ...DEFAULTS(), ...this.store.get() };
    }

    // Only whitelisted, type-checked keys can be changed from the UI.
    patch(partial) {
        const clean = {};
        for (const [k, v] of Object.entries(partial || {})) {
            if (ALLOWED[k] && ALLOWED[k](v)) clean[k] = v;
        }
        this.store.update((d) => Object.assign(d, clean));
        return this.get();
    }

    setWindowBounds(bounds) {
        this.store.update((d) => { d.windowBounds = bounds; });
    }
}

module.exports = { SettingsStore };
