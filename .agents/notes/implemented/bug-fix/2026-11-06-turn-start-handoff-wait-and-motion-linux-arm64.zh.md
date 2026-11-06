# Agent Note：轮次开始时的交接等待与 Linux arm64 上的 motion

Status: implemented

[English](2026-11-06-turn-start-handoff-wait-and-motion-linux-arm64.md) | 中文

## 问题

在 Linux arm64 Desktop 上，于另一台设备已写入检查点的仓库中工作时，每一轮在第一步之前都要等待约 60 秒。`workspace-git-sync` 在 `agent/pre-step` 中运行 `WorkState.apply`；它发现另一台设备更新的检查点，共享其传输文件夹，并等待 `handoffWaitMs`（60 秒）。另一台设备离线，文件夹始终未到达，也没有任何地方记录这次错过，因此之后的每一轮都会再次等满 60 秒。该等待还忽略了轮次的中止信号，停止轮次并不能结束它。会话日志显示 `turn/start` 与第一个 `step/start` 之间的间隔：一个会话中为 74 秒和 60 秒，另一个会话五轮中有四轮为 60-63 秒。

在同一会话中，`/motion` 在 Linux arm64 上因两个原因失败。检出中的 `@aeven/ffmpeg-linux-arm64` 包没有构建好的 `bin/`，这是本地环境缺口。`motion-hyperframes` 还以缺少构建为由，拒绝在 Linux arm64 上下载 Chrome for Testing 的 headless shell；Chrome for Testing 现已发布 `linux-arm64`，`@puppeteer/browsers` 能解析并下载它。两者就绪后，渲染捕获了全部帧随后失败：在转码路径上，ffmpeg 要把 `renders/.review.mp4` 写入不存在的 `renders/` 目录，而 `MotionRenderRequest.outputPath` 承诺会创建该目录。

## 决定

- `untilFolder` 接受可选的中止信号，信号中止时返回 false。`WorkState.apply` 传入轮次的信号。
- `WorkState` 在本次 Host 运行期间记住每个等待超时的检查点。之后的轮次通过 `folderComplete` 检查该检查点一次，不再等待；更新的检查点会重新获得完整的 `handoffWaitMs` 等待。每个检查点的错过只记录一次日志。
- `resolveBrowser` 在 `detectBrowserPlatform` 报告的每个平台上下载 headless shell，包括 Linux arm64。
- HyperFrames 渲染器在任一编码路径运行之前创建输出目录。

## 考虑过的替代方案

**对端离线时跳过等待。** `FileSync` 不报告对端连接状态，为这一个 Consumer 把它加入 Service Definition，比限制等待的改动更大。

**跨 Host 重启持久化错过的检查点。** 这样重启后的第一轮就无法在其设备期间重新上线时不经等待地取得该检查点；保留的代价是每次 Host 运行、每个检查点一次 60 秒等待。

## 后果

另一台设备离线时，只有 Host 运行中的第一轮会等待其检查点；之后的轮次开始时不再有 60 秒延迟，停止也会结束等待。`packages/workspace/workspace-git-sync/tests/wait.spec.ts` 覆盖中止和单次检查。在没有安装 Chromium 的 Linux arm64 主机上，修补后的 `resolveBrowser` 在 35 秒内下载了 156.0.8078.47 headless shell，该 shell 成功渲染了页面。
