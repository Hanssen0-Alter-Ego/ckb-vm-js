import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('/ckb-vm-js/');
  await expect(page.locator('#status')).toHaveText('Ready');
}
async function keyboardRun(page, status) {
  const run = page.getByRole('button', { name: 'Run verification', exact: true });
  await run.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#status')).toHaveText(status);
}

for (const mode of ['constructor throws', 'Worker unavailable']) {
  test(`${mode}: recover from synchronous startup failure without stale success`, async ({ page }, testInfo) => {
    const uncaught = [];
    page.on('pageerror', error => uncaught.push(error.message));
    await ready(page);
    await keyboardRun(page, 'Passed snapshot');
    await expect(page.locator('#cycles')).toHaveText('539');
    const requestBefore = await page.locator('#request').inputValue();
    await page.evaluate(mode => {
      window.originalWorkerForTest = window.Worker;
      window.Worker = mode === 'constructor throws'
        ? class { constructor() { throw new DOMException('Worker creation blocked for this test', 'SecurityError'); } }
        : undefined;
    }, mode);
    await keyboardRun(page, 'Execution error');
    await expect(page.locator('#result-verdict')).toHaveText('Not completed');
    await expect(page.locator('#summary')).toHaveText('Verification did not complete.');
    await expect(page.locator('#explanation')).toContainText('No verification conclusion is available');
    if (mode === 'constructor throws') await expect(page.locator('#result')).toContainText('Worker creation blocked for this test');
    for (const id of ['scope', 'cycles', 'result-fee', 'engine-error', 'group-details']) await expect(page.locator('#'+id)).toBeHidden();
    await expect(page.locator('#cancel')).toBeHidden();
    await expect(page.locator('#run')).toBeEnabled();
    await expect(page.locator('.output')).toBeFocused();
    expect(await page.locator('#request').inputValue()).toBe(requestBefore);
    expect(uncaught).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('startup-failure-full.png'), fullPage: true });
    await page.evaluate(() => { window.Worker = window.originalWorkerForTest; delete window.originalWorkerForTest; });
    await keyboardRun(page, 'Passed snapshot');
    await expect(page.locator('#cycles')).toHaveText('539');
    await expect(page.locator('#result')).not.toContainText('Execution error');
    expect(uncaught).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('startup-recovered-full.png'), fullPage: true });
  });
}

test('keyboard cancellation of stalled initialization permits a real retry', async ({ page }) => {
  await ready(page);
  await page.route('**/worker.js', route => route.fulfill({ contentType: 'application/javascript', body: 'self.onmessage = () => {};' }));
  await keyboardRun(page, 'Running');
  await page.getByRole('button', { name: 'Cancel', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#status')).toHaveText('Cancelled');
  await expect(page.locator('.output')).toBeFocused();
  await expect(page.locator('#run')).toBeEnabled();
  await page.unroute('**/worker.js');
  await keyboardRun(page, 'Passed snapshot');
  await expect(page.locator('#cycles')).toHaveText('539');
});

test('keyboard invalid edit and Escape preserve the exact JSON and return focus', async ({ page }, testInfo) => {
  await ready(page);
  await page.locator('#advanced summary').focus();
  await page.keyboard.press('Enter');
  const input = page.locator('#request');
  const original = await input.inputValue();
  const withUnknown = original.replace(/\{/, '{"extension_for_test":9007199254740993,');
  await input.fill(withUnknown);
  await page.locator('#advanced summary').focus();
  await page.keyboard.press('Enter');
  const editor = page.getByRole('button', { name: /^Edit input index 0 ·/ });
  await editor.focus();
  await page.keyboard.press('Enter');
  const field = page.getByLabel('Input index 0 capacity (CKB)', { exact: true });
  await field.fill('-1');
  await page.getByRole('button', { name: 'Save', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(field).toBeFocused();
  await expect(page.locator('dialog[open]')).toBeVisible();
  expect(await input.inputValue()).toBe(withUnknown);
  await page.screenshot({ path: testInfo.outputPath('keyboard-invalid-edit.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(editor).toBeFocused();
  expect(await input.inputValue()).toBe(withUnknown);
});
