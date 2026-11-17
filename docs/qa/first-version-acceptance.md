# First-version acceptance boundary

Baseline: `581e3eebf11701cdde995d10dba20b072fea9cfe` (PR #7).
No open issues or PRs were present at the start of this final bounded pass.
This is the composable offline transaction workbench milestone, not a new release,
security audit or claim that a supplied snapshot is authentic chain state.

## Finite acceptance checklist, in priority order

1. **Shared-cell dependency sessions and reference focus.** In actual public
   cloud Chrome at Build `581e3eebf1`, changing dependency 0's output index and
   pressing Enter on Apply reference moved focus to Save; a second Enter saved
   the child and returned to the manager. Restore focus to the replacement Apply
   control, then test shared reference propagation, rejected collisions, repeated
   Enter, child Save/Cancel/Escape, new invalid-cell rollback, outer rollback/save
   and the input editor using that same reference control.
2. **Core/frontend isolation and exact-revision CI.** Run the existing native,
   WASM, differential and installed tarball consumer checks; full Chromium plus
   the bounded Firefox/WebKit suites. Inspect actual screenshots from that run.
3. **Normal deployment and public behavior.** After review and merge, check the
   existing Pages deployment and repeat the fixed reference interaction on the
   public build. Respect the denied localhost preview boundary.

The first item is covered by `tests/browser/nested-dependencies.spec.js` at a
390 × 650 viewport. The compatibility configuration includes this file alongside
execution lifecycle and nested headers. CI results and inspected build IDs belong
in the PR verification record; this checklist does not assert a pending run passed.

## Previously committed first-version scope

| Requirement | Implementation and software evidence |
| --- | --- |
| Offline full transaction and selected script group | Core exports, real WASM, native differential oracle, Worker and package consumers; caller supplies context |
| Multiple inputs/outputs | Workbench add/copy/reorder/remove/Undo and session tests in `workbench.spec.js` |
| Script/dependency selection and witnesses | Structured controls, supplied cell sharing, script-group scope, ordered list and witness preservation tests |
| Bidirectional JSON | Lossless model, import/export, large-number/unknown-field round trips and exact cancellation tests |
| Intentionally invalid requests | Invalid fields/JSON remain available; preflight and engine diagnostics do not silently repair them |
| Clear results and error location | `result-overview.spec.js`, actual engine errors, attempted-versus-verified scope, incomplete/cancel/repeat-run clearing |
| Browser execution recovery | `execution-lifecycle.spec.js`: real success, blocked/unavailable Worker, cancel and retry |
| Nested editor keyboard recovery | `nested-headers.spec.js` and this dependency pass; focus, Apply/Save distinctions and rollback |
| Frontend/core isolation | Actual tarball allowlist and installed Node/browser/Worker/types consumer in `scripts/test-package.mjs` |

Once the three checks above pass, no further implementation item is required to
close the **defined first-version software scope**. Do not keep inventing cosmetic
passes or new browser cases as new product commitments. New reproducible defects
can be tracked normally without treating this milestone as perpetually unfinished.

## Explicit limits, not hidden implementation promises

- Firefox/WebKit coverage is a bounded recovery contract, not every workbench
  path. Chromium has the full automated suite. Physical mobile devices, real
  Safari installations, browser extensions and screen readers have not been
  accepted. Narrow viewport automation is not a substitute for those checks.
- There is no claim of a full accessibility audit, production hardening or a
  security audit of the VM. Preserve the README's experimental status.
- Complex since UI, complete header/consensus UI, live chain import, network
  selection, RPC, wallets and on-chain operations are future product choices,
  not missing requirements for this first-version milestone.
- npm publication, tags and permission changes are not part of this acceptance.
