# Agent Note：桌面版自行安装更新

Status: implemented

[English](2026-10-16-desktop-automatic-updates.md) | 中文

## 问题

已安装的 Aeven 从不自行更新。`DesktopUpdateCoordinator` 设置了 `autoDownload = false` 与 `autoInstallOnAppQuit = false`，因此检查最多只能报告 `available`；`main.ts` 仅在启动十秒后以及从应用菜单各询问一次，发行版只有在对话框中点击确认后才下载并安装。读者关掉该对话框、并让应用以后台模式连续运行数天，就不会再收到第二次提示；而过去用来把这一状态送到窗口的更新 IPC 界面（`updatesCheck`、`updatesInstall`、`updatesState`）已没有任何调用方——它所服务的窗口已不存在，因此桌面壳只剩下一个菜单项和一个对话框。

## 决策

`DesktopUpdateCoordinator` 设置 `autoDownload = true` 与 `autoInstallOnAppQuit = true`。于是 `checkForUpdates()` 会为它发现的发行版直接开始下载，并以 `downloadPromise` 报告该下载，协调器等待它：检查在下载期间解析为 `available`，下载落盘后解析为 `ready`，而 `install()` 安装已下载的发行版时不会重复下载。在 macOS 上，Squirrel.Mac 会在应用退出时安装已下载的 ZIP（`autoInstallOnAppQuit` 打开时，`MacUpdater` 正是为此调用 `nativeUpdater.checkForUpdates()`），因此 **`ready` 表示安装待发生，退出即安装**；桌面壳既有的 `before-quit` 确认仍决定在有任务运行时何时退出，因此安装绝不会与一次轮次相撞。

桌面壳在启动后不久检查一次，此后每 30 分钟检查一次，由 `update-prompt.ts` 决定读者会看到什么：自动检查在发行版下载完成前保持静默，从 **检查更新…** 发起的检查总会给出答复——已是最新、正在下载或失败——而下载完成的发行版每版本只通过一个原生对话框询问一次，其中的“立即重启”马上安装，选择“稍后”也不算拒绝，因为无论如何退出时都会安装。间隔取 30 分钟而非更快轮询，是因为该检查是一次未认证的 GitHub 发行请求，整台机器共享每小时 60 次的额度，而且更慢的检查同样会在下次退出时完成安装。已无调用方的 IPC 界面被删除。

## 考虑过的替代方案

**采用 t3code 的做法：四分钟轮询加界面内更新提示。** 在 `resources/t3code/apps/desktop/src/updates/DesktopUpdates.ts:53` 中 `AUTO_UPDATE_POLL_INTERVAL` 为 `"4 minutes"`（在启动延迟之后开始），其状态渲染在应用自身的界面里。这样的节奏会让单个应用用掉未认证 GitHub 额度的四分之一，而读者要的是弹窗而非界面，因此两者都没有采用。

**完全静默安装，不弹对话框。** 只打开 `autoInstallOnAppQuit` 就能在毫无提示的情况下更新，而当重启发生在任务进行中时，读者会把这次重启读成崩溃。

**保留“先询问再下载”，只增加周期检查。** 那时对话框出现时发行版仍在远端，接受的读者要等一个 385 MB 的下载才有任何动静；先下载才能让“立即重启”即时生效，让“稍后”有意义。

**先询问再下载，下载完成后在退出时安装。** 这需要两个开关都关闭，并在下载结束后再做一次决定，而上述对话框用更少的状态就提供了同样的结果。

## 后果

已安装的应用现在无需点击即可跟进发行版：在读者工作时下载，只询问一次。呈现界面、退出时安装这一回答，以及承载该状态的 IPC 通道，已在 [更新弹窗说明](2026-10-17-desktop-update-popup.zh.md) 中改变：这些状态改由页面自身渲染，且退出时不再安装。

检查是未认证的 GitHub 请求，因此被限流或离线时，只有读者主动询问才会看到 `error`；自动检查保持静默，下个周期再试。在 macOS 上只有签名构建能自我更新：`latest-mac.yml` 列出两个签名 ZIP，Squirrel.Mac 会校验下载包的 Developer ID 签名是否与正在运行的应用一致，而 `mac-*-unsigned` 目标只发布没有 ZIP 的 DMG，因此未签名安装可以看到新版本却永远装不上。Windows 安装包目前未签名，更新仍可进行，但手动安装时会被 SmartScreen 询问；Linux 的 `.deb` 永不自我更新，AppImage 则可以。一个桌面发行版始终是一个整体——签名的应用，以及与之匹配的 avn 种子、Node.js 与 pnpm（[打包与更新](../architecture/2026-08-25-electron-desktop-packaging-and-updates.zh.md)）——因此更新绝不会把桌面壳与它服务的后端拆开。更新还会替换 avn 种子，因此更新后的首次启动要先完成发行版安装才能让后端应答；[启动画面](2026-10-16-desktop-start-screen.zh.md)正是让那段等待读起来像在工作。每个桌面发行版都以 GitHub 预发行（prerelease）发布，这正是本仓库的 `releases/latest` 返回 404、以及不带 tag 的 `gh release view` 找不到任何发行版的原因；更新器读取的是发行版 Atom 源，其中包含预发行。

验证：`apps/desktop/tests/update-coordinator.spec.ts` 覆盖后台下载、免下载安装、两个开关、未配置更新的进程，以及检查失败；`apps/desktop/tests/update-prompt.spec.ts` 覆盖每一个对话框决策。发行侧通过 GitHub 核对：`v0.3.5-alpha` 已发布（非草稿、预发行），带有 `latest-mac.yml`、`latest.yml`、`latest-linux.yml` 与 `latest-linux-arm64.yml`，mac 发行流列出 `aeven-0.3.5-alpha-mac-arm64.zip` 与 `aeven-0.3.5-alpha-mac-x64.zip`，任何发行版都不含未签名的 mac ZIP，而已安装的应用校验为已公证的 Developer ID 构建且票据已装订。打包路径本身未做实测：要看到一次安装，需要一个已发布的更新版本和一个已安装的构建。
