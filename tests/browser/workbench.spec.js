import { test, expect } from '@playwright/test';
const ready=async page=>{await page.goto('/ckb-vm-js/');await expect(page.locator('#status')).toHaveText('Ready');};
const edit=async(page,kind,i=1)=>page.getByRole('button',{name:`Edit ${kind} ${i}`,exact:true}).click();
const done=async page=>page.getByRole('button',{name:'Done',exact:true}).click();
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
 await page.getByRole('button',{name:/Witnesses ·/}).click();await page.getByRole('button',{name:'Add witness',exact:true}).click();await expect(page.getByLabel('Witness 0 (hex)',{exact:true})).toBeVisible();await done(page);
 await page.locator('#request').fill('{bad');await expect(page.locator('#workbench')).toContainText('Structured editor unavailable');await page.locator('#request').fill(JSON.stringify(r));
 await page.getByRole('button',{name:'Add synthetic input',exact:true}).click();const added=JSON.parse(await page.locator('#request').inputValue());expect(added.transaction.inputs).toHaveLength(2);expect(added.context.cells.at(-1).transaction_info).toBeNull();expect(errors).toEqual([]);
});
test('mobile overview fits one screen, details retain invalid drafts and Escape returns focus',async({page})=>{
 await page.setViewportSize({width:390,height:844});await ready(page);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(await page.locator('#run').evaluate(e=>e.getBoundingClientRect().bottom)).toBeLessThan(844);
 await edit(page,'input');await page.getByText('Input 1 lock',{exact:true}).click();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Edit input 1',exact:true})).toBeFocused();
 await edit(page,'output');const field=page.getByLabel('Output 1 capacity (CKB)',{exact:true});await field.fill('oops');await field.press('Tab');await page.keyboard.press('Escape');await expect(page.locator('dialog')).toBeVisible();expect(await field.evaluate(e=>e.validity.valid)).toBe(false);await field.fill('999');await field.press('Tab');await done(page);
 await page.locator('#advanced summary').click();let r=JSON.parse(await page.locator('#request').inputValue());r.transaction.inputs=[null];await page.locator('#request').fill(JSON.stringify(r));await expect(page.locator('#workbench')).toContainText('Needs attention');expect(JSON.parse(await page.locator('#request').inputValue()).transaction.inputs).toEqual([null]);
});
test('numbered dependencies, settings and many-cell browse are reachable without data loss',async({page})=>{
 await ready(page);await page.getByRole('button',{name:/Dependency 1 ·/}).click();await expect(page.locator('dialog')).toContainText('Dependency 1');await done(page);await page.getByRole('button',{name:'Manage dependencies',exact:true}).click();await expect(page.getByLabel('Resolved cell to add as dependency')).toBeVisible();await done(page);
 await page.locator('#advanced summary').click();let r=JSON.parse(await page.locator('#request').inputValue());r.transaction.outputs=Array.from({length:12},()=>structuredClone(r.transaction.outputs[0]));r.transaction.outputs_data=Array(12).fill('0x');await page.locator('#request').fill(JSON.stringify(r));await page.locator('#advanced summary').click();
 await expect(page.getByRole('button',{name:/Edit output/})).toHaveCount(4);await page.getByRole('button',{name:'Browse all 12 cells'}).click();await expect(page.getByRole('button',{name:/Edit output/})).toHaveCount(12);await edit(page,'output',12);await done(page);await page.getByRole('button',{name:'Show first 4'}).click();expect(JSON.parse(await page.locator('#request').inputValue()).transaction.outputs).toHaveLength(12);
});

test('overview screenshots and direct Done commit',async({page})=>{
 await ready(page);await page.screenshot({path:'test-results/overview-desktop.png',fullPage:true});
 await edit(page,'output');const f=page.getByLabel('Output 1 capacity (CKB)',{exact:true});await f.fill('999');await done(page);await expect(page.locator('dialog')).not.toBeVisible();expect(BigInt(JSON.parse(await page.locator('#request').inputValue()).transaction.outputs[0].capacity)).toBe(99900000000n);
 await edit(page,'output');await page.screenshot({path:'test-results/overview-inspector.png',fullPage:true});await done(page);
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/overview-mobile.png',fullPage:true});
});
