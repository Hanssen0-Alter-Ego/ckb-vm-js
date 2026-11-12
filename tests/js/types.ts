import { createVerifier, createWorkerVerifier } from '../../js/index.js';
import type { VerifyRequest, VerifyResult, ScriptGroup, WorkerVerifier } from '../../js/index.js';
declare const request: VerifyRequest;
const group: ScriptGroup = { group_type: 'lock', script_hash: '0x00' };
async function usage() {
  const verifier = await createVerifier({ wasm: new Uint8Array([0]) });
  const result: VerifyResult = await verifier.verify(request);
  await verifier.verifyScriptGroup(request, group);
  if (result.ok) { const cycles: `0x${string}` | undefined = result.cycles; void cycles; }
  const worker: WorkerVerifier = await createWorkerVerifier({ wasm: new ArrayBuffer(0) });
  await worker.verify(request);
  worker.dispose();
  // @ts-expect-error max_cycles must remain lossless RPC hex
  await verifier.verify({ ...request, max_cycles: 100 });
  // @ts-expect-error only lock or type selectors are valid
  await verifier.verifyScriptGroup(request, { ...group, group_type: 'all' });
  // @ts-expect-error workers cannot clone binding loader functions
  await createWorkerVerifier({ loadBindings: () => ({ verify: () => '{}' }) });
}
void usage;
