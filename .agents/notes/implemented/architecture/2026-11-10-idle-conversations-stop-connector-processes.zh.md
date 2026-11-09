# Agent Note: 空闲对话停止其连接器进程

Status: implemented

[English](2026-11-10-idle-conversations-stop-connector-processes.md) | 中文

## Problem

`avn-host-account-integrations` 在 agent 创建时把已登录用户的连接器挂载到该 agent，并保留到 agent 被销毁。一个 Google 连接器（Gmail、Drive、Calendar）在每个 agent 中是一个 Node 进程，运行 Workspace MCP 桥；Microsoft 和 Discord 连接器同样各占一个 Node 进程。在托管 Web 上，pink 运行三个半小时后，17 个账户共有 18 个 Workspace 桥进程，每个常驻内存约 85 MB，其中多数属于无人使用的对话。连接了全部三个 Google 连接器的账户，每个打开的对话要付出约 250 MB，因此决定一台机器能容纳多少对话的是这些进程，而不是 Host。

## Decision

一个对话在 `connectorIdleMs`（默认 300 秒）内既没有步骤也没有工具调用时，它的连接器子进程会停止，对话的下一步会重新启动它们。`agent/pre-step` 本来就在询问模型之前同步连接器，所以被停止的连接器会在需要其工具之前重新挂载，模型看到的工具集不变。远程 MCP 服务器保持挂载，因为它们不占用进程。

使用在 `agent/created`、每次 `agent/pre-step` 同步，以及 `tools/pre-execute` 和 `tools/post-execute` 时计入。`connectorIdleMs` 必须大于工具请求时限 `timeoutMs`，构造函数会拒绝不满足这一点的配置；调用的两端都计入，因此进程不会在它正在服务的调用期间停止。空闲停止先把连接从 agent 的表中移除，再销毁它们，而同步会等待进行中的停止，所以步骤不会读到正在销毁的连接。

默认值基于一次测量：在开发用 Mac 上，启动一个 Workspace 桥并列出其工具需要 220 至 270 毫秒，常驻内存 78 MB。连接器进程本来就会在访问令牌轮换时重启，Google 的令牌大约每小时轮换一次，因此步骤之间的重启是已有路径。

## Alternatives considered

每个账户和连接器共用一个进程、由该账户的各个对话共享，对同时打开多个对话的账户能省下更多内存。它被推迟，因为 `mcp` 插件在一个 agent 作用域内同时拥有传输和工具注册；共享进程意味着把两者分开，这会为所有使用方改变 `avn-mcp-client`。空闲停止只限于本包，也覆盖了只是一直开着的对话。

在第一次连接器工具调用时才懒挂载的方案被否决：模型必须先看到连接器的工具才能调用，而工具列表来自运行中的服务器。

## Consequences

空闲超过 `connectorIdleMs` 的对话，其第一步要等待连接器进程启动，每个约四分之一秒，并行进行。空闲停止后重新注册的工具会追加到 agent 的工具列表末尾，因此它们在对话工具中的位置可能与上一轮不同，这在令牌轮换之后本来也会发生。让一个账户的各个对话共用一个进程仍待处理。
