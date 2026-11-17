import { test, expect } from '@playwright/test';

const button = (page, name) => page.getByRole('button', { name, exact: true });
const enter = (page, name) => button(page, name).press('Enter');
async function setup(page) {
  await page.setViewportSize({ width: 390, height: 650 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/ckb-vm-js/');
  await expect(page.locator('#status')).toHaveText('Ready');
  await page.locator('#advanced summary').press('Enter');
  const request = page.locator('#request');
  // Preserve a number beyond JS's safe integer range through both rollback and save.
  const before = (await request.inputValue()).replace(/\{/, '{"nested_test":9007199254740993,');
  await request.fill(before);
  await page.locator('#advanced summary').press('Enter');
  return { request, before };
}
async function visibleFocus(locator) {
  await expect(locator).toBeFocused();
  expect(await locator.evaluate(el => {
    const r = el.getBoundingClientRect();
    const dialog = el.closest('dialog').getBoundingClientRect();
    const bar = el.closest('dialog').querySelector('.inspector-heading').getBoundingClientRect();
    return r.top >= Math.max(0, bar.bottom) && r.bottom <= Math.min(innerHeight, dialog.bottom);
  })).toBe(true);
}

for (const finish of ['Escape', 'Save']) {
  test(`extension Apply retains keyboard focus, Back retains changes, outer ${finish} is explicit`, async ({ page }, testInfo) => {
    const { request, before } = await setup(page);
    await enter(page, 'Manage header deps');
    await enter(page, 'Add existing header');
    await enter(page, 'Open header dep index 0');
    await page.getByText('Extension information', { exact: true }).press('Enter');
    await page.getByLabel('Extension status', { exact: true }).selectOption('bytes');
    const data = page.getByLabel('Extension bytes (hex)', { exact: true });
    await data.fill('0x1');
    const beforeInvalid = await request.inputValue();
    await enter(page, 'Apply extension information');
    await visibleFocus(data);
    await expect(data).toHaveAttribute('aria-invalid', 'true');
    expect(await request.inputValue()).toBe(beforeInvalid);
    await data.fill('0x1234');
    await enter(page, 'Apply extension information');
    const apply = button(page, 'Apply extension information');
    await visibleFocus(apply);
    await expect(data).toHaveValue('0x1234');
    const applied = await request.inputValue();
    await page.keyboard.press('Enter'); // Must repeat Apply, never activate outer Save.
    await expect(page.locator('dialog[open]')).toBeVisible();
    await visibleFocus(apply);
    expect(await request.inputValue()).toBe(applied);
    await page.screenshot({ path: testInfo.outputPath('extension-applied-focus.png'), fullPage: true });
    await enter(page, 'Back to header dependencies');
    await expect(button(page, 'Open header dep index 0')).toBeFocused();
    expect(await request.inputValue()).toBe(applied);
    if (finish === 'Escape') {
      await page.keyboard.press('Escape');
      expect(await request.inputValue()).toBe(before);
      await expect(button(page, 'Manage header deps')).toBeFocused();
    } else {
      await enter(page, 'Save');
      expect(await request.inputValue()).toBe(applied);
      expect(applied).toContain('9007199254740993');
      await enter(page, 'Header dep index 0 · open details');
      // Disclosure state may be restored, so only open it when needed.
      if (!await data.isVisible()) await page.getByText('Extension information', { exact: true }).press('Enter');
      await expect(data).toHaveValue('0x1234');
      await page.getByLabel('Extension status', { exact: true }).selectOption('none');
      await enter(page, 'Apply extension information');
      await visibleFocus(apply);
      await expect(data).toBeHidden();
      const value = JSON.parse(await request.inputValue());
      expect(value.context.extensions.find(e => e.block_hash === value.transaction.header_deps[0]).data).toBeNull();
      await page.keyboard.press('Escape');
      expect(await request.inputValue()).toBe(applied);
    }
    await expect(page.locator('dialog[open]')).toHaveCount(0);
  });
}

test('nested header Back and Escape discard only the draft; saved copies remain in the outer rollback', async ({ page }, testInfo) => {
  const { request, before } = await setup(page);
  await enter(page, 'Manage header deps');
  await enter(page, 'Add existing header');
  const linked = await request.inputValue();
  for (const exit of ['Back', 'Escape']) {
    await enter(page, 'Create header');
    await expect(page.getByRole('heading', { name: 'Create a header', exact: true })).toBeFocused();
    await page.getByLabel('Header Block number (RPC hex)').fill('0x65');
    if (exit === 'Back') await enter(page, 'Back');
    else await page.keyboard.press('Escape');
    await expect(button(page, 'Create header')).toBeFocused();
    expect(await request.inputValue()).toBe(linked);
  }
  await enter(page, 'Open header dep index 0');
  await enter(page, 'Edit a copy');
  await page.getByLabel('Header Block number (RPC hex)').fill('0x65');
  await enter(page, 'Back');
  await expect(button(page, 'Edit a copy')).toBeFocused();
  expect(await request.inputValue()).toBe(linked);
  await enter(page, 'Edit a copy');
  await page.getByLabel('Header Block number (RPC hex)').fill('0x65');
  await page.getByLabel('Extension for this header').selectOption('none');
  await enter(page, 'Save header');
  await expect(button(page, 'Create header')).toBeFocused();
  const changed = JSON.parse(await request.inputValue());
  expect(changed.context.tip_header).toEqual(JSON.parse(before).context.tip_header);
  expect(changed.transaction.header_deps[0]).not.toBe(JSON.parse(linked).transaction.header_deps[0]);
  expect(changed.context.headers.at(-1).number).toBe('0x65');
  await page.screenshot({ path: testInfo.outputPath('header-saved-outer-session.png'), fullPage: true });
  await page.keyboard.press('Escape');
  expect(await request.inputValue()).toBe(before);
  await expect(button(page, 'Manage header deps')).toBeFocused();
});

test('Context header drafts validate extensions, restore trigger focus and preserve explicit outer Save', async ({ page }, testInfo) => {
  const { request, before } = await setup(page);
  await enter(page, 'Context');
  await page.getByText('Supplied headers', { exact: true }).press('Enter');
  const add = button(page, 'Add header from tip template');
  await add.press('Enter');
  await page.getByLabel('Header Block number (RPC hex)').fill('0x65');
  await page.getByLabel('Extension for this header').selectOption('bytes');
  const bytes = page.getByLabel('Extension data (hex)');
  await bytes.fill('0xz');
  await enter(page, 'Save header');
  await expect(bytes).toBeFocused();
  await expect(bytes).toHaveAttribute('aria-invalid', 'true');
  expect(await request.inputValue()).toBe(before);
  await bytes.fill('0xabcd');
  await enter(page, 'Save header');
  await expect(add).toBeFocused();
  const applied = await request.inputValue();
  expect(applied).toContain('9007199254740993');
  const data = JSON.parse(applied);
  expect(data.context.headers.at(-1).number).toBe('0x65');
  expect(data.context.extensions.at(-1).data).toBe('0xabcd');
  expect(data.transaction.header_deps).toEqual([]);
  await add.press('Enter');
  await page.getByLabel('Header Block number (RPC hex)').fill('0x66');
  await page.keyboard.press('Escape');
  await expect(add).toBeFocused();
  expect(await request.inputValue()).toBe(applied);
  await page.screenshot({ path: testInfo.outputPath('context-nested-return.png'), fullPage: true });
  await enter(page, 'Save');
  await expect(button(page, 'Context')).toBeFocused();
  expect(await request.inputValue()).toBe(applied);
});
