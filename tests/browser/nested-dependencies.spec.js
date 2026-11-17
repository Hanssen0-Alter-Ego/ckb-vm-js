import { test, expect } from '@playwright/test';
const button = (page, name) => page.getByRole('button', { name, exact: typeof name === 'string' });
const enter = (page, name) => button(page, name).press('Enter');
const dep = (page, index) => button(page, new RegExp(`^Edit cell dep index ${index} ·`));
async function setup(page) {
  await page.setViewportSize({ width: 390, height: 650 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/ckb-vm-js/');
  await expect(page.locator('#status')).toHaveText('Ready');
  await page.locator('#advanced summary').press('Enter');
  const request = page.locator('#request');
  const value = JSON.parse(await request.inputValue());
  value.transaction.cell_deps[0].out_point = structuredClone(value.transaction.inputs[0].previous_output);
  value.transaction.cell_deps.push(structuredClone(value.transaction.cell_deps[0]));
  value.transaction.witnesses = ['0xaabb'];
  const baseline = JSON.stringify(value).replace(/\{/, '{"unknown_integer":9007199254740993,');
  await request.fill(baseline);
  await page.locator('#advanced summary').press('Enter');
  return { request, baseline, value };
}
async function assertApply(page) {
  const apply = button(page, 'Apply reference');
  await expect(apply).toBeFocused();
  expect(await apply.evaluate(el => {
    const r = el.getBoundingClientRect(), dialog = el.closest('dialog').getBoundingClientRect();
    const bar = el.closest('dialog').querySelector('.inspector-heading').getBoundingClientRect();
    return r.top >= Math.max(0, bar.bottom) && r.bottom <= Math.min(innerHeight, dialog.bottom);
  })).toBe(true);
}

test('shared dependency reference Apply stays focused and nested rollback preserves prior saves', async ({ page }, testInfo) => {
  const { request, baseline, value } = await setup(page);
  await enter(page, 'Manage cell deps');
  await dep(page, 0).press('Enter');
  await expect(page.getByRole('heading', { name: 'Cell dep index 0', exact: true })).toBeFocused();
  await page.getByText('Reference & origin', { exact: true }).press('Enter');
  const hash = page.getByLabel('Cell dep index 0 transaction hash', { exact: true });
  const index = page.getByLabel('Cell dep index 0 output index (RPC hex)', { exact: true });
  // A collision must stay an explicit error, not merge or overwrite supplied cells.
  await hash.fill(value.context.cells[1].out_point.tx_hash);
  await enter(page, 'Apply reference');
  await expect(hash).toHaveAttribute('aria-invalid', 'true');
  await expect(hash).toBeFocused();
  expect(await request.inputValue()).toBe(baseline);
  const point = { tx_hash: `0x${'ab'.repeat(32)}`, index: '0x2' };
  await hash.fill(point.tx_hash);
  await index.fill(point.index);
  await enter(page, 'Apply reference');
  await assertApply(page);
  const applied = await request.inputValue(), changed = JSON.parse(applied);
  expect(changed.transaction.inputs[0].previous_output).toEqual(point);
  expect(changed.transaction.cell_deps.map(d => d.out_point)).toEqual([point, point]);
  expect(changed.context.cells[0]).toEqual({ ...value.context.cells[0], out_point: point });
  expect(changed.context.cells[1]).toEqual(value.context.cells[1]);
  expect(changed.transaction.witnesses).toEqual(value.transaction.witnesses);
  expect(applied).toContain('9007199254740993');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Cell dep index 0', exact: true })).toBeVisible();
  await assertApply(page);
  expect(await request.inputValue()).toBe(applied);
  await page.screenshot({ path: testInfo.outputPath('shared-reference-apply.png'), fullPage: true });
  await enter(page, 'Save');
  await expect(dep(page, 0)).toBeFocused();
  await dep(page, 1).press('Enter');
  await page.getByLabel('Cell dep index 1 data (hex)', { exact: true }).fill('0xccdd');
  await page.keyboard.press('Escape');
  await expect(dep(page, 1)).toBeFocused();
  expect(await request.inputValue()).toBe(applied);
  await page.screenshot({ path: testInfo.outputPath('dependency-return.png'), fullPage: true });
  await enter(page, 'Cancel changes');
  await expect(button(page, 'Manage cell deps')).toBeFocused();
  expect(await request.inputValue()).toBe(baseline);
});

for (const cancel of ['Cancel changes', 'Escape']) {
  test(`new dependency ${cancel} discards invalid draft, explicit nested and outer Save persist`, async ({ page }, testInfo) => {
    const { request, baseline, value } = await setup(page);
    await enter(page, 'Manage cell deps');
    await enter(page, 'New resolved cell');
    await page.getByLabel('Cell dep index 2 capacity (CKB)', { exact: true }).fill('invalid');
    await enter(page, 'Save');
    await expect(page.getByLabel('Cell dep index 2 capacity (CKB)', { exact: true })).toBeFocused();
    if (cancel === 'Escape') await page.keyboard.press('Escape');
    else await enter(page, 'Cancel changes');
    await expect(button(page, 'New resolved cell')).toBeFocused();
    expect(await request.inputValue()).toBe(baseline);
    await enter(page, 'New resolved cell');
    await page.getByLabel('Cell dep index 2 data (hex)', { exact: true }).fill('0xabcd');
    await enter(page, 'Save');
    await expect(dep(page, 2)).toBeFocused();
    const applied = await request.inputValue(), next = JSON.parse(applied);
    expect(next.transaction.cell_deps).toHaveLength(3);
    expect(next.context.cells.slice(0, 2)).toEqual(value.context.cells);
    expect(next.context.cells[2].data).toBe('0xabcd');
    expect(next.transaction.cell_deps[2].out_point).toEqual(next.context.cells[2].out_point);
    await page.screenshot({ path: testInfo.outputPath('new-dependency-saved.png'), fullPage: true });
    await enter(page, 'Save');
    await expect(button(page, 'Manage cell deps')).toBeFocused();
    expect(await request.inputValue()).toBe(applied);
    await button(page, /^Cell dep index 2 ·/).press('Enter');
    await page.getByLabel('Cell dep index 2 data (hex)', { exact: true }).fill('0xcd');
    await enter(page, 'Cancel changes');
    expect(await request.inputValue()).toBe(applied);
    await expect(button(page, /^Cell dep index 2 ·/)).toBeFocused();
  });
}

test('the shared input reference control also retains Apply focus and exact cancellation', async ({ page }) => {
  const { request, baseline } = await setup(page);
  await button(page, /^Edit input index 0 ·/).press('Enter');
  await page.getByText('Advanced · since & reference', { exact: true }).press('Enter');
  await page.getByText('Reference & origin', { exact: true }).press('Enter');
  await page.getByLabel('Input index 0 output index (RPC hex)', { exact: true }).fill('0x2');
  await enter(page, 'Apply reference');
  await assertApply(page);
  await page.keyboard.press('Enter');
  await assertApply(page);
  await expect(page.getByRole('heading', { name: 'Input index 0', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  expect(await request.inputValue()).toBe(baseline);
  await expect(button(page, /^Edit input index 0 ·/)).toBeFocused();
});
