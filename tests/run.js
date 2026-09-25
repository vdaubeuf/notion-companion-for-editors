'use strict';

// Unit tests, executed as a tiny Electron app (works with the Electron bundled
// inside DaVinci Resolve — no Node.js installation needed). See scripts/test.sh.

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const SRC = path.join(__dirname, '..', 'plugin', 'src');
const req = (p) => require(path.join(SRC, p));

const silentLog = { debug() {}, info() {}, warn() {}, error() {} };
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nc-test-'));

// ---------------------------------------------------------------- identity
const { buildIdentity } = req('resolve/identity');

test('identity: uses GetUniqueId when available', () => {
    const id = buildIdentity({ name: 'Mon documentaire', uid: 'ABC-123', database: { DbType: 'Disk', DbName: 'Local Database' }, folder: 'Docs' });
    assert.equal(id.key, 'uid:ABC-123');
    assert.equal(id.strategy, 'uid');
    assert.deepEqual(id.database, { type: 'Disk', name: 'Local Database' });
});

test('identity: fallback key = db + name, folder excluded', () => {
    const a = buildIdentity({ name: 'Mon documentaire', uid: '', database: { DbType: 'Disk', DbName: 'Local' }, folder: 'A' });
    const b = buildIdentity({ name: 'Mon documentaire', uid: null, database: { DbType: 'Disk', DbName: 'Local' }, folder: 'B' });
    assert.equal(a.strategy, 'fallback');
    assert.equal(a.key, 'name:Disk|Local|Mon documentaire');
    assert.equal(a.key, b.key);
});

// ---------------------------------------------------------------- associations
const { AssociationStore } = req('storage/associations');
const page = (id, title) => ({ id, title, url: `https://www.notion.so/${id.replace(/-/g, '')}`, icon: { type: 'emoji', emoji: '🎬' } });
const PID = '1a2b3c4d-1111-2222-3333-444455556666';
const PID2 = '9f8e7d6c-1111-2222-3333-444455556666';
const DB = { DbType: 'Disk', DbName: 'Local Database' };

test('associations: set + find by uid, rename is followed', () => {
    const dir = tmpDir();
    const s = new AssociationStore(path.join(dir, 'a.json'), silentLog);
    s.set(buildIdentity({ name: 'Mon documentaire', uid: 'U1', database: DB }), page(PID, 'Mon documentaire'));
    const renamed = buildIdentity({ name: 'Mon documentaire (doc)', uid: 'U1', database: DB });
    const r = s.find(renamed);
    assert.equal(r.matchedBy, 'uid');
    assert.equal(r.match.notionPageId, PID);
    // persisted with the new name
    const again = new AssociationStore(path.join(dir, 'a.json'), silentLog);
    assert.equal(again.get('uid:U1').resolveProjectName, 'Mon documentaire (doc)');
});

test('associations: fallback record is re-keyed to uid when uid becomes available', () => {
    const dir = tmpDir();
    const s = new AssociationStore(path.join(dir, 'a.json'), silentLog);
    s.set(buildIdentity({ name: 'Court 2026', uid: null, database: DB }), page(PID, 'Court'));
    const r = s.find(buildIdentity({ name: 'Court 2026', uid: 'U9', database: DB }));
    assert.equal(r.match.notionPageId, PID);
    assert.equal(r.match.key, 'uid:U9');
    assert.equal(s.get('name:Disk|Local Database|Court 2026'), null);
    assert.equal(s.count(), 1);
});

test('associations: same name but different uid -> suggestion only', () => {
    const dir = tmpDir();
    const s = new AssociationStore(path.join(dir, 'a.json'), silentLog);
    s.set(buildIdentity({ name: 'Test', uid: 'U1', database: DB }), page(PID, 'Notes test'));
    const r = s.find(buildIdentity({ name: 'Test', uid: 'U2', database: DB }));
    assert.equal(r.match, null);
    assert.equal(r.suggestion.notionPageId, PID);
});

