import test from 'node:test';
import assert from 'node:assert/strict';
import { ckbToHex, ckb, guidedRequest, explain, verifiedGroupSummary, requestedScope } from '../../web/guided.js';
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
  assert.match(explain({ok:false,error:{code:'ValidationFailure'}}),/script rejected/i);
  assert.match(explain({ok:false,error:{code:'Other'}}),/engine error is shown below/);
  assert.match(explain({ok:true,scope:'script_group'}),/were not checked/);
  assert.doesNotMatch(explain({ok:true,scope:'transaction',fee:'0x1'}),/CKB/);
});


test('missing extension explanation identifies the actual header without guessing null',()=>{
 const hash=`0x${'ab'.repeat(32)}`;const result={ok:false,error:{code:'MissingContext',message:`explicit extension data or null required for ${hash}`}};const explanation=explain(result,{transaction:{header_deps:[hash]}});assert.match(explanation,/Header dep index 0/);assert.ok(explanation.includes(hash));assert.match(explanation,/Unspecified does not mean no extension/);assert.match(explain(result,{transaction:{header_deps:[]}}),/supplied cell origin/);assert.match(explain({ok:false,error:{code:'Other',message:result.error.message}}),/engine error is shown below/);
});


test('invalid dep group maps the encoded outpoint only to matching group references',()=>{
 const hash='ab'.repeat(32),message=`InvalidDepGroup(OutPoint(0x${hash}02000000))`,result={ok:false,error:{code:'Resolution',message}};const request={transaction:{cell_deps:[{dep_type:'code',out_point:{tx_hash:`0x${hash}`,index:'0x2'}},{dep_type:'dep_group',out_point:{tx_hash:`0x${hash}`,index:'0x2'}}]}};assert.match(explain(result,request),/Cell dep index 1/);assert.doesNotMatch(explain(result,request),/Cell dep index 0/);assert.match(explain(result,{transaction:{cell_deps:[]}}),/outpoint 0x/);assert.match(explain({ok:false,error:{code:'Other',message}},request),/engine error is shown below/);
});


test('script failure reports only a recognized source and exit code',()=>{
 const result={ok:false,error:{code:'InvalidTransaction',message:'Script(TransactionScriptError { source: Inputs[0].Lock, cause: ValidationFailure: see error code -1 on page https://example.invalid/#-1 })'}};assert.match(explain(result),/Inputs\[0\]\.Lock, error code -1/);assert.doesNotMatch(explain({...result,error:{...result.error,message:result.error.message.replace('Inputs[0].Lock','Unknown[0].Lock')}}),/Unknown\[0\]/);assert.doesNotMatch(explain({...result,error:{...result.error,code:'Other'}}),/Inputs\[0\]/);
});


test('verified group display filters both type and hash, and refuses unavailable results',()=>{
 const hash=`0x${'ab'.repeat(32)}`;const lock={group_type:'lock',script_hash:hash,input_indices:[0],output_indices:[]};const type={group_type:'type',script_hash:hash,input_indices:[],output_indices:[0]};const request={transaction:{inputs:[{}],outputs:[{}]},script_group:{group_type:'lock',script_hash:hash}};const result={ok:true,scope:'script_group',groups:[lock,type]};assert.equal(verifiedGroupSummary(result,request).text,'Lock group — Inputs: index 0; Outputs: none.');request.script_group.group_type='type';assert.equal(verifiedGroupSummary(result,request).text,'Type group — Inputs: none; Outputs: index 0.');assert.match(verifiedGroupSummary({...result,groups:[lock]},request).text,/unavailable/);assert.match(verifiedGroupSummary({...result,groups:[{...type,output_indices:[1]}]},request).text,/unavailable/);assert.equal(verifiedGroupSummary({ok:false,groups:[lock]},request),null);assert.equal(verifiedGroupSummary({ok:true,groups:[lock]},request),null);assert.match(explain({ok:true}),/did not report/);const full=verifiedGroupSummary({...result,scope:'transaction'},request);assert.match(full.text,/Lock group/);assert.match(full.text,/Type group/);assert.equal(full.selected,false);
});


test('missing selected script group gives actionable guidance',()=>{
 const result={ok:false,error:{code:'Script',message:'ScriptNotFound: code_hash: Byte32(0x'+'00'.repeat(32)+')'}};assert.match(explain(result),/choose a listed group/i);assert.match(explain(result),/not the code hash/i);assert.match(explain({...result,error:{code:'Other',message:result.error.message}}),/engine error is shown below/);
});


test('requested scope is reported independently of engine success',()=>{
 const hash=`0x${'ab'.repeat(32)}`;
 assert.equal(requestedScope({}),'Full transaction');
 assert.equal(requestedScope({script_group:null}),'Full transaction');
 assert.equal(requestedScope({script_group:{group_type:'lock',script_hash:hash}}),`Lock script group — script hash: ${hash}`);
 assert.equal(requestedScope({script_group:{group_type:'type',script_hash:'0x12'}}),'Type script group — script hash: 0x12');
 assert.match(requestedScope({script_group:[]}),/Invalid script group/);
 assert.match(requestedScope({script_group:{group_type:'other'}}),/Unrecognized.*missing/);
});

test('invalid request length explanation reports only the engine-provided detail',()=>{
 const message='invalid length 2, expected a 0x-prefixed hex string with 64 digits at line 1 column 3485';
 const result={ok:false,error:{code:'InvalidRequest',message}};
 assert.match(explain(result),/2 hex digits.*64 \(32 bytes\)/);
 assert.match(explain(result),/did not identify the field/);
 assert.doesNotMatch(explain(result),/script hash/i);
 assert.doesNotMatch(explain({...result,error:{...result.error,code:'Other'}}),/2 hex digits/);
 assert.doesNotMatch(explain({...result,error:{...result.error,message:message.replace('64 digits','40 digits')}}),/2 hex digits/);
});

test('only exact official script error documentation is linked', async () => {
  const { scriptErrorDocumentation } = await import('../../web/guided.js');
  const url = `https://nervosnetwork.github.io/ckb-script-error-codes/by-data-hash/${'a'.repeat(64)}.html#-1`;
  const error = {code:'InvalidTransaction',message:`Script(TransactionScriptError { source: Inputs[0].Lock, cause: ValidationFailure: see error code -1 on page ${url} })`};
  assert.equal(scriptErrorDocumentation(error), url);
  for (const bad of [url.replace('https:', 'http:'), url.replace('github.io/', 'github.io.evil.example/'), url+'?x=1', url.replace('#-1','#2'), 'javascript:alert(1)', url.replace('nervosnetwork.github.io','user@nervosnetwork.github.io')]) {
    assert.equal(scriptErrorDocumentation({...error,message:error.message.replace(url,bad)}), null);
  }
  assert.equal(scriptErrorDocumentation({...error,code:'Other'}),null);
  assert.equal(scriptErrorDocumentation({...error,message:'see '+url}),null);
  assert.doesNotMatch(explain({ok:true,scope:'transaction',fee:'0x0'}), /Fee in this snapshot/);
});
