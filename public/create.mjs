import { buildCustomGame, TEMPLATE_CSV, LIMITS } from './custom.mjs';
import { TIERS } from './rules.mjs';

const $ = id => document.getElementById(id);
const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let current = null;

function report(result) {
  const parts = [];
  if (result.errors.length) parts.push(`<p><strong>${result.errors.length} problem${result.errors.length === 1 ? '' : 's'} to fix:</strong></p><ul class="errors">${result.errors.slice(0, 30).map(e => `<li>${esc(e)}</li>`).join('')}${result.errors.length > 30 ? `<li>…and ${result.errors.length - 30} more</li>` : ''}</ul>`);
  if (result.warnings?.length) parts.push(`<ul class="warnings">${result.warnings.slice(0, 20).map(w => `<li>${esc(w)}</li>`).join('')}</ul>`);
  if (result.game) parts.push(`<p class="ok">✓ ${result.game.prompts.length} prompts, ${result.game.prompts.reduce((n, p) => n + p.answers.length, 0)} answers. Ready to create.</p><ol class="preview-list">${result.game.prompts.map(p => {
    const counts = Object.keys(TIERS).map(t => [t, p.answers.filter(a => a.tier === t).length]).filter(([, n]) => n);
    return `<li><strong>${esc(p.text)}</strong><span class="tier-chips">${counts.map(([t, n]) => `<span style="--chip:${TIERS[t].color}">${TIERS[t].emoji} ${esc(TIERS[t].name)} × ${n}</span>`).join('')}</span></li>`;
  }).join('')}</ol>`);
  $('csv-report').innerHTML = parts.join('');
}
function validate() {
  const text = $('csv-text').value;
  $('created').hidden = true;
  if (!text.trim()) { current = null; $('csv-report').innerHTML = ''; $('create-btn').disabled = true; return; }
  current = buildCustomGame(text, $('title').value);
  report(current);
  $('create-btn').disabled = !current.game;
}
$('csv-file').addEventListener('change', async () => {
  const file = $('csv-file').files[0];
  if (!file) return;
  if (file.size > LIMITS.csvBytes) { $('csv-report').innerHTML = `<ul class="errors"><li>${esc(file.name)} is larger than ${LIMITS.csvBytes / 1000} KB.</li></ul>`; return; }
  $('csv-text').value = await file.text();
  if (!$('title').value) $('title').value = file.name.replace(/\.(csv|tsv|txt)$/i, '').replace(/[-_]+/g, ' ').slice(0, LIMITS.title);
  validate();
});
$('csv-text').addEventListener('input', validate);
$('title').addEventListener('input', () => { if (current) validate(); });
$('load-template').addEventListener('click', () => { $('csv-text').value = TEMPLATE_CSV; if (!$('title').value) $('title').value = 'Example dive'; validate(); });
$('create-form').addEventListener('submit', async e => {
  e.preventDefault();
  validate();
  if (!current?.game) return;
  $('create-btn').disabled = true;
  try {
    const response = await fetch('/api/custom', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: $('title').value, csv: $('csv-text').value }) });
    const body = await response.json();
    if (!response.ok) { report({ errors: body.errors || [body.error || 'Could not create the dive.'], warnings: body.warnings || [] }); return; }
    const link = new URL(body.path, location.origin).href;
    $('share-url').value = link;
    $('play-link').href = body.path;
    $('created').hidden = false;
    $('created').scrollIntoView({ behavior: 'smooth', block: 'center' });
    try { const mine = JSON.parse(localStorage.getItem('ok:custom-created') || '[]'); mine.unshift({ id: body.id, title: body.title, at: Date.now() }); localStorage.setItem('ok:custom-created', JSON.stringify(mine.slice(0, 50))); } catch { /* storage may be unavailable */ }
  } catch { report({ errors: ['The signal is lost. Please retry.'], warnings: [] }); }
  finally { $('create-btn').disabled = !current?.game; }
});
$('copy-link').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('share-url').value); $('copy-link').textContent = 'Copied'; }
  catch { $('share-url').select(); }
  setTimeout(() => { $('copy-link').textContent = 'Copy'; }, 1600);
});
