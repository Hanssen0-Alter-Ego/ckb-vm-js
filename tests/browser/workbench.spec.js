import { test, expect } from '@playwright/test';
const ready=async page=>{await page.goto('/ckb-vm-js/');await expect(page.locator('#status')).toHaveText('Ready');};
const edit=async(page,kind,i=1)=>page.getByRole('button',{name:`Edit ${kind} ${i}`,exact:true}).click();
const done=async page=>page.getByRole('button',{name:'Save',exact:true}).click();
test('overview and inspector edits preserve unknown data, round trips and recovery',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await ready(page);
 await expect(page.getByLabel('Input 1 capacity (CKB)',{exact:true})).toHaveCount(0);
 await edit(page,'input');await expect(page.getByLabel('Input 1 capacity (CKB)',{exact:true})).toHaveValue('1000');await done(page);
 await page.getByRole('button',{name:'Add output',exact:true}).click();await edit(page,'output',2);
 let field=page.getByLabel('Output 2 capacity (CKB)',{exact:true});await field.fill('61');await field.press('Tab');await done(page);
 let r=JSON.parse(await page.locator('#request').inputValue());expect(r.transaction.outputs).toHaveLength(2);expect(BigInt(r.transaction.outputs[1].capacity)).toBe(6100000000n);
 await page.locator('#advanced summary').click();r.extension={keep:['a',123]};await page.locator('#request').fill(JSON.stringify(r));
 await edit(page,'output');field=page.getByLabel('Output 1 capacity (CKB)',{exact:true});await field.fill('500');await field.press('Tab');await done(page);
 expect(JSON.parse(await page.locator('#request').inputValue()).extension).toEqual({keep:['a',123]});
 await page.getByRole('button',{name:'Manage witnesses'}).click();await page.getByRole('button',{name:'Add witness',exact:true}).click();await expect(page.getByLabel('Witness 0 (hex)',{exact:true})).toBeVisible();await done(page);
 await page.locator('#request').fill('{bad');await expect(page.locator('#workbench')).toContainText('Structured editor unavailable');await page.locator('#request').fill(JSON.stringify(r));
 await page.getByRole('button',{name:'Add synthetic input',exact:true}).click();const added=JSON.parse(await page.locator('#request').inputValue());expect(added.transaction.inputs).toHaveLength(2);expect(added.context.cells.at(-1).transaction_info).toBeNull();expect(errors).toEqual([]);
});
test('mobile overview fits within two screens, details retain invalid drafts and Escape returns focus',async({page})=>{
 await page.setViewportSize({width:390,height:844});await ready(page);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(await page.locator('#run').evaluate(e=>e.getBoundingClientRect().bottom)).toBeLessThan(1688);
 await edit(page,'input');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Edit input 1',exact:true})).toBeFocused();
 await edit(page,'output');const field=page.getByLabel('Output 1 capacity (CKB)',{exact:true});await field.fill('oops');await field.press('Tab');expect(await field.evaluate(e=>e.validity.valid)).toBe(false);await page.keyboard.press('Escape');await expect(page.locator('dialog')).not.toBeVisible();await edit(page,'output');const retry=page.getByLabel('Output 1 capacity (CKB)',{exact:true});await retry.fill('999');await retry.press('Tab');await done(page);
 await page.locator('#advanced summary').click();let r=JSON.parse(await page.locator('#request').inputValue());r.transaction.inputs=[null];await page.locator('#request').fill(JSON.stringify(r));await expect(page.locator('#workbench')).toContainText('Needs attention');expect(JSON.parse(await page.locator('#request').inputValue()).transaction.inputs).toEqual([null]);
});
test('numbered dependencies, settings and many-cell browse are reachable without data loss',async({page})=>{
 await ready(page);await page.getByRole('button',{name:/Cell dep 1 ·/}).click();await expect(page.locator('dialog')).toContainText('Cell dep 1');await done(page);await page.getByRole('button',{name:'Manage cell deps',exact:true}).click();await expect(page.getByLabel('Resolved cell to add as dependency')).toBeVisible();await done(page);
 await page.locator('#advanced summary').click();let r=JSON.parse(await page.locator('#request').inputValue());r.transaction.outputs=Array.from({length:12},()=>structuredClone(r.transaction.outputs[0]));r.transaction.outputs_data=Array(12).fill('0x');await page.locator('#request').fill(JSON.stringify(r));await page.locator('#advanced summary').click();
 await expect(page.getByRole('button',{name:/Edit output/})).toHaveCount(4);await page.getByRole('button',{name:'Browse all 12 cells'}).click();await expect(page.getByRole('button',{name:/Edit output/})).toHaveCount(12);await edit(page,'output',12);await done(page);await page.getByRole('button',{name:'Show first 4'}).click();expect(JSON.parse(await page.locator('#request').inputValue()).transaction.outputs).toHaveLength(12);
});

