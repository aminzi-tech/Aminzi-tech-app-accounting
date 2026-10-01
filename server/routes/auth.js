'use strict';
const express = require('express');
const c = require('../crypto');
const config = require('../config');
const { schemas, parse } = require('../validators');
const { sendEmail, sendSms } = require('../notify');
const { authLimiter, otpVerifyLimiter, cookieOpts } = require('../security');
const registry = require('../provisioning/registry');
const { provisionInBackground } = require('../provisioning/provision');

const maskEmail = (e) => { const [u, d] = e.split('@'); return `${u.slice(0, 2)}${'•'.repeat(Math.max(1, u.length - 2))}@${d}`; };
const maskPhone = (p) => `${p.slice(0, 3)} ••• ••• ${p.slice(-3)}`;

function startSession(store, req, res, userId) {
  const token = store.sessions.create(userId, req.get('user-agent'));
  res.cookie(config.cookie.name, token, cookieOpts(config.session.absoluteHours * 3600_000));
  store.audit('session.start', { userId, ip: req.ip });
}

// Sending is never awaited by enumeration-sensitive routes: the response must take the same
// time whether or not an account exists. Failures are logged; the user can resend.
function sendQuietly(promise) { promise.catch(e => console.error('[notify]', e.message)); }

async function deliverCode(channel, to, code, purpose) {
  const what = { signup: 'finish creating your account', login: 'sign in', verify_email: 'confirm this email', verify_phone: 'confirm this number' }[purpose];
  if (channel === 'email') {
    await sendEmail({ to, subject: `${code} is your AminZi code`, text: `Your code to ${what} is ${code}.\nIt expires in ${config.otp.ttlMinutes} minutes. If you didn't ask for it, ignore this email.` });
  } else {
    await sendSms({ to, text: `AminZi code: ${code} (to ${what}). Expires in ${config.otp.ttlMinutes} min. Never share it.` });
  }
}

