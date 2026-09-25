'use strict';

// Small versioned JSON file store.
// - atomic writes (temp file + rename) so a crash never leaves a half-written file
// - a corrupt file is moved aside (<name>.corrupt-<timestamp>) instead of being lost
// - `schemaVersion` + ordered migrations make format changes painless

const fs = require('fs');
const path = require('path');

class JsonStore {
    /**
     * @param {string} file
     * @param {{ version: number, defaults: () => object, migrations?: Record<number, (data: object) => object>, log?: object }} opts
     *   migrations[n] upgrades data from version n-1 to version n.
     */
    constructor(file, { version, defaults, migrations = {}, log }) {
        this.file = file;
        this.version = version;
        this.defaults = defaults;
        this.migrations = migrations;
        this.log = log;
        this.data = null;
    }

    load() {
        let raw = null;
        try {
            raw = fs.readFileSync(this.file, 'utf8');
        } catch (e) {
            if (e.code !== 'ENOENT') this.log && this.log.warn(`Cannot read ${this.file}`, e.message);
        }

        if (raw === null) {
            this.data = { ...this.defaults(), schemaVersion: this.version };
            return this.data;
        }

        let parsed;
        try {
            parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
        } catch (e) {
            const aside = `${this.file}.corrupt-${Date.now()}`;
            try { fs.renameSync(this.file, aside); } catch (_) { /* ignore */ }
            this.log && this.log.error(`Corrupt JSON in ${this.file}, moved to ${aside}`, e.message);
            this.data = { ...this.defaults(), schemaVersion: this.version };
            return this.data;
        }

        this.data = this._migrate(parsed);
        return this.data;
    }

    _migrate(data) {
        let v = Number.isInteger(data.schemaVersion) ? data.schemaVersion : 0;
        if (v > this.version) {
            // Written by a newer plugin version: keep it read-only-safe, do not downgrade.
            this.log && this.log.warn(`${path.basename(this.file)} has schemaVersion ${v} > ${this.version}; using as-is`);
            return data;
        }
        let migrated = false;
        while (v < this.version) {
            const step = this.migrations[v + 1];
            data = step ? step(data) : data;
            v += 1;
            data.schemaVersion = v;
            migrated = true;
        }
        if (migrated) {
            this.data = data;
            this.save();
        }
        return data;
    }

    get() {
        if (!this.data) this.load();
        return this.data;
    }

    save(data = this.data) {
        this.data = data;
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        const tmp = `${this.file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
        fs.renameSync(tmp, this.file);
    }

    update(mutator) {
        const data = this.get();
        mutator(data);
        this.save(data);
        return data;
    }
}

module.exports = { JsonStore };
