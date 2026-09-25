'use strict';

// Renders the normalized block model (built by core/notion/blocks.js) into DOM nodes.
//
// ctx = {
//   partial: boolean,                   content still loading: placeholders for pending children
//   openToggles: Set<string>,           ids of toggles the user opened (kept across re-renders)
//   onTodoToggle?: (id, checked) => void  not set in this version (read-only to-dos); when provided,
//                                         to-do boxes become interactive — hook for a future write-back.
// }
//
// Links are rendered as <span data-href> (handled by the page view), never as
// <a href>: the panel must not navigate and UXP gives anchors its own behaviour.

const { h, append } = require('./dom');
const { icon, pageIcon } = require('./icons');

const NOTION_COLORS = new Set(['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red']);

function colorClass(color) {
    if (!color) return '';
    const bg = color.endsWith('_background');
    const base = bg ? color.slice(0, -'_background'.length) : color;
    if (!NOTION_COLORS.has(base)) return '';
    return bg ? `bg-${base}` : `fg-${base}`;
}

function linkSpan(href, cls, ...children) {
    return h('span', { class: `link ${cls || ''}`.trim(), 'data-href': href, title: href, role: 'link', tabindex: '0' }, ...children);
}

function renderRich(rich) {
    const frag = document.createDocumentFragment();
    for (const r of rich || []) {
        if (!r.t) continue;
        const classes = [];
        if (r.b) classes.push('b');
        if (r.i) classes.push('i');
        if (r.s) classes.push('s');
        if (r.u) classes.push('u');
        if (r.color) classes.push(colorClass(r.color));
        if (r.mention) classes.push('mention');
        let el = (r.c || r.eq)
            ? h('span', { class: `inline-code ${r.eq ? 'eq' : ''}`.trim(), text: r.t })
            : document.createTextNode(r.t);
        if (r.href) el = linkSpan(r.href, classes.join(' '), el);
        else if (classes.length) el = h('span', { class: classes.join(' ') }, el);
        frag.appendChild(el);
    }
    return frag;
}

function plain(rich) {
    return (rich || []).map((r) => r.t).join('');
}

function pendingChildren(node, ctx) {
    return ctx.partial && node.hasChildren && node.children.length === 0
        ? h('div', { class: 'pending-children' }, h('span'), h('span'))
        : null;
}

function childrenOf(node, ctx) {
    if (node.children && node.children.length) return h('div', { class: 'children' }, renderBlocks(node.children, ctx));
    return pendingChildren(node, ctx);
}

function linkCard(url, label, kind = 'external') {
    return h('div', { class: 'card-link', 'data-href': url || '', title: url || '', role: 'link', tabindex: '0' },
        icon(kind === 'file' ? 'file' : 'external'), h('span', { class: 'card-label', text: label }));
}

function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return url || ''; }
}

// Collapsible block without <details> (unsupported in UXP).
function toggle(node, ctx, summaryContent, bodyFactory, extraClass = '') {
    const open = ctx.openToggles && ctx.openToggles.has(node.id);
    const wrap = h('div', { class: `n-toggle ${open ? 'open' : ''} ${extraClass}`.trim() });
    const body = h('div', { class: 'toggle-body' });
    let rendered = false;
    const renderBody = () => { if (!rendered) { append(body, [bodyFactory()]); rendered = true; } };
    if (open) renderBody();
    const summary = h('div', { class: 'toggle-summary', role: 'button', tabindex: '0', 'aria-expanded': open ? 'true' : 'false' },
        h('span', { class: 'toggle-arrow', text: '▸' }), h('div', { class: 'toggle-label' }, summaryContent));
    const flip = (e) => {
        // Clicking a link inside the summary must not toggle.
        if (e && e.target && e.target.getAttribute && e.target.getAttribute('data-href')) return;
        const nowOpen = !wrap.classList.contains('open');
        wrap.classList.toggle('open', nowOpen);
        summary.setAttribute('aria-expanded', nowOpen ? 'true' : 'false');
        if (ctx.openToggles) { if (nowOpen) ctx.openToggles.add(node.id); else ctx.openToggles.delete(node.id); }
        if (nowOpen) renderBody();
    };
    summary.addEventListener('click', flip);
    summary.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(e); } });
    return append(wrap, [summary, body]);
}

