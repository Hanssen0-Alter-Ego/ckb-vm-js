# List controls and header reuse candidate

This candidate changes the frontend only. It does not change package versions,
release tags, publishing workflows, verifier source, or npm targets.

## Changes and data semantics

- Input, output and cell dependency action rails use equal 56 × 44 px buttons,
  6 px gaps and 10 px interior padding. Header list actions use the same dimensions.
- Open inspector disclosures no longer clip their contents, borders or focus rings.
  This addresses the supplied-header template button and nested disclosures.
- Header dependencies can be removed directly from the list. Supplied headers and
  extensions can be removed while their details are collapsed, including malformed
  scalar/null entries. Confirmation explains that removal does not cascade to
  dependency hashes or other references. Cancel changes restores the editor session.
- Header drafts show whether saving will reuse matching context or add a new header.
  Matching headers and matching extension assertions are reused. Repeated dependency
  addition keeps its original position. Conflicting metadata/extensions fail
  atomically with repair guidance; existing ambiguous context is never silently merged.
- Editing a header copy only changes the selected dependency. If another dependency
  already links the requested replacement, the user is told to remove this dependency
  or choose different fields rather than creating another duplicate.
- Context's tip-template action now opens a validated draft before modifying JSON.
  It supplies context only, without adding a transaction dependency. An unchanged tip
  is reused instead of creating context the real verifier rejects as a duplicate.
- Adding an existing code dependency again preserves the existing item and explains
  its position. Witness removal confirms the index shift and restores keyboard focus.

## List audit

| List | Add / duplicate semantics | Edit / sort / remove / recovery |
| --- | --- | --- |
| Inputs | New placeholder outpoints remain distinct; explicit Duplicate remains supported | Existing identity, shared-cell references, witness preservation, confirmation and Undo retained |
| Outputs | Repeated output values are legitimate; no deduplication | Output/data pairs move and remove together; existing Undo retained |
| Cell deps | Existing code dep is reused; new resolved cells keep unique placeholders | Code/dep-group distinction retained; list order, direct removal and nested cancellation retained |
| Header deps | Computed hash reuse; repeated additions are idempotent | Order retained; direct confirmed removal; copy-edit collision explained; Cancel restores |
| Witnesses | Repeated byte values are legitimate; no deduplication | Moves change witness positions only; confirmed deletion; Cancel restores |
| Supplied headers | Template opens draft; unique content is added, matching context reused | Direct removal even while collapsed; references explicitly retained; Cancel restores |
| Extensions | Explicit null differs from bytes; conflicting records are not merged | Raw context editor remains available for malformed/custom requests; direct confirmed removal and Cancel |

Context headers/extensions are keyed by hash, not script-visible ordered transaction
lists; this candidate does not invent sorting semantics for these maps. Editing raw
context may intentionally leave unresolved references; the verifier remains authoritative.

## Executed checks

- JavaScript unit suite: 58 passed.
- TypeScript check: passed.
- Real WASM integration: 66 passed, including duplicate-context rejection followed by
  idempotent header reuse and successful real verification.
- Native/WASM differential: 62 passed.
- Site build, JS syntax and `git diff --check`: passed.
- Browser test collection: 86 tests discovered, including four new candidate scenarios.
- Browser execution: **blocked before first test body**. Installed Chromium exited with
  `process_singleton_posix.cc:297 socket() failed: Operation not permitted` in the
  managed sandbox. Initial default browser launch also failed. This is not a browser pass.
- Cloud browser could not reach the isolated local preview (connection refused).
  Candidate pixels have therefore **not** received visual acceptance. Both supplied
  feedback screenshots were opened and inspected before implementation.

WASM was copied from the existing `vm-candidate-preview-dec0a16/pkg` build; its SHA-256
is `6af2ee3977718b7deb5cdeab4b242b2d673db85ee8cd99d916b28169f6646d87`.
The differential CLI came from `vm-npm-first-release/target/debug/verify` (checkout
`22f7665e09bf630b0bee401f1d7519db2118c85e`). Verifier/API source has no diff from
this candidate's base. Rust compilation, clippy, native unit tests and an unmodified
upstream differential build were not rerun for this frontend-only change.

## Independent browser acceptance required

Serve the candidate's built `site-dist` at `/ckb-vm-js/` with WASM MIME type, or run
`PORT=4189 node tests/browser/server.js` in an environment whose port is reachable.
Verify `version.json` matches the candidate commit before testing. Do not use the
production URL as evidence for this candidate.

1. At desktop, 390 px and 320 px, inspect Inputs/Outputs and Manage cell deps.
   All three action buttons must align with equal dimensions and interior space;
   test disabled boundaries, long capacities, long outpoints, Tab and Enter.
2. Open Context → Supplied headers. Inspect the template button's full border after
   expanding, scrolling and keyboard focus. Repeat nested disclosures and reduced
   motion; check that focus rings are not clipped and closed content stays hidden.
3. Manage header deps → Create header → save unchanged tip. Expect reuse, one
   dependency and no extra supplied header. Repeat Create and Add existing header;
   neither should duplicate the dependency. Run real verification.
4. Create a different header with an explicit extension. Re-enter it exactly; verify
   reuse. Try a conflicting extension and confirm no JSON mutation. Fix the value
   or go Back. Keep unknown fields and large JSON numbers intact.
5. Remove a header dependency directly from its list. Dismiss then accept the
   confirmation. Check focus, unchanged context/extension data, and Cancel changes
   restoring exact JSON. Repeat direct collapsed-context header/extension deletion,
   including an imported null entry and a referenced header requiring repair.
6. Context template creation must not add a transaction dependency. Back cancels
   unsubmitted fields; Save creates only the requested context and extension data.
7. Repeat existing code-dependency addition. Check the informational notice and
   unchanged order. Exercise code/dep-group edits, nested Cancel, and direct Remove.
8. Add equal witnesses, reorder them, remove with both confirmation answers, then
   Cancel. Equal witness values must not be deduplicated and inputs must stay put.
9. Exercise input/output Duplicate, move, Remove/Undo, local draft reload/recovery,
   import/export, unknown fields and exact large integers, and real verification.

Run the full browser suite on the candidate before integration. After deployment,
open a fresh independent conversation for browser acceptance of the deployed SHA.

## Remote CI follow-up

Actions run 43956302523 executed the previously blocked browser suite: 84/86 passed.
It also passed the native checks, fresh WASM build, both differential comparisons,
release guard/workflow validation, JS unit tests and typecheck. The browser failures
identified a real full-precision capacity overflow after widening the action rail,
and an older nested-session test whose setup expected a duplicate code dependency.
The follow-up gives long capacities the full card width with a horizontal action
rail, and selects a different resolved cell in that test while retaining its shared
input/dependency edit and outer rollback assertions. The suite must pass on the
follow-up commit before deployment; automated browser results are not visual acceptance.
