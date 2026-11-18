---
description: "账户同步的 Yjs Service Provider：本地存储、加密帧、局域网连接和 Aeven 中转连接。"
kind: "package-reference"
---

# @aeven/sync-yjs

[English](README.md) | 中文

## 概述

`ctx.sync` 的提供方。每个账户在 `accounts/<hash>/sync/sync.db` 中保存设备 id、账户密钥及其持有方、文档更新、发件箱和重放计数器，并在该账户的客户端持有 Host 会话期间保持一条中转连接。帧按中转顺序应用；文档在本地压缩并生成快照，以便中转服务器裁剪已覆盖的更新；未确认的帧保留在发件箱中。中转服务器暂时拒绝时，连接会关闭，发布通过已配置的重连循环恢复；其他拒绝会显示为上传失败。本地网络上互相连接的两台设备直接交换文档更新和流批次，因此中转服务器不可达时，正在流出的会话仍会到达另一台设备。设备通过 mDNS 互相发现；每台未设置 `keepConnected` 的设备还会在每次存在标记时，把自己的私有和 Tailscale IPv4 地址写入其设备条目；设备会拨打在 `routeWindowMs` 内打过标记的设备的这些地址，因此在丢弃组播的网络、跨子网和跨 tailnet 时也能建立连接。握手证明账户密钥，且只接受来自回环、私有、链路本地和 tailnet 地址的连接。设置了 `keepConnected` 的设备会在账户的设备列表中把自己标记为始终在线，会话同步据此把对话留在它上面；其他设备每隔 `presenceMs` 打一次 `seenAt` 标记，并在正常关闭时把自己标记为 `offline`，最多等待 `leaveMs` 让该标记到达中转服务器，因此始终在线设备会立即停止向它发送对话。配置：`relayUrl`、`credentialRef`、`deviceName`、`reconnectMs`、`connectTimeoutMs`、`compactAfter` 和 `snapshotAfter`。见[账户同步分组](../README.zh.md)。

尚未取得账户密钥的设备（包括等待通行密钥解锁的设备，以及等待用户接受中转服务器收回的密钥的设备）保持 `starting` 状态；`connecting`、`online` 和 `offline` 状态允许打开本地文档。

状态区分中转连接已建立与下载追赶已完成。追赶失败后从持久化游标重连。上传队列操作复用预编译的 SQLite 语句，接收批次对更新分组时不会为每一帧复制该文档已累计的更新。

## 目录

- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="model-experience"></a>
## 模型体验

无，因为账户同步在设备之间移动已存储的数据，不向模型请求添加任何内容。导入的对话和记忆只通过原本拥有它们的包到达模型。

#### KV Cache 影响

无。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **与分组共享** — 账户同步的限制统一列在[分组 README](../README.zh.md#known-limitations-and-deferred-work)中。

<a id="dev-note"></a>

<a id="开发备注"></a>

### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时 invariant：** 不发布 runtime invariant companion，因为 store 的行与中继的 frame 是仅有的副本，由包内测试直接在数据库上比较。
