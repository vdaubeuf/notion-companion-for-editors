'use strict';

const { h, setChildren, button, formatBytes } = require('./dom');
const { icon } = require('./icons');

const STATUS_TEXT = {
    ok: ['ok', 'Connecté à Notion'],
    unchecked: ['pending', 'Vérification…'],
    unconfigured: ['off', 'Notion non connecté'],
    invalid: ['err', 'Token invalide ou expiré'],
    offline: ['warn', 'Notion injoignable'],
};

function kv(k, v) {
    return h('div', { class: 'set-row kv' }, h('span', { class: 'kv-k', text: k }), h('span', { class: 'kv-v', text: v, title: v }));
}

function select(value, options, onChange) {
    const el = h('select', { class: 'select' }, options.map(([v, label]) => h('option', { value: v, text: label })));
    el.value = value;
    el.addEventListener('change', () => onChange(el.value));
    return el;
}

class SettingsView {
    constructor({ api, call, toast, onClose, onManageAssociations, onSettingsChanged }) {
        Object.assign(this, { api, call, toast, onClose, onManageAssociations, onSettingsChanged });
        this.editingToken = false;
        this.busy = null;
        this.tokenError = null;
        this.tokenInput = null;
        this.settings = null;
        this.about = null;
        this.cache = null;
        this.body = h('div', { class: 'view-scroll settings' });
        this.el = h('div', { class: 'view settings-view' },
            h('div', { class: 'view-head' },
                button({ class: 'icon-btn', title: 'Retour', 'aria-label': 'Retour', onClick: onClose }, icon('back')),
                h('div', { class: 'view-titles' }, h('div', { class: 'view-title', text: 'Paramètres' }))),
            this.body);
    }

    async mount(state) {
        this.state = state;
        this._render();
        const [settings, about, cache] = await Promise.all([
            this.call(this.api.getSettings).catch(() => null),
            this.call(this.api.about).catch(() => null),
            this.call(this.api.cacheStats).catch(() => null),
        ]);
        Object.assign(this, { settings, about, cache });
        this._render();
    }

    update(state) {
        this.state = state;
        this._render();
    }

    async _do(key, fn) {
        this.busy = key;
        this._render();
        try { return await fn(); } finally { this.busy = null; this._render(); }
    }

    _section(title, ...children) {
        return h('div', { class: 'set-section' }, h('div', { class: 'set-title', text: title }), children);
    }

    _notionSection() {
        const n = this.state.notion;
        const [cls, label] = STATUS_TEXT[n.status] || STATUS_TEXT.unchecked;
        const user = n.status === 'ok' && n.user && (n.user.name || n.user.workspace)
            ? h('span', { class: 'muted', text: ` · ${[n.user.name, n.user.workspace].filter(Boolean).join(' — ')}` }) : null;
        const statusLine = h('div', { class: 'set-row' }, h('span', { class: `dot ${cls}` }), h('span', { class: 'set-status', text: label }), user);

        const configured = n.status !== 'unconfigured';
        if (!configured || this.editingToken) {
            if (!this.tokenInput) {
                // Created once and reused across renders so a typed value survives a failed attempt.
                this.tokenInput = h('input', {
                    class: 'text-input', type: 'password', placeholder: 'Coller le Personal Access Token Notion', autocomplete: 'off', spellcheck: 'false',
                    onKeydown: (e) => {
                        if (e.key === 'Enter') this._saveToken();
                        if (e.key === 'Escape' && this.state.notion.status !== 'unconfigured') this._cancelEdit();
                    },
                });
                setTimeout(() => this.tokenInput && this.tokenInput.focus(), 0);
            }
            return this._section('Notion', statusLine,
                h('div', { class: 'set-field' }, this.tokenInput),
                this.tokenError ? h('div', { class: 'field-error', text: this.tokenError }) : null,
                h('div', { class: 'set-actions' },
                    button({ class: 'btn primary small', onClick: () => this._saveToken(), disabled: this.busy === 'save' }, this.busy === 'save' ? 'Vérification…' : 'Enregistrer et tester'),
                    configured ? button({ class: 'btn ghost small', onClick: () => this._cancelEdit() }, 'Annuler') : null),
                h('p', { class: 'hint' },
                    'Le token est vérifié puis confié au stockage sécurisé du système. Il n’est jamais affiché ni journalisé. ',
                    h('span', { class: 'link', role: 'link', tabindex: '0', onClick: () => this.api.openTokenHelp(), text: 'Créer un token' })));
        }

        return this._section('Notion', statusLine,
            h('div', { class: 'set-actions' },
                button({
                    class: 'btn small', disabled: this.busy === 'test',
                    onClick: async () => {
                        try { await this._do('test', () => this.call(this.api.testConnection)); this.toast('✓ Connecté à Notion'); } catch (e) { this.toast(e.message, 'error'); }
                    },
                }, this.busy === 'test' ? 'Test…' : 'Tester la connexion'),
                button({ class: 'btn small', onClick: () => { this.editingToken = true; this._render(); } }, 'Modifier le token'),
                button({
                    class: 'btn small ghost danger', onClick: async () => {
                        if (this.busy !== 'confirm-clear') { this.busy = 'confirm-clear'; this._render(); return; }
                        this.busy = null;
                        await this.call(this.api.clearToken).catch(() => {});
                        this.toast('Token supprimé');
                    },
                }, this.busy === 'confirm-clear' ? 'Confirmer la suppression' : 'Supprimer')));
    }

