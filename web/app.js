import { guidedRequest, ckb, ckbToHex, explain } from './guided.js';
import { createWorkerVerifier } from './js/index.js';
const $ = (id) => document.getElementById(id);
const limit = 2 * 1024 * 1024;
let active;
let loading = false;
let guidedBase;
let guidedMode = true;
const lessons = {
  normal: ['submitted-valid', '999', '10000000', 'Try sending 999 CKB. The remaining 1 CKB is the fee in this example.'],
  overspend: ['submitted-valid', '1001', '10000000', 'Can a 1,000 CKB input create a 1,001 CKB output? Run it, then lower the amount to 999 to repair it.'],
  budget: ['submitted-valid', '999', '100', 'The same transfer, but only 100 computation cycles. Run it, then choose the normal budget to try again.'],
  reject: ['script-failure', '999', '10000000', 'The balance is valid, but this toy lock deliberately refuses to unlock the input. Run it to see why scripts matter.'],
};
function customMode() { guidedMode = false; $('guided').dataset.custom = 'true'; $('amount').disabled = true; $('budget').disabled = true; $('lesson').textContent = 'Custom request active. The controls above do not describe this request. Choose an experiment to reset to guided mode.'; document.querySelectorAll('[data-experiment]').forEach(b => b.setAttribute('aria-pressed', 'false')); }
function updateGuided() {
  if (!guidedMode || !guidedBase) return;
  clearOutput(); status('Edited'); $('result').textContent = 'No verification has run for this input.';
  $('explanation').textContent = 'Ready to test your change. Press Run verification.';
  try {
    const request = guidedRequest(guidedBase, $('amount').value, $('budget').value);
    $('request').value = JSON.stringify(request, null, 2);
    const difference = 100000000000n - BigInt(ckbToHex($('amount').value));
    $('balance').textContent = difference >= 0n ? `Input 1,000 CKB → new cell ${ckb(request.transaction.outputs[0].capacity)} CKB · remaining ${ckb(difference)} CKB fee` : `The output asks for ${ckb(-difference)} CKB more than the input provides.`;
    $('summary').textContent = 'Experiment ready. The real engine will check it when you run.';
  } catch (error) { $('balance').textContent = error.message; fail(error); }
}
async function experiment(name) {
  if (active || loading) return;
  const [fixture, amount, budget, lesson] = lessons[name];
  $('sample').value = fixture;
  await loadSample(true);
  if (!guidedBase) return;
  guidedMode = true; $('guided').dataset.custom = 'false'; $('amount').disabled = false; $('budget').disabled = false;
  $('amount').value = amount; $('budget').value = budget;
  updateGuided(); $('lesson').textContent = lesson; status('Ready');
  document.querySelectorAll('[data-experiment]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.experiment === name)));
}
document.querySelectorAll('[data-experiment]').forEach(b => b.addEventListener('click', () => experiment(b.dataset.experiment)));
$('amount').addEventListener('input', updateGuided); $('budget').addEventListener('change', updateGuided);
const size = (text) => new TextEncoder().encode(text).length;
function status(label, kind = '') { $('status').textContent = label; $('status').dataset.kind = kind; }
function clearOutput() { for (const id of ['scope', 'cycles', 'elapsed']) $(id).textContent = '—'; }
function fail(error, stage = 'Input error') {
  status(stage, 'error'); $('summary').textContent = error.message;
  $('explanation').textContent = error.message; $('explanation').dataset.kind = 'error';
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
  for (const control of document.querySelectorAll('[data-experiment], #amount, #budget')) control.disabled = value || (!guidedMode && !control.dataset.experiment);
}
async function loadSample(asGuided = false) {
  if (active || loading) return;
  guidedBase = undefined;
  loading = true; busy(true); clearOutput(); status('Loading sample');
  try {
    const response = await fetch(new URL(`./fixtures/${$('sample').value}.json`, import.meta.url));
    if (!response.ok) throw new Error(`Sample fetch failed (${response.status}).`);
    const fixture = await response.json();
    $('request').value = JSON.stringify(fixture.request, null, 2);
    if (asGuided === true) guidedBase = fixture.request; else customMode();
    $('explanation').textContent = 'No verification has run for this input.';
    $('result').textContent = 'No verification has run for this input.';
    $('summary').textContent = 'Synthetic fixture loaded. Inspect the supplied consensus before running.';
    status('Ready');
  } catch (error) { fail(error, 'Sample error'); }
  finally { loading = false; busy(false); }
}
$('load').addEventListener('click', () => loadSample());
$('upload').addEventListener('change', async (event) => {
  const file = event.target.files[0]; if (!file || active) return;
  clearOutput();
  try {
    if (file.size > limit) throw new Error('File exceeds the 2 MiB limit.');
    const request = readRequest(await file.text());
    customMode(); $('advanced').open = true; $('explanation').textContent = 'Imported data has not been verified.';
    $('request').value = JSON.stringify(request, null, 2);
    status('Ready'); $('summary').textContent = 'Imported locally. Inspect the request before running.';
    $('result').textContent = 'No verification has run for this input.';
  } catch (error) { fail(error); }
  event.target.value = '';
});
$('request').addEventListener('input', () => {
  customMode(); $('explanation').textContent = 'Input changed. The previous result no longer applies.';
  clearOutput(); status('Edited'); $('summary').textContent = 'Input changed. Run to verify this version.';
  $('result').textContent = 'Previous output cleared because the input changed.';
});
$('download').addEventListener('click', () => {
  try {
    const content = JSON.stringify(guidedMode ? guidedRequest(guidedBase, $('amount').value, $('budget').value) : readRequest($('request').value), null, 2);
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
  try { request = guidedMode ? guidedRequest(guidedBase, $('amount').value, $('budget').value) : readRequest($('request').value); } catch (error) { fail(error); return; }
  const started = performance.now();
  const worker = new Worker(new URL('./js/worker.js', import.meta.url), { type: 'module' });
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
    const result = await Promise.race([verifier.verify(request), stopped]);
    $('result').textContent = JSON.stringify(result, null, 2);
    $('scope').textContent = (result.scope ?? (request.script_group ? 'script_group' : 'transaction')) === 'script_group' ? 'Selected script group' : 'Transaction';
    $('cycles').textContent = result.cycles === undefined ? '—' : BigInt(result.cycles).toLocaleString('en-US');
    $('explanation').textContent = explain(result); $('explanation').dataset.kind = result.ok ? '' : 'error';
    status(result.ok ? 'Passed snapshot' : 'Rejected', result.ok ? '' : 'error');
    $('summary').textContent = result.ok
      ? (result.scope === 'script_group' ? 'Selected script group passed. Other groups and full transaction validity are not asserted.' : 'Transaction passed against the supplied snapshot and consensus. Chain state remains unverified.')
      : 'Snapshot rejected. See the explanation below; the exact engine response is in Technical details.';
  } catch (error) { fail(error, error.message === 'Cancelled' ? 'Cancelled' : 'Execution error'); }
  finally {
    clearTimeout(timeout); verifier?.dispose(); worker.terminate();
    $('elapsed').textContent = `${Math.round(performance.now() - started)} ms`;
    active = undefined; busy(false);
  }
});
await experiment('normal');
