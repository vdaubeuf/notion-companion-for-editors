'use strict';

// Storage backend for core/storage on top of UXP's plugin data folder
// (require('uxp').storage.localFileSystem.getDataFolder()):
//   macOS:   ~/Library/Application Support/Adobe/UXP/PluginsStorage/PPRO/<ver>/External/<plugin id>/PluginData/
//   Windows: %APPDATA%\Adobe\UXP\PluginsStorage\PPRO\<ver>\External\<plugin id>\PluginData\
// The folder is flat: "cache/<id>.json" is stored as "cache__<id>.json".

const SEP = '__';

function createUxpBackend(uxp) {
    const { localFileSystem, formats } = uxp.storage;
    let folderPromise = null;
    const folder = () => (folderPromise = folderPromise || localFileSystem.getDataFolder());
    const toFile = (name) => String(name).split('/').join(SEP);
    const fromFile = (file) => file.split(SEP).join('/');

    async function entry(name) {
        try {
            return await (await folder()).getEntry(toFile(name));
        } catch (_) {
            return null;
        }
    }

    return {
        async nativePath() {
            return (await folder()).nativePath;
        },
        async read(name) {
            const e = await entry(name);
            if (!e) return null;
            return e.read({ format: formats.utf8 });
        },
        async write(name, text) {
            const f = await (await folder()).createFile(toFile(name), { overwrite: true });
            await f.write(text, { format: formats.utf8 });
        },
        async remove(name) {
            const e = await entry(name);
            if (e) await e.delete();
        },
        async list(prefix) {
            const p = toFile(prefix);
            const entries = await (await folder()).getEntries();
            const out = [];
            for (const e of entries) {
                if (!e.isFile || !e.name.startsWith(p)) continue;
                let size = 0;
                let mtime = 0;
                try {
                    const meta = await e.getMetadata();
                    size = meta.size || 0;
                    mtime = meta.dateModified ? new Date(meta.dateModified).getTime() : 0;
                } catch (_) { /* metadata is optional */ }
                out.push({ name: fromFile(e.name), size, mtime });
            }
            return out;
        },
    };
}

// Log sink: UXP has no append API, so recent lines are kept in memory and the
// file is rewritten at most every 2 s (bounded size).
function createBufferedLogSink(backend, { name = 'logs/companion.log', maxLines = 1500 } = {}) {
    let lines = [];
    let dirty = false;
    let timer = null;
    let ready = backend.read(name).then((text) => {
        if (text) lines = text.split('\n').filter(Boolean).slice(-maxLines).concat(lines);
    }).catch(() => {});

    const flush = () => {
        timer = null;
        if (!dirty) return;
        dirty = false;
        ready = ready.then(() => backend.write(name, `${lines.join('\n')}\n`)).catch(() => {});
    };

    return (line) => {
        lines.push(line);
        if (lines.length > maxLines) lines = lines.slice(-maxLines);
        dirty = true;
        if (!timer) timer = setTimeout(flush, 2000);
    };
}

module.exports = { createUxpBackend, createBufferedLogSink };
