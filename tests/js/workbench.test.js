import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveCell, scriptChoices, scriptHash, scriptGroupCandidates, inspectRequest, diagnosticMatchesCell, mutateCellList } from '../../web/workbench-model.js';
const fixture = JSON.parse(await readFile(new URL('../../fixtures/submitted-valid.json', import.meta.url), 'utf8')).request;
const request = () => structuredClone(fixture);

test('inspection calculates exact CKB without mutating a fixture', () => {
  const req = request(); const before = JSON.stringify(req);
  assert.deepEqual(inspectRequest(req), { diagnostics: [], inputTotal: '1000', outputTotal: '1000' });
  assert.equal(JSON.stringify(req), before);
  req.transaction.outputs[0].capacity = '0x1';
  assert.equal(inspectRequest(req).outputTotal, '0.00000001');
});

test('resolution handles equivalent hash case and rejects ambiguous context', () => {
  const req = request(); const point = req.transaction.inputs[0].previous_output;
  assert.equal(resolveCell(req, point), req.context.cells[0]);
  req.context.cells.push(structuredClone(req.context.cells[0]));
  assert.equal(resolveCell(req, point), undefined);
  assert.equal(inspectRequest(req).inputTotal, null);
  assert.ok(inspectRequest(req).diagnostics.some(x => x.message.includes('ambiguous')));
  assert.equal(resolveCell(req, {}), undefined);
});

test('script choices are semantic, cloned and preserve unknown fields', () => {
  const req = request(); req.transaction.outputs[0].lock.label = 'keep me';
  const choices = scriptChoices(req);
  assert.equal(choices.length, 1);
  assert.equal(choices[0].label, 'keep me');
  choices[0].args = '0xff';
  assert.equal(req.transaction.outputs[0].lock.args, '0x');
});

test('output duplication, movement and removal keep output data aligned', () => {
  let req = request(); req.transaction.outputs[0].custom = { x: 1 }; req.transaction.outputs_data[0] = '0xaa';
  const before = JSON.stringify(req);
  let result = mutateCellList(req, 'outputs', 'duplicate');
  assert.equal(JSON.stringify(req), before);
  assert.deepEqual(result.transaction.outputs_data, ['0xaa', '0xaa']);
  assert.deepEqual(result.transaction.outputs[1].custom, { x: 1 });
  result.transaction.outputs_data[1] = '0xbb';
  result.transaction.outputs[1].capacity = '0x1';
  result = mutateCellList(result, 'outputs', 'up', 1);
  assert.equal(result.transaction.outputs[0].capacity, '0x1');
  assert.deepEqual(result.transaction.outputs_data, ['0xbb', '0xaa']);
  result = mutateCellList(result, 'outputs', 'remove', 0);
  assert.deepEqual(result.transaction.outputs_data, ['0xaa']);
  assert.deepEqual(result.transaction.outputs[0], req.transaction.outputs[0]);
});

test('list edits preserve unknown request fields and malformed unrelated fields', () => {
  const req = request(); req.extra = { future: true }; req.transaction.witnesses = ['intentionally invalid'];
  req.context.headers = 'intentionally invalid';
  const result = mutateCellList(req, 'outputs', 'add');
  assert.deepEqual(result.extra, req.extra);
  assert.deepEqual(result.transaction.witnesses, req.transaction.witnesses);
  assert.equal(result.context.headers, 'intentionally invalid');
});

test('synthetic input copies use unique references without claiming chain origin', () => {
  const req = request(); req.transaction.inputs[0].custom = 'retained'; req.context.cells[0].future = { keep: true };
  req.transaction.inputs[0].since = '0x123'; req.transaction.witnesses = ['0xff'];
  const result = mutateCellList(mutateCellList(req, 'inputs', 'duplicate'), 'inputs', 'add');
  assert.equal(result.transaction.inputs.length, 3);
  const points = result.transaction.inputs.map(input => JSON.stringify(input.previous_output));
  assert.equal(new Set(points).size, 3);
  for (const input of result.transaction.inputs.slice(1)) {
    const cell = resolveCell(result, input.previous_output);
    assert.equal(input.since, '0x0'); assert.equal(input.custom, 'retained');
    assert.equal(cell.transaction_info, null); assert.deepEqual(cell.future, { keep: true });
  }
  assert.deepEqual(result.transaction.witnesses, ['0xff']);
  assert.equal(req.transaction.inputs.length, 1);
});

