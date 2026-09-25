'use strict';

// Main view: association empty-state, page toolbar, banners and content.

const { h, clear, setChildren, button, findAttr, relativeTime, formatDate } = require('./dom');
const { icon, pageIcon } = require('./icons');
const { renderBlocks } = require('./blocks');

class PageView {
    constructor(actions) {
        this.actions = actions;
        this.el = h('div', { class: 'page-view' });
        this.top = h('div', { class: 'page-top' });
        this.scroll = h('div', { class: 'page-scroll' });
        this.contentEl = h('div', { class: 'notion-content' });
        this.scroll.appendChild(this.contentEl);
        this.el.appendChild(this.top);
        this.el.appendChild(this.scroll);
        this.renderedContent = undefined;
        this.renderedPageId = null;
        this.menuOpen = false;
        this.openToggles = new Set();

        // Delegated link handling: everything opens outside the panel, validated by the host.
        const onActivate = (e) => {
            const target = findAttr(e.target, 'data-href', this.el) || findAttr(e.target, 'data-open-in-notion', this.el);
            if (!target) return;
            e.preventDefault();
            if (target.hasAttribute('data-open-in-notion')) actions.openInNotion();
            else if (target.getAttribute('data-href')) actions.openExternal(target.getAttribute('data-href'));
        };
        this.el.addEventListener('click', onActivate);
        this.el.addEventListener('keydown', (e) => { if (e.key === 'Enter') onActivate(e); });
        document.addEventListener('click', (e) => {
            if (this.menuOpen && !findAttr(e.target, 'data-menu', document.body)) {
                this.menuOpen = false;
                this._renderTop(this.last.state);
            }
        });
    }

    update(state, content, force = false) {
        this.last = { state, content };
        this._renderTop(state);
        this._renderContent(state, content, force);
    }

    _renderTop(state) {
        const a = this.actions;
        const host = state.host;
        const items = [];

        if (host.status !== 'ok' && host.status !== 'connecting' && !host.project) {
            setChildren(this.top, this._hostProblem(host));
            return;
        }
        if (host.status === 'connecting' && !host.project) {
            setChildren(this.top, h('div', { class: 'empty-state' }, h('div', { class: 'loader' }), h('p', { class: 'muted', text: `Connexion à ${host.name}…` })));
            return;
        }

        if (state.suggestion && !state.association) {
            const s = state.suggestion;
            items.push(h('div', { class: 'banner info' },
                h('div', null,
                    'Le projet « ', h('b', { text: s.projectName }), ' »',
                    s.location ? ` (${s.location})` : '',
                    ' est déjà associé à la page ', h('b', { text: s.pageTitle }),
                    '. S’agit-il du même projet (déplacé, copié ou réimporté) ?'),
                h('div', { class: 'banner-actions' },
                    button({ class: 'btn small primary', onClick: a.adoptSuggestion }, 'Utiliser cette page'),
                    button({ class: 'btn small ghost', onClick: a.dismissSuggestion }, 'Ignorer'))));
        }

        const assoc = state.association;
        if (!assoc) {
            const projectName = host.project ? host.project.name : '';
            items.push(h('div', { class: 'empty-state' },
                h('div', { class: 'empty-title', text: projectName }),
                h('p', { class: 'muted', text: 'Aucune page Notion associée à ce projet.' }),
                state.notion.status === 'unconfigured'
                    ? button({ class: 'btn primary', onClick: a.openSettings }, 'Configurer Notion')
                    : button({ class: 'btn primary', onClick: a.openSearch, disabled: !host.project }, icon('link'), 'Associer une page Notion')));
            setChildren(this.top, items);
            return;
        }

        const p = state.page;
        const status = [];
        if (p.refreshing) status.push(h('span', { class: 'status-item' }, h('span', { class: 'mini-spinner' }), p.status === 'loading' ? 'Chargement…' : 'Actualisation…'));
        if (p.fromCache && p.savedAt) status.push(h('span', { class: 'status-item cache', title: `Enregistré le ${formatDate(p.savedAt, true)}` }, icon('cloudOff'), `Cache · ${relativeTime(p.savedAt)}`));
        else if (!p.refreshing && p.savedAt) status.push(h('span', { class: 'status-item', text: `À jour · ${relativeTime(p.savedAt)}` }));

        const menu = this.menuOpen ? h('div', { class: 'menu' },
            button({ class: 'menu-item', onClick: () => { this.menuOpen = false; a.openSearch(); } }, icon('swap'), 'Changer de page'),
            button({ class: 'menu-item danger', onClick: () => { this.menuOpen = false; a.dissociate(); } }, icon('unlink'), 'Dissocier')) : null;

        items.push(h('div', { class: 'page-bar' },
            h('div', { class: 'page-bar-title', title: assoc.title }, pageIcon(assoc.icon), h('span', { class: 'ellipsis', text: assoc.title })),
            h('div', { class: 'page-bar-actions' },
                button({ class: 'btn small', onClick: a.openInNotion, title: 'Ouvrir dans Notion' }, icon('external'), h('span', { class: 'label', text: 'Ouvrir dans Notion' })),
                h('div', { class: 'menu-wrap', 'data-menu': '1' },
                    button({
                        class: `icon-btn ${this.menuOpen ? 'active' : ''}`, title: 'Plus d’actions', 'aria-label': 'Plus d’actions',
                        onClick: (e) => { e.stopPropagation(); this.menuOpen = !this.menuOpen; this._renderTop(state); },
                    }, icon('more')),
                    menu))));
        if (status.length) items.push(h('div', { class: 'page-status' }, status));

        if (p.error) items.push(this._errorBanner(state));
        if (p.truncated && p.status === 'ready' && !p.refreshing) {
            items.push(h('div', { class: 'banner subtle' }, 'Page très longue : affichage partiel. ',
                h('span', { class: 'link', 'data-open-in-notion': '1', role: 'link', tabindex: '0', text: 'Voir la page complète dans Notion' })));
        }
        setChildren(this.top, items);
    }

