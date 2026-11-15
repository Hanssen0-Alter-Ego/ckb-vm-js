import { test, expect } from '@playwright/test';
test('structured edits, JSON round trips and recovery preserve unrelated fields',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/ckb-vm-js/');await expect(page.locator('#status')).toHaveText('Ready');
 await expect(page.getByLabel('Input 1 capacity (CKB)',{exact:true})).toHaveValue('1000');
 await page.getByRole('button',{name:'Add output',exact:true}).click();
 await expect(page.getByLabel('Output 2 capacity (CKB)',{exact:true})).toBeVisible();
 await page.getByLabel('Output 2 capacity (CKB)',{exact:true}).fill('61');await page.getByLabel('Output 2 capacity (CKB)',{exact:true}).press('Tab');
 let r=JSON.parse(await page.locator('#request').inputValue());expect(r.transaction.outputs).toHaveLength(2);expect(BigInt(r.transaction.outputs[1].capacity)).toBe(6100000000n);
 await page.locator('#advanced summary').click();r.extension={keep:['a',123]};r.transaction.outputs[0].capacity='0x16b5b01200';await page.locator('#request').fill(JSON.stringify(r));
 await page.getByLabel('Output 1 capacity (CKB)',{exact:true}).fill('500');await page.getByLabel('Output 1 capacity (CKB)',{exact:true}).press('Tab');
 expect(JSON.parse(await page.locator('#request').inputValue()).extension).toEqual({keep:['a',123]});
 await page.getByRole('button',{name:'Add witness',exact:true}).click();await expect(page.getByLabel('Witness 0 (hex)',{exact:true})).toBeVisible();
 await page.locator('#request').fill('{bad');await expect(page.locator('#workbench')).toContainText('Structured editor unavailable');
 await page.locator('#request').fill(JSON.stringify(r));await expect(page.getByLabel('Output 1 capacity (CKB)',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Add synthetic input',exact:true}).click();let added=JSON.parse(await page.locator('#request').inputValue());expect(added.transaction.inputs).toHaveLength(2);expect(added.context.cells.at(-1).transaction_info).toBeNull();
 expect(errors).toEqual([]);
});
test('malformed entries retain JSON; invalid CKB does not export stale input; mobile fits',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/ckb-vm-js/');await expect(page.locator('#status')).toHaveText('Ready');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByText('Input 1 lock',{exact:true}).click();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByLabel('Output 1 capacity (CKB)',{exact:true}).fill('oops');await page.getByLabel('Output 1 capacity (CKB)',{exact:true}).press('Tab');
 expect(await page.getByLabel('Output 1 capacity (CKB)',{exact:true}).evaluate(e=>e.validity.valid)).toBe(false);
 await page.locator('#advanced summary').click();let r=JSON.parse(await page.locator('#request').inputValue());r.transaction.inputs=[null];await page.locator('#request').fill(JSON.stringify(r));await expect(page.locator('#workbench')).toContainText('Invalid cell entry');expect(JSON.parse(await page.locator('#request').inputValue()).transaction.inputs).toEqual([null]);
});
