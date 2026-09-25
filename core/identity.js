'use strict';

// Host-agnostic project identity (pure functions, unit-tested).
//
// Each host adapter describes the active project with:
//   uid        stable unique id when the host exposes one
//                Resolve:  Project.GetUniqueId()
//                Premiere: Project.guid
//   name       display name
//   fallbackKey key used when there is no uid
//                Resolve:  "name:<dbType>|<dbName>|<projectName>"
//                Premiere: "path:<absolute .prproj path>"
//   location   { key, label } where the project lives
//                Resolve:  database (type|name), label "db · folder"
//                Premiere: .prproj path, label = folder
//   exactLocation true when location.key identifies one single project (a file path):
//                the same location is then a safe match even if the uid changed.

function clean(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function buildIdentity({ host, uid, name, fallbackKey, location, exactLocation = false }) {
    const id = clean(uid) || null;
    const loc = { key: clean(location && location.key), label: clean(location && location.label) || null };
    return {
        host,
        key: id ? `uid:${id}` : fallbackKey,
        strategy: id ? 'uid' : 'fallback',
        uid: id,
        name: clean(name),
        location: loc,
        exactLocation: !!exactLocation,
    };
}

// Locations compatible for a same-name match. An unknown location on either side
// is not treated as a mismatch.
function compatibleLocation(a, b) {
    const x = clean(a && a.key);
    const y = clean(b && b.key);
    if (!x || !y) return true;
    return x === y;
}

// ---------- Resolve helpers

function resolveDatabase(db) {
    if (!db || typeof db !== 'object') return { type: '', name: '' };
    return { type: clean(db.DbType ?? db.type), name: clean(db.DbName ?? db.name) };
}

function resolveIdentity({ name, uid, database, folder }) {
    const db = resolveDatabase(database);
    const projectName = clean(name);
    return buildIdentity({
        host: 'resolve',
        uid,
        name: projectName,
        fallbackKey: `name:${db.type}|${db.name}|${projectName}`,
        location: {
            key: db.name ? `${db.type}|${db.name}` : '',
            label: [db.name, clean(folder)].filter(Boolean).join(' · '),
        },
    });
}

// ---------- Premiere helpers

function premiereIdentity({ name, uid, path }) {
    const p = clean(path);
    const display = clean(name).replace(/\.prproj$/i, '');
    const folder = p ? p.replace(/[\\/][^\\/]*$/, '') : '';
    return buildIdentity({
        host: 'premiere',
        uid,
        name: display,
        fallbackKey: `path:${p || display}`,
        location: { key: p, label: folder },
        exactLocation: !!p,
    });
}

module.exports = { buildIdentity, compatibleLocation, resolveIdentity, premiereIdentity, resolveDatabase };
