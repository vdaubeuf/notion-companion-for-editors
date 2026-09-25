import { h, formatBytes } from './dom.js';
import { icon } from './icons.js';

const STATUS_TEXT = {
    ok: ['ok', 'Connecté à Notion'],
    unchecked: ['pending', 'Vérification…'],
    unconfigured: ['off', 'Notion non connecté'],
    invalid: ['err', 'Token invalide ou expiré'],
    offline: ['warn', 'Notion injoignable'],
};

export class SettingsView {
    constructor({ api, call, toast, onClose, onManageAssociations, onSettingsChanged }) {
        Object.assign(this, { api, call, toast, onClose, onManageAssociations, onSettingsChanged });
        this.editingToken = false;
        this.busy = null;
        this.tokenError = null;
        this.settings = null;
        this.about = null;
        this.cache = null;
        this.body = h('div', { class: 'view-scroll settings' });
        this.el = h('div', { class: 'view settings-view' },
            h('div', { class: 'view-head' },
                h('button', { class: 'icon-btn', title: 'Retour', 'aria-label': 'Retour', onClick: onClose }, icon('back')),
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
        // Do not re-render while the user types a token.
        if (!this.editingToken) this._render();
    }

    async _do(key, fn) {
        this.busy = key;
        this._render();
        try { return await fn(); } finally { this.busy = null; this._render(); }
    }

    _section(title, ...children) {
        return h('section', { class: 'set-section' }, h('h2', { class: 'set-title', text: title }), children);
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
                    h('button', { class: 'btn primary small', onClick: () => this._saveToken(), disabled: this.busy === 'save' }, this.busy === 'save' ? 'Vérification…' : 'Enregistrer et tester'),
                    configured ? h('button', { class: 'btn ghost small', onClick: () => this._cancelEdit(), text: 'Annuler' }) : null),
                h('p', { class: 'hint' },
                    'Le token est vérifié puis chiffré par le système (Trousseau macOS / DPAPI Windows). Il n’est jamais affiché ni journalisé. ',
                    h('a', { href: '#', class: 'link', onClick: (e) => { e.preventDefault(); this.api.openTokenHelp(); }, text: 'Créer un token' })));
        }

        return this._section('Notion', statusLine,
            h('div', { class: 'set-actions' },
                h('button', {
                    class: 'btn small', disabled: this.busy === 'test',
                    onClick: async () => {
                        try { await this._do('test', () => this.call(this.api.testConnection)); this.toast('✓ Connecté à Notion'); } catch (e) { this.toast(e.message, 'error'); }
                    },
                }, this.busy === 'test' ? 'Test…' : 'Tester la connexion'),
                h('button', { class: 'btn small', onClick: () => { this.editingToken = true; this._render(); }, text: 'Modifier le token' }),
                h('button', {
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

    _render() {
        if (!this.state) return;
        const s = this.settings;
        const a = this.about;
        const r = this.state.resolve;
        const count = this.state.associationCount;

        const uidSupported = r.uidSupported ?? (a && a.uidSupported);
        const strategy = uidSupported === true
            ? 'Identifiant unique Resolve (Project.GetUniqueId)'
            : uidSupported === false ? 'Base de données + nom du projet (identifiant unique indisponible)' : '—';

        const sections = [
            this._notionSection(),
            this._section('Associations',
                h('div', { class: 'set-row' }, h('span', { text: count === 0 ? 'Aucun projet lié' : count === 1 ? '1 projet lié' : `${count} projets liés` })),
                h('div', { class: 'set-actions' }, h('button', { class: 'btn small', onClick: this.onManageAssociations, text: 'Gérer les associations' }))),
            this._section('DaVinci Resolve',
                kv('Version', r.resolveVersion || '—'),
                kv('Identification', strategy)),
            s ? this._section('Affichage',
                h('label', { class: 'set-check' },
                    h('input', { type: 'checkbox', checked: !!s.alwaysOnTop, onChange: (e) => this._patch({ alwaysOnTop: e.target.checked }) }),
                    'Garder la fenêtre au premier plan'),
                h('div', { class: 'set-row' },
                    h('span', { class: 'kv-k', text: 'Ancrer le panneau' }),
                    select(s.dock, [['none', 'Non (fenêtre libre)'], ['left', 'Bord gauche'], ['right', 'Bord droit']],
                        (v) => this._patch({ dock: v }))),
                h('p', { class: 'hint', text: 'Resolve ne permet pas d’intégrer un panneau tiers dans son interface : le mode ancré colle la fenêtre au bord de l’écran, sur toute la hauteur et au premier plan. Déplacer la fenêtre la détache.' }),
                h('div', { class: 'set-row' },
                    h('span', { class: 'kv-k', text: 'Ouvrir les pages dans' }),
                    select(s.openLinksIn, [
                        ['auto', s.notionAppAvailable ? 'Automatique (app Notion)' : 'Automatique (navigateur)'],
                        ['app', 'Application Notion'],
                        ['browser', 'Navigateur'],
                    ], (v) => this._patch({ openLinksIn: v })))) : null,
            this._section('Cache',
                kv('Contenu', this.cache ? `${this.cache.pages} page${this.cache.pages > 1 ? 's' : ''} · ${formatBytes(this.cache.bytes)}` : '—'),
                h('div', { class: 'set-actions' }, h('button', {
                    class: 'btn small', onClick: async () => {
                        await this.call(this.api.clearCache).catch(() => {});
                        this.cache = await this.call(this.api.cacheStats).catch(() => null);
                        this._render();
                        this.toast('Cache vidé');
                    }, text: 'Vider le cache',
                }))),
            this._section('À propos',
                kv('Notion Companion', a ? a.pluginVersion : '—'),
                kv('API Notion', a ? a.notionVersion : '—'),
                kv('Electron', a ? `${a.electron} · ${a.platform}` : '—'),
                h('div', { class: 'set-actions' }, h('button', { class: 'btn small ghost', onClick: () => this.api.openLogs(), text: 'Ouvrir le dossier des logs' }))),
        ];
        this.body.replaceChildren(...sections.filter(Boolean));
    }

    async _patch(patch) {
        try {
            this.settings = await this.call(this.api.patchSettings, patch);
            if (this.onSettingsChanged) this.onSettingsChanged(this.settings);
        } catch (e) { this.toast(e.message, 'error'); }
        this._render();
    }
}

function kv(k, v) {
    return h('div', { class: 'set-row kv' }, h('span', { class: 'kv-k', text: k }), h('span', { class: 'kv-v', text: v }));
}

function select(value, options, onChange) {
    const el = h('select', { class: 'select', onChange: (e) => onChange(e.target.value) },
        options.map(([v, label]) => h('option', { value: v, text: label })));
    el.value = value;
    return el;
}
