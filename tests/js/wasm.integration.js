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
