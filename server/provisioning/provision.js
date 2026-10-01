'use strict';
/**
 * Creates a user's instance: a private copy of their business type's source.
 *
 *   source (templates/<x> or git repo@ref)
 *        │  1. resolve: local folder, or shallow clone into cache/sources/<hash> (once per ref)
 *        ▼
 *   instances/.staging-<id>-<rand>
 *        │  2. copy: regular files only — no symlinks, no .git/.env/node_modules, size-capped
 *        │  3. render: {{business_name}} etc. HTML-escaped into .html/.svg/.txt/.md only
 *        ▼
 *   instances/<instanceId>        ← 5. atomic rename; only now is the instance "ready"
 *
 * Failure at any step leaves no half-built instance: the staging folder is removed
 * and the DB row is marked "failed" with a short reason the owner can retry from.
 */
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const config = require('../config');
const registry = require('./registry');

const run = promisify(execFile);

const SKIP_NAMES = new Set(['.git', '.github', '.env', '.env.local', 'node_modules', '.DS_Store', 'Thumbs.db']);
const RENDER_EXT = new Set(['.html', '.htm', '.svg', '.txt', '.md']);

const escapeHtml = (s) => String(s).replace(/[&<>"'`=]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;', '=': '&#61;' }[ch]));

function sourceDescriptor(type) {
  const s = type.source;
  return s.kind === 'local'
    ? { sourceKind: 'local', sourceRef: s.path }
    : { sourceKind: 'git', sourceRef: `${s.repo}@${s.ref}${s.subdir ? ':' + s.subdir : ''}` };
}

// One in-flight clone per repo@ref, so 50 simultaneous sign-ups don't start 50 clones.
const inflightClones = new Map();

async function resolveSourceDir(type) {
  const s = type.source;
  if (s.kind === 'local') return s.absPath;

  const key = crypto.createHash('sha256').update(`${s.repo}@${s.ref}`).digest('hex').slice(0, 24);
  const dir = path.join(config.sourceCacheDir, key);
  const done = path.join(dir, '.aminzi-ready');
  if (!fs.existsSync(done)) {
    if (!inflightClones.has(key)) {
      inflightClones.set(key, cloneInto(s, dir).finally(() => inflightClones.delete(key)));
    }
    await inflightClones.get(key);
  }
  const root = s.subdir ? path.join(dir, s.subdir) : dir;
  const real = await fsp.realpath(root);
  if (!real.startsWith(await fsp.realpath(dir))) throw new Error('subdir escapes the repository');
  return real;
}

async function cloneInto(s, dir) {
  const tmp = `${dir}.tmp-${crypto.randomBytes(4).toString('hex')}`;
  await fsp.mkdir(tmp, { recursive: true });
  // execFile (no shell) + fixed argv: repo/ref can't inject shell syntax.
  // protocol.*.allow blocks file://, ext:: and other transport tricks; no credentials prompt.
  const env = { PATH: process.env.PATH, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo', HOME: tmp };
  const git = (...args) => run('git', ['-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', 'core.symlinks=false', '-c', 'http.followRedirects=false', ...args],
    { cwd: tmp, env, timeout: config.provisioning.gitTimeoutMs, maxBuffer: 1024 * 1024 });
  try {
    await git('init', '--quiet');
    await git('remote', 'add', 'origin', s.repo);
    // Works for tags, branches and full commit SHAs (GitHub/GitLab allow fetching reachable SHAs).
    await git('fetch', '--depth', '1', '--no-tags', 'origin', '--', s.ref);
    await git('checkout', '--quiet', 'FETCH_HEAD');
    const { stdout } = await git('rev-parse', 'HEAD');
    await fsp.rm(path.join(tmp, '.git'), { recursive: true, force: true });
    await fsp.writeFile(path.join(tmp, '.aminzi-ready'), JSON.stringify({ repo: s.repo, ref: s.ref, commit: stdout.trim(), at: new Date().toISOString() }));
    await fsp.rm(dir, { recursive: true, force: true });
    await fsp.rename(tmp, dir);
  } catch (e) {
    await fsp.rm(tmp, { recursive: true, force: true });
    throw new Error(`Could not fetch template source (${e.code || 'git error'})`);
  }
}

async function copyTree(src, dest, budget) {
  await fsp.mkdir(dest, { recursive: true, mode: 0o750 });
  for (const entry of await fsp.readdir(src, { withFileTypes: true })) {
    if (SKIP_NAMES.has(entry.name) || entry.name.startsWith('.aminzi')) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    const st = await fsp.lstat(from);
    if (st.isSymbolicLink()) continue;             // never follow links out of the template
    if (st.isDirectory()) { await copyTree(from, to, budget); continue; }
    if (!st.isFile()) continue;                    // sockets, devices, fifos
    budget.bytes += st.size;
    if (budget.bytes > config.provisioning.maxTemplateBytes) throw new Error('Template is larger than MAX_TEMPLATE_MB');
    await fsp.copyFile(from, to);
    await fsp.chmod(to, 0o640);
  }
}

async function renderTree(dir, vars) {
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) { await renderTree(p, vars); continue; }
    if (!RENDER_EXT.has(path.extname(entry.name).toLowerCase())) continue;
    const text = await fsp.readFile(p, 'utf8');
    // Only known keys are replaced; unknown {{...}} are left for the template author to see.
    const out = text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k) => (Object.hasOwn(vars, k) ? escapeHtml(vars[k]) : m));
    if (out !== text) await fsp.writeFile(p, out);
  }
}

