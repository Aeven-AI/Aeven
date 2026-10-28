---
description: "对话历史的账户同步 Consumer：账户的每台设备都列出并重放该账户的会话。"
kind: "package-reference"
---

# @aeven/session-sync

[English](README.md) | 中文

## 概述

由创建会话的设备把会话作为压缩、加密的流批次发布，并在同步的 `sessions/index` 文档中列出；其他设备通过会话持久化以原始 `seq` 导入这些事件，因此导入的会话会被精确重放，且从不运行模型或工具。编写会话的设备通过中转服务器让输入和批次持续到达账户的其他设备，当两者在同一局域网时则直接在设备之间传递；持有完整日志的设备在编写方空闲且中转服务器不可达时继续该对话，而不是复制它。配置：`publishMs`、`batchBytes`、`backfillDays` 和 `runnerLease`。见[账户同步分组](../../sync/README.zh.md)。

历史发布在准备事件之前报告所有已发现的对话。`publishConcurrency` 限制并发压缩的批次数（默认为 4），同时只加载一个对话日志，`compressionQuality` 设置 Brotli 质量（默认为 4）；每个对话内的事件顺序和发件箱上限仍得到保证。未改变的版本不会产生新的上传。只有初始化事件的草稿保留在本地；执行设置和种子标记等到对话产生实际活动后才发布。

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

- **与分组共享** — 账户同步的限制统一列在[分组 README](../../sync/README.zh.md#known-limitations-and-deferred-work)中。

<a id="dev-note"></a>

<a id="开发备注"></a>

### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时 invariant：** 不发布 runtime invariant companion，因为下载进度从会话索引和本地已提交的事件位置派生；上传准备工作和中转帧各自报告待处理工作。设置页直到三者全部完成才结束同步状态。
