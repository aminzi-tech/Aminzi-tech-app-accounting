import { api, showErrors, flash, busy, wirePasswordToggles, loadBusinessTypes, googleConfig, formData } from './common.js';

const $ = (id) => document.getElementById(id);

const ERRORS = {
  google_not_configured: 'Google sign-in isn’t set up on this server yet. Use email or phone.',
  google_cancelled: 'Google sign-in was cancelled.',
  google_state: 'That Google sign-in link expired. Try again.',
  google_token: 'Google didn’t accept the sign-in. Try again.',
  google_nonce: 'That Google sign-in couldn’t be verified. Try again.',
  google_unverified_email: 'Your Google account’s email isn’t verified, so we can’t use it.',
  google_failed: 'Google sign-in failed. Try again, or use email or phone.',
};

// ---------- view switching ----------
function show(view) {
  const signup = view === 'signup';
  $('view-signup').hidden = !signup;
  $('view-login').hidden = signup;
  $('to-signup').toggleAttribute('aria-current', signup);
  $('to-login').toggleAttribute('aria-current', !signup);
  if (signup) $('to-signup').setAttribute('aria-current', 'page'); else $('to-login').setAttribute('aria-current', 'page');
  $('board-caption').textContent = signup ? 'Your workspace will open with this name.' : 'Your business, ready the moment you sign up.';
  document.title = signup ? 'AminZi Workspace — create account' : 'AminZi Workspace — sign in';
  flash('');
}
window.addEventListener('hashchange', () => show(location.hash === '#signup' ? 'signup' : 'login'));

// ---------- live signboard ----------
let types = [];
function updateBoard() {
  const name = $('su-name').value.trim();
  const board = $('board-name');
  board.textContent = name || 'Your business name';
  board.classList.toggle('placeholder', !name);
  board.classList.toggle('long', name.length > 22);
  const t = types.find((x) => x.id === $('su-type').value);
  $('board-type').textContent = t ? t.label : '';
  $('board-address').hidden = !t;
  if (t) $('board-template').textContent = `the ${t.group.toLowerCase()} template`;
}

// ---------- login tabs ----------
function selectTab(which) {
  const email = which === 'email';
  $('tab-email').setAttribute('aria-selected', String(email));
  $('tab-phone').setAttribute('aria-selected', String(!email));
  $('tab-email').tabIndex = email ? 0 : -1;
  $('tab-phone').tabIndex = email ? -1 : 0;
  $('login-email').hidden = !email;
  $('login-phone').hidden = email;
}

const goNext = (fallback) => {
  const next = new URLSearchParams(location.search).get('next');
  // Only same-site relative paths — never an open redirect.
  location.assign(next && /^\/(?!\/)[\w\-/.]*$/.test(next) ? next : fallback);
};

// ---------- email login ----------
$('login-email').addEventListener('submit', async (e) => {
  e.preventDefault();
  flash('');
  const form = e.currentTarget;
  busy(form, true, 'Signing in…');
  const { ok, data } = await api('/api/login/email', formData(form));
  busy(form, false);
  if (ok) return goNext(data.redirect);
  if (data.error && data.error.fields) showErrors('le', data.error.fields);
  else { showErrors('le', {}); flash(data.error ? data.error.message : 'Sign-in failed.'); }
});

// ---------- phone login ----------
let phoneStage = 'phone';
async function sendPhoneCode() {
  const { ok, data } = await api('/api/login/phone/start', { phone: $('lp-phone').value });
  if (!ok) {
    if (data.error && data.error.fields) showErrors('lp', data.error.fields);
    else flash(data.error ? data.error.message : 'Could not send the code.');
    return false;
  }
  $('lp-sent').textContent = `If ${data.sentTo} has an account, a code is on its way. It expires in 10 minutes.`;
  return true;
}
$('login-phone').addEventListener('submit', async (e) => {
  e.preventDefault();
  flash('');
  const form = e.currentTarget;
  if (phoneStage === 'phone') {
    busy(form, true, 'Sending…');
    const sent = await sendPhoneCode();
    busy(form, false);
    if (!sent) return;
    phoneStage = 'code';
    $('lp-phone-field').hidden = true;
    $('lp-code-field').hidden = false;
    $('lp-after').hidden = false;
    $('lp-submit').textContent = 'Sign in';
    cooldown($('lp-resend'), 'Send a new code');
    $('lp-code').focus();
    return;
  }
  busy(form, true, 'Checking…');
  const { ok, data } = await api('/api/login/phone/verify', { phone: $('lp-phone').value, code: $('lp-code').value });
  busy(form, false);
  if (ok) return goNext(data.redirect);
  if (data.error && data.error.fields) showErrors('lp', data.error.fields); else flash(data.error ? data.error.message : 'Sign-in failed.');
});
$('lp-resend').addEventListener('click', async (e) => { flash(''); if (await sendPhoneCode()) { flash('If the last code was over a minute ago, a new one is on its way.', 'info'); cooldown(e.currentTarget, 'Send a new code'); } });
$('lp-change').addEventListener('click', () => {
  phoneStage = 'phone';
  $('lp-phone-field').hidden = false;
  $('lp-code-field').hidden = true;
  $('lp-after').hidden = true;
  $('lp-submit').textContent = 'Text me a code';
  $('lp-phone').focus();
});