test('removing and moving inputs do not guess witness association or garbage-collect context', () => {
  let req = mutateCellList(request(), 'inputs', 'duplicate'); req.transaction.witnesses = ['0xaa', '0xbb'];
  const cells = structuredClone(req.context.cells); const points = req.transaction.inputs.map(input => input.previous_output);
  req = mutateCellList(req, 'inputs', 'down', 0);
  assert.deepEqual(req.transaction.inputs[0].previous_output, points[1]);
  assert.deepEqual(req.transaction.witnesses, ['0xaa', '0xbb']);
  req = mutateCellList(req, 'inputs', 'remove', 0);
  assert.deepEqual(req.context.cells, cells);
});

test('structurally irregular imported data is reported and never repaired by list edits', () => {
  const req = request(); req.transaction.outputs_data = [];
  assert.throws(() => mutateCellList(req, 'outputs', 'add'), /will not silently repair/);
  assert.equal(req.transaction.outputs_data.length, 0);
  assert.ok(inspectRequest(req).diagnostics.some(x => x.path === 'transaction.outputs_data'));
  assert.throws(() => mutateCellList({}, 'inputs', 'add'), /must be an array/);
  assert.throws(() => mutateCellList(request(), 'outputs', 'up', 0), /cannot move/);
  assert.throws(() => mutateCellList(request(), 'outputs', 'remove', -1), /no longer exists/);
});

test('missing source context prevents copying; empty input list can use an output template', () => {
  const req = request(); req.context.cells = [];
  assert.throws(() => mutateCellList(req, 'inputs', 'duplicate'), /no unique resolved cell/);
  req.transaction.inputs = [];
  const added = mutateCellList(req, 'inputs', 'add');
  assert.equal(added.transaction.inputs.length, 1);
  assert.equal(added.context.cells[0].transaction_info, null);
});

test('diagnostics identify input, script, dependency and byte errors while preserving data', () => {
  const req = request(); req.transaction.inputs.push(structuredClone(req.transaction.inputs[0]));
  req.transaction.outputs[0].lock.args = '0xf'; req.transaction.witnesses = ['0xz'];
  req.transaction.cell_deps[0].out_point.tx_hash = '0x' + 'ff'.repeat(32);
  const before = JSON.stringify(req); const result = inspectRequest(req);
  for (const term of ['already spent', 'even-length', 'dependency']) assert.ok(result.diagnostics.some(x => x.message.includes(term)));
  assert.equal(JSON.stringify(req), before);
});

test('inspection tolerates arbitrary JSON structure without throwing', () => {
  for (const value of [null, [], 'x', {}, {transaction: {inputs: [null], outputs:[null], cell_deps:[null]}, context:{cells:[null]}}]) {
    assert.doesNotThrow(() => inspectRequest(value));
    assert.doesNotThrow(() => scriptChoices(value));
  }
});

test('workbench capacities cover the full unsigned 64-bit range', async () => {
  const { ckb, ckbToHex } = await import('../../web/guided.js');
  assert.equal(ckbToHex(ckb('0xffffffffffffffff')), '0xffffffffffffffff');
  assert.throws(() => ckbToHex('184467440737.09551616'), /too large/);
});

test('decimal RPC editing retains uint64 precision and rejects partial/overflow drafts',async()=>{
 const {decimalToRpc,rpcToDecimal}=await import('../../web/workbench-model.js');
 for(const n of ['0','10000000','9007199254740993','18446744073709551615'])assert.equal(rpcToDecimal(decimalToRpc(n)),n);
 for(const n of ['','-1','1.2','1e4',' 2','18446744073709551616'])assert.throws(()=>decimalToRpc(n));
 assert.equal(rpcToDecimal('bad'),'bad');
});
test('independent code-cell creation needs no input and preserves existing references',async()=>{
 const {addDependencyCell}=await import('../../web/workbench-model.js');let r=request();r.transaction.inputs=[];r.transaction.outputs=[];r.transaction.outputs_data=[];r.context.cells=[];r.transaction.cell_deps=[];r.unknown={keep:true};
 const next=addDependencyCell(r);assert.equal(next.transaction.inputs.length,0);assert.equal(next.context.cells.length,1);assert.equal(next.context.cells[0].transaction_info,null);assert.deepEqual(next.transaction.cell_deps[0].out_point,next.context.cells[0].out_point);assert.deepEqual(next.unknown,r.unknown);assert.deepEqual(r.context.cells,[]);
});

test('script names are pinned to fixture code references, not guessed hash types',async()=>{
 const {scriptName}=await import('../../web/workbench-model.js');assert.equal(scriptName(request().transaction.outputs[0].lock),'Always success');const failure=JSON.parse(await readFile(new URL('../../fixtures/script-failure.json',import.meta.url),'utf8')).request;assert.equal(scriptName(failure.transaction.outputs[0].lock),'Always failure');assert.match(scriptName({...request().transaction.outputs[0].lock,hash_type:'type'}),/Custom \/ Unknown/);assert.match(scriptName({code_hash:'0x1234',hash_type:'data2'}),/Custom \/ Unknown 1234/);
});

