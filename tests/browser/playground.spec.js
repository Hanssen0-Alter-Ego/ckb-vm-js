import { test, expect } from '@playwright/test';

test('project Pages path loads real WASM and supports repeat, rejection and recovery', async ({ page }) => {
  const failures = [];
  page.on('pageerror', error => failures.push(error.message));
  const wasm = [];
  page.on('response', response => { if (response.url().endsWith('.wasm')) wasm.push([response.url(), response.status()]); });
  await page.goto('/ckb-vm-js/');
  await expect(page.locator('#status')).toHaveText('Ready');
  for (const path of ['fixtures/submitted-valid.json','fixtures/selected-lock.json','fixtures/script-failure.json','fixtures/valid.json','worker.js','pkg/ckb_wasm_verifier.js','pkg/ckb_wasm_verifier_bg.wasm']) {
    const response = await page.request.get(`/ckb-vm-js/${path}`);
    expect(response.status(), path).toBe(200);
  }
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Run verification' }).click();
    await expect(page.locator('#status')).toHaveText('Passed snapshot');
    const result = JSON.parse(await page.locator('#result').textContent());
    expect(result.ok).toBe(true);
    expect(result.chain_state_verified).toBe(false);
    expect(result.cycles).toBe('0x21b');
  }
  await page.locator('#advanced summary').click();
  await page.locator('.example-menu summary').click();
  await page.locator('#sample').selectOption('selected-lock');
  await page.getByRole('button', { name: 'Load sample' }).click();
  await expect(page.locator('#status')).toHaveText('Ready');
  await page.getByRole('button', { name: 'Run verification' }).click();
  await expect(page.locator('#status')).toHaveText('Passed snapshot');
  await expect(page.locator('#scope')).toHaveText('Selected script group');
  await page.locator('.example-menu summary').click();
  await page.locator('#sample').selectOption('script-failure');
  await page.getByRole('button', { name: 'Load sample' }).click();
  await expect(page.locator('#status')).toHaveText('Ready');
  await page.getByRole('button', { name: 'Run verification' }).click();
  await expect(page.locator('#status')).toHaveText('Rejected');
  expect(JSON.parse(await page.locator('#result').textContent()).ok).toBe(false);
  await page.locator('#request').fill('{broken');
  await page.getByRole('button', { name: 'Run verification' }).click();
  await expect(page.locator('#status')).toHaveText('Input error');
  await page.locator('.example-menu summary').click();
  await page.locator('#sample').selectOption('valid');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Load sample' }).click();
  await expect(page.locator('#status')).toHaveText('Ready');
  await page.getByRole('button', { name: 'Run verification' }).click();
  await expect(page.locator('#status')).toHaveText('Passed snapshot');
  expect(wasm.length).toBeGreaterThan(0);
  expect(wasm.every(([url, status]) => url.includes('/ckb-vm-js/pkg/') && status === 200)).toBe(true);
  expect(failures).toEqual([]);
});

test('mobile layout, local import/export and cancel during initialization', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/ckb-vm-js/');
  await expect(page.locator('#status')).toHaveText('Ready');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const original = await page.locator('#request').inputValue();
  await page.locator('#upload').setInputFiles({ name: 'fixture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ request: JSON.parse(original) })) });
  await expect(page.locator('#summary')).toHaveText('Imported locally. Inspect the request before running.');
  await page.locator('.example-menu summary').click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON' }).click();
  expect((await download).suggestedFilename()).toBe('ckb-verification-request.json');
  await page.route('**/*.wasm', route => new Promise(resolve => setTimeout(() => resolve(route.abort()), 1500)));
  await page.getByRole('button', { name: 'Run verification' }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('Cancelled');
  await page.unroute('**/*.wasm');
  await page.getByRole('button', { name: 'Run verification' }).click();
  await expect(page.locator('#status')).toHaveText('Passed snapshot');
});

