# Historical pre-release verification

These records describe earlier source revisions, not published npm versions or validation of current code. They are retained for traceability, not as migration instructions.

## Historical v0.1 local execution record (2026-11-12)

- Rust 1.95.0 native check, formatting, tests and Clippy were run.
- 33 transaction fixtures run through the real WASM engine, plus an initialization/invalid-request check.
- Live differential comparison against native, including an unmodified-upstream native binary.
- 11 JavaScript boundary/Worker-protocol tests and TypeScript declarations checked.
- WASM release generated with wasm-bindgen 0.2.105 and WASI SDK 34 clang (only as C compiler, still targeting bare wasm32-unknown-unknown).
- The local environment could not launch Chromium because a required local socket operation was unavailable. Managed-browser access also could not reach the isolated local server. No local real-browser pass is claimed; the committed CI workflow runs the real offline Worker test in Chromium. Check the exact commit's workflow result.

## Historical v0.1 CI browser evidence

The complete workflow passed at engine commit `184af5d80ce8a2798d432c821b475ef03b3f6bc6`:
https://github.com/Hanssen0-Alter-Ego/ckb-vm-js/actions/runs/43139332773

This includes Chromium running a real dedicated Worker with `crossOriginIsolated === false` and no SharedArrayBuffer. After module initialization from localhost, browser networking is disabled before full transaction, selected group and failure fixtures are verified. It also includes native/WASM parity against the separately built **unmodified upstream** native engine. This evidence belongs to that exact earlier commit. In particular, it does not establish that the later foundation-interface refactor passed; inspect the current commit’s checks separately.
