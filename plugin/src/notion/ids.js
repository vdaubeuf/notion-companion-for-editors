'use strict';

const HEX32 = /^[0-9a-f]{32}$/i;

/** Returns the canonical dashed UUID for a Notion id, or null if invalid. */
function normalizeId(value) {
    if (typeof value !== 'string') return null;
    const hex = value.trim().replace(/-/g, '');
    if (!HEX32.test(hex)) return null;
    const h = hex.toLowerCase();
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function pageUrlFromId(id) {
    const n = normalizeId(id);
    return n ? `https://www.notion.so/${n.replace(/-/g, '')}` : null;
}

// Hosts whose links can be opened in the Notion desktop app.
const NOTION_HOSTS = new Set(['notion.so', 'www.notion.so', 'notion.com', 'www.notion.com', 'app.notion.com']);

function isNotionUrl(u) {
    try {
        const url = new URL(u);
        return url.protocol === 'https:' && NOTION_HOSTS.has(url.hostname);
    } catch (_) {
        return false;
    }
}

module.exports = { normalizeId, pageUrlFromId, isNotionUrl };
