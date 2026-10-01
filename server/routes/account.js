'use strict';
const express = require('express');
const path = require('node:path');
const c = require('../crypto');
const config = require('../config');
const { schemas, parse } = require('../validators');
const { authLimiter, otpVerifyLimiter } = require('../security');
const registry = require('../provisioning/registry');
const { provisionInBackground } = require('../provisioning/provision');
const { deliverCode } = require('./auth');

/** Loads the session (if any) onto req.user. */
function loadSession(store) {
  return (req, res, next) => {
    const s = store.sessions.resolve(req.cookies[config.cookie.name]);
    if (s) {
      const u = store.users.byId(s.user_id);
      if (u && u.status === 'active') { req.userId = u.id; req.userRow = u; }
    }
    next();
  };
}

function requireAuth(req, res, next) {
  if (!req.userId) return res.status(401).json({ error: { message: 'Sign in to continue.' } });
  next();
}

function instanceView(inst) {
  if (!inst) return null;
  return {
    id: inst.id,
    status: inst.status,
    error: inst.status === 'failed' ? inst.error : null,
    url: inst.status === 'ready' ? `/w/${inst.id}/` : null,
    createdAt: inst.created_at,
  };
}

function accountRoutes(store) {
  const r = express.Router();
  r.use(requireAuth);

  r.get('/me', (req, res) => {
    const user = store.users.view(req.userRow);
    const type = registry.get(user.businessType);
    res.json({
      user: { ...user, businessTypeLabel: type ? type.label : user.businessType },
      instance: instanceView(store.instances.byUser(req.userId)),
      sessions: store.sessions.countForUser(req.userId),
    });
  });

  r.post('/verify/start', authLimiter, async (req, res, next) => {
    try {
      const { data, error } = parse(schemas.verifyChannelStart, req.body);
      if (error) return res.status(400).json({ error });
      const u = store.users.view(req.userRow);
      const target = data.channel === 'email' ? u.email : u.phone;
      if (!target) return res.status(400).json({ error: { message: `No ${data.channel} on this account.` } });
      const purpose = data.channel === 'email' ? 'verify_email' : 'verify_phone';
      const issued = store.otp.issue({ purpose, channel: data.channel, targetIdx: c.blindIndex(data.channel, target), userId: u.id });
      if (issued.retryAfter) return res.status(429).json({ error: { message: `You can ask for a new code in ${issued.retryAfter} seconds.` } });
      await deliverCode(data.channel, target, issued.code, purpose);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  r.post('/verify/confirm', otpVerifyLimiter, (req, res) => {
    const { data, error } = parse(schemas.verifyChannelCode, req.body);
    if (error) return res.status(400).json({ error });
    const u = store.users.view(req.userRow);
    const target = data.channel === 'email' ? u.email : u.phone;
    const purpose = data.channel === 'email' ? 'verify_email' : 'verify_phone';
    const row = target && store.otp.consume({ purpose, targetIdx: c.blindIndex(data.channel, target), code: data.code });
    if (!row || row.user_id !== u.id) return res.status(400).json({ error: { message: 'That code is wrong or has expired.', fields: { code: 'Check the code and try again.' } } });
    store.users.markVerified(u.id, data.channel);
    res.json({ ok: true });
  });

  r.post('/logout-all', (req, res) => {
    store.sessions.destroyAllForUser(req.userId);
    store.audit('session.revoke_all', { userId: req.userId, ip: req.ip });
    res.clearCookie(config.cookie.name, { path: '/', secure: config.cookie.secure, httpOnly: true, sameSite: 'lax' });
    res.json({ ok: true, redirect: '/' });
  });

  r.post('/instance/retry', (req, res) => {
    const inst = store.instances.byUser(req.userId);
    if (inst && inst.status === 'ready') return res.json({ instance: instanceView(inst) });
    provisionInBackground(store, req.userId);
    res.status(202).json({ instance: instanceView(store.instances.byUser(req.userId)) });
  });

  return r;
}

/**
 * Serves /w/<instanceId>/... to the instance owner only.
 * In production put instances on their own origin (see docs/INSTANCES.md) so a
 * template's JavaScript can never touch the account app's origin.
 */
function instanceServer(store) {
  const r = express.Router();
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  r.use('/w/:id', (req, res, next) => {
    const { id } = req.params;
    if (!UUID.test(id)) return res.status(404).send('Not found');
    if (!req.userId) return res.redirect(302, `/?next=${encodeURIComponent(`/w/${id}/`)}`);
    const inst = store.instances.byId(id);
    // Same 404 for "doesn't exist" and "not yours" — don't confirm other people's IDs.
    if (!inst || inst.user_id !== req.userId || inst.status !== 'ready') return res.status(404).send('Not found');
    if (req.path === '/' && !req.originalUrl.split('?')[0].endsWith('/')) return res.redirect(301, `/w/${id}/`);
    res.setHeader('Cache-Control', 'private, no-store');
    // Instances share the app's origin, so they get NO script, fetch or form posting: a template
    // can't act with the owner's session. ponytail: templates needing JS → serve instances from a
    // separate origin first (docs/INSTANCES.md), then relax this.
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'none'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; frame-src 'none'; frame-ancestors 'self'; base-uri 'none'; object-src 'none'; form-action 'none'");
    return express.static(path.join(config.instancesDir, id), { dotfiles: 'deny', index: 'index.html', redirect: false, fallthrough: false })(req, res, (err) => {
      res.status(err && err.status ? err.status : 404).send('Not found');
    });
  });
  return r;
}

module.exports = { loadSession, requireAuth, accountRoutes, instanceServer };
