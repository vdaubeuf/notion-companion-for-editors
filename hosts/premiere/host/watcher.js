'use strict';

// Watches the active Premiere Pro project through the public UXP API
// (require('premierepro'), Premiere 25.6+):
//   Project.getActiveProject() -> { guid, name, path }, project.getActiveSequence()
//   EventManager.addGlobalEventListener(Constants.ProjectEvent.OPENED | ACTIVATED | CLOSED, …)
// Events trigger an immediate check. A light 2 s poll is kept as a safety net:
// switching between two already-open projects did not always fire an event
// during the inspection (Premiere 26.5.1).

const { Emitter } = require('core/emitter');
const { premiereIdentity } = require('core/identity');

class PremiereWatcher extends Emitter {
    constructor({ ppro, version, intervalMs = 2000, log }) {
        super();
        this.ppro = ppro;
        this.intervalMs = intervalMs;
        this.log = log;
        this.timer = null;
        this.running = false;
        this.inFlight = false;
        this.again = false;
        this.state = { status: 'connecting', project: null, version: version || null, uidSupported: null };
        this.lastSignature = null;
        this.failures = 0;
    }

    start() {
        if (this.running) return;
        this.running = true;
        const events = this.ppro.Constants && this.ppro.Constants.ProjectEvent;
        const em = this.ppro.EventManager;
        if (events && em && typeof em.addGlobalEventListener === 'function') {
            for (const k of ['OPENED', 'ACTIVATED', 'CLOSED']) {
                if (!events[k]) continue;
                try {
                    em.addGlobalEventListener(events[k], () => this.pollNow(), false);
                } catch (e) {
                    this.log.warn(`Cannot listen to ProjectEvent.${k}`, e.message);
                }
            }
        }
        this._schedule(0);
    }

    stop() {
        this.running = false;
        clearTimeout(this.timer);
    }

    async pollNow() {
        if (this.inFlight) { this.again = true; return; }
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
        try {
            this._publish(await this._snapshot());
            this.failures = 0;
        } catch (e) {
            this.failures += 1;
            if (this.failures === 1 || this.failures % 30 === 0) this.log.warn(`Premiere poll failed (${this.failures}x)`, e && e.message);
            this._publish({ status: 'unavailable', project: null });
        } finally {
            this.inFlight = false;
            if (this.again) { this.again = false; this._schedule(0); } else this._schedule(this.intervalMs);
        }
    }

    async _snapshot() {
        const project = await this.ppro.Project.getActiveProject();
        if (!project) return { status: 'no_project', project: null };

        const uid = project.guid ? String(project.guid) : null;
        if (this.state.uidSupported === null) {
            this.state.uidSupported = !!uid;
            this.log.info(`Project.guid ${uid ? 'available' : 'unavailable'} — strategy: ${uid ? 'uid' : 'path'}`);
        }

        let timeline = null;
        try {
            const seq = await project.getActiveSequence();
            if (seq && seq.name) timeline = String(seq.name);
        } catch (_) { /* no active sequence */ }

        const identity = premiereIdentity({ name: project.name, uid, path: project.path });
        return { status: 'ok', project: { ...identity, timeline } };
    }

    _publish(snapshot) {
        const p = snapshot.project;
        const signature = JSON.stringify([snapshot.status, p && p.key, p && p.name, p && p.timeline, p && p.location.key]);
        if (signature === this.lastSignature) return;
        this.lastSignature = signature;
        this.state = { ...this.state, status: snapshot.status, project: p || null };
        this.emit('change', this.state);
    }
}

module.exports = { PremiereWatcher };
