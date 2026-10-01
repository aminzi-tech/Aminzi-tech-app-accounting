'use strict';
/**
 * "Continue with Google" — OpenID Connect authorization-code flow with PKCE,
 * state (CSRF) and nonce (replay) checks, ID token verified against Google's JWKS.
 * No Google SDK; ~100 lines you can audit.
 */
const express = require('express');
const crypto = require('node:crypto');
const { createRemoteJWKSet, jwtVerify } = require('jose');
const c = require('../crypto');
const config = require('../config');
const { sign, unsign, cookieOpts, authLimiter } = require('../security');
const { schemas, parse, normaliseEmail } = require('../validators');
const { sendEmail } = require('../notify');
const { startSession } = require('./auth');
const { provisionInBackground } = require('../provisioning/provision');

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

const FLOW_COOKIE = 'aminzi_oauth';
const PENDING_COOKIE = 'aminzi_gpending';

const fail = (res, code) => res.redirect(302, `/?error=${encodeURIComponent(code)}`);

module.exports = function googleRoutes(store) {
  const r = express.Router();

  r.get('/auth/google/start', authLimiter, (req, res) => {
    if (!config.googleEnabled) return fail(res, 'google_not_configured');
    const state = c.randomToken(24);
    const nonce = c.randomToken(24);
    const verifier = c.randomToken(48);
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    res.cookie(FLOW_COOKIE, sign({ state, nonce, verifier, exp: Date.now() + 10 * 60_000 }), cookieOpts(10 * 60_000));
    const url = new URL(GOOGLE_AUTH);
    url.search = new URLSearchParams({
      client_id: config.google.clientId,
      redirect_uri: config.google.redirectUri,
      response_type: 'code',
      scope: 'openid email',
      state, nonce,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString();
    res.redirect(302, url.toString());
  });

  r.get('/auth/google/callback', authLimiter, async (req, res) => {
    const flow = unsign(req.cookies[FLOW_COOKIE]);
    res.clearCookie(FLOW_COOKIE, { path: '/' });
    if (!config.googleEnabled) return fail(res, 'google_not_configured');
    if (req.query.error) return fail(res, 'google_cancelled');
    if (!flow || typeof req.query.state !== 'string' || !c.safeEqual(flow.state, req.query.state) || typeof req.query.code !== 'string') {
      return fail(res, 'google_state');
    }
    try {
      const tokenRes = await fetch(GOOGLE_TOKEN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: req.query.code,
          client_id: config.google.clientId,
          client_secret: config.google.clientSecret,
          redirect_uri: config.google.redirectUri,
          grant_type: 'authorization_code',
          code_verifier: flow.verifier,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!tokenRes.ok) return fail(res, 'google_token');
      const { id_token: idToken } = await tokenRes.json();
      const { payload } = await jwtVerify(idToken, JWKS, {
        issuer: ['https://accounts.google.com', 'accounts.google.com'],
        audience: config.google.clientId,
        maxTokenAge: '10m',
      });
      if (!c.safeEqual(payload.nonce || '', flow.nonce)) return fail(res, 'google_nonce');
      if (!payload.sub || !payload.email || payload.email_verified !== true) return fail(res, 'google_unverified_email');

      const email = normaliseEmail(payload.email);
      // 1) Known Google account → sign in.
      const bySub = store.users.byGoogleSub(payload.sub);
      if (bySub && bySub.status === 'active') {
        startSession(store, req, res, bySub.id);
        return res.redirect(302, '/dashboard');
      }
      // 2) Existing account with the same *verified* email → link, sign in, tell the owner.
      const byEmail = store.users.byEmail(email);
      if (byEmail && byEmail.status === 'active' && byEmail.email_verified) {
        store.users.linkGoogle(byEmail.id, payload.sub);
        store.audit('google.linked', { userId: byEmail.id, ip: req.ip });
        sendEmail({ to: email, subject: 'Google sign-in added to your AminZi account', text: 'You can now sign in with Google. If this wasn\'t you, sign in and choose "Sign out everywhere", then contact support.' }).catch(() => {});
        startSession(store, req, res, byEmail.id);
        return res.redirect(302, '/dashboard');
      }
      // An unverified/pending account with this email can't block the real owner.
      // Someone else holds this email without ever proving it (e.g. signed up verifying by SMS).
      // Google just proved ownership, so the real owner wins: release it from that account.
      if (byEmail && byEmail.status === 'pending') store.users.delete(byEmail.id);
      else if (byEmail) { store.users.releaseEmail(byEmail.id); store.audit('email.released', { userId: byEmail.id, ip: req.ip }); }
      // 3) New → ask for business details first.
      const pendingId = store.oauthPending.create({ googleSub: payload.sub, email });
      res.cookie(PENDING_COOKIE, sign({ id: pendingId, exp: Date.now() + 30 * 60_000 }), cookieOpts(30 * 60_000));
      return res.redirect(302, '/complete-profile');
    } catch (e) {
      console.error('[google]', e.message);
      return fail(res, 'google_failed');
    }
  });

  r.get('/api/google/pending', (req, res) => {
    const p = unsign(req.cookies[PENDING_COOKIE]);
    const row = p && store.oauthPending.get(p.id);
    if (!row) return res.status(404).json({ error: { message: 'Your Google sign-up timed out. Start again.' } });
    res.json({ email: row.email });
  });

  r.post('/api/google/complete', authLimiter, (req, res) => {
    const p = unsign(req.cookies[PENDING_COOKIE]);
    const row = p && store.oauthPending.get(p.id);
    if (!row) return res.status(404).json({ error: { message: 'Your Google sign-up timed out. Start again.' } });
    const { data, error } = parse(schemas.completeProfile, req.body);
    if (error) return res.status(400).json({ error });
    const phoneOwner = store.users.byPhone(data.phone);
    if (phoneOwner && phoneOwner.status === 'active') {
      return res.status(409).json({ error: { message: 'Some fields need attention.', fields: { phone: 'This number is already on another account. Sign in to that account, or use a different number.' } } });
    }
    if (phoneOwner) store.users.delete(phoneOwner.id);
    // The email may have been re-claimed (unproven) during the 30 min this step allows.
    const emailHolder = store.users.byEmail(row.email);
    if (emailHolder && emailHolder.status === 'active' && emailHolder.email_verified) {
      return res.status(409).json({ error: { message: 'This email now belongs to a confirmed account. Sign in with Google again to connect it.' } });
    }
    if (emailHolder && emailHolder.status === 'pending') store.users.delete(emailHolder.id);
    else if (emailHolder) store.users.releaseEmail(emailHolder.id);
    if (store.users.byGoogleSub(row.googleSub)) return res.status(409).json({ error: { message: 'This Google account is already registered. Sign in instead.' } });

    const userId = store.users.create({
      status: 'active', businessName: data.businessName, businessType: data.businessType,
      email: row.email, emailVerified: true, phone: data.phone, googleSub: row.googleSub,
    });
    store.oauthPending.delete(row.id);
    res.clearCookie(PENDING_COOKIE, { path: '/' });
    store.audit('signup.google', { userId, ip: req.ip, detail: data.businessType });
    startSession(store, req, res, userId);
    provisionInBackground(store, userId);
    res.json({ ok: true, redirect: '/dashboard' });
  });

  return r;
};
