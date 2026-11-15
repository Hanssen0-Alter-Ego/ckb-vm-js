import { createWorkerVerifier } from './js/index.js';
const $ = (id) => document.getElementById(id);
const limit = 2 * 1024 * 1024;
let active;
let loading = false;
const size = (text) => new TextEncoder().encode(text).length;
function status(label, kind = '') { $('status').textContent = label; $('status').dataset.kind = kind; }
function clearOutput() { for (const id of ['scope', 'cycles', 'elapsed']) $(id).textContent = '—'; }
function fail(error, stage = 'Input error') {
  status(stage, 'error'); $('summary').textContent = error.message;
  $('result').textContent = JSON.stringify({ stage, name: error.name, message: error.message }, null, 2);
}
function readRequest(text) {
  if (size(text) > limit) throw new Error('Input exceeds the 2 MiB limit.');
  const value = JSON.parse(text);
  const request = value?.request ?? value;
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('Expected a request object or a fixture containing request.');
  return request;
}
function busy(value) {
  for (const id of ['run', 'load', 'sample', 'upload', 'request']) $(id).disabled = value;
  $('cancel').disabled = !value || loading;
}
async function loadSample() {
  if (active || loading) return;
  loading = true; busy(true); clearOutput(); status('Loading sample');
  try {
    const response = await fetch(new URL(`./fixtures/${$('sample').value}.json`, import.meta.url));
    if (!response.ok) throw new Error(`Sample fetch failed (${response.status}).`);
    const fixture = await response.json();
    $('request').value = JSON.stringify(fixture.request, null, 2);
    $('result').textContent = 'No verification has run for this input.';
    $('summary').textContent = 'Synthetic fixture loaded. Inspect the supplied consensus before running.';
    status('Ready');
  } catch (error) { fail(error, 'Sample error'); }
  finally { loading = false; busy(false); }
}
$('load').addEventListener('click', loadSample);
$('upload').addEventListener('change', async (event) => {
  const file = event.target.files[0]; if (!file || active) return;
  clearOutput();
  try {
    if (file.size > limit) throw new Error('File exceeds the 2 MiB limit.');
    const request = readRequest(await file.text());
    $('request').value = JSON.stringify(request, null, 2);
    status('Ready'); $('summary').textContent = 'Imported locally. Inspect the request before running.';
    $('result').textContent = 'No verification has run for this input.';
  } catch (error) { fail(error); }
  event.target.value = '';
});
$('request').addEventListener('input', () => {
  clearOutput(); status('Edited'); $('summary').textContent = 'Input changed. Run to verify this version.';
  $('result').textContent = 'Previous output cleared because the input changed.';
});
$('download').addEventListener('click', () => {
  try {
    const content = JSON.stringify(readRequest($('request').value), null, 2);
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'ckb-verification-request.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) { clearOutput(); fail(error); }
});
$('cancel').addEventListener('click', () => active?.stop('Cancelled'));
$('run').addEventListener('click', async () => {
  if (active || loading) return;
  clearOutput();
  let request;
  try { request = readRequest($('request').value); } catch (error) { fail(error); return; }
  const started = performance.now();
  const worker = new Worker(new URL('./js/worker.js', import.meta.url), { type: 'module' });
  let rejectStop;
  const stopped = new Promise((_, reject) => { rejectStop = reject; });
  const run = { stop(message) { worker.terminate(); rejectStop(new Error(message)); } };
  active = run; busy(true); status('Running'); $('summary').textContent = 'Initializing WASM and checking the supplied snapshot…';
  $('result').textContent = 'Running in a dedicated Worker…';
  const timeout = setTimeout(() => run.stop('Timed out after 30 seconds. Worker terminated; reduce the request or cycle budget.'), 30_000);
  let verifier;
  try {
    // Racing init as well as verification lets Cancel terminate a stalled WASM fetch.
    verifier = await Promise.race([createWorkerVerifier({ worker }), stopped]);
    const result = await Promise.race([verifier.verify(request), stopped]);
    $('result').textContent = JSON.stringify(result, null, 2);
    $('scope').textContent = result.scope ?? (request.script_group ? 'script_group' : 'transaction');
    $('cycles').textContent = result.cycles ?? '—';
    status(result.ok ? 'Passed snapshot' : 'Rejected', result.ok ? '' : 'error');
    $('summary').textContent = result.ok
      ? (result.scope === 'script_group' ? 'Selected script group passed. Other groups and full transaction validity are not asserted.' : 'Transaction passed against the supplied snapshot and consensus. Chain state remains unverified.')
      : `${result.error.code}: ${result.error.message}`;
  } catch (error) { fail(error, error.message === 'Cancelled' ? 'Cancelled' : 'Execution error'); }
  finally {
    clearTimeout(timeout); verifier?.dispose(); worker.terminate();
    $('elapsed').textContent = `${Math.round(performance.now() - started)} ms`;
    active = undefined; busy(false);
  }
});
await loadSample();
