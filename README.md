# ckb-vm-js

Offline CKB transaction verification in WebAssembly, with a JavaScript/TypeScript API.

This project uses **CKB's own transaction verifiers and CKB-VM**, pinned as Git submodules. It does not substitute a JavaScript VM. The caller supplies the consensus parameters consumed by the pinned transaction-verification paths. Both the ordinary full-transaction API and a selected-script-group API are available.

**Early experimental release. Not audited. A successful result is relative to the supplied snapshot, not proof that the network will accept the transaction.** Do not use it as the sole safeguard for funds.

## What `verify` checks

For a non-cellbase transaction, using only caller-supplied transaction context:

- Canonical RPC decoding, transaction version/size/shape, output-data lengths, supported script hash types and duplicate dependencies.
- Input resolution, duplicate inputs and dep-group expansion against caller-supplied cells.
- Cellbase maturity, `since`, occupied capacity, input/output capacity and DAO-aware fees.
- Every lock/type script group, TYPE_ID rules, syscall behavior, hardfork-selected VM versions, and a shared cycle budget through upstream CKB.
- The upstream DAO script-size rule, with submission/block-mode activation semantics.

`verifyScriptGroup` executes only the requested lock/type group. A successful group result **does not imply that the whole transaction is valid**. Structural decoding and snapshot completeness checks still apply.

## Trust and scope

The verifier never contacts a node or indexer. Developers supply transaction bytes as RPC JSON plus the necessary cells, data, headers, block extensions and creation metadata. It recomputes hashes from supplied data and checks internal consistency. It cannot establish that the supplied context is true.

Deliberately outside scope:

- Whether a cell is live, already spent or on the canonical chain.
- Proof of work, header/block authenticity, chain selection and inclusion proofs.
- Transaction proposal inclusion, block-wide byte/cycle limits, conflicts with other block transactions, and cellbase rewards.
- Mempool policy or future inclusion guarantees.

The foundation API has no network selector, chain-state cache, RPC client or automatic mainnet/testnet configuration. The caller supplies the required consensus parameters as well as the data. Network presets and context-maintenance helpers can be built separately on top.

`tip_header` means the **actual current chain tip**. By default, verification uses upstream's newly-submitted transaction environment. To check an exact hypothetical block placement, supply `verification: { phase: 'committed', candidate_header, transaction_index }`; the candidate must directly follow the supplied tip. Same-block ancestor cells are supported when their creation metadata identifies this candidate and an earlier transaction index. Explicit `transaction_info: null` represents an unconfirmed non-cellbase cell, not missing metadata. Standalone cellbase transactions and the separate already-proposed pool phase are not supported. See the [complete request contract](crates/verifier/SCHEMA.md).

## Build

```sh
git clone --recurse-submodules https://github.com/Hanssen0-Alter-Ego/ckb-vm-js.git
cd ckb-vm-js
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.105 --locked
npm ci
./scripts/prepare.sh
# Install clang from your platform's official package manager if absent.
./scripts/build-wasm.sh
npm test
npm run typecheck
npm run test:wasm
node examples/verify.mjs # runs the included valid fixture offline
```

Rust 1.95.0 is pinned in `rust-toolchain.toml`. `clang` is needed for upstream secp256k1 C code; `CC_wasm32_unknown_unknown=/path/to/clang` overrides it. The generated module targets **wasm32-unknown-unknown**, not WASI, and does not require SharedArrayBuffer or cross-origin isolation.

The repository is named `ckb-vm-js`; the package/import name remains `@hanssen0-alter-ego/ckb-wasm-verifier`.

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

