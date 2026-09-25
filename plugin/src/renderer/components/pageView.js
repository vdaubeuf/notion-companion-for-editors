// Main view: association empty-state, page toolbar, banners and content.

import { h, clear, relativeTime } from './dom.js';
import { icon, pageIcon } from './icons.js';
import { renderBlocks } from './blocks.js';

export class PageView {
    constructor(actions) {
        this.actions = actions;
        this.el = h('div', { class: 'page-view' });
        this.top = h('div', { class: 'page-top' });
        this.scroll = h('div', { class: 'page-scroll' });
        this.contentEl = h('article', { class: 'notion-content' });
        this.scroll.appendChild(this.contentEl);
        this.el.append(this.top, this.scroll);
        this.renderedContent = undefined;
        this.renderedPageId = null;
        this.menuOpen = false;

        // Delegated link handling: everything opens outside the panel, validated by main.
        this.el.addEventListener('click', (e) => {
            const a = e.target.closest('a');
            if (!a) return;
            e.preventDefault();
            if (a.dataset.openInNotion) actions.openInNotion();
            else if (a.dataset.href) actions.openExternal(a.dataset.href);
        });
        document.addEventListener('click', (e) => {
            if (this.menuOpen && !e.target.closest('.menu-wrap')) { this.menuOpen = false; this._renderTop(this.last.state); }
        });
    }

    update(state, content, force = false) {
        this.last = { state, content };
        this._renderTop(state);
        this._renderContent(state, content, force);
    }

    _renderTop(state) {
        const a = this.actions;
        const r = state.resolve;
        const items = [];

        if (r.status !== 'ok' && r.status !== 'connecting' && !r.project) {
            items.push(this._resolveProblem(r.status));
            this.top.replaceChildren(...items);
            return;
        }
        if (r.status === 'connecting' && !r.project) {
            this.top.replaceChildren(h('div', { class: 'empty-state' }, h('div', { class: 'loader' }), h('p', { class: 'muted', text: 'Connexion à DaVinci Resolve…' })));
            return;
        }

        if (state.suggestion && !state.association) {
            const s = state.suggestion;
            items.push(h('div', { class: 'banner info' },
                h('div', null,
                    'Le projet « ', h('b', { text: s.projectName }), ' »',
                    s.folder ? ` (dossier ${s.folder})` : '',
                    ' est déjà associé à la page ', h('b', { text: s.pageTitle }),
                    '. S’agit-il du même projet (par exemple réimporté) ?'),
                h('div', { class: 'banner-actions' },
                    h('button', { class: 'btn small primary', onClick: a.adoptSuggestion, text: 'Utiliser cette page' }),
                    h('button', { class: 'btn small ghost', onClick: a.dismissSuggestion, text: 'Ignorer' }))));
        }

        const assoc = state.association;
        if (!assoc) {
            const projectName = r.project ? r.project.name : '';
            items.push(h('div', { class: 'empty-state' },
                h('div', { class: 'empty-title', text: projectName }),
                h('p', { class: 'muted', text: 'Aucune page Notion associée à ce projet.' }),
                state.notion.status === 'unconfigured'
                    ? h('button', { class: 'btn primary', onClick: a.openSettings }, 'Configurer Notion')
                    : h('button', { class: 'btn primary', onClick: a.openSearch, disabled: !r.project }, icon('link'), 'Associer une page Notion')));
            this.top.replaceChildren(...items);
            return;
        }

        const p = state.page;
        const status = [];
        if (p.refreshing) status.push(h('span', { class: 'status-item' }, h('span', { class: 'mini-spinner' }), p.status === 'loading' ? 'Chargement…' : 'Actualisation…'));
        if (p.fromCache && p.savedAt) status.push(h('span', { class: 'status-item cache', title: `Enregistré le ${new Date(p.savedAt).toLocaleString('fr-FR')}` }, icon('cloudOff'), `Cache · ${relativeTime(p.savedAt)}`));
        else if (!p.refreshing && p.savedAt) status.push(h('span', { class: 'status-item', text: `À jour · ${relativeTime(p.savedAt)}` }));

        const menu = this.menuOpen ? h('div', { class: 'menu' },
            h('button', { class: 'menu-item', onClick: () => { this.menuOpen = false; a.openSearch(); } }, icon('swap'), 'Changer de page'),
            h('button', { class: 'menu-item danger', onClick: () => { this.menuOpen = false; a.dissociate(); } }, icon('unlink'), 'Dissocier')) : null;

        items.push(h('div', { class: 'page-bar' },
            h('div', { class: 'page-bar-title', title: assoc.title }, pageIcon(assoc.icon), h('span', { class: 'ellipsis', text: assoc.title })),
            h('div', { class: 'page-bar-actions' },
                h('button', { class: 'btn small', onClick: a.openInNotion, title: 'Ouvrir dans Notion' }, icon('external'), h('span', { class: 'label', text: 'Ouvrir dans Notion' })),
                h('div', { class: 'menu-wrap' },
                    h('button', { class: `icon-btn ${this.menuOpen ? 'active' : ''}`, title: 'Plus d’actions', 'aria-label': 'Plus d’actions', onClick: (e) => { e.stopPropagation(); this.menuOpen = !this.menuOpen; this._renderTop(state); } }, icon('more')),
                    menu))));
        if (status.length) items.push(h('div', { class: 'page-status' }, status));

        if (p.error) items.push(this._errorBanner(state));
        if (p.truncated && p.status === 'ready' && !p.refreshing) {
            items.push(h('div', { class: 'banner subtle' }, 'Page très longue : affichage partiel. ',
                h('a', { href: '#', class: 'link', dataset: { openInNotion: '1' }, text: 'Voir la page complète dans Notion' })));
        }
        this.top.replaceChildren(...items);
    }