test('associations: other database -> no match, no suggestion', () => {
    const dir = tmpDir();
    const s = new AssociationStore(path.join(dir, 'a.json'), silentLog);
    s.set(buildIdentity({ name: 'Test', uid: 'U1', database: DB }), page(PID, 'Notes'));
    const r = s.find(buildIdentity({ name: 'Test', uid: 'U2', database: { DbType: 'PostgreSQL', DbName: 'Studio' } }));
    assert.equal(r.match, null);
    assert.equal(r.suggestion, null);
});

test('associations: setPage, refreshPageInfo, remove', () => {
    const dir = tmpDir();
    const s = new AssociationStore(path.join(dir, 'a.json'), silentLog);
    s.set(buildIdentity({ name: 'P', uid: 'U1', database: DB }), page(PID, 'Old'));
    s.setPage('uid:U1', page(PID2, 'New'));
    assert.equal(s.get('uid:U1').notionPageId, PID2);
    s.refreshPageInfo(PID2, { ...page(PID2, 'Renamed') });
    assert.equal(s.get('uid:U1').notionPageTitle, 'Renamed');
    assert.equal(s.remove('uid:U1'), true);
    assert.equal(s.count(), 0);
});

test('associations: migrates v0 flat format', () => {
    const dir = tmpDir();
    const f = path.join(dir, 'a.json');
    fs.writeFileSync(f, JSON.stringify({ 'uid:X': { resolveProjectName: 'Mon documentaire', notionPageId: PID, notionPageTitle: 'Mon documentaire' } }));
    const s = new AssociationStore(f, silentLog);
    assert.equal(s.count(), 1);
    assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).schemaVersion, 1);
});

// ---------------------------------------------------------------- json store
const { JsonStore } = req('storage/jsonStore');

test('jsonStore: corrupt file is moved aside, defaults used', () => {
    const dir = tmpDir();
    const f = path.join(dir, 's.json');
    fs.writeFileSync(f, '{not json');
    const s = new JsonStore(f, { version: 1, defaults: () => ({ a: 1 }), log: silentLog });
    assert.equal(s.load().a, 1);
    assert.ok(fs.readdirSync(dir).some((n) => n.startsWith('s.json.corrupt-')));
});

// ---------------------------------------------------------------- blocks
const { normalizeBlock, normalizeRichText, safeHref } = req('notion/blocks');

test('blocks: rich text annotations and links', () => {
    const r = normalizeRichText([
        { type: 'text', plain_text: 'Gras', annotations: { bold: true, color: 'default' }, href: null },
        { type: 'text', plain_text: 'lien', annotations: { italic: true, color: 'red' }, href: 'https://example.com' },
        { type: 'text', plain_text: 'bad', annotations: {}, href: 'javascript:alert(1)' },
    ]);
    assert.deepEqual(r[0], { t: 'Gras', b: 1 });
    assert.equal(r[1].href, 'https://example.com/');
    assert.equal(r[1].color, 'red');
    assert.equal(r[2].href, undefined);
    assert.equal(safeHref('/abc'), 'https://www.notion.so/abc');
});

test('blocks: to_do, heading toggle, child_page not recursed, unsupported', () => {
    const todo = normalizeBlock({ object: 'block', id: PID, type: 'to_do', has_children: false, to_do: { rich_text: [], checked: true } });
    assert.equal(todo.checked, true);
    const hd = normalizeBlock({ object: 'block', id: PID, type: 'heading_2', has_children: true, heading_2: { rich_text: [], is_toggleable: true } });
    assert.equal(hd.toggleable, true);
    assert.equal(hd.hasChildren, true);
    const cp = normalizeBlock({ object: 'block', id: PID, type: 'child_page', has_children: true, child_page: { title: 'Sous-page' } });
    assert.equal(cp.hasChildren, false);
    assert.equal(cp.url, 'https://www.notion.so/1a2b3c4d111122223333444455556666');
    const un = normalizeBlock({ object: 'block', id: PID, type: 'unsupported', unsupported: { block_type: 'ai_block' } });
    assert.equal(un.unsupported, true);
    assert.equal(un.originalType, 'ai_block');
});