    _hostProblem(host) {
        const text = host.status === 'no_project'
            ? `Aucun projet ${host.name} n’est actuellement ouvert.`
            : (host.status === 'module_missing' || host.status === 'module_load_failed')
                ? 'Le module WorkflowIntegration.node est introuvable ou incompatible. Réinstallez le plugin (voir README).'
                : `${host.name} est inaccessible. Le panneau réessaie automatiquement.`;
        return h('div', { class: 'empty-state' }, h('p', { class: 'muted', text }));
    }

    _errorBanner(state) {
        const a = this.actions;
        const e = state.page.error;
        const hasContent = state.page.status === 'ready';
        const lines = [h('div', { class: 'banner-text' }, icon('alert'), h('span', { text: e.message }))];
        if (hasContent && ['network', 'timeout', 'server', 'rate_limited', 'no_token', 'unauthorized'].includes(e.code)) {
            lines.push(h('div', { class: 'banner-sub muted', text: 'La dernière version enregistrée est affichée.' }));
        }
        let btn;
        if (e.code === 'not_found' || e.code === 'restricted' || e.code === 'page_trashed') {
            btn = button({ class: 'btn small primary', onClick: a.openSearch }, 'Choisir une autre page');
        } else if (e.code === 'unauthorized' || e.code === 'no_token') {
            btn = button({ class: 'btn small primary', onClick: a.openSettings }, 'Paramètres Notion');
        } else {
            btn = button({ class: 'btn small', onClick: a.refresh }, 'Réessayer');
        }
        return h('div', { class: `banner ${hasContent ? 'warn' : 'error'}` }, lines, h('div', { class: 'banner-actions' }, btn));
    }

    _renderContent(state, content, force) {
        const assoc = state.association;
        if (!assoc) {
            if (this.renderedContent !== null) { clear(this.contentEl); this.renderedContent = null; this.openToggles.clear(); }
            this.scroll.style.display = 'none';
            return;
        }
        this.scroll.style.display = '';
        if (!force && content === this.renderedContent) return;

        const samePage = content && this.renderedPageId === (content.page && content.page.id);
        const scrollTop = this.scroll.scrollTop;
        if (!samePage) this.openToggles.clear();
        this.renderedContent = content;
        clear(this.contentEl);

        if (!content) {
            if (state.page.status === 'loading') {
                this.contentEl.appendChild(h('div', { class: 'loading-page' }, h('div', { class: 'loader' }), h('p', { class: 'muted', text: 'Chargement de la page…' })));
            }
            this.renderedPageId = null;
            return;
        }

        this.renderedPageId = content.page ? content.page.id : null;
        const titleIcon = content.page && content.page.icon ? pageIcon(content.page.icon, 'title-icon') : null;
        this.contentEl.appendChild(h('div', { class: 'n-title' }, titleIcon, h('span', { text: content.page ? content.page.title : '' })));
        this.contentEl.appendChild(renderBlocks(content.blocks, { partial: !!content.partial, openToggles: this.openToggles }));
        if (!content.blocks || content.blocks.length === 0) {
            this.contentEl.appendChild(h('p', { class: 'muted', text: content.partial ? 'Chargement de la page…' : 'Cette page est vide.' }));
        }
        if (content.partial) this.contentEl.appendChild(h('div', { class: 'loading-more' }, h('span', { class: 'mini-spinner' }), 'Chargement de la suite…'));
        if (samePage) this.scroll.scrollTop = scrollTop;
    }
}

module.exports = { PageView };
