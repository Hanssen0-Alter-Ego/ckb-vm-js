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
