# Browser playground

The `web/` application runs the real `createWorkerVerifier` API. No wallet, RPC
endpoint, private key or transaction broadcaster is involved. The four bundled
examples are synthetic fixtures with custom consensus, not network presets.

## Build and serve

Initialize the pinned submodules and build WASM as described in the repository
build instructions, then:

```sh
npm ci
node scripts/build-site.mjs
node tests/browser/server.js
```

Open `http://127.0.0.1:4178/ckb-vm-js/`. The same `site-dist/` directory is uploaded
to Pages. JavaScript, Worker, WASM, fixtures, CSS and documentation use relative
URLs so the project subpath works without rewrite rules or isolation headers.
The builder refuses to proceed without real generated WASM and bindings.

## Interaction

The default guided mode needs no JSON. Pick a valid transfer, overspend, low
cycle-budget or deliberately rejecting toy-lock experiment. Enter the new cell's
capacity in decimal CKB and select a cycle budget, then click **Run verification**.
Amounts are converted with BigInt, preserving all eight decimal places. Results
show plain-language explanations, decimal cycles and CKB fees from the actual
engine response. Raw requests and responses stay in expandable advanced sections.

Guided controls generate only the bundled synthetic fixtures. They are not a
wallet or general transaction builder. Importing, editing JSON or loading a
developer fixture explicitly disables the guided fields; selecting an experiment
resets to guided mode. Invalid guided amounts cannot run or export a stale request.

In Advanced mode, choose a sample and click **Load sample**, or edit/import JSON. Import accepts a request object or a fixture containing
`request`; export saves only the request. Neither operation uploads data. Input
is kept in page memory and is lost on reload. Editing clears stale output.

To check only a script group, use the selected-lock sample or supply
`script_group: { group_type: "lock" | "type", script_hash: "0x…" }` in the request.
The hash identifies the complete script, not just its code. Omit `script_group`
for transaction scope. The advanced mode passes the request to the existing API unchanged;
it does not inject consensus or infer a network.

A successful response is conditional on supplied data. `chain_state_verified`
is false: no canonical chain or live-cell lookup occurs. A selected group's
success does not establish full transaction validity. Engine rejection displays
its actual error code/message. Parsing, transport, initialization and runtime
failures are reported separately.

Each run creates a fresh Worker. Cancel and the 30-second timeout terminate it,
including stalled initialization. Each imported/edited request is limited to
2 MiB. A Worker does not provide an independent memory quota, so these controls
are practical UI limits, not a complete sandbox for hostile workloads.

## Verification and publishing

`npm run test:browser` builds the site from generated WASM and tests it at the
project subpath in Chromium. Tests cover successful submitted/committed requests,
script-group scope, script rejection, malformed JSON, repeated runs, local file
import/export, cancellation and recovery, mobile overflow and WASM resource URLs.
The existing Worker test also verifies execution with browser networking disabled.

The `Browser playground` Actions workflow rebuilds and tests WASM and the page
before uploading a Pages artifact, then deploys only `main`. Repository Pages
must use GitHub Actions as its build source. This workflow is independent of npm
publication and does not publish a package or change repository access.
