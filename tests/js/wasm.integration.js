// Real engine integration: missing artifacts fail instead of silently skipping.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createVerifier } from '../../js/index.js';
import { scriptHash, scriptGroupCandidates } from '../../web/workbench-model.js';
const wasm = await readFile(new URL('../../pkg/ckb_wasm_verifier_bg.wasm', import.meta.url));
const verifier = await createVerifier({ wasm });
const normalized = (key, value) => key === 'groups' && Array.isArray(value)
  ? [...value].sort((a, b) => `${a.group_type}:${a.script_hash}`.localeCompare(`${b.group_type}:${b.script_hash}`))
  : value;

test('real WASM initializes offline and rejects an invalid request', async () => {
  const result = await verifier.verify({});
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'InvalidRequest');
});

let fixtureFiles;
if (process.env.CKB_WASM_FIXTURE) fixtureFiles = [process.env.CKB_WASM_FIXTURE];
else {
  const directory = new URL('../../fixtures/', import.meta.url);
  const names = await readdir(directory).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  fixtureFiles = names.filter((name) => name.endsWith('.json')).sort().map((name) => new URL(name, directory));
}
if (!fixtureFiles.length) test('real transaction fixtures', { skip: 'No fixtures/*.json files present' }, () => {});
for (const file of fixtureFiles) {
  test(`real WASM fixture: ${file}`, async () => {
    const { request, expected } = JSON.parse(await readFile(file, 'utf8'));
    assert.ok(request && expected && typeof expected.ok === 'boolean', 'fixture requires request and expected.ok');
    const result = await verifier.verify(request);
    for (const [key, value] of Object.entries(expected)) assert.deepEqual(normalized(key, result[key]), normalized(key, value), key);
  });
}


test('frontend group hashes match real engine for all hash types and non-empty args', async () => {
 const base=JSON.parse(await readFile(new URL('../../fixtures/submitted-valid.json',import.meta.url),'utf8')).request;
 for(const kind of ['data','data1','data2','type']){
  const request=structuredClone(base);const script=request.context.cells[0].output.lock;if(kind==='type'){request.context.cells[1].output.type=structuredClone(script);script.code_hash=scriptHash(request.context.cells[1].output.type);}script.hash_type=kind;script.args='0x123456';const result=await verifier.verify(request);assert.equal(result.ok,true,JSON.stringify(result));const candidate=scriptGroupCandidates(request).find(g=>g.group_type==='lock');const actual=result.groups.find(g=>g.group_type==='lock');assert.equal(candidate.script_hash,actual.script_hash,kind);assert.deepEqual(candidate.input_indices,actual.input_indices);assert.deepEqual(candidate.output_indices,actual.output_indices);
 }
});


test('real WASM accepts correct optional RPC hashes and rejects mismatches and unknown fields', async () => {
 const base=JSON.parse(await readFile(new URL('../../fixtures/selected-lock.json',import.meta.url),'utf8')).request;
 const hashes={transaction:'0x0ddc389e29dacea4405331a65ea4c9ee2d731984e598baff039bdf3f1da3d576',tip:'0x431643f20c2ddc95980bb2797c2a020d78cc05c849b70ab1a041c7e2768ec106',candidate:'0x411e38f46d127390be4606bf4fec8c2db53321a8b3bdafd7b3428ebdb2bd5e64',extra:'0x771ff3bbda2687be90ceb8af09de258fa83d294e0e3ec7e430cdbdc0ae0ef087'};
 const withHashes=structuredClone(base);withHashes.transaction.hash=hashes.transaction;withHashes.context.tip_header.hash=hashes.tip;withHashes.context.verification.candidate_header.hash=hashes.candidate;withHashes.context.headers=[{...base.context.tip_header,nonce:'0x1',hash:hashes.extra}];
 for(const request of [base,withHashes])for(const mode of ['verify','verifyScriptGroup']){const result=mode==='verify'?await verifier.verify(request):await verifier.verifyScriptGroup(request,request.script_group);assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.scope,'script_group');}
 const full=structuredClone(withHashes);delete full.script_group;const fullResult=await verifier.verify(full);assert.equal(fullResult.ok,true,JSON.stringify(fullResult));assert.equal(fullResult.scope,'transaction');
 for(const path of ['transaction','tip','candidate','extra']){const request=structuredClone(withHashes);const item=path==='transaction'?request.transaction:path==='tip'?request.context.tip_header:path==='candidate'?request.context.verification.candidate_header:request.context.headers[0];item.hash=`0x${'00'.repeat(32)}`;const result=await verifier.verify(request);assert.equal(result.error.code,'InvalidRequest',path);assert.match(result.error.message,/hash does not match/,path);}
 for(const path of ['transaction','tip'])for(const variant of ['unexpected','null','malformed']){const request=structuredClone(base);const item=path==='transaction'?request.transaction:request.context.tip_header;if(variant==='unexpected')item.unknown='bad';else item.hash=variant==='null'?null:'0x12';const result=await verifier.verify(request);assert.equal(result.error.code,'InvalidRequest',`${path} ${variant}`);}
});
