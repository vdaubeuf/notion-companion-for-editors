'use strict';

// Small versioned JSON document on top of a host storage backend.
//
// Backend interface (implemented per host):
//   read(name)        -> Promise<string|null>
//   write(name, text) -> Promise<void>   (atomic where the platform allows it)
//   remove(name)      -> Promise<void>
//   list(prefix)      -> Promise<Array<{ name, size, mtime }>>
//
// - load() once at startup; afterwards get()/update() are synchronous and
//   writes are queued (serialized) in the background. flush() waits for them.
// - a corrupt document is copied aside (<name>.corrupt-<timestamp>) instead of being lost
// - `schemaVersion` + ordered migrations make format changes painless

class JsonStore {
    /**
     * @param {object} backend
     * @param {string} name
     * @param {{ version: number, defaults: () => object, migrations?: Record<number, (data: object) => object>, log?: object }} opts
     *   migrations[n] upgrades data from version n-1 to version n.
     */
    constructor(backend, name, { version, defaults, migrations = {}, log }) {
        this.backend = backend;
        this.name = name;
        this.version = version;
        this.defaults = defaults;
        this.migrations = migrations;
        this.log = log;
        this.data = null;
        this.queue = Promise.resolve();
    }

    _fresh() {
        return { ...this.defaults(), schemaVersion: this.version };
    }

    async load() {
        let raw = null;
        try {
            raw = await this.backend.read(this.name);
        } catch (e) {
            this.log && this.log.warn(`Cannot read ${this.name}`, e.message);
        }
        if (raw === null || raw === undefined || raw === '') {
            this.data = this._fresh();
            return this.data;
        }

        let parsed;
        try {
            parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
        } catch (e) {
            const aside = `${this.name}.corrupt-${Date.now()}`;
            try { await this.backend.write(aside, raw); } catch (_) { /* ignore */ }
            this.log && this.log.error(`Corrupt JSON in ${this.name}, copied to ${aside}`, e.message);
            this.data = this._fresh();
            this.save();
            return this.data;
        }

        this.data = this._migrate(parsed);
        return this.data;
    }

    _migrate(data) {
        let v = Number.isInteger(data.schemaVersion) ? data.schemaVersion : 0;
        if (v > this.version) {
            // Written by a newer plugin version: use as-is, never downgrade.
            this.log && this.log.warn(`${this.name} has schemaVersion ${v} > ${this.version}; using as-is`);
            return data;
        }
        const from = v;
        while (v < this.version) {
            const step = this.migrations[v + 1];
            data = step ? step(data) : data;
            v += 1;
            data.schemaVersion = v;
        }
        if (v !== from) {
            this.data = data;
            this.log && this.log.info(`${this.name} migrated from schema ${from} to ${v}`);
            this.save();
        }
        return data;
    }

    get() {
        if (!this.data) throw new Error(`${this.name} used before load()`);
        return this.data;
    }

    save() {
        const text = JSON.stringify(this.data, null, 2);
        this.queue = this.queue
            .then(() => this.backend.write(this.name, text))
            .catch((e) => { this.log && this.log.error(`Cannot write ${this.name}`, e.message); });
        return this.queue;
    }

    update(mutator) {
        const data = this.get();
        mutator(data);
        this.save();
        return data;
    }

    flush() {
        return this.queue;
    }
}

module.exports = { JsonStore };
