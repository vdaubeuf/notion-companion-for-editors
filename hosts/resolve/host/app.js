'use strict';

// DaVinci Resolve host — Electron main process bootstrap:
// paths, stores, Resolve bridge, Notion client, window (Electron security best
// practices), IPC. Everything host-agnostic lives in core/.

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, Menu, shell, net, safeStorage, session } = require('electron');

const C = require('core/constants');
const { logger, consoleSink } = require('core/logger');
const { Controller } = require('core/controller');
const { createOperations } = require('core/operations');
const { NotionClient } = require('core/notion/client');
const { isNotionUrl } = require('core/notion/ids');
const { AssociationStore } = require('core/storage/associations');
const { SecretStore } = require('core/storage/secrets');
const { SettingsStore } = require('core/storage/settings');
const { PageCache } = require('core/storage/cache');
const ipc = require('./ipc');
const { Docker } = require('./dock');
const { ResolveBridge } = require('./bridge');
const { ProjectWatcher } = require('./projectWatcher');
const { createFsBackend } = require('./fsBackend');
const { createElectronSecretProvider } = require('./electronSecrets');

// Must match <Id> in manifest.xml: WorkflowIntegration.InitializePromise() validates it.
const PLUGIN_ID = 'com.saparenprod.notioncompanion';
// Internal name, kept from v0.1 on purpose: it names the data folder and the
// OS secure-storage entry, so changing it would lose existing data and token.
const INTERNAL_NAME = 'Notion Companion';

const POLL_INTERVAL_MS = 1500;
const POLL_INTERVAL_UNAVAILABLE_MS = 5000;
const RESOLVE_API_TIMEOUT_S = 10;
const MAX_LOG_BYTES = 1024 * 1024;

const log = logger.scope('main');
let mainWindow = null;
let docker = null;

function fileSink(logDir) {
    fs.mkdirSync(logDir, { recursive: true });
    const file = path.join(logDir, 'companion.log');
    try {
        if (fs.statSync(file).size > MAX_LOG_BYTES) fs.renameSync(file, `${file}.1`);
    } catch (_) { /* no log yet */ }
    return (line) => { try { fs.appendFileSync(file, `${line}\n`); } catch (_) { /* ignore */ } };
}

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
        ...(isMac ? [{ role: 'appMenu', label: C.PRODUCT_NAME }] : []),
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
        title: C.PRODUCT_NAME,
        backgroundColor: '#1c1c1f',
        icon: path.join(__dirname, '..', 'icons', 'icon.png'),
        show: false,
        autoHideMenuBar: true,
        alwaysOnTop: !!s.alwaysOnTop || s.dock !== 'none',
        webPreferences: {
            preload: path.join(__dirname, '..', 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
            spellcheck: false,
        },
    });

    // No navigation, no popups: every link goes through the openExternal operation.
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

async function init(pluginRoot) {
    const userData = app.getPath('userData');
    logger.addSink(consoleSink);
    logger.addSink(fileSink(path.join(userData, 'logs')));
    log.info(`${C.PRODUCT_NAME} ${C.PLUGIN_VERSION} (Resolve) starting — Electron ${process.versions.electron}, ${process.platform}/${process.arch}`);

    // Deny every permission request (camera, notifications, …): none is needed.
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));

    const backend = createFsBackend(userData);
    const settings = new SettingsStore(backend, logger.scope('settings'));
    const associations = new AssociationStore(backend, logger.scope('assoc'));
    const cache = new PageCache(backend, { maxPages: C.CACHE_MAX_PAGES, log: logger.scope('cache') });
    const secrets = new SecretStore(createElectronSecretProvider(safeStorage, backend, logger.scope('secrets')), logger.scope('secrets'), {
        onChange: (token) => logger.setSecret(token),
    });
    await Promise.all([settings.load(), associations.load(), secrets.load()]);

    const client = new NotionClient({
        getToken: () => secrets.getToken(),
        // Chromium network stack: honours the system proxy configuration.
        fetchImpl: (url, init) => net.fetch(url, init),
        version: C.NOTION_VERSION,
        baseUrl: C.NOTION_API_BASE,
        log: logger.scope('notion'),
    });

    const bridge = new ResolveBridge({ pluginId: PLUGIN_ID, pluginRoot, apiTimeoutS: RESOLVE_API_TIMEOUT_S, log: logger.scope('resolve') });
    const watcher = new ProjectWatcher({
        bridge,
        intervalMs: POLL_INTERVAL_MS,
        unavailableIntervalMs: POLL_INTERVAL_UNAVAILABLE_MS,
        log: logger.scope('watcher'),
    });
    const controller = new Controller({
        watcher, associations, secrets, cache, client,
        log: logger.scope('controller'),
        hostInfo: {
            id: 'resolve',
            name: 'DaVinci Resolve',
            timelineLabel: 'Timeline active',
            identification: {
                uid: 'Identifiant unique Resolve (Project.GetUniqueId)',
                fallback: 'Base de données + nom du projet (identifiant unique indisponible)',
            },
        },
    });

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
        openTokenHelp: () => shell.openExternal(C.TOKEN_HELP_URL),
        openLogs: () => shell.openPath(path.join(userData, 'logs')),
        getSettings: () => ({
            ...settings.get(),
            windowBounds: undefined,
            notionAppAvailable: notionAppAvailable(),
            capabilities: { dock: true, alwaysOnTop: true, openLogs: true },
        }),
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
            productName: C.PRODUCT_NAME,
            pluginVersion: C.PLUGIN_VERSION,
            notionVersion: C.NOTION_VERSION,
            runtime: `Electron ${process.versions.electron}`,
            platform: `${process.platform}/${process.arch}`,
            dataFolder: userData,
            encryptionAvailable: secrets.encryptionAvailable,
        }),
    };

    ipc.register({ operations: createOperations({ controller, actions }), getWindow: () => mainWindow, log: logger.scope('ipc') });

    buildMenu();
    // macOS: show the plugin icon in the Dock instead of the generic Electron one.
    if (process.platform === 'darwin' && app.dock) {
        try { app.dock.setIcon(path.join(__dirname, '..', 'icons', 'icon.png')); } catch (_) { /* cosmetic */ }
    }
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
}

function start({ pluginRoot }) {
    // Stable per-user data folder, independent of how Resolve launches Electron:
    //   macOS:   ~/Library/Application Support/Notion Companion
    //   Windows: %APPDATA%\Notion Companion
    // NOTION_COMPANION_USER_DATA overrides it for development / debugging.
    app.setName(INTERNAL_NAME);
    app.setPath('userData', process.env.NOTION_COMPANION_USER_DATA || path.join(app.getPath('appData'), INTERNAL_NAME));

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

    app.whenReady().then(() => init(pluginRoot)).catch((e) => {
        log.error('Startup failed', e);
        app.quit();
    });
    app.on('window-all-closed', () => app.quit());
}

module.exports = { start };