The v0.2 foundation interface has 62 synthetic transaction/context fixtures, all passing locally in native and real WASM execution, including comparison with an unmodified-upstream native build. JavaScript/TypeScript and offline installed-tarball checks also pass. Browser execution is checked by the [CI workflow](https://github.com/Hanssen0-Alter-Ego/ckb-vm-js/actions); inspect the check for the exact commit rather than assuming a previous browser pass covers this revision. See the [verification record and limits](docs/verification.md).

## Request

All integers are lossless CKB RPC hex strings. The TypeScript declarations describe the full API. Minimal shape:

```js
const request = {
  transaction: { /* CKB RPC Transaction, including witnesses */ },
  max_cycles: '0x3b9aca00',
  context: {
    tip_header: { /* current chain tip RPC Header */ },
    // verification omitted: defaults to { phase: 'submitted' }
    consensus: {
      tx_version: '0x...', max_block_bytes: '0x...', max_block_cycles: '0x...',
      cellbase_maturity: '0x...', median_time_block_count: '0x...',
      tx_proposal_window: { closest: '0x...', farthest: '0x...' },
      dao_type_hash: '0x...',
      hardforks: {
        rfc0028_epoch: '0x...', rfc0032_epoch: '0x...',
        rfc0049_epoch: '0x...', rfc0044_epoch: '0x...',
      },
      starting_block_limiting_dao_withdrawing_lock: '0x...',
    },
    headers: [ /* creation/header-dep/median-time headers */ ],
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

The snippet is a shape illustration, not a usable network configuration. Cells must include every input, direct dep, dep-group cell and expanded member. Confirmed origins require their creation headers. `transaction_info.index` is the transaction's index in its creation block, not the cell's output index; zero means cellbase. Its block number and packed epoch must match the supplied creation header. For resolved inputs/dependencies with known origins and declared header deps, each corresponding hash must have an explicit extension entry: bytes when present, `null` when absent. Missing context is an error, never treated as successful verification.

Timestamp-based `since` may require the caller-configured median-time ancestor window. Supply the linked header chain, stopping at genesis. Header JSON is the RPC Header body; the block hash is recomputed, not trusted from a separate asserted hash.

### Migration from v0.1

The old `context.network` is removed. Supply `context.consensus` explicitly; do not assume a preset is selected implicitly. The old misleading `tip_header` was a candidate header. To retain exact-block semantics, move it to `context.verification.candidate_header`, set `phase: 'committed'`, provide the target `transaction_index`, and put its actual parent in `context.tip_header`. Do not repeat that parent in `headers`. Omitting `verification` intentionally selects **submitted**, not the old committed behavior. JS method names are unchanged.

Success returns `{ ok: true, scope: 'transaction' | 'script_group', cycles, fee?, groups, chain_state_verified: false }`. Failure returns `{ ok: false, error: { code, message } }`. Group order is not part of the API. Error messages include upstream details and may change with upstream versions.

## Upstream and reproducibility

- [CKB](https://github.com/nervosnetwork/ckb/tree/6abb474c1678e67dae0337abeb8bfd77cfb576e3), commit `6abb474c1678e67dae0337abeb8bfd77cfb576e3` (verification/script crates 1.2.1).
- [CKB-VM](https://github.com/nervosnetwork/ckb-vm/tree/7199b96d9f24b51c4c5eba358d64cd4d9bcf8150), `v0.24.15`, commit `7199b96d9f24b51c4c5eba358d64cd4d9bcf8150`.
- The workspace patches `ckb-vm` and `ckb-vm-definitions` to the VM submodule. `Cargo.lock` pins the remaining dependency graph.
- `scripts/prepare.sh` applies the checked-in, narrowly scoped wasm32 compatibility patches to the exact upstream pins. These retain 64-bit syscall/ELF semantics on a 32-bit host. See `patches/README.md`; do not omit this step. Native builds may select upstream assembly execution; the browser uses the portable interpreter.

See [verification notes](docs/verification.md) for actual checks run and remaining test gaps. This is an independent integration, not an official Nervos release. Upstream submodules retain their own licenses.

Dependency attribution and unresolved upstream notice gaps are recorded in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Licensing review, like consensus coverage, is not claimed complete for this experimental package.
