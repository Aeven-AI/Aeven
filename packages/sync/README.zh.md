---
description: "账户同步：登录同一个 Aeven 账户的每台设备都持有相同的记忆、对话和偏好，并经过端到端加密。"
kind: "package-group"
---

# 账户同步

[English](README.md) | 中文

## 概述

账户同步让一个账户的数据在登录它的每台设备上保持一致。每台设备在变更离开之前将其加密，Aeven 中转服务器存储并转发它无法打开的密文；两台设备都在线时，变更在一秒内交换，离线的设备回来后会追上进度。本地数据在磁盘上保持不加密。设计及其取舍见[账户同步 Agent Note](../../.agents/notes/proposed/architecture/2026-10-27-account-sync-network.zh.md)。

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
| [`@aeven/sync`](sync/README.zh.md) | Service Definition `ctx.sync`：按账户的文档、流、设备与加入 |
| [`@aeven/sync-vault`](sync-vault/README.zh.md) | 库：设备密钥、密钥纪元、加密并签名的信封、设备链、批准代码 |
| [`@aeven/sync-yjs`](sync-yjs/README.zh.md) | Service Provider：Yjs 文档、本地存储与中转连接 |
| [`@aeven/api-sync-controller`](../api/sync-controller/README.zh.md) | 供设置页使用的 `sync` Remote |
| [`@aeven/client-ui-settings-sync`](../client/ui-settings-sync/README.zh.md) | 设置 → 同步 |
| [`@aeven/session-sync`](../session/session-sync/README.zh.md) | Consumer：对话历史 |

挂载了 `ctx.sync` 时，`@aeven/memory-memos` 和 `@aeven/personalization` 直接使用它；未挂载时行为与之前相同。

<a id="what-synchronizes"></a>
## 同步的内容

| 数据 | 机制 |
|---|---|
| 记忆 | SQLite 触发器记录对复制的 MemOS 表的每次写入；行通过分片文档（`memory/<table>/<id prefix>`）传输，在其他设备上以 upsert 写入，删除优先于并发编辑。向量连同生成它的嵌入模型一起传输，只在运行同一模型的设备上应用。 |
| 对话 | 创建会话的设备把会话事件作为压缩的流批次发布，并在 `sessions/index` 文档中列出该会话；其他设备通过会话持久化以原始 `seq` 导入。设备首次发布前、在回填窗口内创建的会话也包括在内。 |
| 偏好 | 每个账户的个性化设置存放在 `personalization` 文档中，按字段合并。 |
| 设备名称 | `devices` 文档把每个设备 id 映射到该设备为自己起的名称。 |

凭据、提供方密钥、连接器令牌、设备设置、缓存、索引和日志留在设备上。

<a id="devices-and-keys"></a>
## 设备与密钥

第一台设备创建保管库：一对设备密钥和纪元 0 的保管库密钥，记录在签名且哈希链接的设备链中。新设备只能通过一台打开了 设置 → 同步 中“添加设备”界面的设备加入：加入方先承诺自己的密钥，打开界面的设备回复一个挑战，两台设备显示相同的六位代码，用户核对后批准。批准的设备为新设备包装密钥环，并把它追加到设备链。移除设备会轮换保管库密钥，为剩余设备包装新的密钥环，并记录这次移除；被移除的设备保留已有的内容，但无法读取此后同步的任何内容，它会用新的密钥重新加入。

<a id="relay-protocol"></a>
## 中转协议

每个账户和设备一条 WebSocket，用账户的 Aeven 访问令牌认证（`servers/node`，WebSocket 端口上的 `/sync`）。JSON 请求带有 `rid`，并收到 `ok` 或 `error`：`chain.get`、`chain.append`、`keys.put`、`keys.get`、`publish`（快照带 `covers`，清理其覆盖的帧）、`sync`（推送游标之后的每个文档帧，然后应答）、`stream.get`（一次一页读取某个流的帧）以及 `signal`（加入时的设备间消息）。中转服务器只读取帧的路由头。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- **设备只在其账户在该 Host 上持有会话时同步。** 访问令牌只为已登录的客户端保存在内存中，因此没有该账户客户端的 Host 会等待，并在有客户端连接时追上进度。
- **尚无通行密钥恢复。** 丢失所有已加入的设备即丢失保管库；Agent Note 中基于 PRF 的恢复尚未构建。
- **每个会话一个写入者尚未在设备之间强制。** 每个会话由创建它的设备发布；在另一台设备上继续导入的会话不会被发布回去，此后导入的副本不再跟随原会话。
- **后台记忆归纳在每台设备上运行。** 在维护租约实现之前，两台设备可能从相同的 trace 派生出重复的 policy。
- **没有本地网络传输。** 设备总是通过中转服务器交换帧。
- **会话归档在创建它的设备的工作目录下。** 另一台机器上路径不同的工作区会单独列出导入的会话。
