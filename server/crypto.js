'use strict';
/**
 * All cryptography in one small, reviewable file.
 *
 *  - Field encryption: AES-256-GCM, random 96-bit IV per value, AAD binds the
 *    ciphertext to (table, column, row id) so a ciphertext copied into another
 *    row or column fails to decrypt.
 *  - Blind index: HMAC-SHA256 of the normalised value with a separate key, so we
 *    can enforce uniqueness and look users up without storing plaintext.
 *  - Passwords: scrypt (N=2^17, r=8, p=1 — OWASP 2024+ minimum), per-user salt,
 *    self-describing hash string so parameters can be raised later.
 *  - Tokens: 256-bit random values; only an HMAC of each is stored.
 */
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const config = require('./config');

const scrypt = promisify(crypto.scrypt);

// ---------- field encryption ----------
function encrypt(plaintext, aad) {
  if (plaintext === null || plaintext === undefined) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', config.keys.dataKey, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', config.keys.dataKeyId, iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.');
}

function decrypt(token, aad) {
  if (!token) return null;
  const [ver, keyId, ivB, tagB, ctB] = token.split('.');
  if (ver !== 'v1') throw new Error('Unknown ciphertext version');
  const key = keyId === config.keys.dataKeyId ? config.keys.dataKey : config.keys.oldDataKeys[keyId];
  if (!key) throw new Error(`No key for id ${keyId}`);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB, 'base64url'));
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ctB, 'base64url')), decipher.final()]).toString('utf8');
}

const aadFor = (table, column, rowId) => `${table}.${column}:${rowId}`;

// ---------- blind index ----------
function blindIndex(kind, normalisedValue) {
  return crypto.createHmac('sha256', config.keys.indexKey).update(`${kind}:${normalisedValue}`).digest('base64url');
}

// ---------- passwords ----------
const SCRYPT = { N: 2 ** 17, r: 8, p: 1, keylen: 32 };
const SCRYPT_MAXMEM = 256 * 1024 * 1024;

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const dk = await scrypt(password.normalize('NFKC'), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT_MAXMEM });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${dk.toString('base64url')}`;
}

// A fixed dummy hash so "user not found" takes the same time as "wrong password".
let dummyHash = null;
async function verifyPassword(password, stored) {
  if (!stored) {
    dummyHash = dummyHash || await hashPassword('timing-equaliser-not-a-real-password');
    stored = dummyHash;
    await verifyPassword(password, stored);
    return false;
  }
  const [alg, N, r, p, saltB, dkB] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(dkB, 'base64url');
  const dk = await scrypt(password.normalize('NFKC'), Buffer.from(saltB, 'base64url'), expected.length,
    { N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT_MAXMEM });
  return crypto.timingSafeEqual(dk, expected);
}

function needsRehash(stored) {
  const [, N, r, p] = (stored || '').split('$');
  return Number(N) < SCRYPT.N || Number(r) !== SCRYPT.r || Number(p) !== SCRYPT.p;
}

// ---------- tokens & OTP ----------
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const hmacToken = (value) => crypto.createHmac('sha256', config.keys.tokenKey).update(value).digest('base64url');

function otpCode() {
  // crypto.randomInt is unbiased; Math.random is not acceptable for secrets.
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

module.exports = {
  encrypt, decrypt, aadFor, blindIndex,
  hashPassword, verifyPassword, needsRehash,
  randomToken, hmacToken, otpCode, safeEqual,
  uuid: () => crypto.randomUUID(),
};
