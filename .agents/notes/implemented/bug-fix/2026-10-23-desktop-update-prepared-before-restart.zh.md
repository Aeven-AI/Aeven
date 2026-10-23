# Agent Note: 桌面更新在重启之前准备就绪

Status: implemented

[English](2026-10-23-desktop-update-prepared-before-restart.md) | 中文

## 问题

安装桌面版本时看起来像崩溃。[更新弹窗](../feature/2026-10-17-desktop-update-popup.zh.md)在 electron-updater 下载完 ZIP 后就提供重启，但大部分工作还没做。由于 `autoInstallOnAppQuit` 关闭，`MacUpdater.quitAndInstall` 直到此时才让 Squirrel.Mac 从更新器的本地源获取 ZIP、校验签名并解压，而 `beforeRestart` 已经停掉了 Host，因此整个过程中窗口显示的是一个没有后端的应用。新版本首次启动时随后运行 `DesktopProjectManager.applyRelease`，它在 Electron 主线程上用 `readFileSync` 对 562 MB 的种子做哈希，用同步 `tar` 解出 pnpm 存储，再用 `cpSync` 复制：约 70 秒内窗口无法重绘、移动或响应输入。启动画面只有一个转圈，而在此期间选择**检查更新…**直到启动完成都没有任何回应。

## 决策

版本在弹窗提供重启之前就在后台安装好，剩余的每一步都在主线程之外运行并显示状态。

- `DesktopUpdateCoordinator` 接收一个 `prepare(version)` 步骤。下载完成后它发布新的 `preparing` 阶段，等待 `prepare`，之后才发布 `ready`；`prepare` 失败时将更新报告为失败。
- 在打包的 macOS 上，`main.ts` 用 `apps/desktop/src/update-staging.ts` 实现 `prepare`。`stageNativeUpdate()` 针对 electron-updater 提供的源调用 Electron 原生的 `autoUpdater.checkForUpdates()`，使 Squirrel 在下载期间而不是重启之后暂存该包；外壳记住已暂存的版本，因此之后的定期检查不会再次暂存。`stagedReleaseResources(shipItDir, version)` 找到 `CFBundleShortVersionString` 匹配的已暂存 `update.*/*.app`，`DesktopProjectManager.prepareRelease(seed, version, runtime)` 使用该暂存包自带的 Node.js 和 pnpm 把该版本的配置档安装到 `~/.aeven/desktop/prepared/profile`，并把其 pnpm 存储合并到持久存储中。无法准备的配置档会被记录日志，留给首次启动处理。
- `applyRelease` 采用一个由其精确种子、并带有当前配置档插件安装的已准备配置档，只剩健康检查与目录交换；其他已准备的配置档会被丢弃。它通过 `DesktopProjectHooks.progress` 报告 `unpacking`、`installing` 与 `checking`，外壳把这些写在启动画面的转圈下方，形如“正在将 Aeven 更新到 {version}：…”。
- `verifySeedIntegrity`、`extractPnpmStoreArchives` 与 `mergePnpmStore` 均为异步：文件用 `fs/promises` 逐个哈希，归档用 `tar` 流列出并解压，存储用 `fs/promises.cp` 复制。
- 启动期间选择**检查更新…**会在启动画面上写出一行，并在页面就绪后打开弹窗。

Windows 与 Linux 保留先下载再重启的流程，同时获得不阻塞的首次启动及其状态行。

## 考虑过的替代方案

**重新开启 `autoInstallOnAppQuit`。** 这会让 `MacUpdater` 自行暂存该包，但也会通过更新器的退出处理在每次退出时安装，而[更新弹窗笔记](../feature/2026-10-17-desktop-update-popup.zh.md)移除了它，以便重启始终由读者决定。通过原生更新器暂存既得到暂存，又没有退出处理；Squirrel 仍会在应用退出时安装已暂存的包，这是 Squirrel 的行为，而不是更新器的。

**把种子步骤移到工作线程。** 工作线程需要自己的打包入口，而源码运行的测试与开发启动都没有。异步的文件与 tar API 让事件循环保持运转，同时沿用现有代码路径。

**从下载的 ZIP 中解出种子。** 这在 Squirrel 暂存之前就可行，但需要一个能读 425 MB 归档的 ZIP 读取器，而 Squirrel 本来就会解压并校验同一个包；读取已暂存的包复用的是那份已校验的副本。

**用正在运行版本的 Node.js 和 pnpm 准备。** 那样原生依赖会针对旧运行时构建。已暂存的包带有其首次启动所用的运行时，因此已准备的配置档与该次启动本会安装的结果一致。

## 后果

- 从弹窗回答的重启现在只是交换应用：Host 停止，已暂存的包在数秒内安装，首次启动在真正的 Host 之前只运行一次健康检查 Host 启动。
- 在 macOS 上，读者不选择重启而直接退出时，已暂存的版本同样会被安装。
- `prepareRelease` 在安装期间持有项目锁，因此这一分钟内的插件变更会报告另一个事务正在进行。
- 已准备的配置档在 `~/.aeven/desktop/prepared` 下占用一个配置档的磁盘空间，直到该版本启动或另一次准备替换它。
- 这一改进从携带此代码的版本所做的首次更新开始生效；更早的版本按其自身逻辑更新。
- `apps/desktop/tests/update-coordinator.spec.ts` 固定了下载与 `ready` 之间的 `preparing` 阶段；`apps/desktop/tests/seed-store.spec.ts` 与 `apps/desktop/tests/project-manager.spec.ts` 覆盖异步的解压、合并与校验。已暂存包路径与已准备配置档的采用通过了类型检查与构建，但未实际运行：这需要一个已发布的更新版本和一个已安装的构建。
