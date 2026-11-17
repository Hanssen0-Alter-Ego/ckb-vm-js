# Nested header and extension keyboard acceptance

Base: `5755e82f48e29326c214b165f2334f67ae794ea4`; no open PRs at start.

## Confirmed defect

On the public Pages build `5755e82f48`, actual cloud Chrome interaction opened
Manage header deps, linked the supplied tip, opened dependency 0, selected
extension bytes, entered `0x1234`, and pressed Enter on Apply extension
information. The new value was visible, but focus jumped to outer Save. Another
Enter could finish the whole session unintentionally. Cancel changes restored
the starting request and returned focus to Manage header deps.

The Apply handler refreshes the dialog. It now restores focus to its replacement
Apply button and brings that button into view. No request, header hash, extension,
consensus, core API or WASM semantics change.

## Regression contract

The full Chromium suite and bounded Firefox/WebKit suite run
`tests/browser/nested-headers.spec.js` at a 390 × 650 viewport:

- invalid extension bytes remain uncommitted and focused; valid Apply preserves
  focus and repeat Enter cannot activate outer Save;
- Back retains applied bytes, outer Escape restores exact JSON (including an
  unknown integer beyond the safe JS number range), explicit Save retains bytes;
- bytes-to-null is explicit and outer cancellation restores the prior bytes;
- new header Back/Escape discard only that draft; editing a copy preserves tip
  context; outer Escape restores the whole session;
- Context header drafts validate extension bytes, return focus to their add
  trigger, preserve a previously saved draft when a later draft is cancelled,
  and save context without silently adding transaction dependencies.

Screenshot artifacts capture applied-extension focus, the outer header session,
and nested Context return. CI and actual inspection results are recorded in the
PR. This file defines acceptance, not a claim that pending tests have passed.
Actual tarball consumer checks remain required for core/frontend isolation.
No denied localhost access is used.

## Remaining scope

This does not constitute real-device or screen-reader acceptance. The next
specific untested cross-browser path is nested **cell dependency** create/edit,
Back/Cancel and reference-change focus, especially when multiple dependencies
share a supplied cell. Existing Chromium tests cover it; Firefox/WebKit do not.
