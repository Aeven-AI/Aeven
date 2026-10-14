---
description: "面向模型的长期记忆工具，供启用或调优记忆搜索的用户与维护者阅读。"
kind: "package-reference"
---

# @aeven/tool-memory

[English](README.md) | 中文

## 概述

`avn-tool-memory` 在 `ctx.memory` 之上注册七个工具：`memory_search`（跨轨迹、策略、环境模型与 skill（技能）的有界搜索）、`memory_get`（一条轨迹、策略或世界模型）、`memory_timeline`（一个片段的按序轨迹）、`memory_environments`、`memory_skills`、`memory_skill`（加载一个 skill 并记录它的使用），以及 `memory_remember`（存储用户明确要求记住的事实，关于用户本人或关于当前项目）。搜索结果携带每条记忆的领域。工具名来自 `@aeven/memory` 的 `MEMORY_TOOL`，与提供方召回上下文所指向的名称相同。

## 使用本包

按 agent 挂载它（`standard`、`cordis` 与 `ptc` preset 都包含它），放在 host 的 `memory` 槽位旁边。这些工具只在记忆提供方已注册时才注册，并且只读取会话所有者的记忆；在没有所有者的会话中，它们会以“记忆需要已登录用户”的错误失败。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `resultMaxChars` | `1200` | 工具返回的每个正文或片段的最大字符数 |
| `searchTimeoutMs` | `3000` | 一次 `memory_search` 的硬预算；超时返回空结果并带 `timedOut: true` |

## 模型体验

### 记忆工具

#### 模型看到什么

七个工具 schema。`memory_search` 告诉模型每个直接用户轮次已经收到过一次自动召回，只在需要改写或扩展它时才搜索。结果是文本加 JSON 事实，每条正文被裁剪到 `resultMaxChars`。

#### Token 影响

每个请求中六个固定 schema；每条结果按条目受 `resultMaxChars` 约束。

#### KV Cache 影响

静态 schema；结果是仅追加的工具结果。

## 已知限制与延期工作

- **没有模型驱动的纠正或删除** —— 模型可以用 `memory_remember` 添加一条事实，但不能编辑或遗忘记忆；`ctx.memory.edit` 与 `forget` 服务于产品界面。
- **不变量省略** —— 不发布运行时不变量伴随模块，因为这七个工具只通过 `ctx.memory` 读取，并且在该提供方活跃期间才注册，因此所存的每条轨迹、策略与 skill 都属于 `@aeven/memory`，此处的检查只能复述该提供方自己的状态。

### 开发备注

无。