test('overview screenshots and direct Done commit',async({page})=>{
 await ready(page);await page.screenshot({path:'test-results/overview-desktop.png',fullPage:true});
 await edit(page,'output');const f=page.getByLabel('Output 1 capacity (CKB)',{exact:true});await f.fill('999');await done(page);await expect(page.locator('dialog')).not.toBeVisible();expect(BigInt(JSON.parse(await page.locator('#request').inputValue()).transaction.outputs[0].capacity)).toBe(99900000000n);
 await edit(page,'output');await page.screenshot({path:'test-results/overview-inspector.png',fullPage:true});await done(page);
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/overview-mobile.png',fullPage:true});
});

test('reordering follows the selected cell and tools restore their own focus',async({page})=>{
 await ready(page);await page.getByRole('button',{name:'Add output',exact:true}).click();await edit(page,'output',2);
 const f=page.getByLabel('Output 2 capacity (CKB)',{exact:true});await f.fill('61');await f.press('Tab');
 await page.getByRole('button',{name:'↑',exact:true}).click();await expect(page.getByLabel('Output 1 capacity (CKB)',{exact:true})).toHaveValue('61');await done(page);
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Settings',exact:true})).toBeFocused();
 await page.getByRole('button',{name:/Cell dep 1 ·/}).focus();await page.keyboard.press('Enter');await expect(page.locator('dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:/Cell dep 1 ·/})).toBeFocused();
});

test('malformed structure has an explicit invalid-draft escape back to JSON',async({page})=>{
 await ready(page);await page.locator('#advanced summary').click();let r=JSON.parse(await page.locator('#request').inputValue());r.transaction.outputs_data=null;await page.locator('#request').fill(JSON.stringify(r));await edit(page,'output');await page.getByLabel('Output 1 data (hex)',{exact:true}).fill('0xaa');await page.getByRole('button',{name:'Cancel changes',exact:true}).click();await expect(page.locator('dialog')).not.toBeVisible();expect(JSON.parse(await page.locator('#request').inputValue()).transaction.outputs_data).toBeNull();r.transaction.outputs_data=['0x'];await page.locator('#request').fill(JSON.stringify(r));await edit(page,'output');await page.getByLabel('Output 1 data (hex)',{exact:true}).fill('0xaa');await done(page);expect(JSON.parse(await page.locator('#request').inputValue()).transaction.outputs_data).toEqual(['0xaa']);
});

test('context fields, decimal uint64 cycles and independent witness/header dots round trip',async({page})=>{
 await ready(page);await page.getByRole('button',{name:'Settings',exact:true}).click();let cycles=page.getByLabel('Maximum cycles (decimal)',{exact:true});await expect(cycles).toHaveValue('10000000');await cycles.fill('9007199254740993');await done(page);expect(JSON.parse(await page.locator('#request').inputValue()).max_cycles).toBe('0x20000000000001');
 await page.getByRole('button',{name:'Context',exact:true}).click();await page.getByText('Consensus',{exact:true}).click();await page.getByLabel('max block cycles (decimal)',{exact:true}).fill('18446744073709551615');await done(page);expect(JSON.parse(await page.locator('#request').inputValue()).context.consensus.max_block_cycles).toBe('0xffffffffffffffff');
 await page.getByRole('button',{name:'Manage witnesses',exact:true}).click();await page.getByRole('button',{name:'Add witness',exact:true}).click();await done(page);await page.getByRole('button',{name:'Witness 0 · open details',exact:true}).click();await page.getByLabel('Witness 0 (hex)',{exact:true}).fill('0xaabb');await done(page);
 await page.getByRole('button',{name:'Manage header deps',exact:true}).click();await page.getByRole('button',{name:'Add header dep',exact:true}).click();await done(page);await page.getByRole('button',{name:'Header dep 1 · open details',exact:true}).click();await page.getByLabel('Header dep 1 hash', {exact:true}).fill(`0x${'ab'.repeat(32)}`);await done(page);let r=JSON.parse(await page.locator('#request').inputValue());expect(r.transaction.witnesses).toEqual(['0xaabb']);expect(r.transaction.header_deps).toEqual([`0x${'ab'.repeat(32)}`]);
});
test('list sorting preserves stable cell/script IDs and duplicate creates a distinct identity',async({page})=>{
 await ready(page);await page.getByRole('button',{name:'Add output',exact:true}).click();const cards=page.locator('.cell-column').nth(1).locator('.cell-row');const first=await cards.nth(0).getAttribute('data-cell-id');const second=await cards.nth(1).getAttribute('data-cell-id');const marker=await cards.nth(1).locator('.script-chip').first().textContent();await page.getByRole('button',{name:`Move ${second} up`,exact:true}).click();expect(await cards.nth(0).getAttribute('data-cell-id')).toBe(second);expect(await cards.nth(1).getAttribute('data-cell-id')).toBe(first);expect(await cards.nth(0).locator('.script-chip').first().textContent()).toBe(marker);await expect(page.getByRole('button',{name:'Edit output 1',exact:true})).toBeFocused();await edit(page,'output');await page.getByRole('button',{name:'Copy',exact:true}).click();await done(page);expect(await cards.nth(2).getAttribute('data-cell-id')).not.toBe(first);expect(await cards.nth(2).getAttribute('data-cell-id')).not.toBe(second);expect(await page.locator('#request').inputValue()).not.toContain('cellId');
});
test('new independent resolved code cell and common script controls need no input',async({page})=>{
 await ready(page);await page.locator('#advanced summary').click();const r=JSON.parse(await page.locator('#request').inputValue());r.transaction.inputs=[];r.transaction.outputs=[];r.transaction.outputs_data=[];r.transaction.cell_deps=[];r.context.cells=[];r.custom={keep:9};await page.locator('#request').fill(JSON.stringify(r));await page.locator('#advanced summary').click();await page.getByRole('button',{name:'Manage cell deps',exact:true}).click();await page.getByRole('button',{name:'New resolved cell',exact:true}).click();await page.getByLabel('Cell dep 1 capacity (CKB)',{exact:true}).fill('100');await page.getByLabel('Cell dep 1 data (hex)',{exact:true}).fill('0xaabb');await page.getByText('Cell dep 1 lock code reference',{exact:true}).click();const group=page.getByRole('radiogroup',{name:'Cell dep 1 lock hash_type',exact:true});await group.getByRole('radio',{name:'type',exact:true}).click();await expect(group.getByRole('radio',{name:'type',exact:true})).toHaveAttribute('aria-checked','true');await done(page);const next=JSON.parse(await page.locator('#request').inputValue());expect(next.transaction.inputs).toEqual([]);expect(next.context.cells[0].data).toBe('0xaabb');expect(next.context.cells[0].output.lock.hash_type).toBe('type');expect(next.custom).toEqual({keep:9});expect(next.transaction.cell_deps[0].out_point).toEqual(next.context.cells[0].out_point);
});
test('unknown hash types survive inspection and radio keyboard selection is explicit',async({page})=>{
 await ready(page);await page.locator('#advanced summary').click();const r=JSON.parse(await page.locator('#request').inputValue());r.transaction.outputs[0].lock.hash_type='future';await page.locator('#request').fill(JSON.stringify(r));await edit(page,'output');await expect(page.locator('dialog')).toContainText('Unrecognized hash type: future');expect(JSON.parse(await page.locator('#request').inputValue()).transaction.outputs[0].lock.hash_type).toBe('future');await page.getByText('Output 1 lock code reference',{exact:true}).click();const first=page.getByRole('radio',{name:'data',exact:true});await first.focus();await first.press('ArrowRight');await expect(page.getByRole('radio',{name:'data1',exact:true})).toHaveAttribute('aria-checked','true');await done(page);
});

test('input and dep editors share a resolved cell and dep-group changes preserve bytes',async({page})=>{
 await ready(page);await page.locator('#advanced summary').click();let r=JSON.parse(await page.locator('#request').inputValue());r.transaction.cell_deps[0].out_point=structuredClone(r.transaction.inputs[0].previous_output);await page.locator('#request').fill(JSON.stringify(r));await page.locator('#advanced summary').click();await page.getByRole('button',{name:'Manage cell deps',exact:true}).click();await page.getByRole('button',{name:'Edit cell dep 1',exact:true}).click();await page.getByLabel('Cell dep 1 data (hex)',{exact:true}).fill('0xaabb');await page.getByLabel('Cell dep 1 kind',{exact:true}).selectOption('dep_group');await done(page);await expect(page.getByRole('button',{name:'Cell dep 1 · dep_group · open details',exact:true})).toBeFocused();await edit(page,'input');await expect(page.getByLabel('Input 1 data (hex)',{exact:true})).toHaveValue('0xaabb');await done(page);r=JSON.parse(await page.locator('#request').inputValue());expect(r.context.cells[0].data).toBe('0xaabb');expect(r.transaction.cell_deps[0].out_point).toEqual(r.transaction.inputs[0].previous_output);
});

test('large JSON numbers survive structured edits, export and verification without rounding', async ({page})=>{
 await ready(page);await page.locator('#advanced summary').click();
 const input=page.locator('#request');const original=await input.inputValue();
 const edited=original.replace(/^\s*\{/, '{"unknown_large":9007199254740993,"unknown_decimal":0.1234567890123456789,"unknown_text":"9007199254740993",');
 await input.fill(edited);await edit(page,'input');await page.getByLabel('Input 1 capacity (CKB)',{exact:true}).fill('1001');await done(page);
 const after=await input.inputValue();expect(after).toContain('"unknown_large": 9007199254740993');expect(after).toContain('"unknown_decimal": 0.1234567890123456789');expect(after).toContain('"unknown_text": "9007199254740993"');
 await page.locator('.example-menu summary').click();const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Export JSON'}).click();const download=await pending;const stream=await download.createReadStream();let exported='';for await (const chunk of stream)exported+=chunk.toString();expect(exported).toContain('"unknown_large": 9007199254740993');
 await page.getByRole('button',{name:'Run verification'}).click();await expect(page.locator('#status')).toHaveText(/^(Passed snapshot|Rejected)$/);await expect(input).toHaveValue(after);
});

test('cancel restores an editor session including new deps and exact unknown numbers',async({page})=>{
 await ready(page);await page.locator('#advanced summary').click();const input=page.locator('#request');const base=(await input.inputValue()).replace(/^\s*\{/, '{"exact":9007199254740993,');await input.fill(base);
 const id=await page.locator('.cell-column').nth(1).locator('.cell-row').first().getAttribute('data-cell-id');await edit(page,'output');await page.getByLabel('Output 1 capacity (CKB)',{exact:true}).fill('61');await page.getByRole('button',{name:'Cancel changes',exact:true}).click();expect(await input.inputValue()).toBe(base);expect(await page.locator('.cell-column').nth(1).locator('.cell-row').first().getAttribute('data-cell-id')).toBe(id);
 await page.getByRole('button',{name:'Manage cell deps'}).click();await page.getByRole('button',{name:'New resolved cell'}).click();await page.getByLabel('Cell dep 2 capacity (CKB)',{exact:true}).fill('invalid');await page.getByRole('button',{name:'Cancel changes',exact:true}).click();expect(await input.inputValue()).toBe(base);
 await edit(page,'output');await page.getByLabel('Output 1 capacity (CKB)',{exact:true}).fill('62');await page.keyboard.press('Escape');expect(await input.inputValue()).toBe(base);
});

test('loading an example asks before replacing edits and honors both answers',async({page})=>{
 await ready(page);await page.locator('#advanced summary').click();const input=page.locator('#request');const before=(await input.inputValue()).replace(/^\s*\{/, '{"keep":9007199254740993,');await input.fill(before);await page.locator('.example-menu summary').click();await page.locator('#sample').selectOption('valid');
 page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'Load sample'}).click();expect(await input.inputValue()).toBe(before);
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Load sample'}).click();await expect(page.locator('#status')).toHaveText('Ready');expect(await input.inputValue()).not.toBe(before);
});

test('mobile long capacity remains whole and overview labels reflect actual indices and kinds',async({page})=>{
 await page.setViewportSize({width:400,height:583});await ready(page);await page.locator('#advanced summary').click();const input=page.locator('#request');const r=JSON.parse(await input.inputValue());r.transaction.outputs[0].capacity='0xffffffffffffffff';r.transaction.witnesses=['0x'];await input.fill(JSON.stringify(r));await page.locator('#advanced summary').click();
 const amount=page.locator('.capacity-long').first();await expect(amount).toHaveText('184467440737.09551615 CKB');expect(await amount.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await expect(page.getByRole('button',{name:'Witness 0 · open details'})).toHaveText('0');await expect(page.getByRole('button',{name:/Cell dep 1 · code/})).toContainText('code');await edit(page,'output');await page.getByText('Output 1 type · none').click();await expect(page.getByRole('button',{name:'Add Output 1 type',exact:true})).toBeVisible();
});

test('visible build link identifies the build commit',async({page})=>{
 await ready(page);const build=page.locator('#build-version');
 if(process.env.GITHUB_SHA){await expect(build).toHaveText(/^Build [0-9a-f]{10}$/);await expect(build).toHaveAttribute('href',`https://github.com/Hanssen0-Alter-Ego/ckb-vm-js/commit/${process.env.GITHUB_SHA}`);}else await expect(build).toBeHidden();
});

test('import asks before replacing edited JSON',async({page})=>{
 await ready(page);await page.locator('#advanced summary').click();const input=page.locator('#request');const before=(await input.inputValue()).replace(/^\s*\{/, '{"keep":9007199254740993,');await input.fill(before);
 page.once('dialog',dialog=>dialog.dismiss());await page.locator('#upload').setInputFiles({name:'transaction.json',mimeType:'application/json',buffer:Buffer.from('{"transaction":{},"context":{"cells":[]}}')});expect(await input.inputValue()).toBe(before);
});
