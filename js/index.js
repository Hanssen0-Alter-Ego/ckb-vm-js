/** Initialize once, then verify entirely from caller-supplied data. */
export async function createVerifier(options = {}) {
  const bindings = await (options.loadBindings
    ? options.loadBindings()
    : import('../pkg/ckb_wasm_verifier.js'));
  if (typeof bindings.default === 'function') {
    // wasm-bindgen's object form avoids its deprecated positional init API.
    await bindings.default(options.wasm === undefined ? undefined : { module_or_path: options.wasm });
  }
  if (typeof bindings.verify !== 'function') throw new TypeError('WASM bindings must export verify(requestJson)');
  const verify = async (request) => {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      throw new TypeError('A verification request object is required');
    }
    const result = JSON.parse(bindings.verify(JSON.stringify(request)));
    if (!result || typeof result !== 'object' || typeof result.ok !== 'boolean') {
      throw new TypeError('Invalid verification response from WASM');
    }
    return result;
  };
  return Object.freeze({
    verify,
    verifyScriptGroup: async (request, group) => verify({ ...request, script_group: validateGroup(group) }),
  });
}

function validateGroup(group) {
  if (!group || !['lock', 'type'].includes(group.group_type) ||
      !/^0x[0-9a-fA-F]{64}$/.test(group.script_hash)) {
    throw new TypeError('A script group requires group_type (lock or type) and a 32-byte script_hash');
  }
  return group;
}

/** Dedicated Worker client: no SharedArrayBuffer or cross-origin isolation required. */
export async function createWorkerVerifier(options = {}) {
  const worker = options.worker ?? new Worker(options.workerURL ?? new URL('./worker.js', import.meta.url), { type: 'module' });
  const pending = new Map();
  let sequence = 0;
  let closed = false;
  const failAll = (error) => {
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  };
  const onMessage = ({ data }) => {
    const entry = pending.get(data?.id);
    if (!entry) return;
    pending.delete(data.id);
    if (data.error) {
      const error = new Error(data.error.message || 'Verifier worker failed');
      error.name = data.error.name || 'Error';
      entry.reject(error);
    } else entry.resolve(data.result);
  };
  const onError = (event) => {
    failAll(new Error(event.message || 'Verifier worker failed'));
    dispose();
  };
  worker.addEventListener('message', onMessage);
  worker.addEventListener('error', onError);
  worker.addEventListener('messageerror', onError);
  const call = (method, payload) => new Promise((resolve, reject) => {
    if (closed) return reject(new Error('Verifier worker is closed'));
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    try { worker.postMessage({ id, method, ...payload }); }
    catch (error) { pending.delete(id); reject(error); }
  });
  const dispose = () => {
    closed = true;
    worker.removeEventListener('message', onMessage);
    worker.removeEventListener('error', onError);
    worker.removeEventListener('messageerror', onError);
    worker.terminate();
    failAll(new Error('Verifier worker is closed'));
  };
  try { await call('init', { options: { wasm: options.wasm } }); }
  catch (error) { dispose(); throw error; }
  return Object.freeze({
    verify: (request) => call('verify', { request }),
    verifyScriptGroup: async (request, group) => call('verify', { request: { ...request, script_group: validateGroup(group) } }),
    dispose,
  });
}
