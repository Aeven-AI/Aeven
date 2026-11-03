---
description: "账户同步：登录同一个 Aeven 账户的每台设备都持有相同的记忆、对话和偏好，在设备上加密，并经 Aeven API 中转。"
kind: "package-group"
---

# 账户同步

[English](README.md) | 中文

## 概述

账户同步让一个账户的数据在登录它的每台设备上保持一致。每台设备在变更离开之前将其加密，由 Aeven 中转服务器存储并转发这些帧。默认情况下，中转服务器创建并保存每个账户的密钥，因此能打开它存储的内容；用户用通行密钥保护账户后，由一台设备创建新密钥，中转服务器只保存用该通行密钥包装的副本，于是只有该账户的设备能打开中转服务器存储的内容，新设备用同一个通行密钥解锁即可恢复全部内容。两台设备都在线时，变更在一秒内交换，离线的设备回来后会追上进度。本地数据在磁盘上保持不加密。设计及其取舍见[账户同步 Agent Note](../../.agents/notes/proposed/architecture/2026-10-27-account-sync-network.zh.md)。[账户同步子系统页](../../docs/subsystems/sync.zh.md)是 `ctx.sync` 词汇与它发出的事件的参考。

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
| [`@aeven/file-sync`](file-sync/README.zh.md) | Service Definition `ctx.fileSync`：在账户的设备上点对点保持文件夹一致 |
| [`@aeven/file-sync-syncthing`](file-sync-syncthing/README.zh.md) | Service Provider：一个受监管的 Syncthing 进程 |
| [`@aeven/workspace-file-sync`](../workspace/workspace-file-sync/README.zh.md) | Consumer：文件夹工作区及其在另一台设备上的位置 |
| [`@aeven/workspace-git-sync`](../workspace/workspace-git-sync/README.zh.md) | Consumer：仓库工作区、其环境文件以及设备之间的复制 |

挂载了 `ctx.sync` 时，`@aeven/memory-memos` 和 `@aeven/personalization` 直接使用它；未挂载时行为与之前相同。

<a id="what-synchronizes"></a>
## 同步的内容

| 数据 | 机制 |
|---|---|
| 记忆 | SQLite 触发器记录对复制的 MemOS 表的每次写入；行通过分片文档（`memory/<table>/<id prefix>`）传输，在其他设备上以 upsert 写入，删除优先于并发编辑。向量连同生成它的嵌入模型一起传输，只在运行同一模型的设备上应用。 |
| 对话 | 编写某会话的设备把会话事件作为压缩的流批次发布，并在 `sessions/index` 文档中列出该会话；其他设备通过会话持久化以原始 `seq` 导入。该设备持有会话的运行者租约，未持有的设备把提示词、审批和取消转发给持有者，由它作为自己的输入应用；在同一局域网时，批次还会在两者之间直接传递。设备首次发布前、在回填窗口内创建的会话也包括在内。 |
| 偏好 | 每个账户的个性化设置存放在 `personalization` 文档中，按字段合并。 |
| 设备名称 | `devices` 文档把每个设备 id 映射到该设备为自己起的名称。 |
| 工作区文件 | 在桌面应用中，文件夹工作区的文件通过 Syncthing 点对点传输，不经过中转服务器；`file-sync/peers` 和 `file-sync/folders` 文档携带每台设备的传输 id，以及每个工作区的文件夹 id、大小和位置提示。仓库工作区改为通过 Git 同步：`workspace-git/repositories` 携带其去掉凭据的远程、分支、位置提示、大小和持有者，`workspace-git/env/<workspace id>` 携带其被忽略的环境文件。 |

凭据、提供方密钥、连接器令牌、设备设置、缓存、索引和日志留在设备上。

<a id="devices-and-keys"></a>
## 设备与密钥

每个文档的密钥都由一个 32 字节的账户密钥派生，文档的不透明 id 是它在该密钥下的逻辑名 HMAC，因此持有该密钥的一方既能解开载荷，也能把 id 映射回逻辑名。中转服务器与设备用密钥 id 指代当前密钥，即该密钥下一个 HMAC 的前 16 字节。密钥以两种模式之一保管：

| 模式 | 谁持有密钥 | 设备如何取得 |
|---|---|---|
| `server`（默认） | 中转服务器在首次使用时创建，并用由 API 的 `encryptionSecret` 派生的密钥包装后保存 | `key.get` 把它返回给任何为该账户完成认证的设备 |
| `passkey` | 由一台设备创建；中转服务器只保存用每个通行密钥的 WebAuthn PRF 输出包装的副本 | `key.get` 返回包装后的副本；设备用通行密钥的 PRF 输出解开其中一个，并与密钥 id 核对 |

