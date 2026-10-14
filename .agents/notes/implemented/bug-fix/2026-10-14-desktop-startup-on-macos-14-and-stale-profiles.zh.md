# Agent Note: Desktop 可在 macOS 14 上启动、替换过期 profile，并让启动失败可检查

Status: implemented

[English](2026-10-14-desktop-startup-on-macos-14-and-stale-profiles.md) | 中文

## 问题

未签名的 macOS DMG 在运行过更早构建的机器上启动失败。已安装的 `~/.aeven/profiles/desktop` 来自同为 `0.1.2-alpha.5` 版本但 Host 协议为 4 的构建，启动时抛出 `invalid desktop release metadata`，而不是重新安装。由于仅凭版本字符串判断 profile 是否最新，在未改变的预发布版本下重新构建永远不会替换它。插件迁移还会按当前工作区格式校验旧 profile 的 `pnpm-workspace.yaml`，因此即使版本检查通过，较旧的 profile 也无法升级。

另外，Cordis Loader 只能通过 node-addon-require-builtin 访问 Node 的内部模块加载器，而该依赖的 darwin-arm64 构建声明的最低版本是 macOS 15；在 macOS 14 上该 addon 无法加载，Desktop Host 会失去裸说明符插件导入。应用没有声明最低 macOS 版本。

应用菜单以及其中的“视图 → 切换开发者工具”只在后端启动后才安装，启动失败时显示对话框并退出，因此失败的启动无从检查。

## 决定

- **Desktop Host 以 `--expose-internals` 启动。** Loader 本就优先使用该标志而非 addon，因此 Host 不再依赖 addon 的平台下限。`mac.minimumSystemVersion` 为 `14.0`，即内置 onnxruntime-node 二进制文件的下限。
- **只有当 profile 的 `desktop-release.json` 与 `desktop-packages.json` 与 seed 中的文件逐字节相同**，且已安装的 avn 与 Desktop Host 版本匹配时，profile 才算最新。包集记录了每个 tarball 的 SHA-512，因此同一版本下的重新构建或 Host 协议变更都会触发重新安装。读取已安装的发布文件时只取版本，不要求当前 Host 协议。
- **升级只读取旧 profile 的 bundle 列表与已安装插件清单。** 核心映射检查在由当前代码写入的 staging profile 上执行，因此不再需要为缺少依赖补丁的 profile 保留的兼容分支。
- **应用菜单在规划或启动后端之前安装。** 启动期间点击的手动更新检查会等待启动完成，因此安装程序不会在安装中途退出外壳。
- **启动失败会打开显示错误的窗口**，其中包含后端的 stderr，而不是显示对话框后退出。菜单保持可用，开发者工具在该窗口上打开，关闭窗口以状态 1 退出。

## 考虑过的替代方案

**每次构建都提升发布版本。** 这样版本比较就足够了，但预发布构建会从分支直接触发而不提升版本，协议变更也仍要依赖有人记得提升版本。

**请上游为更早的 macOS 重新构建 node-addon-require-builtin。** 同样能修复 macOS 14，但该标志让 Desktop 完全不再依赖该 addon，也无需等待外部发布。

**将无法读取的旧 profile 视为不存在并全新安装。** 更简单，但会静默丢弃用户已安装的 Desktop 插件。

## 影响

- 从同一版本任何更早构建写入的 profile 升级时会重新安装一次；之后的启动直接复用。
- 每个 Desktop Host 进程都能访问 Node 内部模块，而在受支持平台上 addon 本就允许这样做。
- macOS 13 及更早版本会以系统的版本提示拒绝打开应用。
