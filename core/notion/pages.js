'use strict';

// Page-level Notion operations: search, retrieve, parent titles.

const { normalizeId, pageUrlFromId } = require('./ids');
const { NotionError } = require('./errors');

function plainText(richText) {
    return Array.isArray(richText) ? richText.map((r) => (r && r.plain_text) || '').join('') : '';
}

function extractTitle(obj) {
    if (!obj) return '';
    if (obj.object === 'page' && obj.properties) {
        for (const prop of Object.values(obj.properties)) {
            if (prop && prop.type === 'title') return plainText(prop.title).trim();
        }
        return '';
    }
    // data_source / database objects carry `title` as a rich text array.
    if (Array.isArray(obj.title)) return plainText(obj.title).trim();
    return '';
}

/** Icon -> renderer-safe shape. Only https image URLs are kept. */
function extractIcon(icon) {
    if (!icon || typeof icon !== 'object') return null;
    const httpsOnly = (u) => (typeof u === 'string' && u.startsWith('https://') ? u : null);
    switch (icon.type) {
        case 'emoji':
            return typeof icon.emoji === 'string' ? { type: 'emoji', emoji: icon.emoji } : null;
        case 'external': {
            const url = httpsOnly(icon.external && icon.external.url);
            return url ? { type: 'image', url } : null;
        }
        case 'file': {
            const url = httpsOnly(icon.file && icon.file.url);
            return url ? { type: 'image', url, expiry: icon.file.expiry_time || null } : null;
        }
        case 'custom_emoji': {
            const url = httpsOnly(icon.custom_emoji && icon.custom_emoji.url);
            return url ? { type: 'image', url } : null;
        }
        default:
            return null;
    }
}

function parentRef(parent) {
    if (!parent || typeof parent !== 'object') return null;
    const type = parent.type;
    if (type === 'workspace') return { type: 'workspace', id: null };
    const id = normalizeId(parent[type]);
    return id ? { type, id } : null;
}

function summarizePage(page) {
    const id = normalizeId(page.id);
    return {
        id,
        object: page.object,
        title: extractTitle(page) || 'Sans titre',
        icon: extractIcon(page.icon),
        url: typeof page.url === 'string' && page.url.startsWith('https://') ? page.url : pageUrlFromId(id),
        parent: parentRef(page.parent),
        inTrash: !!page.in_trash,
        lastEditedTime: page.last_edited_time || null,
    };
}

async function searchPages(client, { query, cursor, signal }) {
    const trimmed = typeof query === 'string' ? query.trim() : '';
    const body = {
        filter: { property: 'object', value: 'page' },
        page_size: 20,
    };
    if (trimmed) body.query = trimmed;
    // Empty query: show the most recently edited pages first.
    else body.sort = { timestamp: 'last_edited_time', direction: 'descending' };
    if (cursor) body.start_cursor = cursor;

    const res = await client.request('POST', '/search', { body, signal });
    const results = (res && Array.isArray(res.results) ? res.results : [])
        .filter((r) => r && r.object === 'page' && !r.in_trash)
        .map(summarizePage);
    return { results, nextCursor: res && res.has_more ? res.next_cursor : null };
}

async function retrievePage(client, pageId, { signal } = {}) {
    const id = normalizeId(pageId);
    if (!id) throw new NotionError('validation', { detail: 'invalid page id' });
    const page = await client.request('GET', `/pages/${id}`, { signal });
    const summary = summarizePage(page);
    if (summary.inTrash) throw new NotionError('page_trashed');
    return summary;
}

/**
 * Title of a search result's parent, used to disambiguate homonyms
 * ("Documentaires / Mon documentaire"). One level, memoized.
 */
async function parentTitle(client, ref, memo) {
    if (!ref) return null;
    if (ref.type === 'workspace') return 'Espace de travail';
    const memoKey = `${ref.type}:${ref.id}`;
    if (memo.has(memoKey)) return memo.get(memoKey);
    let title = null;
    try {
        if (ref.type === 'page_id') {
            title = extractTitle(await client.request('GET', `/pages/${ref.id}`)) || 'Sans titre';
        } else if (ref.type === 'data_source_id') {
            title = extractTitle(await client.request('GET', `/data_sources/${ref.id}`)) || 'Base de données';
        } else if (ref.type === 'database_id') {
            title = extractTitle(await client.request('GET', `/databases/${ref.id}`)) || 'Base de données';
        }
    } catch (_) {
        title = null; // parent not shared / not accessible: just show nothing
    }
    memo.set(memoKey, title);
    return title;
}

module.exports = { searchPages, retrievePage, parentTitle, summarizePage, extractTitle, extractIcon, plainText };
