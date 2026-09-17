---
description: "面向 DeepSeek Harness 会话日志的模型侧 todo_write 工具：整表替换、单一会话归属与 todos 投影，供选择、配置或排查该工具的用户与维护者阅读。"
kind: "package-reference"
---

# @aeven/tool-todo

[English](README.md) | 中文

## 概述

`avn-tool-todo` 为 agent 提供一份可用于规划的结构化任务列表：把多步工作拆成具体任务、标记正在进行的任务、完成后逐项勾掉。agent 在每一步都把这份列表作为运行时上下文读回，因此无论轮次很长还是跨轮次续做，计划都保持同步，而不必凭记忆重建。一个配置开关决定是否允许多个任务同时处于进行中，适用于并行开展工作的 agent。凡是希望 agent 维护可见任务列表的场景都可以使用它；每次更新整体替换列表，只有拥有该列表的 agent 会话才能修改。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当你希望 agent 在工作时维护一份可见的任务列表时使用本包：规划多步工作、展示当前进行中的任务、记录完成情况。挂载它并设置并行开关是唯一的配置步骤；此后每次计划变化，agent 都会通过它自己的规划工具更新列表。

### 何时选择

当某个 agent 会话应当拥有任务列表、且整表更新即可满足需求时选择它——这是规划工具的常见形态。当多个 agent 必须共享同一份列表、或需要逐项编辑时，请避开：列表只属于一个 agent，每次更新都会替换整个列表。它要求环境中确实存在 agent 会话；从不运行 agent 的纯自动化表面无法使用它。

### 最小配置

`allowParallelInProgress` 是必填项、没有默认值：省略它的组合会在加载时失败，非布尔值也会被拒绝。可能并发运行工作的 agent（subagent、后台命令、workflow 扇出）设为 `true`，需要单活跃项纪律的设为 `false`。

