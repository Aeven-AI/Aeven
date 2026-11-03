---
description: "文件同步的 Service Definition（`ctx.fileSync`）：在同一账户的每台设备上点对点保持文件夹一致。"
kind: "package-reference"
---

# @aeven/file-sync

[English](README.md) | 中文

## 概述

`ctx.fileSync` Service Definition。Consumer 以随机 id 与账户的对等设备共享文件夹（`share`、`unshare`），列出这些设备（`setPeers`，每台设备的 `peerId`），并读取每个文件夹的状态和大小（`status`）；`file-sync/folder` 通知监听者某个文件夹的状态已变化。提供方负责传输及其进程，Consumer 决定哪些文件夹同步以及它们放在哪里。设计见[工作区文件同步 Agent Note](../../../.agents/notes/proposed/architecture/2026-11-03-workspace-file-sync.zh.md)。

## 目录

- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="model-experience"></a>
## 模型体验

无，因为文件同步在设备之间移动文件，不向模型请求添加任何内容。

#### KV Cache 影响

无。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **与分组共享** — 文件同步的限制统一列在[分组 README](../README.zh.md#known-limitations-and-deferred-work)中。

<a id="dev-note"></a>

<a id="开发备注"></a>

### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时 invariant：** 不发布 runtime invariant companion，因为 Service Definition 只声明能力接口，监听者可比较的每个值都由提供方拥有。
