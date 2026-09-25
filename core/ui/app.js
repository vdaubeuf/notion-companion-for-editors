'use strict';

// UI entry point, shared by every host. Talks to the host only through
// window.companion (Resolve: preload.js over IPC; Premiere: in-process API)
// and holds UI state: current view + last state/content pushed by the host.

const { h, setChildren } = require('./dom');
const { renderHeader } = require('./header');
const { PageView } = require('./pageView');
const { SearchView } = require('./search');
const { SettingsView } = require('./settings');
const { AssociationsView } = require('./associations');

const api = window.companion;
const headerEl = document.getElementById('header');
const bodyEl = document.getElementById('body');
const toastEl = document.getElementById('toast');

const ui = {
    state: null,
    content: null,
    settings: null,
    view: 'main',       // 'main' | 'search' | 'settings' | 'associations'
    viewObj: null,
    lastAssocCount: null,
};

// Host results are { ok, data } | { ok: false, error: { code, message } }.
async function call(fn, ...args) {
    const res = await fn(...args);
    if (res && res.ok) return res.data;
    const err = new Error((res && res.error && res.error.message) || 'Erreur inattendue.');
    err.code = res && res.error ? res.error.code : 'unknown';
    throw err;
}

let toastTimer = null;
function toast(message, kind = 'info') {
    toastEl.textContent = message;
    toastEl.className = `show ${kind}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.className = ''; }, kind === 'error' ? 4500 : 2200);
}

const actions = {
    refresh: () => call(api.refresh).catch((e) => toast(e.message, 'error')),
    togglePin: async () => {
        const next = !(ui.settings && ui.settings.alwaysOnTop);
        try { ui.settings = await call(api.patchSettings, { alwaysOnTop: next }); } catch (e) { toast(e.message, 'error'); }
        renderHeaderNow();
    },
    toggleDock: async () => {
        const docked = ui.settings && ui.settings.dock && ui.settings.dock !== 'none';
        const side = docked ? 'none' : (ui.lastDockSide || 'right');
        try { ui.settings = await call(api.patchSettings, { dock: side }); } catch (e) { toast(e.message, 'error'); }
        renderHeaderNow();
    },
    openSettings: () => showView('settings'),
    openSearch: () => showView('search', { mode: 'current' }),
    openInNotion: () => call(api.openInNotion).catch((e) => toast(e.message, 'error')),
    openExternal: (url) => call(api.openExternal, url).catch((e) => toast(e.message, 'error')),
    dissociate: async () => {
        try { await call(api.dissociate); toast('Association supprimée'); } catch (e) { toast(e.message, 'error'); }
    },
    adoptSuggestion: () => call(api.adoptSuggestion).catch((e) => toast(e.message, 'error')),
    dismissSuggestion: () => call(api.dismissSuggestion).catch(() => {}),
};

const pageView = new PageView(actions);

function renderHeaderNow() {
    if (ui.settings && ui.settings.dock && ui.settings.dock !== 'none') ui.lastDockSide = ui.settings.dock;
    if (ui.state) renderHeader(headerEl, { state: ui.state, settings: ui.settings, view: ui.view }, actions);
}

function showView(view, ctx = {}) {
    ui.view = view;
    ui.viewObj = null;

    if (view === 'main') {
        setChildren(bodyEl, pageView.el);
        pageView.update(ui.state, ui.content, true);
    } else if (view === 'search') {
        const forKey = ctx.mode === 'key';
        const project = ui.state.host.project;
        const projectName = forKey ? ctx.projectName : (project && project.name);
        const v = new SearchView({
            api,
            call,
            heading: ui.state.association && !forKey ? 'Changer de page' : 'Associer une page Notion',
            subheading: projectName ? `Projet ${ui.state.host.name} : ${projectName}` : null,
            onClose: () => showView(forKey ? 'associations' : 'main'),
            onPick: async (page) => {
                if (forKey) {
                    await call(api.associateForKey, ctx.key, page.id);
                    toast('Association mise à jour');
                    showView('associations');
                } else {
                    await call(api.associate, page.id);
                    toast('Association enregistrée');
                    showView('main');
                }
            },
        });
        ui.viewObj = v;
        setChildren(bodyEl, v.el);
        v.mount();
    } else if (view === 'settings') {
        const v = new SettingsView({
            api, call, toast,
            onClose: () => showView('main'),
            onManageAssociations: () => showView('associations'),
            onSettingsChanged: (settings) => { ui.settings = settings; renderHeaderNow(); },
        });
        ui.viewObj = v;
        setChildren(bodyEl, v.el);
        v.mount(ui.state);
    } else if (view === 'associations') {
        const v = new AssociationsView({
            api, call, toast,
            onClose: () => showView('settings'),
            onChangePage: (a) => showView('search', { mode: 'key', key: a.key, projectName: a.projectName }),
        });
        ui.viewObj = v;
        setChildren(bodyEl, v.el);
        v.mount();
    }
    renderHeaderNow();
}

function onState(state) {
    ui.state = state;
    renderHeaderNow();
    if (ui.view === 'main') pageView.update(state, ui.content);
    else if (ui.view === 'settings' && ui.viewObj) ui.viewObj.update(state);
    else if (ui.view === 'associations' && ui.viewObj && state.associationCount !== ui.lastAssocCount) ui.viewObj.update(state);
    ui.lastAssocCount = state.associationCount;
}

function onContent(content) {
    ui.content = content;
    if (ui.view === 'main' && ui.state) pageView.update(ui.state, content);
}

// Narrow-panel mode (labels hidden, tighter spacing) driven by actual width.
if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver((entries) => {
        document.body.classList.toggle('narrow', entries[0].contentRect.width < 360);
    }).observe(document.body);
}

async function boot() {
    api.onState(onState);
    api.onContent(onContent);
    // The host pushes settings when they change on its side (e.g. Resolve window undocked by a drag).
    if (api.onSettings) api.onSettings((settings) => { ui.settings = settings; renderHeaderNow(); });
    try {
        ui.settings = await call(api.getSettings);
        const snap = await call(api.getSnapshot);
        ui.state = snap.state;
        ui.content = snap.content;
        ui.lastAssocCount = snap.state.associationCount;
        showView('main');
    } catch (e) {
        setChildren(bodyEl, h('div', { class: 'empty-state' }, h('p', { class: 'muted', text: `Impossible de démarrer : ${e.message}` })));
    }
}

boot();
