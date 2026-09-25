'use strict';

// Unit tests, executed as a tiny Electron app (works with the Electron bundled
// inside DaVinci Resolve — no Node.js installation needed). See scripts/test.sh,
// which runs scripts/build.sh first (bundles are syntax-checked here).

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const REPO = path.join(__dirname, '..');
const req = (p) => require(path.join(REPO, p));

const silentLog = { debug() {}, info() {}, warn() {}, error() {} };
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nc-test-'));

// In-memory backend with the same interface as the host backends.
function memoryBackend(initial = {}) {
    const files = { ...initial };
    return {
        files,
        async read(n) { return Object.prototype.hasOwnProperty.call(files, n) ? files[n] : null; },
        async write(n, t) { files[n] = t; },
        async remove(n) { delete files[n]; },
        async list(prefix) { return Object.keys(files).filter((n) => n.startsWith(prefix)).map((n, i) => ({ name: n, size: files[n].length, mtime: i })); },
    };
}

// ---------------------------------------------------------------- identity
const { resolveIdentity, premiereIdentity } = req('core/identity');
const DB = { DbType: 'Disk', DbName: 'Local Database' };

test('identity (Resolve): uses GetUniqueId when available', () => {
    const id = resolveIdentity({ name: 'Mon documentaire', uid: 'ABC-123', database: DB, folder: 'Docs' });
    assert.equal(id.key, 'uid:ABC-123');
    assert.equal(id.strategy, 'uid');
    assert.deepEqual(id.location, { key: 'Disk|Local Database', label: 'Local Database · Docs' });
});

test('identity (Resolve): fallback key = db + name, folder excluded', () => {
    const a = resolveIdentity({ name: 'Mon documentaire', uid: '', database: { DbType: 'Disk', DbName: 'Local' }, folder: 'A' });
    const b = resolveIdentity({ name: 'Mon documentaire', uid: null, database: { DbType: 'Disk', DbName: 'Local' }, folder: 'B' });
    assert.equal(a.key, 'name:Disk|Local|Mon documentaire');
    assert.equal(a.key, b.key);
});

test('identity (Premiere): guid, name without .prproj, path location', () => {
    const id = premiereIdentity({ name: 'Mon documentaire.prproj', uid: 'bd5c-1', path: '/Users/me/Films/Mon documentaire.prproj' });
    assert.equal(id.key, 'uid:bd5c-1');
    assert.equal(id.name, 'Mon documentaire');
    assert.equal(id.location.key, '/Users/me/Films/Mon documentaire.prproj');
    assert.equal(id.location.label, '/Users/me/Films');
    assert.equal(id.exactLocation, true);
    assert.equal(premiereIdentity({ name: 'X.prproj', uid: '', path: 'C:\\P\\X.prproj' }).key, 'path:C:\\P\\X.prproj');
});

// ---------------------------------------------------------------- associations
const { AssociationStore } = req('core/storage/associations');
const page = (id, title) => ({ id, title, url: `https://www.notion.so/${id.replace(/-/g, '')}`, icon: { type: 'emoji', emoji: '🎬' } });
const PID = '1a2b3c4d-1111-2222-3333-444455556666';
const PID2 = '9f8e7d6c-1111-2222-3333-444455556666';

async function freshStore(backend = memoryBackend()) {
    const s = new AssociationStore(backend, silentLog);
    await s.load();
    return s;
}

test('associations: set + find by uid, rename is followed and persisted', async () => {
    const backend = memoryBackend();
    const s = await freshStore(backend);
    s.set(resolveIdentity({ name: 'Mon documentaire', uid: 'U1', database: DB }), page(PID, 'Mon documentaire'));
    const r = s.find(resolveIdentity({ name: 'Mon documentaire (doc)', uid: 'U1', database: DB }));
    assert.equal(r.matchedBy, 'uid');
    assert.equal(r.match.notionPageId, PID);
    await s.flush();
    const again = await freshStore(backend);
    assert.equal(again.get('uid:U1').projectName, 'Mon documentaire (doc)');
});

test('associations (Resolve): fallback record re-keyed to uid when uid becomes available', async () => {
    const s = await freshStore();
    s.set(resolveIdentity({ name: 'Court 2026', uid: null, database: DB }), page(PID, 'Court'));
    const r = s.find(resolveIdentity({ name: 'Court 2026', uid: 'U9', database: DB }));
    assert.equal(r.match.notionPageId, PID);
    assert.equal(r.match.key, 'uid:U9');
    assert.equal(s.count(), 1);
});

