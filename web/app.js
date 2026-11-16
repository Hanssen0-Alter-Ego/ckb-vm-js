import { createWorkbench } from './workbench.js';
import { parseLossless, stringifyLossless } from './lossless-json.js';
import { explain, verifiedGroupSummary, requestedScope } from './guided.js';
import { inspectRequest } from './workbench-model.js';
import { createWorkerVerifier } from './js/index.js';
const $ = (id) => document.getElementById(id);
const limit = 2 * 1024 * 1024;
let active;
let loading = false;
let dirty = false;
let unsaved = false;
let loadedSample = null;
let sourceName = 'None';
const exampleMenu=document.querySelector('.example-menu');
const exampleSummary=exampleMenu.querySelector('summary');
document.addEventListener('pointerdown',event=>{if(exampleMenu.open&&!exampleMenu.contains(event.target))exampleMenu.open=false;});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&exampleMenu.open&&!document.querySelector('dialog[open]')){event.preventDefault();exampleMenu.open=false;exampleSummary.focus();}});
function showSource() { $('loaded-source').textContent = `Current request: ${sourceName}${dirty ? ' (edited)' : ''}`; }
const size = (text) => new TextEncoder().encode(text).length;
const workbench = createWorkbench($('workbench'), {
  read: () => readRequest($('request').value),
  write(request) { $('request').value = stringifyLossless(request); markEdited(); },
  edited: markEdited,
  capture: () => ({ text: $('request').value, dirty, unsaved, status: $('status').textContent, statusKind: $('status').dataset.kind, summary: $('summary').textContent, explanation: $('explanation').textContent, explanationKind: $('explanation').dataset.kind, result: $('result').textContent, scope: $('scope').textContent, requestedScope: $('requested-scope').textContent, cycles: $('cycles').textContent, elapsed: $('elapsed').textContent, outputHidden: document.querySelector('.output').hidden, groupTitle: $('group-title').textContent, groupMembers: $('group-members').textContent, groupHidden: $('group-details').hidden, groupOpen: $('group-details').open }),
  restore(saved) { $('request').value = saved.text; dirty = saved.dirty; unsaved = saved.unsaved; status(saved.status, saved.statusKind); $('summary').textContent = saved.summary; $('explanation').textContent = saved.explanation; $('explanation').dataset.kind = saved.explanationKind; $('result').textContent = saved.result; $('requested-scope').textContent = saved.requestedScope; for (const id of ['scope','cycles','elapsed']) $(id).textContent = saved[id]; document.querySelector('.output').hidden = saved.outputHidden; $('group-title').textContent=saved.groupTitle; $('group-members').textContent=saved.groupMembers; $('group-details').hidden=saved.groupHidden; $('group-details').open=saved.groupOpen; try{renderRepairs(JSON.parse(saved.result),readRequest(saved.text));}catch{hideRepairs();} showSource(); },
});
window.addEventListener('beforeunload', event => { if(unsaved||workbench.hasPendingDraft()){event.preventDefault();event.returnValue='';} });
function markEdited() {
  dirty = true; unsaved = true; showSource();
  clearOutput(); status('Edited'); $('summary').textContent = 'Input changed. Run to verify this version.';
  $('result').textContent = 'Previous output cleared because the input changed.';
  $('explanation').textContent = 'No verification has run for this input.';
  $('explanation').dataset.kind = '';
}

