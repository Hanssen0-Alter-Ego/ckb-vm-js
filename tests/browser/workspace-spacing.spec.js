import { test, expect } from '@playwright/test';

for (const width of [1280, 390, 320]) test(`workspace controls and expanded drafts at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/ckb-vm-js/');
  await expect(page.locator('#status')).toHaveText('Ready');
  // Playwright provides a fresh isolated context; never touch a user's stored drafts.
  const records = await page.evaluate(() => {
    const records = Array.from({ length: 3 }, (_, i) => [
      `ckb-vm-js:draft:v1:spacing-${i}`,
      JSON.stringify({ version: 1, text: document.querySelector('#request').value,
        source: i === 1 ? 'Long named transaction draft for narrow viewport wrapping' : 'Passing snapshot',
        time: `2026-11-17T10:0${i}:00.000Z` })
    ]);
    for (const [key, value] of records) localStorage.setItem(key, value);
    return records;
  });
  await page.locator('#local-drafts>summary').click();
  await expect(page.locator('.draft-row')).toHaveCount(3);
  const exportBox = await page.locator('#download').boundingBox();
  const menuBox = await page.locator('.example-menu>summary').boundingBox();
  expect(Math.abs(exportBox.height - menuBox.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(exportBox.y - menuBox.y)).toBeLessThanOrEqual(1);
  const summary = await page.locator('#local-drafts>summary').boundingBox();
  const hint = await page.locator('#local-drafts>p').boundingBox();
  const refresh = await page.locator('#refresh-drafts').boundingBox();
  const list = await page.locator('#draft-list').boundingBox();
  expect(hint.y - summary.y - summary.height).toBeLessThanOrEqual(1);
  expect(refresh.y - hint.y - hint.height).toBeGreaterThanOrEqual(11);
  expect(list.y - refresh.y - refresh.height).toBeGreaterThanOrEqual(11);
  expect(await page.locator('.rail-help').evaluate(el => getComputedStyle(el).borderTopWidth)).toBe('0px');
  await page.screenshot({ path: testInfo.outputPath('drafts-menu-closed.png'), fullPage: true });
  await page.locator('.example-menu>summary').click();
  await expect(page.getByRole('button', { name: 'Load sample', exact: true })).toBeVisible();
  const menu = await page.locator('.menu-body').boundingBox();
  expect(menu.x).toBeGreaterThanOrEqual(0);
  expect(menu.x + menu.width).toBeLessThanOrEqual(width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('drafts-menu-open.png'), fullPage: true });
  await page.locator('.example-menu>summary').click();
  await page.getByRole('button', { name: 'Refresh draft list', exact: true }).click();
  expect(await page.evaluate(keys => keys.map(key => [key, localStorage.getItem(key)]), records.map(([key]) => key))).toEqual(records);
  await expect(page.locator('.draft-row')).toHaveCount(3);
});
