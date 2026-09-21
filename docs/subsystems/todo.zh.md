# Todo

[English](todo.md) | 中文

本页记录 [`@aeven/tool-todo`](../../packages/todo/tool-todo/README.zh.md) 拥有的持久 todo 词汇。面向模型的工具会整体替换一个 agent（智能体）会话的列表；该包还拥有事件声明、基于该事件的两个回放投影、模型对该计划的回读，以及不变量配套插件。工具行为与配置见[包 README](../../packages/todo/tool-todo/README.zh.md)。

源码：[`packages/todo/tool-todo/src/types.ts`](../../packages/todo/tool-todo/src/types.ts)

## `TodoItem`：一条列表项

```ts type-equiv
/**
 * One entry in an agent's todo list — the unit of the `todo/write`
 * whole-list snapshot declared by this package.
 *
 * Deliberately minimal: a human-readable `content` line and a three-state
 * `status`. No id, priority, or `activeForm` — the list is replaced wholesale
 * on every write (last-write-wins), so entries need no stable identity. The
 * three statuses describe the complete portable lifecycle needed by model and
 * UI consumers.
 */
interface TodoItem {
  /** What this task is — a short imperative line shown in the UI. */
  content: string
  /** Lifecycle state. `in_progress` marks a task being worked now; parallel work may mark several. */
  status: 'pending' | 'in_progress' | 'completed'
}
```

## 持久事件与不变量

该包通过声明合并把 `todo/write: { todos: TodoItem[] }` 加入 `SessionEventMap`。此事件仅写入日志，并携带完整替换列表；生成的[持久化目录](../persistence-catalog.zh.md#todowrite--log-only)会记录其声明位置。该包的不变量配套插件会单次遍历校验现有会话和新发布的会话，随后增量追踪已提交的轮次边界，使每个实时 `todo/write` 都能在追加前得到校验，而无需重新扫描日志。

## 有效计划、读回与陈旧度

两个重放单元折入同一份输入——会话最近一次整份 `todo/write` 列表，首次写入前为 `null`，其余事件都返回同一份状态引用——差别只在值的去向。`todos` 是接入客户端、由 dock 渲染的有效计划。`todoPlan` 仅存在于宿主——声明时不带 `wire`，因此永不发往客户端——该包把它作为运行时上下文贡献给每一步，因此模型是读回自己的计划，而不是从历史中遗留的 `todo_write` 参数里重建它——那些参数会被压缩（compaction）替换成有损摘要。计划的寿命属于会话，而非轮次：两份折叠都不在轮次边界上移动，因此 dock 与模型不可能持有不同的列表，计划只有在下一次写入替换它时才离开 dock。

第三个仅宿主的单元 `todoStale` 统计自上次写入以来除本工具自身调用之外的工具调用数，并折入本包上次注入提醒时的该计数。本包据此对已经陈旧的有效计划发出提醒，并读取 `ctx.jobs` 的结算信号来覆盖任何计数器都看不到的工作——已 fork 的子代理或后台任务结束时不带自己的 `tool/call`——因此停止更新列表的模型会被告知，而不是默默漂移。