function renderTable(node) {
    const rows = node.children || [];
    const table = h('table', { class: 'n-table' });
    rows.forEach((row, ri) => {
        if (row.type !== 'table_row') return;
        const tr = h('tr');
        (row.cells || []).forEach((cell, ci) => {
            const header = (node.hasColumnHeader && ri === 0) || (node.hasRowHeader && ci === 0);
            tr.appendChild(h(header ? 'th' : 'td', null, renderRich(cell)));
        });
        table.appendChild(tr);
    });
    return h('div', { class: 'table-wrap' }, table);
}

function renderMedia(node) {
    const caption = node.caption && node.caption.length ? h('div', { class: 'caption' }, renderRich(node.caption)) : null;
    if (node.type === 'image' && node.url) {
        const fig = h('div', { class: 'n-image' });
        const img = h('img', { src: node.url, alt: plain(node.caption) });
        img.addEventListener('error', () => {
            // Notion-hosted file URLs expire after ~1 h (cached content): offer to refresh / open instead.
            fig.replaceChild(h('div', { class: 'media-missing' }, icon('alert'), 'Image indisponible (lien expiré) — actualisez ou ouvrez dans Notion'), img);
        });
        append(fig, [img, caption]);
        return fig;
    }
    const labels = { image: 'Image', video: 'Vidéo', audio: 'Audio', file: 'Fichier', pdf: 'PDF' };
    const label = node.name || plain(node.caption) || `${labels[node.type] || 'Fichier'}${node.url ? ` · ${hostOf(node.url)}` : ''}`;
    return node.url ? linkCard(node.url, label, 'file') : h('div', { class: 'unsupported' }, `${labels[node.type] || 'Fichier'} non disponible`);
}