test('blocks: media keeps only https urls', () => {
    const img = normalizeBlock({ object: 'block', id: PID, type: 'image', image: { type: 'external', external: { url: 'http://insecure/x.png' }, caption: [] } });
    assert.equal(img.url, null);
    const ok = normalizeBlock({ object: 'block', id: PID, type: 'image', image: { type: 'file', file: { url: 'https://s3/x.png', expiry_time: 'T' }, caption: [] } });
    assert.equal(ok.url, 'https://s3/x.png');
});

// ---------------------------------------------------------------- pages
const { extractTitle, summarizePage, searchPages } = req('notion/pages');

test('pages: title extraction and summary', () => {
    const p = { object: 'page', id: PID.replace(/-/g, ''), properties: { Nom: { type: 'title', title: [{ plain_text: 'Mon ' }, { plain_text: 'documentaire' }] } }, parent: { type: 'page_id', page_id: PID2 }, url: 'https://www.notion.so/x', icon: { type: 'emoji', emoji: '🎬' } };
    assert.equal(extractTitle(p), 'Mon documentaire');
    const s = summarizePage(p);
    assert.equal(s.id, PID);
    assert.deepEqual(s.parent, { type: 'page_id', id: PID2 });
    assert.deepEqual(s.icon, { type: 'emoji', emoji: '🎬' });
});

test('pages: search sends page filter and drops trashed results', async () => {
    let sent;
    const client = { request: async (m, p, o) => { sent = { m, p, o }; return { results: [
        { object: 'page', id: PID, properties: {}, in_trash: false },
        { object: 'page', id: PID2, properties: {}, in_trash: true },
    ], has_more: true, next_cursor: 'c2' }; } };
    const r = await searchPages(client, { query: ' Mon documentaire ' });
    assert.equal(sent.p, '/search');
    assert.equal(sent.o.body.query, 'Mon documentaire');
    assert.deepEqual(sent.o.body.filter, { property: 'object', value: 'page' });
    assert.equal(r.results.length, 1);
    assert.equal(r.nextCursor, 'c2');
});

// ---------------------------------------------------------------- client
const { NotionClient } = req('notion/client');

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

test('client: headers, 429 retried after Retry-After', async () => {
    const { client, calls, sleeps } = makeClient([
        fakeResponse(429, { code: 'rate_limited' }, { 'retry-after': '2' }),
        fakeResponse(200, { ok: 1 }),
    ]);
    const r = await client.request('GET', '/pages/x');
    assert.deepEqual(r, { ok: 1 });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].init.headers['Notion-Version'], '2026-03-11');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer ntn_testtoken_abcdefghijklmnop');
    assert.ok(sleeps.includes(2000));
});

test('client: 401 -> unauthorized, 404 -> not_found, no retry', async () => {
    const a = makeClient([fakeResponse(401, { code: 'unauthorized' })]);
    await assert.rejects(a.client.request('GET', '/users/me'), (e) => e.code === 'unauthorized');
    assert.equal(a.calls.length, 1);
    const b = makeClient([fakeResponse(404, { code: 'object_not_found' })]);
    await assert.rejects(b.client.request('GET', '/pages/x'), (e) => e.code === 'not_found');
});

test('client: network error retried then reported', async () => {
    const { client, calls } = makeClient([new TypeError('fetch failed'), new TypeError('fetch failed'), new TypeError('fetch failed')]);
    await assert.rejects(client.request('GET', '/pages/x'), (e) => e.code === 'network');
    assert.equal(calls.length, 3);
});

test('client: blocked rate limit is not retried', async () => {
    const { client, calls } = makeClient([fakeResponse(429, { code: 'rate_limited', additional_data: { rate_limit_reason: 'public_api_request_blocked' } })]);
    await assert.rejects(client.request('GET', '/pages/x'), (e) => e.code === 'rate_limited');
    assert.equal(calls.length, 1);
});

