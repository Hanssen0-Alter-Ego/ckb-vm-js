#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
apply_patch() {
  dir="$1"; expected="$2"; patch="$3"
  [ "$(git -C "$dir" rev-parse HEAD)" = "$expected" ] || {
    echo "Unexpected $dir revision; update submodules to the pinned commits." >&2; exit 1;
  }
  path="$(pwd)/$patch"
  if git -C "$dir" apply --check "$path" 2>/dev/null; then
    git -C "$dir" apply "$path"
  elif git -C "$dir" apply --reverse --check "$path" 2>/dev/null; then
    : # Exact patch is already applied; this operation is idempotent.
  else
    echo "Cannot apply $patch cleanly. Inspect local changes; no files were reset." >&2
    exit 1
  fi
}
apply_patch vendor/ckb 6abb474c1678e67dae0337abeb8bfd77cfb576e3 patches/ckb-wasm32.patch
apply_patch vendor/ckb-vm 7199b96d9f24b51c4c5eba358d64cd4d9bcf8150 patches/ckb-vm-wasm32.patch
