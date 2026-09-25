'use strict';

// Notion page picker: incremental search, parent path, pagination, keyboard.

const { h, clear, button } = require('./dom');
const { icon, pageIcon } = require('./icons');

// A pasted Notion link or raw page id picks that exact page.
function idFromInput(text) {
    const m = /([0-9a-f]{32})(?:[?#&/]|$)/i.exec(text.trim().replace(/-/g, ''));
    if (!m) return null;
    return m[1];
}

class SearchView {
    /**
     * @param {{ api: object, call: Function, heading: string, subheading?: string, onPick: (page) => Promise<void>, onClose: () => void }} opts
     */
    constructor(opts) {
        this.opts = opts;
        this.seq = 0;
        this.results = [];
        this.cursor = null;
        this.loading = false;
        this.error = null;
        this.active = -1;
        this.busyId = null;
        this.parents = new Map();

        this.input = h('input', {
            class: 'search-input', type: 'text', placeholder: 'Rechercher une page Notion…', autocomplete: 'off', spellcheck: 'false',
            onInput: () => this._debounced(),
            onKeydown: (e) => this._onKey(e),
        });
        this.list = h('div', { class: 'results', role: 'listbox' });
        this.footer = h('div', { class: 'results-footer' });
        this.el = h('div', { class: 'view search-view' },
            h('div', { class: 'view-head' },
                button({ class: 'icon-btn', title: 'Retour', 'aria-label': 'Retour', onClick: opts.onClose }, icon('back')),
                h('div', { class: 'view-titles' },
                    h('div', { class: 'view-title', text: opts.heading }),
                    opts.subheading ? h('div', { class: 'view-sub', text: opts.subheading }) : null)),
            h('div', { class: 'search-box' }, icon('search'), this.input),
            h('div', { class: 'view-scroll' }, this.list, this.footer));
        this.timer = null;
        this.rows = [];
    }

    mount() {
        setTimeout(() => this.input.focus(), 0);
        this._run(false);
    }

    _debounced() {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this._run(false), 280);
    }

    async _run(append) {
        const seq = ++this.seq;
        const query = this.input.value;
        this.loading = true;
        this.error = null;
        if (!append) { this.cursor = null; this.active = -1; }
        this._render();
        try {
            const res = await this.opts.call(this.opts.api.search, query, append ? this.cursor : null);
            if (seq !== this.seq) return;
            this.results = append ? [...this.results, ...res.results] : res.results;
            this.cursor = res.nextCursor;
            this.loading = false;
            this._render();
            this._loadParents(res.results);
        } catch (e) {
            if (seq !== this.seq) return;
            this.loading = false;
            this.error = e;
            this._render();
        }
    }

    async _loadParents(items) {
        const refs = [];
        const seen = new Set();
        for (const it of items) {
            const p = it.parent;
            if (!p) continue;
            const k = `${p.type}:${p.id}`;
            if (seen.has(k) || this.parents.has(k) || p.type === 'block_id') continue;
            seen.add(k);
            refs.push(p);
        }
        if (!refs.length) return;
        try {
            const titles = await this.opts.call(this.opts.api.parents, refs);
            for (const [k, v] of Object.entries(titles)) this.parents.set(k, v);
            this._render();
        } catch (_) { /* parent path is optional */ }
    }

    _onKey(e) {
        const n = this.results.length;
        if (e.key === 'ArrowDown' && n) { e.preventDefault(); this.active = (this.active + 1) % n; this._render(); }
        else if (e.key === 'ArrowUp' && n) { e.preventDefault(); this.active = (this.active - 1 + n) % n; this._render(); }
        else if (e.key === 'Enter') {
            e.preventDefault();
            const pasted = idFromInput(this.input.value);
            if (pasted && (this.active < 0 || !n)) this._pick({ id: pasted, title: 'Page (lien collé)' });
            else if (this.active >= 0 && this.results[this.active]) this._pick(this.results[this.active]);
            else if (n === 1) this._pick(this.results[0]);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            this.opts.onClose();
        }
    }

    async _pick(page) {
        if (this.busyId) return;
        this.busyId = page.id;
        this._render();
        try {
            await this.opts.onPick(page);
        } catch (e) {
            this.error = e;
        } finally {
            this.busyId = null;
            this._render();
        }
    }

    _row(page, index) {
        const p = page.parent;
        const parentTitle = p ? this.parents.get(`${p.type}:${p.id}`) : null;
        const busy = this.busyId === page.id;
        const row = button({
            class: `result ${index === this.active ? 'active' : ''} ${busy ? 'busy' : ''}`.trim(),
            role: 'option',
            onClick: () => this._pick(page),
            onMouseenter: () => { this.active = index; this._markActive(); },
        },
        pageIcon(page.icon),
        h('span', { class: 'result-text' },
            h('span', { class: 'result-title ellipsis', text: page.title }),
            parentTitle ? h('span', { class: 'result-path ellipsis', text: `${parentTitle} / ${page.title}` }) : null),
        busy ? h('span', { class: 'mini-spinner' }) : null);
        return row;
    }

    _markActive() {
        this.rows.forEach((el, i) => el.classList.toggle('active', i === this.active));
    }

    _render() {
        clear(this.list);
        clear(this.footer);

        const pasted = idFromInput(this.input.value);
        if (pasted) {
            this.list.appendChild(button({ class: 'result pasted', onClick: () => this._pick({ id: pasted, title: 'Page (lien collé)' }) },
                icon('link'), h('span', { class: 'result-text' },
                    h('span', { class: 'result-title', text: 'Utiliser la page de ce lien' }),
                    h('span', { class: 'result-path ellipsis', text: pasted }))));
        }

        this.rows = this.results.map((r, i) => this._row(r, i));
        this.rows.forEach((row) => this.list.appendChild(row));

        if (this.error) {
            this.footer.appendChild(h('div', { class: 'banner error' }, h('div', { class: 'banner-text' }, icon('alert'), h('span', { text: this.error.message || 'Erreur' }))));
        }
        if (this.loading) {
            this.footer.appendChild(h('div', { class: 'results-loading' }, h('span', { class: 'mini-spinner' }), 'Recherche…'));
        } else if (!this.error && !this.results.length) {
            this.footer.appendChild(h('div', { class: 'results-empty muted' },
                this.input.value.trim() ? 'Aucune page trouvée.' : 'Aucune page accessible avec ce token.',
                h('div', { class: 'small', text: 'Astuce : vous pouvez aussi coller le lien d’une page Notion.' })));
        } else if (this.cursor) {
            this.footer.appendChild(button({ class: 'btn small ghost wide', onClick: () => this._run(true) }, 'Plus de résultats'));
        }
    }
}

module.exports = { SearchView };