test('client: no token', async () => {
    const { client } = makeClient([], { getToken: () => null });
    await assert.rejects(client.request('GET', '/x'), (e) => e.code === 'no_token');
});

// ---------------------------------------------------------------- loader
const { loadPageContent } = req('notion/loader');

test('loader: paginates and recurses into children, skips child pages', async () => {
    const blk = (id, type, hasChildren = false, extra = {}) => ({ object: 'block', id, type, has_children: hasChildren, [type]: { rich_text: [{ plain_text: id }], ...extra } });
    const ROOT = PID;
    const T = '00000000-0000-0000-0000-00000000000a';
    const SUB = '00000000-0000-0000-0000-00000000000b';
    const N1 = '00000000-0000-0000-0000-00000000000c';
    const routes = {
        [`/pages/${ROOT}`]: { object: 'page', id: ROOT, properties: { t: { type: 'title', title: [{ plain_text: 'Mon documentaire' }] } }, url: 'https://www.notion.so/p' },
        [`/blocks/${ROOT}/children|`]: { results: [blk(T, 'toggle', true)], has_more: true, next_cursor: 'c1' },
        [`/blocks/${ROOT}/children|c1`]: { results: [{ object: 'block', id: SUB, type: 'child_page', has_children: true, child_page: { title: 'Sous' } }], has_more: false },
        [`/blocks/${T}/children|`]: { results: [blk(N1, 'to_do', false, { checked: true })], has_more: false },
    };
    const requested = [];
    const client = { request: async (m, p, o = {}) => {
        const k = p.includes('/children') ? `${p}|${(o.query && o.query.start_cursor) || ''}` : p;
        requested.push(k);
        if (!routes[k]) throw new Error(`unexpected ${k}`);
        return routes[k];
    } };
    let progress = 0;
    const r = await loadPageContent(client, ROOT, { maxBlocks: 100, maxDepth: 5, onProgress: () => { progress += 1; }, throttleMs: 0 });
    assert.equal(r.page.title, 'Mon documentaire');
    assert.equal(r.blocks.length, 2);
    assert.equal(r.blocks[0].children[0].checked, true);
    assert.equal(r.blocks[1].type, 'child_page');
    assert.ok(!requested.some((k) => k.startsWith(`/blocks/${SUB}`)), 'child page must not be fetched');
    assert.ok(progress >= 1);
    assert.equal(r.truncated, false);
});

test('loader: trashed page -> page_trashed', async () => {
    const client = { request: async () => ({ object: 'page', id: PID, properties: {}, in_trash: true }) };
    await assert.rejects(loadPageContent(client, PID, { maxBlocks: 10, maxDepth: 2 }), (e) => e.code === 'page_trashed');
});

// ---------------------------------------------------------------- logger / validators
const { redact } = req('main/logger');
const { validators } = req('main/ipc');
const { normalizeId } = req('notion/ids');

test('logger: tokens are redacted', () => {
    const out = redact('Authorization: Bearer ntn_1234567890abcdef token=secret_abcdefghijk');
    assert.ok(!out.includes('ntn_1234567890abcdef'));
    assert.ok(!out.includes('secret_abcdefghijk'));
});

test('validators: page ids, tokens, keys', () => {
    assert.equal(normalizeId('1A2B3C4D111122223333444455556666'), PID);
    assert.equal(normalizeId('../../etc'), null);
    assert.throws(() => validators.token('short'));
    assert.throws(() => validators.token('ntn_ with spaces inside the token'));
    assert.equal(validators.token('  ntn_abcdefghijklmnopqrstuvwxyz  '), 'ntn_abcdefghijklmnopqrstuvwxyz');
    assert.throws(() => validators.assocKey('evil'));
    assert.equal(validators.assocKey('uid:1'), 'uid:1');
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
