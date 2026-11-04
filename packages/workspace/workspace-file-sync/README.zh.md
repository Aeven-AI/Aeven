---
description: "工作区的文件同步 Consumer：文件夹工作区随账户同步到其他设备。"
kind: "package-reference"
---

# @aeven/workspace-file-sync

[English](README.md) | 中文

## 概述

在账户某台设备上打开的文件夹工作区，会作为一个 `ctx.fileSync` 文件夹与账户的其他设备同步。每台设备在账户的 `file-sync/peers` 文档中发布自己的文件传输对等 id，并只与 `ctx.sync` 列出且对等 id 已知的设备共享文件夹。每个文件夹工作区的文件夹 id、大小和位置提示（其目录相对于主目录的路径）通过 `file-sync/folders` 同步。收到没有目录的工作区的设备会在不询问的情况下为它分配目录：当提示所指的、位于本机主目录下的目录不存在或为空时使用该目录，否则在 `root` 下使用工作区标题，名称被占用时加编号；下载后仍保留 `minFreeDiskRatio` 比例的磁盘空间时立即下载，否则报告 `disk` 失败。Git 工作树不发布文件夹，变成 Git 工作树的文件夹工作区会撤回其描述并停止作为文件夹同步；仓库由 [`@aeven/workspace-git-sync`](../workspace-git-sync/README.zh.md) 同步。工作区离开设备后，其文件夹停止同步，文件保留。设计见[工作区文件同步 Agent Note](../../../.agents/notes/proposed/architecture/2026-11-03-workspace-file-sync.zh.md)。每个文件夹的传输状态会成为其 workspace 的文件状态：文件夹首次拥有全部文件之前为带已到达比例的 `syncing`；之后的变化到达时为不带进度的 `syncing`；没有可到达的持有文件的设备时为 `waiting`；传输报告错误时为带 `folder` 原因的 `failed`。文件夹拥有的文件数至少达到描述符记录的数量，或由本设备创建描述符时，即视为完整；`completeDirectory` 下的标记在重启后保留这一结论，且只有完整的文件夹才记录大小，因此尚未连上对等设备的空文件夹不会缩小描述符。

每个共享文件夹都有一个 `.aeven-workspace` 标记，收到的 workspace 会绑定放置候选位置上带标记的副本，而不是再次下载。文件夹首次下载期间，读取尚未到达的文件会把它移到队列最前面并最多等待 `readWaitMs`，`bash`、`grep` 和 `glob` 最多等待 `gateWaitMs`；在文件到齐之前运行的调用会在结果中带一条说明。智能体读取或写入的文件会在 `scanDelayMs` 内汇总后立即扫描。超过 `batteryDeferBytes` 的首次下载在使用电池时报告 `paused`，接通电源后开始。存在冲突版本的最新文件夹报告带数量的 `conflict`，有本机无法存储的文件时报告带 `unstorable` 的 `failed`。

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
