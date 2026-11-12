# JavaScript and TypeScript API

Build the Rust/WASM package before importing the default bindings. The generated
web-target wasm-bindgen files must be under `pkg/`. The package is ESM and includes
TypeScript declarations. `verify` performs no network requests; all transaction
inputs, dependencies and contextual data come from the request.

## Node: explicit offline initialization

```js
import { readFile } from 'node:fs/promises';
import { createVerifier } from './js/index.js';

const wasm = await readFile('./pkg/ckb_wasm_verifier_bg.wasm');
const verifier = await createVerifier({ wasm });
const request = JSON.parse(await readFile('./request.json', 'utf8'));
const result = await verifier.verify(request);
if (!result.ok) console.error(result.error.code, result.error.message);
else console.log(result.scope, result.cycles, result.fee);
```

Pass `Uint8Array`, `ArrayBuffer`, or a compiled `WebAssembly.Module` to initialize
without fetching. Browser initialization without `wasm` loads the packaged WASM
URL. URL/string inputs may fetch during initialization only. Bundlers can supply
`loadBindings: () => import('./generated/ckb_wasm_verifier.js')` to select a custom
binding location.

All CKB integer request and response fields use RPC hex strings, never JavaScript
`number` or `bigint`. Script-group input/output indices are ordinary numbers.

## Install a built tarball

The GitHub CI artifact contains a ready-to-install `.tgz`. No npm registry
release is claimed. After downloading and extracting the CI artifact:

```sh
npm install ./ckb-vm-js-0.2.0.tgz
```

```js
import { readFile } from 'node:fs/promises';
import { createVerifier } from 'ckb-vm-js';
const wasm = await readFile(new URL(import.meta.resolve(
  'ckb-vm-js/wasm',
)));
const verifier = await createVerifier({ wasm });
```

## Verify a script group

```js
const result = await verifier.verifyScriptGroup(request, {
  group_type: 'lock', // or 'type'
  script_hash: '0x' + 'ab'.repeat(32), // replace with the actual script hash
});
```

The selector is a script hash, not a code hash. This returns `scope: 'script_group'`
and verifies the selected group's scripts, after shared request/context checks.
It does not assert that all other groups or all contextual transaction rules pass.
The input request is not mutated. `verify(request)` can also accept `script_group`.

## Browser: keep verification off the UI thread

```js
import { createWorkerVerifier } from './js/index.js';

const verifier = await createWorkerVerifier({ wasm: wasmBytes });
try {
  const result = await verifier.verify(request);
  console.log(result);
} finally {
  verifier.dispose();
}
```

A dedicated ES-module Worker runs the same synchronous WASM engine. No
`SharedArrayBuffer`, pthreads, COOP or COEP headers are needed. The direct API returns
Promises but still runs CPU work on the calling thread. The Worker API keeps the
calling thread responsive; it does not make one verification parallel.

The default Worker URL is `js/worker.js`. A bundler can supply `workerURL`, or a
`worker` implementing the browser Worker interface. The client owns and terminates
caller-supplied Workers too. This helper is for browser Workers; Node users should
use the direct byte-loading API or write a `worker_threads` adapter.

Worker inputs must be structured-cloneable. Pass bytes/module or a URL string,
not a `Response`, `Request`, binding loader function, or URL object. Bytes are
cloned, not detached. Calls are correlated by ID; disposing rejects pending and
future requests. Disposing terminates the Worker, including active WASM work.
A Worker error also terminates it and rejects pending work. Create a new verifier
to restart.

## Snapshot contract and errors

Supply `context.consensus` explicitly. The foundational API has no `network`
selector, bundled network presets, or network-maintenance wrapper. The caller owns
consensus configuration and snapshot freshness. Consensus fields are:

- `tx_version`, `max_block_bytes`, `max_block_cycles`, `cellbase_maturity`, and
  `median_time_block_count`.
- `tx_proposal_window: { closest, farthest }` and `dao_type_hash`.
- `hardforks: { rfc0028_epoch, rfc0032_epoch, rfc0049_epoch, rfc0044_epoch }`.
- `starting_block_limiting_dao_withdrawing_lock`.

Use RPC hex strings for all these values, including activation epochs and limits.
`dao_type_hash` is a 32-byte hash. A cycle budget must be within the supplied
`max_block_cycles`. Pass all fields; the verifier does not infer a network.

`context.tip_header` is the **actual current chain tip**. Verification defaults to
submitted mode when `context.verification` is omitted. You can select it explicitly:

```js
const submitted = await verifier.verify({
  ...request,
  context: { ...request.context, verification: { phase: 'submitted' } },
});
```

For checking inclusion in a specific candidate block, supply committed mode:

```js
const committed = await verifier.verify({
  ...request,
  context: {
    ...request.context,
    verification: {
      phase: 'committed',
      candidate_header: candidateHeader,
      transaction_index: '0x1',
    },
  },
});
```

The candidate must be a direct child of `tip_header`. `transaction_index` must be
positive: position zero is reserved for cellbase. For known same-block inputs, prefer
their actual candidate-block origin and earlier transaction index. This lets the
verifier check ordering within the candidate block.
The existing `valid.json` fixture uses explicit committed mode; `submitted-valid`
exercises the omitted/default mode.

`context.headers`, `context.extensions`, and every cell's `transaction_info` are
required, even when an array is empty. `transaction_info` may be an origin object
with `block_hash`, `block_number`, `block_epoch`, and `index`, or explicit `null`.
Null is a caller assertion that the cell is non-cellbase with an unknown or
unconfirmed origin. It is accepted in both submitted and committed modes, but
does not prove that its producing transaction is valid or establish its position
within a candidate block. Relative-since checks need a known origin and remain
immature without one. Do not omit the field. Prefer real origin metadata for
committed verification, especially for known same-block inputs; the caller remains
responsible for block-wide validity and ordering that null metadata cannot prove.

Supply the creation headers for confirmed resolved cells and any
header/median-time/DAO dependencies needed by the transaction. Supply an explicit
extension entry with hex data or `null` for each required creation block and
header dependency. Omission does not mean “no extension.”

A successful result is relative to the caller's snapshot and supplied consensus.
It has `chain_state_verified: false`: it does not prove cells are live, header
chain canonicality, chain authenticity, or network acceptance. Cellbase
transactions are unsupported. Untrusted requests can consume substantial CPU and
memory; bound request size and use a Worker you can terminate for application-level
timeouts.

Verification rejection returns `{ ok: false, error: { code, message } }`.
Initialization failures, WASM traps, malformed JS/JSON, and Worker transport
failures reject the returned Promise. Handle both outcomes.

## Tests

- `npm test`: mocked JS boundary and Worker protocol unit tests. These do not
  exercise CKB consensus or the WASM engine.
- `npm run typecheck`: check declarations and exported API usage.
- `npm run test:wasm`: require real generated WASM, then run every
  `fixtures/*.json` case shaped as `{ "request": ..., "expected": ... }`.
  Every expected top-level response field is compared deeply. Set
  `CKB_WASM_FIXTURE` to run one fixture file instead. Missing real WASM fails the
  suite; an empty fixture directory is reported as a skipped fixture test.

- `npm run test:browser`: real dedicated Worker verification, with isolation off,
  SharedArrayBuffer absent, and browser networking disabled after initialization.
  Covers default submitted, unconfirmed input, same-block input, explicit
  committed, selected-lock, and rejecting script fixtures. Requires built WASM
  and a supported Playwright browser runtime.
- `npm run test:differential`: compare every fixture's actual native CLI and WASM
  output, normalizing script-group order. Requires both built artifacts.
