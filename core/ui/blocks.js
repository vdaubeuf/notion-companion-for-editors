'use strict';

// Renders the normalized block model (built by core/notion/blocks.js) into DOM nodes.
//
// ctx = {
//   partial: boolean,                   content still loading: placeholders for pending children
//   openToggles: Set<string>,           ids of toggles the user opened (kept across re-renders)
//   edit?: {                            absent for read-only content
//     enabled: boolean,                 edit mode: text can be edited, blocks deleted
//     editingId, draft,                 block whose text is being edited, and the current textarea value
//     confirmId,                        block whose delete button waits for confirmation
//     pending: Set<string>,             blocks with a write in flight
//     onTodo(node, checked), onStartEdit(node), onDraft(text), onCommit(node, text), onCancel(), onDelete(node)
//   }
// }
//
// Links are rendered as <span data-href> (handled by the page view), never as
// <a href>: the panel must not navigate and UXP gives anchors its own behaviour.

const { h, append } = require('./dom');
const { icon, pageIcon } = require('./icons');
const { canEditText, canDelete, plain: plainText } = require('../notion/edit');

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

// ---------- editing ----------

function autosize(ta) {
    ta.style.height = 'auto';
    if (ta.scrollHeight) ta.style.height = `${ta.scrollHeight + 2}px`;
}

function editArea(node, ctx) {
    const e = ctx.edit;
    const value = e.draft !== null && e.draft !== undefined ? e.draft : plainText(node.rich);
    const lines = value.split('\n').length;
    const ta = h('textarea', { class: `edit-area ${node.type === 'code' ? 'mono' : ''}`.trim(), rows: String(Math.max(1, lines)), spellcheck: 'false' });
    ta.value = value;
    let done = false;
    const commit = () => { if (!done) { done = true; e.onCommit(node, ta.value); } };
    const cancel = () => { if (!done) { done = true; e.onCancel(); } };
    ta.addEventListener('input', () => { e.onDraft(ta.value); autosize(ta); });
    ta.addEventListener('keydown', (ev) => {
        ev.stopPropagation();
        if (ev.key === 'Escape') { ev.preventDefault(); cancel(); return; }
        // Enter saves; Shift+Enter adds a line break. In code blocks, Enter is a line break and Cmd/Ctrl+Enter saves.
        if (ev.key === 'Enter' && !ev.shiftKey && (node.type !== 'code' || ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); commit(); }
    });
    ta.addEventListener('blur', commit);
    ta.addEventListener('click', (ev) => ev.stopPropagation());
    setTimeout(() => {
        if (!ta.parentNode) return;
        ta.focus();
        try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch (_) { /* UXP */ }
        autosize(ta);
    }, 0);
    return ta;
}

// Text part of a block: the rich text, or a textarea when that block is being edited.
function textEl(tag, cls, node, ctx, content) {
    const e = ctx.edit;
    if (e && e.enabled && e.editingId === node.id) return h(tag, { class: `${cls} editing`.trim() }, editArea(node, ctx));
    const editable = !!(e && e.enabled && canEditText(node) && !e.pending.has(node.id));
    const el = h(tag, { class: `${cls}${editable ? ' editable' : ''}`.trim() }, content);
    if (editable) {
        el.setAttribute('title', 'Cliquer pour modifier');
        el.addEventListener('click', (ev) => { ev.stopPropagation(); ev.preventDefault(); e.onStartEdit(node); });
    }
    return el;
}