test('associations (Resolve): same name but different uid -> suggestion only', async () => {
    const s = await freshStore();
    s.set(resolveIdentity({ name: 'Test', uid: 'U1', database: DB }), page(PID, 'Notes test'));
    const r = s.find(resolveIdentity({ name: 'Test', uid: 'U2', database: DB }));
    assert.equal(r.match, null);
    assert.equal(r.suggestion.notionPageId, PID);
});

test('associations (Resolve): other database -> no match, no suggestion', async () => {
    const s = await freshStore();
    s.set(resolveIdentity({ name: 'Test', uid: 'U1', database: DB }), page(PID, 'Notes'));
    const r = s.find(resolveIdentity({ name: 'Test', uid: 'U2', database: { DbType: 'PostgreSQL', DbName: 'Studio' } }));
    assert.equal(r.match, null);
    assert.equal(r.suggestion, null);
});

test('associations (Premiere): same file with a new guid -> match and re-key', async () => {
    const s = await freshStore();
    s.set(premiereIdentity({ name: 'Doc.prproj', uid: 'G1', path: '/p/Doc.prproj' }), page(PID, 'Doc'));
    const r = s.find(premiereIdentity({ name: 'Doc.prproj', uid: 'G2', path: '/p/Doc.prproj' }));
    assert.equal(r.matchedBy, 'location');
    assert.equal(r.match.key, 'uid:G2');
    assert.equal(s.count(), 1);
});

test('associations (Premiere): same name in another folder -> suggestion only', async () => {
    const s = await freshStore();
    s.set(premiereIdentity({ name: 'Doc.prproj', uid: 'G1', path: '/p/Doc.prproj' }), page(PID, 'Doc'));
    const r = s.find(premiereIdentity({ name: 'Doc.prproj', uid: 'G3', path: '/backup/Doc.prproj' }));
    assert.equal(r.match, null);
    assert.equal(r.suggestion.notionPageId, PID);
});

test('associations: hosts are isolated (Resolve record never matches Premiere)', async () => {
    const s = await freshStore();
    s.set(resolveIdentity({ name: 'Doc', uid: 'U1', database: DB }), page(PID, 'Doc'));
    const r = s.find(premiereIdentity({ name: 'Doc.prproj', uid: 'G1', path: '/p/Doc.prproj' }));
    assert.equal(r.match, null);
    assert.equal(r.suggestion, null);
});

test('associations: setPage, refreshPageInfo, remove', async () => {
    const s = await freshStore();
    s.set(resolveIdentity({ name: 'P', uid: 'U1', database: DB }), page(PID, 'Old'));
    s.setPage('uid:U1', page(PID2, 'New'));
    assert.equal(s.get('uid:U1').notionPageId, PID2);
    s.refreshPageInfo(PID2, page(PID2, 'Renamed'));
    assert.equal(s.get('uid:U1').notionPageTitle, 'Renamed');
    assert.equal(s.remove('uid:U1'), true);
    assert.equal(s.count(), 0);
});

test('associations: migrates v1 (0.1.0 Resolve format) to v2 without losing data', async () => {
    const v1 = {
        schemaVersion: 1,
        associations: {
            'uid:a1b2c3d4': {
                key: 'uid:a1b2c3d4', resolveProjectUid: 'a1b2c3d4', resolveProjectName: 'Documentaire Studio',
                resolveDatabase: { type: 'PostgreSQL', name: 'db_studio' }, resolveFolder: null,
                notionPageId: PID, notionPageTitle: 'Notes du documentaire', notionPageUrl: 'https://www.notion.so/x', notionPageIcon: null,
                createdAt: '2026-09-25T12:55:01.000Z', updatedAt: '2026-09-25T12:55:01.000Z',
            },
        },
    };
    const backend = memoryBackend({ 'associations.json': JSON.stringify(v1) });
    const s = await freshStore(backend);
    const a = s.get('uid:a1b2c3d4');
    assert.equal(a.host, 'resolve');
    assert.equal(a.projectUid, 'a1b2c3d4');
    assert.equal(a.projectName, 'Documentaire Studio');
    assert.deepEqual(a.location, { key: 'PostgreSQL|db_studio', label: 'db_studio' });
    assert.equal(a.notionPageTitle, 'Notes du documentaire');
    const r = s.find(resolveIdentity({ name: 'Documentaire Studio', uid: 'a1b2c3d4', database: { DbType: 'PostgreSQL', DbName: 'db_studio' } }));
    assert.equal(r.matchedBy, 'uid');
    await s.flush();
    assert.equal(JSON.parse(backend.files['associations.json']).schemaVersion, 2);
});

