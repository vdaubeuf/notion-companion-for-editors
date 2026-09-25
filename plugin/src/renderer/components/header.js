import { h } from './dom.js';
import { icon } from './icons.js';

const NOTION_STATUS = {
    ok: { cls: 'ok', label: 'Notion connecté' },
    unchecked: { cls: 'pending', label: 'Vérification de Notion…' },
    unconfigured: { cls: 'off', label: 'Notion non configuré' },
    invalid: { cls: 'err', label: 'Token Notion invalide ou expiré' },
    offline: { cls: 'warn', label: 'Notion injoignable (hors ligne ?)' },
};

function iconButton(name, title, onClick, { active = false, spinning = false } = {}) {
    return h('button', { class: `icon-btn ${active ? 'active' : ''}`.trim(), title, 'aria-label': title, onClick },
        icon(name, spinning ? 'spin' : ''));
}

export function renderHeader(el, { state, settings, view }, actions) {
    const r = state.resolve;
    const project = r.project;
    const notion = NOTION_STATUS[state.notion.status] || NOTION_STATUS.unchecked;

    let title;
    let meta = [];
    if (r.status === 'ok' && project) {
        title = project.name;
        if (project.timeline) meta.push(h('span', { class: 'meta-item', title: 'Timeline active', text: project.timeline }));
    } else if (r.status === 'no_project') {
        title = 'Aucun projet ouvert';
    } else if (r.status === 'connecting') {
        title = 'Connexion à Resolve…';
    } else if (project) {
        title = project.name;
        meta.push(h('span', { class: 'meta-item warn-text', text: 'Resolve ne répond pas' }));
    } else if (r.status === 'module_missing' || r.status === 'module_load_failed') {
        title = 'Module Resolve manquant';
    } else {
        title = 'Resolve inaccessible';
    }

    const refreshing = state.page.refreshing;
    const header = h('div', { class: 'hdr' },
        h('div', { class: 'hdr-main' },
            h('div', { class: 'hdr-title', title }, h('span', { class: `dot ${notion.cls}`, title: notion.label }), h('span', { class: 'ellipsis', text: title })),
            h('div', { class: 'hdr-meta' }, meta, h('span', { class: 'meta-item', text: notion.label }))),
        h('div', { class: 'hdr-actions' },
            iconButton('refresh', 'Actualiser', actions.refresh, { spinning: refreshing }),
            iconButton(settings && settings.dock === 'left' ? 'dockLeft' : 'dockRight',
                settings && settings.dock !== 'none' ? 'Détacher le panneau' : 'Ancrer le panneau au bord de l’écran',
                actions.toggleDock, { active: !!(settings && settings.dock && settings.dock !== 'none') }),
            iconButton('pin', settings && settings.alwaysOnTop ? 'Ne plus garder au premier plan' : 'Garder au premier plan', actions.togglePin, { active: !!(settings && settings.alwaysOnTop) }),
            iconButton('gear', 'Paramètres', actions.openSettings, { active: view === 'settings' || view === 'associations' })));

    el.replaceChildren(header);
}
