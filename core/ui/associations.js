'use strict';

const { h, setChildren, button } = require('./dom');
const { icon, pageIcon } = require('./icons');

const MAX_TABS = 4;

class AssociationsView {
    constructor({ api, call, toast, onClose, onAddPage }) {
        Object.assign(this, { api, call, toast, onClose, onAddPage });
        this.items = null;
        this.confirmKey = null;
        this.body = h('div', { class: 'view-scroll' });
        this.el = h('div', { class: 'view assoc-view' },
            h('div', { class: 'view-head' },
                button({ class: 'icon-btn', title: 'Retour', 'aria-label': 'Retour', onClick: onClose }, icon('back')),
                h('div', { class: 'view-titles' }, h('div', { class: 'view-title', text: 'Associations' }))),
            this.body);
    }

    async mount() {
        await this.reload();
    }

    async reload() {
        try { this.items = await this.call(this.api.listAssociations); } catch (e) { this.items = []; this.toast(e.message, 'error'); }
        this._render();
    }

    update() {
        this.reload();
    }

    _render() {
        if (!this.items) { setChildren(this.body, h('div', { class: 'results-loading' }, h('span', { class: 'mini-spinner' }), 'Chargement…')); return; }
        if (!this.items.length) {
            setChildren(this.body, h('div', { class: 'results-empty muted', text: 'Aucune association pour le moment.' }));
            return;
        }
        setChildren(this.body, h('ul', { class: 'assoc-list' }, this.items.map((a) => {
            const meta = a.location || '';
            const confirming = this.confirmKey === a.key;
            return h('li', { class: `assoc ${a.isCurrent ? 'current' : ''}`.trim() },
                h('div', { class: 'assoc-main' },
                    h('div', { class: 'assoc-project ellipsis', title: a.projectName },
                        a.isCurrent ? h('span', { class: 'badge', text: 'Actif' }) : null, a.projectName),
                    h('div', { class: 'assoc-pages' }, (a.pages || []).map((pg) => h('div', { class: 'assoc-page', title: pg.title },
                        h('span', { class: 'arrow', text: '→' }), pageIcon(pg.icon), h('span', { class: 'ellipsis', text: pg.title }),
                        a.pages.length > 1 ? button({
                            class: 'icon-btn tiny', title: 'Retirer cette page', 'aria-label': 'Retirer cette page',
                            onClick: async () => {
                                try { await this.call(this.api.removePageForKey, a.key, pg.id); this.toast('Page retirée'); } catch (e) { this.toast(e.message, 'error'); }
                                this.reload();
                            },
                        }, icon('x')) : null))),
                    h('div', { class: 'assoc-meta ellipsis', title: a.strategy === 'uid' ? 'Lié par identifiant unique du projet' : 'Lié par emplacement / nom du projet' },
                        `${meta ? `${meta} · ` : ''}${a.strategy === 'uid' ? 'ID projet' : 'par nom'}`)),
                h('div', { class: 'assoc-actions' },
                    (a.pages || []).length < MAX_TABS ? button({ class: 'btn small', title: 'Ajouter une page (onglet)', onClick: () => this.onAddPage(a) }, icon('plus'), 'Page') : null,
                    button({
                        class: `btn small ${confirming ? 'danger-solid' : 'ghost danger'}`,
                        onClick: async () => {
                            if (!confirming) { this.confirmKey = a.key; this._render(); return; }
                            this.confirmKey = null;
                            try { await this.call(this.api.removeAssociation, a.key); this.toast('Association supprimée'); } catch (e) { this.toast(e.message, 'error'); }
                            this.reload();
                        },
                    }, confirming ? 'Confirmer' : 'Supprimer')));
        })));
    }
}

module.exports = { AssociationsView };
