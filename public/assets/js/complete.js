import { api, showErrors, flash, busy, loadBusinessTypes, formData } from './common.js';

const $ = (id) => document.getElementById(id);
let types = [];

function updateBoard() {
  const name = $('cp-name').value.trim();
  $('board-name').textContent = name || 'Your business name';
  $('board-name').classList.toggle('placeholder', !name);
  $('board-name').classList.toggle('long', name.length > 22);
  const t = types.find((x) => x.id === $('cp-type').value);
  $('board-type').textContent = t ? t.label : '';
}

async function boot() {
  const pending = await api('/api/google/pending');
  if (!pending.ok) {
    flash(pending.data.error ? pending.data.error.message : 'Start again from the sign-in page.');
    $('cp-form').hidden = true;
    return;
  }
  $('cp-who').textContent = `Signed in with Google as ${pending.data.email}. Add your business details to finish.`;
  types = await loadBusinessTypes($('cp-type'));
}

$('cp-name').addEventListener('input', updateBoard);
$('cp-type').addEventListener('change', updateBoard);
$('cp-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  flash('');
  const form = e.currentTarget;
  busy(form, true, 'Creating…');
  const { ok, data } = await api('/api/google/complete', formData(form));
  if (ok) { busy(form, true, 'Opening your workspace…'); return location.assign(data.redirect); }
  busy(form, false);
  if (data.error && data.error.fields) showErrors('cp', data.error.fields); else flash(data.error ? data.error.message : 'Could not finish sign-up.');
});

boot();
