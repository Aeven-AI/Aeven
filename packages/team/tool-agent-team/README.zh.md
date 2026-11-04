---
description: "四个 team_task_* 工具，让同一 subagent 树中的智能体创建、列出、读取与修改共享任务。"
kind: "package-reference"
---

# @aeven/tool-agent-team

[English](README.md) | 中文

## 概述

`avn-tool-agent-team` 为模型提供四个作用于其 subagent 树共享任务板的工具：`team_task_create`、`team_task_list`、`team_task_get` 与 `team_task_update`。借助它们，智能体把并行工作拆分为任务、认领就绪任务、记录将修改的文件并标记进度。这些工具为每个智能体注册；aeven preset 将它们延迟到 `tool_search` 之后，因此从不加载它们的对话不会为其付出任何代价。

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

### 何时选择

当模型需要通过共享任务协调被委派的智能体时，将其与 `avn-agent-team` 一起挂载。本包不接受任何配置。

```yaml
- name: '@aeven/agent-team'
- name: '@aeven/tool-agent-team'
```

### 每个工具的作用

- `team_task_create` 添加一个无负责人的待处理任务，包含标题、详情、可选的 `blocked_by` 任务 id 与可选的 `write_scopes`。
- `team_task_list` 按创建顺序返回任务，可按 `status`、`owner`（智能体 id 或 `unowned`）与 `ready` 过滤，并通过 `cursor` 与 `limit`（1–100，默认 50）分页。
- `team_task_get` 返回单个任务的最新值，包括已删除的任务。
- `team_task_update` 在 `expected_revision` 仍然匹配时应用一个动作——`claim`、`release`、`edit`、`set_dependencies`、`complete`、`reopen`、`reassign` 或 `delete`。

负责人是 `list_agents` 报告的智能体 id。任务变更从不通知或启动其他智能体；当某个智能体需要据此行动时，模型使用 `send_message`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 基于 `ctx.agentTeams` 的工具定义 |

### 调用机制

每个工具解析调用方 Agent 并传给 `ctx.agentTeams`，后者根据调用方的 subagent 树选择任务板。结果是序列化为紧凑 JSON 的任务板视图；任务板拒绝会变为携带其消息的工具错误。没有调用方 Agent 的调用会以 `<tool> requires a calling agent` 失败。

### 不变量归属

不发布 invariant companion，因为这些工具不持有自己的状态；任务板及其唯一持久来源由 `avn-agent-team` 负责。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [`avn-agent-team`](../agent-team/README.zh.md)——任务板语义、权限与拒绝代码。
- [Agent Teams 子系统](../../../docs/subsystems/agent-team.zh.md)——`team/task` 事件与服务 API。
- [生成的工具目录](../../../docs/tool-catalog.zh.md#aeventool-agent-team)——确切的 schema。

-----

<a id="model-experience"></a>
## 模型体验

### 工具 schema

#### 模型看到什么

生成的[任务工具 schema](../../../docs/tool-catalog.zh.md#aeventool-agent-team)。在 aeven preset 中这四个工具是延迟的：系统提示词的延迟工具索引把它们列在“Running subagents and workflows”下，只有在模型通过 `tool_search` 加载后，其 schema 才会加入请求。

#### Token 影响

加载前没有任何成本；加载后，该智能体的每个请求都有固定的 schema 成本。

#### KV Cache 影响

加载会把 schema 一次性追加到请求工具列表，使该智能体从工具列表起的缓存提示词重新计费；之后 schema 保持稳定。

### 工具调用历史与结果

#### 模型看到什么

每次成功调用返回一个 JSON 任务视图——`id`、`revision`、`subject`、`description`、`status`、可选的 `ownerId`、`blockedBy`、`writeScopes`、`ready` 与 `writeScopeWarnings`——对于 `team_task_list` 则返回 `{ tasks, nextCursor? }`。拒绝返回任务板的错误消息，例如 `stale team task "task-1" revision 1; current revision is 2`。

#### Token 影响

每个结果的大小受智能体写入的任务文本限制；`team_task_list` 默认每页 50 行，最多 100 行。

#### KV Cache 影响

仅追加；结果位于可复用请求前缀之后。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **没有常驻任务板视图**——模型只能通过 `team_task_list` 与 `team_task_get` 读取任务板；不会注入提示词。
- **没有变更通知**——任务变更只有在其他智能体读取任务板或收到 `send_message` 时才会被知晓。

<a id="dev-note"></a>

<a id="开发备注"></a>

### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
