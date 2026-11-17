import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

async function ready(page) {
  await page.goto('/ckb-vm-js/');
  await expect(page.locator('#status')).toHaveText('Ready');
}
async function run(page, status = 'Passed snapshot') {
  await page.getByRole('button', { name: 'Run verification' }).click();
  await expect(page.locator('#status')).toHaveText(status);
}
async function sample(page, name) {
  await page.locator('.example-menu summary').click();
  await page.locator('#sample').selectOption(name);
  await page.getByRole('button', { name: 'Load sample' }).click();
  await expect(page.locator('#status')).toHaveText('Ready');
  await expect(page.locator('.output')).toBeHidden();
}
async function evidence(page, name) {
  await mkdir('test-results/evidence', { recursive: true });
  await page.locator('.output').screenshot({ path: `test-results/evidence/${name}.png` });
  await page.screenshot({ path: `test-results/evidence/${name}-full.png`, fullPage: true });
}
async function noStaleResult(page) {
  for (const id of ['scope', 'cycles', 'result-fee']) await expect(page.locator('#'+id)).toBeHidden();
  await expect(page.locator('#engine-error')).toBeHidden();
  await expect(page.locator('#engine-error-doc')).not.toHaveAttribute('href');
  await expect(page.locator('#group-details')).toBeHidden();
}

test('result report prioritizes errors and captures desktop and narrow context', async ({ page }) => {
  await ready(page);
  await run(page);
  await expect(page.locator('#cycles')).toHaveText('539');
  await expect(page.locator('#result-fee')).toHaveText('0 CKB');
  await expect(page.locator('#explanation')).not.toContainText('Fee in this snapshot');
  await expect(page.locator('.output')).toBeFocused();
  await evidence(page, 'result-success-desktop');
  await page.setViewportSize({ width: 390, height: 844 });
  await evidence(page, 'result-success-narrow');
  await sample(page, 'selected-lock');
  await run(page);
  await expect(page.locator('#scope')).toHaveText('Selected script group');
  await expect(page.locator('#result-fee')).toBeHidden();
  await expect(page.locator('#explanation')).toContainText('complete transaction were not checked');
  await evidence(page, 'result-selected-narrow');
  await sample(page, 'script-failure');
  await run(page, 'Rejected');
  await expect(page.locator('#engine-error-message')).toContainText('Inputs[0].Lock');
  await expect(page.locator('#engine-error-message')).not.toContainText('https://');
  await expect(page.locator('#engine-error-doc')).toHaveAttribute('href', /^https:\/\/nervosnetwork\.github\.io\/ckb-script-error-codes\/by-data-hash\/[0-9a-f]{64}\.html#-1$/);
  await expect(page.locator('#explanation')).not.toContainText('Open Full engine response');
  for (const id of ['scope', 'cycles', 'result-fee']) await expect(page.locator('#'+id)).toBeHidden();
  await expect(page.locator('#elapsed')).toBeVisible();
  await expect(page.locator('#requested-scope')).toHaveText('Full transaction');
  const errorBox = await page.locator('#engine-error').boundingBox();
  const metaBox = await page.locator('.result-metrics').boundingBox();
  expect(errorBox.y + errorBox.height).toBeLessThanOrEqual(metaBox.y);
  await evidence(page, 'result-failure-narrow');
  await page.locator('#raw-output summary').click();
  await expect(page.locator('#result')).toContainText('https://nervosnetwork.github.io/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await evidence(page, 'result-failure-json-narrow');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('#raw-output summary').click();
  await evidence(page, 'result-failure-desktop');
  // Re-run success after a rejection: neither the error nor its link may survive.
  await sample(page, 'submitted-valid');
  await run(page);
  await expect(page.locator('#engine-error')).toBeHidden();
  await expect(page.locator('#engine-error-doc')).not.toHaveAttribute('href');
  await expect(page.locator('#result-fee')).toHaveText('0 CKB');
});

for (const mode of ['runtime', 'cancel', 'timeout']) test(`${mode} after success has no stale verified metrics or engine error`, async ({ page }) => {
  await ready(page);
  await run(page);
  if (mode === 'runtime') {
    await page.route('**/worker.js', route => route.fulfill({ contentType: 'application/javascript', body: 'throw new Error("Simulated worker startup failure");' }));
  } else {
    await page.route('**/worker.js', route => route.fulfill({ contentType: 'application/javascript', body: 'self.onmessage = () => {};' }));
  }
  if (mode === 'timeout') await page.clock.install();
  await page.getByRole('button', { name: 'Run verification' }).click();
  if (mode !== 'runtime') {
    await expect(page.locator('#status')).toHaveText('Running');
    await noStaleResult(page);
    if (mode === 'cancel') await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    else await page.clock.fastForward(30_001);
  }
  await expect(page.locator('#status')).toHaveText(mode === 'cancel' ? 'Cancelled' : 'Execution error');
  await expect(page.locator('#result-verdict')).toHaveText(mode === 'cancel' ? 'Cancelled' : 'Not completed');
  await expect(page.locator('#explanation')).toContainText('No verification conclusion is available');
  await noStaleResult(page);
  await expect(page.locator('#requested-scope')).toHaveText('Full transaction');
  await expect(page.locator('#elapsed')).toBeVisible();
  await page.unroute('**/worker.js');
  await run(page);
  await expect(page.locator('#result-verdict')).toHaveText('Passed');
  await expect(page.locator('#cycles')).toHaveText('539');
});

test('invalid input has no verified metrics and cancelling an edit restores the error report', async ({ page }) => {
  await ready(page);
  await sample(page, 'script-failure');
  await run(page, 'Rejected');
  const before = await page.locator('.output').innerText();
  await page.getByRole('button', {name:/^Edit output index 0/}).click();
  await page.getByLabel('Output index 0 capacity (CKB)').fill('999');
  await page.getByRole('button', {name:'Cancel changes'}).click();
  expect(await page.locator('.output').innerText()).toBe(before);
  await expect(page.locator('#engine-error-doc')).toHaveAttribute('href', /^https:\/\/nervosnetwork\.github\.io\//);
  await page.locator('#advanced summary').click();
  const request = JSON.parse(await page.locator('#request').inputValue());
  request.script_group = {group_type:'lock',script_hash:'0x12'};
  await page.locator('#request').fill(JSON.stringify(request));
  await page.locator('#advanced summary').click();
  await run(page, 'Rejected');
  await expect(page.locator('#engine-error-code')).toContainText('InvalidRequest');
  await expect(page.locator('#explanation')).toContainText('2 hex digits');
  await expect(page.locator('#engine-error-doc')).not.toHaveAttribute('href');
  for (const id of ['scope', 'cycles', 'result-fee']) await expect(page.locator('#'+id)).toBeHidden();
});
