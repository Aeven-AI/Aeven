---
description: "同一 subagent 树的共享任务板：存储在根 Session 中的 compare-and-set 任务所有权、依赖与建议性写入范围警告。"
kind: "package-reference"
---

# @aeven/agent-team

[English](README.md) | 中文

## 概述

`avn-agent-team` 让同一 subagent 树中的每个智能体共享一个任务板。任务包含标题、详情、可选负责人、必须先完成的任务，以及预计修改的文件或目录。智能体认领就绪任务、完成任务或交还任务，每次变更都声明自己读取到的修订号，因此过时的更新永远不会覆盖更新的工作。任务板保存在树根的 Session 日志中，重启后仍然存在，并且始终可用——无需开启任何模式。请同时挂载 `avn-tool-agent-team`，让模型可以使用任务板。

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

当多个被委派的智能体分工完成同一项工作，并需要看到谁负责哪部分、什么被阻塞、编辑可能在哪里冲突时，选择本包。委派方自己分配每一部分且无需跟踪时，普通 subagent 就足够了。

### 最小配置

在已经提供可继续 subagent 与持久会话存储的组合中挂载服务及其工具，例如基于 `@aeven/base` 构建的组合：

```yaml
- name: '@aeven/agent-team'
- name: '@aeven/tool-agent-team'
```

`maxTasks`（默认 `256`）限制单个任务板上未删除的任务数；[配置目录](../../../docs/config-catalog.zh.md#aevenagent-team)列出所有受支持字段。

### 谁共享任务板

每个根智能体及其任意深度的所有 subagent 共享存储在根 Session 中的任务板。成员关系由 subagent 运行时通过 `ctx.subagents.rootOf()` 决定；任务板不保留自己的 roster。另一个根，包括普通的 Session fork，从空任务板开始。

### 任务生命周期

新任务处于 `pending` 且无负责人。当它依赖的所有任务都 `completed` 时即为就绪。任何成员都可以认领就绪任务，使其变为 `in_progress` 并记录该成员为负责人。负责人或根可以将其释放回 `pending`、编辑、修改依赖、完成、重新打开已完成任务或删除。只有根可以把任务重新分配给自己或任一可继续后代，或取消分配。已删除任务仍可按 id 读取，但不再出现在列表中。

会产生环、指向不存在的任务或让已删除任务继续阻塞其他任务的依赖变更会被拒绝。写入范围是相对于工作区的前缀；与另一个进行中任务范围重叠的任务会报告警告，但从不被阻塞。

### 成功与失败的表现

每个命令都返回带新修订号的已提交任务视图。拒绝以类型化的 `TeamError` 代码表示：`TEAM_TASK_NOT_FOUND`、`TEAM_TASK_STALE_REVISION`、`TEAM_TASK_BLOCKED`、`TEAM_TASK_ALREADY_CLAIMED`、`TEAM_TASK_UNAUTHORIZED`、`TEAM_ROOT_REQUIRED`、`TEAM_MEMBER_NOT_FOUND`、`TEAM_TASK_DEPENDENCY_CYCLE`、`TEAM_TASK_HAS_DEPENDENTS`、`TEAM_TASK_DELETED`、`TEAM_TASK_INVALID_TRANSITION`、`TEAM_INVALID_ARGUMENT`、`TEAM_INVALID_WRITE_SCOPE` 与 `TEAM_TASK_LIMIT`。`TEAM_TASK_PERSISTENCE_UNCONFIRMED` 表示变更已可见但刷盘失败；重试前请先读取该任务。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

### 设计理念

- **单一树身份。** subagent 运行时解析根；任务板不增加成员记录。
- **持久日志，派生状态。** 每次变更向根 Session 追加一个整任务 `team/task` 事件，仅宿主侧的 `agentTeam` projection 把这些事件折叠为任务板。
- **显式权限。** 每个方法都接收确切在线的调用方 Agent；负责人或根修改任务，只有根可以重新分配。
- **边界失败要显式。** `maxTasks` 是经过校验的部署值，耗尽时报告类型化错误，而不是复用 id。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 服务入口、配置与 projection 注册 |
| [`src/task-board.ts`](src/task-board.ts) | 任务命令、权限与 compare-and-set 转换 |
| [`src/journal.ts`](src/journal.ts) | 按根串行化的事务、追加与刷盘 |
| [`src/projection.ts`](src/projection.ts) | 把 `team/task` 事件回放为任务板状态 |
| [`src/task-graph.ts`](src/task-graph.ts) | 对完整任务图的依赖校验 |
| [`src/task-view.ts`](src/task-view.ts) | 就绪状态与写入重叠的派生 |
| [`src/validation.ts`](src/validation.ts) | 文本与写入范围的规范化 |

### 事务

同一个根的命令按到达顺序逐个执行。每个命令读取投影出的任务板，检查期望修订号与调用方权限，追加下一个修订并在返回前刷新 Session。回放会拒绝修订号不连续或依赖图无效的记录；任务板随后保留最后一组有效任务，之后每个命令都会报告该失败。

### 不变量归属

不发布 invariant companion，因为任务板只有一个事实来源：根 Session 的 `team/task` 事件及从中折叠出的 projection，不存在可能分歧的第二个观察。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Agent Teams 子系统](../../../docs/subsystems/agent-team.zh.md)——`team/task` 事件、任务类型与服务 API。
- [`avn-tool-agent-team`](../tool-agent-team/README.zh.md)——面向模型的任务工具。
- [Subagent 树协作](../../../.agents/notes/implemented/feature/2026-11-04-subagent-tree-coordination.zh.md)——任务板依赖的树范围发现与消息。

-----

<a id="model-experience"></a>
## 模型体验

间接地，通过 `avn-tool-agent-team`：它把每个任务视图与拒绝渲染为工具结果；服务本身不添加任何工具、提示词段落或请求输入。

#### KV Cache 影响

任务结果追加在可复用请求前缀之后；服务不修改任何更早的请求内容。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **仅限单进程**——事务队列在内存中，因此共享同一 Session 存储的两个 Host 无法协调同一个任务板。
- **不会自动释放**——负责人结束或停止后任务仍归其所有；必须由负责人或根释放或重新分配。
- **写入范围仅为建议**——重叠只警告，从不加锁；每个 subagent 独立的 worktree 才是真正的隔离。

<a id="dev-note"></a>

<a id="开发备注"></a>

### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