test('dependency reference changes update shared references without losing unknown fields',async()=>{
 const {changeDependencyReference}=await import('../../web/workbench-model.js');const r=request();r.transaction.cell_deps[0].out_point=structuredClone(r.transaction.inputs[0].previous_output);r.transaction.inputs[0].previous_output.extra='input';r.transaction.cell_deps[0].out_point.extra='dep';r.context.cells[0].out_point.extra='cell';r.custom={keep:'unchanged'};
 const point={tx_hash:`0x${'ab'.repeat(32)}`,index:'0x2'};const changed=changeDependencyReference(r,0,point);
 assert.equal(changed.transaction.inputs[0].previous_output.tx_hash,point.tx_hash);assert.equal(changed.transaction.cell_deps[0].out_point.index,'0x2');assert.equal(changed.context.cells[0].out_point.tx_hash,point.tx_hash);assert.equal(changed.transaction.inputs[0].previous_output.extra,'input');assert.equal(changed.transaction.cell_deps[0].out_point.extra,'dep');assert.equal(changed.context.cells[0].out_point.extra,'cell');assert.deepEqual(changed.custom,r.custom);assert.notEqual(r.transaction.inputs[0].previous_output.tx_hash,point.tx_hash);
 assert.throws(()=>changeDependencyReference(r,0,{tx_hash:'0x12',index:'0x0'}),/32-byte/);assert.throws(()=>changeDependencyReference(r,0,{tx_hash:point.tx_hash,index:'0x100000000'}),/32-bit/);assert.throws(()=>changeDependencyReference(r,0,r.context.cells[1].out_point),/already uses/);
 const broken=request();broken.transaction.cell_deps[0].out_point={tx_hash:'intentionally bad',index:'0x0',extra:'keep'};const rebound=changeDependencyReference(broken,0,broken.context.cells[0].out_point);assert.equal(rebound.transaction.cell_deps[0].out_point.extra,'keep');assert.equal(broken.transaction.cell_deps[0].out_point.tx_hash,'intentionally bad');
});

test('header hash matches CKB-generated fixture and rejects malformed fields',async()=>{
 const {headerHash}=await import('../../web/header-hash.js');const r=request();assert.equal(headerHash(r.context.tip_header),r.context.cells[0].transaction_info.block_hash);assert.throws(()=>headerHash({...r.context.tip_header,nonce:'0x100000000000000000000000000000000'}),/128 bits/);assert.throws(()=>headerHash({...r.context.tip_header,parent_hash:'0x00'}),/32-byte/);assert.throws(()=>headerHash({...r.context.tip_header,version:'0x00'}),/canonical/);
 const published={compact_target:'0x1e083126',dao:'0xb5a3e047474401001bc476b9ee573000c0c387962a38000000febffacf030000',epoch:'0x7080018000001',nonce:'0x0',number:'0x400',parent_hash:'0xae003585fa15309b30b31aed3dcf385e9472c3c3e93746a6c4540629a6a1ed2d',proposals_hash:`0x${'00'.repeat(32)}`,timestamp:'0x5cd2b117',transactions_root:'0xc47d5b78b3c4c4c853e2a32810818940d0ee403423bea9ec7b8e566d9595206c',extra_hash:`0x${'00'.repeat(32)}`,version:'0x0'};
 assert.equal(headerHash(published),'0xa5f5c85987a15de25661e5a214f2c1449cd803f071acc7999820f25246471f40');
});

