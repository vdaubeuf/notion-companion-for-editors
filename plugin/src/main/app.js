'use strict';

// Main process bootstrap: paths, stores, Resolve bridge, Notion client,
// window (Electron security best practices), IPC.

const path = require('path');
const { app, BrowserWindow, Menu, shell, net, safeStorage, session } = require('electron');

const C = require('./constants');
const { logger } = require('./logger');
const ipc = require('./ipc');
const { Controller } = require('./controller');
const { ResolveBridge } = require('../resolve/bridge');
const { ProjectWatcher } = require('../resolve/projectWatcher');
const { NotionClient } = require('../notion/client');
const { isNotionUrl } = require('../notion/ids');
const { AssociationStore } = require('../storage/associations');
const { SecretStore } = require('../storage/secrets');
const { SettingsStore } = require('../storage/settings');
const { PageCache } = require('../storage/cache');
const { Docker } = require('./dock');

const log = logger.scope('main');
let mainWindow = null;
let docker = null;

function isAllowedExternal(url) {
    try {
        const u = new URL(url);
        return u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'mailto:';
    } catch (_) {
        return false;
    }
}

function buildMenu() {
    const isMac = process.platform === 'darwin';
    const template = [
        ...(isMac ? [{ role: 'appMenu', label: C.APP_NAME }] : []),
        { role: 'editMenu', label: 'Édition' },
        {
            label: 'Affichage',
            submenu: [
                { role: 'reload', label: 'Recharger l’interface' },
                { role: 'toggleDevTools', label: 'Outils de développement', accelerator: isMac ? 'Alt+Command+I' : 'Ctrl+Shift+I' },
                { type: 'separator' },
                { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
            ],
        },
        ...(isMac ? [] : [{ role: 'fileMenu', label: 'Fichier', submenu: [{ role: 'quit', label: 'Quitter' }] }]),
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(settings, { onFocus }) {
    const s = settings.get();
    const b = s.windowBounds || {};
    const win = new BrowserWindow({
        width: Number.isFinite(b.width) ? b.width : 420,
        height: Number.isFinite(b.height) ? b.height : 780,
        ...(Number.isFinite(b.x) && Number.isFinite(b.y) ? { x: b.x, y: b.y } : {}),
        minWidth: 280,
        minHeight: 320,
        title: C.APP_NAME,
        backgroundColor: '#1c1c1f',
        show: false,
        autoHideMenuBar: true,
        alwaysOnTop: !!s.alwaysOnTop || s.dock !== 'none',
        webPreferences: {
            preload: path.join(__dirname, '..', '..', 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
            spellcheck: false,
        },
    });

    // No navigation, no popups: every link goes through app:openExternal.
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.webContents.on('will-attach-webview', (e) => e.preventDefault());

    win.once('ready-to-show', () => win.show());
    win.on('focus', onFocus);

    let boundsTimer = null;
    const saveBounds = () => {
        clearTimeout(boundsTimer);
        boundsTimer = setTimeout(() => {
            if (!win.isDestroyed() && !win.isMinimized()) settings.setWindowBounds(win.getBounds());
        }, 500);
    };
    win.on('resize', saveBounds);
    win.on('move', saveBounds);

    win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    if (process.env.NOTION_COMPANION_DEVTOOLS === '1') win.webContents.openDevTools({ mode: 'detach' });
    return win;
}

function start({ pluginRoot }) {
    // Stable per-user data folder, independent of how Resolve launches Electron:
    //   macOS:   ~/Library/Application Support/Notion Companion
    //   Windows: %APPDATA%\Notion Companion
    // NOTION_COMPANION_USER_DATA overrides it for development / debugging.
    app.setName(C.APP_NAME);
    app.setPath('userData', process.env.NOTION_COMPANION_USER_DATA || path.join(app.getPath('appData'), C.APP_NAME));

    if (!app.requestSingleInstanceLock()) {
        app.quit();
        return;
    }
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });

    app.whenReady().then(() => {
        const userData = app.getPath('userData');
        logger.init(path.join(userData, 'logs'));
        log.info(`${C.APP_NAME} ${C.PLUGIN_VERSION} starting — Electron ${process.versions.electron}, ${process.platform}/${process.arch}`);

        // Deny every permission request (camera, notifications, …): none is needed.
        session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));

        const settings = new SettingsStore(path.join(userData, 'settings.json'), logger.scope('settings'));
        const secrets = new SecretStore(path.join(userData, 'secrets.json'), safeStorage, logger.scope('secrets'), {
            onChange: (token) => logger.setSecret(token),
        });
        const associations = new AssociationStore(path.join(userData, 'associations.json'), logger.scope('assoc'));
        const cache = new PageCache(path.join(userData, 'cache'), { maxPages: C.CACHE_MAX_PAGES, log: logger.scope('cache') });
        logger.setSecret(secrets.getToken());

        const client = new NotionClient({
            getToken: () => secrets.getToken(),
            // Chromium network stack: honours the system proxy configuration.
            fetchImpl: (url, init) => net.fetch(url, init),
            version: C.NOTION_VERSION,
            baseUrl: C.NOTION_API_BASE,
            log: logger.scope('notion'),
        });

        const bridge = new ResolveBridge({
            pluginId: C.PLUGIN_ID,
            pluginRoot,
            apiTimeoutS: C.RESOLVE_API_TIMEOUT_S,
            log: logger.scope('resolve'),
        });
        const watcher = new ProjectWatcher({
            bridge,
            intervalMs: C.POLL_INTERVAL_MS,
            unavailableIntervalMs: C.POLL_INTERVAL_UNAVAILABLE_MS,
            log: logger.scope('watcher'),
        });
        const controller = new Controller({ watcher, associations, secrets, cache, client, log: logger.scope('controller') });

        let quitCallbackRegistered = false;
        watcher.on('change', (ws) => {
            if (!quitCallbackRegistered && ws.status !== 'unavailable' && bridge.initialized) {
                // Documented callback: close the panel when Resolve quits.
                quitCallbackRegistered = bridge.registerCallback('ResolveQuit', () => app.quit());
            }
        });

        const send = (channel, payload) => {
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
        };
        controller.on('state', (s) => send('state', s));
        controller.on('content', (c) => send('content', c));

        const notionAppAvailable = () => {
            try { return !!app.getApplicationNameForProtocol('notion://'); } catch (_) { return false; }
        };

        const openUrl = async (url) => {
            if (!isAllowedExternal(url)) throw Object.assign(new Error('blocked url'), { code: 'invalid_input' });
            const mode = settings.get().openLinksIn;
            const useApp = isNotionUrl(url) && (mode === 'app' || (mode === 'auto' && notionAppAvailable()));
            const target = useApp ? url.replace(/^https:\/\//, 'notion://') : url;
            log.info(`Opening ${useApp ? 'in Notion app' : 'externally'}: ${new URL(url).hostname}`);
            await shell.openExternal(target);
            return true;
        };

        const actions = {
            openExternal: openUrl,
            openInNotion: () => {
                const a = controller.state.association;
                if (!a || !a.url) throw Object.assign(new Error('no association'), { code: 'not_found' });
                return openUrl(a.url);
            },
            openTokenHelp: () => shell.openExternal('https://developers.notion.com/guides/get-started/personal-access-tokens'),
            openLogs: () => shell.openPath(path.join(userData, 'logs')),
            getSettings: () => ({ ...settings.get(), windowBounds: undefined, notionAppAvailable: notionAppAvailable() }),
            patchSettings: (patch) => {
                const prev = settings.get();
                const next = settings.patch(patch);
                if (mainWindow && docker) {
                    if (next.dock !== 'none' && next.dock !== prev.dock) docker.apply();
                    const onTop = next.alwaysOnTop || next.dock !== 'none';
                    if (onTop !== mainWindow.isAlwaysOnTop()) mainWindow.setAlwaysOnTop(onTop, 'floating');
                }
                return actions.getSettings();
            },
            cacheStats: () => cache.stats(),
            about: () => ({
                pluginVersion: C.PLUGIN_VERSION,
                notionVersion: C.NOTION_VERSION,
                electron: process.versions.electron,
                platform: `${process.platform}/${process.arch}`,
                resolveVersion: controller.state.resolve.resolveVersion,
                uidSupported: controller.state.resolve.uidSupported,
                userData,
                encryptionAvailable: secrets.encryptionAvailable,
            }),
        };

        ipc.register({ controller, getWindow: () => mainWindow, actions, log: logger.scope('ipc') });

        buildMenu();
        mainWindow = createWindow(settings, { onFocus: () => controller.onWindowFocus().catch(() => {}) });
        docker = new Docker(mainWindow, {
            getSide: () => settings.get().dock,
            onUndock: () => {
                settings.patch({ dock: 'none' });
                if (!settings.get().alwaysOnTop) mainWindow.setAlwaysOnTop(false);
                mainWindow.webContents.send('settings', actions.getSettings());
            },
        });
        if (settings.get().dock !== 'none') mainWindow.once('ready-to-show', () => docker.apply());
        mainWindow.on('closed', () => { mainWindow = null; app.quit(); });

        watcher.start();
        if (secrets.hasToken()) {
            controller.checkNotion().catch((e) => log.warn('Initial Notion check failed', e.code || e.message));
        }

        app.on('before-quit', () => {
            watcher.stop();
            bridge.cleanup();
            log.info('Bye');
        });
    });

    app.on('window-all-closed', () => app.quit());
}

module.exports = { start };
