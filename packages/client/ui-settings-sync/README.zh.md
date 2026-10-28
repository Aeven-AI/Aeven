---
description: "设置 → 同步：开启账户同步、添加此设备、通过代码批准新设备以及移除设备。"
kind: "package-reference"
---

# @aeven/client-ui-settings-sync

[English](README.md) | 中文

## 概述

基于 `sync` Remote 的设置分区，由转发的 `sync/status` 和 `sync/join-requests` 事件刷新。它在两台设备上显示六位代码，并且只从打开了“添加设备”界面的设备批准。文案位于 `settings.sync` 词典中（英文、中文、西班牙文）。见[账户同步分组](../../sync/README.zh.md)。

上传计数和进度条在队列为空时仍保持可见，使卡片在批次之间保持相同高度。

对话准备进度显示所有已发现的积压对话，并与上传批次分开呈现。只要仍有对话待准备或上传待处理，状态就保持同步中。

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

**运行时 invariant：** 不发布 runtime invariant companion，因为这是一个 Client 展示包，只渲染注入的同步快照，不拥有任何运行时关系。
