'use strict';

module.exports = Object.freeze({
    // Must match <Id> in manifest.xml: WorkflowIntegration.InitializePromise() validates it.
    PLUGIN_ID: 'com.saparenprod.notioncompanion',
    APP_NAME: 'Notion Companion',
    // Single source of truth: plugin/package.json (keep manifest.xml <Version> in sync).
    PLUGIN_VERSION: require('../../package.json').version,

    // Notion API version documented at the time of writing (see README).
    NOTION_VERSION: '2026-03-11',
    NOTION_API_BASE: 'https://api.notion.com/v1',

    // Resolve polling. Resolve exposes no "project changed" event to Workflow
    // Integrations (only RenderStart / RenderStop / ResolveQuit callbacks).
    POLL_INTERVAL_MS: 1500,
    POLL_INTERVAL_UNAVAILABLE_MS: 5000,
    RESOLVE_API_TIMEOUT_S: 10,

    // Notion content loading limits.
    MAX_BLOCKS_PER_PAGE: 3000,
    MAX_BLOCK_DEPTH: 8,

    // When the window regains focus, check whether the page changed in Notion
    // if the last check is older than this.
    FOCUS_RECHECK_MS: 60 * 1000,

    CACHE_MAX_PAGES: 60,
});
