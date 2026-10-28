---
description: "设置的账户同步 Consumer：每个声明账户作用域的命名空间在账户的每台设备上都相同。"
kind: "package-reference"
---

# @aeven/settings-sync

[English](README.md) | 中文

## 概述

镜像 `ctx.sync` 所服务账户的账户命名空间：每个以 `reach: 'account'` 注册的命名空间——主题、语言、默认模型——都保存在 `settings/account` 文档中，每台设备通过 `ctx.settings.replace` 应用另一台设备改动的分节。空文档由本机播种；否则账户已保存的设置优先于本机的设置，而保持设备作用域的命名空间（端口、路径、提供方密钥、设备支持）从不离开本机。见[账户同步分组](../../sync/README.zh.md)。

## 目录

- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="model-experience"></a>
## 模型体验

间接：诸如默认模型这样的已同步命名空间会改变之后请求的内容，与在设备上直接修改该设置完全相同。本包不添加自己的提示词、工具 schema 或结果。

#### KV Cache 影响

本身没有；变更的命名空间通过与本地设置编辑相同的方式进入请求。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **按命名空间合并** — 分节变化时整个被替换，因此两台设备同时编辑同一命名空间时保留较晚的分节，而不是在其中逐字段合并。
- **首次接触时本机分节会丢失** — 加入的账户如果其设置文档已保存某命名空间，该设备会采用账户的分节。
- **与分组共享** — 账户同步的其余限制见[分组 README](../../sync/README.zh.md#known-limitations-and-deferred-work)。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>供维护者参考的工作上下文 — 点击展开</summary>

作用域声明位于 `@aeven/settings`；本包读取 `describe()` 且不维护自己的命名空间清单，因此新增的账户级设置无需在这里改动即可同步。

</details>
