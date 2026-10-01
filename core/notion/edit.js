'use strict';

// Write-back helpers: which blocks the panel can change, and the request
// bodies sent to Notion (PATCH /blocks/{id}, DELETE /blocks/{id}).
//
// Text edits work on plain text: the user edits the block's text in a
// textarea, and spliceRich() maps the change back onto the existing rich text
// segments (common prefix / suffix kept as they were), so bold, colours and
// links outside the edited range are preserved. Inserted text takes the style
// of the text just before it, like typing in Notion.
// Blocks containing mentions or inline equations are not text-editable: their
// segments cannot be rebuilt faithfully from the normalized model.

const TEXT_EDITABLE = new Set([
    'paragraph', 'heading_1', 'heading_2', 'heading_3', 'heading_4',
    'bulleted_list_item', 'numbered_list_item', 'to_do', 'toggle', 'quote', 'callout', 'code',
]);

// Never deleted from the panel: deleting a child page / database block trashes
// the whole sub-page; structural blocks would leave the page in an odd state.
const NOT_DELETABLE = new Set([
    'child_page', 'child_database', 'column', 'column_list', 'table_row', 'synced_block', 'tab', 'template', 'unsupported',
]);

// Notion limit: 2000 characters per rich text object.
const MAX_TEXT_CONTENT = 2000;

function plain(rich) {
    return (rich || []).map((r) => r.t || '').join('');
}

function canEditText(node) {
    if (!node || !TEXT_EDITABLE.has(node.type) || node.unsupported) return false;
    return !(node.rich || []).some((r) => r.mention || r.eq);
}

function canDelete(node) {
    return !!node && !node.unsupported && !NOT_DELETABLE.has(node.type);
}

const STYLE_KEYS = ['href', 'b', 'i', 's', 'u', 'c', 'color'];

function sameStyle(a, b) {
    return STYLE_KEYS.every((k) => (a[k] || null) === (b[k] || null));
}

function styleOf(seg) {
    const out = {};
    for (const k of STYLE_KEYS) if (seg[k]) out[k] = seg[k];
    return out;
}

/**
 * Applies the change old plain text -> `text` to the rich segments.
 * @returns normalized rich segments ({ t, b?, i?, ... })
 */
function spliceRich(rich, text) {
    const segs = (rich || []).filter((r) => r.t);
    const old = plain(segs);
    if (old === text) return segs.map((s) => ({ ...s }));

    let p = 0;
    const maxP = Math.min(old.length, text.length);
    while (p < maxP && old[p] === text[p]) p += 1;
    let q = 0;
    const maxQ = Math.min(old.length, text.length) - p;
    while (q < maxQ && old[old.length - 1 - q] === text[text.length - 1 - q]) q += 1;
    const delEnd = old.length - q;
    const inserted = text.slice(p, text.length - q);

    const out = [];
    let pos = 0;
    let insertedDone = !inserted;
    const insertWith = (style) => {
        if (insertedDone) return;
        out.push({ t: inserted, ...style });
        insertedDone = true;
    };
    for (const seg of segs) {
        const start = pos;
        const end = pos + seg.t.length;
        pos = end;
        const style = styleOf(seg);
        // Part before the edited range.
        if (start < p) out.push({ t: seg.t.slice(0, Math.min(end, p) - start), ...style });
        // Inserted text continues the segment that ends at (or contains) the edit point.
        if (start < p && end >= p) insertWith(style);
        else if (p === 0 && start === 0) insertWith(style);
        // Part after the edited range.
        if (end > delEnd) out.push({ t: seg.t.slice(Math.max(start, delEnd) - start), ...style });
    }
    insertWith({});

    // Merge neighbours with the same style, drop empty pieces.
    const merged = [];
    for (const s of out) {
        if (!s.t) continue;
        const last = merged[merged.length - 1];
        if (last && sameStyle(last, s)) last.t += s.t;
        else merged.push(s);
    }
    return merged;
}

/** Normalized rich segments -> Notion API rich_text array. */
function toApiRichText(rich) {
    const out = [];
    for (const seg of rich || []) {
        const t = seg.t || '';
        for (let i = 0; i < t.length; i += MAX_TEXT_CONTENT) {
            out.push({
                type: 'text',
                text: { content: t.slice(i, i + MAX_TEXT_CONTENT), link: seg.href ? { url: seg.href } : null },
                annotations: {
                    bold: !!seg.b,
                    italic: !!seg.i,
                    strikethrough: !!seg.s,
                    underline: !!seg.u,
                    code: !!seg.c,
                    color: seg.color || 'default',
                },
            });
        }
    }
    return out;
}

/** PATCH body changing the text of `node`; also returns the new rich segments (optimistic display). */
function textPatch(node, text) {
    const rich = spliceRich(node.rich, text);
    return { rich, body: { [node.type]: { rich_text: toApiRichText(rich) } } };
}

function todoPatch(checked) {
    return { to_do: { checked: !!checked } };
}

/** Finds a node in the block tree: { node, list, index } or null. */
function findNode(blocks, id) {
    const stack = [blocks || []];
    while (stack.length) {
        const list = stack.pop();
        for (let i = 0; i < list.length; i += 1) {
            const node = list[i];
            if (node.id === id) return { node, list, index: i };
            if (node.children && node.children.length) stack.push(node.children);
        }
    }
    return null;
}

module.exports = { canEditText, canDelete, spliceRich, toApiRichText, textPatch, todoPatch, findNode, plain, MAX_TEXT_CONTENT };
