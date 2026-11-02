---
description: "账户同步：登录同一个 Aeven 账户的每台设备都持有相同的记忆、对话和偏好，在设备上加密，并经 Aeven API 中转。"
kind: "package-group"
---

# 账户同步

[English](README.md) | 中文

## 概述

账户同步让一个账户的数据在登录它的每台设备上保持一致。每台设备在变更离开之前将其加密，由 Aeven 中转服务器存储并转发这些帧；中转服务器目前创建并保存每个账户的密钥，因此能打开它存储的内容，把该密钥移到用户自己密码管理器中的通行密钥上的工作正在进行。两台设备都在线时，变更在一秒内交换，离线的设备回来后会追上进度。本地数据在磁盘上保持不加密。设计及其取舍见[账户同步 Agent Note](../../.agents/notes/proposed/architecture/2026-10-27-account-sync-network.zh.md)。[账户同步子系统页](../../docs/subsystems/sync.zh.md)是 `ctx.sync` 词汇与它发出的事件的参考。

## 目录

- [包](#packages)
- [同步的内容](#what-synchronizes)
- [设备与密钥](#devices-and-keys)
- [中转协议](#relay-protocol)
- [已知限制与延后工作](#known-limitations-and-deferred-work)

<a id="packages"></a>
## 包

| 包 | 角色 |
|---|---|
| [`@aeven/sync`](sync/README.zh.md) | Service Definition `ctx.sync`：按账户的文档、流、设备与租约 |
| [`@aeven/sync-vault`](sync-vault/README.zh.md) | 库：账户密钥、不透明文档 id 与 AES-256-GCM 信封 |
| [`@aeven/sync-yjs`](sync-yjs/README.zh.md) | Service Provider：Yjs 文档、本地存储与中转连接 |
| [`@aeven/api-sync-controller`](../api/sync-controller/README.zh.md) | 供设置页使用的 `sync` Remote |
| [`@aeven/client-ui-settings-sync`](../client/ui-settings-sync/README.zh.md) | 设置 → 同步 |
| [`@aeven/session-sync`](../session/session-sync/README.zh.md) | Consumer：对话历史 |
| [`@aeven/session-handoff`](../session/session-handoff/README.zh.md) | Service Definition `ctx.sessionHandoff`：在另一台设备编写的对话中输入并审批 |

挂载了 `ctx.sync` 时，`@aeven/memory-memos` 和 `@aeven/personalization` 直接使用它；未挂载时行为与之前相同。

<a id="what-synchronizes"></a>
## 同步的内容

| 数据 | 机制 |
|---|---|
| 记忆 | SQLite 触发器记录对复制的 MemOS 表的每次写入；行通过分片文档（`memory/<table>/<id prefix>`）传输，在其他设备上以 upsert 写入，删除优先于并发编辑。向量连同生成它的嵌入模型一起传输，只在运行同一模型的设备上应用。 |
| 对话 | 编写某会话的设备把会话事件作为压缩的流批次发布，并在 `sessions/index` 文档中列出该会话；其他设备通过会话持久化以原始 `seq` 导入。该设备持有会话的运行者租约，未持有的设备把提示词、审批和取消转发给持有者，由它作为自己的输入应用；在同一局域网时，批次还会在两者之间直接传递。设备首次发布前、在回填窗口内创建的会话也包括在内。 |
| 偏好 | 每个账户的个性化设置存放在 `personalization` 文档中，按字段合并。 |
| 设备名称 | `devices` 文档把每个设备 id 映射到该设备为自己起的名称。 |

凭据、提供方密钥、连接器令牌、设备设置、缓存、索引和日志留在设备上。

<a id="devices-and-keys"></a>
## 设备与密钥

中转服务器在首次使用时为每个账户创建一个 32 字节的账户密钥，用由 API 的 `encryptionSecret` 派生的密钥包装后保存，并通过 `key.get` 返回给任何为该账户完成认证的设备；设备把它保存在自己的 `sync.db` 中。每个文档的密钥都由它派生，文档的不透明 id 是它在该密钥下的逻辑名 HMAC，因此持有该密钥的一方既能解开载荷，也能把 id 映射回逻辑名。

如果中转服务器返回的是另一个密钥，账户会被重新开始：设备丢弃自己的文档、发件箱、计数器与游标，并在新密钥下重新发布数据。

移除设备只是删除它在账户 `devices` 文档中的条目。设备保留它已经持有的密钥，因此它能读懂自己再次同步到的内容。

同一局域网内的设备以同一账户密钥下的 HMAC 证明互相认证；没有设备持有自己的密钥对。

<a id="relay-protocol"></a>
## 中转协议

每个账户和设备一条 WebSocket，用账户的 Aeven 访问令牌认证（`servers/node`，WebSocket 端口上的 `/sync`）。JSON 请求带有 `rid`，并收到 `ok` 或 `error`：`key.get`、`publish`（快照带 `covers`，清理其覆盖的帧）、`sync`（推送游标之后的每个已存帧，然后应答）、`stream.get`（一次一页读取某个流的帧）、`lease.acquire` 与 `lease.release`。帧的头部是明文，便于中转服务器路由；载荷则由中转服务器以其持有的账户密钥派生的密钥密封。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- **中转服务器能打开它存储的内容。** 它创建每个账户密钥，并以由 API `encryptionSecret` 派生的密钥包装后保存，因此同步的记忆与对话对其他账户和对网络是保密的，对 Aeven 不是。把密钥移到用户自己密码管理器中的通行密钥上的工作正在进行（[计划](../../.agents/notes/proposed/architecture/2026-10-27-account-sync-network.zh.md)）。
- **移除设备并不撤销它。** 账户密钥不变，因此被移除的设备再次同步时仍能读取内容。
- **设备只在其账户在该 Host 上持有会话时同步。** 访问令牌只为已登录的客户端保存在内存中，因此没有该账户客户端的 Host 会等待，并在有客户端连接时追上进度。
- **没有设备能运行对话时，输入会等待。** 如果会话的编写方不可达、且本机无法接管其日志，输入会留在收件箱中，直到持有它的设备出现。
- **对话正文在打开时才到达。** 设备先交换会话元数据，在打开时或在限速的后台过程里下载日志，因此从未打开过、且早于 `backfillDays` 的会话仍留在编写它的设备上。
- **中转服务器为每个账户提供的存储尚未测量。** 拥有数 GB 会话的账户会把它们全部保留在中转服务器上。
