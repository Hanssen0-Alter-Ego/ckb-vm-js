import { createWorkerVerifier } from '../../js/index.js';
const button = document.querySelector('#run');
const output = document.querySelector('#results');
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function normalize(key, value) {
  return canonical(key === 'groups' && Array.isArray(value)
    ? [...value].sort((a, b) => `${a.group_type}:${a.script_hash}`.localeCompare(`${b.group_type}:${b.script_hash}`)) : value);
}
button.addEventListener('click', async () => {
  button.disabled = true;
  output.textContent = `crossOriginIsolated=${crossOriginIsolated}\nSharedArrayBuffer=${typeof SharedArrayBuffer}\n`;
  let verifier;
  try {
    if (crossOriginIsolated || typeof SharedArrayBuffer !== 'undefined') throw new Error('Test requires non-isolated page with SharedArrayBuffer absent');
    const names = ['submitted-valid', 'unconfirmed-input', 'same-block-input', 'valid', 'selected-lock', 'script-failure'];
    const fixtures = await Promise.all(names.map(async name => {
      const response = await fetch(`../../fixtures/${name}.json`);
      if (!response.ok) throw new Error(`Fixture ${name}: HTTP ${response.status}`);
      return { name, ...await response.json() };
    }));
    const response = await fetch('../../pkg/ckb_wasm_verifier_bg.wasm');
    if (!response.ok) throw new Error(`WASM artifact: HTTP ${response.status}`);
    verifier = await createWorkerVerifier({ wasm: await response.arrayBuffer() });
    output.textContent += 'Actual WASM initialized in dedicated Worker.\n';
    for (const { name, request, expected } of fixtures) {
      const result = request.script_group
        ? await verifier.verifyScriptGroup(request, request.script_group)
        : await verifier.verify(request);
      for (const [key, value] of Object.entries(expected)) {
        if (JSON.stringify(normalize(key, result[key])) !== JSON.stringify(normalize(key, value))) throw new Error(`${name}: mismatch ${key}: ${JSON.stringify(result)}`);
      }
      output.textContent += `PASS ${name}: ${JSON.stringify(result)}\n`;
    }
    output.textContent += 'PASS: 6 real Worker fixtures; no SharedArrayBuffer or cross-origin isolation.\n';
    output.textContent += 'This manual page does not disable browser networking; use Playwright for the offline-network assertion.\n';
  } catch (error) {
    output.textContent += `FAIL: ${error.name}: ${error.message}\n`;
  } finally {
    verifier?.dispose();
    button.disabled = false;
  }
});
