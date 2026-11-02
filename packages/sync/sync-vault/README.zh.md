---
description: "账户同步的保管库密码学：账户密钥、不透明文档 id 与 AES-256-GCM 信封。"
kind: "package-reference"
---

# @aeven/sync-vault

[English](README.md) | 中文

## 概述

基于 `node:crypto` 内置能力的库：32 字节账户密钥、按文档或流 id 经 HKDF 派生的内容密钥、逻辑名的不透明 HMAC id、以明文头部作为关联数据的 AES-256-GCM 信封，以及设备在局域网上建立连接时交换的密钥证明。它不持有状态。见[账户同步分组](../README.zh.md)。

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

**运行时 invariant：** 不发布 runtime invariant companion，因为 envelope 认证与不透明 id 派生都由包内测试针对其字节校验，且没有任何地方发布可发散的同进程值对。
