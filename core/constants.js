'use strict';

module.exports = Object.freeze({
    PRODUCT_NAME: 'Notion Companion for Editors',
    // Single source of truth for the version: scripts/build.sh copies it into
    // every host manifest (Resolve manifest.xml / package.json, Premiere manifest.json).
    // A pre-release suffix ("-beta.1") is published as a GitHub pre-release; manifests get the numeric part.
    PLUGIN_VERSION: '0.2.0',

    // Notion API version documented at the time of writing (see README).
    NOTION_VERSION: '2026-03-11',
    NOTION_API_BASE: 'https://api.notion.com/v1',

    // Notion content loading limits.
    MAX_BLOCKS_PER_PAGE: 3000,
    MAX_BLOCK_DEPTH: 8,

    // When the panel regains focus, check whether the page changed in Notion
    // if the last check is older than this.
    FOCUS_RECHECK_MS: 60 * 1000,

    CACHE_MAX_PAGES: 60,

    TOKEN_HELP_URL: 'https://developers.notion.com/guides/get-started/personal-access-tokens',
});