// Edit-mode decorations on a rendered block: delete button, pending state.
function decorate(el, node, ctx) {
    const e = ctx.edit;
    if (!el || !e || el.nodeType !== 1) return el;
    if (e.pending.has(node.id)) el.classList.add('edit-pending');
    if (!e.enabled || !canDelete(node) || e.editingId === node.id) return el;
    el.classList.add('edit-block');
    const confirming = e.confirmId === node.id;
    const del = h('span', {
        class: `block-del ${confirming ? 'confirm' : ''}`.trim(), role: 'button', tabindex: '0',
        title: confirming ? 'Cliquer encore pour supprimer (corbeille Notion)' : (node.hasChildren ? 'Supprimer ce bloc et son contenu' : 'Supprimer ce bloc'),
    }, confirming ? 'Supprimer ?' : icon('trash'));
    const fire = (ev) => { ev.stopPropagation(); ev.preventDefault(); e.onDelete(node); };
    del.addEventListener('click', fire);
    del.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') fire(ev); });
    el.insertBefore(del, el.firstChild);
    return el;
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
            const p = textEl('div', `n-p ${cc} ${plain(node.rich) ? '' : 'empty'}`, node, ctx, renderRich(node.rich));
            const kids = childrenOf(node, ctx);
            return kids ? h('div', null, p, kids) : p;
        }
        case 'heading_1':
        case 'heading_2':
        case 'heading_3':
        case 'heading_4': {
            const level = Number(node.type.slice(-1));
            const hd = textEl('div', `n-h${level} ${cc}`, node, ctx, renderRich(node.rich));
            hd.setAttribute('role', 'heading');
            hd.setAttribute('aria-level', String(level));
            if (node.toggleable) {
                return toggle(node, ctx, hd, () => node.children.length ? renderBlocks(node.children, ctx) : (pendingChildren(node, ctx) || ''), `heading-toggle lvl-${level}`);
            }
            return hd;
        }
        case 'bulleted_list_item':
        case 'numbered_list_item':
            return h('li', { class: cc }, textEl('div', 'li-text', node, ctx, renderRich(node.rich)), childrenOf(node, ctx));
        case 'to_do': {
            const interactive = !!(ctx.edit && ctx.edit.onTodo && !ctx.edit.pending.has(node.id));
            const box = h('span', {
                class: `todo-box ${node.checked ? 'checked' : ''} ${interactive ? 'interactive' : ''}`.trim(),
                role: 'checkbox', 'aria-checked': node.checked ? 'true' : 'false', tabindex: interactive ? '0' : null,
                title: interactive ? (node.checked ? 'Décocher' : 'Cocher') : null,
            }, node.checked ? '✓' : '');
            if (interactive) {
                const flip = (ev) => { ev.stopPropagation(); ev.preventDefault(); ctx.edit.onTodo(node, !node.checked); };
                box.addEventListener('click', flip);
                box.addEventListener('keydown', (ev) => { if (ev.key === ' ' || ev.key === 'Enter') flip(ev); });
            }
            return h('div', { class: `n-todo ${node.checked ? 'done' : ''} ${cc}`.trim() },
                h('div', { class: 'todo-row' }, box, textEl('span', 'todo-text', node, ctx, renderRich(node.rich))),
                childrenOf(node, ctx));
        }
        case 'toggle':
            return toggle(node, ctx, textEl('span', 'toggle-text', node, ctx, renderRich(node.rich)),
                () => node.children.length ? renderBlocks(node.children, ctx) : (pendingChildren(node, ctx) || h('div', { class: 'muted small', text: 'Vide' })), cc);
        case 'quote':
            return h('div', { class: `n-quote ${cc}`.trim() }, textEl('div', 'quote-text', node, ctx, renderRich(node.rich)), childrenOf(node, ctx));
        case 'callout':
            return h('div', { class: `n-callout ${cc || 'bg-default'}` },
                node.icon ? pageIcon(node.icon, 'callout-icon') : null,
                h('div', { class: 'callout-body' }, textEl('div', 'callout-text', node, ctx, renderRich(node.rich)), childrenOf(node, ctx)));
        case 'divider':
            return h('div', { class: 'n-hr' });
        case 'code':
            return h('div', { class: 'n-code' },
                node.language && node.language !== 'plain text' ? h('div', { class: 'code-lang', text: node.language }) : null,
                textEl('pre', '', node, ctx, h('code', { text: plain(node.rich) })),
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
            list.appendChild(decorate(renderBlock(node, ctx), node, ctx));
            continue;
        }
        list = null;
        listType = null;
        const el = renderBlock(node, ctx);
        if (el) frag.appendChild(decorate(el, node, ctx));
    }
    return frag;
}

module.exports = { renderBlocks, renderBlock, renderRich };