test('associations: migrates v0 flat format', async () => {
    const backend = memoryBackend({ 'associations.json': JSON.stringify({ 'uid:X': { resolveProjectName: 'Mon documentaire', notionPageId: PID, notionPageTitle: 'Mon documentaire' } }) });
    const s = await freshStore(backend);
    assert.equal(s.count(), 1);
    assert.equal(s.get('uid:X').projectName, 'Mon documentaire');
});

// ---------------------------------------------------------------- json store / cache / fs backend
const { JsonStore } = req('core/storage/jsonStore');
const { PageCache } = req('core/storage/cache');
const { createFsBackend } = req('hosts/resolve/host/fsBackend');

test('jsonStore: corrupt document is copied aside, defaults used', async () => {
    const backend = memoryBackend({ 's.json': '{not json' });
    const s = new JsonStore(backend, 's.json', { version: 1, defaults: () => ({ a: 1 }), log: silentLog });
    assert.equal((await s.load()).a, 1);
    assert.ok(Object.keys(backend.files).some((n) => n.startsWith('s.json.corrupt-')));
});

test('fsBackend: read/write/list/remove with sub-folders, stays inside root', async () => {
    const root = tmpDir();
    const b = createFsBackend(root);
    assert.equal(await b.read('none.json'), null);
    await b.write('cache/abc.json', '{}');
    await b.write('settings.json', '{"x":1}');
    assert.equal(await b.read('settings.json'), '{"x":1}');
    const listed = await b.list('cache/');
    assert.deepEqual(listed.map((e) => e.name), ['cache/abc.json']);
    await b.remove('cache/abc.json');
    assert.deepEqual(await b.list('cache/'), []);
    await assert.rejects(b.write('../escape.json', 'x'));
});

test('cache: put/get/prune/clear', async () => {
    const backend = memoryBackend();
    const c = new PageCache(backend, { maxPages: 2, log: silentLog });
    const ids = ['11111111111111111111111111111111', '22222222222222222222222222222222', '33333333333333333333333333333333'];
    for (const id of ids) await c.put(id, { page: { id }, blocks: [] });
    assert.equal((await c.stats()).pages, 2);
    assert.equal((await c.get(ids[2])).page.id, ids[2]);
    await c.clear();
    assert.equal((await c.stats()).pages, 0);
});

// ---------------------------------------------------------------- secrets
const { SecretStore } = req('core/storage/secrets');

test('secrets: load/set/clear through provider, refuses without secure storage', async () => {
    let stored = 'ntn_previous_token_1234567890';
    const provider = { available: () => true, load: async () => stored, save: async (t) => { stored = t; }, clear: async () => { stored = null; } };
    const changes = [];
    const s = new SecretStore(provider, silentLog, { onChange: (t) => changes.push(t) });
    await s.load();
    assert.equal(s.getToken(), 'ntn_previous_token_1234567890');
    await s.setToken('ntn_new_token_abcdefghijklmnop');
    assert.equal(stored, 'ntn_new_token_abcdefghijklmnop');
    await s.clearToken();
    assert.equal(s.hasToken(), false);
    assert.deepEqual(changes.slice(-1), [null]);
    const none = new SecretStore({ ...provider, available: () => false }, silentLog);
    await assert.rejects(none.setToken('ntn_x_abcdefghijklmnopqrstu'), (e) => e.code === 'encryption_unavailable');
});

// ---------------------------------------------------------------- blocks
const { normalizeBlock, normalizeRichText, safeHref } = req('core/notion/blocks');

test('blocks: rich text annotations and links', () => {
    const r = normalizeRichText([
        { type: 'text', plain_text: 'Gras', annotations: { bold: true, color: 'default' }, href: null },
        { type: 'text', plain_text: 'lien', annotations: { italic: true, color: 'red' }, href: 'https://example.com' },
        { type: 'text', plain_text: 'bad', annotations: {}, href: 'javascript:alert(1)' },
    ]);
    assert.deepEqual(r[0], { t: 'Gras', b: 1 });
    assert.equal(r[1].href, 'https://example.com/');
    assert.equal(r[2].href, undefined);
    assert.equal(safeHref('/abc'), 'https://www.notion.so/abc');
});

test('blocks: to_do, heading toggle, child_page not recursed, unsupported', () => {
    const todo = normalizeBlock({ object: 'block', id: PID, type: 'to_do', has_children: false, to_do: { rich_text: [], checked: true } });
    assert.equal(todo.checked, true);
    const hd = normalizeBlock({ object: 'block', id: PID, type: 'heading_2', has_children: true, heading_2: { rich_text: [], is_toggleable: true } });
    assert.equal(hd.toggleable, true);
    const cp = normalizeBlock({ object: 'block', id: PID, type: 'child_page', has_children: true, child_page: { title: 'Sous-page' } });
    assert.equal(cp.hasChildren, false);
    const un = normalizeBlock({ object: 'block', id: PID, type: 'unsupported', unsupported: { block_type: 'ai_block' } });
    assert.equal(un.originalType, 'ai_block');
});

