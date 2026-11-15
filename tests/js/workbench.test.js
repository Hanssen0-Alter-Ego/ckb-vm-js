import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveCell, scriptChoices, inspectRequest, mutateCellList } from '../../web/workbench-model.js';
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