function status(label, kind = '') { document.querySelector('.output').hidden = ['Ready','Loading sample','Edited'].includes(label);  $('status').textContent = label; $('status').dataset.kind = kind; }
function hideRepairs(){const area=$('repair-actions');area.hidden=true;area.replaceChildren();}
function renderRepairs(result,request){hideRepairs();if(result?.error?.code!=='InvalidRequest')return;const issues=inspectRequest(request).diagnostics.filter(d=>/^transaction\.(?:outputs_data|witnesses)\[\d+\]$/.test(d.path));const area=$('repair-actions');for(const d of issues){const match=/^transaction\.(outputs_data|witnesses)\[(\d+)\]$/.exec(d.path),index=Number(match[2]);if(match[1]==='outputs_data'&&(!Array.isArray(request?.transaction?.outputs)||!request.transaction.outputs[index]||typeof request.transaction.outputs[index]!=='object'))continue;const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent=match[1]==='outputs_data'?`Edit output index ${index} data`:`Edit witness index ${index}`;button.onclick=()=>workbench.focusDiagnostic(d.path);area.append(button);}if(area.children.length){const hint=document.createElement('p');hint.textContent='Preflight also found possible formatting issues; these may not be the cause of this error.';area.prepend(hint);area.hidden=false;}}
function clearOutput() { hideRepairs(); $('requested-scope').textContent = '—'; for (const id of ['scope', 'cycles', 'elapsed']) $(id).textContent = '—'; $('group-title').textContent=''; $('group-members').textContent=''; $('group-details').hidden=true; $('group-details').open=false; }
function fail(error, stage = 'Input error') {
  hideRepairs(); status(stage, 'error'); $('summary').textContent = error.message;
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
  $('load').disabled = value || !$('sample').value;
  $('cancel').disabled = !value || loading;
  $('cancel').hidden = !value || loading;
}
async function loadSample(initial = false) {
  if (active || loading) return;
  if (!initial && dirty && !confirm('Replace your edited transaction with this example? Export JSON first if you want to keep it.')) { $('sample').value = loadedSample ?? ''; $('load').disabled = !$('sample').value; return; }
  loading = true; busy(true); clearOutput(); status('Loading sample');
  try {
    const response = await fetch(new URL(`./fixtures/${$('sample').value}.json`, import.meta.url));
    if (!response.ok) throw new Error(`Sample fetch failed (${response.status}).`);
    const fixture = parseLossless(await response.text());
    $('request').value = stringifyLossless(fixture.request);

    $('explanation').textContent = 'No verification has run for this input.';
    $('result').textContent = 'No verification has run for this input.';
    $('summary').textContent = 'Synthetic fixture loaded. Inspect the supplied consensus before running.';
    loadedSample = $('sample').value; sourceName = $('sample').selectedOptions[0]?.textContent ?? 'Example'; dirty = false; unsaved = false; showSource(); status('Ready');if(!initial)exampleMenu.open=false;
  } catch (error) { $('sample').value = loadedSample ?? ''; fail(error, 'Sample error'); }
  finally { loading = false; workbench.refresh(true); busy(false); }
}
$('load').addEventListener('click', () => loadSample());
$('sample').addEventListener('change', () => { $('load').disabled = !$('sample').value; });
$('upload').addEventListener('change', async (event) => {
  const file = event.target.files[0]; if (!file || active) return;
  if (dirty && !confirm('Replace your edited transaction with this file? Export JSON first if you want to keep it.')) { event.target.value = ''; return; }
  clearOutput();
  try {
    if (file.size > limit) throw new Error('File exceeds the 2 MiB limit.');
    const request = readRequest(await file.text());
    $('advanced').open = false; $('explanation').textContent = 'Imported data has not been verified.';
    $('request').value = stringifyLossless(request);
    workbench.refresh(true); dirty = false; unsaved = false; loadedSample = null; sourceName = 'Imported JSON'; $('sample').value = ''; $('load').disabled = true; showSource(); status('Ready'); $('summary').textContent = 'Imported locally. Inspect the request before running.';
    $('result').textContent = 'No verification has run for this input.';
  } catch (error) { fail(error); }
  event.target.value = '';
});
$('request').addEventListener('input', () => {
  dirty = true; unsaved = true; showSource();
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
    const link = document.createElement('a'); link.href = url; link.download = 'ckb-verification-request.json'; link.click(); unsaved = false;
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
  $('requested-scope').textContent = requestedScope(request);
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
    $('scope').textContent = !result.ok ? 'Not reported' : result.scope === 'script_group' ? 'Selected script group' : result.scope === 'transaction' ? 'Transaction' : 'Not reported';
    const groups=verifiedGroupSummary(result,request);if(groups){$('group-title').textContent=groups.title;$('group-members').textContent=groups.text;$('group-details').hidden=false;$('group-details').open=groups.selected;}
    $('cycles').textContent = result.cycles === undefined ? '—' : BigInt(result.cycles).toLocaleString('en-US');
    $('explanation').textContent = explain(result, request); $('explanation').dataset.kind = result.ok ? '' : 'error';
    renderRepairs(result,request);
    status(result.ok ? 'Passed snapshot' : 'Rejected', result.ok ? '' : 'error');
    $('summary').textContent = result.ok
      ? (result.scope === 'script_group' ? 'Selected script group passed.' : result.scope === 'transaction' ? 'Transaction passed for the supplied snapshot.' : 'Verification passed; scope is unavailable.')
      : result.error?.code==='InvalidRequest' ? 'Invalid request. The verifier did not run scripts.' : 'Snapshot rejected. See the explanation below; the exact engine response is in Full engine response.';
  } catch (error) { fail(error, error.message === 'Cancelled' ? 'Cancelled' : 'Execution error'); }
  finally {
    clearTimeout(timeout); verifier?.dispose(); worker.terminate();
    $('elapsed').textContent = `${Math.round(performance.now() - started)} ms`;
    active = undefined; busy(false);
  }
});
fetch(new URL('./version.json', import.meta.url)).then(r => r.ok ? r.json() : null).then(v => { if (/^[0-9a-f]{40}$/.test(v?.commit ?? '')) { const link=$('build-version'); link.textContent=`Build ${v.commit.slice(0, 10)}`; link.href=`https://github.com/Hanssen0-Alter-Ego/ckb-vm-js/commit/${v.commit}`; link.hidden=false; } }).catch(() => {});
await loadSample(true);

