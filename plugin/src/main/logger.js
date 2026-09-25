'use strict';

// Developer log: written to <userData>/logs/companion.log and to stdout.
// Every message goes through redact() so that a Notion token can never end up
// in a log file, even if some code accidentally passes it along.

const fs = require('fs');
const path = require('path');
const util = require('util');

const MAX_LOG_BYTES = 1024 * 1024;

// Notion tokens: internal integration secrets ("secret_…"), newer "ntn_…" tokens,
// plus any "Bearer <value>" fragment.
const TOKEN_PATTERNS = [
    /\b(secret_|ntn_)[A-Za-z0-9_\-]{8,}/g,
    /(Bearer\s+)[^\s"',]+/gi,
];

function redact(text) {
    let out = String(text);
    for (const re of TOKEN_PATTERNS) {
        out = out.replace(re, (m, p1) => `${p1 || ''}[REDACTED]`);
    }
    return out;
}

function formatArgs(args) {
    return args.map((a) => {
        if (a instanceof Error) return `${a.name}: ${a.message}${a.stack ? `\n${a.stack}` : ''}`;
        if (typeof a === 'string') return a;
        return util.inspect(a, { depth: 4, breakLength: 160 });
    }).join(' ');
}

class Logger {
    constructor() {
        this.file = null;
        this.extraToken = null;
    }

    init(logDir) {
        try {
            fs.mkdirSync(logDir, { recursive: true });
            this.file = path.join(logDir, 'companion.log');
            this._rotateIfNeeded();
        } catch (e) {
            this.file = null;
            console.error('[logger] cannot init log file', e.message);
        }
    }

    // Lets the logger redact the exact stored token too, whatever its format.
    setSecret(token) {
        this.extraToken = token && token.length >= 8 ? token : null;
    }

    _rotateIfNeeded() {
        if (!this.file) return;
        try {
            const st = fs.statSync(this.file);
            if (st.size > MAX_LOG_BYTES) {
                fs.renameSync(this.file, `${this.file}.1`);
            }
        } catch (_) { /* file does not exist yet */ }
    }

    _write(level, scope, args) {
        let msg = redact(formatArgs(args));
        if (this.extraToken) msg = msg.split(this.extraToken).join('[REDACTED]');
        const line = `${new Date().toISOString()} ${level.padEnd(5)} [${scope}] ${msg}`;
        if (level === 'ERROR' || level === 'WARN') console.error(line); else console.log(line);
        if (this.file) {
            try { fs.appendFileSync(this.file, line + '\n'); } catch (_) { /* ignore */ }
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

module.exports = { logger, redact };
