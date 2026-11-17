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

The transaction workbench and **JSON request** edit the same request. Open a cell
card to edit its capacity, data and scripts; use the dependency, witness, Context
and Settings editors for the other supplied values. Amounts use integer shannons
and decimal CKB without rounding. Unknown JSON fields and large integer tokens
are preserved. Invalid entries remain available for inspection instead of being
silently repaired; Cancel changes (or Escape) restores the editor session.

**Examples & tools** offers four synthetic samples: Passing snapshot,
Committed-phase snapshot, Selected lock group and Rejecting lock. Choose one and
click **Load sample**. Import accepts a request object or a fixture containing
`request`; export saves only the request. Neither uploads data. Applied changes
are saved as local drafts in this browser on this device; unsaved editor fields
are not backups. Local storage can be cleared or unavailable. Export important
requests explicitly. Editing or loading another input clears stale results.

Run verification with the button or focus it and press Enter. The report shows
the actual scope, cycles and fee only when reported by the engine. Rejections
lead with their explanation and engine error. The complete original response is
available in **Full engine response · JSON**. Requested scope is not proof that
the requested work completed.

For one script group, use Settings → Verification scope, the selected-lock
sample, or `script_group: { group_type: "lock" | "type", script_hash: "0x…" }`
in JSON. This hash identifies the complete script, not just its code. Omit
`script_group` for transaction scope. No consensus or network is inferred.

A successful response is conditional on supplied data. `chain_state_verified`
is false: no canonical chain or live-cell lookup occurs. A selected group's
success does not establish full transaction validity. Engine rejection displays
its actual error code/message. Parsing, transport, initialization and runtime
failures are reported separately.

Each run creates a fresh Worker. Cancel and the 30-second timeout terminate it,
including stalled initialization. Synchronous Worker creation failures are also
reported as execution errors, clear stale results and allow a subsequent retry. Each imported/edited request is limited to
2 MiB. A Worker does not provide an independent memory quota, so these controls
are practical UI limits, not a complete sandbox for hostile workloads.

## Verification and publishing

`npm run test:browser` builds the site from generated WASM and tests it at the
project subpath in Chromium. Tests cover successful submitted/committed requests,
script-group scope, script rejection, malformed JSON, repeated runs, local file
import/export, cancellation and recovery, mobile overflow and WASM resource URLs.
The existing Worker test also verifies execution with browser networking disabled.

The main verification workflow additionally installs Firefox and WebKit and runs
`npx playwright test --config playwright.compat.config.js`. This bounded suite
checks synchronous Worker startup failure/retry, real-WASM success, keyboard
cancellation, and invalid editor Escape/focus recovery. It does not claim the
entire workbench is accepted in every browser or on physical mobile devices.
Evidence is uploaded under the CI `browser-evidence` artifact; compatibility
screenshots have their own `test-results/compatibility` directory.

The `Browser playground` Actions workflow rebuilds and tests WASM and the page
before uploading a Pages artifact, then deploys only `main`. Repository Pages
must use GitHub Actions as its build source. This workflow is independent of npm
publication and does not publish a package or change repository access.

## Transaction workbench

The structured editor and advanced JSON share one request. Edit input/output
capacity and data, reuse or customize lock/type scripts, choose supplied cells as
code dependencies, edit witnesses, and select transaction or script-group scope.
JSON-only extension fields are retained when a structured field changes. Invalid
JSON remains in the editor; malformed entries are diagnosed rather than repaired.

Add/copy input creates a **synthetic unconfirmed cell**, not a live-chain input.
Input removal/reordering does not guess witness associations or remove context
cells. Adjust witnesses explicitly. Output operations keep corresponding data
aligned and refuse mismatched arrays. Capacity arithmetic uses integer shannons;
the displayed difference is not a validated fee. Dependency selection does not
infer code hashes, load binaries, or expand dep groups. Preflight hints do not
replace running the verifier. Arbitrary context remains editable through JSON.

The workbench is static frontend code under `web/`, copied only by the site build.
It adds no core API or npm dependencies and is excluded by the package's explicit
`files` allowlist. Model regression tests run with `npm test`; UI scenarios are
included in `npm run test:browser` and require the generated WASM artifacts.
