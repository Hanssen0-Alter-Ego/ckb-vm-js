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
npm install ./hanssen0-alter-ego-ckb-wasm-verifier-0.1.0.tgz
```

```js
import { readFile } from 'node:fs/promises';
import { createVerifier } from '@hanssen0-alter-ego/ckb-wasm-verifier';
const wasm = await readFile(new URL(import.meta.resolve(
  '@hanssen0-alter-ego/ckb-wasm-verifier/wasm',
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

`context.headers`, `context.extensions`, and every cell's `transaction_info` are
required, even when an array is empty. Supply creation headers for the resolved
cells, candidate parent and any header/median-time/DAO dependencies needed by the
transaction. Supply an explicit extension entry with hex data or `null` for each
resolved input/dependency creation block and header dependency. Omission does not
mean “no extension.” `tip_header` is the candidate committed block, not merely the
latest observed chain tip.

A successful result is relative to the caller's snapshot. It has
`chain_state_verified: false`: it does not prove cells are live, header chain
canonicality, chain authenticity, or network acceptance. Cellbase transactions
are unsupported. Use the network's correct context and a cycle budget within its
block limit. Untrusted requests can consume substantial CPU and memory; bound
request size and use a Worker you can terminate for application-level timeouts.

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
