# ckb-wasm-verifier

Offline CKB transaction verification in WebAssembly, with a JavaScript/TypeScript API.

This project uses **CKB's own transaction verifiers and CKB-VM**, pinned as Git submodules. It does not substitute a JavaScript VM or approximate CKB consensus. Both the ordinary full-transaction API and a selected-script-group API are available.

**Early experimental release. Not audited. A successful result is relative to the supplied snapshot, not proof that the network will accept the transaction.** Do not use it as the sole safeguard for funds.

## What `verify` checks

For a non-cellbase transaction at an explicitly supplied candidate block:

- Canonical RPC decoding, transaction version/size/shape, output-data lengths, supported script hash types and duplicate dependencies.
- Input resolution, duplicate inputs and dep-group expansion against caller-supplied cells.
- Cellbase maturity, `since`, occupied capacity, input/output capacity and DAO-aware fees.
- Every lock/type script group, TYPE_ID rules, syscall behavior, hardfork-selected VM versions, and a shared cycle budget through upstream CKB.
- The upstream DAO script-size rule at its configured activation epoch.

`verifyScriptGroup` executes only the requested lock/type group. A successful group result **does not imply that the whole transaction is valid**. Structural decoding and snapshot completeness checks still apply.

## Trust and scope

The verifier never contacts a node or indexer. Developers supply transaction bytes as RPC JSON plus the necessary cells, data, headers, block extensions and creation metadata. It recomputes hashes from supplied data and checks internal consistency. It cannot establish that the supplied context is true.

Deliberately outside scope:

- Whether a cell is live, already spent or on the canonical chain.
- Proof of work, header/block authenticity, chain selection and inclusion proofs.
- Transaction proposal inclusion, block-wide byte/cycle limits, conflicts with other block transactions, and cellbase rewards.
- Mempool policy or future inclusion guarantees.

Initial API restrictions are explicit and fail closed: mainnet/testnet bundled consensus only; committed candidate-block mode; no cellbase transaction; no same-block ancestor inputs/dependencies. Candidate header and its parent are required. A future API may add submission/proposal environments and custom chain specifications.

## Build

```sh
git clone --recurse-submodules https://github.com/Hanssen0-Alter-Ego/ckb-wasm-verifier.git
cd ckb-wasm-verifier
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.105 --locked
npm ci
./scripts/prepare.sh
# Install clang from your platform's official package manager if absent.
./scripts/build-wasm.sh
npm test
npm run typecheck
npm run test:wasm
```

Rust 1.95.0 is pinned in `rust-toolchain.toml`. `clang` is needed for upstream secp256k1 C code; `CC_wasm32_unknown_unknown=/path/to/clang` overrides it. The generated module targets **wasm32-unknown-unknown**, not WASI, and does not require SharedArrayBuffer or cross-origin isolation.

Build before installing from a checkout or making an npm tarball. No npm registry publication is claimed. `pkg/` contains the generated JS loader, WASM and declarations and is included in the package tarball.

## Use

```js
import { createVerifier } from './js/index.js';

const verifier = await createVerifier(); // loads the local pkg WASM asset once
const result = await verifier.verify(request);
if (!result.ok) console.error(result.error.code, result.error.message);
else console.log(result.cycles, result.fee, result.groups);

const oneGroup = await verifier.verifyScriptGroup(request, {
  group_type: 'lock',
  script_hash: '0x...', // complete 32-byte hash, available in result.groups
});
```

For fully offline initialization in Node, pass `wasm: await readFile(...)`. For browsers, use `createWorkerVerifier` to keep CPU-bound verification off the UI thread. The returned Promise does not by itself make direct verification non-blocking. See [JavaScript and Worker usage](docs/javascript.md).

## Request

All integers are lossless CKB RPC hex strings. The TypeScript declarations describe the full API. Minimal shape:

```js
const request = {
  transaction: { /* CKB RPC Transaction, including witnesses */ },
  max_cycles: '0x3b9aca00',
  context: {
    network: 'mainnet', // or 'testnet'
    tip_header: { /* candidate block RPC Header */ },
    headers: [ /* parent, creation/header-dep/median-time headers */ ],
    cells: [{
      out_point: { tx_hash: '0x...', index: '0x0' },
      output: { capacity: '0x...', lock: { /* Script */ }, type: null },
      data: '0x...',
      transaction_info: {
        block_hash: '0x...', block_number: '0x...',
        block_epoch: '0x...', index: '0x1',
      },
    }],
    extensions: [{ block_hash: '0x...', data: null }],
  },
};
```

Cells must include every input, direct dep, dep-group cell and expanded member, with creation headers. `transaction_info.index` is the transaction's index in its creation block, not the cell's output index; zero means cellbase. Its block number and packed epoch must match the supplied creation header. Every referenced creation/header-dep hash must have an explicit extension entry: bytes when present, `null` when absent. Missing context is an error, never treated as successful verification.

Timestamp-based `since` may require the network's median-time ancestor window. Supply the linked header chain, stopping at genesis. Header JSON is the RPC Header body; the block hash is recomputed, not trusted from a separate asserted hash.

Success returns `{ ok: true, scope: 'transaction' | 'script_group', cycles, fee?, groups, chain_state_verified: false }`. Failure returns `{ ok: false, error: { code, message } }`. Group order is not part of the API. Error messages include upstream details and may change with upstream versions.

## Upstream and reproducibility

- [CKB](https://github.com/nervosnetwork/ckb/tree/6abb474c1678e67dae0337abeb8bfd77cfb576e3), commit `6abb474c1678e67dae0337abeb8bfd77cfb576e3` (verification/script crates 1.2.1).
- [CKB-VM](https://github.com/nervosnetwork/ckb-vm/tree/7199b96d9f24b51c4c5eba358d64cd4d9bcf8150), `v0.24.15`, commit `7199b96d9f24b51c4c5eba358d64cd4d9bcf8150`.
- The workspace patches `ckb-vm` and `ckb-vm-definitions` to the VM submodule. `Cargo.lock` pins the remaining dependency graph.
- `scripts/prepare.sh` applies the checked-in, narrowly scoped wasm32 compatibility patches to the exact upstream pins. These retain 64-bit syscall/ELF semantics on a 32-bit host. See `patches/README.md`; do not omit this step. Native builds may select upstream assembly execution; the browser uses the portable interpreter.

See [verification notes](docs/verification.md) for actual checks run and remaining test gaps. This is an independent integration, not an official Nervos release. Upstream submodules retain their own licenses.
