# wasm32 compatibility patches

The submodules remain pinned to official upstream commits. `../scripts/prepare.sh` applies these patches locally; a dirty submodule after preparation is expected. The script verifies each pinned commit and is idempotent. It never resets unrelated local edits.

Why patches are necessary: a successful Rust/WASM compilation does not establish consensus compatibility. CKB's native execution host has 64-bit `usize`, whereas wasm32 has 32-bit `usize`. Unchecked conversions of guest u64 values can silently change interpretation.

## CKB patch

- Preserve out-of-bound behavior for u64 indices in cell/header/input/witness/block-extension loads and legacy exec.
- Clamp `SgData` offset/length in u64 before converting to host slice indices.
- Compute legacy exec slice end in u64 before checking bounds.
- Reject unrepresentable DAO witness header-dependency indices instead of wrapping.

## VM patch

- Check ELF64 program-header offsets before conversion, retaining the native invalid-offset error. Empty program-header tables continue to ignore their offset.
- Compare the guest program counter against memory size in u64.
- Prevent a large guest argc from truncating to the zero-argument stack fast path. Unrepresentable nonzero counts saturate the iterator's host length; the existing bounded VM memory/stack errors occur during iteration before such an argument list can finish.

## Evidence

The unpatched WASM accepted the ELF offset and five syscall index boundary fixtures that native upstream rejected. It rejected the large cell-data offset fixture that native upstream accepted. After these patches, the fixture suite matches native upstream on results, errors and successful cycles.

The ELF fixture adds 2^32 to the program-header offset of an existing upstream test ELF. The syscall fixtures use small, documented RV64I test programs generated in `crates/verifier/src/test_support.rs`; they return the syscall status or remaining data length. No cross compiler or network source is needed to reproduce them.

Additional changed paths (DAO index, exec slice arithmetic, decoder bounds and oversized argc) were inspected but do not yet have end-to-end transaction fixtures for every branch. These are scoped compatibility changes, not a claim of complete audit or complete syscall coverage. More native/WASM conformance testing is needed before production use.
