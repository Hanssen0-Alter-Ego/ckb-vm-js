import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test('result report exposes actual success, scope, rejection and mobile details', async ({ page }) => {
  await mkdir('test-results/evidence', { recursive: true });
  await page.goto('/ckb-vm-js/');
  await expect(page.locator('#status')).toHaveText('Ready');
  await page.getByRole('button', { name: 'Run verification' }).click();
  await expect(page.locator('#status')).toHaveText('Passed snapshot');
  await expect(page.locator('#result-verdict')).toHaveText('Passed');
  await expect(page.locator('#cycles')).toHaveText('539');
  await expect(page.locator('#result-fee')).toContainText('CKB');
  await expect(page.locator('#group-members')).toBeVisible();
  await expect(page.locator('#engine-error')).toBeHidden();
  await expect(page.locator('.output')).toBeFocused();
  await page.locator('.output').screenshot({ path: 'test-results/evidence/result-success.png' });
  for (const sample of ['selected-lock', 'script-failure']) {
    await page.locator('.example-menu summary').click();
    await page.locator('#sample').selectOption(sample);
    await page.getByRole('button', { name: 'Load sample' }).click();
    await expect(page.locator('.output')).toBeHidden();
    await page.getByRole('button', { name: 'Run verification' }).click();
    await expect(page.locator('#status')).toHaveText(sample === 'selected-lock' ? 'Passed snapshot' : 'Rejected');
    if (sample === 'selected-lock') {
      await expect(page.locator('#scope')).toHaveText('Selected script group');
      await expect(page.locator('#explanation')).toContainText('complete transaction were not checked');
      await expect(page.locator('#group-members')).toBeVisible();
    }
  }
  await expect(page.locator('#engine-error-message')).toBeVisible();
  await expect(page.locator('#engine-error-message')).toContainText('Inputs[0].Lock');
  await expect(page.locator('#result-fee')).toHaveText('Not reported');
  await expect(page.locator('#group-details')).toBeHidden();
  await page.locator('.output').screenshot({ path: 'test-results/evidence/result-failure.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.output').scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#raw-output summary').click();
  await expect(page.locator('#result')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('.output').screenshot({ path: 'test-results/evidence/result-mobile.png' });
});