// ---------- sign up ----------
let pending = null;
$('signup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  flash('');
  const form = e.currentTarget;
  busy(form, true, 'Creating…');
  const body = formData(form);
  const { ok, data } = await api('/api/signup', body);
  busy(form, false);
  if (!ok) {
    if (data.error && data.error.fields) showErrors('su', data.error.fields);
    else flash(data.error ? data.error.message : 'Sign-up failed.');
    return;
  }
  showErrors('su', {});
  pending = { id: data.pendingId, channel: data.channel };
  $('vf-sent').textContent = data.channel === 'email'
    ? `We emailed a code to ${data.sentTo}. It expires in 10 minutes.`
    : `We texted a code to ${data.sentTo}. It expires in 10 minutes.`;
  form.hidden = true;
  $('verify-form').hidden = false;
  $('vf-code').value = '';
  cooldown($('vf-resend'), 'Send a new code');
  $('vf-code').focus();
});

$('verify-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  flash('');
  const form = e.currentTarget;
  busy(form, true, 'Checking…');
  const { ok, data } = await api('/api/signup/verify', { pendingId: pending.id, code: $('vf-code').value });
  if (ok) { busy(form, true, 'Opening your workspace…'); return location.assign(data.redirect); }
  busy(form, false);
  if (data.error && data.error.fields) showErrors('vf', data.error.fields); else flash(data.error ? data.error.message : 'Verification failed.');
});

let tick = null;
function cooldown(btn, label) {
  clearInterval(tick);
  btn.disabled = true;
  let s = 60;
  btn.textContent = `${label} (${s}s)`;
  tick = setInterval(() => {
    s -= 1;
    btn.textContent = s > 0 ? `${label} (${s}s)` : label;
    if (s <= 0) { clearInterval(tick); btn.disabled = false; }
  }, 1000);
}
$('vf-resend').addEventListener('click', async (e) => {
  flash('');
  const { ok, data } = await api('/api/signup/resend', { pendingId: pending.id, channel: pending.channel });
  if (!ok) return flash(data.error ? data.error.message : 'Could not send a new code.');
  flash('A new code is on its way.', 'info');
  cooldown(e.currentTarget, 'Send a new code');
});
$('vf-back').addEventListener('click', () => {
  $('verify-form').hidden = true;
  $('signup-form').hidden = false;
  $('su-name').focus();
});

// ---------- boot ----------
wirePasswordToggles();
$('tab-email').addEventListener('click', () => selectTab('email'));
$('tab-phone').addEventListener('click', () => selectTab('phone'));
document.querySelector('[role="tablist"]').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    const toPhone = $('tab-email').getAttribute('aria-selected') === 'true';
    selectTab(toPhone ? 'phone' : 'email');
    (toPhone ? $('tab-phone') : $('tab-email')).focus();
  }
});
$('su-name').addEventListener('input', updateBoard);
$('su-type').addEventListener('change', updateBoard);
document.querySelectorAll('input[name="code"]').forEach((i) => i.addEventListener('input', () => { i.value = i.value.replace(/\D/g, '').slice(0, 6); }));

show(location.hash === '#signup' ? 'signup' : 'login');
const err = new URLSearchParams(location.search).get('error');
if (err && ERRORS[err]) flash(ERRORS[err]);
googleConfig();
loadBusinessTypes($('su-type')).then((t) => { types = t; updateBoard(); });
