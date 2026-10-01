'use strict';
/**
 * Data access for users, sessions, OTP codes and the audit log.
 * Only this file knows which columns are encrypted; routes work with plain objects.
 */
const c = require('./crypto');
const config = require('./config');

const now = () => Date.now();

function createStore(db) {
  // ---------------- users ----------------
  const users = {
    create({ id = c.uuid(), status, businessName, businessType, email, phone, passwordHash = null, googleSub = null, emailVerified = false, phoneVerified = false }) {
      const t = now();
      db.prepare(`INSERT INTO users (id, status, business_name_enc, business_type, email_enc, email_idx, email_verified,
          phone_enc, phone_idx, phone_verified, password_hash, google_sub, created_at, updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        id, status,
        c.encrypt(businessName, c.aadFor('users', 'business_name', id)), businessType,
        email ? c.encrypt(email, c.aadFor('users', 'email', id)) : null, email ? c.blindIndex('email', email) : null, emailVerified ? 1 : 0,
        phone ? c.encrypt(phone, c.aadFor('users', 'phone', id)) : null, phone ? c.blindIndex('phone', phone) : null, phoneVerified ? 1 : 0,
        passwordHash, googleSub, t, t,
      );
      return id;
    },
    byId: (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id),
    byEmail: (email) => db.prepare('SELECT * FROM users WHERE email_idx = ?').get(c.blindIndex('email', email)),
    byPhone: (phone) => db.prepare('SELECT * FROM users WHERE phone_idx = ?').get(c.blindIndex('phone', phone)),
    byGoogleSub: (sub) => db.prepare('SELECT * FROM users WHERE google_sub = ?').get(sub),
    activate(id, { emailVerified, phoneVerified } = {}) {
      db.prepare(`UPDATE users SET status='active',
        email_verified = CASE WHEN ? THEN 1 ELSE email_verified END,
        phone_verified = CASE WHEN ? THEN 1 ELSE phone_verified END,
        updated_at = ? WHERE id = ?`).run(emailVerified ? 1 : 0, phoneVerified ? 1 : 0, now(), id);
    },
    markVerified(id, channel) {
      const col = channel === 'email' ? 'email_verified' : 'phone_verified'; // whitelisted, never user input
      db.prepare(`UPDATE users SET ${col} = 1, updated_at = ? WHERE id = ?`).run(now(), id);
    },
    releaseEmail(id) {
      db.prepare('UPDATE users SET email_enc = NULL, email_idx = NULL, email_verified = 0, updated_at = ? WHERE id = ? AND email_verified = 0').run(now(), id);
    },
    linkGoogle(id, sub) {
      db.prepare('UPDATE users SET google_sub = ?, updated_at = ? WHERE id = ?').run(sub, now(), id);
    },
    setPasswordHash(id, hash) {
      db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(hash, now(), id);
    },
    deletePendingOlderThan(ms) {
      db.prepare("DELETE FROM users WHERE status = 'pending' AND created_at < ?").run(now() - ms);
    },
    delete: (id) => db.prepare('DELETE FROM users WHERE id = ?').run(id),
    /** Decrypted view for the owner only. Never send password_hash / google_sub / idx columns. */
    view(u) {
      if (!u) return null;
      return {
        id: u.id,
        status: u.status,
        businessName: c.decrypt(u.business_name_enc, c.aadFor('users', 'business_name', u.id)),
        businessType: u.business_type,
        email: c.decrypt(u.email_enc, c.aadFor('users', 'email', u.id)),
        emailVerified: !!u.email_verified,
        phone: c.decrypt(u.phone_enc, c.aadFor('users', 'phone', u.id)),
        phoneVerified: !!u.phone_verified,
        hasPassword: !!u.password_hash,
        googleLinked: !!u.google_sub,
        createdAt: u.created_at,
      };
    },
  };

  // ---------------- sessions ----------------
  const sessions = {
    create(userId, uaHint = '') {
      const token = c.randomToken(32);
      const t = now();
      db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at, ua_hint) VALUES (?,?,?,?,?,?)')
        .run(c.hmacToken(token), userId, t, t, t + config.session.absoluteHours * 3600_000, String(uaHint).slice(0, 120));
      return token;
    },
    resolve(token) {
      if (!token || typeof token !== 'string' || token.length > 100) return null;
      const h = c.hmacToken(token);
      const s = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(h);
      if (!s) return null;
      const t = now();
      if (t > s.expires_at || t - s.last_seen_at > config.session.idleMinutes * 60_000) {
        db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(h);
        return null;
      }
      if (t - s.last_seen_at > 5 * 60_000) db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?').run(t, h);
      return s;
    },
    destroy: (token) => token && db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(c.hmacToken(token)),
    destroyAllForUser: (userId) => db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId),
    countForUser: (userId) => db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(userId).n,
  };

  // ---------------- one-time codes ----------------
  const otp = {
    /** Returns { code } or { retryAfter } when called too soon / too often. */
    issue({ purpose, channel, targetIdx, userId = null }) {
      const t = now();
      const last = db.prepare('SELECT created_at FROM otp_codes WHERE target_idx = ? AND purpose = ? ORDER BY created_at DESC LIMIT 1').get(targetIdx, purpose);
      if (last && t - last.created_at < config.otp.resendSeconds * 1000) {
        return { retryAfter: Math.ceil((config.otp.resendSeconds * 1000 - (t - last.created_at)) / 1000) };
      }
      const hourCount = db.prepare('SELECT COUNT(*) AS n FROM otp_codes WHERE target_idx = ? AND created_at > ?').get(targetIdx, t - 3600_000).n;
      if (hourCount >= 5) return { retryAfter: 3600 };
      // Invalidate older unused codes for the same target+purpose.
      db.prepare('UPDATE otp_codes SET used_at = ? WHERE target_idx = ? AND purpose = ? AND used_at IS NULL').run(t, targetIdx, purpose);
      const code = c.otpCode();
      db.prepare('INSERT INTO otp_codes (id, purpose, channel, target_idx, user_id, code_hash, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(c.uuid(), purpose, channel, targetIdx, userId, c.hmacToken(`${purpose}:${targetIdx}:${code}`), t, t + config.otp.ttlMinutes * 60_000);
      return { code };
    },
    /** Returns the otp row on success, otherwise null. Burns an attempt either way. */
    consume({ purpose, targetIdx, code }) {
      const t = now();
      const row = db.prepare('SELECT * FROM otp_codes WHERE target_idx = ? AND purpose = ? AND used_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1')
        .get(targetIdx, purpose, t);
      if (!row) return null;
      if (row.attempts >= config.otp.maxAttempts) {
        db.prepare('UPDATE otp_codes SET used_at = ? WHERE id = ?').run(t, row.id);
        return null;
      }
      db.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?').run(row.id);
      if (!c.safeEqual(row.code_hash, c.hmacToken(`${purpose}:${targetIdx}:${code}`))) return null;
      db.prepare('UPDATE otp_codes SET used_at = ? WHERE id = ?').run(t, row.id);
      return row;
    },
    purgeExpired: () => db.prepare('DELETE FROM otp_codes WHERE expires_at < ?').run(now() - 24 * 3600_000),
  };

  // ---------------- google pending (signup with Google before profile completion) ----------------
  const oauthPending = {
    create({ googleSub, email }) {
      const id = c.uuid();
      const t = now();
      db.prepare('INSERT INTO oauth_pending (id, google_sub, email_enc, email_idx, created_at, expires_at) VALUES (?,?,?,?,?,?)')
        .run(id, googleSub, c.encrypt(email, c.aadFor('oauth_pending', 'email', id)), c.blindIndex('email', email), t, t + 30 * 60_000);
      return id;
    },
    get(id) {
      const row = db.prepare('SELECT * FROM oauth_pending WHERE id = ? AND expires_at > ?').get(id, now());
      if (!row) return null;
      return { id: row.id, googleSub: row.google_sub, email: c.decrypt(row.email_enc, c.aadFor('oauth_pending', 'email', row.id)) };
    },
    delete: (id) => db.prepare('DELETE FROM oauth_pending WHERE id = ?').run(id),
  };

  // ---------------- instances ----------------
  const instances = {
    byUser: (userId) => db.prepare('SELECT * FROM instances WHERE user_id = ?').get(userId),
    byId: (id) => db.prepare('SELECT * FROM instances WHERE id = ?').get(id),
    create({ userId, businessType, sourceKind, sourceRef }) {
      const id = c.uuid();
      const t = now();
      db.prepare("INSERT INTO instances (id, user_id, business_type, source_kind, source_ref, status, created_at, updated_at) VALUES (?,?,?,?,?,'provisioning',?,?)")
        .run(id, userId, businessType, sourceKind, sourceRef, t, t);
      return id;
    },
    setStatus(id, status, error = null) {
      db.prepare('UPDATE instances SET status = ?, error = ?, updated_at = ? WHERE id = ?').run(status, error, now(), id);
    },
    resetForRetry(id, { sourceKind, sourceRef }) {
      db.prepare("UPDATE instances SET status='provisioning', error=NULL, source_kind=?, source_ref=?, updated_at=? WHERE id=?").run(sourceKind, sourceRef, now(), id);
    },
  };

  // ---------------- audit ----------------
  const audit = (event, { userId = null, ip = null, detail = null } = {}) => {
    db.prepare('INSERT INTO audit_log (at, user_id, event, ip_hash, detail) VALUES (?,?,?,?,?)')
      .run(now(), userId, event, ip ? c.hmacToken(`ip:${ip}`).slice(0, 16) : null, detail ? String(detail).slice(0, 300) : null);
  };

  return { users, sessions, otp, oauthPending, instances, audit };
}

module.exports = { createStore };
