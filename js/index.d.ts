export type Hex = `0x${string}`;
export interface OutPoint { tx_hash: Hex; index: Hex }
export interface Script { code_hash: Hex; hash_type: 'data' | 'type' | 'data1' | 'data2'; args: Hex }
export interface CellOutput { capacity: Hex; lock: Script; type?: Script | null }
export interface Transaction {
  version: Hex;
  cell_deps: Array<{ out_point: OutPoint; dep_type: 'code' | 'dep_group' }>;
  header_deps: Hex[];
  inputs: Array<{ previous_output: OutPoint; since: Hex }>;
  outputs: CellOutput[];
  outputs_data: Hex[];
  witnesses: Hex[];
  hash?: Hex;
}
export interface Header {
  compact_target: Hex; dao: Hex; epoch: Hex; extra_hash: Hex; hash?: Hex;
  nonce: Hex; number: Hex; parent_hash: Hex; proposals_hash: Hex;
  timestamp: Hex; transactions_root: Hex; version: Hex;
}
export interface ResolvedCell {
  out_point: OutPoint; output: CellOutput; data: Hex;
  /** Required: null claims a non-cellbase cell with unknown/unconfirmed origin, in either phase. */
  transaction_info: { block_hash: Hex; block_number: Hex; block_epoch: Hex; index: Hex } | null;
}
/** Caller-supplied consensus configuration; no network presets are selected. */
export interface Consensus {
  tx_version: Hex;
  max_block_bytes: Hex;
  max_block_cycles: Hex;
  cellbase_maturity: Hex;
  median_time_block_count: Hex;
  tx_proposal_window: { closest: Hex; farthest: Hex };
  dao_type_hash: Hex;
  hardforks: {
    rfc0028_epoch: Hex;
    rfc0032_epoch: Hex;
    rfc0049_epoch: Hex;
    rfc0044_epoch: Hex;
  };
  starting_block_limiting_dao_withdrawing_lock: Hex;
}
export type Verification =
  | { phase: 'submitted' }
  | {
      phase: 'committed';
      /** Candidate must be a direct child of context.tip_header. */
      candidate_header: Header;
      /** Positive transaction index within the candidate block. */
      transaction_index: Hex;
    };
export interface Context {
  consensus: Consensus;
  /** Actual current chain tip, not the candidate committed block. */
  tip_header: Header;
  /** Defaults to submitted when omitted. */
  verification?: Verification;
  cells: ResolvedCell[];
  headers: Header[];
  extensions: Array<{ block_hash: Hex; data: Hex | null }>;
}
export interface ScriptGroup { group_type: 'lock' | 'type'; script_hash: Hex }
export interface VerifyRequest {
  transaction: Transaction;
  context: Context;
  max_cycles: Hex;
  script_group?: ScriptGroup;
}
export interface VerifyResult {
  ok: boolean;
  scope?: 'transaction' | 'script_group';
  cycles?: Hex;
  fee?: Hex;
  groups?: Array<ScriptGroup & { input_indices: number[]; output_indices: number[] }>;
  chain_state_verified?: false;
  error?: { code: string; message: string };
  [key: string]: unknown;
}
export interface WasmBindings {
  default?: (options?: { module_or_path: WasmInput }) => Promise<unknown>;
  verify: (requestJson: string) => string;
}
export type WasmInput = BufferSource | WebAssembly.Module | URL | Request | Response | string;
export interface VerifierOptions {
  /** Omit to load the packaged WASM. Supply bytes/module for offline initialization. */
  wasm?: WasmInput;
  /** Override generated bindings loading, e.g. when integrating with a bundler. */
  loadBindings?: () => Promise<WasmBindings> | WasmBindings;
}
export interface Verifier {
  /** Runs synchronously inside WASM, returning its result through a Promise. */
  verify(request: VerifyRequest): Promise<VerifyResult>;
  verifyScriptGroup(request: VerifyRequest, group: ScriptGroup): Promise<VerifyResult>;
}
export interface WorkerVerifier extends Verifier { dispose(): void }
export interface WorkerVerifierOptions {
  /** Bytes/module are cloned to the worker, not transferred or detached. */
  wasm?: BufferSource | WebAssembly.Module | string;
  worker?: Worker;
  workerURL?: string | URL;
}
export function createVerifier(options?: VerifierOptions): Promise<Verifier>;
/** Owns and terminates the worker, including a caller-supplied worker. */
export function createWorkerVerifier(options?: WorkerVerifierOptions): Promise<WorkerVerifier>;
