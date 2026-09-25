'use strict';

// Storage backend for core/storage on top of Node's fs (Electron main process).
// Names may contain "/" (e.g. "cache/<id>.json"): they map to sub-folders of `root`.

const fs = require('fs');
const path = require('path');

function createFsBackend(root) {
    const full = (name) => {
        const p = path.resolve(root, name);
        if (!p.startsWith(path.resolve(root) + path.sep)) throw new Error('path outside storage root');
        return p;
    };

    return {
        async read(name) {
            try {
                return fs.readFileSync(full(name), 'utf8');
            } catch (e) {
                if (e.code === 'ENOENT') return null;
                throw e;
            }
        },
        async write(name, text) {
            const file = full(name);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            // Atomic: temp file + rename, so a crash never leaves a half-written file.
            const tmp = `${file}.${process.pid}.tmp`;
            fs.writeFileSync(tmp, text, { encoding: 'utf8', mode: 0o600 });
            fs.renameSync(tmp, file);
        },
        async remove(name) {
            try { fs.unlinkSync(full(name)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
        },
        // prefix "cache/" lists the files of the "cache" folder; "cache/ab" those starting with "ab".
        async list(prefix) {
            const slash = prefix.lastIndexOf('/');
            const dirRel = slash >= 0 ? prefix.slice(0, slash) : '';
            const namePrefix = prefix.slice(slash + 1);
            const folder = dirRel ? full(dirRel) : path.resolve(root);
            let names = [];
            try { names = fs.readdirSync(folder); } catch (_) { return []; }
            return names.filter((n) => n.startsWith(namePrefix)).map((n) => {
                try {
                    const st = fs.statSync(path.join(folder, n));
                    return st.isFile() ? { name: dirRel ? `${dirRel}/${n}` : n, size: st.size, mtime: st.mtimeMs } : null;
                } catch (_) {
                    return null;
                }
            }).filter(Boolean);
        },
    };
}

module.exports = { createFsBackend };
