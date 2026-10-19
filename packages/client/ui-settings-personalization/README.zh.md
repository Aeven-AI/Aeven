---
description: "Settings → Personalization：已登录用户在其中选择 Aeven 如何与自己交谈的浏览器页面。"
kind: "package-reference"
---

# @aeven/client-ui-settings-personalization

[English](README.md) | 中文

## 概述

Settings → Personalization 分区，基于 [`@aeven/personalization`](../../preset/personalization/README.zh.md) 的 `personalization` Remote。页面自上而下是三件事：一行选项中的语气（选中的那项在行下说明自己）、用本人话语写下的备注，以及该人会话所携带的主提示词——它始终可见，不藏在折叠区之后。语气在点击时生效；备注与主提示词在 Save 时生效，主提示词在本人改过之后提供“恢复默认”。页面说明 Aeven 如何称呼他们来自对话本身，而不是向人索要：账户显示名归账户所有，本页不保留姓名字段。

## 目录

- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="model-experience"></a>
## 模型体验

无：该页面不给模型请求添加任何内容；它读写由拥有相应提示词段落的那个包渲染的个人化文档。主提示词编辑器显示这些段落所携带的文本，尚未按会话填入 `{{model}}` 与 `{{cwd}}`。

#### KV Cache 影响

无；这里不产生任何提示词输入。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **不变量省略** —— 不发布运行时不变量伴随模块，因为该页面不持有自己的事实：语气、备注与主提示词都通过 `personalization` Remote 读写，页面只保留那些调用填出的读取缓存。
- **改名** —— 账户显示名在本页没有编辑器；由账户界面负责。

<a id="dev-note"></a>
### 开发备注

无。
