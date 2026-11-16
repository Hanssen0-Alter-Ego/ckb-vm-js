# 从 clone 到本地首次发布 0.2.0

这份说明针对维护者用自己的 npm 账号完成首次公开发布。**只 clone 后运行 `npm install` / `npm pack` 不够**：仓库不提交生成的 `pkg/`，必须先构建 WASM，再测试实际 tarball。任何一步失败都先停止，不要继续 publish。

## 平台与工具

本次实际验证环境为 **Linux x86_64**，Node 24、Rust 1.95.0、wasm-bindgen 0.2.105、WASI SDK 34 的 clang，以及 Playwright Chromium Headless Shell。普通 CI 使用 Ubuntu 24.04、Node 22 和系统 clang。npm 包运行时声明 Node >=20，不等于所有构建主机均已测试。

- Ubuntu/Debian：安装原生 C 编译器、Git、curl、tar、Python 3；例如 `sudo apt-get update && sudo apt-get install -y build-essential pkg-config libssl-dev git curl ca-certificates python3`。下文单独安装的 WASI SDK 提供 WASM clang。
- macOS：先安装 Xcode Command Line Tools（`xcode-select --install`，如弹出协议由你自己完成），以及 Git、curl、tar、Python 3。原生 Rust 构建用 Xcode 的 C 工具链；WASM 部分用下文按 Intel / Apple Silicon 区分的 WASI SDK。**这些 macOS 命令按官方 SDK 资产写出，本次没有在 macOS 实机验证。**
- Windows：本次没有验证原生 Windows 构建；建议在 WSL2 Ubuntu 中执行 Linux 路径。
- 安装 [Node.js 24](https://nodejs.org/en/download) 和 [rustup](https://rustup.rs/)，重新打开终端后确认 `node --version`、`npm --version`、`rustup --version` 可用。Rust 的具体版本和组件由仓库 `rust-toolchain.toml` 固定；不要仅安装发行版的旧 cargo。
- 构建会下载 Git 子模块、Cargo/npm 依赖和浏览器，需要网络及数 GB 可用磁盘空间。普通 Node/npm 包消费者不需要这些编译工具。

## 1. 克隆准备分支

```sh
git clone --branch prepare/npm-first-release --recurse-submodules \
  https://github.com/Hanssen0-Alter-Ego/ckb-vm-js.git
cd ckb-vm-js
git rev-parse HEAD
git submodule status --recursive
```

将 HEAD 与交接中报告的远端完整 SHA 对照。不要切回尚未集成发布准备改动的 main。若最初忘了 `--recurse-submodules`，补跑 `git submodule update --init --recursive`。以下原生对照构建要求**全新、尚未执行 prepare.sh 的子模块**；脚本会在后续有意打补丁，之后看到两个 vendor 子模块有修改属于预期，不要把它们作为新 gitlink 提交。

## 2. 安装固定工具链和 WASM clang

在仓库根目录执行。下面的脚本选择官方 WASI SDK 34 资产，并按发布资产的 SHA256 校验；未列出的主机直接停止。

```sh
set -eu
rustup show
cargo install wasm-bindgen-cli --version 0.2.105 --locked
wasm-bindgen --version
npm ci --ignore-scripts

case "$(uname -s)/$(uname -m)" in
  Linux/x86_64)
    sdk_host=x86_64-linux
    sdk_sha=b761e3a0721dbae9c09a0059e5fdb2bf917d1b4a8a7b430fb3b5aafb0984b2c4 ;;
  Linux/aarch64|Linux/arm64)
    sdk_host=arm64-linux
    sdk_sha=f7e243dff54d60bcc576e94d6166b69f410f2500ae4a9ceef34315be10e77971 ;;
  Darwin/x86_64)
    sdk_host=x86_64-macos
    sdk_sha=87d27fa8adc68dee59bfbf2e22a6d34ef717c34d6bf1d8af2a56fc929d9ce0eb ;;
  Darwin/arm64)
    sdk_host=arm64-macos
    sdk_sha=9c59398106b417f8f14913380fdf0097a8cc0ff4af9eb3ce0065a859e88d49e9 ;;
  *) echo '此主机未列入本说明；先确认官方 SDK 和构建支持。' >&2; exit 1 ;;
esac
mkdir -p .local-tools
sdk_archive=".local-tools/wasi-sdk-34.0-${sdk_host}.tar.gz"
curl -fL --retry 3 \
  "https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-34/wasi-sdk-34.0-${sdk_host}.tar.gz" \
  -o "$sdk_archive"
python3 - "$sdk_archive" "$sdk_sha" <<'PY'
import hashlib, pathlib, sys
actual = hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest()
if actual != sys.argv[2]:
    raise SystemExit('WASI SDK SHA256 mismatch; stop')
print('WASI SDK SHA256 OK')
PY
tar -xzf "$sdk_archive" -C .local-tools
export CC_wasm32_unknown_unknown="$PWD/.local-tools/wasi-sdk-34.0-${sdk_host}/bin/clang"
"$CC_wasm32_unknown_unknown" --version
```

来源：[WASI SDK 34 官方发布](https://github.com/WebAssembly/wasi-sdk/releases/tag/wasi-sdk-34)。这里只使用它的 clang 来编译上游 C 代码；Rust 目标仍是 **`wasm32-unknown-unknown`，不是 WASI**。也可使用支持 WebAssembly target 的系统 LLVM clang 并设同一环境变量；macOS 的 Apple clang 不应被直接当作已经验证的 WASM clang。若新开终端，需重新设置 `CC_wasm32_unknown_unknown`。

## 3. 构建并验证源码

先构建未打兼容补丁的原生对照，再准备实际构建：

```sh
set -eu
cargo build --locked -p ckb-wasm-verifier --bin verify
cp target/debug/verify target/verify-upstream
./scripts/prepare.sh
cargo fmt --all -- --check
cargo clippy --locked -p ckb-wasm-verifier --all-targets --no-deps -- -D warnings
cargo test --locked -p ckb-wasm-verifier
cargo build --locked -p ckb-wasm-verifier --bin verify
npm test
npm run typecheck
./scripts/build-wasm.sh
npm run test:wasm
npm run test:differential
CKB_NATIVE_VERIFY="$PWD/target/verify-upstream" npm run test:differential
```

`build-wasm.sh` 再次调用 prepare.sh 是幂等操作。若在已打补丁的 checkout 中重新跑第一行，所得对照就不是未修改上游；需要重新验证该对照时使用新的 clone，不要强制清除自己已有改动。

浏览器验证：

```sh
# Linux（可能由 Playwright 调用 sudo 安装浏览器系统依赖）：
npx playwright install --with-deps chromium --only-shell
# macOS 用这一行替代上一行：
# npx playwright install chromium --only-shell
npm run test:browser
```

这里使用项目锁定的 Playwright 版本及其官方 headless-shell，不必另外设置浏览器可执行路径。浏览器缓存或临时目录空间不足时，可将 `PLAYWRIGHT_BROWSERS_PATH` 和 `TMPDIR` 指向自己有空间的目录；安装及测试应使用相同变量。

## 4. 打包一次，验证将要发布的同一文件

```sh
set -eu
test -s pkg/ckb_wasm_verifier_bg.wasm
test -s pkg/ckb_wasm_verifier.js
test -s pkg/ckb_wasm_verifier.d.ts
node --input-type=module -e '
  import fs from "node:fs";
  const p = JSON.parse(fs.readFileSync("package.json"));
  if (p.name !== "ckb-vm-js" || p.version !== "0.2.0") throw Error("Unexpected first-release identity");
'
npm pack --ignore-scripts
node scripts/test-package.mjs
RELEASE_TAG=v0.2.0 node scripts/release.mjs artifact
cat dist/SHA256SUMS
tar -tzf dist/ckb-vm-js-0.2.0.tgz
```

`test-package.mjs` 将该 tarball 安装到空 consumer，验证文件清单、Node 实际 WASM、公开类型、浏览器和真实 Worker，覆盖四处 optional hash 的接受及 mismatch 拒绝。首发前应跑完整模式，不能用 `--node-only` 代替。`release.mjs artifact` 只复制文件并记录摘要，不要求创建 tag，也不会发布。

你的工具链、平台和这次新增文档可能使本地 tarball 摘要不同于之前提供的下载包；**不要把旧下载包 SHA 当成本地构建的必然值**。保留自己这次验证过的 `dist/` 文件与 SHA256SUMS，后面发布它，不重新 pack。Linux 可以用 `(cd dist && sha256sum -c SHA256SUMS)`；macOS 可用 `(cd dist && shasum -a 256 -c SHA256SUMS)`。

## 5. 你在本地执行首次 npm 发布

首发使用你自己的 npm 账号。先检查 `0.2.0` 是否已经公开存在；仅明确 HTTP 404 才表示当前公开查询未找到，网络/认证错误不能当作不存在。404 也不保证名称可以由你认领。

```sh
node --input-type=module -e '
  const r = await fetch("https://registry.npmjs.org/ckb-vm-js/0.2.0", { signal: AbortSignal.timeout(20000) });
  if (r.status !== 404) throw Error(r.ok ? "0.2.0 already exists: stop" : `Registry HTTP ${r.status}: stop`);
  console.log("No public 0.2.0 found; account/name permission still needs verification");
'
npm login --registry=https://registry.npmjs.org
npm whoami --registry=https://registry.npmjs.org
```

确认 whoami 是你希望拥有包的账号，包名仍为 `ckb-vm-js`、版本为 `0.2.0`，完成 npm 要求的 2FA 后，**以下命令会真正公开发布**：

```sh
npm publish ./dist/ckb-vm-js-0.2.0.tgz \
  --access public --ignore-scripts --registry=https://registry.npmjs.org
npm view ckb-vm-js@0.2.0 version dist.integrity --registry=https://registry.npmjs.org
```

不要向聊天发送 npm token。遇到名称占用、无权限或版本已存在就停止，不要擅自改包名、覆盖或重复发布。若发布调用超时，先检查 registry 和 npm 页面确认是否已接受该版本；不要盲目重发。本地交互式首发不加 CI 专用的 `--provenance`，不能宣称已有 OIDC provenance。

## 6. 后续交给 Trusted Publisher

先由协调者把准备分支集成到 main，并核对 CI；本地首发不要求把 0.2.0 的 Release 再发布一遍。GitHub 管理员创建/检查 **`npm-publish`** environment，配置 required reviewers，并允许版本 tag `v*`。

在 npm 包 Settings → Trusted Publisher 中选择 GitHub Actions：

| 字段 | 值 |
| --- | --- |
| Owner | `Hanssen0-Alter-Ego` |
| Repository | `ckb-vm-js` |
| Workflow filename | `publish.yml` |
| Environment | `npm-publish` |
| Allowed actions | Allow npm publish |

不创建长期 npm token。等下一版准备好时配置 trust，并在首次信任验证窗口内完成成功发布；不要把本地 bootstrap 的 0.2.0 再作为自动发布版本。下一次用新版本（例如 0.2.1），版本文件和 lockfile 一起更新，集成后才按 [发布指南](publishing.md)创建 tag/Release、审批 environment、核查 provenance。这些远端设置和实际 OIDC 发布尚须另行验证。
