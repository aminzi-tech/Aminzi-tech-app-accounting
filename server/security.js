'use strict';
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const crypto = require('node:crypto');
const config = require('./config');

/** Strict headers. No inline scripts or styles anywhere, so CSP can be tight. */
function headers() {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'"],
        'img-src': ["'self'", 'data:'],
        'font-src': ["'self'"],
        'connect-src': ["'self'"],
        'form-action': ["'self'"],
        'frame-ancestors': ["'none'"],
        'base-uri': ["'none'"],
        'object-src': ["'none'"],
        ...(config.isProd ? { 'upgrade-insecure-requests': [] } : {}),
      },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    strictTransportSecurity: config.isProd ? { maxAge: 63072000, includeSubDomains: true, preload: true } : false,
  });
}

function permissionsPolicy(req, res, next) {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
  next();
}

/**
 * CSRF defence for the JSON API: state-changing requests must
 *  (1) come from our own origin (Origin header, falling back to Referer), and
 *  (2) be application/json (a cross-site <form> cannot send that without a CORS preflight).
 * Combined with SameSite=Lax cookies this closes classic CSRF.
 */
function sameOriginOnly(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  let origin = req.get('origin') || null;
  if (!origin && req.get('referer')) { try { origin = new URL(req.get('referer')).origin; } catch { origin = null; } }
  if (origin !== config.appOrigin) return res.status(403).json({ error: { message: 'Request blocked: wrong origin.' } });
  if (!req.is('application/json')) return res.status(415).json({ error: { message: 'Send JSON.' } });
  next();
}

const json429 = (req, res) => res.status(429).json({ error: { message: 'Too many attempts. Wait a few minutes and try again.' } });

const authLimiter = rateLimit({
  windowMs: 15 * 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, handler: json429,
});
const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60_000, limit: 15, standardHeaders: 'draft-7', legacyHeaders: false, handler: json429,
});

/** Short-lived, HMAC-signed cookie values (used for the Google OAuth round-trip). */
function sign(obj) {
  const body = Buffer.from(JSON.stringify(obj)).toString('base64url');
  const mac = crypto.createHmac('sha256', config.keys.tokenKey).update(`signed-cookie:${body}`).digest('base64url');
  return `${body}.${mac}`;
}
function unsign(value) {
  if (!value || typeof value !== 'string') return null;
  const [body, mac] = value.split('.');
  if (!body || !mac) return null;
  const expect = crypto.createHmac('sha256', config.keys.tokenKey).update(`signed-cookie:${body}`).digest('base64url');
  if (mac.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
  try {
    const obj = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (obj.exp && Date.now() > obj.exp) return null;
    return obj;
  } catch { return null; }
}

function cookieOpts(maxAgeMs) {
  return { httpOnly: true, secure: config.cookie.secure, sameSite: 'lax', path: '/', maxAge: maxAgeMs };
}

module.exports = { headers, permissionsPolicy, sameOriginOnly, authLimiter, otpVerifyLimiter, sign, unsign, cookieOpts };
