# How each user gets their own instance

## The short version

An **instance** is one user's private copy of their business type's template. It is created from a **source**, which is either a folder in `templates/` or a git repository pinned to a tag or commit. The mapping from business type to source lives in **`config/business-types.json`**.

```
config/business-types.json
  "bakery" → { kind: local, path: templates/food }
  "tailor" → { kind: git, repo: github.com/you/tailor-template, ref: v1.2.0 }
                    │
                    ▼  (on sign-up confirmation)
server/provisioning/provision.js
  1. resolve source   local folder, or shallow-clone repo@ref once into cache/sources/<hash>
  2. copy             regular files only → instances/.staging-<id>-<rand>/
                      skips symlinks, .git, .env, node_modules; size-capped
  3. render           {{business_name}} {{business_type}} {{year}} → HTML-escaped values
  4. atomic rename    .staging-… → instances/<instanceId>/      ← now "ready"
                    │
                    ▼
DB: instances(id, user_id, business_type, source_kind, source_ref, status)
Served at /w/<instanceId>/ — owner only, same 404 for "missing" and "not yours",
with a CSP that allows NO scripts, fetches or form posts (instances share the app's origin)
```

If anything fails, the staging folder is deleted, the row is marked `failed` with a short reason, and the dashboard shows **Try again**. A half-built instance is never served.

## Step by step: adding a business type from a source repository

1. **Make the template repo.** It needs an `index.html` at the root, or in a sub-folder that you name with `subdir` (for example `dist` if the repo has a build step and you commit the build output). Put `{{business_name}}` wherever the name should appear.
2. **Tag a release:** `git tag v1.0.0 && git push --tags`.
3. **Register it** in `config/business-types.json`:
   ```json
   { "id": "tailor", "label": "Tailor", "group": "Shops & trade",
     "source": { "kind": "git", "repo": "https://github.com/your-org/tailor-template.git", "ref": "v1.0.0" } }
   ```
4. Run **`npm run check-types`**. It validates the id format, duplicate ids, the https scheme, the allowed host and the ref format.
5. Sign up a test account with that type and open the workspace.

**Private repos:** don't put a token in the URL, because it would end up in the registry, the logs and the DB. Use a deploy key or a read-only machine user configured for the server's git (SSH key or credential helper), and add the host to `GIT_ALLOWED_HOSTS`. Or mirror the repo's built output into `templates/` in CI and use a `local` source.

## Updating a template without breaking existing users

- Existing instances are **copies**. Releasing `v1.1.0` and pointing the registry at it affects **new** sign-ups only.
- `instances.source_ref` records exactly what each user got, so you can find everyone still on `v1.0.0`.
- To upgrade existing users, write a migration script that re-provisions into staging, carries over the user's own edits (keep user content in `content/` or the DB, not mixed into template files), then renames atomically. Test it on a copy first.

## The five ways to build "an instance per user", and when to switch

| # | Approach | What it is | Good for | Breaks down when |
|---|---|---|---|---|
| 1 | **File copy per user** *(implemented)* | Copy template folder → `instances/<id>/` | Static or mostly static sites; dozens to low thousands of users; fully customisable per client | Templates need a backend and DB per user, or you have tens of thousands of users |
| 2 | **Git repo per user** | GitHub "generate from template" API → `client-<id>` repo, deploy each | Each client is a real custom project that your devs maintain | Hundreds of repos to patch; per-repo CI cost |
| 3 | **Shared code, tenant-scoped data** (multi-tenant) | One deployment; every table has `tenant_id`; template chosen at runtime by business type | SaaS-style apps (POS, accounting, booking). Cheapest to run and patch | You need deep per-client code changes |
| 4 | **Container per tenant** | Docker image per business type; one container + volume per user | Instances that run their own server-side code or DB | Ops cost, cold starts, orchestration |
| 5 | **Database per tenant** | Shared code, separate SQLite/Postgres DB per user | Strong data isolation (clinics, accounting) with shared code | Migrations must run N times |

A practical path: start with **#1** (this repo) for websites. Move apps like RAS-Accounting or Sharq DB to **#3**, enforcing `tenant_id` with Postgres row-level security. Use **#5** for clients who contractually need isolated data.

## Production checklist for instances

- **Separate origin.** Serve instances from `https://<slug>.yourdomain.com` (wildcard DNS + wildcard TLS) or a separate user-content domain, never from the same origin as the account app. Then a template's JavaScript can never call `/api/*` with the owner's cookies. This repo serves `/w/<id>/` same-origin for simplicity and locks it down with a CSP that blocks all scripts, fetches and form posts in instances, and a `__Host-` cookie in production. **Move instances to their own origin before allowing template JavaScript.**
- **Slugs.** If you expose `<slug>.yourdomain.com`, generate the slug from the business name, keep it unique, never reuse a deleted one, and keep a reserved list (`www`, `api`, `admin`, `mail`).
- **Storage.** For more than one server, put instances in object storage (S3/R2) under `instances/<id>/`, not on local disk, and serve them through a CDN with signed URLs or an auth check at the edge.
- **Backups.** Back up the DB and the instances together. An instance without its DB row is unreachable, and a row without files shows as failed.
- **Deletion.** When an account is deleted, delete `instances/<id>/` and the backups after the retention period. The `ON DELETE CASCADE` only handles the DB side.

## Moving to Postgres

`server/db.js` keeps to plain SQL that ports directly: `TEXT` primary keys become `uuid`, `INTEGER` timestamps become `bigint` (or `timestamptz`), and `BEGIN IMMEDIATE` becomes `BEGIN`. Swap `node:sqlite` for `pg` in `db.js`/`store.js`, and turn on `sslmode=verify-full` and row-level security if you adopt approach #3.