```yaml
- name: '@aeven/tool-todo'
  config:
    allowParallelInProgress: true
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `allowParallelInProgress` | 必填 | 是否允许多个 todo 同时处于 `in_progress`；同时选择模型描述中的活跃状态条款 |

生成的[配置目录](../../../docs/config-catalog.zh.md#aeven-tool-todo)是每个受支持字段的穷尽式真源。

### 每次调用做什么

agent 每次更新都发送完整列表；新列表替换旧列表，因此没有部分更新或逐项编辑。每个条目是一句简短的任务描述，外加 `pending`、`in_progress` 或 `completed` 状态。成功的更新会返回新的计数——`Updated todo list: <pending> pending, <inProgress> in progress, <completed> completed.`——UI 随即展示新计划。任务描述为空或重复、条目带有描述与状态之外的字段、或（禁用并行时）多个任务被标记为进行中，这些情况下更新都会明确失败。

### 单一所有者

任务列表属于创建它的那一个 agent 会话——subagent 与其他 agent 各自维护自己的列表，不存在跨 agent 共享列表的方式。来自 agent 会话之外的调用会被拒绝，因此 agent 会得知更新失败，而不是被静默丢弃。如果你需要多个 agent 共享同一份列表，本包不提供该能力。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释工具背后的设计决策，并指出实现它们的代码位置；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

本工具建立在四项承诺之上：

- **整表替换、日志承载状态。** 模型重新发送整个列表；`todo/write` 快照存放在事件溯源的会话日志上，持久性、回放与恢复重建都来自日志而非服务。
- **单一所有者。** 列表属于调用 agent 会话；不存在共享或 swarm 作用域，非 agent 调用方会被拒绝。
- **部署策略，而非编码规则。** `allowParallelInProgress` 是必填组合选择，因为工具无法观测运行时并发；持久日志不变式刻意不跟随它，因此一种策略下写入的日志在部署收紧另一种策略后仍可回放。
- **校验让落库快照保持诚实。** schema 层拒绝未知键、`execute` 层拒绝空或重复 content，使持久快照与模型自认为写入的内容一致。

[todo_write 工具 Agent Note](../../../.agents/notes/implemented/feature/2026-06-29-todo-write-tool.zh.md) 记录原始设计与备选方案；[并行 in-progress Agent Note](../../../.agents/notes/implemented/feature/2026-07-26-todo-parallel-in-progress.zh.md) 记录该策略决策。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`Config` schema、工具注册、`todos` 与 `todoPlan` 投影单元，以及 `todo:plan` 运行时上下文贡献 |
| [`src/types.ts`](src/types.ts) | `todos` 与 `todoPlan` 投影键声明及其载荷类型的唯一归属地 |
| [`src/client.ts`](src/client.ts) | 客户端命名空间对类型出口的再导出 |
| [`src/invariant.ts`](src/invariant.ts) | 不变式伴生插件：校验持久整表快照与开放轮次归属 |

### 导出形状

本插件是函数／命名空间插件：导出 `name` / `inject` / `apply`，没有默认导出。多余的 `export default` 会让 Loader 的 `unwrapExports` 折叠模块并丢弃 `inject`（参见 [postmortem 0001](../../../docs/postmortem/0001-acp-default-export-drops-inject.zh.md)）。

### 会话投影

当组合挂载 `ctx.sessionProjections`（[`@aeven/session-projection`](../../session/session-projection/README.zh.md)）时，本包在注入的子插件中注册两个单元。`todos` 是 UI 的有效计划：最新的整份 `todo/write` 列表，首次写入前为 `null`，仅由下一次写入替换。轮次边界不会移动它，因此 dock 会持续显示 agent 仍在推进的计划。该键在此处合并进 `SessionProjectionMap`；载体通过历史尾页与 `session/projection` 推送帧提供该值。生命周期理由见 [todo 计划跨轮次边界存续 Agent Note](../../../.agents/notes/implemented/bug-fix/2026-09-16-todo-plan-survives-the-turn-boundary.zh.md)，它反转了此前的[下一轮次清空决策](../../../.agents/notes/implemented/feature/2026-07-28-todo-plan-clears-on-next-turn.zh.md)。`todoPlan` 是模型对同一份列表的回读，声明时不带 `wire`，因此永不发往客户端：它折叠同一份输入，所以 dock 显示的计划与模型回读的计划不可能出现分歧。未挂载注册表的组合不受影响；两个单元的注册见 [src/index.ts](src/index.ts)。

### 持久日志不变式

不变式伴生插件注册到 `ctx.invariants`，先分别校验既有会话与新公布会话一次，再为实时追加推进按会话提交的轮次轨迹。它会拒绝畸形条目、空或重复 content、未知状态，以及开放轮次之外的持久 `todo/write`；核心 session 通用处理声明合并事件，而本生产包拥有 todo 专用规则。它刻意不约束有多少条目处于 `in_progress`，因为那是工具按部署制定的策略，而非持久数据规则（见[事件归属](../../../.agents/notes/implemented/architecture/2026-07-20-todo-event-ownership.zh.md)）。

### 调用机制

每次调用都会先校验提交的列表是否符合 schema，拒绝不一致的输入，成功后把完整快照作为 `todo/write` 会话事件追加并返回新的计数；当前列表始终是日志中最近一次 `todo/write`（回放时后写覆盖先写）。确切的校验与追加步骤见 [src/index.ts](src/index.ts)。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面。它们从会话子系统逐步进入生成的目录，以及工具背后的决策记录。

- [Todo 子系统](../../../docs/subsystems/todo.zh.md)——`todo/write` 事件载荷、归属规则与 `TodoItem`。
- [todo 组映射](../README.zh.md)——同级组页面及其包表格。
- [生成的工具目录](../../../docs/tool-catalog.zh.md#aeven-tool-todo)——模型接收的 `todo_write` schema。
- [生成的配置目录](../../../docs/config-catalog.zh.md#aeven-tool-todo)——每个受支持配置字段及其源声明。
- [todo_write 工具 Agent Note](../../../.agents/notes/implemented/feature/2026-06-29-todo-write-tool.zh.md)——原始设计、备选方案与砍掉的字段。
- [并行 in-progress Agent Note](../../../.agents/notes/implemented/feature/2026-07-26-todo-parallel-in-progress.zh.md)——为何活跃计数上限成为部署策略。
- [todo 计划跨轮次边界存续 Agent Note](../../../.agents/notes/implemented/bug-fix/2026-09-16-todo-plan-survives-the-turn-boundary.zh.md)——投影的有效计划生命周期，以及下一轮次清空规则的反转。

-----

<a id="model-experience"></a>
## 模型体验

### 工具 schema

#### 模型看到什么

模型会看到生成的 [`todo_write` schema](../../../docs/tool-catalog.zh.md#aeven-tool-todo)：一个对象，含一个必填的 `todos` 数组，元素为 `{ content, status }`，其中 `status` 为 `pending`、`in_progress` 或 `completed`。描述是组合后的整表指令，其活跃状态条款跟随 `allowParallelInProgress`。

#### Token 影响

工具可见的每个请求都有固定 schema 开销；在给定配置下描述与 schema 保持稳定。

#### KV Cache 影响

定义与可见性不变时前缀保持稳定。插件生命周期或作用域限制可能使从此 schema 起的复用失效。

### 工具调用历史与结果

#### 模型看到什么

每次 assistant 工具调用都会在参数中保留整个替换列表。成功时原样返回 `Updated todo list: <pending> pending, <inProgress> in progress, <completed> completed.`。稳定失败文本为 ``Error: invalid todo: `content` must be a non-empty string``、`Error: invalid todos: duplicate content "<content>"`、`Error: todo_write requires an owning agent session`，以及——仅在部署设置 `allowParallelInProgress: false` 时——`Error: invalid todos: at most one task may be in_progress (got <n>)`。完整的 `todo/write` 会话事件是 UI 与回放状态，而非第二条工具结果；模型通过下文的运行时上下文读回当前计划，而不必从这些参数中重建。

#### Token 影响

token 用量随模型每次提交的完整列表增长，这些调用参数会保留到压缩（compaction）。结果本身很小且形状固定。

#### KV Cache 影响

仅追加；新可见内容位于可复用请求前缀之后，不会使既有 KV-cache 条目失效。

### 计划回读

#### 模型看到什么

只要存在有效计划，该步骤的运行时上下文就携带一条贡献：`Your current todo list (<completed>/<total> completed) — keep it in sync with todo_write as this work progresses, marking each task completed the moment it is done:`，其后按写入顺序每项一行 `- [<status>] <content>`。它由仅宿主的 `todoPlan` 投影渲染，该投影与 dock 的 `todos` 值折叠同一份输入，并在历史压缩后恢复该计划。首次写入之前以及列表为空时，该贡献渲染为空，完全不产生快照。

#### Token 影响

运行时上下文载体仅在渲染文本变化时才生成持久快照，因此计划未变时后续步骤不产生任何 token 开销；每次重写会把整份列表重发一次，用量以模型自己写入的列表为界。

#### KV Cache 影响

每份快照都是替换型表面消息而非累积，因此该贡献位于可复用请求前缀之后，不会使其失效。

### 陈旧提醒

#### 模型看到什么

只要有效计划中还存在未 `completed` 的任务，本包就会把它重新推到模型眼前：自上次 `todo_write` 起经过 8 个已提交步骤后——此后每 32 个步骤——该步骤的准备过程中会多出一条由插件发出的提醒：`Your todo list has not changed for <n> steps while <open> of its <total> tasks are still open. Update it now with todo_write: mark every task you have finished \`completed\`, and the one you are working on \`in_progress\`.`，其后是当前列表。该提醒携带 `form: 'notice'`，因此是一条普通追加消息，而非运行时上下文快照，也不会替换快照。当计划已完成、不存在或仍然新鲜时不注入任何内容。

#### Token 影响

一条提醒的开销是提醒行加上当前列表，且仅在计划持续陈旧时每 32 个步骤重复一次——会更新或完成列表的 agent 不会再被提醒。

#### KV Cache 影响

每条提醒追加在可复用请求前缀之后，而不是替换其中任何内容。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明工具何时不合适。它们是当前包约束，不是任务积压。

- **仅单一所有者作用域**——列表属于唯一调用 agent 会话；subagent、共享与 swarm 作用域是有意砍掉的部分，非 agent 调用方会被拒绝。
- **条目形状刻意保持最小**——`content` 加三态 `status`；整表替换不需要稳定 id、优先级或 active-form 字段。
- **整表替换是唯一操作**——没有部分更新、没有回读*工具*、没有逐项编辑；模型从运行时上下文读取当前计划，且每次调用都必须重新发送完整列表。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文：未决问题与尚未决定的方向。它明确不具权威性——已交付行为、限制与既定理由以上文、包代码和相关 Agent Note 为准。

#### 未来：跨 agent 与共享列表

单一所有者作用域是有意砍掉的部分，跨 agent 或共享列表仍是独立的未来设计：它们需要逐项日志增量与显式作用域选择，并会改变模型可见约定。目前尚不存在设计。

</details>
