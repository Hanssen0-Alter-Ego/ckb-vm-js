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

### Completed second-round validation

[CI run 44107370625](https://github.com/Hanssen0-Alter-Ego/ckb-vm-js/actions/runs/44107370625) passed for PR head `2582ba8547750cd6cc890bc281a748e84fc706e3`: 59 unit tests, typecheck, native/WASM and differential checks, 102 Chromium browser tests, package consumer checks, and artifact round-trip.

The pull-request workflow built GitHub's **test merge** `a0294cb143adcdf1349edd6de7af9c7931c7b419` of that head into base `5d96728438e074471d8560c2dcd006e5a6ed6cce`. This is the build identifier shown in the screenshots; it was not a direct head checkout or a merge into main.

[Browser artifact 14338438953](https://github.com/Hanssen0-Alter-Ego/ckb-vm-js/actions/runs/44107370625/artifacts/14338438953) was downloaded and its SHA-256 verified: `ced1153f863c3d68f69ef3729412e0f6bc7c00723321b6794b6a52a126f7d4ae`. Reviewed desktop success/failure reports and narrow success/failure/selected-group reports, plus all three corresponding narrow full-page views under `evidence/`. Independent review also inspected desktop success/full-page, narrow failure/full-page and selected-group images. Error details precede metadata, unavailable metrics are absent, requested and verified scopes remain distinct, and the report follows the run controls without clipping in these views.

The previous four-image claim was accurate: independent inspection also confirmed `group-scope-mobile.png` at the earlier artifact root. It is outside the `evidence/` directory.

### Final divider cleanup

Second-round screenshots showed the metrics' bottom border followed by the group details' top border. Remove only the redundant group divider and its top margin, retaining the metric border and section spacing. Final CI and screenshot review for this CSS-only cleanup are recorded on PR #5; the completed second-round results above remain tied to their stated revision.

Local browser restrictions remain in force and were not bypassed. Coverage is Chromium/fixture-specific; cross-browser, screen-reader and reduced-motion acceptance are not claimed. PR remains Draft; no merge or deployment performed.
