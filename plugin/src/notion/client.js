'use strict';

// Minimal Notion REST client (official API, Notion-Version header pinned).
//
// - Requests go through a queue: max `concurrency` in flight and at least
//   `minIntervalMs` between two request starts (Notion: ~3 requests/second
//   average per connection on non-Enterprise plans).
// - 429 / 529 are retried after `Retry-After`; idempotent 5xx and network
//   errors are retried with exponential backoff + jitter (capped at 30 s).
// - The token is read through getToken() for each request and only placed in
//   the Authorization header. It is never logged.

const { NotionError, fromHttp } = require('./errors');

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504, 529]);

function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal && signal.aborted) return reject(new NotionError('cancelled'));
        const t = setTimeout(resolve, ms);
        if (signal) signal.addEventListener('abort', () => { clearTimeout(t); reject(new NotionError('cancelled')); }, { once: true });
    });
}

class NotionClient {
    constructor({ getToken, fetchImpl, version, baseUrl, log, concurrency = 3, minIntervalMs = 340, maxRetries = 5, timeoutMs = 20000, sleepImpl = sleep }) {
        this.getToken = getToken;
        this.fetch = fetchImpl;
        this.version = version;
        this.baseUrl = baseUrl;
        this.log = log;
        this.concurrency = concurrency;
        this.minIntervalMs = minIntervalMs;
        this.maxRetries = maxRetries;
        this.timeoutMs = timeoutMs;
        this.sleep = sleepImpl;
        this.active = 0;
        this.lastStart = 0;
        this.waiters = [];
    }

    async _acquire(signal) {
        while (this.active >= this.concurrency) {
            await new Promise((r) => this.waiters.push(r));
            if (signal && signal.aborted) throw new NotionError('cancelled');
        }
        this.active += 1;
        const wait = this.lastStart + this.minIntervalMs - Date.now();
        this.lastStart = Math.max(Date.now(), this.lastStart + this.minIntervalMs);
        if (wait > 0) {
            try { await this.sleep(wait, signal); } catch (e) { this._release(); throw e; }
        }
    }

    _release() {
        this.active -= 1;
        const next = this.waiters.shift();
        if (next) next();
    }

    /**
     * @param {'GET'|'POST'|'PATCH'} method
     * @param {string} path e.g. '/search'
     * @param {{ query?: object, body?: object, signal?: AbortSignal, token?: string }} opts
     *   `token` overrides the stored token (used by "test connection" before saving).
     */
    async request(method, path, { query, body, signal, token } = {}) {
        const authToken = token || this.getToken();
        if (!authToken) throw new NotionError('no_token');

        let url = `${this.baseUrl}${path}`;
        if (query) {
            const qs = new URLSearchParams();
            for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) qs.set(k, String(v));
            const s = qs.toString();
            if (s) url += `?${s}`;
        }

        // Reads and search are idempotent; writes are only retried on 429/529.
        const idempotent = method === 'GET' || path === '/search';

        for (let attempt = 0; ; attempt += 1) {
            if (signal && signal.aborted) throw new NotionError('cancelled');
            await this._acquire(signal);
            const started = Date.now();
            let res;
            let error = null;
            const controller = new AbortController();
            const onAbort = () => controller.abort();
            if (signal) signal.addEventListener('abort', onAbort, { once: true });
            const timer = setTimeout(() => controller.abort(), this.timeoutMs);
            try {
                res = await this.fetch(url, {
                    method,
                    headers: {
                        Authorization: `Bearer ${authToken}`,
                        'Notion-Version': this.version,
                        ...(body ? { 'Content-Type': 'application/json' } : {}),
                    },
                    body: body ? JSON.stringify(body) : undefined,
                    signal: controller.signal,
                });
            } catch (e) {
                if (signal && signal.aborted) error = new NotionError('cancelled');
                else if (controller.signal.aborted) error = new NotionError('timeout');
                else error = new NotionError('network', { detail: e && e.message });
            } finally {
                clearTimeout(timer);
                if (signal) signal.removeEventListener('abort', onAbort);
                this._release();
            }

            if (error) {
                this.log.warn(`${method} ${path} failed after ${Date.now() - started}ms: ${error.code}`);
                if (error.code === 'cancelled' || !idempotent || attempt >= 2) throw error;
                await this.sleep(this._backoff(attempt), signal);
                continue;
            }

            const text = await res.text().catch(() => '');
            let json = null;
            try { json = text ? JSON.parse(text) : null; } catch (_) { json = null; }
            this.log.debug(`${method} ${path} -> ${res.status} (${Date.now() - started}ms)`);

            if (res.ok) return json;

            const err = fromHttp(res.status, json);
            const retryAfterS = Number(res.headers && res.headers.get ? res.headers.get('retry-after') : NaN);
            const blocked = json && json.additional_data && json.additional_data.rate_limit_reason === 'public_api_request_blocked';
            const canRetry = RETRYABLE_STATUS.has(res.status) && !blocked
                && (idempotent || res.status === 429 || res.status === 529)
                && attempt < this.maxRetries;
            this.log.warn(`${method} ${path} -> HTTP ${res.status} ${err.notionCode || ''}${canRetry ? ' (retrying)' : ''}`);
            if (!canRetry) throw err;

            const wait = Number.isFinite(retryAfterS) && retryAfterS > 0
                ? Math.min(retryAfterS * 1000, 60000)
                : this._backoff(attempt);
            await this.sleep(wait, signal);
        }
    }

    _backoff(attempt) {
        const base = Math.min(30000, 1000 * 2 ** attempt);
        return Math.round(base / 2 + Math.random() * base / 2);
    }
}

module.exports = { NotionClient };
