---
description: "Settings → Personalization：已登录用户在其中选择 Aeven 如何与自己交谈的浏览器页面。"
kind: "package-reference"
---

# @aeven/client-ui-settings-personalization

[English](README.md) | 中文

## 概述

Settings → Personalization 分区，基于 [`@aeven/personalization`](../../preset/personalization/README.zh.md) 的 `personalization` Remote。一个人在四张卡片中选择一种语气，每张卡片带一行示例回复；设置 Aeven 称呼自己的名字，并写下关于自己喜欢怎样回答的备注。该名字就是 Aeven 账户显示名——注册命名步骤所询问的那个——通过已登录 reader 的 `setDisplayName` 写入，因此账户菜单与下一条消息都跟随它；没有 Aeven 账户时该字段不出现。语气在点击时生效；名字与备注在 Save 时生效。每项变更从该人的下一条消息起到达他们的会话。

## 目录

- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="model-experience"></a>
## 模型体验

无：该页面不给模型请求添加任何内容；它读写由拥有相应提示词段落的那个包渲染的个人化文档。

#### KV Cache 影响

无；这里不产生任何提示词输入。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **不变量省略** —— 不发布运行时不变量伴随模块，因为该页面不持有自己的事实：语气、名字与备注都通过 `personalization` Remote 与 Aeven 账户读写，页面只保留那些调用填出的读取缓存。

<a id="dev-note"></a>
### 开发备注

无。
