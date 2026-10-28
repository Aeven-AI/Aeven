---
description: "账户同步的 Yjs Service Provider：本地存储、加密帧、设备批准和 Aeven 中转连接。"
kind: "package-reference"
---

# @aeven/sync-yjs

[English](README.md) | 中文

## 概述

`ctx.sync` 的提供方。每个已加入的账户在 `accounts/<hash>/sync/sync.db` 中保存设备密钥、密钥环、设备链、文档更新、发件箱和重放计数器，并在该账户的客户端在 Host 上持有会话时保持一条中转连接。帧按中转顺序应用；文档在本地压缩并生成快照，使中转服务器可以清理被覆盖的更新；中转服务器直接拒绝的帧会被丢弃，而不会阻塞发件箱。在局域网上互相连接的两台设备直接交换文档更新和流批次，因此中转服务器不可达时，正在流出的会话仍会到达另一台设备。配置：`relayUrl`、`credentialRef`、`deviceName`、`reconnectMs`、`connectTimeoutMs`、`compactAfter` 和 `snapshotAfter`。见[账户同步分组](../README.zh.md)。

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
