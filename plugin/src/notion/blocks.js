'use strict';

// Converts raw Notion block objects into a compact, renderer-safe model.
// The renderer never sees raw API payloads: fewer bytes over IPC / in cache,
// and one place that decides which URLs are allowed.
//
// Node shape: { id, type, children: Node[], hasChildren, ...type-specific fields }

const { extractIcon } = require('./pages');
const { normalizeId, pageUrlFromId } = require('./ids');

const TEXT_TYPES = new Set([
    'paragraph', 'heading_1', 'heading_2', 'heading_3', 'heading_4',
    'bulleted_list_item', 'numbered_list_item', 'to_do', 'toggle', 'quote', 'callout',
]);
const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'file', 'pdf']);
const LINK_TYPES = new Set(['bookmark', 'embed', 'link_preview']);
const CONTAINER_TYPES = new Set(['column_list', 'column', 'synced_block', 'tab', 'template', 'table']);

// Blocks whose children are *other pages*: never recursed into.
const NO_RECURSE = new Set(['child_page', 'child_database', 'meeting_notes', 'unsupported']);

function safeHref(href) {
    if (typeof href !== 'string' || !href) return null;
    if (href.startsWith('/')) return `https://www.notion.so${href}`;
    try {
        const u = new URL(href);
        return ['http:', 'https:', 'mailto:'].includes(u.protocol) ? u.toString() : null;
    } catch (_) {
        return null;
    }
}

function safeMediaUrl(u) {
    return typeof u === 'string' && u.startsWith('https://') ? u : null;
}

function normalizeRichText(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.map((r) => {
        const a = r.annotations || {};
        const out = { t: typeof r.plain_text === 'string' ? r.plain_text : '' };
        const href = safeHref(r.href || (r.text && r.text.link && r.text.link.url));
        if (href) out.href = href;
        if (a.bold) out.b = 1;
        if (a.italic) out.i = 1;
        if (a.strikethrough) out.s = 1;
        if (a.underline) out.u = 1;
        if (a.code) out.c = 1;
        if (a.color && a.color !== 'default') out.color = a.color;
        if (r.type === 'equation') out.eq = 1;
        if (r.type === 'mention') {
            out.mention = r.mention && r.mention.type ? r.mention.type : 'unknown';
            if (!out.href && r.mention && r.mention.page) out.href = pageUrlFromId(r.mention.page.id);
        }
        return out;
    });
}

function fileInfo(obj) {
    if (!obj) return { url: null, expiry: null };
    if (obj.type === 'external') return { url: safeMediaUrl(obj.external && obj.external.url), expiry: null };
    if (obj.type === 'file') return { url: safeMediaUrl(obj.file && obj.file.url), expiry: (obj.file && obj.file.expiry_time) || null };
    return { url: null, expiry: null };
}

function normalizeBlock(raw) {
    const type = raw && typeof raw.type === 'string' ? raw.type : 'unsupported';
    const data = (raw && raw[type]) || {};
    const node = {
        id: normalizeId(raw && raw.id) || String(raw && raw.id),
        type,
        hasChildren: !!(raw && raw.has_children) && !NO_RECURSE.has(type),
        children: [],
    };

    if (TEXT_TYPES.has(type)) {
        node.rich = normalizeRichText(data.rich_text);
        if (data.color && data.color !== 'default') node.color = data.color;
        if (type === 'to_do') node.checked = !!data.checked;
        if (type.startsWith('heading_')) node.toggleable = !!data.is_toggleable;
        if (type === 'callout') node.icon = extractIcon(data.icon);
        return node;
    }

    switch (type) {
        case 'code':
            node.rich = normalizeRichText(data.rich_text);
            node.language = typeof data.language === 'string' ? data.language : '';
            node.caption = normalizeRichText(data.caption);
            return node;
        case 'divider':
        case 'breadcrumb':
        case 'table_of_contents':
            return node;
        case 'equation':
            node.expression = typeof data.expression === 'string' ? data.expression : '';
            return node;
        case 'child_page':
        case 'child_database':
            node.title = typeof data.title === 'string' ? data.title : '';
            node.url = pageUrlFromId(raw.id);
            return node;
        case 'link_to_page': {
            const target = data.page_id || data.database_id || data.data_source_id || null;
            node.url = target ? pageUrlFromId(target) : null;
            return node;
        }
        case 'table_row':
            node.cells = Array.isArray(data.cells) ? data.cells.map(normalizeRichText) : [];
            return node;
        default:
            break;
    }

    if (MEDIA_TYPES.has(type)) {
        const f = fileInfo(data);
        node.url = f.url;
        node.expiry = f.expiry;
        node.caption = normalizeRichText(data.caption);
        node.name = typeof data.name === 'string' ? data.name : '';
        return node;
    }
    if (LINK_TYPES.has(type)) {
        node.url = safeHref(data.url);
        node.caption = normalizeRichText(data.caption);
        return node;
    }
    if (CONTAINER_TYPES.has(type)) {
        if (type === 'table') {
            node.hasColumnHeader = !!data.has_column_header;
            node.hasRowHeader = !!data.has_row_header;
        }
        return node;
    }

    // Unknown / unsupported: rendered as a generic "open in Notion" block.
    node.unsupported = true;
    node.originalType = type === 'unsupported' && typeof data.block_type === 'string' ? data.block_type : type;
    return node;
}

function normalizeBlocks(rawList) {
    return (Array.isArray(rawList) ? rawList : [])
        .filter((b) => b && b.object === 'block' && !b.in_trash)
        .map(normalizeBlock);
}

module.exports = { normalizeBlock, normalizeBlocks, normalizeRichText, safeHref };
