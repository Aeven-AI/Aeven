---
description: "长期记忆的 Service Definition，供编写记忆提供方或消费方的维护者阅读。"
kind: "package-reference"
---

# @aeven/memory

[English](README.md) | 中文

## 概述

`avn-memory` 提供 `ctx.memory`，即单一长期记忆提供方的槽位。消费方调用 `recall`、`profile`、`capture`、`closeSession`，读取类操作（`detail`、`timeline`、`environments`、`skills`、`useSkill`），以及所有者的记忆操作（`list`、`remember`、`edit`、`forget`、`feedback`），完全不需要知道背后的实现。`list` 接受可选的 `domains` 过滤；它的分页、偏移与总数随后只统计这些领域中的记忆。给出 `cwd` 时，`list` 与召回一样，略去其他每个工作区的项目记忆。`procedures({ owner, cwd? })` 按从新到旧列出所有者的已学流程：文本为 `Learned procedure <name>: <description>` 后接 Markdown 流程的记忆，由 `@aeven/tool-capability` 写入。`profile({ scope })` 返回从该所有者全部 person 记忆中不分记录早晚取得的长期知识：每一条有记录的年度日期（`MemoryDate`：出生、婚礼、离世或纪念日，已知时带年份），以及提供方蒸馏出画像后的画像文本；提供方在作用域的路由上于后台把画像更新到最新。`memoryOriginLabel(hit, now)` 额外给出这条记忆是多久以前记录的。`LEARNED_PROCEDURE_PREFIX` 与 `learnedProcedureOf(record)` 向 Settings 管理器公开这种文本形式。`edit` 与 `forget` 只作用于该作用域所有者的记忆。每条记忆都有一个领域（`MemoryDomain`）：`person`、`world` 与 `experience` 记忆在该所有者的每个会话中都被召回，`project` 记忆只在捕获它的那个工作区的会话中被召回，提供方不返回其他工作区的项目记忆。记忆属于一个已登录用户：每个 `MemoryScope` 都携带来自 `SessionHeader.owner` 的所有者账户 id。它还导出 `memoryScopeOf(agent)`，由它推导该作用域与该会话的模型路由，并对没有所有者的会话返回 undefined，因此这样的会话没有记忆；此外还导出 `MEMORY_TOOL`，即提供方渲染的召回上下文可以引用的、面向模型的工具名。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

在 host 面挂载它。提供方在 effect 内调用 `ctx.memory.register(provider)`；第二次注册会抛出。`ctx.memory.active` 报告是否已注册提供方，没有提供方时除 `closeSession` 之外的每个操作都会抛出 `MemoryUnavailableError`。`ctx.memory.whileActive(setup)` 让一项贡献（例如工具或提示词段落）恰好在提供方已注册期间保持注册。类型位于 [`src/types.ts`](src/types.ts)。

`MemoryTurn.outcome` 可选地携带重试代码、一次明确的纠正、带成功工具调用 id 的已报告验证，以及已完成的目标。提供方可以存储或使用这些证据；一次已报告的验证并不等于独立确立的通过。

<a id="model-experience"></a>
## 模型体验

### 记忆工具名

#### 模型看到什么

本包自己不添加任何提示词文本、工具或会话事件；它为模型固定下来的是下面的工具名与召回作用域。`MEMORY_TOOL` 固定了提供方渲染的召回上下文与命中片段可以指引模型使用的名称：`memory_search`、`memory_get`、`memory_timeline`、`memory_environments`、`memory_skills`、`memory_skill` 与 `memory_remember`，其中 `memory_get` 接受 `MemoryDetailKind` 的取值 `trace`、`policy` 与 `world-model`。[`@aeven/tool-memory`](../tool-memory/README.zh.md) 注册这些工具；本包只拥有名称，因此提供方渲染的文本与它点名的工具不会相互漂移。

#### Token 影响

该常量本身不给请求增加任何内容。每个名称只在提供方自己的渲染文本或某个命中片段使用它时才产生 token 成本。

#### KV Cache 影响

无；名称只作为某个提供方或消费方渲染的文本的一部分进入请求，由该拥有者决定它放在哪里。

### 记忆作用域

#### 模型看到什么

`memoryScopeOf(agent)` 推导提供方作答时所在的作用域：来自会话头的所有者账户、会话 id、工作目录，以及该会话的模型路由。一次召回只返回该作用域可见的命中——`person`、`world` 与 `experience` 记忆在该所有者的每个会话中可见，`project` 记忆只在捕获它的那个工作区的会话中可见——而没有所有者的会话得不到作用域，因此没有任何提供方为它返回记忆。一次召回还会在它的前台预算耗尽而非超出时报告 `timedOut`。

#### Token 影响

召回的文本就是提供方在调用方的 `MemoryRecallRequest` 限制与 `timeoutMs` 之内返回的内容；本包自身不给请求增加 token。

#### KV Cache 影响

这里没有；渲染这些命中的消费方把它们追加进自己的请求，因此本包从不触碰任何前缀。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **每个组合一个提供方** —— 多个记忆提供方之间没有路由。
- **不变量省略** —— 不发布运行时不变量伴随模块，因为提供方槽位与它的 `whileActive` 贡献只在 `register` 及其返回的 disposer 内部变化，监听器只会驱动它所声称要校验的同一套注册；进入模型的内容由已注册的提供方决定，而该提供方自己的包覆盖了它的行为。

<a id="dev-note"></a>
### 开发备注

无。
