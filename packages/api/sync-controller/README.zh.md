---
description: "`sync` Remote：已登录用户的账户同步状态、开启同步、从新设备加入、批准设备以及移除设备。"
kind: "package-reference"
---

# @aeven/api-sync-controller

[English](README.md) | 中文

## 概述

基于 `ctx.sync` 的 Typert Remote，只为当前请求的调用方执行操作。`acceptJoins` 在 `acceptJoinsMs` 内回应加入请求，除非“添加设备”界面先关闭。见[账户同步分组](../../sync/README.zh.md)。

状态包含通过 `sync/progress` 收集的对话发布进度，以及等待处理和排队的中转帧数。

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
