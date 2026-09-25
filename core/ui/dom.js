'use strict';

// Tiny DOM helpers shared by every host UI.
//
// Content from Notion is only ever inserted as text nodes (never innerHTML),
// so it cannot inject markup or scripts.
//
// Only a conservative DOM subset is used so the same UI runs in Chromium
// (Resolve / Electron) and in Adobe UXP (Premiere): no <details>, no native
// <button>/<a> behaviour, no Element.closest / dataset / replaceChildren.

function isNode(c) {
    return c && typeof c === 'object' && typeof c.nodeType === 'number';
}

function append(el, children) {
    const flat = [];
    const walk = (list) => { for (const c of list) { if (Array.isArray(c)) walk(c); else flat.push(c); } };
    walk(children);
    for (const c of flat) {
        if (c === null || c === undefined || c === false) continue;
        el.appendChild(isNode(c) ? c : document.createTextNode(String(c)));
    }
    return el;
}

// h('div', { class, text, title, onClick, attrs... }, ...children)
// - data-* attributes are passed as 'data-foo': value
// - boolean true -> empty attribute; false/null/undefined -> skipped
function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
        for (const k of Object.keys(attrs)) {
            const v = attrs[k];
            if (v === undefined || v === null || v === false) continue;
            if (k === 'class') el.className = v;
            else if (k === 'text') el.textContent = v;
            else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
            else if (k === 'checked' || k === 'value') el[k] = v;
            else el.setAttribute(k, v === true ? '' : String(v));
        }
    }
    append(el, children);
    return el;
}

function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
}

function setChildren(el, ...children) {
    clear(el);
    return append(el, children);
}

// Clickable element with keyboard support (Enter / Space).
// opts.disabled blocks clicks and dims the element.
function button(attrs, ...children) {
    const { onClick, disabled, class: cls, ...rest } = attrs || {};
    const el = h('div', { ...rest, class: `${cls || 'btn'}${disabled ? ' disabled' : ''}`, role: 'button', tabindex: disabled ? '-1' : '0' }, ...children);
    const fire = (e) => {
        if (disabled || !onClick) return;
        onClick(e);
    };
    el.addEventListener('click', fire);
    el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fire(e); }
    });
    return el;
}

// Walks up from `node` to find an element carrying attribute `name` (stops at `stop`).
function findAttr(node, name, stop) {
    let n = node;
    while (n && n !== stop && n.nodeType === 1) {
        if (n.hasAttribute && n.hasAttribute(name)) return n;
        n = n.parentNode;
    }
    return null;
}

function relativeTime(iso) {
    if (!iso) return '';
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return '';
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 45) return 'à l’instant';
    const m = Math.round(s / 60);
    if (m < 60) return `il y a ${m} min`;
    const hr = Math.round(m / 60);
    if (hr < 24) return `il y a ${hr} h`;
    return formatDate(iso);
}

function formatDate(iso, withTime = false) {
    const d = new Date(iso);
    try {
        return withTime ? d.toLocaleString('fr-FR') : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (_) {
        return d.toISOString().slice(0, withTime ? 16 : 10).replace('T', ' ');
    }
}

function formatBytes(n) {
    if (n < 1024) return `${n} o`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`;
    return `${(n / 1024 / 1024).toFixed(1)} Mo`;
}

module.exports = { h, append, clear, setChildren, button, findAttr, relativeTime, formatDate, formatBytes };
