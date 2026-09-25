import { h } from './dom.js';
import { icon, pageIcon } from './icons.js';

export class AssociationsView {
    constructor({ api, call, toast, onClose, onChangePage }) {
        Object.assign(this, { api, call, toast, onClose, onChangePage });
        this.items = null;
        this.confirmKey = null;
        this.body = h('div', { class: 'view-scroll' });
        this.el = h('div', { class: 'view assoc-view' },
            h('div', { class: 'view-head' },
                h('button', { class: 'icon-btn', title: 'Retour', 'aria-label': 'Retour', onClick: onClose }, icon('back')),
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
        if (!this.items) { this.body.replaceChildren(h('div', { class: 'results-loading' }, h('span', { class: 'mini-spinner' }), 'Chargement…')); return; }
        if (!this.items.length) {
            this.body.replaceChildren(h('div', { class: 'results-empty muted', text: 'Aucune association pour le moment.' }));
            return;
        }
        this.body.replaceChildren(h('ul', { class: 'assoc-list' }, this.items.map((a) => {
            const meta = [a.database, a.folder].filter(Boolean).join(' · ');
            const confirming = this.confirmKey === a.key;
            return h('li', { class: `assoc ${a.isCurrent ? 'current' : ''}`.trim() },
                h('div', { class: 'assoc-main' },
                    h('div', { class: 'assoc-project ellipsis', title: a.projectName },
                        a.isCurrent ? h('span', { class: 'badge', text: 'Actif' }) : null, a.projectName),
                    h('div', { class: 'assoc-page ellipsis', title: a.pageTitle }, h('span', { class: 'arrow', text: '→' }), pageIcon(a.pageIcon), h('span', { text: a.pageTitle })),
                    h('div', { class: 'assoc-meta ellipsis', title: a.strategy === 'uid' ? 'Lié par identifiant unique Resolve' : 'Lié par base de données + nom' },
                        `${meta ? `${meta} · ` : ''}${a.strategy === 'uid' ? 'ID Resolve' : 'par nom'}`)),
                h('div', { class: 'assoc-actions' },
                    h('button', { class: 'btn small', onClick: () => this.onChangePage(a), text: 'Changer' }),
                    h('button', {
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
