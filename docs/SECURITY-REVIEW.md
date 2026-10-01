# AminZi Workspace — Security Review

**Date:** 2026-10-01 · **Scope:** the whole repository (server, front-end, provisioning, templates, registry) · **Result:** 10 issues found and fixed, 0 open high/medium issues, 16/16 automated tests passing, `npm audit`: 0 vulnerabilities.

## Findings and fixes

| ID | Severity | Issue | Impact before the fix | Fix | Where | Regression test |
|---|---|---|---|---|---|---|
| F1 | **High** | Instances are served on the same origin as the account app and were allowed to run scripts | A template from a compromised or careless git repo could call `/api/*` as the logged-in owner (read their account, sign them out everywhere) | Instance CSP is now `script-src 'none'`, `connect-src 'none'`, `form-action 'none'`, `frame-src 'none'`. The dashboard preview iframe is also `sandbox="allow-same-origin"` (no scripts) | `server/routes/account.js`, `public/dashboard.html` | test 15 |
| F2 | **Medium** | Sign-up skipped password hashing when the email/phone already had an account | ~500 ms faster response revealed which emails/phones are registered | Hash first on every sign-up; email/SMS sending is no longer awaited on any path. Measured after the fix: 508 ms (new) vs 537 ms (existing) | `server/routes/auth.js` | timing check (manual script) |
| F3 | **Medium** | Phone sign-in returned 429 within the resend cooldown only for registered numbers, and waited on the SMS API only for them | Phone-number enumeration by status code or response time | Same 200 response and no awaited send for every number; cooldown is enforced silently server-side and shown client-side | `server/routes/auth.js`, `public/assets/js/auth.js` | test 15 |
| F4 | **Medium** | Email squatting blocked Google sign-up | Someone could sign up with a victim's email (verifying by SMS on their own phone) and the real owner could then never sign up with Google | When Google proves the email, it is released from any account that never confirmed it. Confirmed emails are never touched. Re-checked at the complete-profile step | `server/routes/google.js`, `server/store.js` | test 16 |
| F5 | Low | `/api/google/complete` was registered before the same-origin (CSRF) check | Cross-site writes to that route skipped the Origin check (still blocked in practice by SameSite=Lax + CORS preflight) | Same-origin middleware now runs before every `/api` route | `server/app.js` | test 15 |
| F6 | Low | "Resend code" answered 429 for real pending sign-ups but 200 for the fake id given to duplicates | Distinguished a duplicate sign-up from a real one | Always 200; too-early resends are dropped silently; the client starts its 60 s countdown as soon as the code screen opens | `server/routes/auth.js`, `public/assets/js/auth.js` | — |
| F7 | Low | The `instance.json` block compared the raw path, so `/w/<id>/%69nstance.json` was served | Owner could read internal metadata (template repo URL) | File deleted: the DB already holds that metadata. Nothing to block | `server/provisioning/provision.js` | tests 2, 14, 15 |
| F8 | Low | Git followed HTTP redirects when cloning templates | An allowed host could redirect the clone to another host | `-c http.followRedirects=false` | `server/provisioning/provision.js` | — |
| F9 | Low | The registry `subdir` pattern accepted `..` segments and used a nested quantifier (ReDoS-prone) | Escape was already caught by the realpath check; the regex was the weak layer | Flat regex + explicit "no `..` segment" rule | `server/provisioning/registry.js` | — |
| F10 | Low | "Sign out everywhere" cleared the `__Host-` cookie without `Secure` | Browser ignores the clear in production; the session was still deleted server-side, so no access, just a stale cookie | Clear with the same attributes it was set with | `server/routes/account.js` | test 12 |
| F11 | Info | CSP allowed form posts to accounts.google.com, which the app never does | Unneeded allowance | Removed | `server/security.js` | test 11 |

## Verified as already safe

| Area | What was checked |
|---|---|
| Passwords | scrypt N=2^17, r=8, p=1, per-user salt, timing-safe compare, rehash on login, dummy hash for unknown users |
| Codes (OTP) | `crypto.randomInt`, HMAC-stored, purpose-bound, 10 min expiry, 5 attempts, 60 s resend, 5/hour per target |
| Sessions | 256-bit random token, only HMAC stored, HttpOnly + SameSite=Lax (+ Secure, `__Host-` in production), idle and absolute expiry, new token per login |
| Google | PKCE S256, state, nonce, JWKS-verified ID token (issuer, audience, max age), `email_verified` required, links only to confirmed emails |
| CSRF | Origin check + JSON-only content type on every `/api` write |
| XSS | No `innerHTML` anywhere; business name rejects `<>` and is HTML-escaped into templates; strict CSP with no inline script on every page |
| SQL injection | Prepared statements only; the one dynamic column name is whitelisted |
| Access control | `/w/<id>/` checks ownership; same 404 for "missing" and "not yours"; UUIDv4 ids; account APIs use only the session's user id |
| Path traversal | Encoded and plain `../` attempts tested; `dotfiles: 'deny'`; template copy skips symlinks |
| Provisioning | `execFile` (no shell), https + host allow-list, ref regex with no leading `-`, timeouts, size cap, minimal env, `.git` removed |
| Data at rest | Email, phone, business name AES-256-GCM with row-bound AAD; HMAC blind indexes; DB file 0600; keys only from env and required in production |
| Headers | CSP, HSTS (production), nosniff, frame-ancestors none, Referrer-Policy, Permissions-Policy, no X-Powered-By |
| Dependencies | 6 runtime packages, `npm audit` clean, lockfile committed |

## Accepted risks (known ceilings, with upgrade path)

| Risk | Why it is acceptable now | Upgrade when |
|---|---|---|
| Instances can't use JavaScript | Current templates are static, so there is no impact | A template needs JS → serve instances from a separate origin (subdomain per tenant), then relax the instance CSP |
| Rate limits are in-memory, per process | Correct for one server process | More than one process/server → Redis store for `express-rate-limit` |
| scrypt uses ~128 MB per hash | libuv's thread pool (4) caps it at ~512 MB at once | Small VPS (<1 GB RAM) → set `UV_THREADPOOL_SIZE=2`, or switch to argon2id with 64 MB |
| Email-signup squatting (not Google) | The squatter gains nothing; the real owner is emailed and can take the email back by signing in with Google | Require email confirmation before an account may hold an email at all |
| Phone number already used → 409 on Google complete-profile | Only reachable after a real Google sign-in; low-value enumeration | Make the response generic and resolve the conflict by SMS code |
| `node:sqlite` is marked experimental in Node 22 | Stable in practice; schema is plain SQL | Node 24 LTS, or move to Postgres (docs/INSTANCES.md) |
| No password reset or account deletion yet | Features, not vulnerabilities | Before launch: reset by code (same OTP table), deletion that removes the instance folder |

## How to re-check

```bash
npm test                 # 16 end-to-end tests, incl. the regressions above
npm audit --omit=dev     # dependency CVEs
npm run check-types      # registry validation
```

Before launch, get a pen test against a staging deploy with real Google, email and SMS providers, using `docs/PLAYBOOK.md` section 3 as the test plan.
