'use strict';
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('node:path');
const config = require('./config');
const db = require('./db');
const { createStore } = require('./store');
const security = require('./security');
const registry = require('./provisioning/registry');
const authRoutes = require('./routes/auth');
const googleRoutes = require('./routes/google');
const { loadSession, accountRoutes, instanceServer } = require('./routes/account');

function createApp({ dbFile } = {}) {
  registry.refresh(); // fail fast on a broken registry at boot
  const database = db.open(dbFile);
  const store = createStore(database);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(security.headers());
  app.use(security.permissionsPolicy);
  app.use(cookieParser());
  app.use(express.json({ limit: '10kb' }));
  app.use(loadSession(store));

  const pub = path.join(config.root, 'public');
  const page = (file) => (req, res) => res.sendFile(path.join(pub, file));
  const authed = (file) => (req, res) => (req.userId ? res.sendFile(path.join(pub, file)) : res.redirect(302, '/'));

  app.get('/', (req, res) => (req.userId ? res.redirect(302, '/dashboard') : res.sendFile(path.join(pub, 'index.html'))));
  app.get('/dashboard', authed('dashboard.html'));
  app.get('/complete-profile', page('complete-profile.html'));
  app.get('/favicon.svg', (req, res) => res.sendFile(path.join(pub, 'favicon.svg')));
  app.get('/favicon.ico', (req, res) => res.redirect(301, '/favicon.svg'));
  app.get('/healthz', (req, res) => res.json({ ok: true }));

  app.use('/assets', express.static(path.join(pub, 'assets'), { maxAge: config.isProd ? '7d' : 0, dotfiles: 'deny' }));
  app.use('/fonts', express.static(path.join(pub, 'fonts'), { maxAge: '30d', immutable: true }));

  app.use('/api', security.sameOriginOnly); // before every /api route, including /api/google/*
  app.use(googleRoutes(store));
  app.use('/api', authRoutes(store));
  app.use('/api', accountRoutes(store));
  app.use(instanceServer(store));

  app.use((req, res) => res.status(404).json({ error: { message: 'Not found.' } }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: { message: 'Malformed JSON.' } });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: { message: 'Request too large.' } });
    console.error('[error]', err);
    res.status(500).json({ error: { message: 'Something failed on our side. Try again in a moment.' } });
  });

  // Housekeeping
  const timer = setInterval(() => { try { store.otp.purgeExpired(); store.users.deletePendingOlderThan(24 * 3600_000); } catch { /* ignore */ } }, 15 * 60_000);
  timer.unref();

  return { app, store, database };
}

module.exports = { createApp };
