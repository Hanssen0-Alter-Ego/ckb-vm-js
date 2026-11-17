# Execution startup recovery and acceptance inventory

Base: `adc2570bece427f2d51795b8cfb774f9bbf5fb15` (PR #5 already merged and deployed).
The live repository had no open issues or PRs when this bounded follow-up began.

## Existing scope recovered

| Committed requirement | Current implementation / evidence | Remaining boundary |
| --- | --- | --- |
| Offline full transaction and selected script group | Public API, real WASM, differential suite and Worker browser tests | Caller supplies context; no chain-state truth claim |
| Multiple input/output cells | Workbench add/copy/move/remove, explicit Undo and editor cancellation tests | Synthetic placeholders are not live chain cells |
| Scripts, code deps, witnesses | Structured editors and selection, ordered list tests | No inferred witness relationships or dep-group expansion |
| Bidirectional JSON and unknown-field preservation | Lossless JSON model and browser round-trip tests | Intentionally invalid input is retained, not auto-fixed |
| Clear error location | Preflight entity paths, output-data/witness repair actions, actual engine details | Arbitrary engine diagnostics are not mapped to invented fields |
| Context/header editing | Structured reuse/copy/extension tools and raw context JSON | Complete consensus UI and complex since editor are not promised in this slice |
| Persistence | Per-tab local drafts, import/export, cancellation tests | Local storage is not cloud backup |
| Keyboard / cross-browser recovery | Chromium coverage existed; this change adds a bounded Firefox/WebKit contract | Full cross-browser editor sweep, physical devices and screen readers remain gaps |

No new network preset, RPC import, wallet or chain action is introduced. Frontend
code remains under `web/`; the package consumer test inspects the actual tarball
allowlist and exercises the installed exports.

## Selected defect and fix

The Run handler constructed `new Worker(...)` before its try/catch/finally. A
synchronous constructor error (including an unavailable Worker API) bypassed
error reporting and cleanup, potentially leaving the earlier Passed status next
to cleared report values. Existing tests covered asynchronous Worker failure,
not construction failure.

Worker creation and timer setup now run within that existing protected lifecycle.
Cleanup tolerates no Worker having been created. The verifier/core API and input
semantics do not change. Tests inject a constructor SecurityError or unavailable
Worker after a real successful run; they require an execution-error state, no
stale verified metrics, unchanged request, returned focus and successful retry.
Other tests cover keyboard cancel during initialization and invalid numeric cell
editing with Escape restoring exact unknown JSON numbers and trigger focus.

## Local checks

59 unit tests, 66 real-WASM tests, typecheck and the installed Node tarball
consumer passed. The actual tarball passed its path allowlist (no frontend or
browser-test files). Local WASM bytes were reused from the previously verified
base; normal CI rebuilds WASM and is authoritative for browser validation.
No local graphical run or local preview access was attempted.

## Acceptance plan and limits

Run the full Chromium suite and the bounded Firefox/WebKit suite in normal CI,
inspect their uploaded failure/recovery/editor screenshots, and inspect the
actual package contents. Do not use or retry the denied local preview URL.
Public deployment verification follows only after review and normal merge gates.
CI URLs, exact revisions and actual outcomes are recorded in the PR rather than
assuming this planning record is a passing result.

Next concrete acceptance gap: the Firefox/WebKit suite covers lifecycle and one
cell editor only; nested header/extension editor Save/Back/Escape and focus
restoration still need a dedicated cross-browser sweep. Real-device and
screen-reader validation remains distinct from browser automation.