test('header creation and linking calculate hashes without rewriting supplied context',async()=>{
 const {headerHash}=await import('../../web/header-hash.js');const {headerCandidates,linkExistingHeader,addHeaderFromFields}=await import('../../web/header-model.js');const r=request();r.custom={large:'keep'};const tipHash=headerHash(r.context.tip_header);const linked=linkExistingHeader(r,r.context.tip_header);assert.deepEqual(linked.transaction.header_deps,[tipHash]);assert.deepEqual(linked.context.headers,[]);assert.deepEqual(r.transaction.header_deps,[]);
 const draft=structuredClone(r.context.tip_header);draft.number='0x65';draft.future={keep:'unknown'};const hash=headerHash(draft);const created=addHeaderFromFields(r,draft,{extension:'none'});assert.deepEqual(created.transaction.header_deps,[hash]);assert.deepEqual(created.context.headers,[draft]);assert.equal(created.context.extensions.at(-1).block_hash,hash);assert.equal(created.context.extensions.at(-1).data,null);assert.deepEqual(created.custom,r.custom);assert.equal(headerCandidates(created).find(x=>x.source==='Supplied header 1').hash,hash);
 const edited=structuredClone(draft);edited.number='0x66';const second=addHeaderFromFields(created,edited,{replaceIndex:0});assert.equal(second.transaction.header_deps[0],headerHash(edited));assert.deepEqual(second.context.headers,[draft,edited]);assert.equal(second.context.extensions.at(-1).block_hash,hash);assert.deepEqual(created.context.headers,[draft]);assert.deepEqual(addHeaderFromFields(r,r.context.tip_header).transaction.header_deps,[tipHash]);assert.throws(()=>addHeaderFromFields(r,{...draft,nonce:'invalid'}),/canonical/);assert.throws(()=>addHeaderFromFields(r,draft,{extension:'bytes',extensionData:'0xf'}),/even-length/);assert.deepEqual(r.context.headers,[]);
});

test('explicit header extension edits preserve unknown fields and reject ambiguity',async()=>{
 const {setHeaderExtension}=await import('../../web/header-model.js');const r=request();const hash=r.context.extensions[0].block_hash;r.context.extensions[0].extra={keep:1};const changed=setHeaderExtension(r,hash,'bytes','0xabcd');assert.equal(changed.context.extensions[0].data,'0xabcd');assert.deepEqual(changed.context.extensions[0].extra,{keep:1});assert.equal(r.context.extensions[0].data,null);assert.throws(()=>setHeaderExtension(r,hash,'bytes','0xa'),/even-length/);r.context.extensions.push(structuredClone(r.context.extensions[0]));assert.throws(()=>setHeaderExtension(r,hash,'none'),/Multiple extension/);
});

test('linking an existing header rejects duplicate computed hashes',async()=>{
 const {linkExistingHeader}=await import('../../web/header-model.js');const r=request();r.context.headers.push(structuredClone(r.context.tip_header));assert.throws(()=>linkExistingHeader(r,r.context.tip_header),/ambiguous/);assert.deepEqual(r.transaction.header_deps,[]);
});


test('input reference updates all aliases without losing metadata or fetching origin',async()=>{
 const {changeInputReference}=await import('../../web/workbench-model.js');const r=request();r.transaction.cell_deps[0].out_point=structuredClone(r.transaction.inputs[0].previous_output);r.transaction.inputs[0].previous_output.extra='input';r.transaction.cell_deps[0].out_point.extra='dep';r.context.cells[0].out_point.extra='cell';const origin=structuredClone(r.context.cells[0].transaction_info);const point={tx_hash:`0x${'ab'.repeat(32)}`,index:'0x2'};const next=changeInputReference(r,0,point);assert.deepEqual(next.transaction.inputs[0].previous_output,{...point,extra:'input'});assert.deepEqual(next.transaction.cell_deps[0].out_point,{...point,extra:'dep'});assert.deepEqual(next.context.cells[0].out_point,{...point,extra:'cell'});assert.deepEqual(next.context.cells[0].transaction_info,origin);assert.notDeepEqual(r.transaction.inputs[0].previous_output,next.transaction.inputs[0].previous_output);assert.throws(()=>changeInputReference(r,0,r.context.cells[1].out_point),/already uses/);assert.throws(()=>changeInputReference(r,0,{tx_hash:'bad',index:'0x0'}),/32-byte/);
});


test('diagnostics map exact entity paths and resolved context cells to their own cards',()=>{
 let req=mutateCellList(request(),'inputs','add');req=mutateCellList(req,'outputs','add');const input1cell=req.context.cells.indexOf(resolveCell(req,req.transaction.inputs[1].previous_output));
 assert.equal(diagnosticMatchesCell('transaction.outputs_data[0]','inputs',0,req),false);assert.equal(diagnosticMatchesCell('transaction.outputs_data[0]','outputs',0,req),true);assert.equal(diagnosticMatchesCell('transaction.outputs_data[10]','outputs',1,req),false);assert.equal(diagnosticMatchesCell('transaction.inputs[1].since','inputs',1,req),true);assert.equal(diagnosticMatchesCell('transaction.inputs[1].since','inputs',0,req),false);assert.equal(diagnosticMatchesCell(`context.cells[${input1cell}].output.lock.args`,'inputs',1,req),true);assert.equal(diagnosticMatchesCell(`context.cells[${input1cell}].output.lock.args`,'inputs',0,req),false);assert.equal(diagnosticMatchesCell('transaction.outputs[1].lock.args','outputs',1,req),true);assert.equal(diagnosticMatchesCell('transaction.outputs[1].lock.args','inputs',1,req),false);
});


