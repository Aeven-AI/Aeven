---
description: "设置 → 同步：本设备的开关、用通行密钥保护账户，以及账户的设备；以及通行密钥弹窗。"
kind: "package-reference"
---

# @aeven/client-ui-settings-sync

[English](README.md) | 中文

## 概述

基于 `sync` Remote 的设置分区，由转发的 `sync/status` 事件刷新：本设备的开关、上传进度条、通行密钥开关（只有在用户确认已了解没有设备或通行密钥时数据无法恢复后才开启保护）与数量、解锁，以及账户的设备。`shell.overlay` 弹窗在页面上登录后（读者的 `signedInThisPage`）提供保护，在本设备被锁定时请求通行密钥，并在以中转服务器收回的密钥同步前先询问用户；它最多每两秒读取一次状态。通行密钥步骤在点击时于系统浏览器中打开其页面。文案位于 `settings.sync` 词典中（英文、中文、西班牙文）。见[账户同步分组](../../sync/README.zh.md)。

上传计数和进度条在有待上传内容时显示。下载追赶期间状态保持“正在同步”；空闲设备显示“已是最新”，不显示空计数。低调的状态图标可打开标准菜单，查看失败详情并重试。

对话准备显示完整的已发现积压，与上传批次分开。只要对话准备、排队上传或下载追赶仍未完成，状态就保持同步中。设备列表的变化独立于上传状态刷新列表，重叠的通知共用一个正在进行的读取和一个待处理的刷新。“忘记设备”只移除列表条目，不撤销访问权限。

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
