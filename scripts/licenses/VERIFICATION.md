# First-release notice verification

Checked 2026-11-17 UTC against the locked WASM dependency graph:

```sh
cargo metadata --locked --format-version 1 --filter-platform wasm32-unknown-unknown > metadata.json
python scripts/generate-third-party-notices.py metadata.json
```

This yields 157 third-party packages, 62 distinct notice bodies and two unresolved package-level MIT notices. Unfiltered metadata includes dependencies for other platforms; it is not the inventory used for this WASM distribution.

- `blake2b-ref 0.3.1`: the published crate's `.cargo_vcs_info.json` identifies `f1efc4872d67a8d4c4a57d2d0e16f8b5e53724b9`. Its [exact source tree](https://github.com/jjyr/blake2b-ref.rs/tree/f1efc4872d67a8d4c4a57d2d0e16f8b5e53724b9) has no LICENSE/COPYING/NOTICE file; neither does the crate archive. The MIT declaration and author metadata are not a substitute for a complete original notice. The BLAKE2 copyright and offered CC0 option in `src/blake2b_ref.rs` are now reproduced by the generator. They cover that bundled component, not a guessed license for the Rust wrapper.
- `ckb-system-scripts 0.5.4`: upstream tag `v0.5.4` resolves to `e08e6016f16072fc2f44cf889ae063fa5b7e10c7`. Its [exact source tree](https://github.com/nervosnetwork/ckb-system-scripts/tree/e08e6016f16072fc2f44cf889ae063fa5b7e10c7) and published crate have no package-level LICENSE/COPYING/NOTICE file. The crate does not include `.cargo_vcs_info.json`; the tag is an upstream release reference, not proof that the entire crate archive equals that tree. Existing bundled BLAKE2/secp256k1 notices remain preserved.

Do not replace these gaps with another project's copyright holder or generic MIT template. Obtain the original complete notices or explicit clarification from the respective upstream maintainers, then update source snapshots and regenerate. No upstream message was sent by this verification. Live release checks refuse the known unresolved-gap marker both before building and in the tested tarball before publication.