test('script hash and candidates preserve exact CKB group identity and membership',async()=>{
 const selected=JSON.parse(await readFile(new URL('../../fixtures/selected-lock.json',import.meta.url),'utf8')).request;const script=selected.context.cells[0].output.lock;const actual=scriptHash(script);assert.equal(actual,selected.script_group.script_hash);assert.notEqual(actual,script.code_hash);assert.equal(scriptHash({...script,hash_type:'data',args:'0x123456'}),'0x7817d437124010045b004333e8be998f7fa13a2cfa73eaf49a369c89b7c1c915');assert.equal(scriptHash({...script,hash_type:'data1',args:'0x123456'}),'0xe7f6c9bdb9e7014b62175630819dfeb331c2bab4f5780e54d7b6085b6968c5c1');assert.equal(scriptHash({...script,hash_type:'data2',args:'0x123456'}),'0xb833ae9d4cd000b75ecd0aa8e3b14ca69a199e694d92af78e0d58475903e37eb');for(const invalid of [{...script,args:'0xf'},{...script,hash_type:'future'},{...script,code_hash:'0x12'}])assert.throws(()=>scriptHash(invalid));
 const typeFixture=JSON.parse(await readFile(new URL('../../fixtures/selected-type.json',import.meta.url),'utf8')).request;const groups=scriptGroupCandidates(typeFixture);assert.equal(groups.length,2);assert.deepEqual(groups.map(g=>[g.group_type,g.input_indices,g.output_indices]),[['lock',[0],[]],['type',[],[0]]]);assert.equal(groups[0].script_hash,groups[1].script_hash);const broken=structuredClone(typeFixture);broken.context.cells=[];assert.deepEqual(scriptGroupCandidates(broken).map(g=>g.group_type),['type']);assert.deepEqual(scriptGroupCandidates({}),[]);
});


test('editing a copied RPC-view header updates only the new derived hash and selected dependency',async()=>{
 const {headerHash}=await import('../../web/header-hash.js');const {addHeaderFromFields}=await import('../../web/header-model.js');const r=request();const tip=r.context.tip_header;tip.hash=headerHash(tip);const original=structuredClone(tip);r.transaction.header_deps=[tip.hash,tip.hash];const copy=structuredClone(tip);copy.number='0x65';const expected=headerHash(copy);const next=addHeaderFromFields(r,copy,{replaceIndex:0,extension:'none'});assert.deepEqual(next.context.tip_header,original);assert.deepEqual(next.transaction.header_deps,[expected,tip.hash]);assert.equal(next.context.headers.at(-1).hash,expected);assert.equal(r.context.headers.length,0);assert.equal(copy.hash,tip.hash);
});


test('header reuse is idempotent, preserves metadata, and rejects conflicting extension or metadata atomically',async()=>{
 const {headerHash}=await import('../../web/header-hash.js');const {addHeaderFromFields,linkExistingHeader}=await import('../../web/header-model.js');const r=request();const tip=r.context.tip_header;const hash=headerHash(tip);const original=structuredClone(r);
 const reused=addHeaderFromFields(r,tip,{extension:'none'});assert.deepEqual(reused.context,r.context);assert.deepEqual(reused.transaction.header_deps,[hash]);assert.deepEqual(addHeaderFromFields(reused,tip,{extension:'none'}),reused);assert.deepEqual(linkExistingHeader(reused,tip),reused);
 assert.deepEqual(addHeaderFromFields(r,tip,{addDependency:false}),r);
 assert.throws(()=>addHeaderFromFields(r,{...tip,extra_note:'must not disappear'}),/metadata/);assert.throws(()=>addHeaderFromFields(r,tip,{extension:'bytes',extensionData:'0x12'}),/Different/);assert.deepEqual(r,original);
 const newHeader={...tip,number:'0x65'};const supplied=addHeaderFromFields(r,newHeader,{addDependency:false});assert.deepEqual(supplied.transaction.header_deps,[]);assert.deepEqual(supplied.context.headers,[newHeader]);
 const replaced=addHeaderFromFields({...supplied,transaction:{...supplied.transaction,header_deps:[hash]}},newHeader,{replaceIndex:0});assert.deepEqual(replaced.context.headers,[newHeader]);assert.deepEqual(replaced.transaction.header_deps,[headerHash(newHeader)]);assert.throws(()=>addHeaderFromFields({...supplied,transaction:{...supplied.transaction,header_deps:[hash,headerHash(newHeader)]}},newHeader,{replaceIndex:0}),/already linked at another/);
});
