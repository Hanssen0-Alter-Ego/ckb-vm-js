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
  transaction_info: { block_hash: Hex; block_number: Hex; block_epoch: Hex; index: Hex };
}
export interface ScriptGroup { group_type: 'lock' | 'type'; script_hash: Hex }
export interface VerifyRequest {
  transaction: Transaction;
  context: {
    network: 'mainnet' | 'testnet'; tip_header: Header;
    cells: ResolvedCell[]; headers: Header[];
    extensions: Array<{ block_hash: Hex; data: Hex | null }>;
  };
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
