#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
./scripts/prepare.sh
command -v cargo >/dev/null || { echo 'Install Rust 1.95 using rustup first.' >&2; exit 1; }
command -v wasm-bindgen >/dev/null || { echo 'Run: cargo install wasm-bindgen-cli --version 0.2.105 --locked' >&2; exit 1; }
[ "$(wasm-bindgen --version)" = 'wasm-bindgen 0.2.105' ] || { echo 'wasm-bindgen-cli must be 0.2.105.' >&2; exit 1; }
# secp256k1-sys needs clang for its C code. The Rust target stays bare WASM,
# not WASI. WASI SDK clang can also be used via CC_wasm32_unknown_unknown.
export CC_wasm32_unknown_unknown="${CC_wasm32_unknown_unknown:-clang}"
cargo build --locked -p ckb-wasm-verifier --lib --target wasm32-unknown-unknown --release
wasm-bindgen target/wasm32-unknown-unknown/release/ckb_wasm_verifier.wasm --target web --out-dir pkg --typescript
