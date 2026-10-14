---
description: "记忆管理器 Remote：已登录用户的记忆与已学能力，供 Settings → Memory 的维护者阅读。"
kind: "package-reference"
---

# @aeven/api-memory-manager

[English](README.md) | 中文

## 概述

`avn-api-memory-manager` 在 Settings → Memory 背后提供 `memoryManager` Remote 命名空间。每次调用都为发起当前 `/api` 请求的调用方行事（`ctx.identityUsers.actingUser()`），没有已登录用户的请求会失败。它通过 `ctx.memory` 列出、编辑与遗忘调用方的记忆，通过 `ctx.capabilities` 列出、读取、编辑、退役、恢复与删除调用方的已学能力，并且是通过 `ctx.memoryInvariants` 写入调用方已确认不变量的唯一写入者。

## 使用本包

`avn-web-app` bundle 在 `capability` 行之后挂载它。方法：

- `memories({ query?, domains?, limit, offset })` 返回一页，或在没有记忆提供方运行时返回 `{ available: false }`。每条记忆携带它来自的那个会话的工作目录（当该会话仍在列表中时），因此页面可以按工作区分组项目记忆。给出 `domains` 时，该页、它的偏移与 `total` 只统计这些领域中的记忆。
- `editMemory(id, summary)` 与 `forgetMemory(id)` 只改动调用方自己的记忆。
- `invariants()` 返回调用方确认永远成立的陈述，并给出它们的块占用多少字符以及渲染所用的上限，或在没有 `memory-invariants` 行运行时返回 `{ available: false }`。
- `addInvariant(text)`、`editInvariant(id, text)` 与 `removeInvariant(id)` 写入该文档，并返回这次尝试之后调用方的状态。块放不下的陈述、长于整个块的陈述、空白文本或未知标识符会被连原因一起拒绝，而不是先写入再从块中丢弃。
- `capabilities()` 列出能力及其当前修订的运行次数；`capability(name)` 另外给出流程、变更历史与已判定的执行，最新的在前。
- `editCapability(name, { description, content })` 以 `source: 'user'` 保存一个新修订；受信能力随后需要一次已验证运行才会重新受信。
- `setCapabilityStatus(name, 'retired' | 'learned')` 撤回一项能力或让它重新投入使用；之后由它的证据决定可执行状态。`deleteCapability(name)` 连同历史一起删除它。
- `capabilityVersions(name)` 按从旧到新列出流程仍被保留的修订，`rollbackCapability(name, revision)` 把其中一个恢复为新修订，该修订随后对自己的证据负责。

在这里做出的变更，其出处都不携带会话。被提升的不变量是调用方自己的陈述：它在该账户的下一个请求中生效，并比提出它的那条记忆活得更久。

配置：`timeoutMs`（默认 15000）约束每次记忆提供方调用；`maxPageSize`（默认 200）约束一个记忆分页。

## 模型体验

### 被提升的不变量

#### 模型看到什么

调用方确认永远成立的陈述，每行一条，位于该账户每个请求都携带的 `<invariants>` 块内。框架、那段指引句与上限都属于 [`@aeven/memory-invariants`](../memory-invariants/README.zh.md#model-experience)，而本 Remote 是该文档的唯一写入者：`addInvariant` 把一条陈述放进所有者的下一个请求，`editInvariant` 在原位置替换它的行，`removeInvariant` 把该行取走。一次拒绝（`empty`、`too-long`、`full`、`missing`）只回答给管理页面，完全不会到达任何请求。

#### Token 影响

自身没有：该块本来就位于其所有者每个请求中，一次写入改变的是它承载的内容。`invariants()` 报告页面在提升之前就给出的成本——内容占用的字符数、该行的 `maxChars`，以及一条陈述可以占用的最长文本——因为这些字符会在该账户每个请求上再次付费。

#### KV Cache 影响

对本包组装的请求没有影响，因为它不组装任何请求。一次写入改变不变量块，因此承载它的段落从该所有者的下一个请求起就不同，包含它的前缀的复用到此结束。上面的读取与分页请求不改变任何请求。

### 被编辑的记忆与能力

#### 模型看到什么

调用发生的那一刻什么都没有：页面、变更结果与拒绝原因都是浏览器载荷，而本包不注册任何提示词段落、工具 schema 或会话事件。一次调用所改变的内容之后才到达模型，经由拥有该渲染的消费方——一条被纠正或遗忘的记忆就是下一次召回与 `memory_search` 返回的内容；被编辑、退役、恢复或删除的能力则改变能力消费方召回的描述与流程，或 `capability_manage` 读取所显示的内容，而受信能力被编辑后的修订需要一次已验证运行才会重新受信。在这里做出的变更，其出处都不携带会话。

#### Token 影响

调用中没有任何影响。后续请求按消费方自己的上限为召回文本付费，而在这里被编辑的一行记忆仍占它在预算中的位置。

#### KV Cache 影响

没有直接影响：一次编辑不改变任何已组装的请求。后续轮次从它召回的内容是那一轮次历史中仅追加的文本。

## 已知限制与延期工作

- 按工作区分组会为每次分页请求读取每个已列出的会话头。

### 开发备注

**运行时不变量：** 不发布伴随模块。它服务的每次读取都来自同一次调用内的拥有者服务，因此该 Remote 不保留自己的状态，也没有关于它的第二种观察可以漂移。
