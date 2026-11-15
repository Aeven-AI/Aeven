# Agent Note：另一台设备的批准和提问可以到达 Aeven Web

Status: implemented

[English](2026-11-15-remote-interaction-audience.md) | 中文

## 问题

一个在 chat.aeven.io 上开始、在用户桌面端运行的对话请求了沙箱批准（Keynote 转换），在第二次检查中还提出了一个多选问题。两者都只出现在桌面应用中，从未出现在网页上，因此在手机上对话一直在等待，却没有任何可以回答的内容。交互中继本就会把运行设备上待处理的批准和提问随会话的实时状态一起发布，托管 Host 再通过一个替身 Agent 展示它们；随后网关用 `ctx.sessions.get(id)?.header.owner` 把远程事件限定给会话的所有者。由另一台设备运行的会话在托管 Host 上并未打开，所以所有者是 `undefined`，而在强制区分账户的 Host 上 `identityUsers.mayAccess(undefined, user)` 为 false：没有任何客户端收到该事件。

## 决策

网关在会话已打开时从该会话读取受众所有者，否则从限定范围的 Agent 自己的会话头读取。中继用来展示的替身 Agent 带有会话的所有者，这个值由 Host 根据同步的实时状态设置，从不来自客户端。

`avn-memory-context`、`avn-personalization`、`avn-file-reference-local` 和 `avn-tool-subagent` 的 `agent/disposed` 监听器把 `fiber.dispose()` 包在 `Promise.resolve` 中，因为已经停止的 fiber 不返回 promise，这些监听器在每个被交接的会话上都会抛错。

## 考虑过的替代方案

**在另一台设备运行会话时，在托管 Host 上打开该会话。** 这样只为了读取一个会话头字段就要加载整个日志，而且已加载的会话会诱使 Host 去运行另一台设备正持有的那一轮。

## 影响

在账户另一台设备上运行的对话，其批准和提问会到达该账户的每个客户端；其他账户的客户端仍然收不到，因为所有者来自 Host 自身的状态。

## 验证

`pnpm run typecheck` 通过。部署后的实时检查是：在 chat.aeven.io 上，由桌面端运行的对话提出的问题。
