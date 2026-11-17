---
description: "`sync` Remote：已登录用户的账户同步状态、本设备的开关、保护或解锁账户的通行密钥步骤，以及账户的设备。"
kind: "package-reference"
---

# @aeven/api-sync-controller

[English](README.md) | 中文

## 概述

基于 `ctx.sync` 的 Typert Remote，只为当前请求的调用方执行操作。`startPasskey` 返回 `siteUrl` 上的 `/passkey/vault` 页面，并在后台最多 `passkeyMs` 内每隔 `passkeyPollMs` 取回密封结果；该步骤在成功前显示在 `status` 中，结束时发出 `sync/status`。创建通行密钥的步骤还会让页面提供它的公钥，中转服务器保存该公钥，账户便可以用这个通行密钥登录。密码管理器以账户的邮箱列出新建的通行密钥：取身份中的邮箱，没有时取调用方传入的 `account` 邮箱；它只是标签，不改变通行密钥的用户句柄，也不改变它持有的密钥。`unlockFromSignIn` 取回一次调用方页面上通行密钥登录在同一次提示中存放的 PRF 结果，并在账户锁定时用它解锁这台设备；没有存放结果的登录不改变账户状态。`unprotect` 把密钥交还给中转服务器，`acceptServerKey` 确认中转服务器收回的密钥。见[账户同步分组](../../sync/README.zh.md)。

状态包含通过 `sync/progress` 收集的对话发布进度、等待处理和排队的中转帧数、下载追赶进度，以及上传或下载失败。

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

**运行时 invariant：** 不发布 runtime invariant companion，因为该 Remote 把每次调用转交给 `ctx.sync`，自身不保留任何状态。
