'use strict';

// Watches the project currently open in Resolve.
//
// Resolve does not expose a "project changed" event to Workflow Integrations
// (supported callbacks: RenderStart, RenderStop, ResolveQuit), so we poll with a
// light, non-overlapping loop: one tick every POLL_INTERVAL_MS, never two ticks
// in flight, slower when Resolve is unreachable.

const { Emitter } = require('core/emitter');
const { resolveIdentity } = require('core/identity');

async function safeCall(obj, method, ...args) {
    if (!obj || typeof obj[method] !== 'function') return { ok: false, missing: true };
    try {
        return { ok: true, value: await obj[method](...args) };
    } catch (e) {
        return { ok: false, error: e };
    }
}

class ProjectWatcher extends Emitter {
    constructor({ bridge, intervalMs, unavailableIntervalMs, log }) {
        super();
        this.bridge = bridge;
        this.intervalMs = intervalMs;
        this.unavailableIntervalMs = unavailableIntervalMs;
        this.log = log;
        this.timer = null;
        this.running = false;
        this.inFlight = false;
        this.state = { status: 'connecting', project: null, version: null, uidSupported: null };
        this.lastSignature = null;
        this.dbCache = null; // { projectRef, database, folder }
        this.failures = 0;
    }

    start() {
        if (this.running) return;
        this.running = true;
        this._schedule(0);
    }

    stop() {
        this.running = false;
        clearTimeout(this.timer);
        this.timer = null;
    }

    // Force an immediate check (e.g. "Refresh" button).
    async pollNow() {
        clearTimeout(this.timer);
        await this._tick();
    }

    _schedule(ms) {
        if (!this.running) return;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this._tick(), ms);
    }

    async _tick() {
        if (this.inFlight) return;
        this.inFlight = true;
        let next = this.intervalMs;
        try {
            const snapshot = await this._snapshot();
            this.failures = 0;
            this._publish(snapshot);
        } catch (e) {
            this.failures += 1;
            this.bridge.invalidate();
            const code = e && e.code ? e.code : 'resolve_unavailable';
            if (this.failures === 1 || this.failures % 20 === 0) {
                this.log.warn(`Resolve poll failed (${this.failures}x)`, code, e && e.message);
            }
            const status = (code === 'module_missing' || code === 'module_load_failed') ? code : 'unavailable';
            this._publish({ status, project: null });
            next = this.unavailableIntervalMs;
        } finally {
            this.inFlight = false;
            this._schedule(next);
        }
    }

    async _snapshot() {
        const resolve = await this.bridge.getResolve();

        if (!this.state.version) {
            const v = await safeCall(resolve, 'GetVersionString');
            if (v.ok && v.value) this.state.version = String(v.value);
        }

        const pm = await safeCall(resolve, 'GetProjectManager');
        if (!pm.ok) throw pm.error || new Error('GetProjectManager unavailable');
        if (!pm.value) return { status: 'no_project', project: null };

        const proj = await safeCall(pm.value, 'GetCurrentProject');
        if (!proj.ok) throw proj.error || new Error('GetCurrentProject unavailable');
        const project = proj.value;
        if (!project) return { status: 'no_project', project: null };

        const nameRes = await safeCall(project, 'GetName');
        if (!nameRes.ok) throw nameRes.error || new Error('GetName unavailable');
        const name = nameRes.value ? String(nameRes.value) : '';
        if (!name) return { status: 'no_project', project: null };

        // Feature detection for Project.GetUniqueId().
        const uidRes = await safeCall(project, 'GetUniqueId');
        const uid = uidRes.ok && uidRes.value ? String(uidRes.value) : null;
        if (this.state.uidSupported === null) {
            this.state.uidSupported = !!uid;
            this.log.info(`Project.GetUniqueId ${uid ? 'available' : `unavailable (${uidRes.missing ? 'method missing' : 'empty/failed'})`} — strategy: ${uid ? 'uid' : 'fallback'}`);
        }

        // Database/folder rarely change: only query them when the project changes.
        const ref = `${uid || ''}\u0000${name}`;
        if (!this.dbCache || this.dbCache.ref !== ref) {
            const db = await safeCall(pm.value, 'GetCurrentDatabase');
            const folder = await safeCall(pm.value, 'GetCurrentFolder');
            this.dbCache = {
                ref,
                database: db.ok && db.value ? db.value : null,
                folder: folder.ok && folder.value ? String(folder.value) : null,
            };
        }

        let timeline = null;
        const tl = await safeCall(project, 'GetCurrentTimeline');
        if (tl.ok && tl.value) {
            const tlName = await safeCall(tl.value, 'GetName');
            if (tlName.ok && tlName.value) timeline = String(tlName.value);
        }

        const identity = resolveIdentity({
            name,
            uid,
            database: this.dbCache.database,
            folder: this.dbCache.folder,
        });
        return { status: 'ok', project: { ...identity, timeline } };
    }

    _publish(snapshot) {
        const p = snapshot.project;
        const signature = JSON.stringify([snapshot.status, p && p.key, p && p.name, p && p.timeline]);
        if (signature === this.lastSignature) return;
        const previousKey = this.state.project ? this.state.project.key : null;
        this.lastSignature = signature;
        this.state = { ...this.state, status: snapshot.status, project: p || null };
        this.emit('change', this.state, { projectChanged: previousKey !== (p ? p.key : null) });
    }
}

module.exports = { ProjectWatcher };
