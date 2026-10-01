# AminZi Workspace

Sign up and sign in with **Google, email + password, or phone (SMS code)**. At sign-up the owner gives a **business name, email, phone and business type**. Once they confirm, the app makes **a private copy of that business type's template** for them (their *instance*) and opens it from their dashboard.

```
sign up ──► confirm code (email or SMS) ──► account active ──► instance copied from the
                                                               business type's source ──► dashboard
```

## Run it

Requires Node 22.5 or newer (it uses the built-in `node:sqlite`, so there's no native build step).

```bash
npm install
cp .env.example .env
npm run keys >> .env        # appends fresh DATA_KEY / INDEX_KEY / TOKEN_KEY
npm start                   # http://localhost:3000
npm test                    # 16 end-to-end tests
```

In development, email and SMS codes are **printed in the terminal**. In production you set `MAIL_PROVIDER=resend` and `SMS_PROVIDER=twilio`. The app won't start in production with the console providers or with missing keys.

**Google sign-in:** in Google Cloud Console, create an OAuth client ID (type *Web application*) and add `APP_ORIGIN/auth/google/callback` as an authorised redirect URI. Then put the ID and secret in `.env`. Until you do, the Google button shows as unavailable and the other two sign-in methods still work.

## Where business types live — the file you edit

**`config/business-types.json`**

Each entry is one item in the sign-up dropdown and says where that type's instance is copied from:

```json
{ "id": "tailor", "label": "Tailor", "group": "Shops & trade",
  "source": { "kind": "local", "path": "templates/retail" } }
```

To use a template that lives in its own repository:

```json
{ "id": "tailor", "label": "Tailor", "group": "Shops & trade",
  "source": { "kind": "git", "repo": "https://github.com/your-org/tailor-template.git",
              "ref": "v1.2.0", "subdir": "dist" } }
```

Rules:

- `id` is permanent once anyone has signed up with it, because it's stored on their account. If you need to change a label, change the label and leave the `id` alone.
- `group` sets the headings in the dropdown.
- `ref` is a **tag or a full 40-character commit SHA**, never a branch, so that every user of a type gets identical code. The provisioner records the exact commit it used.
- The repo host must be listed in `GIT_ALLOWED_HOSTS`, which defaults to `github.com` and `gitlab.com`.
- `"enabled": false` hides a type from sign-up. Existing users of that type keep working.
- Run `npm run check-types` after every edit. The running server picks up changes on its own. If an edit is invalid, the server logs it and keeps serving the last valid version.

The `examples_not_loaded` block at the bottom of the file shows both git forms. The server ignores it.

## Templates shipped

| Folder | Look | Used by |
|---|---|---|
| `templates/food` | Navy and blue waves, Fraunces | café, restaurant, bakery, catering, hotel, event hall |
| `templates/health` | Soft sage panels, pine and apricot, Instrument Serif | clinic, dental, pharmacy, lab, optician, beauty salon |
| `templates/retail` | Wide Archivo signboard, price tags | grocery, textile, tailor, repair, IT shop, hardware… |
| `templates/services` | Steel and safety orange, Plex Condensed | construction, PVC/aluminium, law, cleaning, school… |
| `templates/fuel` | Petrolia tokens from the asset kit | fuel station |

Placeholders in `.html`, `.svg`, `.md` and `.txt` files are replaced at copy time and HTML-escaped: `{{business_name}}`, `{{business_type}}`, `{{year}}`. Email and phone are deliberately **not** written into instance files. Instances may not run JavaScript (CSP `script-src 'none'`) until they are moved to their own origin — see docs/INSTANCES.md.

## Layout

```
config/business-types.json     ← business types → template sources
templates/<name>/               ← local template sources (index.html required)
server/
  config.js                     env + secrets, refuses weak production config
  crypto.js                     AES-256-GCM fields, HMAC blind index, scrypt, tokens
  db.js / store.js              SQLite schema + data access (PII only as ciphertext)
  security.js                   CSP/headers, same-origin + JSON-only writes, rate limits
  validators.js                 zod schemas, phone → E.164, email normalisation
  notify.js                     email (Resend) / SMS (Twilio) / console
  routes/auth.js                sign up, verify, email login, phone login, logout
  routes/google.js              OIDC + PKCE + state + nonce, JWKS-verified ID token
  routes/account.js             /api/me, verify channel, sign out everywhere, /w/<id>/ serving
  provisioning/registry.js      loads + validates business-types.json, hot reload
  provisioning/provision.js     copy → render → atomic rename; git clone cache
public/                         sign-in, sign-up, complete-profile, dashboard
docs/INSTANCES.md               how per-user instances are made, and how to scale it
docs/PLAYBOOK.md                5 × 100: mistakes, AI errors, security, code storage, data storage
docs/SECURITY-REVIEW.md         findings, fixes, accepted risks (Notion-importable)
test/flows.test.js              end-to-end tests
```
# Aminzi-tech-app-accounting
# Aminzi-tech-app-accounting
# Aminzi-tech-app-accounting
