'use strict';

// Developer log. Each host plugs in its own sinks (file, console…).
// Every message goes through redact() so that a Notion token can never end up
// in a log, even if some code accidentally passes it along.

// Notion tokens: internal integration secrets ("secret_…"), "ntn_…" tokens,
// plus any "Bearer <value>" fragment.
const TOKEN_PATTERNS = [
    /\b(secret_|ntn_)[A-Za-z0-9_\-]{8,}/g,
    // Google OAuth access / refresh tokens.
    /\b(ya29\.)[A-Za-z0-9_\-.]{8,}/g,
    /\b(1\/\/)[A-Za-z0-9_\-]{8,}/g,
    /(Bearer\s+)[^\s"',]+/gi,
];

function redact(text) {
    let out = String(text);
    for (const re of TOKEN_PATTERNS) {
        out = out.replace(re, (m, p1) => `${p1 || ''}[REDACTED]`);
    }
    return out;
}

function inspect(value) {
    if (value instanceof Error) return `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ''}`;
    if (typeof value === 'string') return value;
    try {
        return JSON.stringify(value);
    } catch (_) {
        return String(value);
    }
}

class Logger {
    constructor() {
        this.sinks = [];
        this.secrets = [];
    }

    addSink(fn) {
        this.sinks.push(fn);
    }

    // Lets the logger redact the exact stored tokens too, whatever their format.
    setSecrets(tokens) {
        this.secrets = (tokens || []).filter((t) => typeof t === 'string' && t.length >= 8);
    }

    setSecret(token) {
        this.setSecrets(token ? [token] : []);
    }

    _write(level, scope, args) {
        let msg = redact(args.map(inspect).join(' '));
        for (const secret of this.secrets) msg = msg.split(secret).join('[REDACTED]');
        const line = `${new Date().toISOString()} ${level.padEnd(5)} [${scope}] ${msg}`;
        for (const sink of this.sinks) {
            try { sink(line, level); } catch (_) { /* never throw from logging */ }
        }
    }

    scope(name) {
        return {
            debug: (...a) => this._write('DEBUG', name, a),
            info: (...a) => this._write('INFO', name, a),
            warn: (...a) => this._write('WARN', name, a),
            error: (...a) => this._write('ERROR', name, a),
        };
    }
}

const logger = new Logger();

function consoleSink(line, level) {
    if (level === 'ERROR' || level === 'WARN') console.error(line); else console.log(line);
}

module.exports = { logger, redact, consoleSink, Logger };
