import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const cases = await Promise.all(['submitted-valid', 'unconfirmed-input', 'same-block-input', 'valid', 'selected-lock', 'script-failure'].map(async (name) => ({
  name,
  ...JSON.parse(await readFile(new URL(`../../fixtures/${name}.json`, import.meta.url), 'utf8')),
})));
function normalize(key, value) {
  return key === 'groups' && Array.isArray(value)
    ? [...value].sort((a, b) => `${a.group_type}:${a.script_hash}`.localeCompare(`${b.group_type}:${b.script_hash}`))
    : value;
}

test('real dedicated Worker verifies offline without isolation or SharedArrayBuffer', async ({ page, context }) => {
  await page.goto('/');
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(false);
  expect(await page.evaluate(() => typeof SharedArrayBuffer)).toBe('undefined');
  await page.evaluate(async () => {
    const { createWorkerVerifier } = await import('/js/index.js');
    const wasm = await (await fetch('/pkg/ckb_wasm_verifier_bg.wasm')).arrayBuffer();
    window.verifier = await createWorkerVerifier({ wasm });
  });
  // Initialization completed online against localhost. All verification below
  // runs with browser networking disabled and no data fetched by the engine.
  await context.setOffline(true);
  try {
    for (const fixture of cases) {
      const result = await page.evaluate(async ({ request }) => {
        if (request.script_group) {
          const { script_group, ...rest } = request;
          return window.verifier.verifyScriptGroup(rest, script_group);
        }
        return window.verifier.verify(request);
      }, fixture);
      for (const [key, expected] of Object.entries(fixture.expected)) {
        expect(normalize(key, result[key]), `${fixture.name}: ${key}`).toEqual(normalize(key, expected));
      }
    }
  } finally {
    await page.evaluate(() => window.verifier.dispose());
  }
});


test('real Worker accepts matching RPC hashes and rejects mismatches', async ({page}) => {
 await page.goto('/');const request=structuredClone(cases.find(f=>f.name==='selected-lock').request);request.transaction.hash='0x0ddc389e29dacea4405331a65ea4c9ee2d731984e598baff039bdf3f1da3d576';request.context.tip_header.hash='0x431643f20c2ddc95980bb2797c2a020d78cc05c849b70ab1a041c7e2768ec106';request.context.verification.candidate_header.hash='0x411e38f46d127390be4606bf4fec8c2db53321a8b3bdafd7b3428ebdb2bd5e64';request.context.headers=[{...cases.find(f=>f.name==='selected-lock').request.context.tip_header,nonce:'0x1',hash:'0x771ff3bbda2687be90ceb8af09de258fa83d294e0e3ec7e430cdbdc0ae0ef087'}];
 const results=await page.evaluate(async request=>{const {createWorkerVerifier}=await import('/js/index.js');const wasm=await(await fetch('/pkg/ckb_wasm_verifier_bg.wasm')).arrayBuffer();const v=await createWorkerVerifier({wasm});try{const matching=await v.verifyScriptGroup(request,request.script_group);const invalid=structuredClone(request);invalid.context.tip_header.hash=`0x${'00'.repeat(32)}`;const rejected=await v.verify(invalid);return {matching,rejected};}finally{v.dispose();}},request);
 expect(results.matching.ok).toBe(true);expect(results.matching.scope).toBe('script_group');expect(results.rejected.error.code).toBe('InvalidRequest');expect(results.rejected.error.message).toContain('header hash does not match');
});
