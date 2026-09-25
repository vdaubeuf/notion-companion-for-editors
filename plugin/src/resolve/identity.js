'use strict';

// Project identification strategy (pure functions, unit-tested).
//
// Primary:  Project.GetUniqueId()  — documented in DaVinciResolveScript.pyi of
//           Resolve 21.1 ("Returns a unique ID for the project item"). Used only
//           if the method exists and returns a non-empty string (feature detection).
// Fallback: database type + database name + project name.
//           ProjectManager.GetCurrentFolder() is recorded as information only:
//           it returns the folder currently *browsed* in the Project Manager,
//           which can change without the project changing, so it is not part of
//           the key.

function clean(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeDb(db) {
    if (!db || typeof db !== 'object') return { type: '', name: '' };
    return { type: clean(db.DbType ?? db.type), name: clean(db.DbName ?? db.name) };
}

function fallbackKey(db, projectName) {
    const d = normalizeDb(db);
    return `name:${d.type}|${d.name}|${clean(projectName)}`;
}

// snapshot: { name, uid, database, folder, timeline }
function buildIdentity(snapshot) {
    const name = clean(snapshot.name);
    const uid = clean(snapshot.uid) || null;
    const database = normalizeDb(snapshot.database);
    return {
        key: uid ? `uid:${uid}` : fallbackKey(database, name),
        strategy: uid ? 'uid' : 'fallback',
        uid,
        name,
        database,
        folder: clean(snapshot.folder) || null,
    };
}

function sameDatabase(a, b) {
    const x = normalizeDb(a);
    const y = normalizeDb(b);
    // An unknown database on either side is not treated as a mismatch.
    if (!x.name || !y.name) return true;
    return x.type === y.type && x.name === y.name;
}

module.exports = { buildIdentity, fallbackKey, sameDatabase, normalizeDb };
