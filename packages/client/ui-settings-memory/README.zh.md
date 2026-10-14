---
description: "Settings → Memory：Aeven 对已登录用户已经了解的内容，带查看、纠正与遗忘。"
kind: "package-reference"
---

# @aeven/client-ui-settings-memory

[English](README.md) | 中文

## 概述

`avn-client-ui-settings-memory` 在 Settings 中基于 `@aeven/api-memory-manager` 的 `memoryManager` Remote 注册 Memory 页面。它取代 MemOS Viewer，成为用户检视 Aeven 学到了什么的地方。

## 使用本包

该页面使用与 Plugins 相同的下划线标签页：

- **About you**、**Projects** 与 **Knowledge** 把记忆列为安静的卡片。卡片显示该事实以及它被记住的时间。打开它会显示当时说的话，以及一个含类型、时间与项目的 Details 折叠区。Edit、Forget 与 Show conversation 位于打开后的卡片中。Show conversation 在应用内选中该会话并关闭 Settings。
- **Projects** 按记忆来自的那个会话的工作区文件夹分组卡片。
- 每个记忆标签页只向提供方请求自己的领域（`person`；`project`；`world` 与 `experience`），一次一页。**Load more** 只在提供方报告的该标签页记忆多于已加载数量时出现，并在一个空页或报告的总数结束列表后消失。
- **Standing facts** 列出每条陈述，带 Edit 与 Remove；Remove 在删除前要求确认。
- **Capabilities** 以同样方式列出已学能力：卡片上是名称与描述，Procedure、Runs 与 Learned from 藏在折叠区之后。Edit、退役、恢复与删除留在打开后的卡片中。

文案位于 `settings.memory` 字典中（英文与简体中文）。

## 模型体验

无：该页面只通过 `memory` Remote 读写记忆设置，不注册任何提示词、工具或模型可见结果。

#### KV Cache 影响

无；这里不产生任何提示词输入。

## 已知限制与延期工作

- 该页面在打开时以及自身变更之后重新加载；它不跟随运行中的会话所做的变更。

### 开发备注

**运行时不变量：** 不发布伴随模块。该区块渲染 `memoryManager` Remote 返回的内容，除已加载的分页与打开的那一行之外不保留自己的运行时状态。
