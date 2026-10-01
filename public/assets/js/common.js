// Shared helpers. No framework, no inline handlers — CSP allows only same-origin scripts.

export async function api(path, body, method = body ? 'POST' : 'GET') {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    return { ok: false, status: 0, data: { error: { message: 'No connection. Check your internet and try again.' } } };
  }
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  return { ok: res.ok, status: res.status, data };
}

/** Show field errors next to inputs; returns true if any were shown. */
export function showErrors(prefix, fields = {}) {
  let first = null;
  document.querySelectorAll(`[id^="${prefix}-"][id$="-err"]`).forEach((el) => {
    const key = el.id.slice(prefix.length + 1, -4);
    const msg = fields[key] || '';
    el.textContent = msg;
    const target = findInput(prefix, key);
    if (target) {
      target.setAttribute('aria-invalid', msg ? 'true' : 'false');
      if (msg) {
        const ids = new Set((target.getAttribute('aria-describedby') || '').split(' ').filter(Boolean));
        ids.add(el.id);
        target.setAttribute('aria-describedby', [...ids].join(' '));
        first = first || target;
      }
    }
  });
  if (first) first.focus();
  return !!first;
}

function findInput(prefix, key) {
  const err = document.getElementById(`${prefix}-${key}-err`);
  const field = err && err.closest('.field');
  return field ? field.querySelector('input, select') : null;
}

export function flash(message, kind = 'error') {
  const el = document.getElementById('flash');
  if (!el) return;
  if (!message) { el.hidden = true; el.textContent = ''; return; }
  el.className = `alert alert-${kind}`;
  el.textContent = message;
  el.hidden = false;
}

export function busy(form, on, label) {
  const btn = form.querySelector('button[type="submit"]');
  if (!btn) return;
  if (on) { btn.dataset.label = btn.textContent; btn.textContent = label || 'Working…'; btn.disabled = true; }
  else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
}

export function wirePasswordToggles(root = document) {
  root.querySelectorAll('[data-toggle-pw]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.togglePw);
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? 'Hide' : 'Show';
      btn.setAttribute('aria-pressed', String(show));
    });
  });
}

export async function loadBusinessTypes(select) {
  const { ok, data } = await api('/api/business-types');
  if (!ok) return [];
  const groups = new Map();
  for (const t of data.types) {
    if (!groups.has(t.group)) groups.set(t.group, []);
    groups.get(t.group).push(t);
  }
  for (const [group, types] of groups) {
    const og = document.createElement('optgroup');
    og.label = group;
    for (const t of types) {
      const o = document.createElement('option');
      o.value = t.id;
      o.textContent = t.label;   // textContent, never innerHTML
      og.append(o);
    }
    select.append(og);
  }
  return data.types;
}

export async function googleConfig() {
  const { data } = await api('/api/config');
  if (!data.googleEnabled) {
    document.querySelectorAll('.btn-google').forEach((a) => {
      a.setAttribute('aria-disabled', 'true');
      a.removeAttribute('href');
      a.tabIndex = -1;
    });
    document.querySelectorAll('[data-google-off]').forEach((p) => { p.hidden = false; });
  }
}

export function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}
