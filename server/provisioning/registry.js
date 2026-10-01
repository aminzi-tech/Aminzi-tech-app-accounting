'use strict';
/**
 * Loads and validates config/business-types.json.
 * Re-reads automatically when the file's mtime changes, so adding a business
 * type does not need a restart. An invalid edit is rejected and the last good
 * version keeps serving (the error is logged), so a typo can't take sign up down.
 */
const fs = require('node:fs');
const path = require('node:path');
const { z } = require('zod');
const config = require('../config');

const TEMPLATES_ROOT = path.join(config.root, 'templates');

const gitRef = z.string().regex(/^(?!-)[A-Za-z0-9._/-]{1,100}$/, 'ref must be a tag, branch or commit SHA');

const source = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('local'),
    path: z.string().min(1),
  }),
  z.object({
    kind: z.literal('git'),
    repo: z.string().url().refine(u => u.startsWith('https://'), 'git repo must use https://'),
    ref: gitRef,
    subdir: z.string().regex(/^[A-Za-z0-9_-][A-Za-z0-9._/-]{0,100}$/).refine(s => !s.split('/').includes('..'), 'subdir may not contain ..').optional(),
  }),
]);

const typeSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/, 'id: lowercase letters, digits and dashes'),
  label: z.string().min(2).max(60),
  group: z.string().min(2).max(40),
  description: z.string().max(200).optional(),
  enabled: z.boolean().default(true),
  source,
});

const fileSchema = z.object({
  version: z.literal(1),
  types: z.array(typeSchema).min(1),
}).passthrough();

let cache = { mtimeMs: -1, byId: new Map(), list: [] };

function validate(parsed) {
  const data = fileSchema.parse(parsed);
  const byId = new Map();
  for (const t of data.types) {
    if (byId.has(t.id)) throw new Error(`Duplicate business type id "${t.id}"`);
    if (t.source.kind === 'local') {
      const abs = path.resolve(config.root, t.source.path);
      // Local sources must live inside templates/ — no ../../etc tricks.
      if (abs !== TEMPLATES_ROOT && !abs.startsWith(TEMPLATES_ROOT + path.sep)) {
        throw new Error(`Type "${t.id}": local source must be inside templates/`);
      }
      if (!fs.existsSync(path.join(abs, 'index.html'))) throw new Error(`Type "${t.id}": ${t.source.path}/index.html not found`);
      t.source.absPath = abs;
    } else {
      const host = new URL(t.source.repo).hostname;
      if (!config.provisioning.gitAllowedHosts.includes(host)) {
        throw new Error(`Type "${t.id}": host ${host} is not in GIT_ALLOWED_HOSTS`);
      }
    }
    byId.set(t.id, Object.freeze(t));
  }
  return { byId, list: data.types };
}

function refresh() {
  let stat;
  try { stat = fs.statSync(config.registryFile); } catch (e) {
    if (cache.mtimeMs === -1) throw new Error(`Business type registry not found at ${config.registryFile}`);
    return;
  }
  if (stat.mtimeMs === cache.mtimeMs) return;
  try {
    const next = validate(JSON.parse(fs.readFileSync(config.registryFile, 'utf8')));
    cache = { mtimeMs: stat.mtimeMs, ...next };
  } catch (e) {
    if (cache.mtimeMs === -1) throw e; // first load must succeed
    console.error(`[registry] Ignoring invalid edit to ${config.registryFile}: ${e.message}`);
    cache.mtimeMs = stat.mtimeMs;       // don't re-log every request
  }
}

module.exports = {
  refresh,
  has(id) { refresh(); const t = cache.byId.get(id); return !!t && t.enabled; },
  /** Existing users keep working even if their type was later disabled. */
  get(id) { refresh(); return cache.byId.get(id) || null; },
  /** Public list for the sign-up dropdown. Never exposes source paths or repo URLs. */
  publicList() {
    refresh();
    return cache.list.filter(t => t.enabled).map(t => ({ id: t.id, label: t.label, group: t.group }));
  },
};