保护账户会运行通行密钥步骤：Host 在系统浏览器中打开 Aeven 网站上的 `/passkey/vault`，页面创建或请求一个通行密钥，用固定盐值计算其 PRF，并把输出与凭据 id 密封给 Host 的一次性 X25519 密钥；Host 凭验证码取回密封结果。网站和中转服务器只看到密文。不支持 PRF 的浏览器或通行密钥提供方会如实报告，账户保持 `server` 模式。设置 → 同步提供保护、添加通行密钥、解锁和关闭保护；页面上登录后会弹出窗口提供保护，设备被锁定时会请求通行密钥。

每次更换密钥都会让账户重新开始：中转服务器清除旧密钥下的帧和租约，并关闭该账户的其他连接；每台设备丢弃自己的文档、发件箱、计数器、游标以及消费方的本地值，发出 `sync/reset`，并在新密钥下重新发布数据。不持有通行密钥所保管密钥副本的设备停留在 `starting`，并报告自己已锁定，直到被解锁。上次看到密钥由通行密钥保管、而现在收到由中转服务器保管的密钥的设备，会等待用户确认，因此中转服务器无法在用户不知情的情况下把账户切回它能读取的密钥。

移除设备只是删除它在账户 `devices` 文档中的条目。设备保留它已经持有的密钥，因此它能读懂自己再次同步到的内容。

同一局域网内的设备以同一账户密钥下的 HMAC 证明互相认证；没有设备持有自己的密钥对。

<a id="relay-protocol"></a>
## 中转协议

每个账户和设备一条 WebSocket，用账户的 Aeven 访问令牌认证（`servers/node`，WebSocket 端口上的 `/sync`）。JSON 请求带有 `rid`，并收到 `ok` 或 `error`：`key.get`、`key.protect` 与 `key.unprotect`（更改密钥的模式）、`passkey.add` 与 `passkey.remove`、`publish`（密钥 id 不是账户当前密钥时被拒绝）（快照带 `covers`，清理其覆盖的帧）、`sync`（推送游标之后的每个已存帧，然后应答）、`stream.get`（一次一页读取某个流的帧）、`lease.acquire` 与 `lease.release`。帧的头部是明文，便于中转服务器路由；载荷则以由账户密钥派生的密钥密封。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- **在用户保护账户之前，中转服务器能打开它存储的内容。** 在 `server` 模式下，同步的记忆与对话对其他账户和对网络是保密的，对 Aeven 不是。保护是可选的；不支持 PRF 的通行密钥提供方会让账户保持 `server` 模式。
- **同时失去所有设备和所有通行密钥会失去受保护的数据。** 由通行密钥保管的密钥在用户的设备和通行密钥之外没有副本，通行密钥步骤在创建通行密钥之前会说明这一点。
- **通行密钥页面是由服务器提供的代码。** 仪式在系统浏览器中运行期间，用户信任 `aeven.io` 提供的页面；一旦 Electron 提供支持 PRF 的平台通行密钥，原生仪式将取代它。
- **重新开始会丢失只有中转服务器持有的内容。** 更换密钥会清除中转服务器上的帧；任何设备都不再持有的数据（例如编写设备已不在、且没有其他设备下载过的对话正文）不会回来，设备离线期间所做删除的墓碑也随旧文档一起丢失。
- **更换密钥后不会重新发布消息反馈。** 反馈行不记录所属账户，因此评分只有在变化时才会进入新文档。
- **移除设备并不撤销它。** 账户密钥不变，因此被移除的设备再次同步时仍能读取内容；撤销它需要新密钥，而由通行密钥保管的账户只能通过通行密钥步骤包装新密钥。
- **删除 Aeven 账户不会清除已同步的帧。** 该账户在中转服务器上的保管库、帧和租约会保留，直到被手动删除。
- **设备只在其账户在该 Host 上持有会话时同步。** 访问令牌只为已登录的客户端保存在内存中，因此没有该账户客户端的 Host 会等待，并在有客户端连接时追上进度。
- **没有设备能运行对话时，输入会等待。** 如果会话的编写方不可达、且本机无法接管其日志，输入会留在收件箱中，直到持有它的设备出现。
- **对话正文在打开时才到达。** 设备先交换会话元数据，在打开时或在限速的后台过程里下载日志，因此从未打开过、且早于 `backfillDays` 的会话仍留在编写它的设备上。
- **中转服务器为每个账户提供的存储尚未测量。** 拥有数 GB 会话的账户会把它们全部保留在中转服务器上。
- **工作区文件只在在线设备之间传输。** 在工作区文件同步说明所规划的云端副本实现之前，设备只能在持有文件夹（或其无法访问远程的仓库副本）的另一台设备在线时接收它；在工作状态检查点实现之前，仓库只带来已提交的工作。在 Aeven 运行自己的服务器之前，发现和中继使用 Syncthing 的公共服务器。
