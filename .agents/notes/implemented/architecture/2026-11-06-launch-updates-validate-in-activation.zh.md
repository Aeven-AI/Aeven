# Agent Note: 启动时的更新由提供服务的 Host 验证，启动中的 MCP 服务器立即停止，近期记忆扫描与搜索并行

Status: implemented

[English](2026-11-06-launch-updates-validate-in-activation.md) | 中文

## Problem

在 macOS arm64 Desktop 0.3.35-alpha 上、针对空的 Aeven home 测得：

- Host 在编译缓存已预热时约 1.2 秒启动，而每次停止都耗时 2,079 ms。停止在等待 MCP SDK 的 stdio 关闭：它结束 stdin，并在 SIGTERM 前等待 2 秒。仍在由 `npx` 解析的服务器不读取 stdin，因此在启动后不久停止要付出完整的 2 秒。完全启动的服务器在输入结束后 0.6 秒内退出。
- 安装更新的启动会把 staging Host 作为健康检查启动、停止，激活 profile，再启动提供服务的 Host：每次更新启动都有两次启动和一次 2 秒的停止。
- 在最近 300 个会话日志中，带自动记忆召回的轮次在 `turn/start` 与第一个模型请求之间的中位等待为 2.2 秒（p90 为 5.2 秒）；不带召回的轮次为 29 ms。召回依次执行搜索、扫描最多 1,000 条近期个人 trace、再运行相关性判断。扫描并不依赖搜索。

## Decision

`@aeven/mcp-client` 在插件释放时，若某个 stdio 服务器的连接仍处于 `connecting`，会在 SDK 关闭前向其发送 SIGTERM。这样的服务器没有需要结束的会话。已建立的连接保留 SDK 的正常关闭。

在 macOS 和 Linux 上，应用某个发布的打包启动会在激活期间从最终 profile 启动提供服务的 Host 来验证它，这正是 macOS 首次安装已采用的路径。启动失败会拒绝该事务，激活的撤销会恢复 rollback profile。Windows 保留在 `paths.work` 中运行的独立 staging 启动，因为启动失败后留在 profile 目录中的进程可能阻止撤销时的重命名。

轮次开始的召回在搜索之前启动近期个人 trace 扫描。之后从扫描结果中去除搜索命中，因此候选与串行顺序时相同。相关性判断的日志行记录其耗时。

## Alternatives considered

**为所有服务器缩短 SDK 的等待时间。** 在输入结束时刷新状态的已建立服务器会失去这段时间。

**跳过或缩小相关性判断。** 它的模型往返占剩余召回延迟的大部分，但它决定模型读取哪些记忆；削减它是以召回质量换取延迟。

## Consequences

同一个 Host 改动后在 73-121 ms 内停止，且没有残留的 MCP 服务器或 `npx` 进程。macOS 和 Linux 上的更新启动只启动一次 Host。召回在轮次开始时剩余的开销是搜索和判断的模型往返。
