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
        this.editing = null;     // null | 'new' | <account id> whose token is being replaced
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

    _accountLabel(acc) {
        return [acc.name, acc.workspace].filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).join(' — ') || 'Compte Notion';
    }

    // Token field, reused across renders so a typed value survives a failed attempt.
    _tokenField(target) {
        if (!this.tokenInput) {
            this.tokenInput = h('input', {
                class: 'text-input', type: 'password', placeholder: 'Coller le Personal Access Token Notion', autocomplete: 'off', spellcheck: 'false',
                onKeydown: (e) => {
                    if (e.key === 'Enter') this._saveToken(target);
                    if (e.key === 'Escape' && this.state.notion.accounts.length) this._cancelEdit();
                },
            });
            setTimeout(() => this.tokenInput && this.tokenInput.focus(), 0);
        }
        const canCancel = this.state.notion.accounts.length > 0;
        return h('div', { class: 'token-form' },
            h('div', { class: 'set-field' }, this.tokenInput),
            this.tokenError ? h('div', { class: 'field-error', text: this.tokenError }) : null,
            h('div', { class: 'set-actions' },
                button({ class: 'btn primary small', onClick: () => this._saveToken(target), disabled: this.busy === 'save' }, this.busy === 'save' ? 'Vérification…' : 'Enregistrer et tester'),
                canCancel ? button({ class: 'btn ghost small', onClick: () => this._cancelEdit() }, 'Annuler') : null));
    }

    _accountRow(acc) {
        const [cls, label] = STATUS_TEXT[acc.status] || STATUS_TEXT.unchecked;
        const confirmKey = `confirm-clear:${acc.id}`;
        const multiple = this.state.notion.accounts.length > 1;
        return h('div', { class: 'account' },
            h('div', { class: 'set-row' },
                h('span', { class: `dot ${cls}`, title: label }),
                h('span', { class: 'set-status ellipsis', text: acc.status === 'ok' ? this._accountLabel(acc) : label, title: this._accountLabel(acc) }),
                multiple && acc.id === this.state.notion.defaultId ? h('span', { class: 'badge', text: 'Par défaut' }) : null),
            acc.status !== 'ok' && (acc.name || acc.workspace) ? h('div', { class: 'account-sub muted', text: this._accountLabel(acc) }) : null,
            this.editing === acc.id ? this._tokenField(acc.id) : h('div', { class: 'set-actions' },
                button({
                    class: 'btn small', disabled: this.busy === `test:${acc.id}`,
                    onClick: async () => {
                        try { await this._do(`test:${acc.id}`, () => this.call(this.api.testConnection, acc.id)); this.toast('✓ Connecté à Notion'); } catch (e) { this.toast(e.message, 'error'); }
                    },
                }, this.busy === `test:${acc.id}` ? 'Test…' : 'Tester'),
                button({ class: 'btn small', onClick: () => this._startEdit(acc.id) }, 'Remplacer le token'),
                button({
                    class: `btn small ${this.busy === confirmKey ? 'danger-solid' : 'ghost danger'}`, onClick: async () => {
                        if (this.busy !== confirmKey) { this.busy = confirmKey; this._render(); return; }
                        this.busy = null;
                        await this.call(this.api.clearToken, acc.id).catch(() => {});
                        this.toast('Compte retiré');
                    },
                }, this.busy === confirmKey ? 'Confirmer' : 'Retirer')));
    }

    _notionSection() {
        const accounts = this.state.notion.accounts || [];
        const hint = h('p', { class: 'hint' },
            'Chaque token est vérifié puis confié au stockage sécurisé du système. Il n’est jamais affiché ni journalisé. Un token par espace de travail Notion. ',
            h('span', { class: 'link', role: 'link', tabindex: '0', onClick: () => this.api.openTokenHelp(), text: 'Créer un token' }));
        if (!accounts.length) {
            return this._section('Notion',
                h('div', { class: 'set-row' }, h('span', { class: 'dot off' }), h('span', { class: 'set-status', text: STATUS_TEXT.unconfigured[1] })),
                this._tokenField(null), hint);
        }
        return this._section(accounts.length > 1 ? `Notion · ${accounts.length} comptes` : 'Notion',
            accounts.map((acc) => this._accountRow(acc)),
            this.editing === 'new'
                ? h('div', { class: 'account' }, h('div', { class: 'set-row' }, h('span', { class: 'set-status', text: 'Nouveau compte' })), this._tokenField(null))
                : h('div', { class: 'set-actions' }, button({ class: 'btn small', onClick: () => this._startEdit('new') }, icon('plus'), 'Ajouter un compte Notion')),
            hint);
    }

    _startEdit(target) {
        this.editing = target;
        this.tokenError = null;
        this.tokenInput = null;
        this._render();
    }

    async _saveToken(target) {
        if (!this.tokenInput || this.busy === 'save') return;
        const token = this.tokenInput.value;
        this.tokenError = null;
        try {
            const acc = await this._do('save', () => this.call(this.api.saveToken, token, target || undefined));
            this.tokenInput.value = '';
            this.tokenInput = null;
            this.editing = null;
            this.toast(`✓ Connecté à Notion${acc && acc.workspace ? ` (${acc.workspace})` : ''}`);
        } catch (e) {
            this.tokenError = e.message;
        }
        this._render();
    }

    _cancelEdit() {
        this.editing = null;
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
