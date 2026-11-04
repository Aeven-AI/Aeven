# Agent Teams

[English](agent-team.md) | 中文

同一 subagent 树共享的任务板的类型与服务 API。[Subagent 树协作 Agent Note](../../.agents/notes/implemented/feature/2026-11-04-subagent-tree-coordination.zh.md)负责树范围的成员关系与消息；本页记录 [`packages/team/agent-team/src/types.ts`](../../packages/team/agent-team/src/types.ts) 中的持久形式。

## 身份

`TeamId` 是带独立 [brand](core.zh.md#branded-ids) 的根 `SessionId`。`TeamTaskId` 是任务板内的标识，按创建顺序分配为 `task-<n>`。任务负责人是智能体的 Session id；哪些智能体属于同一棵树由 subagent 运行时决定，而非任务板。

## 共享任务 DAG

根 Session 中的每个 `team/task` 事件保存一份完整快照。`revision` 是 compare-and-set 值，每次变更加一。`blockedBy` 边必须指向未删除的任务并保持图无环。`writeScopes` 是规范化的建议性路径前缀，不是锁。

```ts type-equiv
/** Whole durable task snapshot; every mutation increments {@link revision}. */
interface TeamTaskSnapshot {
  readonly id: TeamTaskId
  readonly revision: number
  readonly subject: string
  readonly description: string
  readonly status: TeamTaskStatus
  readonly ownerId?: SessionId
  readonly blockedBy: TeamTaskId[]
  readonly writeScopes: string[]
}
```

`pending` 表示未开始或已释放，`in_progress` 带有负责人，`completed` 满足依赖，`deleted` 是保留的墓碑。视图增加就绪状态与建议性写入范围重叠警告，不改变持久快照。

## 回放

仅宿主侧的 `agentTeam` projection 折叠根 Session 中 `teamId` 指向该 Session 的 `team/task` 记录，因此 fork 会忽略继承来的任务板。修订号不连续或依赖图无效的记录会让折叠停在最后一个有效状态，之后每个命令都会报告该失败。Session 事件的 `seq` 与 `time` 决定顺序与时间。[包 README](../../packages/team/agent-team/README.zh.md) 定义任务操作与限制。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxagentteams--teamservice"></a>

### `ctx.agentTeams` — `TeamService`

Task-board service. Every root Agent and its subagent descendants share the board stored in the root Session; the subagent runtime resolves membership.

```ts cordis-catalog
/**
 * Create one unowned pending task on the caller's tree board.
 * @param caller - exact live tree member creating the task.
 * @param request - task text, blockers, and advisory write scopes.
 * @param signal - cancellation before the task event is appended; omitted means no cancellation.
 * @returns the revision-one task view.
 * @throws TEAM_TASK_PERSISTENCE_UNCONFIRMED when the task is visible but durability is unknown; read it before retrying.
 */
async createTask(caller: Agent, request: CreateTeamTaskRequest, signal?: AbortSignal): Promise<TeamTaskView>

/**
 * Return one task, including a deleted tombstone.
 * @param caller - exact live tree member reading the task.
 * @param id - board-local task identity.
 * @returns the latest task value and derived readiness diagnostics.
 */
getTask(caller: Agent, id: TeamTaskId): TeamTaskView

/**
 * List current non-deleted tasks in numeric creation order.
 * @param caller - exact live tree member reading the board.
 * @returns detached current task views.
 */
listTasks(caller: Agent): TeamTaskView[]

/**
 * Compare-and-set one authorized task transition.
 * @param caller - exact live tree member authorizing the mutation.
 * @param request - task identity, expected revision, action, and action fields.
 * @param signal - cancellation before the task event is appended; omitted means no cancellation.
 * @returns the committed next task revision.
 * @throws TEAM_TASK_PERSISTENCE_UNCONFIRMED when the task is visible but durability is unknown; read it before retrying.
 */
async updateTask(caller: Agent, request: UpdateTeamTaskRequest, signal?: AbortSignal): Promise<TeamTaskView>
```

Types: [Agent](core.zh.md)

Source: [`packages/team/agent-team/src/index.ts`](../../packages/team/agent-team/src/index.ts)
<!-- END GENERATED cordis-surface -->
