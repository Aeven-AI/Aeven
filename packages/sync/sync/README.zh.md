---
description: "账户同步的 Service Definition（`ctx.sync`）：按账户的加密文档、流、设备与加入。"
kind: "package-reference"
---

# @aeven/sync

[English](README.md) | 中文

## 概述

`ctx.sync` Service Definition。Consumer 按逻辑名在账户的保管库中打开文档并编辑其 Yjs 状态，追加和读取流，在另一台设备发送流批次时收到它们（`watchStream`，包括在没有中转服务器的局域网上），统计与本机直接相连的设备数（`linked`），列出和移除设备，并驱动加入流程：`createVault`、`vaultExists`、`join`、`acceptJoins`、`joinRequests`、`approveJoin` 和 `rejectJoin`。`sync/status`、`sync/join-requests` 和 `sync/document` 在账户状态、待处理的加入请求或某个文档变化时通知监听方。`tests/memory.ts` 是供 Consumer 测试使用的内存设备网络。见[账户同步分组](../README.zh.md)。

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
