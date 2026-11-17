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