module.exports = function authRoutes(store) {
  const r = express.Router();

  r.get('/business-types', (req, res) => res.json({ types: registry.publicList() }));
  r.get('/config', (req, res) => res.json({ googleEnabled: config.googleEnabled }));

  // ---------- Sign up (email or SMS verification) ----------
  r.post('/signup', authLimiter, async (req, res, next) => {
    try {
      const { data, error } = parse(schemas.signup, req.body);
      if (error) return res.status(400).json({ error });

      // Hash first, always: skipping scrypt on the duplicate path made it measurably faster.
      const passwordHash = await c.hashPassword(data.password);
      store.users.deletePendingOlderThan(60 * 60_000);
      const byEmail = store.users.byEmail(data.email);
      const byPhone = store.users.byPhone(data.phone);
      const sentTo = data.verifyBy === 'email' ? maskEmail(data.email) : maskPhone(data.phone);

      // Existing *active* account: answer exactly like a fresh sign-up (no account enumeration),
      // and tell the real owner someone tried. The fake pendingId can never be verified.
      const active = [byEmail, byPhone].find(u => u && u.status !== 'pending');
      if (active) {
        if (byEmail && byEmail.status !== 'pending') {
          sendQuietly(sendEmail({ to: data.email, subject: 'Someone tried to sign up with your email', text: 'An AminZi account already uses this email. If that was you, sign in instead. If not, you can ignore this message.' }));
        }
        store.audit('signup.duplicate', { ip: req.ip });
        return res.status(202).json({ pendingId: c.uuid(), channel: data.verifyBy, sentTo });
      }
      // Abandoned pending sign-ups with the same email/phone are replaced.
      for (const u of [byEmail, byPhone]) if (u) store.users.delete(u.id);

      const userId = store.users.create({
        status: 'pending', businessName: data.businessName, businessType: data.businessType,
        email: data.email, phone: data.phone, passwordHash,
      });
      const target = data.verifyBy === 'email' ? data.email : data.phone;
      const issued = store.otp.issue({ purpose: 'signup', channel: data.verifyBy, targetIdx: c.blindIndex(data.verifyBy, target), userId });
      if (issued.code) sendQuietly(deliverCode(data.verifyBy, target, issued.code, 'signup'));
      store.audit('signup.pending', { userId, ip: req.ip, detail: data.businessType });
      res.status(202).json({ pendingId: userId, channel: data.verifyBy, sentTo });
    } catch (e) { next(e); }
  });

  r.post('/signup/verify', otpVerifyLimiter, async (req, res, next) => {
    try {
      const { data, error } = parse(schemas.signupVerify, req.body);
      if (error) return res.status(400).json({ error });
      const raw = store.users.byId(data.pendingId);
      const wrong = () => res.status(400).json({ error: { message: 'That code is wrong or has expired.', fields: { code: 'Check the code and try again, or send a new one.' } } });
      if (!raw || raw.status !== 'pending') return wrong();
      const u = store.users.view(raw);
      // Try whichever channel the code was sent to.
      let ok = null; let channel = null;
      for (const ch of ['email', 'phone']) {
        const target = ch === 'email' ? u.email : u.phone;
        ok = store.otp.consume({ purpose: 'signup', targetIdx: c.blindIndex(ch, target), code: data.code });
        if (ok) { channel = ch; break; }
      }
      if (!ok || ok.user_id !== u.id) return wrong();
      store.users.activate(u.id, { emailVerified: channel === 'email', phoneVerified: channel === 'phone' });
      store.audit('signup.verified', { userId: u.id, ip: req.ip, detail: channel });
      startSession(store, req, res, u.id);
      provisionInBackground(store, u.id);
      res.json({ ok: true, redirect: '/dashboard' });
    } catch (e) { next(e); }
  });

  r.post('/signup/resend', authLimiter, async (req, res, next) => {
    try {
      const { data, error } = parse(schemas.resend, req.body);
      if (error) return res.status(400).json({ error });
      const raw = store.users.byId(data.pendingId);
      if (!raw || raw.status !== 'pending') return res.json({ ok: true }); // fake or expired: same answer
      const u = store.users.view(raw);
      const ch = data.channel;
      const target = ch === 'email' ? u.email : u.phone;
      const issued = store.otp.issue({ purpose: 'signup', channel: ch, targetIdx: c.blindIndex(ch, target), userId: u.id });
      // Too soon → silently skip (the client enforces the 60 s wait); same answer as a fake id.
      if (issued.code) sendQuietly(deliverCode(ch, target, issued.code, 'signup'));
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  // ---------- Log in with email + password ----------
  r.post('/login/email', authLimiter, async (req, res, next) => {
    try {
      const { data, error } = parse(schemas.loginEmail, req.body);
      if (error) return res.status(400).json({ error });
      const raw = store.users.byEmail(data.email);
      const usable = raw && raw.status === 'active' ? raw.password_hash : null;
      const ok = await c.verifyPassword(data.password, usable); // constant-ish time even when user is missing
      if (!ok) {
        store.audit('login.fail', { userId: raw ? raw.id : null, ip: req.ip, detail: 'email' });
        return res.status(401).json({ error: { message: 'Email or password is incorrect.' } });
      }
      if (c.needsRehash(raw.password_hash)) store.users.setPasswordHash(raw.id, await c.hashPassword(data.password));
      startSession(store, req, res, raw.id);
      res.json({ ok: true, redirect: '/dashboard' });
    } catch (e) { next(e); }
  });

  // ---------- Log in with phone (SMS code) ----------
  r.post('/login/phone/start', authLimiter, async (req, res, next) => {
    try {
      const { data, error } = parse(schemas.loginPhoneStart, req.body);
      if (error) return res.status(400).json({ error });
      const raw = store.users.byPhone(data.phone);
      if (raw && raw.status === 'active') {
        const issued = store.otp.issue({ purpose: 'login', channel: 'phone', targetIdx: c.blindIndex('phone', data.phone), userId: raw.id });
        if (issued.code) sendQuietly(deliverCode('phone', data.phone, issued.code, 'login'));
      }
      // Same response whether or not the number has an account.
      res.json({ ok: true, sentTo: maskPhone(data.phone) });
    } catch (e) { next(e); }
  });

  r.post('/login/phone/verify', otpVerifyLimiter, (req, res, next) => {
    try {
      const { data, error } = parse(schemas.loginPhoneVerify, req.body);
      if (error) return res.status(400).json({ error });
      const row = store.otp.consume({ purpose: 'login', targetIdx: c.blindIndex('phone', data.phone), code: data.code });
      const raw = row && store.users.byId(row.user_id);
      if (!raw || raw.status !== 'active') {
        return res.status(400).json({ error: { message: 'That code is wrong or has expired.', fields: { code: 'Check the code and try again, or send a new one.' } } });
      }
      store.users.markVerified(raw.id, 'phone');
      startSession(store, req, res, raw.id);
      res.json({ ok: true, redirect: '/dashboard' });
    } catch (e) { next(e); }
  });

  r.post('/logout', (req, res) => {
    store.sessions.destroy(req.cookies[config.cookie.name]);
    res.clearCookie(config.cookie.name, { path: '/', secure: config.cookie.secure, httpOnly: true, sameSite: 'lax' });
    res.json({ ok: true, redirect: '/' });
  });

  return r;
};

module.exports.startSession = startSession;
module.exports.deliverCode = deliverCode;
module.exports.maskEmail = maskEmail;
module.exports.maskPhone = maskPhone;
