import { createVerifier, createWorkerVerifier } from "../../js/index.js";
import type { VerifyRequest, VerifyResult, ScriptGroup, WorkerVerifier, Context, Consensus, ResolvedCell } from '../../js/index.js';
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

// Both phases share the explicit consensus and true current-tip contract.
declare const consensus: Consensus;
declare const confirmedCell: ResolvedCell;
const submittedContext: Context = { ...request.context, consensus };
const explicitSubmitted: Context = { ...submittedContext, verification: { phase: 'submitted' } };
const committedContext: Context = {
  ...submittedContext,
  verification: { phase: 'committed', candidate_header: request.context.tip_header, transaction_index: '0x1' },
};
const unconfirmedCell: ResolvedCell = { ...confirmedCell, transaction_info: null };
// @ts-expect-error the network selector was removed from the foundational API
const networkContext: Context = { ...submittedContext, network: 'mainnet' };
// @ts-expect-error committed mode requires candidate header and transaction index
const incompleteCommitted: Context = { ...submittedContext, verification: { phase: 'committed' } };
// @ts-expect-error null is allowed but omission of transaction_info is not
const missingOrigin: ResolvedCell = { out_point: confirmedCell.out_point, output: confirmedCell.output, data: confirmedCell.data };
// @ts-expect-error consensus limits remain lossless hex values
const numericConsensus: Consensus = { ...consensus, max_block_cycles: 100 };
const { consensus: removedConsensus, ...withoutConsensus } = submittedContext;
// @ts-expect-error callers must supply explicit consensus parameters
const missingConsensus: Context = withoutConsensus;
void [explicitSubmitted, committedContext, unconfirmedCell, networkContext, incompleteCommitted,
  missingOrigin, numericConsensus, missingConsensus, removedConsensus];

// Null origins are accepted in either phase; real same-block metadata can establish order.
const committedUnknownOrigin: Context = { ...committedContext, cells: [unconfirmedCell] };
void committedUnknownOrigin;
