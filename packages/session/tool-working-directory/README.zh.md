---
description: "面向会话已记录工作目录的模型侧 working_directory 工具：读取生效目录，或把会话移入另一个目录，含模型可见的描述与失败信息。"
kind: "package-reference"
---

# @aeven/tool-working-directory

[English](README.md) | 中文

`@aeven/working-directory` 之上的 `working_directory` 模型工具。

## 概述

`avn-tool-working-directory` 让 agent 把自己的会话移入另一个目录。不带参数时它报告会话当前工作的目录；带参数时它解析该路径、拒绝任何不是已存在目录的目标，并记录这次变更，使后续所有文件、shell 与搜索调用都相对于新目录解析相对路径。在仓库开始、在 worktree、检出或子目录中继续的工作，不再需要给每条命令加 `cd` 前缀。凡是 agent 在一个会话中跨目录工作的地方都适用；变更在本次会话余下时间持续。

## 目录

- [契约](#contract)
- [模型体验](#model-experience)
- [已知局限与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="contract"></a>
## 契约

- `working_directory({})` 报告生效目录的 `{ cwd, changed: false }`。头部没有 `cwd` 且没有日志变更的会话没有目录，该调用会失败并要求一个绝对路径。
- `working_directory({ path })` 解析路径（绝对，或相对于生效目录）、要求存在且是目录、追加 `session/cwd`，并报告 `{ cwd, changed: true }`。
- 该工具需要拥有它的 agent 会话；没有会话的调用者会被拒绝，因为目录是按会话记录的日志状态。

渲染用一行说明后果——`Later calls resolve relative paths against it`——因此模型不必推断变更对下一次调用意味着什么。

<a id="dev-note"></a>
## 开发备注

工具刻意做得薄。校验、规范化与日志追加都在 `@aeven/working-directory` 中，因此工具的规格挂载真实服务，并断言会话日志与投影收到了什么；一个自行解析路径的工具会复制那次折叠，并与 shell 工具算出的结果渐行渐远。

规格用完整的头部经 `Session.create` 构造会话，而不经过存储层，因为头部正是测试所变化的对象：带 `cwd` 的会话、没有 `cwd` 的会话，以及相对目标相对于已记录变更组合的会话。`workingDirectory.of()` 返回 `undefined` 是一个真实状态，读取路径与变更路径都必须回应它。

<a id="model-experience"></a>
## 模型体验

### 工具 schema

#### 模型看到什么

模型看到生成的 [`working_directory` schema](../../../docs/tool-catalog.zh.md#aeventool-working-directory)：一个对象，含一个可选的 `path` 字符串，其描述要求绝对路径或相对于当前目录的路径，并说明省略它会读取当前目录。描述指出变更在本次会话余下时间持续，且后续文件、shell 与搜索调用都相对于它解析，因此模型不必在每次调用中重新解析路径。

#### token 影响

在工具可见的每次请求上有固定的 schema 成本；给定配置下描述与 schema 稳定。

#### KV 缓存影响

在定义与可见性不变时前缀稳定。插件生命周期或作用域限制可能使该 schema 起的复用失效。

### 工具调用与结果

#### 模型看到什么

读取返回目录与 `changed: false`；变更返回绝对目录、`changed: true`，以及一行说明对后续调用的后果。稳定的失败信息为 `Error: working_directory requires an owning agent session`、`Error: working_directory: this session has no working directory; pass an absolute path`，以及服务以 `/` 匹配的、点出路径并说明是不存在还是不是目录的信息。

#### token 影响

小且形状固定：一个路径、一个布尔值、一句话。变更本身不会被重发；下一次解析相对路径的调用携带的是它已经拥有的目录。

#### KV 缓存影响

追加式；结果跟在可复用的请求前缀之后，不使既有 KV 缓存条目失效。

<a id="known-limitations-and-deferred-work"></a>
## 已知局限与后续工作

- 没有目录栈，也没有 `cd -`；模型通过指出上一个路径返回。
- 工具不创建目录，也不检查沙箱限制；受限组合必须在拥有限制的地方拒绝根外目标。
- 不发布 invariant 伴随文件，因为它唯一可校验的关系是该服务自身的折叠，而单元规格直接观察该关系，没有独立观察可以偏离。
