// Renders the normalized block model (built in the main process by
// src/notion/blocks.js) into DOM nodes.
//
// ctx = {
//   partial: boolean,                 // content still loading: show placeholders for pending children
//   onTodoToggle?: (id, checked) => void  // not set in v0.1 (read-only to-dos); when provided,
//                                          // checkboxes become interactive — hook for a future write-back.
// }

import { h, append } from './dom.js';
import { icon, pageIcon } from './icons.js';

const NOTION_COLORS = new Set(['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red']);

function colorClass(color) {
    if (!color) return '';
    const bg = color.endsWith('_background');
    const base = bg ? color.slice(0, -'_background'.length) : color;
    if (!NOTION_COLORS.has(base)) return '';
    return bg ? `bg-${base}` : `fg-${base}`;
}

export function renderRich(rich) {
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
        let el;
        if (r.c || r.eq) el = h('code', { class: `inline-code ${r.eq ? 'eq' : ''}`.trim(), text: r.t });
        else el = document.createTextNode(r.t);
        if (r.href) {
            el = h('a', { class: `link ${classes.join(' ')}`.trim(), href: '#', dataset: { href: r.href }, title: r.href }, el);
        } else if (classes.length) {
            el = h('span', { class: classes.join(' ') }, el);
        }
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
    return h('a', { class: 'card-link', href: '#', dataset: { href: url || '' }, title: url || '' },
        icon(kind === 'file' ? 'file' : 'external'), h('span', { class: 'card-label', text: label }));
}

function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return url || ''; }
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
    const caption = node.caption && node.caption.length ? h('figcaption', null, renderRich(node.caption)) : null;
    if (node.type === 'image' && node.url) {
        const fig = h('figure', { class: 'n-image' });
        const img = h('img', { src: node.url, alt: plain(node.caption), loading: 'lazy', referrerpolicy: 'no-referrer' });
        img.addEventListener('error', () => {
            // Notion-hosted file URLs expire after ~1 h (cached content): offer to open instead.
            fig.replaceChild(h('div', { class: 'media-missing' }, icon('alert'), 'Image indisponible (lien expiré) — actualisez ou ouvrez dans Notion'), img);
        });
        append(fig, [img, caption]);
        return fig;
    }
    const labels = { image: 'Image', video: 'Vidéo', audio: 'Audio', file: 'Fichier', pdf: 'PDF' };
    const label = node.name || plain(node.caption) || `${labels[node.type] || 'Fichier'}${node.url ? ` · ${hostOf(node.url)}` : ''}`;
    return node.url ? linkCard(node.url, label, 'file') : h('div', { class: 'unsupported' }, `${labels[node.type] || 'Fichier'} non disponible`);
}

export function renderBlock(node, ctx) {
    const cc = colorClass(node.color);
    switch (node.type) {
        case 'paragraph': {
            const p = h('p', { class: `n-p ${cc}`.trim() }, renderRich(node.rich));
            if (!plain(node.rich)) p.classList.add('empty');
            const kids = childrenOf(node, ctx);
            return kids ? h('div', null, p, kids) : p;
        }
        case 'heading_1':
        case 'heading_2':
        case 'heading_3':
        case 'heading_4': {
            const level = Number(node.type.slice(-1));
            const hd = h(`h${level}`, { class: `n-h${level} ${cc}`.trim() }, renderRich(node.rich));
            if (node.toggleable) {
                return h('details', { class: 'n-toggle heading-toggle', dataset: { id: node.id } }, h('summary', null, hd), childrenOf(node, ctx));
            }
            return hd;
        }
        case 'bulleted_list_item':
        case 'numbered_list_item':
            return h('li', { class: cc }, h('div', { class: 'li-text' }, renderRich(node.rich)), childrenOf(node, ctx));
        case 'to_do': {
            const box = h('input', { type: 'checkbox', checked: !!node.checked, disabled: !ctx.onTodoToggle, tabindex: ctx.onTodoToggle ? 0 : -1 });
            if (ctx.onTodoToggle) box.addEventListener('change', () => ctx.onTodoToggle(node.id, box.checked));
            return h('div', { class: `n-todo ${node.checked ? 'done' : ''} ${cc}`.trim() },
                h('label', { class: 'todo-row' }, box, h('span', { class: 'todo-text' }, renderRich(node.rich))),
                childrenOf(node, ctx));
        }
        case 'toggle':
            return h('details', { class: `n-toggle ${cc}`.trim(), dataset: { id: node.id } },
                h('summary', null, renderRich(node.rich)),
                h('div', { class: 'toggle-body' }, node.children.length ? renderBlocks(node.children, ctx) : (pendingChildren(node, ctx) || h('div', { class: 'muted small', text: 'Vide' }))));
        case 'quote':
            return h('blockquote', { class: `n-quote ${cc}`.trim() }, renderRich(node.rich), childrenOf(node, ctx));
        case 'callout':
            return h('div', { class: `n-callout ${cc || 'bg-default'}` },
                node.icon ? pageIcon(node.icon, 'callout-icon') : null,
                h('div', { class: 'callout-body' }, h('div', null, renderRich(node.rich)), childrenOf(node, ctx)));
        case 'divider':
            return h('hr', { class: 'n-hr' });
        case 'code':
            return h('figure', { class: 'n-code' },
                node.language && node.language !== 'plain text' ? h('div', { class: 'code-lang', text: node.language }) : null,
                h('pre', null, h('code', { text: plain(node.rich) })),
                node.caption && node.caption.length ? h('figcaption', null, renderRich(node.caption)) : null);
        case 'equation':
            return h('div', { class: 'n-equation' }, h('code', { text: node.expression }));
        case 'child_page':
            return h('a', { class: 'n-subpage', href: '#', dataset: { href: node.url || '' } }, icon('page'), h('span', { text: node.title || 'Sans titre' }));
        case 'child_database':
            return h('a', { class: 'n-subpage', href: '#', dataset: { href: node.url || '' } }, icon('db'), h('span', { text: node.title || 'Base de données' }));
        case 'link_to_page':
            return node.url ? h('a', { class: 'n-subpage', href: '#', dataset: { href: node.url } }, icon('link'), h('span', { text: 'Page liée' })) : null;
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
                h('a', { href: '#', class: 'link', dataset: { openInNotion: '1' }, text: 'ouvrir dans Notion' }));
    }
}

// Groups consecutive list items into <ul>/<ol>.
export function renderBlocks(nodes, ctx) {
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
