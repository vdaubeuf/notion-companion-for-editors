'use strict';

// Internal error codes + the French messages shown to the user.
// Raw API messages / stacks go to the developer log only.

const USER_MESSAGES = {
    no_token: 'Notion n’est pas configuré.',
    unauthorized: 'La connexion Notion a expiré ou le token n’est plus valide.',
    restricted: 'Ce token n’a pas accès à cette page Notion.',
    not_found: 'Cette page n’est plus accessible (supprimée, déplacée ou non partagée).',
    page_trashed: 'Cette page a été placée dans la corbeille Notion.',
    rate_limited: 'Notion limite temporairement les requêtes. Nouvel essai dans quelques instants.',
    network: 'Impossible de contacter Notion.',
    timeout: 'Notion ne répond pas (délai dépassé).',
    server: 'Notion rencontre un problème temporaire.',
    validation: 'Requête refusée par Notion.',
    encryption_unavailable: 'Le stockage sécurisé du système (Trousseau / DPAPI) est indisponible : le token ne peut pas être enregistré.',
    cancelled: 'Chargement annulé.',
    no_project: 'Aucun projet Resolve n’est actuellement ouvert.',
    invalid_input: 'Donnée invalide.',
    token_rejected: 'Token refusé par Notion : vérifiez qu’il est complet, actif et doté de la capacité « Notion API ».',
    invalid_token_format: 'Ce token ne ressemble pas à un token Notion (vérifiez le copier-coller).',
    unknown: 'Une erreur inattendue est survenue.',
};

class NotionError extends Error {
    constructor(code, { status = null, notionCode = null, detail = null, retryAfterMs = null } = {}) {
        super(`${code}${status ? ` (HTTP ${status})` : ''}${notionCode ? ` ${notionCode}` : ''}${detail ? `: ${detail}` : ''}`);
        this.name = 'NotionError';
        this.code = code;
        this.status = status;
        this.notionCode = notionCode;
        this.retryAfterMs = retryAfterMs;
    }
}

function fromHttp(status, body) {
    const notionCode = body && typeof body.code === 'string' ? body.code : null;
    const detail = body && typeof body.message === 'string' ? body.message : null;
    let code;
    if (status === 401 || notionCode === 'unauthorized') code = 'unauthorized';
    else if (status === 403 || notionCode === 'restricted_resource') code = 'restricted';
    else if (status === 404 || notionCode === 'object_not_found') code = 'not_found';
    else if (status === 429 || status === 529 || notionCode === 'rate_limited') code = 'rate_limited';
    else if (status >= 500) code = 'server';
    else if (status === 400 || status === 409) code = 'validation';
    else code = 'unknown';
    return new NotionError(code, { status, notionCode, detail });
}

// Shape safe to send to the renderer.
function toUserError(err) {
    const code = err && err.code && USER_MESSAGES[err.code] ? err.code : 'unknown';
    return { code, message: USER_MESSAGES[code] };
}

module.exports = { NotionError, fromHttp, toUserError, USER_MESSAGES };
