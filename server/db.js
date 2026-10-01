'use strict';
/**
 * SQLite via Node's built-in node:sqlite (no native build step).
 * For production at scale, the same schema ports directly to PostgreSQL;
 * see docs/INSTANCES.md → "Moving to Postgres".
 *
 * PII columns end in _enc (AES-256-GCM ciphertext) and lookups use _idx
 * (HMAC blind index). Plaintext email/phone/business name never touch disk.
 */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });

function open(file = path.join(config.dataDir, 'app.db')) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  try { fs.chmodSync(file, 0o600); } catch { /* memory db or windows */ }
  return db;
}

const MIGRATIONS = [
  // 1 — initial schema
  `
  CREATE TABLE users (
    id                 TEXT PRIMARY KEY,               -- UUIDv4
    status             TEXT NOT NULL CHECK (status IN ('pending','active','disabled')),
    business_name_enc  TEXT NOT NULL,
    business_type      TEXT NOT NULL,
    email_enc          TEXT,
    email_idx          TEXT UNIQUE,
    email_verified     INTEGER NOT NULL DEFAULT 0,
    phone_enc          TEXT,
    phone_idx          TEXT UNIQUE,
    phone_verified     INTEGER NOT NULL DEFAULT 0,
    password_hash      TEXT,                            -- scrypt, self-describing string
    google_sub         TEXT UNIQUE,
    created_at         INTEGER NOT NULL,
    updated_at         INTEGER NOT NULL
  );

  CREATE TABLE sessions (
    token_hash   TEXT PRIMARY KEY,                       -- HMAC of the cookie value
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL,
    ua_hint      TEXT
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE otp_codes (
    id          TEXT PRIMARY KEY,
    purpose     TEXT NOT NULL CHECK (purpose IN ('signup','login','verify_email','verify_phone')),
    channel     TEXT NOT NULL CHECK (channel IN ('email','phone')),
    target_idx  TEXT NOT NULL,                           -- blind index of email/phone
    user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
    code_hash   TEXT NOT NULL,
    attempts    INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL,
    used_at     INTEGER
  );
  CREATE INDEX otp_target ON otp_codes(target_idx, purpose);

  CREATE TABLE oauth_pending (
    id          TEXT PRIMARY KEY,                        -- random, sent as short-lived cookie
    google_sub  TEXT NOT NULL,
    email_enc   TEXT NOT NULL,
    email_idx   TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL
  );

  CREATE TABLE instances (
    id             TEXT PRIMARY KEY,                     -- UUIDv4, also the folder name
    user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    business_type  TEXT NOT NULL,
    source_kind    TEXT NOT NULL,
    source_ref     TEXT NOT NULL,                        -- path or repo@ref actually used
    status         TEXT NOT NULL CHECK (status IN ('provisioning','ready','failed')),
    error          TEXT,
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX instances_one_per_user ON instances(user_id);

  CREATE TABLE audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    at         INTEGER NOT NULL,
    user_id    TEXT,
    event      TEXT NOT NULL,
    ip_hash    TEXT,
    detail     TEXT
  );
  `,
];

function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (v INTEGER NOT NULL)');
  const row = db.prepare('SELECT v FROM schema_version').get();
  let v = row ? row.v : 0;
  if (!row) db.prepare('INSERT INTO schema_version (v) VALUES (0)').run();
  while (v < MIGRATIONS.length) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      v += 1;
      db.prepare('UPDATE schema_version SET v = ?').run(v);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}

function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { open, tx };
