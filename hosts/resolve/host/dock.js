'use strict';

// "Docked" mode.
//
// Resolve's public APIs cannot embed a third-party panel inside its own UI: a
// Workflow Integration always opens in a separate window (Workflow Integrations
// README). The closest robust alternative is to snap our window to the left or
// right edge of the screen, full work-area height, always on top.

const { screen } = require('electron');

class Docker {
    constructor(win, { getSide, onUndock }) {
        this.win = win;
        this.getSide = getSide;
        this.onUndock = onUndock;
        this.applying = false;
        this.timer = null;

        // A user-initiated drag (macOS / Windows) leaves docked mode.
        win.on('will-move', () => {
            if (!this.applying && this.getSide() !== 'none') this.onUndock();
        });
        // Keep the docked edge and full height when the user changes the width.
        win.on('resize', () => {
            if (this.applying || this.getSide() === 'none') return;
            clearTimeout(this.timer);
            this.timer = setTimeout(() => this.apply(), 150);
        });
        const reapply = () => { if (this.getSide() !== 'none') this.apply(); };
        screen.on('display-metrics-changed', reapply);
        screen.on('display-removed', reapply);
        win.on('closed', () => {
            screen.removeListener('display-metrics-changed', reapply);
            screen.removeListener('display-removed', reapply);
        });
    }

    apply() {
        const side = this.getSide();
        if (side !== 'left' && side !== 'right') return;
        const bounds = this.win.getBounds();
        const wa = screen.getDisplayMatching(bounds).workArea;
        const width = Math.max(280, Math.min(bounds.width, Math.round(wa.width / 2)));
        this.applying = true;
        this.win.setAlwaysOnTop(true, 'floating');
        this.win.setBounds({
            x: side === 'right' ? wa.x + wa.width - width : wa.x,
            y: wa.y,
            width,
            height: wa.height,
        });
        setTimeout(() => { this.applying = false; }, 300);
    }
}

module.exports = { Docker };
