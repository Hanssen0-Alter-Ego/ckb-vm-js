// Protocol unit tests with a mocked WASM loader, not WASM verification tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = (await readFile(new URL('../../js/worker.js', import.meta.url), 'utf8'))
  .replace("import { createVerifier } from './index.js';", '');
function harness(createVerifier) {
  const messages = [];
  let listener;
  vm.runInNewContext(source, { createVerifier, self: {
    addEventListener: (_, callback) => { listener = callback; },
    postMessage: (data) => messages.push(data),
  } });
  return { messages, send: (data) => listener({ data }) };
}
test('worker rejects concurrent initialization and awaits first initialization for verify', async () => {
  let complete;
  const h = harness(() => new Promise((resolve) => { complete = resolve; }));
  const init = h.send({ id: 1, method: 'init', options: {} });
  await h.send({ id: 2, method: 'init', options: {} });
  assert.match(h.messages[0].error.message, /already initialized/);
  const verify = h.send({ id: 3, method: 'verify', request: {} });
  complete({ verify: async () => ({ ok: true }) });
  await Promise.all([init, verify]);
  assert.equal(h.messages.find(({ id }) => id === 3).result.ok, true);
});
test('worker rejects verification before init and unknown commands', async () => {
  const h = harness(() => { throw new Error('must not initialize'); });
  await h.send({ id: 1, method: 'verify', request: {} });
  await h.send({ id: 2, method: 'unknown' });
  assert.match(h.messages[0].error.message, /Initialize/);
  assert.match(h.messages[1].error.message, /Unknown/);
});
