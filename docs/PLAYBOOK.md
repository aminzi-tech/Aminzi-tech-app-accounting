# Playbook: sign-up / sign-in apps with per-user instances

Five lists of 100. Each entry names the problem and how to avoid it. **✓** means this repository already does it. Use the unticked items as your hardening backlog, and give all five lists to anyone who pen-tests the app.

1. [Common mistakes](#1-common-mistakes-building-this-kind-of-app)
2. [AI-generated errors to avoid](#2-ai-generated-code-errors-to-avoid)
3. [Security measures (what a pen tester will try)](#3-security-measures--what-a-pen-tester-will-try)
4. [Source code storage & protection](#4-source-code-storage--protection)
5. [User data storage & encryption](#5-user-data-storage--encryption)

---

## 1. Common mistakes building this kind of app

### Sign-up & business details
| # | Mistake | How to avoid it | |
|---|---|---|---|
| 1 | Creating a fully active account before the email/phone is confirmed | Create a `pending` user; activate only after a valid code | ✓ |
| 2 | Free-text business type | Fixed list from one registry file; validate the id server-side | ✓ |
| 3 | Validating business type only in the dropdown | Server rejects any id not in the registry, whatever the client sends | ✓ |
| 4 | Storing phone numbers as typed ("0701 234 567", "+93-70…") | Normalise to E.164 before storing and before lookups | ✓ |
| 5 | Case-sensitive email uniqueness (`Ali@` vs `ali@`) | Trim, lowercase and NFKC-normalise before hashing or comparing | ✓ |
| 6 | Telling the visitor "this email is already registered" | Answer the same way as a new sign-up; notify the real owner by email | ✓ |
| 7 | Abandoned pending sign-ups blocking the real owner forever | Expire pending users (1 h) and let a new sign-up replace them | ✓ |
| 8 | No length limits on business name | Min 2 and max 80 characters; reject control characters | ✓ |
| 9 | Letting `<script>` into the business name "because we escape later" | Reject `<>` at input **and** escape at output | ✓ |
| 10 | Asking for 15 fields at sign-up | Only name, type, email, phone, password; the rest comes later on the dashboard | ✓ |
| 11 | Phone field without a country-code hint | Placeholder `+93 70 123 4567`; local `0…` numbers get the default country code | ✓ |
| 12 | Losing the form contents when the code step fails | Keep the sign-up form in the DOM; "Edit my details" goes back to it | ✓ |
| 13 | Clearing the password field on every validation error | Show field errors without resetting the other inputs | ✓ |
| 14 | Error messages only at the top of the form | Inline error under each field, linked with `aria-describedby`, focus the first one | ✓ |
| 15 | Requiring the user to verify both channels before using the app | Verify one at sign-up; the other can be confirmed later from the dashboard | ✓ |
| 16 | Hard-coding the business type list in the HTML | Load it from `/api/business-types`, which reads the registry | ✓ |
| 17 | Exposing template repo URLs in the public type list | Public list returns only id, label and group | ✓ |
| 18 | Changing a business type `id` after users exist | Treat ids as permanent; change labels instead | ✓ (documented) |
| 19 | Deleting a type from the registry and breaking its users | `"enabled": false` hides it from sign-up but keeps existing users working | ✓ |
| 20 | One invalid edit to the registry takes sign-up down | Validate on reload, keep serving the last good version, log the error | ✓ |

### Sign-in methods
| # | Mistake | How to avoid it | |
|---|---|---|---|
| 21 | Different error text for "no such email" and "wrong password" | One generic message for both | ✓ |
| 22 | Faster response when the user doesn't exist (timing leak) | Run a dummy password hash when the user is missing | ✓ |
| 23 | Phone login replying "number not found" | "If that number has an account, we sent a code" | ✓ |
| 24 | OTP codes that never expire | 10-minute expiry | ✓ |
| 25 | Unlimited guesses on a 6-digit code | 5 attempts per code, then it is burned | ✓ |
| 26 | Unlimited resends (SMS bill attack, "SMS pumping") | 60 s cooldown, 5 codes per number per hour, IP rate limit | ✓ |
| 27 | Old codes still valid after a resend | Issuing a new code invalidates earlier unused ones | ✓ |
| 28 | Codes generated with `Math.random()` | `crypto.randomInt` | ✓ |
| 29 | Storing OTP codes in plaintext | Store an HMAC bound to purpose + target | ✓ |
| 30 | A sign-up code accepted as a login code | Codes carry a `purpose` and are only valid for it | ✓ |
| 31 | Google sign-in without `state` | Random state in a signed, short-lived cookie; compared on callback | ✓ |
| 32 | Google sign-in without PKCE | S256 code challenge and verifier | ✓ |
| 33 | Trusting the Google ID token without verifying it | Verify signature (JWKS), issuer, audience, expiry and nonce | ✓ |
| 34 | Accepting Google accounts with an unverified email | Require `email_verified === true` | ✓ |
| 35 | Matching Google users by email only | Match by the stable `sub`; link by email only to an already-verified account | ✓ |
| 36 | Silently linking Google to an existing account | Email the owner when Google is linked | ✓ |
| 37 | Google user lands in the app with no business details | Send new Google users to a "complete profile" step first | ✓ |
| 38 | Breaking sign-in entirely when Google isn't configured | Disable the button with an explanation; email and phone still work | ✓ |
| 39 | Requesting more Google scopes than needed | `openid email` only | ✓ |
| 40 | Not rehashing old password hashes when parameters increase | Check the parameters at login and rehash if they're weaker | ✓ |

### Sessions
| # | Mistake | How to avoid it | |
|---|---|---|---|
| 41 | JWT in `localStorage` | Opaque random token in an `HttpOnly` cookie | ✓ |
| 42 | Session never expires | Idle (1 day) and absolute (14 days) limits | ✓ |
| 43 | Session token stored raw in the DB | Store only an HMAC of the token | ✓ |
| 44 | No "sign out everywhere" | One button deletes every session for the user | ✓ |
| 45 | Logout only clears the cookie client-side | Delete the server-side session row too | ✓ |
| 46 | Reusing the pre-login session after login (fixation) | Issue a fresh token on every sign-in | ✓ |
| 47 | `SameSite=None` cookies | `SameSite=Lax`, plus an Origin check on writes | ✓ |
| 48 | Cookie without `Secure` in production | `Secure` and the `__Host-` prefix in production | ✓ |
| 49 | Not killing sessions after a password change | Delete all other sessions on password or email change | — |
| 50 | No list of active devices | Show the session count now; a per-device list with revoke is the next step | partial |

### Instances & provisioning
| # | Mistake | How to avoid it | |
|---|---|---|---|
| 51 | Building the instance directly in its final folder | Build in staging, then rename atomically | ✓ |
| 52 | Serving a half-copied instance after a crash | Status stays `provisioning`/`failed` until the rename succeeds | ✓ |
| 53 | Blocking the sign-up request on a slow git clone | Provision in the background; the dashboard polls | ✓ |
| 54 | Cloning the same repo for every sign-up | Cache one clone per repo@ref; de-duplicate in-flight clones | ✓ |
| 55 | Using a branch name as the template ref | Pin to a tag or a 40-character SHA; record the commit | ✓ |
| 56 | Following symlinks while copying a template | Skip symlinks; copy regular files only | ✓ |
| 57 | Copying `.git`, `.env` or `node_modules` into instances | Skip list during copy | ✓ |
| 58 | No size limit on templates | `MAX_TEMPLATE_MB` budget during copy | ✓ |
| 59 | String-replacing user values into `.js`/`.json` files | Render only into HTML/SVG/MD/TXT, HTML-escaped; metadata goes in a separate JSON file | ✓ |
| 60 | Writing email/phone into public instance files | Only the business name and type are rendered | ✓ |
| 61 | Guessable instance URLs (`/site/42`) | UUIDv4 ids | ✓ |
| 62 | Returning 403 for someone else's instance (confirms it exists) | Same 404 for "missing" and "not yours" | ✓ |
| 63 | Serving metadata files and dotfiles publicly | No metadata file is written (the DB holds it); `dotfiles: 'deny'` | ✓ |
| 64 | Instances on the same origin as the account app in production | Separate subdomain or user-content domain | documented |
| 65 | No retry after a failed instance | "Try again" re-runs provisioning safely | ✓ |
| 66 | Two instances for one user from a double-click | Unique index on `instances.user_id` | ✓ |
| 67 | Updating a template overwrites every client's edits | Instances are copies; upgrades are explicit migrations | documented |
| 68 | No record of which template version a user has | `source_ref` stored per instance | ✓ |
| 69 | Deleting a user leaves their files on disk | Delete the instance folder in the account-deletion job | — |
| 70 | Disk fills with orphaned staging folders | Remove staging on failure; add a nightly sweep | partial |

### UX, operations & product
| # | Mistake | How to avoid it | |
|---|---|---|---|
| 71 | Spinner with no explanation while provisioning | Say what's happening and how long it usually takes | ✓ |
| 72 | Error messages that blame the user or say "Oops" | Say what happened and how to fix it | ✓ |
| 73 | Code input that doesn't open the number pad on phones | `inputmode="numeric"`, `autocomplete="one-time-code"` | ✓ |
| 74 | Mobile inputs under 16px (iOS zooms the page) | 16px inputs | ✓ |
| 75 | Password field without a show toggle | Show/Hide button with `aria-pressed` | ✓ |
| 76 | Tabs that aren't keyboard accessible | `role="tab"`, arrow keys, roving `tabindex` | ✓ |
| 77 | No visible focus styles | `:focus-visible` outlines everywhere | ✓ |
| 78 | Open redirect through `?next=` | Allow only same-site relative paths | ✓ |
| 79 | Console email/SMS providers left on in production | The app refuses to start in production with console providers | ✓ |
| 80 | Secrets with dev fallbacks in production | Missing or short keys throw at boot in production | ✓ |
| 81 | No health check endpoint | `/healthz` | ✓ |
| 82 | Leaking stack traces in API errors | Generic 500 message; details only in server logs | ✓ |
| 83 | No audit trail of sign-ins and failures | `audit_log` table with hashed IPs | ✓ |
| 84 | Logging plaintext emails and phones | Audit log stores user ids and hashed IPs only | ✓ |
| 85 | Accepting huge JSON bodies | 10 KB body limit | ✓ |
| 86 | Not handling malformed JSON | 400 with a clear message | ✓ |
| 87 | No tests for the auth flows | End-to-end tests for every flow and isolation rule | ✓ |
| 88 | Testing only the happy path | Tests for wrong codes, attempt caps, CSRF, enumeration, isolation | ✓ |
| 89 | Manual DB schema changes | Versioned migrations in `db.js` | ✓ |
| 90 | No password reset flow | Add reset-by-code using the same OTP table (purpose `reset`) | — |
| 91 | No way to change email/phone | Add change-with-verification of the *new* value before switching | — |
| 92 | No account deletion | Add self-service deletion with a confirmation code and a grace period | — |
| 93 | No email when a new device signs in | Send a "new sign-in" notice with time and approximate place | — |
| 94 | SMS-only users locked out when they change number | Encourage confirming both channels; support recovery by email | partial |
| 95 | No translations (Dari/Pashto) and no RTL | Externalise strings; test `dir="rtl"` layouts | — |
| 96 | Fonts loaded from third-party CDNs (privacy, CSP holes) | Self-host fonts | ✓ |
| 97 | Not testing on slow 3G | Keep pages small (no framework); test with throttling | partial |
| 98 | Ignoring `prefers-reduced-motion` | Motion reduced when requested | ✓ |
| 99 | One giant `server.js` | Small modules: crypto, store, routes, provisioning | ✓ |
| 100 | Shipping without a written threat model | Keep this playbook up to date and review it every release | ✓ |

---

## 2. AI-generated code errors to avoid

These are the mistakes code assistants (including Claude, ChatGPT and Copilot) make most often on this kind of app. Review any generated code against this list.

### Crypto & secrets
| # | AI error | How to avoid it | |
|---|---|---|---|
| 1 | `Math.random()` for codes or tokens | `crypto.randomInt` / `crypto.randomBytes` | ✓ |
| 2 | MD5/SHA-256 used to "hash passwords" | scrypt/argon2id/bcrypt with salt and cost | ✓ |
| 3 | bcrypt with cost 8 "for speed" | scrypt N=2^17 or argon2id per OWASP | ✓ |
| 4 | AES-CBC without a MAC, or ECB | AES-256-GCM (authenticated) | ✓ |
| 5 | Reusing a fixed IV | Random 96-bit IV per encryption | ✓ |
| 6 | Hard-coded secret like `'supersecretkey'` in the code | Secrets from env/secret manager; fail in production if missing | ✓ |
| 7 | `===` to compare tokens (timing leak) | `crypto.timingSafeEqual` | ✓ |
| 8 | JWT `alg: none` accepted, or HS256 with the client secret | Use a library (`jose`) with a fixed issuer, audience and JWKS | ✓ |
| 9 | Decoding the Google ID token with `jwt.decode` (no verification) | `jwtVerify` against Google's JWKS | ✓ |
| 10 | Same key for encryption, indexes and tokens | Separate keys per purpose | ✓ |
| 11 | Ciphertext that can be swapped between rows | AAD binds table, column and row id | ✓ |
| 12 | "Encrypting" with base64 | Base64 is encoding, not encryption | ✓ |
| 13 | Encrypting a field that must be searchable, then searching with `LIKE` | Blind index (HMAC) for exact-match lookups | ✓ |
| 14 | Logging the generated OTP in production | Console provider only in dev; refused in production | ✓ |
| 15 | Putting API keys in front-end JavaScript | All provider calls server-side | ✓ |
| 16 | `.env` committed with real values | `.gitignore` + `.env.example` with blanks | ✓ |
| 17 | Generating the same "example" key in every project | `npm run keys` generates fresh random keys | ✓ |
| 18 | Password max length 20 "to save space" | Allow up to 128; hashes are fixed length anyway | ✓ |
| 19 | Composition rules ("1 symbol, 1 capital") instead of length | Minimum length 10 + common-password check (NIST 800-63B) | ✓ |
| 20 | Not normalising Unicode before hashing passwords | NFKC-normalise | ✓ |

### Auth logic
| # | AI error | How to avoid it | |
|---|---|---|---|
| 21 | Checking `if (user.password == input)` | Hash comparison through the KDF | ✓ |
| 22 | "User not found" vs "wrong password" messages | One generic message | ✓ |
| 23 | Auth check only in the front-end router | Every API route checks the session server-side | ✓ |
| 24 | Middleware order bug: auth registered after the routes | Mount `requireAuth` on the router before handlers | ✓ |
| 25 | Trusting `userId` sent in the request body | Take the user id from the session only | ✓ |
| 26 | OTP verified but not marked used (replay) | Mark `used_at` in the same step | ✓ |
| 27 | Attempt counter incremented after the comparison returns | Increment first, then compare | ✓ |
| 28 | Rate limiter keyed on `req.ip` behind a proxy without `trust proxy` | Configure `trust proxy` correctly | ✓ |
| 29 | Setting `trust proxy: true` blindly (IP spoofing via X-Forwarded-For) | Trust exactly the number of proxy hops you have | ✓ |
| 30 | OAuth `state` generated but never checked | Compare in the callback, timing-safe | ✓ |
| 31 | `redirect_uri` built from the request's Host header | Fixed `GOOGLE_REDIRECT_URI` from config | ✓ |
| 32 | Open redirect `res.redirect(req.query.next)` | Allow-list relative paths | ✓ |
| 33 | Email verification link with the user id as the "token" | Random code, hashed, expiring | ✓ |
| 34 | Session cookie without `HttpOnly` "so the front-end can read it" | Front-end calls `/api/me` instead | ✓ |
| 35 | CORS `origin: '*'` with `credentials: true` | No CORS at all (same-origin app) | ✓ |
| 36 | CSRF tokens skipped because "it's a JSON API" | Origin check + JSON-only content type + SameSite | ✓ |
| 37 | Signing in Google users by email match without `email_verified` | Require verified email and an already-verified account | ✓ |
| 38 | Forgetting to clear OAuth temp cookies | Cleared on callback | ✓ |
| 39 | Unawaited async in auth handlers (errors swallowed, response hangs) | `try/catch` + `next(e)` in every async handler | ✓ |
| 40 | Returning the full user row (with hash) from `/api/me` | Explicit view object with allowed fields only | ✓ |

### Data & SQL
| # | AI error | How to avoid it | |
|---|---|---|---|
| 41 | String-concatenated SQL | Prepared statements everywhere | ✓ |
| 42 | Dynamic column names from user input | Whitelist (`email_verified` / `phone_verified` only) | ✓ |
| 43 | No unique constraint, uniqueness checked only in code (race) | DB `UNIQUE` on `email_idx`, `phone_idx`, `google_sub` | ✓ |
| 44 | Multi-step writes without a transaction | Wrap related writes; migrations run in a transaction | ✓ |
| 45 | Foreign keys declared but not enabled in SQLite | `PRAGMA foreign_keys = ON` | ✓ |
| 46 | Storing timestamps as local-time strings | Epoch milliseconds (UTC) | ✓ |
| 47 | `SELECT *` sent straight to the client | Map to a view object | ✓ |
| 48 | Auto-increment ids exposed in URLs | UUIDs | ✓ |
| 49 | Deleting users without cascading sessions/codes | `ON DELETE CASCADE` | ✓ |
| 50 | Schema created with `CREATE TABLE IF NOT EXISTS` scattered in routes | One migration list with a version table | ✓ |

### Files, templates & provisioning
| # | AI error | How to avoid it | |
|---|---|---|---|
| 51 | `exec(\`git clone ${url}\`)` through a shell (command injection) | `execFile` with an argv array, no shell | ✓ |
| 52 | Cloning any URL from config (SSRF, `file://`, `ext::`) | https only, host allow-list, `protocol.allow=never` except https | ✓ |
| 53 | Ref beginning with `-` treated as a git option | Ref regex forbids a leading `-`; `--` separator | ✓ |
| 54 | `path.join(base, userInput)` without checking the result stays inside base | Resolve and check the prefix (`templates/` and `subdir`) | ✓ |
| 55 | `fs.cp` with default symlink handling | Manual copy that skips symlinks | ✓ |
| 56 | Template placeholders filled with unescaped user input | HTML-escape every value | ✓ |
| 57 | Using `innerHTML` to show the user's business name | `textContent` everywhere in front-end code | ✓ |
| 58 | Serving the instance folder with `express.static` from `/` (exposes everything) | Mount per instance id after an ownership check | ✓ |
| 59 | Forgetting `dotfiles: 'deny'` | Set it | ✓ |
| 60 | Writing the instance and DB row in the wrong order | Row `provisioning` → build → rename → `ready` | ✓ |
| 61 | Synchronous `fs.*Sync` copying inside request handlers | Async fs in the background job | ✓ |
| 62 | No timeout on git or HTTP calls | 120 s git timeout, 10 s HTTP timeouts | ✓ |
| 63 | Unbounded `maxBuffer` on child processes | 1 MB cap | ✓ |
| 64 | Git asks for credentials and hangs the server | `GIT_TERMINAL_PROMPT=0` | ✓ |
| 65 | Clone inherits the server's full environment (leaks secrets to hooks) | Minimal env: `PATH`, `HOME` (temp dir) | ✓ |
| 66 | Git hooks or LFS run during the clone | No checkout hooks run on fresh clones; `.git` deleted after checkout | ✓ |
| 67 | World-readable instance files | `0640` files, `0750` folders | ✓ |
| 68 | World-readable DB file | `chmod 600` | ✓ |
| 69 | Inline `<script>` and `style=""` that force `unsafe-inline` in CSP | External files only; CSP without `unsafe-inline` | ✓ |
| 70 | Templates loading Google Fonts/CDNs, breaking CSP | Self-host fonts inside each template | ✓ |

### Front-end & UX
| # | AI error | How to avoid it | |
|---|---|---|---|
| 71 | `<div onclick>` instead of buttons | Real `<button>`, `<a>`, `<form>` | ✓ |
| 72 | Placeholder used as the label | Visible `<label>` for every input | ✓ |
| 73 | `alert()` for errors | Inline field errors + a `role="alert"` banner | ✓ |
| 74 | No loading state; double submits | Disable the button and change its label while busy | ✓ |
| 75 | Purple gradient hero, Inter only, uniform card grids (generic "AI look") | Brand palette, two distinct typefaces, asymmetric layout | ✓ |
| 76 | Invented testimonials and stats in templates | Templates say plainly which content is sample content | ✓ |
| 77 | Marketing filler ("seamless", "empower", "unlock") | Plain, specific copy | ✓ |
| 78 | `autocomplete="off"` on login fields (breaks password managers) | Correct `username`, `current-password`, `new-password`, `one-time-code` | ✓ |
| 79 | `type="number"` for phone or OTP (strips leading zeros) | `type="tel"` / `inputmode="numeric"` | ✓ |
| 80 | Fixed pixel widths that break on 360px phones | Fluid grid; tested at 390px | ✓ |
| 81 | Colour-only error indication | Red border **and** text message | ✓ |
| 82 | Low-contrast grey placeholder text | Contrast-checked placeholder colour | ✓ |
| 83 | Missing `lang` attribute | `<html lang="en">` | ✓ |
| 84 | `target="_blank"` without `rel="noopener"` | No external `_blank` links | ✓ |
| 85 | Polling forever after an error | Stop polling once status is `ready` or `failed` | ✓ |

### Process & honesty
| # | AI error | How to avoid it | |
|---|---|---|---|
| 86 | Invented npm packages (hallucinated names, typosquat risk) | Check every dependency exists and is the real one; keep the list short | ✓ |
| 87 | Outdated APIs (`express-rate-limit` v5 options, `crypto.createCipher`) | Check the docs for the installed version | ✓ |
| 88 | "TODO: add validation" left in the code | Search for TODO before release | ✓ |
| 89 | Claims of "production-ready" without tests | Tests that run the real HTTP app | ✓ |
| 90 | Tests that mock the very thing being tested | In-process server with a real DB | ✓ |
| 91 | Silently catching and ignoring errors (`catch {}`) | Log, and fail the operation visibly | ✓ |
| 92 | Copy-paste duplication across routes | Shared helpers (`startSession`, `deliverCode`, `parse`) | ✓ |
| 93 | Comments that describe the code wrongly after edits | Short comments that explain *why*; review them on change | ✓ |
| 94 | Mixing ESM and CommonJS randomly | CommonJS on the server, ES modules in the browser, consistently | ✓ |
| 95 | Huge dependency trees for trivial tasks (dotenv, uuid, lodash) | Use Node built-ins (`crypto.randomUUID`, a tiny .env loader) | ✓ |
| 96 | Generating a full ORM layer for 5 tables | Plain prepared SQL | ✓ |
| 97 | Not pinning dependency versions | Commit `package-lock.json`; use `npm ci` in deploys | ✓ |
| 98 | Accepting AI fixes for failing tests by weakening the test | Fix the code; tests only change when requirements change | ✓ |
| 99 | Assuming the AI checked licences of templates and fonts | Check each licence yourself (OFL for the fonts here) | ✓ |
| 100 | Shipping AI output without a human security review | Review against this playbook and get a pen test before launch | — |

---

## 3. Security measures — what a pen tester will try

| # | Attack a tester will try | Measure that stops it | |
|---|---|---|---|
| 1 | Enumerate accounts through sign-up responses | Identical 202 response; owner notified | ✓ |
| 2 | Enumerate through login error text | One generic message | ✓ |
| 3 | Enumerate through response timing | Dummy hash for missing users | ✓ |
| 4 | Enumerate through phone login | Same response for unknown numbers | ✓ |
| 5 | Brute-force a password | 30 attempts / 15 min / IP; slow KDF | ✓ |
| 6 | Credential stuffing from many IPs | Per-account throttling + breached-password check (HIBP k-anonymity) | partial |
| 7 | Brute-force a 6-digit OTP | 5 attempts per code + 15 verifications / 15 min / IP | ✓ |
| 8 | SMS pumping (toll fraud) | Resend cooldown, hourly cap per number, IP limit; add country allow-list | partial |
| 9 | Replay a used OTP | `used_at` set on success | ✓ |
| 10 | Use a sign-up code to log in | Purpose-bound codes | ✓ |
| 11 | Verify someone else's pending sign-up | Code tied to that pending user id and target | ✓ |
| 12 | Squat on a victim's email with a pending account | Pending accounts are replaced and expire | ✓ |
| 13 | Pre-account takeover via Google (create account with victim email, wait for them to use Google) | Only link Google to accounts whose email was verified | ✓ |
| 14 | OAuth CSRF (log the victim into the attacker's account) | `state` check | ✓ |
| 15 | Authorization code interception | PKCE S256 | ✓ |
| 16 | ID token replay | Nonce check + `maxTokenAge` | ✓ |
| 17 | Forged ID token | JWKS signature, issuer, audience checks | ✓ |
| 18 | Redirect URI manipulation | Fixed redirect URI, registered with Google | ✓ |
| 19 | Session fixation | New token on every login | ✓ |
| 20 | Session theft with XSS | `HttpOnly` cookie + strict CSP | ✓ |
| 21 | Session theft over HTTP | `Secure` + HSTS (preload) in production | ✓ |
| 22 | Cookie tossing from a subdomain | `__Host-` cookie prefix in production | ✓ |
| 23 | Stolen DB → valid session tokens | Only HMACs of tokens stored | ✓ |
| 24 | Long-lived stolen sessions | Idle + absolute expiry; sign out everywhere | ✓ |
| 25 | CSRF on state-changing endpoints | Origin check, JSON-only, SameSite=Lax | ✓ |
| 26 | CSRF through `text/plain` or form posts | 415 for non-JSON | ✓ |
| 27 | Clickjacking the login page | `frame-ancestors 'none'` | ✓ |
| 28 | Clickjacking an instance | `frame-ancestors 'self'` only | ✓ |
| 29 | Stored XSS through the business name | Input rejects `<>`; output escaped; `textContent` | ✓ |
| 30 | XSS / session abuse from instance templates | Escaped rendering; instance CSP `script-src 'none'`, `connect-src 'none'`, `form-action 'none'`; separate origin before enabling JS | ✓ |
| 31 | Reflected XSS through `?error=` | Only mapped keys displayed, via `textContent` | ✓ |
| 32 | DOM XSS through `?next=` | Regex allow-list; no `javascript:` | ✓ |
| 33 | Open redirect | Same | ✓ |
| 34 | IDOR on `/w/<id>/` | Ownership check; 404 otherwise | ✓ |
| 35 | IDOR on API objects | All account APIs use the session's user id only | ✓ |
| 36 | Instance id guessing | UUIDv4 (122 random bits) | ✓ |
| 37 | Path traversal `/w/<id>/../../data/app.db` | `send` normalises paths; root fixed per instance; UUID regex on id | ✓ |
| 38 | Fetch dotfiles from an instance | `dotfiles: 'deny'` | ✓ |
| 39 | Fetch instance metadata (incl. URL-encoded paths like `%69nstance.json`) | No metadata file exists in the served folder | ✓ |
| 40 | SQL injection in any field | Prepared statements | ✓ |
| 41 | NoSQL/JSON injection (objects where strings expected) | zod schemas force types | ✓ |
| 42 | Prototype pollution through JSON keys | zod strips unknown keys; no deep merges of user input | ✓ |
| 43 | Mass assignment (`status: 'active'` in the sign-up body) | Explicit fields only | ✓ |
| 44 | Oversized bodies (DoS) | 10 KB limit | ✓ |
| 45 | Slow-hash DoS (many logins to burn CPU) | IP rate limit; add a queue/limit on concurrent hashes | partial |
| 46 | ReDoS with crafted email strings | Simple anchored regexes, input max 254 characters | ✓ |
| 47 | Unicode homoglyph business names | NFKC normalise; consider confusable detection for slugs | partial |
| 48 | Command injection through the registry | `execFile`, argv array, ref regex | ✓ |
| 49 | SSRF through git repo URLs | https + host allow-list | ✓ |
| 50 | Malicious template with symlink to `/etc/passwd` | Symlinks skipped | ✓ |
| 51 | Zip-slip style escape in template subdir | `realpath` prefix check | ✓ |
| 52 | Huge template (disk exhaustion) | Size budget | ✓ |
| 53 | Git hooks executing on clone | No hooks on fresh clone; restricted env | ✓ |
| 54 | Header injection through phone/email in SMS/email APIs | Values validated; providers called with JSON/form encoding | ✓ |
| 55 | Email header injection (CRLF in subject) | Fixed subjects; email validated | ✓ |
| 56 | Host header poisoning in links | Links built from `APP_ORIGIN`, never `Host` | ✓ |
| 57 | X-Forwarded-For spoofing to evade rate limits | Exact `trust proxy` setting | ✓ |
| 58 | Information leaks in error pages | Generic 500s | ✓ |
| 59 | Stack fingerprinting | `x-powered-by` removed | ✓ |
| 60 | MIME sniffing | `nosniff` | ✓ |
| 61 | Referrer leaks of ids | `strict-origin-when-cross-origin` | ✓ |
| 62 | Browser feature abuse | `Permissions-Policy` denies camera, mic, geolocation, payment | ✓ |
| 63 | Mixed content | `upgrade-insecure-requests` in production | ✓ |
| 64 | Downgrade/strip TLS | HSTS 2 years, includeSubDomains, preload | ✓ |
| 65 | Weak TLS ciphers | Terminate TLS at a modern proxy (Caddy/nginx with Mozilla "intermediate") | ops |
| 66 | Exposed admin panels | None exist; keep admin on a separate VPN-only app | ✓ |
| 67 | Exposed `.git` on the server | Deploy build artifacts, not the working tree | ops |
| 68 | Exposed `.env` | Served directories never include the project root | ✓ |
| 69 | Directory listing | `express.static` doesn't list; `redirect: false` | ✓ |
| 70 | Cache of private pages in shared caches | `Cache-Control: private, no-store` on instances | ✓ |
| 71 | Back-button shows the dashboard after logout | API returns 401 → page redirects to sign-in | ✓ |
| 72 | Account takeover through phone number recycling | Encourage a verified email too; notify on new sign-ins | partial |
| 73 | SIM-swap takeover | Offer TOTP or passkeys for high-value accounts | — |
| 74 | Phishing of OTP codes | SMS text says "never share it"; add origin-bound passkeys | partial |
| 75 | Race: two sign-ups with the same email at once | UNIQUE index rejects the second | ✓ |
| 76 | Race: double provisioning | Unique `instances.user_id`; atomic rename | ✓ |
| 77 | Dependency with a known CVE | `npm audit` in CI; Dependabot/Renovate | ops |
| 78 | Malicious dependency update | Lockfile, `npm ci`, review diffs of new versions | ops |
| 79 | Leaked secrets in git history | Secret scanning (gitleaks) in CI and pre-commit | ops |
| 80 | Stolen backup | Backups encrypted with a separate key | ops |
| 81 | Insider reading PII in the DB | Field encryption; keys held outside the DB | ✓ |
| 82 | DB dump correlation (same email across tables) | Keyed blind index, not a plain hash | ✓ |
| 83 | Rainbow-tabling phone hashes | HMAC with secret key; phone space is small, so the key is essential | ✓ |
| 84 | Ciphertext swapping between users | AAD binds row id | ✓ |
| 85 | Key compromise | Key ids in ciphertext; rotation with `DATA_KEYS_OLD` | ✓ |
| 86 | Log injection (newlines in user input) | Structured logs; values never interpolated raw | partial |
| 87 | Audit log tampering | Ship logs to append-only storage | ops |
| 88 | Abuse of verification emails as spam | Rate limits per target and IP | ✓ |
| 89 | Bots creating fake businesses | Add a challenge (Turnstile/hCaptcha) after N sign-ups per IP | — |
| 90 | Account deletion by CSRF | All writes protected; add re-authentication for deletion | ✓ / — |
| 91 | Privilege escalation to admin | No roles in the app yet; when added, check them server-side per route | ✓ |
| 92 | Tenant data mixing in a future shared DB | Postgres row-level security keyed on tenant id | documented |
| 93 | WebSocket/SSE auth bypass (future) | Same session check on upgrade | n/a |
| 94 | Subdomain takeover of `*.yourdomain` instances | Remove DNS records when deleting tenants | documented |
| 95 | Cross-tenant XSS on shared origin | Separate origin per tenant in production | documented |
| 96 | Timing attack on OTP comparison | HMAC compare with `timingSafeEqual` | ✓ |
| 97 | Weak randomness in UUIDs | `crypto.randomUUID` | ✓ |
| 98 | Debug endpoints left on | None exist; dev outbox is in-memory only, never served | ✓ |
| 99 | Missing security.txt / disclosure path | Add `/.well-known/security.txt` with a contact | — |
| 100 | No re-test after fixes | Keep the tests in this repo; re-run the pen test each major release | ✓ |

---

## 4. Source code storage & protection

| # | Risk / mistake | How to avoid it | |
|---|---|---|---|
| 1 | Code only on one laptop | Private remote (GitHub/GitLab) + second mirror | — |
| 2 | Public repo by accident | Default org setting: private; review visibility monthly | ops |
| 3 | Secrets committed | `.gitignore` for `.env`, data, instances | ✓ |
| 4 | Secrets in git history | gitleaks pre-commit + CI; rotate any leaked key immediately | ops |
| 5 | Example config with real values | `.env.example` with blanks only | ✓ |
| 6 | Everyone has admin on the repo | Least privilege: write for devs, admin for 1–2 owners | ops |
| 7 | Shared GitHub account between partners | One account per person; offboarding is removing one user | ops |
| 8 | No 2FA on code hosting | Require 2FA (prefer hardware keys/passkeys) org-wide | ops |
| 9 | Pushing directly to `main` | Branch protection: PR + review + passing tests | ops |
| 10 | Force-push rewriting history | Disable force-push on protected branches | ops |
| 11 | Unsigned commits | Sign commits (SSH or GPG); require on `main` | ops |
| 12 | Personal access tokens with full scope | Fine-grained, repo-scoped, expiring tokens | ops |
| 13 | Deploy keys with write access | Read-only deploy keys per server | ops |
| 14 | CI secrets readable by fork PRs | Don't expose secrets to `pull_request` from forks | ops |
| 15 | Third-party GitHub Actions pinned to a tag | Pin actions to a commit SHA | ops |
| 16 | No dependency lockfile | Commit `package-lock.json` | ✓ |
| 17 | `npm install` in production | `npm ci --omit=dev` | ops |
| 18 | Unreviewed dependency bumps | Renovate/Dependabot PRs, reviewed and tested | ops |
| 19 | Typosquatted packages | Check publisher and download counts; keep the dependency list short (6 runtime deps) | ✓ |
| 20 | Install scripts running arbitrary code | `npm ci --ignore-scripts` where possible | ops |
| 21 | No SBOM | Generate one (`npm sbom`) per release | — |
| 22 | No vulnerability scanning | `npm audit` + GitHub code scanning in CI | ops |
| 23 | No static analysis | ESLint with security plugin; Semgrep rules for Express | — |
| 24 | Template repos editable by anyone | Separate org/team for templates; tags protected | ops |
| 25 | Template tags moved after release | Protect tags; pin by SHA for critical types | ✓ (SHA supported) |
| 26 | Unknown template provenance | Registry records repo@ref; cache records the exact commit | ✓ |
| 27 | Licences of assets not tracked | `LICENSE` per source; fonts are OFL | ✓ |
| 28 | Mixing client-specific code into the core repo | Core app vs template repos vs client instances, kept separate | ✓ |
| 29 | Client instances only on the server disk | Back up instances; optionally commit each client's instance to its own private repo | documented |
| 30 | No README for running the project | README with exact commands | ✓ |
| 31 | No changelog | Keep `CHANGELOG.md` with security fixes called out | — |
| 32 | No versioning | Semantic versions + git tags per release | — |
| 33 | No code owners | `CODEOWNERS` for `server/crypto.js`, `server/routes/*`, `provisioning/*` | — |
| 34 | Crypto code changed without review | Require owner review for `crypto.js` | — |
| 35 | Large binaries bloating the repo | Keep fonts small (woff2 subsets); use LFS for big media | ✓ |
| 36 | `node_modules` committed | `.gitignore` | ✓ |
| 37 | Local DB committed | `*.db` ignored | ✓ |
| 38 | Customer data in test fixtures | Synthetic test data only | ✓ |
| 39 | Production data copied to dev laptops | Use synthetic or anonymised data in dev | ops |
| 40 | Laptops without disk encryption | BitLocker/FileVault/LUKS on every dev machine | ops |
| 41 | No screen lock / shared machines | Auto-lock; separate OS accounts | ops |
| 42 | SSH keys without passphrases | Passphrase + agent, or hardware-backed keys | ops |
| 43 | Same SSH key everywhere | One key per device; revoke on loss | ops |
| 44 | Code shared on WhatsApp or USB sticks | Share through the repo only | ops |
| 45 | Leaving former partners' access active | Offboarding checklist: repo, CI, cloud, DNS, registrar, email | ops |
| 46 | Single owner of the domain/registrar | Two owners with 2FA; registrar lock on | ops |
| 47 | Cloud console with root account in daily use | Root locked away; IAM users/roles with least privilege | ops |
| 48 | Secrets in CI logs | Mask secrets; never `echo` env vars | ops |
| 49 | Build artifacts not reproducible | Lockfile + pinned Node version (`engines`) | ✓ |
| 50 | Deploying from a laptop | Deploy from CI only, from tagged commits | ops |
| 51 | No staging environment | Staging with separate keys and data | ops |
| 52 | Same keys in staging and production | Separate keys per environment (`npm run keys` each) | ✓ |
| 53 | Source maps exposing server code | Server code isn't sent to browsers; front-end is unbundled and has nothing secret | ✓ |
| 54 | Comments containing secrets or internal URLs | Review comments in PRs; secret scanning | ops |
| 55 | Debug flags shipped | Production config validated at boot | ✓ |
| 56 | `git clone` of the whole repo onto production servers | Ship only built output (`server/`, `public/`, `templates/`, `config/`) | ops |
| 57 | Writable code directory on the server | App user can write only to `data/`, `instances/`, `cache/` | ops |
| 58 | App running as root | Dedicated system user; systemd hardening (`ProtectSystem=strict`) | ops |
| 59 | No file integrity monitoring | Read-only app directory + checksum of releases | ops |
| 60 | Code backups in the same account as production | Off-site mirror under different credentials | ops |
| 61 | Repo backups never restored | Quarterly restore test | ops |
| 62 | AI assistants given repo-wide secrets | Never paste `.env` or keys into AI tools | ops |
| 63 | Pasting proprietary code into public AI chats without care | Use business/enterprise plans with data controls; strip secrets | ops |
| 64 | Generated code merged without attribution or review | PR template: "AI-assisted? reviewed by:" | ops |
| 65 | Licence contamination from copied snippets | Check snippet sources; prefer permissive licences | ops |
| 66 | Obfuscation instead of security | Assume attackers can read your code; rely on keys, not secrecy | ✓ |
| 67 | Hard-coded tenant/business lists in code | Registry file outside the code | ✓ |
| 68 | Config changes not reviewed | Registry changes go through PRs like code | ops |
| 69 | Registry edited live on the server without a record | Edit in git, deploy; the server hot-reloads | ✓ |
| 70 | No issue tracker for security bugs | Private security issues/advisories | ops |
| 71 | Security fixes discussed in public channels | Private channel + GitHub security advisories | ops |
| 72 | Outdated Node runtime | Track Node LTS; `engines` field set | ✓ |
| 73 | No automated tests in CI | `npm test` on every PR | — |
| 74 | Flaky tests ignored | Fix or delete; never skip silently | ops |
| 75 | Test credentials that work in production | Tests create their own temp DB and keys | ✓ |
| 76 | One giant commit per week | Small commits with clear messages | ops |
| 77 | Merge conflicts resolved by deleting code | Review the conflict diff in the PR | ops |
| 78 | No `.editorconfig` / formatting rules | Prettier + ESLint configs in repo | — |
| 79 | Container images from random authors | Official `node:22-alpine`/distroless base; pin by digest | ops |
| 80 | Containers running as root | `USER node` in Dockerfile | ops |
| 81 | Image includes dev dependencies and tests | Multi-stage build | ops |
| 82 | No image scanning | Trivy/Grype in CI | ops |
| 83 | Infrastructure clicked together by hand | Infrastructure as code (Terraform/compose files) in git | ops |
| 84 | IaC with secrets inline | Reference a secret manager | ops |
| 85 | DNS records left after removing services | Inventory DNS; remove stale records (subdomain takeover) | ops |
| 86 | Partner-owned company license but personally owned code | Write down IP ownership in the partnership agreement | ops |
| 87 | Client contracts silent on code ownership | State who owns template vs client customisations | ops |
| 88 | No escrow/handover plan if a developer leaves | Documented runbook + access held by two people | ops |
| 89 | Knowledge only in one person's head | Docs in repo (`README`, `INSTANCES`, `PLAYBOOK`) | ✓ |
| 90 | Architecture decisions undocumented | ADRs in `docs/adr/` | — |
| 91 | No threat model | This playbook; update per feature | ✓ |
| 92 | Ignoring warnings at build/run time | Treat warnings as tasks (e.g. node:sqlite experimental) | ops |
| 93 | Unused code and routes left in | Delete dead code; fewer routes, smaller attack surface | ✓ |
| 94 | Feature flags never cleaned up | Remove flags after rollout | ops |
| 95 | Copy-pasted templates diverging | Shared base + per-type overrides; one source per look | ✓ |
| 96 | Template fonts fetched at runtime from CDNs | Fonts copied into each template | ✓ |
| 97 | Templates with analytics scripts by default | No third-party scripts in templates | ✓ |
| 98 | No review of template repos before registering | Review diff between tags before bumping `ref` | ops |
| 99 | Losing the cache when it matters | Cache is disposable; it rebuilds from repo@ref | ✓ |
| 100 | Never revisiting these rules | Review this list every quarter | ops |

---

## 5. User data storage & encryption

| # | Risk / mistake | How to avoid it | |
|---|---|---|---|
| 1 | PII stored in plaintext | AES-256-GCM per field (email, phone, business name) | ✓ |
| 2 | Encryption key stored in the same DB | Keys in env/secret manager, never in the DB | ✓ |
| 3 | One key for everything | Separate data, index and token keys | ✓ |
| 4 | No key id in ciphertext (rotation impossible) | Format `v1.<keyId>.<iv>.<tag>.<ct>` | ✓ |
| 5 | Rotation means downtime | New key for writes; old keys kept for reads; background re-encrypt | ✓ (read side) |
| 6 | Ciphertext movable between rows/columns | AAD = `table.column:rowId` | ✓ |
| 7 | IV reuse with GCM | Random 12-byte IV every time | ✓ |
| 8 | Unauthenticated encryption | GCM auth tag checked on decrypt | ✓ |
| 9 | Plain SHA-256 of emails for lookups (guessable) | HMAC blind index with a secret key | ✓ |
| 10 | Blind index of un-normalised values | Normalise first (lowercase email, E.164 phone) | ✓ |
| 11 | Passwords encrypted (reversible) | Hashed with scrypt, never encrypted | ✓ |
| 12 | Weak password hashing parameters | scrypt N=2^17, r=8, p=1, 16-byte salt | ✓ |
| 13 | No way to strengthen hashes later | Self-describing hash string + rehash on login | ✓ |
| 14 | OTP codes stored readable | HMAC only | ✓ |
| 15 | Session tokens stored readable | HMAC only | ✓ |
| 16 | IP addresses stored raw forever | Truncated HMAC in the audit log | ✓ |
| 17 | Logs containing emails/phones | Log ids, not PII | ✓ |
| 18 | Collecting data you don't need | Only name, type, email, phone | ✓ |
| 19 | No retention limits | Pending users 1–24 h, codes purged after a day | ✓ |
| 20 | No retention for audit logs | Keep 12 months, then delete or archive encrypted | — |
| 21 | PII written into instance files | Only business name/type rendered | ✓ |
| 22 | Instance metadata containing secrets | Metadata lives only in the DB, never in served files | ✓ |
| 23 | DB file readable by other OS users | `0600`; data dir `0700` | ✓ |
| 24 | Disk not encrypted | Encrypted volumes (cloud default or LUKS) | ops |
| 25 | Backups unencrypted | Encrypt backups (age/restic) with a separate key | ops |
| 26 | Backup key stored next to backups | Different account/location for keys | ops |
| 27 | Backups never tested | Monthly restore drill into staging | ops |
| 28 | Backups kept forever | Rotation (e.g. 7 daily, 4 weekly, 12 monthly) | ops |
| 29 | Deleted users still in backups indefinitely | Document backup expiry in the privacy policy | ops |
| 30 | No point-in-time recovery | WAL mode now; Litestream (SQLite) or PITR (Postgres) | partial |
| 31 | DB connection without TLS (Postgres) | `sslmode=verify-full` | documented |
| 32 | App DB user is superuser | Least-privilege DB role | ops |
| 33 | No row-level isolation in a shared DB | Postgres RLS by tenant id | documented |
| 34 | Tenant data in the same table without tenant id | Every tenant table has `tenant_id`, indexed and enforced | documented |
| 35 | Secrets in environment visible to all processes | Secret manager or systemd credentials; restricted users | ops |
| 36 | Keys printed in logs at boot | Never log config values | ✓ |
| 37 | Dev fallback keys used in production | Boot refuses in production without real keys | ✓ |
| 38 | Short or non-random keys | Exactly 32 bytes, base64, checked at boot | ✓ |
| 39 | Keys shared over chat | Share via a password manager or secret manager only | ops |
| 40 | No key backup (data lost forever if the key is lost) | Escrow keys offline (two people, sealed) | ops |
| 41 | No envelope encryption at scale | Wrap the data key with a cloud KMS key | — |
| 42 | Decrypting everything for list views | Decrypt only what the owner's view needs | ✓ |
| 43 | Admin tools showing full PII by default | Mask by default (`ow•••@`, `+93 ••• ••• 567`) | ✓ |
| 44 | PII in URLs (end up in logs and Referer) | PII only in POST bodies | ✓ |
| 45 | PII in analytics | No analytics on auth pages | ✓ |
| 46 | PII cached by the browser | `no-store` on private responses | ✓ (instances) |
| 47 | Autocomplete leaking on shared PCs | Correct autocomplete tokens; users can choose | ✓ |
| 48 | Email provider retaining message bodies | Codes expire in 10 min; choose a provider with retention controls | ✓ / ops |
| 49 | SMS provider logs containing codes | Same; short expiry limits exposure | ✓ |
| 50 | Third-party processors not listed | Privacy notice lists Google, email and SMS providers | — |
| 51 | No privacy notice | Publish one before launch | — |
| 52 | No consent record | Store terms/privacy version accepted at sign-up | — |
| 53 | No data export for the user | "Download my data" (JSON) from the dashboard | — |
| 54 | No account deletion | Delete user → cascade DB → delete instance folder | partial |
| 55 | Soft-delete keeping PII forever | Hard delete PII; keep only anonymous counters | — |
| 56 | Unclear legal basis for storing data abroad | Choose the hosting region deliberately; document it | ops |
| 57 | Health data (clinics) stored like any other data | Clinic instances: separate DB per tenant + stricter access | documented |
| 58 | Financial data (accounting clients) mixed with site data | Separate DB/schema per tenant for financial apps | documented |
| 59 | Uploading customer files to the app server disk | Object storage with per-tenant prefixes and signed URLs | — |
| 60 | Public bucket for uploads | Private bucket; access through signed URLs | — |
| 61 | Filenames from users used as storage paths | Random object keys; original name stored as metadata | — |
| 62 | No malware scanning of uploads | Scan uploads (ClamAV) before serving | — |
| 63 | Images keeping EXIF GPS data | Strip metadata on upload | — |
| 64 | Rendering uploaded HTML/SVG inline | Serve as attachment or from a sandboxed origin | — |
| 65 | Unlimited upload size | Per-file and per-tenant quotas | — |
| 66 | Search on encrypted data done by decrypting all rows | Blind indexes for exact match; tokenised indexes when needed | ✓ |
| 67 | Phone numbers recycled to new owners | Re-verify periodically; prefer email for recovery | partial |
| 68 | Google `sub` stored encrypted, so it can't be looked up | `sub` is an opaque id, stored as-is for lookups | ✓ |
| 69 | Google access/refresh tokens stored but never used | Don't store them (only the ID token is used, then discarded) | ✓ |
| 70 | Long-lived temporary OAuth records | 30-minute expiry on pending Google sign-ups | ✓ |
| 71 | Temporary cookies holding PII | Signed cookies hold random ids/state only | ✓ |
| 72 | Unsigned temporary cookies | HMAC-signed with expiry | ✓ |
| 73 | Mixed time zones in records | UTC epoch milliseconds | ✓ |
| 74 | Data integrity unchecked | GCM tags detect tampering; FK constraints | ✓ |
| 75 | No audit of who accessed PII | Log admin decrypt events when an admin tool exists | — |
| 76 | Support staff sharing one admin login | Individual admin accounts with 2FA | ops |
| 77 | Developers querying production directly | Break-glass access with logging | ops |
| 78 | Prod DB copies for debugging | Anonymise before copying | ops |
| 79 | No data classification | Classify: secret (keys), PII (encrypted), public (templates) | ✓ |
| 80 | Encryption covering storage but not transport | HTTPS everywhere, HSTS | ✓ |
| 81 | TLS between proxy and app unencrypted on shared networks | Keep the app on localhost/private network, or use internal TLS | ops |
| 82 | Weak random for ids | `crypto.randomUUID` | ✓ |
| 83 | Sequential ids leaking user counts | UUIDs | ✓ |
| 84 | Re-encrypting with a compromised key | Rotate: new key id, re-encrypt all rows, then destroy the old key | documented |
| 85 | No incident plan for a data breach | Write one: contain, rotate keys, notify users, review | — |
| 86 | No breach detection | Alerts on unusual login failures and mass reads | — |
| 87 | Exports/reports emailed as plaintext attachments | Download links behind sign-in | — |
| 88 | Excel exports with PII left on laptops | Avoid exports; if needed, encrypt and expire them | ops |
| 89 | Copying production data into AI tools | Never paste customer data into AI chats | ops |
| 90 | No minimum-age or role checks where law requires | Business accounts only; terms state it | — |
| 91 | Child accounts in templates (schools) | School instances must not collect student data without a DPA | documented |
| 92 | No separation of business and personal data | Business fields only; the owner's personal data isn't required | ✓ |
| 93 | No data ownership terms with clients | Contract: client owns their data; you're the processor | ops |
| 94 | Vendor lock-in with no export | Plain SQL schema; documented migration to Postgres | ✓ |
| 95 | Schema changes that lose data | Versioned migrations in transactions; backups before migrating | ✓ / ops |
| 96 | Encryption library updates breaking decryption | Built-in Node crypto only; version byte for format changes | ✓ |
| 97 | Hard-to-audit custom crypto | One 100-line `crypto.js`, standard primitives only | ✓ |
| 98 | Testing that only checks crypto "works" | Test asserts plaintext isn't in the DB at all | ✓ |
| 99 | No periodic review of stored fields | Quarterly: delete fields you no longer need | ops |
| 100 | Treating encryption as the whole answer | Encryption + access control + minimisation + monitoring together | ✓ |

---

*✓ = done in this repository · partial = started · documented = described in docs/INSTANCES.md · ops = operational/process step outside the code · — = not done yet.*