    _resolveProblem(status) {
        const text = status === 'no_project'
            ? 'Aucun projet Resolve n’est actuellement ouvert.'
            : (status === 'module_missing' || status === 'module_load_failed')
                ? 'Le module WorkflowIntegration.node est introuvable ou incompatible. Réinstallez le plugin (voir README).'
                : 'DaVinci Resolve est inaccessible. Le panneau réessaie automatiquement.';
        return h('div', { class: 'empty-state' }, h('p', { class: 'muted', text }));
    }

    _errorBanner(state) {
        const a = this.actions;
        const e = state.page.error;
        const hasContent = state.page.status === 'ready';
        const lines = [h('div', { class: 'banner-text' }, icon('alert'), h('span', { text: e.message }))];
        if (hasContent && (e.code === 'network' || e.code === 'timeout' || e.code === 'server' || e.code === 'rate_limited' || e.code === 'no_token' || e.code === 'unauthorized')) {
            lines.push(h('div', { class: 'banner-sub muted', text: 'La dernière version enregistrée est affichée.' }));
        }
        const buttons = [];
        if (e.code === 'not_found' || e.code === 'restricted' || e.code === 'page_trashed') {
            buttons.push(h('button', { class: 'btn small primary', onClick: a.openSearch, text: 'Choisir une autre page' }));
        } else if (e.code === 'unauthorized' || e.code === 'no_token') {
            buttons.push(h('button', { class: 'btn small primary', onClick: a.openSettings, text: 'Paramètres Notion' }));
        } else {
            buttons.push(h('button', { class: 'btn small', onClick: a.refresh, text: 'Réessayer' }));
        }
        return h('div', { class: `banner ${hasContent ? 'warn' : 'error'}` }, lines, h('div', { class: 'banner-actions' }, buttons));
    }

    _renderContent(state, content, force) {
        const assoc = state.association;
        if (!assoc) {
            if (this.renderedContent !== null) { clear(this.contentEl); this.renderedContent = null; }
            this.scroll.hidden = true;
            return;
        }
        this.scroll.hidden = false;
        if (!force && content === this.renderedContent) return;

        const keepScroll = content && this.renderedPageId === (content.page && content.page.id);
        const scrollTop = this.scroll.scrollTop;
        // Keep toggles the user opened when the content is re-rendered (progressive load, refresh).
        const openToggles = keepScroll
            ? new Set([...this.contentEl.querySelectorAll('details[open]')].map((d) => d.dataset.id))
            : new Set();
        this.renderedContent = content;
        clear(this.contentEl);

        if (!content) {
            if (state.page.status === 'loading') {
                this.contentEl.append(h('div', { class: 'loading-page' }, h('div', { class: 'loader' }), h('p', { class: 'muted', text: 'Chargement de la page…' })));
            }
            this.renderedPageId = null;
            return;
        }

        this.renderedPageId = content.page ? content.page.id : null;
        const titleIcon = content.page && content.page.icon ? pageIcon(content.page.icon, 'title-icon') : null;
        this.contentEl.append(
            h('h1', { class: 'n-title' }, titleIcon, h('span', { text: content.page ? content.page.title : '' })),
            renderBlocks(content.blocks, { partial: !!content.partial }));
        if (!content.blocks || content.blocks.length === 0) {
            this.contentEl.append(h('p', { class: 'muted', text: content.partial ? 'Chargement de la page…' : 'Cette page est vide.' }));
        }
        if (content.partial) this.contentEl.append(h('div', { class: 'loading-more' }, h('span', { class: 'mini-spinner' }), 'Chargement de la suite…'));
        for (const d of this.contentEl.querySelectorAll('details')) if (openToggles.has(d.dataset.id)) d.open = true;
        if (keepScroll) this.scroll.scrollTop = scrollTop;
    }
}
