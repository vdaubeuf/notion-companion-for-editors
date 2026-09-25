'use strict';

const { h, setChildren, button } = require('./dom');
const { icon } = require('./icons');

const NOTION_STATUS = {
    ok: { cls: 'ok', label: 'Notion connecté' },
    unchecked: { cls: 'pending', label: 'Vérification de Notion…' },
    unconfigured: { cls: 'off', label: 'Notion non configuré' },
    invalid: { cls: 'err', label: 'Token Notion invalide ou expiré' },
    offline: { cls: 'warn', label: 'Notion injoignable (hors ligne ?)' },
};

function iconButton(name, title, onClick, { active = false, spinning = false } = {}) {
    return button({ class: `icon-btn ${active ? 'active' : ''}`.trim(), title, 'aria-label': title, onClick },
        icon(name, spinning ? 'spin' : ''));
}

function renderHeader(el, { state, settings, view }, actions) {
    const host = state.host;
    const hostName = host.name;
    const project = host.project;
    const notion = NOTION_STATUS[state.notion.status] || NOTION_STATUS.unchecked;
    const caps = (settings && settings.capabilities) || {};

    let title;
    const meta = [];
    if (host.status === 'ok' && project) {
        title = project.name;
        if (project.timeline) meta.push(h('span', { class: 'meta-item', title: host.timelineLabel || 'Timeline active', text: project.timeline }));
    } else if (host.status === 'no_project') {
        title = 'Aucun projet ouvert';
    } else if (host.status === 'connecting') {
        title = `Connexion à ${hostName}…`;
    } else if (project) {
        title = project.name;
        meta.push(h('span', { class: 'meta-item warn-text', text: `${hostName} ne répond pas` }));
    } else if (host.status === 'module_missing' || host.status === 'module_load_failed') {
        title = `Module ${hostName} manquant`;
    } else {
        title = `${hostName} inaccessible`;
    }

    const docked = !!(settings && settings.dock && settings.dock !== 'none');
    const actionsRow = [iconButton('refresh', 'Actualiser', actions.refresh, { spinning: state.page.refreshing })];
    if (caps.dock) {
        actionsRow.push(iconButton(settings.dock === 'left' ? 'dockLeft' : 'dockRight',
            docked ? 'Détacher le panneau' : 'Ancrer le panneau au bord de l’écran', actions.toggleDock, { active: docked }));
    }
    if (caps.alwaysOnTop) {
        actionsRow.push(iconButton('pin', settings.alwaysOnTop ? 'Ne plus garder au premier plan' : 'Garder au premier plan',
            actions.togglePin, { active: !!settings.alwaysOnTop }));
    }
    actionsRow.push(iconButton('gear', 'Paramètres', actions.openSettings, { active: view === 'settings' || view === 'associations' }));

    setChildren(el, h('div', { class: 'hdr' },
        h('div', { class: 'hdr-main' },
            h('div', { class: 'hdr-title', title }, h('span', { class: `dot ${notion.cls}`, title: notion.label }), h('span', { class: 'ellipsis', text: title })),
            h('div', { class: 'hdr-meta' }, meta, h('span', { class: 'meta-item', text: notion.label }))),
        h('div', { class: 'hdr-actions' }, actionsRow)));
}

module.exports = { renderHeader };
