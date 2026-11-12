import test from 'node:test';
import assert from 'node:assert/strict';
import { createVerifier, createWorkerVerifier } from '../../js/index.js';

const group = { group_type: 'lock', script_hash: `0x${'ab'.repeat(32)}` };
test('initializes explicit WASM bytes once; forwards exact JSON and results', async () => {
  const bytes = new Uint8Array([1, 2]);
  let count = 0;
  const api = await createVerifier({ wasm: bytes, loadBindings: () => ({
    default: async ({ module_or_path }) => { assert.equal(module_or_path, bytes); count++; },
    verify: (json) => { assert.deepEqual(JSON.parse(json), { max_cycles: '0xffffffffffffffff' }); return '{"ok":true,"cycles":"0x20"}'; },
  }) });
  assert.deepEqual(await api.verify({ max_cycles: '0xffffffffffffffff' }), { ok: true, cycles: '0x20' });
  assert.equal(count, 1);
});
test('group verification preserves request and validation errors remain distinguishable', async () => {
  const api = await createVerifier({ loadBindings: () => ({ verify: (json) => {
    assert.deepEqual(JSON.parse(json), { transaction: {}, script_group: group });
    return '{"ok":false,"error":{"code":"script_failure"}}';
  } }) });
  const request = { transaction: {} };
  assert.equal((await api.verifyScriptGroup(request, group)).ok, false);
  assert.deepEqual(request, { transaction: {} });
  await assert.rejects(api.verifyScriptGroup(request, { group_type: 'lock', script_hash: '0x' }), TypeError);
  await assert.rejects(api.verify(null), TypeError);
});
test('binding failures reject instead of becoming successful verification', async () => {
  const api = await createVerifier({ loadBindings: () => ({ verify: () => '{"cycles":0}' }) });
  await assert.rejects(api.verify({}), /Invalid verification response/);
  await assert.rejects(createVerifier({ loadBindings: () => ({}) }), /must export verify/);
});
class FakeWorker extends EventTarget {
  sent = [];
  terminated = false;
  postMessage(message) {
    this.sent.push(message);
    if (message.method === 'init') queueMicrotask(() => this.respond(message.id, null));
  }
  respond(id, result) { this.dispatchEvent(new MessageEvent('message', { data: { id, result } })); }
  terminate() { this.terminated = true; }
}
test('worker routes concurrent results by id and disposes pending calls', async () => {
  const worker = new FakeWorker();
  const api = await createWorkerVerifier({ worker, wasm: new Uint8Array([1]) });
  const first = api.verify({ transaction: 1 });
  const second = api.verifyScriptGroup({ transaction: 2 }, group);
  worker.respond(worker.sent[2].id, { ok: false });
  worker.respond(worker.sent[1].id, { ok: true });
  assert.deepEqual(await Promise.all([first, second]), [{ ok: true }, { ok: false }]);
  assert.deepEqual(worker.sent[2].request.script_group, group);
  const pending = api.verify({});
  api.dispose();
  await assert.rejects(pending, /closed/);
  await assert.rejects(api.verify({}), /closed/);
  assert.equal(worker.terminated, true);
});
test('worker errors reject pending calls', async () => {
  const worker = new FakeWorker();
  const api = await createWorkerVerifier({ worker });
  const pending = api.verify({});
  worker.dispatchEvent(new Event('error'));
  await assert.rejects(pending, /worker failed/);
  api.dispose();
});

test('direct API rejects malformed inputs and non-JSON values', async () => {
  const api = await createVerifier({ loadBindings: () => ({ verify: () => '{"ok":true}' }) });
  for (const request of [undefined, null, [], 'text', 42]) await assert.rejects(api.verify(request), TypeError);
  const cyclic = {}; cyclic.self = cyclic;
  await assert.rejects(api.verify(cyclic), TypeError);
  await assert.rejects(api.verify({ max_cycles: 1n }), TypeError);
  for (const invalid of [null, {}, { ...group, group_type: 'other' }, { ...group, script_hash: '0xz' }]) {
    await assert.rejects(api.verifyScriptGroup({}, invalid), TypeError);
  }
  const brokenJson = await createVerifier({ loadBindings: () => ({ verify: () => 'not json' }) });
  await assert.rejects(brokenJson.verify({}), SyntaxError);
});

test('worker initialization failure disposes worker', async () => {
  class BrokenWorker extends FakeWorker {
    postMessage({ id }) {
      queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', {
        data: { id, error: { name: 'CompileError', message: 'invalid WASM bytes' } },
      })));
    }
  }
  const worker = new BrokenWorker();
  await assert.rejects(createWorkerVerifier({ worker }), { name: 'CompileError', message: 'invalid WASM bytes' });
  assert.equal(worker.terminated, true);
});

test('worker structured clone failures clean pending request and allow later use', async () => {
  class CloneWorker extends FakeWorker {
    postMessage(message) { structuredClone(message); super.postMessage(message); }
  }
  const worker = new CloneWorker();
  const api = await createWorkerVerifier({ worker });
  await assert.rejects(api.verify({ fn() {} }), { name: 'DataCloneError' });
  const pending = api.verify({});
  worker.respond(worker.sent.at(-1).id, { ok: true });
  assert.deepEqual(await pending, { ok: true });
  api.dispose();
  api.dispose();
});

test('message decoding failure terminates worker and rejects all pending calls', async () => {
  const worker = new FakeWorker();
  const api = await createWorkerVerifier({ worker });
  const first = api.verify({});
  const second = api.verify({});
  worker.dispatchEvent(new Event('messageerror'));
  await assert.rejects(first, /worker failed/);
  await assert.rejects(second, /worker failed/);
  assert.equal(worker.terminated, true);
  await assert.rejects(api.verify({}), /closed/);
});
