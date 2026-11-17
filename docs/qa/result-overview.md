# Result overview iteration

Base: `5d96728438e074471d8560c2dcd006e5a6ed6cce`.

## Changes

- A visible verdict and primary conclusion lead the report.
- Verified scope, consumed cycles / configured limit, reported snapshot fee, and elapsed time are grouped into a responsive metric row.
- Explanation and exact engine error are visible without opening the JSON response. Error text wraps, with a bounded scroll area for long errors.
- Successful script-group membership opens by default; selected-group verification retains its explicit limited-scope warning.
- Completing a run focuses and scrolls to the result, respecting reduced-motion preference. Changing inputs clears stale data. Canceling an editor restores the report's values and disclosure state.
- Raw JSON remains available as secondary detail. No additional engine claims or chain-state checks are invented.

## Validation

- `npm test`: 58 passed.
- `npm run typecheck`: passed.
- `npm run test:wasm`: 66 passed against real WASM downloaded from the public Pages build, whose version.json identified the exact base above. This checks engine/API behavior, not the visual UI.
- `node --check web/app.js`, `git diff --check`: passed.
- Added a browser regression test for full-transaction pass, selected group scope, script rejection, repeated runs, visible error details, narrow layout and screenshot capture.
- Browser tests could not execute: Chromium failed before loading any page with `socket() failed: Operation not permitted`. An approved escalated attempt had the same error. The normal cloud browser could not reach the local preview and then rejected observation under URL policy. No bypass attempted.
- No screenshots were captured; visual readability, mobile layout and focus/scroll behavior remain unverified. Do not present this iteration as visually accepted or ready for merge until those checks run in an authorized capable environment.

No merge or deployment performed.

## Follow-up: error-first report

The first CI-verified version (`abb428889555b3c9ee34267cb838a3bbeb94910f`, run 44105017491) passed 98 Chromium tests. Its four reviewed images were `evidence/result-success.png`, `evidence/result-failure.png`, `evidence/result-mobile.png`, and **`group-scope-mobile.png` at the artifact root**, not a fourth file in `evidence/`.

Screenshot review prompted this follow-up: explanations and engine errors precede metadata; unreported scope/cycles/fee are hidden instead of dominating rejected runs. Requested scope remains explicitly distinct from verification. Runtime failure, cancellation and timeout show no verification conclusion. The success explanation no longer duplicates the fee metric.

Only an exact upstream InvalidTransaction script-failure message with an HTTPS `nervosnetwork.github.io/ckb-script-error-codes/by-data-hash/<64 lowercase hex>.html#<matching error code>` URL gets a labeled documentation link. It is never fetched automatically. All other URLs remain inert text, and raw JSON retains every original message byte.

Regression coverage now includes failure ordering, missing metrics, safe links, repeated success/failure/runtime/cancel/timeout runs, invalid input, error-report restoration after editor cancellation, and narrow success/failure/selected-group report plus full-page screenshots. Runtime/cancel/timeout tests inject controlled worker responses; the main presentation test uses real WASM.

This follow-up's browser and screenshot acceptance remains pending its own exact-head CI; earlier screenshots do not validate these changes. Local browser restrictions remain in force.
