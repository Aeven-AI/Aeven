# Agent Note：依赖补丁让位于自有的安装脚本

Status: implemented

## Problem

`patches/` 里留着三个 pnpm 补丁，而每个 Desktop 发布目标都在 seed 安装阶段失败，报 `[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: msedge-tts@2.1.1`：pnpm 11 拒绝既未允许也未拒绝的依赖生命周期脚本，而 seed 生成的 workspace 文件两者都没有写。三个补丁中有两个只是为了让它所补的依赖自带安装脚本在不受支持的平台上活下来——这类修复本来就该落在我们自己的代码里。

## Decision

**`app-builder-lib` 补丁删除，换成版本升级。** 该补丁让 pnpm 模块收集器遍历同一 `name@version` 每次出现处的子节点，因为 pnpm 只完整打印重复子树一次。`electron-builder` 26.18.1 已在上游修好：带 `dedupedDependenciesCount` 的条目改为从包自身的 `package.json` 解析依赖，而不是从列表输出解析。直接固定 `app-builder-lib` 版本的那条依赖随之删除，`THIRD_PARTY_NOTICES` 也不再记录该补丁。

**`@googleworkspace/cli` 补丁删除，换成我们运行的安装脚本。** 该包没有 Windows on ARM 的构建，其安装脚本会拒绝该主机三元组。改由 `@aeven/host-account-integrations` own 这个二进制：`scripts/ensure-gws.mjs` 把主机映射成目标三元组——Windows on ARM 用模拟运行的 `x86_64-pc-windows-msvc` 构建，Linux 上检测 musl——下载发布产物、校验其 `.sha256`，并把可执行文件写到连接器已经通过 `GWS_BIN` 指明的路径。该包自带的构建脚本在 workspace 与生成的 Desktop seed 中都被拒绝运行，因为它在 Windows on ARM 上会直接抛错而不是回退。

**朗读提供方改成 Aeven 自有的客户端。** `@aeven/text-to-speech-edge` 原本靠补丁把 `msedge-tts` 指向 `api.msedgeservices.com`。现在 `src/edge-tts.ts` 直接讲 Edge 朗读的 WebSocket 协议、直连该主机、使用该主机接受的令牌方案，并在仍会返回清单的旧主机上取语音列表。移除 `msedge-tts` 同时移除了那个让 seed 安装失败的被忽略构建脚本。

**`node-pty` 补丁保留。** 未打补丁时，它只在自己的 prebuilds 目录里找 `spawn-helper`，而 macOS 的 SEA 运行时就放在可执行文件旁的 `<exe>-spawn-helper`，该包又没有可配置的路径入口。要 own 它就得内置其 JavaScript 加载层，同时仍从 tarball 取二进制；在上游提供入口之前，30 行补丁仍是更小的面。

## Verification

收集器被直接调用——`getCollectorByPackageManager(PM.PNPM, appDir, new TmpDir()).getNodeModules({ packageName })`——而不是通过打包流程验证：对 `apps/desktop`，26.18.1 与打过补丁的 26.17.0 返回同样的 19 个模块；在体量大得多的 `@aeven/cli` 闭包里，26.18.1 只少了按平台过滤的可选二进制与 `@aeven/win32-process`，而本仓库没有任何 electron-builder 收集会走到那个闭包。`ensure-gws.mjs` 在 macOS arm64 上端到端跑过：删掉已有二进制后，它下载压缩包、校验 checksum，`gws --version` 输出 `gws 0.22.5`。自有 Edge 客户端对真实服务应答：列出 322 个语音，冷启动 523 ms，复用连接 382 ms，取消一句之后的那句 296 ms。

## Alternatives considered

**继续给 `app-builder-lib` 打补丁。** 否决：该补丁所守的代码上游已经改写，每次升级都要重写补丁；一次带上修复的版本升级是更便宜的不变量。

**在打过补丁的安装脚本里回退到 x64 产物。** 否决：这等于为了一个只看主机三元组的包长期维护补丁，而且对本来就有构建的平台毫无价值。

**把 `gws` 作为旁挂二进制打包。** 否决：为时过早。该包自己的布局已经把路径定为 `bin/gws`，把二进制写在那里就能让所有平台共用一条路径，`GWS_BIN` 无需改动。

## Consequences

- 任何依赖一旦带上生命周期脚本，就必须在 seed 的构建脚本清单里被允许或拒绝，否则 Desktop seed 安装失败；本次发布正是这样失败的。
- 上游一旦重命名产物，我们的安装会响亮地失败，而不是像打过补丁的安装脚本那样静默回退。
- `node-pty` 成为唯一保留补丁的包，其补丁跟踪 `lib/unixTerminal.js` 中的 `spawn-helper` 解析。
