'use strict';
/**
 * End-to-end tests of the real HTTP app (in-process, temp DB + temp instances dir).
 * Run: npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aminzi-test-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.INSTANCES_DIR = path.join(tmp, 'instances');
process.env.APP_ORIGIN = 'http://127.0.0.1:0'; // patched after listen
process.env.NODE_ENV = 'test';

const config = require('../server/config');
const { createApp } = require('../server/app');
const { outbox } = require('../server/notify');

let server; let base; let ctx;

test.before(async () => {
  ctx = createApp({ dbFile: path.join(tmp, 'test.db') });
  await new Promise(r => { server = ctx.app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
  config.appOrigin = base;
});
test.after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

function client() {
  let cookie = '';
  return async function call(method, url, body, extraHeaders = {}) {
    const res = await fetch(base + url, {
      method, redirect: 'manual',
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Origin: base, ...(cookie ? { Cookie: cookie } : {}), ...extraHeaders },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.getSetCookie();
    for (const sc of set) {
      const [pair] = sc.split(';');
      if (pair.endsWith('=')) cookie = ''; else cookie = pair;
    }
    const type = res.headers.get('content-type') || '';
    return { status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() : await res.text() };
  };
}
const lastCode = () => outbox[outbox.length - 1].text.match(/\b(\d{6})\b/)[1];
const waitReady = async (call) => {
  for (let i = 0; i < 50; i++) {
    const me = await call('GET', '/api/me');
    if (me.body.instance && me.body.instance.status !== 'provisioning') return me;
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error('instance never left provisioning');
};

const signupBody = (over = {}) => ({ businessName: 'Bamyan Bakery', email: 'owner@bamyan.af', phone: '0701234567', businessType: 'bakery', password: 'saffron-cake-2026', verifyBy: 'email', ...over });

test('business types list is public and hides sources', async () => {
  const call = client();
  const r = await call('GET', '/api/business-types');
  assert.equal(r.status, 200);
  assert.ok(r.body.types.length > 30);
  assert.ok(r.body.types.every(t => t.id && t.label && t.group && !('source' in t)));
});

test('email sign-up → code → session → instance copied from the right template', async () => {
  const call = client();
  const s = await call('POST', '/api/signup', signupBody());
  assert.equal(s.status, 202);
  assert.equal(s.body.channel, 'email');
  assert.match(s.body.sentTo, /^ow/);

  const bad = await call('POST', '/api/signup/verify', { pendingId: s.body.pendingId, code: '000000' === lastCode() ? '111111' : '000000' });
  assert.equal(bad.status, 400);

  const v = await call('POST', '/api/signup/verify', { pendingId: s.body.pendingId, code: lastCode() });
  assert.equal(v.status, 200);
  const me = await waitReady(call);
  assert.equal(me.body.user.businessName, 'Bamyan Bakery');
  assert.equal(me.body.user.phone, '+93701234567');   // normalised to E.164
  assert.equal(me.body.user.emailVerified, true);
  assert.equal(me.body.instance.status, 'ready');

  const page = await call('GET', me.body.instance.url);
  assert.equal(page.status, 200);
  assert.match(page.body, /<h1>Bamyan Bakery<\/h1>/);   // rendered into the food template
  assert.match(page.body, /Bakery &amp; sweets/);       // HTML-escaped type label
  const json = await call('GET', `${me.body.instance.url}instance.json`);
  assert.equal(json.status, 404);
});

test('PII is encrypted at rest', () => {
  const rows = ctx.database.prepare('SELECT * FROM users').all();
  const dump = JSON.stringify(rows);
  assert.ok(!dump.includes('owner@bamyan.af'));
  assert.ok(!dump.includes('701234567'));
  assert.ok(!dump.includes('Bamyan Bakery'));
  assert.ok(rows[0].email_enc.startsWith('v1.'));
});

test('another user cannot open someone else\'s instance', async () => {
  const owner = client();
  await owner('POST', '/api/login/email', { email: 'owner@bamyan.af', password: 'saffron-cake-2026' });
  const { body } = await owner('GET', '/api/me');

  const other = client();
  const s = await other('POST', '/api/signup', signupBody({ businessName: 'Herat Tailors', email: 'x@herat.af', phone: '+93799000111', businessType: 'tailor', verifyBy: 'phone' }));
  assert.equal(outbox[outbox.length - 1].channel, 'phone');
  await other('POST', '/api/signup/verify', { pendingId: s.body.pendingId, code: lastCode() });
  const otherMe = await waitReady(other);
  assert.equal(otherMe.body.user.phoneVerified, true);
  assert.match((await other('GET', otherMe.body.instance.url)).body, /Herat Tailors/);

  const peek = await other('GET', body.instance.url);
  assert.equal(peek.status, 404);
  const anon = await client()('GET', body.instance.url);
  assert.equal(anon.status, 302);
});

test('duplicate sign-up does not reveal the account exists', async () => {
  const call = client();
  const s = await call('POST', '/api/signup', signupBody({ phone: '+93700000999' }));
  assert.equal(s.status, 202);
  assert.ok(s.body.pendingId);
  assert.match(outbox[outbox.length - 1].subject, /already|tried/i); // owner is notified instead
  const v = await call('POST', '/api/signup/verify', { pendingId: s.body.pendingId, code: '123456' });
  assert.equal(v.status, 400);
});

test('email login: wrong password is generic, right one works', async () => {
  const call = client();
  const wrong = await call('POST', '/api/login/email', { email: 'owner@bamyan.af', password: 'nope-nope-nope' });
  assert.equal(wrong.status, 401);
  const ghost = await call('POST', '/api/login/email', { email: 'ghost@nowhere.af', password: 'nope-nope-nope' });
  assert.deepEqual(ghost.body, wrong.body);
  const ok = await call('POST', '/api/login/email', { email: 'OWNER@bamyan.af ', password: 'saffron-cake-2026' });
  assert.equal(ok.status, 200);
  const cookie = ok.headers.getSetCookie()[0];
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
});

test('phone login with SMS code', async () => {
  const call = client();
  const unknown = await call('POST', '/api/login/phone/start', { phone: '+93711111111' });
  assert.equal(unknown.status, 200); // same answer for unknown numbers
  const start = await call('POST', '/api/login/phone/start', { phone: '+93 799 000 111' });
  assert.equal(start.status, 200);
  const v = await call('POST', '/api/login/phone/verify', { phone: '+93799000111', code: lastCode() });
  assert.equal(v.status, 200);
  const me = await call('GET', '/api/me');
  assert.equal(me.body.user.businessName, 'Herat Tailors');
});

test('OTP attempts are capped', async () => {
  const call = client();
  await new Promise(r => setTimeout(r, 10));
  const s = await call('POST', '/api/signup', signupBody({ email: 'cap@test.af', phone: '+93788888888' }));
  const real = lastCode();
  for (let i = 0; i < 5; i++) await call('POST', '/api/signup/verify', { pendingId: s.body.pendingId, code: real === '999999' ? '888888' : '999999' });
  const late = await call('POST', '/api/signup/verify', { pendingId: s.body.pendingId, code: real });
  assert.equal(late.status, 400, 'correct code must be refused after max attempts');
});

test('validation: bad business type, weak password, bad phone', async () => {
  const call = client();
  const r = await call('POST', '/api/signup', signupBody({ email: 'v@test.af', businessType: 'casino', password: 'password1', phone: '12' }));
  assert.equal(r.status, 400);
  assert.ok(r.body.error.fields.businessType);
  assert.ok(r.body.error.fields.password);
  assert.ok(r.body.error.fields.phone);
  const html = await call('POST', '/api/signup', signupBody({ email: 'h@test.af', businessName: '<script>x</script>' }));
  assert.ok(html.body.error.fields.businessName);
});

test('CSRF: cross-origin and non-JSON writes are refused', async () => {
  const evil = await fetch(`${base}/api/login/email`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{}' });
  assert.equal(evil.status, 403);
  const form = await fetch(`${base}/api/login/email`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: base }, body: 'email=a' });
  assert.equal(form.status, 415);
});

test('security headers are present', async () => {
  const r = await fetch(base + '/');
  const csp = r.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-powered-by'), null);
});

test('logout-all kills every session', async () => {
  const a = client(); const b = client();
  await a('POST', '/api/login/email', { email: 'owner@bamyan.af', password: 'saffron-cake-2026' });
  await b('POST', '/api/login/email', { email: 'owner@bamyan.af', password: 'saffron-cake-2026' });
  assert.equal((await b('GET', '/api/me')).status, 200);
  await a('POST', '/api/logout-all', {});
  assert.equal((await b('GET', '/api/me')).status, 401);
});

test('Google button degrades cleanly when not configured', async () => {
  const r = await fetch(`${base}/auth/google/start`, { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.match(r.headers.get('location'), /google_not_configured/);
});

test('path traversal out of an instance folder is refused', async () => {
  const call = client();
  await call('POST', '/api/login/email', { email: 'owner@bamyan.af', password: 'saffron-cake-2026' });
  const { body } = await call('GET', '/api/me');
  // logout-all above killed earlier sessions; this is a fresh login, so the instance is reachable
  for (const p of ['../../data/test.db', '..%2f..%2fdata%2ftest.db', '%2e%2e/%2e%2e/package.json', '.env', 'instance.json']) {
    const r = await call('GET', `${body.instance.url}${p}`);
    assert.notEqual(r.status, 200, p);
  }
});

test('security regressions: CSRF on Google route, instance CSP, no 429 tell on phone login', async () => {
  const evil = await fetch(`${base}/api/google/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{}' });
  assert.equal(evil.status, 403);

  const call = client();
  await call('POST', '/api/login/email', { email: 'owner@bamyan.af', password: 'saffron-cake-2026' });
  const { body } = await call('GET', '/api/me');
  const page = await call('GET', body.instance.url);
  const csp = page.headers.get('content-security-policy');
  assert.match(csp, /script-src 'none'/);
  assert.match(csp, /connect-src 'none'/);
  assert.match(csp, /form-action 'none'/);
  assert.notEqual((await call('GET', `${body.instance.url}%69nstance.json`)).status, 200);

  // Known number asked twice in a row (cooldown) must answer exactly like an unknown number.
  const a = await call('POST', '/api/login/phone/start', { phone: '+93799000111' });
  const b = await call('POST', '/api/login/phone/start', { phone: '+93799000111' });
  const u = await call('POST', '/api/login/phone/start', { phone: '+93711122233' });
  assert.deepEqual([a.status, b.status, u.status], [200, 200, 200]);
  assert.deepEqual(Object.keys(b.body).sort(), Object.keys(u.body).sort());
});

test('Google email squatting: an unproven email is released, a confirmed one is not', () => {
  const { store } = ctx;
  const squatter = store.users.create({ status: 'active', businessName: 'Squat', businessType: 'other', email: 'victim@gmail.com', phone: '+93700300300', phoneVerified: true });
  store.users.releaseEmail(squatter);
  assert.equal(store.users.byEmail('victim@gmail.com'), undefined);
  const real = store.users.byEmail('owner@bamyan.af');
  store.users.releaseEmail(real.id); // verified → must be a no-op
  assert.ok(store.users.byEmail('owner@bamyan.af'));
});