test('blocks: media keeps only https urls', () => {
    const img = normalizeBlock({ object: 'block', id: PID, type: 'image', image: { type: 'external', external: { url: 'http://insecure/x.png' }, caption: [] } });
    assert.equal(img.url, null);
});

// ---------------------------------------------------------------- pages / client / loader
const { extractTitle, summarizePage, searchPages } = req('core/notion/pages');
const { NotionClient } = req('core/notion/client');
const { loadPageContent } = req('core/notion/loader');

test('pages: title extraction and summary', () => {
    const p = { object: 'page', id: PID.replace(/-/g, ''), properties: { Nom: { type: 'title', title: [{ plain_text: 'Mon ' }, { plain_text: 'documentaire' }] } }, parent: { type: 'page_id', page_id: PID2 }, url: 'https://www.notion.so/x', icon: { type: 'emoji', emoji: '🎬' } };
    assert.equal(extractTitle(p), 'Mon documentaire');
    assert.deepEqual(summarizePage(p).parent, { type: 'page_id', id: PID2 });
});

test('pages: search sends page filter and drops trashed results', async () => {
    let sent;
    const client = { request: async (m, p, o) => { sent = o; return { results: [
        { object: 'page', id: PID, properties: {}, in_trash: false },
        { object: 'page', id: PID2, properties: {}, in_trash: true },
    ], has_more: true, next_cursor: 'c2' }; } };
    const r = await searchPages(client, { query: ' Mon documentaire ' });
    assert.equal(sent.body.query, 'Mon documentaire');
    assert.equal(r.results.length, 1);
    assert.equal(r.nextCursor, 'c2');
});

function fakeResponse(status, body, headers = {}) {
    return { ok: status >= 200 && status < 300, status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, text: async () => JSON.stringify(body) };
}

function makeClient(responses, extra = {}) {
    const calls = [];
    const sleeps = [];
    const client = new NotionClient({
        getToken: () => 'ntn_testtoken_abcdefghijklmnop',
        fetchImpl: async (url, init) => { calls.push({ url, init }); const r = responses.shift(); if (r instanceof Error) throw r; return r; },
        version: '2026-03-11', baseUrl: 'https://api.notion.com/v1', log: silentLog, minIntervalMs: 0,
        sleepImpl: async (ms) => { sleeps.push(ms); },
        ...extra,
    });
    return { client, calls, sleeps };
}

test('client: headers, query string, 429 retried after Retry-After', async () => {
    const { client, calls, sleeps } = makeClient([fakeResponse(429, { code: 'rate_limited' }, { 'retry-after': '2' }), fakeResponse(200, { ok: 1 })]);
    assert.deepEqual(await client.request('GET', '/blocks/x/children', { query: { page_size: 100, start_cursor: undefined } }), { ok: 1 });
    assert.equal(calls[0].url, 'https://api.notion.com/v1/blocks/x/children?page_size=100');
    assert.equal(calls[0].init.headers['Notion-Version'], '2026-03-11');
    assert.ok(sleeps.includes(2000));
});

test('client: 401 -> unauthorized, network error retried, timeout without AbortSignal support', async () => {
    const a = makeClient([fakeResponse(401, { code: 'unauthorized' })]);
    await assert.rejects(a.client.request('GET', '/users/me'), (e) => e.code === 'unauthorized');
    const b = makeClient([new TypeError('fetch failed'), new TypeError('fetch failed'), new TypeError('fetch failed')]);
    await assert.rejects(b.client.request('GET', '/pages/x'), (e) => e.code === 'network');
    assert.equal(b.calls.length, 3);
    const c = new NotionClient({
        getToken: () => 'ntn_testtoken_abcdefghijklmnop', fetchImpl: () => new Promise(() => {}), // never settles, ignores signal
        version: 'v', baseUrl: 'https://x', log: silentLog, minIntervalMs: 0, timeoutMs: 30, maxRetries: 0, sleepImpl: async () => {},
    });
    await assert.rejects(c.request('POST', '/x', { body: {} }), (e) => e.code === 'timeout');
});

