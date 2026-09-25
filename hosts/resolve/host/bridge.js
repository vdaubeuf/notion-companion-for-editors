'use strict';

// Thin wrapper around Blackmagic's WorkflowIntegration.node module.
//
// Only functions documented in
//   Developer/Workflow Integrations/README.txt (WorkflowIntegration module API)
//   Developer/Scripting/DaVinciResolveScript.pyi (Resolve / ProjectManager / Project / Timeline)
// of DaVinci Resolve Studio 21.1 are used here. We use the promise flavour
// (InitializePromise / GetResolvePromise, available since Resolve 20.1) so a
// slow Resolve never blocks Electron's main process.

const path = require('path');
const fs = require('fs');

class ResolveError extends Error {
    constructor(code, message) {
        super(message || code);
        this.name = 'ResolveError';
        this.code = code;
    }
}

function withTimeout(promise, ms, code) {
    let timer;
    return Promise.race([
        promise,
        new Promise((_, reject) => { timer = setTimeout(() => reject(new ResolveError(code, `timeout after ${ms}ms`)), ms); }),
    ]).finally(() => clearTimeout(timer));
}

class ResolveBridge {
    constructor({ pluginId, pluginRoot, apiTimeoutS, log }) {
        this.pluginId = pluginId;
        this.modulePath = path.join(pluginRoot, 'WorkflowIntegration.node');
        this.apiTimeoutS = apiTimeoutS;
        this.log = log;
        this.wi = null;
        this.initialized = false;
        this.resolve = null;
        this.connecting = null;
        this.moduleError = null;
    }

    loadModule() {
        if (this.wi || this.moduleError) return;
        if (!fs.existsSync(this.modulePath)) {
            this.moduleError = new ResolveError('module_missing', `WorkflowIntegration.node not found at ${this.modulePath}`);
            this.log.error(this.moduleError.message);
            return;
        }
        try {
            this.wi = require(this.modulePath);
            const info = typeof this.wi.GetInfo === 'function' ? this.wi.GetInfo() : null;
            this.log.info('WorkflowIntegration module loaded', info);
        } catch (e) {
            this.moduleError = new ResolveError('module_load_failed', e.message);
            this.log.error('Cannot load WorkflowIntegration.node', e);
        }
    }

    get available() {
        return !!this.wi;
    }

    // Returns the (promise-flavoured) Resolve object, connecting if needed.
    async getResolve() {
        if (this.resolve) return this.resolve;
        if (this.connecting) return this.connecting;
        this.connecting = this._connect().finally(() => { this.connecting = null; });
        return this.connecting;
    }

    async _connect() {
        this.loadModule();
        if (!this.wi) throw this.moduleError || new ResolveError('module_missing');

        if (!this.initialized) {
            // InitializePromise fulfils with true/false (README: "Fulfills upon successful initialization with true, false otherwise").
            const ok = await withTimeout(Promise.resolve(this.wi.InitializePromise(this.pluginId)), 15000, 'init_timeout');
            if (!ok) throw new ResolveError('init_failed', 'WorkflowIntegration.InitializePromise returned false');
            this.initialized = true;
            try {
                // "By default, apis dont timeout." We enable one so a stuck call cannot freeze polling forever.
                this.wi.SetAPITimeout(this.apiTimeoutS);
            } catch (e) {
                this.log.warn('SetAPITimeout failed', e.message);
            }
        }

        const resolve = await withTimeout(Promise.resolve(this.wi.GetResolvePromise()), 15000, 'resolve_timeout');
        if (!resolve) throw new ResolveError('no_resolve', 'GetResolvePromise returned no object');
        this.resolve = resolve;
        this.log.info('Connected to Resolve');
        return resolve;
    }

    // Drop cached objects after an API failure so the next call reconnects.
    invalidate() {
        this.resolve = null;
    }

    registerCallback(name, fn) {
        if (!this.wi || !this.initialized) return false;
        try {
            return !!this.wi.RegisterCallback(name, fn);
        } catch (e) {
            this.log.warn(`RegisterCallback(${name}) failed`, e.message);
            return false;
        }
    }

    cleanup() {
        if (!this.wi || !this.initialized) return;
        try {
            this.wi.CleanUp();
        } catch (e) {
            this.log.warn('CleanUp failed', e.message);
        }
        this.initialized = false;
        this.resolve = null;
    }
}

module.exports = { ResolveBridge, ResolveError };
