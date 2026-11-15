import { createWorkbench } from './workbench.js';
import { parseLossless, stringifyLossless } from './lossless-json.js';
import { explain } from './guided.js';
import { createWorkerVerifier } from './js/index.js';
const $ = (id) => document.getElementById(id);
const limit = 2 * 1024 * 1024;
let active;
let loading = false;
let dirty = false;
const size = (text) => new TextEncoder().encode(text).length;
const workbench = createWorkbench($('workbench'), {
  read: () => readRequest($('request').value),
  write(request) { $('request').value = stringifyLossless(request); markEdited(); },
  edited: markEdited,
  capture: () => ({ text: $('request').value, dirty }),
  restore(saved) { $('request').value = saved.text; markEdited(); dirty = saved.dirty; },
});
function markEdited() {
  dirty = true;
  clearOutput(); status('Edited'); $('summary').textContent = 'Input changed. Run to verify this version.';
  $('result').textContent = 'Previous output cleared because the input changed.';
  $('explanation').textContent = 'No verification has run for this input.';
  $('explanation').dataset.kind = '';
}

function status(label, kind = '') { document.querySelector('.output').hidden = ['Ready','Loading sample','Edited'].includes(label);  $('status').textContent = label; $('status').dataset.kind = kind; }
function clearOutput() { for (const id of ['scope', 'cycles', 'elapsed']) $(id).textContent = '—'; }
function fail(error, stage = 'Input error') {
  status(stage, 'error'); $('summary').textContent = error.message;
  $('explanation').textContent = error.message; $('explanation').dataset.kind = 'error';
  $('result').textContent = JSON.stringify({ stage, name: error.name, message: error.message }, null, 2);
}
function readRequest(text) {
  if (size(text) > limit) throw new Error('Input exceeds the 2 MiB limit.');
  const value = parseLossless(text);
  const request = value?.request ?? value;
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('Expected a request object or a fixture containing request.');
  return request;
}
function busy(value) {
  workbench.setBusy(value);
  for (const id of ['run', 'load', 'sample', 'upload', 'request']) $(id).disabled = value;
  $('cancel').disabled = !value || loading;
  $('cancel').hidden = !value || loading;
}
async function loadSample(initial = false) {
  if (active || loading) return;
  if (!initial && dirty && !confirm('Replace your edited transaction with this example? Export JSON first if you want to keep it.')) return;
  loading = true; busy(true); clearOutput(); status('Loading sample');
  try {
    const response = await fetch(new URL(`./fixtures/${$('sample').value}.json`, import.meta.url));
    if (!response.ok) throw new Error(`Sample fetch failed (${response.status}).`);
    const fixture = parseLossless(await response.text());
    $('request').value = stringifyLossless(fixture.request);

    $('explanation').textContent = 'No verification has run for this input.';
    $('result').textContent = 'No verification has run for this input.';
    $('summary').textContent = 'Synthetic fixture loaded. Inspect the supplied consensus before running.';
    dirty = false; status('Ready');
  } catch (error) { fail(error, 'Sample error'); }
  finally { loading = false; workbench.refresh(true); busy(false); }
}
$('load').addEventListener('click', () => loadSample());
$('upload').addEventListener('change', async (event) => {
  const file = event.target.files[0]; if (!file || active) return;
  if (dirty && !confirm('Replace your edited transaction with this file? Export JSON first if you want to keep it.')) { event.target.value = ''; return; }
  clearOutput();
  try {
    if (file.size > limit) throw new Error('File exceeds the 2 MiB limit.');
    const request = readRequest(await file.text());
    $('advanced').open = false; $('explanation').textContent = 'Imported data has not been verified.';
    $('request').value = stringifyLossless(request);
    workbench.refresh(true); dirty = false; status('Ready'); $('summary').textContent = 'Imported locally. Inspect the request before running.';
    $('result').textContent = 'No verification has run for this input.';
  } catch (error) { fail(error); }
  event.target.value = '';
});
$('request').addEventListener('input', () => {
  dirty = true;
  workbench.refresh(true);
  $('explanation').textContent = 'Input changed. The previous result no longer applies.';
  clearOutput(); status('Edited'); $('summary').textContent = 'Input changed. Run to verify this version.';
  $('result').textContent = 'Previous output cleared because the input changed.';
});
$('download').addEventListener('click', () => {
  if (!workbench.valid()) return;
  try {
    const content = stringifyLossless(readRequest($('request').value));
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'ckb-verification-request.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) { clearOutput(); fail(error); }
});
$('cancel').addEventListener('click', () => active?.stop('Cancelled'));
$('run').addEventListener('click', async () => {
  if (active || loading || !workbench.valid()) return;
  clearOutput();
  let request;
  try { request = readRequest($('request').value); } catch (error) { fail(error); return; }
  const requestJson = stringifyLossless(request);
  const started = performance.now();
  const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  let rejectStop;
  const stopped = new Promise((_, reject) => { rejectStop = reject; });
  const run = { stop(message) { worker.terminate(); rejectStop(new Error(message)); } };
  active = run; busy(true); status('Running'); $('summary').textContent = 'Initializing WASM and checking the supplied snapshot…';
  $('result').textContent = 'Running in a dedicated Worker…';
  $('explanation').textContent = 'Checking this version with the real CKB engine…'; $('explanation').dataset.kind = '';
  const timeout = setTimeout(() => run.stop('Timed out after 30 seconds. Worker terminated; reduce the request or cycle budget.'), 30_000);
  let verifier;
  try {
    // Racing init as well as verification lets Cancel terminate a stalled WASM fetch.
    verifier = await Promise.race([createWorkerVerifier({ worker }), stopped]);
    const result = await Promise.race([verifier.verify(requestJson), stopped]);
    $('result').textContent = JSON.stringify(result, null, 2);
    $('scope').textContent = (result.scope ?? (request.script_group ? 'script_group' : 'transaction')) === 'script_group' ? 'Selected script group' : 'Transaction';
    $('cycles').textContent = result.cycles === undefined ? '—' : BigInt(result.cycles).toLocaleString('en-US');
    $('explanation').textContent = explain(result); $('explanation').dataset.kind = result.ok ? '' : 'error';
    status(result.ok ? 'Passed snapshot' : 'Rejected', result.ok ? '' : 'error');
    $('summary').textContent = result.ok
      ? (result.scope === 'script_group' ? 'Selected script group passed. Other groups and full transaction validity are not asserted.' : 'Transaction passed against the supplied snapshot and consensus. Chain state remains unverified.')
      : 'Snapshot rejected. See the explanation below; the exact engine response is in Full engine response.';
  } catch (error) { fail(error, error.message === 'Cancelled' ? 'Cancelled' : 'Execution error'); }
  finally {
    clearTimeout(timeout); verifier?.dispose(); worker.terminate();
    $('elapsed').textContent = `${Math.round(performance.now() - started)} ms`;
    active = undefined; busy(false);
  }
});
fetch(new URL('./version.json', import.meta.url)).then(r => r.ok ? r.json() : null).then(v => { if (/^[0-9a-f]{40}$/.test(v?.commit ?? '')) { const link=$('build-version'); link.textContent=`Build ${v.commit.slice(0, 10)}`; link.href=`https://github.com/Hanssen0-Alter-Ego/ckb-vm-js/commit/${v.commit}`; link.hidden=false; } }).catch(() => {});
await loadSample(true);

