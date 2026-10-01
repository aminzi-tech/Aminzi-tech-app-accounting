'use strict';
/**
 * Central configuration. Every secret comes from the environment (.env in dev,
 * a secret manager in production). The app refuses to start in production if a
 * required secret is missing or weak, instead of silently falling back.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');

// Minimal .env loader (no extra dependency). Real env vars always win.
function loadDotEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (v !== '' && process.env[m[1]] === undefined) process.env[m[1]] = v; // empty lines in .env don't block later values
  }
}
loadDotEnv();

const env = process.env;
const isProd = env.NODE_ENV === 'production';

function key32(name) {
  const raw = env[name];
  if (!raw) {
    if (isProd) throw new Error(`${name} is required in production (32 random bytes, base64).`);
    // Dev only: derive a stable key so restarts can still decrypt local data.
    // NEVER used in production (see the throw above).
    return crypto.createHash('sha256').update(`dev-only-${name}-do-not-use-in-prod`).digest();
  }
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) throw new Error(`${name} must be exactly 32 bytes, base64 encoded.`);
  return buf;
}

const appOrigin = (env.APP_ORIGIN || 'http://localhost:3000').replace(/\/$/, '');

const config = {
  root: ROOT,
  isProd,
  port: Number(env.PORT || 3000),
  appOrigin,
  trustProxy: env.TRUST_PROXY || (isProd ? '1' : 'loopback'),

  dataDir: path.resolve(ROOT, env.DATA_DIR || 'data'),
  instancesDir: path.resolve(ROOT, env.INSTANCES_DIR || 'instances'),
  sourceCacheDir: path.resolve(ROOT, env.SOURCE_CACHE_DIR || 'cache/sources'),
  registryFile: path.resolve(ROOT, env.BUSINESS_TYPES_FILE || 'config/business-types.json'),

  keys: {
    // Key-encryption: AES-256-GCM for PII columns. Rotate by adding a new id.
    dataKeyId: env.DATA_KEY_ID || 'k1',
    dataKey: key32('DATA_KEY'),
    // Optional previous key kept only for decrypting old rows during rotation.
    oldDataKeys: parseOldKeys(env.DATA_KEYS_OLD),
    // HMAC key for blind indexes (lookup by email/phone without storing plaintext).
    indexKey: key32('INDEX_KEY'),
    // HMAC key for OTP codes and session token hashing.
    tokenKey: key32('TOKEN_KEY'),
  },

  cookie: {
    // __Host- prefix forces Secure + Path=/ + no Domain → cookie can't be set by subdomains.
    name: isProd || env.COOKIE_SECURE === 'true' ? '__Host-aminzi_sid' : 'aminzi_sid',
    secure: isProd || env.COOKIE_SECURE === 'true',
  },

  session: {
    idleMinutes: Number(env.SESSION_IDLE_MINUTES || 60 * 24),        // 1 day idle
    absoluteHours: Number(env.SESSION_ABSOLUTE_HOURS || 24 * 14),    // 14 days max
  },

  otp: {
    ttlMinutes: 10,
    maxAttempts: 5,
    resendSeconds: 60,
  },

  google: {
    clientId: env.GOOGLE_CLIENT_ID || '',
    clientSecret: env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: env.GOOGLE_REDIRECT_URI || `${appOrigin}/auth/google/callback`,
  },
  get googleEnabled() { return Boolean(this.google.clientId && this.google.clientSecret); },

  mail: {
    provider: env.MAIL_PROVIDER || 'console',       // console | resend
    from: env.MAIL_FROM || 'AminZi Tech <no-reply@localhost>',
    resendApiKey: env.RESEND_API_KEY || '',
  },
  sms: {
    provider: env.SMS_PROVIDER || 'console',        // console | twilio
    twilioSid: env.TWILIO_ACCOUNT_SID || '',
    twilioToken: env.TWILIO_AUTH_TOKEN || '',
    twilioFrom: env.TWILIO_FROM || '',
  },

  provisioning: {
    // Only these hosts may be cloned from. Stops the registry being used for SSRF.
    gitAllowedHosts: (env.GIT_ALLOWED_HOSTS || 'github.com,gitlab.com').split(',').map(s => s.trim()).filter(Boolean),
    maxTemplateBytes: Number(env.MAX_TEMPLATE_MB || 50) * 1024 * 1024,
    gitTimeoutMs: 120_000,
  },
};

function parseOldKeys(raw) {
  // Format: "k0:base64key,k-1:base64key"
  const out = {};
  if (!raw) return out;
  for (const part of raw.split(',')) {
    const [id, b64] = part.split(':');
    const buf = Buffer.from(b64 || '', 'base64');
    if (id && buf.length === 32) out[id.trim()] = buf;
  }
  return out;
}

if (isProd) {
  if (!config.appOrigin.startsWith('https://')) throw new Error('APP_ORIGIN must be https:// in production.');
  if (config.mail.provider === 'console' || config.sms.provider === 'console') {
    throw new Error('MAIL_PROVIDER and SMS_PROVIDER cannot be "console" in production.');
  }
}

module.exports = config;
