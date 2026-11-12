# 发布与 npm Trusted Publishing

截至 2026-11-12，本次只添加发布流程，**尚未配置 npm 信任关系，也没有替你注册包、创建 GitHub environment、tag、Release 或执行 npm 发布**。`npm pack` 生成本地 tarball，不等于发布。

## 工作流做什么

入口固定为 [`.github/workflows/publish.yml`](../.github/workflows/publish.yml)：

- **Actions → Publish npm package → Run workflow**：选择 `main`，填写已存在的版本 tag，只构建、验证和上传 tarball。不会进入发布 job，也不申请 npm OIDC 身份。
- **发布 GitHub Release**：`release.published` 事件先执行相同构建，再进入 `npm-publish` environment，批准后用 OIDC 发布经过测试的同一个 tarball。
- 普通 push、PR、评论和单独推送 tag 都不会触发 npm 发布。工作流不创建 GitHub Release，不修改账户设置。
- 构建/发布分别运行；发布 job 不安装项目依赖、不重新构建、不执行包生命周期脚本。没有 `NPM_TOKEN`、`NODE_AUTH_TOKEN` secret 或长期 token fallback。

使用 GitHub-hosted Ubuntu、Node 24、固定 npm 11.21.0。Actions 固定到审阅时的完整 commit SHA；发布构建不恢复依赖或编译缓存。npm OIDC 要求至少 npm 11.5.1、Node 22.14.0；当前不支持 self-hosted runner。配置字段和权限规则以 [npm 官方文档](https://docs.npmjs.com/trusted-publishers/)为准。

参考了 [CCC 发布流程](https://github.com/ckb-devrel/ccc/blob/b7babe4c25bdf0cf9f0e2d5a89b8dc6b12a08414/.github/workflows/_publish-packages.yaml)的独立发布环境和构建后发布结构。该版本 CCC 使用 Changesets 和 `NPM_TOKEN`；本项目是单包，因此没有照搬 monorepo、canary/评论触发或长期 token 方案。

## 1. 首次创建 npm 包

Trusted Publisher 是**包级设置**。还不存在的 `ckb-vm-js` 不能凭空配置 OIDC 并直接完成首发。由准备拥有该 npm 包的维护者，在确认名称仍可用并审阅内容后，选择一种方式：

1. **交互式首次发布**：下载已经验证的 `ckb-vm-js-0.2.0.tgz`，在自己的终端登录 npm，完成需要的 2FA，再发布该文件。
2. **先暂存创建包**：新版 npm 支持用交互式会话执行 `npm stage publish` 来创建新包。第一版进入待审批队列，维护者批准后才可安装。创建包之后就能管理设置和配置 Trusted Publisher。这不是匿名/OIDC 自动首次注册。[官方新包暂存说明](https://github.blog/changelog/2026-10-02-npm-staged-publishing-now-supports-creating-new-packages/)

只有在你准备实际发布时，才自行运行以下示例，二选一：

```sh
# 使用当前受支持的 Node/npm，先在自己的终端完成登录。
npm login --registry=https://registry.npmjs.org

# A：直接首次发布；这会产生真实的公开 npm 版本。
npm publish ./ckb-vm-js-0.2.0.tgz --access public --ignore-scripts

# 或 B：创建并暂存第一版；之后到 npm 审阅并批准。
# 需要支持 stage 的新版 npm，详见官方 staged publishing 文档。
npm stage publish ./ckb-vm-js-0.2.0.tgz --access public
```

本工作流要求已有一个**公开可读的 bootstrap 版本**。如果使用暂存方式，请先批准第一版，再用下一个版本验证自动发布。工作流遇到 registry 404 会明确停止，不会降级到 token 或自动注册。读取 registry 的错误也不会被当作“版本不存在”。

已发布的包名/版本组合不能再次使用。若先发布了 `0.2.0`，第一个 OIDC Release 应使用新版本，例如 `0.2.1`，不能再发布 `v0.2.0`。[npm publish 规则](https://docs.npmjs.com/cli/v11/commands/npm-publish/)

发布前仍应审阅实验性验证范围及 [第三方许可证 notice 缺口](../THIRD_PARTY_NOTICES.md)。自动化和 provenance 不会代替代码或许可证审查。

## 2. GitHub 配置（仓库管理员完成）

在 `Hanssen0-Alter-Ego/ckb-vm-js` 的 **Settings → Environments**：

1. 创建名称恰好为 **`npm-publish`** 的 environment。
2. 配置 required reviewers，建议禁止发布发起者自行批准；如使用 tag 限制，允许版本 tag `v*`，不要仅允许 `main` 分支，因为 live job 的 ref 是 release tag。
3. 保护 `main` 和版本 tag，限制谁可以创建、移动或删除发布 tag。

不需要创建 npm token secret，也不需要将仓库默认 `GITHUB_TOKEN` 改成写权限。YAML 仅给发布 job `id-token: write`，其他 job 只有 `contents: read`。Environment 的审批/分支规则需由管理员实际设置，写入 YAML 的 environment 名本身不会建立审批保护。[GitHub environment 文档](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)

## 3. npm 配置（npm 包维护者完成）

在 npm 的 `ckb-vm-js` 包页面进入 **Settings → Trusted publishing**，添加 GitHub Actions：

| 字段 | 值 |
| --- | --- |
| Organization or user | `Hanssen0-Alter-Ego` |
| Repository | `ckb-vm-js` |
| Workflow filename | **`publish.yml`**，不要填写 `.github/workflows/` 前缀 |
| Environment name | **`npm-publish`** |
| Allowed actions | **勾选 Allow npm publish** |

当前新配置默认允许 staging；本 workflow 执行直接 `npm publish`，只保留 stage-only 会失败。不需要另外允许 `npm dist-tag`，这里没有调用该命令。仓库、文件名、environment 大小写必须一致。`package.json.repository.url` 已与此仓库一致。[Trusted Publisher 设置](https://docs.npmjs.com/trusted-publishers/)

**在准备好下一版时再创建信任关系**：新配置需在 48 小时内完成第一次成功发布，否则会过期，需要删除后重新创建。第一次成功后，信任绑定到仓库的不可变身份。保存表单不代表已经验证成功。[官方过期规则](https://github.blog/changelog/2026-10-02-unvalidated-npm-trusted-publishing-configurations-now-expire/)

公共仓库的公共包通过 OIDC 发布可以生成 provenance。工作流显式启用了 `--provenance`；它证明来源和构建关联，不证明软件安全或共识正确。[Provenance 文档](https://docs.npmjs.com/generating-provenance-statements/)

验证 OIDC 真正工作以后，可以再考虑 npm 的 “Require two-factor authentication and disallow tokens” 设置；本次没有修改这些设置或创建/撤销任何 token。

## 4. 日常发版

以 `0.2.1` 为例，由维护者完成：

1. 更新 `package.json` 和 `package-lock.json` 的版本，例如 `npm version patch --no-git-tag-version`。提交并合入 `main`，等待普通 CI 通过。
2. 给该 commit 创建 `v0.2.1` tag 并推送。tag 必须精确等于 `v` + npm 版本，指向 `main` 历史中的 commit，且包含此发布工作流和脚本。不要移动已用过的 tag。
3. 可先手动运行 `Publish npm package`，选择 `main`、输入 `v0.2.1`，下载并检查 dry-run artifact。
4. 发布该 tag 对应的 GitHub Release，或将草稿 Release 发布。稳定版本不要勾 prerelease；例如 `0.3.0-rc.1` 必须勾 prerelease。
5. 等待完整 native/WASM/browser 验证和 tarball 安装测试；审批 `npm-publish` environment。
6. 检查 Actions 与 npm 上的版本/provenance。npm 的发布扫描可能延迟可安装时间，成功提交不一定立即可安装。[发布扫描说明](https://github.blog/changelog/2026-07-28-npm-publish-time-malware-scanning-and-dual-use-metadata/)

稳定版本使用 `latest`，预发布使用 `next`。检查器拒绝版本重发、错误包名/仓库、lockfile 不一致、Release 类型不一致、tag 移动、非 main commit、tarball 摘要变化和 dist-tag 倒退。使用同一个并发组串行处理发布，避免两个版本同时争抢 `latest`。

## 故障与验证边界

- `ENEEDAUTH`：检查 npm CLI/runner、`id-token: write`、四项 trust 字段、Allow npm publish、48 小时窗口；不要临时塞入一个长期发布 token。
- 第一次手动 dry-run 成功**不证明 OIDC 已配置**：该模式刻意不申请发布身份，也不写 registry。
- 发布调用超时或结果不明确：先查 npm 和 Actions 输出，确认是否已经接受该版本，不要盲目重发。已公开的版本不可覆盖，registry 检查会停止重复发布。
- 如构建成功、发布 job 失败，先排查配置/状态，再选择 GitHub 的“重跑失败 jobs”；不要假设重新打包的文件与此前测试文件相同。
- 维护检查包括 release guard 单元测试、Actionlint 和离线包安装；普通 CI 会从源码重新构建并验证 native/WASM/browser，结果以对应 commit 的检查为准。没有执行真实 `npm publish`、创建远端 tag/Release、配置 environment 或 npm trust，因此首次 OIDC 发布仍须由维护者配置后验证。