    async _saveToken() {
        if (!this.tokenInput || this.busy === 'save') return;
        const token = this.tokenInput.value;
        this.tokenError = null;
        try {
            await this._do('save', () => this.call(this.api.saveToken, token));
            this.tokenInput.value = '';
            this.tokenInput = null;
            this.editingToken = false;
            this.toast('✓ Connecté à Notion');
        } catch (e) {
            this.tokenError = e.message;
        }
        this._render();
    }

    _cancelEdit() {
        this.editingToken = false;
        this.tokenError = null;
        if (this.tokenInput) this.tokenInput.value = '';
        this.tokenInput = null;
        this._render();
    }

    _displaySection(s) {
        const caps = s.capabilities || {};
        const rows = [];
        if (caps.alwaysOnTop) {
            const box = h('input', { type: 'checkbox', checked: !!s.alwaysOnTop });
            box.addEventListener('change', () => this._patch({ alwaysOnTop: box.checked }));
            rows.push(h('label', { class: 'set-check' }, box, 'Garder la fenêtre au premier plan'));
        }
        if (caps.dock) {
            rows.push(h('div', { class: 'set-row' },
                h('span', { class: 'kv-k', text: 'Ancrer le panneau' }),
                select(s.dock, [['none', 'Non (fenêtre libre)'], ['left', 'Bord gauche'], ['right', 'Bord droit']], (v) => this._patch({ dock: v }))));
            rows.push(h('p', { class: 'hint', text: 'DaVinci Resolve ne permet pas d’intégrer un panneau tiers dans son interface : le mode ancré colle la fenêtre au bord de l’écran, sur toute la hauteur et au premier plan. Déplacer la fenêtre la détache.' }));
        }
        rows.push(h('div', { class: 'set-row' },
            h('span', { class: 'kv-k', text: 'Ouvrir les pages dans' }),
            select(s.openLinksIn, [
                ['auto', s.notionAppAvailable === false ? 'Automatique (navigateur)' : 'Automatique (app Notion si possible)'],
                ['app', 'Application Notion'],
                ['browser', 'Navigateur'],
            ], (v) => this._patch({ openLinksIn: v }))));
        return this._section('Affichage', rows);
    }

    _render() {
        if (!this.state) return;
        const s = this.settings;
        const a = this.about;
        const host = this.state.host;
        const count = this.state.associationCount;
        const caps = (s && s.capabilities) || {};

        const ident = host.identification || {};
        const strategy = host.uidSupported === true ? (ident.uid || 'Identifiant unique du projet')
            : host.uidSupported === false ? (ident.fallback || 'Nom et emplacement du projet') : '—';

        const sections = [
            this._notionSection(),
            this._section('Associations',
                h('div', { class: 'set-row' }, h('span', { text: count === 0 ? 'Aucun projet lié' : count === 1 ? '1 projet lié' : `${count} projets liés` })),
                h('div', { class: 'set-actions' }, button({ class: 'btn small', onClick: this.onManageAssociations }, 'Gérer les associations'))),
            this._section(host.name,
                kv('Version', host.version || '—'),
                kv('Identification', strategy)),
            s ? this._displaySection(s) : null,
            this._section('Cache',
                kv('Contenu', this.cache ? `${this.cache.pages} page${this.cache.pages > 1 ? 's' : ''} · ${formatBytes(this.cache.bytes)}` : '—'),
                h('div', { class: 'set-actions' }, button({
                    class: 'btn small', onClick: async () => {
                        await this.call(this.api.clearCache).catch(() => {});
                        this.cache = await this.call(this.api.cacheStats).catch(() => null);
                        this._render();
                        this.toast('Cache vidé');
                    },
                }, 'Vider le cache'))),
            this._section('À propos',
                kv(a ? a.productName : 'Notion Companion for Editors', a ? a.pluginVersion : '—'),
                kv('API Notion', a ? a.notionVersion : '—'),
                kv('Environnement', a ? `${a.runtime} · ${a.platform}` : '—'),
                a && a.dataFolder ? kv('Données', a.dataFolder) : null,
                caps.openLogs ? h('div', { class: 'set-actions' }, button({ class: 'btn small ghost', onClick: () => this.api.openLogs() }, 'Ouvrir le dossier des logs')) : null),
        ];
        setChildren(this.body, sections.filter(Boolean));
    }

    async _patch(patch) {
        try {
            this.settings = await this.call(this.api.patchSettings, patch);
            if (this.onSettingsChanged) this.onSettingsChanged(this.settings);
        } catch (e) { this.toast(e.message, 'error'); }
        this._render();
    }
}

module.exports = { SettingsView };
