---
description: "账户同步的保管库密码学：设备密钥、密钥纪元、加密并签名的信封、密钥包装、设备链和批准代码。"
kind: "package-reference"
---

# @aeven/sync-vault

[English](README.md) | 中文

## 概述

基于 `node:crypto` 内置能力的库：Ed25519 和 X25519 设备密钥、保管库密钥纪元、文档名的不透明 HMAC id、由发送设备签名的 AES-256-GCM 信封、为设备或通行密钥 PRF 结果包装密钥环、每台设备都会验证的哈希链接设备链，以及先承诺后揭示的六位批准代码。它不持有状态。见[账户同步分组](../README.zh.md)。

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
