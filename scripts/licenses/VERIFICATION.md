# First-release notice verification

Rechecked 2026-11-17 UTC. The earlier audit conflated **no standalone LICENSE file** with **no license declaration**. Both exact published packages explicitly declare MIT. Cargo defines `license` as the package's license and requires `license` **or** `license-file`; a standard SPDX license does not need a separate file to be declared: [Cargo reference](https://doc.rust-lang.org/cargo/reference/manifest.html#the-license-and-license-file-fields).

The generator now has two narrowly scoped, hash-checked declaration records in `declared-licenses.json`. It reproduces the full [SPDX MIT reference text](https://github.com/spdx/license-list-data/blob/31846481de7ea17d92f2f46fad76abe58b2e9bb0/json/details/MIT.json), including its unfilled copyright template placeholders, and explicitly says that this is reference text, not an original LICENSE file recovered from either package. It does not assign a year or copyright holder. This resolves the inventory's missing standard license text without pretending that author metadata is a copyright notice. All original component notices found are separately preserved. It does not establish the identity of every rightsholder or provide a legal opinion on upstream ownership.

## Exact package and release evidence

### blake2b-ref 0.3.1

- Crate SHA256 and registry checksum both `294d17c72e0ba59fad763caa112368d0672083779cdebbb97164f4bb4c1e339a`; [release metadata](https://crates.io/api/v1/crates/blake2b-ref/0.3.1) declares MIT, published 2022-08-10 by `jjyr`.
- `.cargo_vcs_info.json` pins `f1efc4872d67a8d4c4a57d2d0e16f8b5e53724b9`. All nine comparable original files in the crate match that exact tree (Cargo.toml.orig compared with upstream Cargo.toml; Cargo-generated normalized manifest and bookkeeping excluded).
- The author's [0d5d537cda94a0d97af6e918b3ff3864627aa90d commit](https://github.com/jjyr/blake2b-ref.rs/commit/0d5d537cda94a0d97af6e918b3ff3864627aa90d) explicitly added `license = "MIT"` on 2020-01-20. The exact release retains it. Full fetched history has no LICENSE/COPYING/NOTICE file.
- The precise README credits BLAKE2 and describes the wrapper API as almost copied from blake2b-rs. The latter's then-existing `0.1.5` source at `2e7c9d5e76156cbfdb4e7d90ff7534c27623d5e0` contains [MIT / Copyright (c) 2018 Nervos Foundation](https://github.com/nervosnetwork/blake2b-rs/blob/2e7c9d5e76156cbfdb4e7d90ff7534c27623d5e0/LICENSE). That full original attribution is preserved for the credited upstream component, **not** asserted as ownership of blake2b-ref modifications.
- The exact `src/blake2b_ref.rs` preserves Samuel Neves' 2012 BLAKE2 notice and offers CC0/OpenSSL/Apache alternatives. Its original text is reproduced; CC0 is selected for that component.
- Manifest author `jjy <jjyruby@gmail.com>` is package author metadata only. No package-level copyright notice is invented from it.

### ckb-system-scripts 0.5.4

- Crate SHA256 and registry checksum both `fa5c59063142de7a68cfad4449c6b3863563856219a2925dfb8c5f019ec2aa47`; [release metadata](https://crates.io/api/v1/crates/ckb-system-scripts/0.5.4) declares MIT, published 2021-10-19 by `nervos-bot-user`.
- Upstream `v0.5.4` resolves to `e08e6016f16072fc2f44cf889ae063fa5b7e10c7`. The crate lacks `.cargo_vcs_info.json`. Seven comparable source/build files match this tree; Cargo.toml.orig differs only by seven commented-out Git dev-dependency declarations. The tag's Makefile publication procedure removes these dependencies. Four generated `specs/cells/*` binaries are in the crate but not tracked in that tree. This comparison is not a claim that those generated binaries were independently rebuilt.
- The [4d8ca420257a2d29b18d040dc73a01ca66d78390 commit](https://github.com/nervosnetwork/ckb-system-scripts/commit/4d8ca420257a2d29b18d040dc73a01ca66d78390) added the MIT package declaration with its first publishing setup on 2019-06-19. The exact release and crate retain that declaration. Full fetched history has no package-level LICENSE/COPYING/NOTICE file.
- Existing original bundled BLAKE2 and secp256k1 notices remain preserved. The parent CKB repository also has a Nervos Foundation MIT notice, but shared organization membership alone is not evidence to reassign it as this package's copyright statement. The generator does not do so.
- Manifest author `Nervos Core Dev <dev@nervos.org>` is recorded as author metadata only, not converted into a copyright holder.

## Reproduction and boundaries

```sh
cargo metadata --locked --format-version 1 --filter-platform wasm32-unknown-unknown > metadata.json
python scripts/generate-third-party-notices.py metadata.json
```

Result: **157 packages, 63 distinct notice texts, zero unresolved inventory gaps**. The two declaration fallbacks are visible in the distributed notices. Changed original-manifest or SPDX-text hashes stop generation. Other packages with missing notices are still reported, and live release checks still reject the unresolved-gap marker. Thus this is an evidence-backed correction for two known SPDX declarations, not a general "all missing licenses are MIT" fallback.

Unfiltered metadata contains other-platform dependencies and is not this WASM distribution's inventory. No upstream request or message was sent. No substitute licensing agreement was accepted, and no new ownership assertion was made.
