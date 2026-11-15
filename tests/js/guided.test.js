import test from 'node:test';
import assert from 'node:assert/strict';
import { ckbToHex, ckb, guidedRequest, explain } from '../../web/guided.js';
test('guided CKB decimals are lossless beyond Number safe integer range', () => {
  for (const value of ['0', '0.00000001', '999.00000001']) {
    assert.equal(ckb(ckbToHex(value)), value);
  }
  assert.equal(ckbToHex('99999999999.99999999'), '0x8ac7230489e7ffff');
  assert.equal(ckb(ckbToHex('99999999999.99999999')), '99999999999.99999999');
  for(const value of ['', '-1', '1e3', '0x100', '1.000000001', 'NaN', '1,000']) assert.throws(()=>ckbToHex(value));
});
test('guided mutation does not overwrite fixture or other context', () => {
  const base={transaction:{outputs:[{capacity:'0x0',lock:{args:'0x'}}]},context:{marker:1}};
  const changed=guidedRequest(base,'999','100');
  assert.equal(base.transaction.outputs[0].capacity,'0x0');
  assert.equal(changed.max_cycles,'0x64');
  assert.deepEqual(changed.context,base.context);
  assert.throws(()=>guidedRequest(base,'1','invalid'));
});
test('explanations follow returned engine results rather than chosen experiment', () => {
  assert.match(explain({ok:false,error:{code:'InvalidTransaction',message:'OutputsSumOverflow'}}),/cannot create extra/);
  assert.match(explain({ok:false,error:{code:'InvalidTransaction',message:'ExceededMaximumCycles'}}),/budget ran out/);
  assert.match(explain({ok:true,scope:'script_group'}),/were not checked/);
  assert.match(explain({ok:true,scope:'transaction',fee:'0x1'}),/0.00000001 CKB/);
});