function renderBlock(node, ctx) {
    const cc = colorClass(node.color);
    switch (node.type) {
        case 'paragraph': {
            const p = h('div', { class: `n-p ${cc} ${plain(node.rich) ? '' : 'empty'}`.trim() }, renderRich(node.rich));
            const kids = childrenOf(node, ctx);
            return kids ? h('div', null, p, kids) : p;
        }
        case 'heading_1':
        case 'heading_2':
        case 'heading_3':
        case 'heading_4': {
            const level = Number(node.type.slice(-1));
            const hd = h('div', { class: `n-h${level} ${cc}`.trim(), role: 'heading', 'aria-level': String(level) }, renderRich(node.rich));
            if (node.toggleable) {
                return toggle(node, ctx, hd, () => node.children.length ? renderBlocks(node.children, ctx) : (pendingChildren(node, ctx) || ''), 'heading-toggle');
            }
            return hd;
        }
        case 'bulleted_list_item':
        case 'numbered_list_item':
            return h('li', { class: cc }, h('div', { class: 'li-text' }, renderRich(node.rich)), childrenOf(node, ctx));
        case 'to_do': {
            const interactive = typeof ctx.onTodoToggle === 'function';
            const box = h('span', { class: `todo-box ${node.checked ? 'checked' : ''} ${interactive ? 'interactive' : ''}`.trim(), role: 'checkbox', 'aria-checked': node.checked ? 'true' : 'false' },
                node.checked ? '✓' : '');
            if (interactive) box.addEventListener('click', () => ctx.onTodoToggle(node.id, !node.checked));
            return h('div', { class: `n-todo ${node.checked ? 'done' : ''} ${cc}`.trim() },
                h('div', { class: 'todo-row' }, box, h('span', { class: 'todo-text' }, renderRich(node.rich))),
                childrenOf(node, ctx));
        }
        case 'toggle':
            return toggle(node, ctx, renderRich(node.rich),
                () => node.children.length ? renderBlocks(node.children, ctx) : (pendingChildren(node, ctx) || h('div', { class: 'muted small', text: 'Vide' })), cc);
        case 'quote':
            return h('div', { class: `n-quote ${cc}`.trim() }, renderRich(node.rich), childrenOf(node, ctx));
        case 'callout':
            return h('div', { class: `n-callout ${cc || 'bg-default'}` },
                node.icon ? pageIcon(node.icon, 'callout-icon') : null,
                h('div', { class: 'callout-body' }, h('div', null, renderRich(node.rich)), childrenOf(node, ctx)));
        case 'divider':
            return h('div', { class: 'n-hr' });
        case 'code':
            return h('div', { class: 'n-code' },
                node.language && node.language !== 'plain text' ? h('div', { class: 'code-lang', text: node.language }) : null,
                h('pre', null, h('code', { text: plain(node.rich) })),
                node.caption && node.caption.length ? h('div', { class: 'caption' }, renderRich(node.caption)) : null);
        case 'equation':
            return h('div', { class: 'n-equation' }, h('code', { text: node.expression }));
        case 'child_page':
            return h('div', { class: 'n-subpage', 'data-href': node.url || '', role: 'link', tabindex: '0' }, icon('page'), h('span', { text: node.title || 'Sans titre' }));
        case 'child_database':
            return h('div', { class: 'n-subpage', 'data-href': node.url || '', role: 'link', tabindex: '0' }, icon('db'), h('span', { text: node.title || 'Base de données' }));
        case 'link_to_page':
            return node.url ? h('div', { class: 'n-subpage', 'data-href': node.url, role: 'link', tabindex: '0' }, icon('link'), h('span', { text: 'Page liée' })) : null;
        case 'bookmark':
        case 'embed':
        case 'link_preview':
            return node.url ? h('div', { class: 'n-bookmark' }, linkCard(node.url, plain(node.caption) || hostOf(node.url)),
                node.caption && node.caption.length ? null : h('div', { class: 'bookmark-url', text: node.url })) : null;
        case 'image':
        case 'video':
        case 'audio':
        case 'file':
        case 'pdf':
            return renderMedia(node);
        case 'table':
            return node.children.length ? renderTable(node) : pendingChildren(node, ctx);
        case 'column_list':
            return h('div', { class: 'n-columns' }, (node.children || []).map((col) => h('div', { class: 'n-column' }, renderBlocks(col.children || [], ctx))));
        case 'column':
        case 'synced_block':
        case 'tab':
        case 'template':
            return h('div', { class: 'n-container' }, renderBlocks(node.children || [], ctx), pendingChildren(node, ctx));
        case 'breadcrumb':
        case 'table_of_contents':
            return null;
        default:
            return h('div', { class: 'unsupported' }, icon('alert'),
                h('span', null, `Bloc « ${node.originalType || node.type} » non affiché dans le panneau — `),
                h('span', { class: 'link', 'data-open-in-notion': '1', role: 'link', tabindex: '0', text: 'ouvrir dans Notion' }));
    }
}

// Groups consecutive list items into <ul>/<ol>.
function renderBlocks(nodes, ctx) {
    const frag = document.createDocumentFragment();
    let list = null;
    let listType = null;
    for (const node of nodes || []) {
        const isList = node.type === 'bulleted_list_item' || node.type === 'numbered_list_item';
        if (isList) {
            if (listType !== node.type) {
                list = h(node.type === 'bulleted_list_item' ? 'ul' : 'ol', { class: 'n-list' });
                listType = node.type;
                frag.appendChild(list);
            }
            list.appendChild(renderBlock(node, ctx));
            continue;
        }
        list = null;
        listType = null;
        const el = renderBlock(node, ctx);
        if (el) frag.appendChild(el);
    }
    return frag;
}

module.exports = { renderBlocks, renderBlock, renderRich };
