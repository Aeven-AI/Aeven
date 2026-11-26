# Agent Note: Desktop terminal opens for synced copies

Status: implemented

[English](2026-11-26-desktop-terminal-opens-for-synced-copies.md) | 中文

## Problem

桌面端的侧栏终端几乎在每个会话中都报错：“终端错误：session "…" is replicated from another device; fork it to continue”。账户同步会把空闲的会话在每台设备上都定为只读副本，包括创建它的设备，设备只有在认领之后才会再次写入它（[session-sync](../../../../packages/session/session-sync/README.zh.md)）。`terminalController` 的每个 Remote 调用都接收由网关解析的 `Agent`，而解析 Agent 会恢复会话，会话持久化会拒绝恢复副本。终端面板原样显示了这条内部错误。

## Decision

- **`hostShells`**（位于 [`@aeven/api-terminal-controller`](../../../../packages/api/terminal-controller/README.zh.md)，由桌面组合启用）：会话的 shell 在 Host 自己的 `subprocess` 提供方上运行，起始目录是该会话工作区在本设备上的文件夹。本进程正在运行该会话时由活动的 Agent 提供头信息；否则由 `sessionQuery.observeSession` 读取存储的头信息，并由 `workingDirectory.observed` 解析文件夹，因此不会恢复 Agent，也不会认领会话。
- **`hostShells` 下的 shell 与 Host 同生命周期。** 其所有者记录不再随 Agent 的上下文结束，因此把会话交给另一台设备（这会释放本地 Agent）后 shell 仍继续运行；空闲的 shell 仍会在 `unattendedTimeoutMs` 后被回收。
- **Remote 方法接收 `SessionId`。** `environment`、`shells` 与 `create` 解析 shell 的运行位置；`follow`、`write`、`resize`、`rename` 与 `close` 访问会话保留的终端，并把其他账户的会话当作不存在的终端拒绝。客户端调用不变，因为客户端本来就传入会话 id。
- **未启用 `hostShells` 时**，与之前一样通过 `sessionController.resolveAgent` 解析会话的 Agent，shell 随其结束。
- **可读的失败信息。** `workspace/no-local-directory` 与 `session/agent-busy` 在终端面板中映射为翻译后的提示，而不是原始消息。

## Alternatives considered

**在打开终端时认领会话**（如同更改模型或标题时那样）被否决：下一次交接会释放本地 Agent，并结束用户已打开的 shell。**让所有组合的 shell 都在 Host 提供方上运行**被否决，因为 Agent 选择远程沙箱的组合（E2B 提供方）会在沙箱之外启动 shell；Aeven Cloud 则完全停用终端。**只提供更友好的错误信息**被否决：终端是本地 shell，没有需要等待的东西。

## Consequences

在桌面端，只要会话的工作区在这台电脑上有文件夹，无论哪台设备在写入它，都能打开终端。其 shell 的生命周期长于会话的 Agent，随 Host 结束，或在空闲 `unattendedTimeoutMs` 后结束。chat.aeven.io 上的浏览器仍然连接到云端 Host 的终端服务，而该服务已停用；在运行会话的桌面上打开 shell 见 #821。