/**
 * Provision (or re-provision after failure) the instance for a user.
 * Safe to call again: the DB row and folder are replaced atomically.
 */
async function provision(store, userId) {
  const raw = store.users.byId(userId);
  if (!raw || raw.status !== 'active') throw new Error('User is not active');
  const user = store.users.view(raw);
  const type = registry.get(user.businessType);
  if (!type) throw new Error(`Unknown business type ${user.businessType}`);

  const desc = sourceDescriptor(type);
  let inst = store.instances.byUser(userId);
  if (inst && inst.status === 'ready') return inst;
  if (inst) store.instances.resetForRetry(inst.id, desc);
  else inst = store.instances.byId(store.instances.create({ userId, businessType: type.id, ...desc }));

  const finalDir = path.join(config.instancesDir, inst.id);
  const staging = path.join(config.instancesDir, `.staging-${inst.id}-${crypto.randomBytes(4).toString('hex')}`);
  try {
    await fsp.mkdir(config.instancesDir, { recursive: true, mode: 0o750 });
    const src = await resolveSourceDir(type);
    await copyTree(src, staging, { bytes: 0 });
    // Only non-sensitive values are rendered into files. Email/phone stay encrypted in the DB:
    // instance files are plaintext on disk and may later be published.
    await renderTree(staging, {
      business_name: user.businessName,
      business_type: type.label,
      year: String(new Date().getFullYear()),
    });
    await fsp.rm(finalDir, { recursive: true, force: true });
    await fsp.rename(staging, finalDir);
    store.instances.setStatus(inst.id, 'ready');
    store.audit('instance.ready', { userId, detail: `${type.id} from ${desc.sourceRef}` });
  } catch (e) {
    await fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
    store.instances.setStatus(inst.id, 'failed', String(e.message).slice(0, 200));
    store.audit('instance.failed', { userId, detail: e.message });
    console.error(`[provision] ${inst.id}: ${e.message}`);
  }
  return store.instances.byId(inst.id);
}

/** Fire-and-forget wrapper used by request handlers. */
function provisionInBackground(store, userId) {
  // Calling (not deferring) means the DB row is created synchronously before the first await,
  // so the dashboard immediately sees status "provisioning".
  const p = provision(store, userId).catch(e => console.error('[provision]', e));
  return p;
}

module.exports = { provision, provisionInBackground, escapeHtml };
