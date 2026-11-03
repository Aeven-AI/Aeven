---
description: "工作区的文件同步 Consumer：文件夹工作区随账户同步到其他设备。"
kind: "package-reference"
---

# @aeven/workspace-file-sync

[English](README.md) | 中文

## 概述

在账户某台设备上打开的文件夹工作区，会作为一个 `ctx.fileSync` 文件夹与账户的其他设备同步。每台设备在账户的 `file-sync/peers` 文档中发布自己的文件传输对等 id，并只与 `ctx.sync` 列出且对等 id 已知的设备共享文件夹。每个文件夹工作区的文件夹 id、大小和位置提示（其目录相对于主目录的路径）通过 `file-sync/folders` 同步。收到没有目录的工作区的设备会在不询问的情况下为它分配目录：当提示所指的、位于本机主目录下的目录不存在或为空时使用该目录，否则在 `root` 下使用工作区标题，名称被占用时加编号；当大小不超过 `prefetchMaxBytes` 且下载后仍保留 `minFreeDiskRatio` 比例的磁盘空间时立即下载。Git 工作树不发布文件夹：仓库将在后续阶段通过 Git 同步。工作区离开设备后，其文件夹停止同步，文件保留。设计见[工作区文件同步 Agent Note](../../../.agents/notes/proposed/architecture/2026-11-03-workspace-file-sync.zh.md)。

## 目录

- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="model-experience"></a>
## 模型体验

无，因为工作区文件只通过原本就读取工作区目录的文件工具到达模型。

#### KV Cache 影响

无。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **与文件同步分组共享** — 文件同步的限制统一列在[账户同步分组 README](../../sync/README.zh.md#known-limitations-and-deferred-work)中。

<a id="dev-note"></a>

<a id="开发备注"></a>

### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时 invariant：** 不发布 runtime invariant companion，因为同步文档与提供方的文件夹在每次变化时都会重新协调，而不是被独立观察。
