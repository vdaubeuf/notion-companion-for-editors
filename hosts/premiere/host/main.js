'use strict';

// Adobe Premiere Pro host — UXP panel bootstrap.
// Bundled with core/ into panel.bundle.js by scripts/build.sh (UXP cannot load
// ES modules). Unlike Resolve there is no separate main process: the core
// controller runs in the panel, and window.companion calls it in-process with
// the same validated operations (core/operations.js).

const uxp = require('uxp');
const ppro = require('premierepro');

const C = require('core/constants');
const { logger, consoleSink } = require('core/logger');
const { Controller } = require('core/controller');
const { createOperations, runOperation, OPERATION_NAMES } = require('core/operations');
const { NotionClient } = require('core/notion/client');
const { isNotionUrl } = require('core/notion/ids');
const { AssociationStore } = require('core/storage/associations');
const { SecretStore } = require('core/storage/secrets');
const { SettingsStore } = require('core/storage/settings');
const { PageCache } = require('core/storage/cache');
const { createUxpBackend, createBufferedLogSink } = require('./uxpBackend');
const { createUxpSecretProvider } = require('./uxpSecrets');
const { PremiereWatcher } = require('./watcher');

const log = logger.scope('main');

function isAllowedExternal(url) {
    try {
        const u = new URL(url);
        return u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'mailto:';
    } catch (_) {
        return false;
    }
}

function platform() {
    try { return require('os').platform(); } catch (_) { return 'unknown'; }
}

function showFatal(message) {
    const body = document.getElementById('body');
    if (!body) return;
    while (body.firstChild) body.removeChild(body.firstChild);
    const p = document.createElement('p');
    p.className = 'muted boot';
    p.textContent = message;
    body.appendChild(p);
}

async function init() {
    // UXP's inline SVG support varies between versions: use text glyph icons.
    document.body.classList.add('glyph-icons');

    const backend = createUxpBackend(uxp);
    logger.addSink(consoleSink);
    logger.addSink(createBufferedLogSink(backend));
    const hostVersion = uxp.host && uxp.host.version ? String(uxp.host.version) : null;
    log.info(`${C.PRODUCT_NAME} ${C.PLUGIN_VERSION} (Premiere ${hostVersion || '?'}) starting — ${platform()}`);

    const settings = new SettingsStore(backend, logger.scope('settings'));
    const associations = new AssociationStore(backend, logger.scope('assoc'));
    const cache = new PageCache(backend, { maxPages: C.CACHE_MAX_PAGES, log: logger.scope('cache') });
    const secrets = new SecretStore(createUxpSecretProvider(uxp), logger.scope('secrets'), {
        onChange: (token) => logger.setSecret(token),
    });
    await Promise.all([settings.load(), associations.load(), secrets.load()]);

    const client = new NotionClient({
        getToken: () => secrets.getToken(),
        // UXP fetch: network domains are declared in manifest.json.
        fetchImpl: (url, init) => fetch(url, init),
        version: C.NOTION_VERSION,
        baseUrl: C.NOTION_API_BASE,
        log: logger.scope('notion'),
    });

    const watcher = new PremiereWatcher({ ppro, version: hostVersion, log: logger.scope('watcher') });
    const controller = new Controller({
        watcher, associations, secrets, cache, client,
        log: logger.scope('controller'),
        hostInfo: {
            id: 'premiere',
            name: 'Premiere Pro',
            timelineLabel: 'Séquence active',
            identification: {
                uid: 'Identifiant unique Premiere (Project.guid)',
                fallback: 'Chemin du fichier projet (.prproj)',
            },
        },
    });

    const shellOpen = async (url) => {
        // Resolves with '' on success, an error description otherwise.
        const res = await uxp.shell.openExternal(url, `${C.PRODUCT_NAME} ouvre ce lien.`);
        if (res) throw new Error(String(res));
    };

    const openUrl = async (url) => {
        if (!isAllowedExternal(url)) throw Object.assign(new Error('blocked url'), { code: 'invalid_input' });
        const mode = settings.get().openLinksIn;
        if (isNotionUrl(url) && mode !== 'browser') {
            try {
                await shellOpen(url.replace(/^https:\/\//, 'notion://'));
                log.info('Opened in Notion app');
                return true;
            } catch (e) {
                log.warn('Notion app not available, falling back to the browser', e.message);
            }
        }
        await shellOpen(url);
        return true;
    };

    const dataFolder = await backend.nativePath().catch(() => null);
    const actions = {
        openExternal: openUrl,
        openInNotion: () => {
            const a = controller.state.association;
            if (!a || !a.url) throw Object.assign(new Error('no association'), { code: 'not_found' });
            return openUrl(a.url);
        },
        openTokenHelp: () => shellOpen(C.TOKEN_HELP_URL),
        openLogs: () => false,
        getSettings: () => ({
            ...settings.get(),
            windowBounds: undefined,
            // A Premiere panel is docked by Premiere itself.
            capabilities: { dock: false, alwaysOnTop: false, openLogs: false },
        }),
        patchSettings: (patch) => {
            settings.patch({ openLinksIn: patch.openLinksIn });
            return actions.getSettings();
        },
        cacheStats: () => cache.stats(),
        about: () => ({
            productName: C.PRODUCT_NAME,
            pluginVersion: C.PLUGIN_VERSION,
            notionVersion: C.NOTION_VERSION,
            runtime: `UXP${uxp.versions && uxp.versions.uxp ? ` ${uxp.versions.uxp}` : ''}`,
            platform: platform(),
            dataFolder,
            encryptionAvailable: secrets.encryptionAvailable,
        }),
    };

    const operations = createOperations({ controller, actions });
    const opsLog = logger.scope('ops');
    const api = {
        onState: (cb) => { controller.on('state', cb); return () => controller.off('state', cb); },
        onContent: (cb) => { controller.on('content', cb); return () => controller.off('content', cb); },
    };
    for (const name of OPERATION_NAMES) {
        api[name] = (...args) => runOperation(operations, name, args, opsLog);
    }
    window.companion = api;

    // Boots the shared UI (core/ui/app.js reads window.companion).
    require('core/ui/app');

    watcher.start();
    if (secrets.hasToken()) {
        controller.checkNotion().catch((e) => log.warn('Initial Notion check failed', e.code || e.message));
    }

    // Re-check the page when the panel comes back into use.
    const onFocus = () => controller.onWindowFocus().catch(() => {});
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) onFocus(); });
}

init().catch((e) => {
    log.error('Startup failed', e);
    showFatal(`Impossible de démarrer ${C.PRODUCT_NAME}. Détail dans le journal du plugin.`);
});
