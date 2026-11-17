// Browser-only adapter: the npm API remains object-based, while the lab passes
// the exact JSON text directly to WASM without a Number conversion.
import init, { verify } from './pkg/ckb_wasm_verifier.js';
let initialized = false;
self.addEventListener('message', async ({ data }) => {
  const { id, method } = data ?? {};
  try {
    let result;
    if (method === 'init') {
      if (initialized) throw new Error('Verifier already initialized');
      initialized = true;
      await init();
      result = null;
    } else if (method === 'verify') {
      if (!initialized) throw new Error('Initialize the verifier first');
      if (typeof data.request !== 'string') throw new TypeError('Expected request JSON text');
      result = JSON.parse(verify(data.request));
    } else throw new Error(`Unknown worker method: ${method}`);
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: { name: error.name, message: error.message } });
  }
});