test('loader: paginates and recurses into children, skips child pages', async () => {
    const blk = (id, type, hasChildren = false, extra = {}) => ({ object: 'block', id, type, has_children: hasChildren, [type]: { rich_text: [{ plain_text: id }], ...extra } });
    const T = '00000000-0000-0000-0000-00000000000a';
    const SUB = '00000000-0000-0000-0000-00000000000b';
    const N1 = '00000000-0000-0000-0000-00000000000c';
    const routes = {
        [`/pages/${PID}`]: { object: 'page', id: PID, properties: { t: { type: 'title', title: [{ plain_text: 'Mon documentaire' }] } }, url: 'https://www.notion.so/p' },
        [`/blocks/${PID}/children|`]: { results: [blk(T, 'toggle', true)], has_more: true, next_cursor: 'c1' },
        [`/blocks/${PID}/children|c1`]: { results: [{ object: 'block', id: SUB, type: 'child_page', has_children: true, child_page: { title: 'Sous' } }], has_more: false },
        [`/blocks/${T}/children|`]: { results: [blk(N1, 'to_do', false, { checked: true })], has_more: false },
    };
    const requested = [];
    const client = { request: async (m, p, o = {}) => {
        const k = p.includes('/children') ? `${p}|${(o.query && o.query.start_cursor) || ''}` : p;
        requested.push(k);
        if (!routes[k]) throw new Error(`unexpected ${k}`);
        return routes[k];
    } };
    const r = await loadPageContent(client, PID, { maxBlocks: 100, maxDepth: 5, throttleMs: 0 });
    assert.equal(r.blocks.length, 2);
    assert.equal(r.blocks[0].children[0].checked, true);
    assert.ok(!requested.some((k) => k.startsWith(`/blocks/${SUB}`)));
});

// ---------------------------------------------------------------- operations / logger
const { validators, runOperation } = req('core/operations');
const { redact } = req('core/logger');
const { normalizeId } = req('core/notion/ids');

test('operations: validators and error envelope', async () => {
    assert.equal(normalizeId('1A2B3C4D111122223333444455556666'), PID);
    assert.throws(() => validators.token('short'));
    assert.equal(validators.token('  ntn_abcdefghijklmnopqrstuvwxyz  '), 'ntn_abcdefghijklmnopqrstuvwxyz');
    assert.equal(validators.assocKey('path:/p/Doc.prproj'), 'path:/p/Doc.prproj');
    assert.throws(() => validators.assocKey('evil'));
    const res = await runOperation({ boom: () => { throw Object.assign(new Error('x'), { code: 'network' }); } }, 'boom', [], silentLog);
    assert.deepEqual(res, { ok: false, error: { code: 'network', message: 'Impossible de contacter Notion.' } });
    assert.equal((await runOperation({}, 'constructor', [], silentLog)).ok, false);
});

test('logger: tokens are redacted', () => {
    const out = redact('Authorization: Bearer ntn_1234567890abcdef token=secret_abcdefghijk');
    assert.ok(!out.includes('ntn_1234567890abcdef') && !out.includes('secret_abcdefghijk'));
});

// ---------------------------------------------------------------- build output
test('bundles: generated scripts parse', () => {
    for (const f of ['build/resolve/renderer/ui.bundle.js', 'build/premiere/panel.bundle.js']) {
        const src = fs.readFileSync(path.join(REPO, f), 'utf8');
        assert.doesNotThrow(() => new Function(src), f); // eslint-disable-line no-new-func
    }
});

test('manifests: versions match core/constants.js, Premiere host is an object (installer requirement)', () => {
    const { PLUGIN_VERSION } = req('core/constants');
    const pm = JSON.parse(fs.readFileSync(path.join(REPO, 'build/premiere/manifest.json'), 'utf8'));
    const numeric = PLUGIN_VERSION.split('-')[0];
    assert.equal(pm.version, numeric);
    assert.ok(pm.host && !Array.isArray(pm.host), 'host must be an object for Creative Cloud installer');
    assert.ok(fs.readFileSync(path.join(REPO, 'build/resolve/manifest.xml'), 'utf8').includes(`<Version>${numeric}</Version>`));
    assert.equal(JSON.parse(fs.readFileSync(path.join(REPO, 'build/resolve/package.json'), 'utf8')).version, PLUGIN_VERSION);
});

// ---------------------------------------------------------------- runner
app.whenReady().then(async () => {
    let failed = 0;
    for (const t of tests) {
        try {
            await t.fn();
            console.log(`  ✓ ${t.name}`);
        } catch (e) {
            failed += 1;
            console.log(`  ✗ ${t.name}\n    ${e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n    ') : e}`);
        }
    }
    console.log(`\n${tests.length - failed}/${tests.length} tests passed`);
    app.exit(failed ? 1 : 0);
});
