import { api, flash } from './common.js';

const $ = (id) => document.getElementById(id);
let pollTimer = null;

function el(tag, attrs = {}, text = '') {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text) n.textContent = text;
  return n;
}

function renderChannel(dd, channel, value, verified) {
  dd.replaceChildren();
  if (!value) { dd.append(el('span', {}, 'Not added')); return; }
  dd.append(el('span', {}, value));
  if (verified) { dd.append(el('span', { class: 'badge badge-ok' }, 'Confirmed')); return; }
  dd.append(el('span', { class: 'badge badge-warn' }, 'Not confirmed'));
  const btn = el('button', { type: 'button', class: 'linklike' }, channel === 'email' ? 'Email me a code' : 'Text me a code');
  dd.append(btn);
  btn.addEventListener('click', async () => {
    flash('');
    const { ok, data } = await api('/api/verify/start', { channel });
    if (!ok) return flash(data.error ? data.error.message : 'Could not send the code.');
    btn.remove();
    const form = el('form', { class: 'inline-verify', novalidate: '' });
    const id = `code-${channel}`;
    const label = el('label', { for: id, class: 'sr-only' }, `Code sent to your ${channel}`);
    const input = el('input', { id, inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6', placeholder: '6-digit code' });
    const submit = el('button', { type: 'submit', class: 'btn btn-primary' }, 'Confirm');
    form.append(label, input, submit);
    dd.append(form);
    input.focus();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const r = await api('/api/verify/confirm', { channel, code: input.value.trim() });
      if (!r.ok) return flash(r.data.error ? r.data.error.message : 'That code didn’t work.');
      flash(`${channel === 'email' ? 'Email' : 'Phone number'} confirmed.`, 'info');
      load();
    });
  });
}

function renderInstance(inst) {
  const state = $('ws-state');
  const open = $('ws-open');
  const retry = $('ws-retry');
  const frame = $('ws-iframe');
  open.hidden = true; retry.hidden = true;

  if (!inst || inst.status === 'provisioning') {
    state.hidden = false;
    state.replaceChildren(el('div', { class: 'spinner', 'aria-hidden': 'true' }), el('strong', {}, 'Setting up your workspace'),
      el('span', {}, 'Copying the template for your business type. This usually takes a few seconds.'));
    clearTimeout(pollTimer);
    pollTimer = setTimeout(load, 1500);
    return;
  }
  if (inst.status === 'failed') {
    state.hidden = false;
    state.replaceChildren(el('strong', {}, 'The workspace couldn’t be created'), el('span', {}, inst.error || 'Unknown error.'));
    retry.hidden = false;
    return;
  }
  // ready
  state.hidden = true;
  open.hidden = false;
  open.href = inst.url;
  $('ws-path').textContent = `${location.origin}${inst.url}`;
  if (frame.getAttribute('src') !== inst.url) frame.src = inst.url;
  frame.hidden = false;
}

async function load() {
  const { ok, status, data } = await api('/api/me');
  if (status === 401) return location.assign('/');
  if (!ok) return flash(data.error ? data.error.message : 'Could not load your account.');
  const u = data.user;
  $('biz-name').textContent = u.businessName;
  $('biz-type').textContent = u.businessTypeLabel;
  $('who').textContent = u.email || u.phone || '';
  document.title = `${u.businessName} — AminZi Workspace`;
  renderChannel($('acct-email'), 'email', u.email, u.emailVerified);
  renderChannel($('acct-phone'), 'phone', u.phone, u.phoneVerified);
  $('acct-google').textContent = u.googleLinked ? 'Connected' : 'Not connected. Signing in with Google using this email connects it.';
  $('acct-sessions').textContent = String(data.sessions);
  renderInstance(data.instance);
}

$('logout').addEventListener('click', async () => { await api('/api/logout', {}); location.assign('/'); });
$('logout-all').addEventListener('click', async () => {
  if (!confirm('Sign out on every device, including this one?')) return;
  await api('/api/logout-all', {});
  location.assign('/');
});
$('ws-retry').addEventListener('click', async () => { await api('/api/instance/retry', {}); load(); });

load();
