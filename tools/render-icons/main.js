// Renders assets/icon.svg to the PNG sizes used by the plugins (dev tool, run with
// scripts/render-icons.sh — uses the Electron bundled with DaVinci Resolve).
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const SVG = fs.readFileSync(path.join(REPO, 'assets', 'icon.svg'), 'utf8');
const TARGETS = [
    ['hosts/premiere/icons/icon.png', 23],
    ['hosts/premiere/icons/icon@2x.png', 46],
    ['hosts/resolve/icons/icon.png', 512],
    ['assets/icon-256.png', 256],
];

app.disableHardwareAcceleration();
app.on('window-all-closed', () => {}); // keep running between renders
app.whenReady().then(async () => {
    for (const [rel, size] of TARGETS) {
        const win = new BrowserWindow({ width: size, height: size, show: false, transparent: true, frame: false, useContentSize: true,
            webPreferences: { offscreen: true } });
        const html = `<html><body style="margin:0;background:transparent;overflow:hidden">${SVG.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`;
        await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
        await new Promise((r) => setTimeout(r, 400));
        const img = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
        const out = path.join(REPO, rel);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, img.resize({ width: size, height: size, quality: 'best' }).toPNG());
        console.log(`✓ ${rel} (${size}px)`);
        win.destroy();
    }
    app.exit(0);
});
