import { createVerifier } from './index.js';

// The event queue naturally serializes synchronous WASM verification. Send errors
// as plain objects because browser Error structured-cloning differs by runtime.
let verifier;
self.addEventListener('message', async ({ data }) => {
  const { id, method } = data ?? {};
  try {
    let result;
    if (method === 'init') {
      if (verifier) throw new Error('Verifier already initialized');
      verifier = createVerifier(data.options);
      await verifier;
      result = null;
    } else if (method === 'verify') {
      if (!verifier) throw new Error('Initialize the verifier first');
      result = await (await verifier).verify(data.request);
    } else throw new Error(`Unknown worker method: ${method}`);
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: { name: error.name, message: error.message } });
  }
});
