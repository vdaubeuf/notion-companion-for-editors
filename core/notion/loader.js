'use strict';

// Fetches a page's full block tree: paginated children, recursive for blocks
// with has_children, progressive (onProgress is called as the tree grows),
// cancellable (AbortSignal) and bounded (maxBlocks / maxDepth).

const { normalizeBlocks } = require('./blocks');
const { retrievePage } = require('./pages');
const { NotionError } = require('./errors');

async function fetchChildren(client, blockId, signal, onPage) {
    const all = [];
    let cursor;
    do {
        const res = await client.request('GET', `/blocks/${blockId}/children`, {
            query: { page_size: 100, start_cursor: cursor },
            signal,
        });
        const batch = normalizeBlocks(res && res.results);
        all.push(...batch);
        if (onPage) onPage(all);
        cursor = res && res.has_more ? res.next_cursor : undefined;
    } while (cursor);
    return all;
}

/**
 * @returns {Promise<{ page: object, blocks: object[], truncated: boolean }>}
 */
async function loadPageContent(client, pageId, { signal, onProgress, maxBlocks, maxDepth, throttleMs = 250 } = {}) {
    const page = await retrievePage(client, pageId, { signal });
    const root = { blocks: [] };
    let count = 0;
    let truncated = false;
    let lastEmit = 0;

    const emit = (force) => {
        if (!onProgress) return;
        const now = Date.now();
        if (!force && now - lastEmit < throttleMs) return;
        lastEmit = now;
        onProgress({ page, blocks: root.blocks, truncated });
    };

    root.blocks = await fetchChildren(client, page.id, signal, (partial) => {
        root.blocks = partial;
        emit(true);
    });
    count = root.blocks.length;

    // Breadth-first: top of the page completes first.
    let frontier = root.blocks.filter((b) => b.hasChildren).map((b) => ({ node: b, depth: 1 }));
    while (frontier.length) {
        if (signal && signal.aborted) throw new NotionError('cancelled');
        const next = [];
        // The client's queue already enforces rate limiting; fan out a few at a time.
        for (let i = 0; i < frontier.length; i += 3) {
            const slice = frontier.slice(i, i + 3);
            await Promise.all(slice.map(async ({ node, depth }) => {
                if (count >= maxBlocks) { truncated = true; return; }
                const kids = await fetchChildren(client, node.id, signal);
                node.children = kids;
                count += kids.length;
                if (depth < maxDepth) {
                    for (const k of kids) if (k.hasChildren) next.push({ node: k, depth: depth + 1 });
                } else if (kids.some((k) => k.hasChildren)) {
                    truncated = true;
                }
            }));
            emit(false);
        }
        frontier = next;
    }

    if (count >= maxBlocks) truncated = true;
    const result = { page, blocks: root.blocks, truncated };
    return result;
}

module.exports = { loadPageContent };
