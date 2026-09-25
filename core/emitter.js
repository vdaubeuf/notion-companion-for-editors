'use strict';

// Minimal event emitter (Node's 'events' module is not available in UXP).

class Emitter {
    constructor() {
        this._listeners = {};
    }

    on(name, fn) {
        (this._listeners[name] = this._listeners[name] || []).push(fn);
        return this;
    }

    off(name, fn) {
        this._listeners[name] = (this._listeners[name] || []).filter((f) => f !== fn);
        return this;
    }

    emit(name, ...args) {
        for (const fn of (this._listeners[name] || []).slice()) {
            try {
                fn(...args);
            } catch (e) {
                // A faulty listener must never break the emitter's caller.
                console.error(`[emitter] listener for "${name}" failed`, e);
            }
        }
    }
}

module.exports = { Emitter };
