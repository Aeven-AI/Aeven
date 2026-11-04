# Agent Teams

English | [中文](agent-team.zh.md)

Types and service API of the task board that one subagent tree shares. The [subagent tree coordination Agent Note](../../.agents/notes/implemented/feature/2026-11-04-subagent-tree-coordination.md) owns tree-wide membership and messaging; this page records the durable form from [`packages/team/agent-team/src/types.ts`](../../packages/team/agent-team/src/types.ts).

## Identity

`TeamId` is the root `SessionId` under a distinct [brand](core.md#branded-ids). `TeamTaskId` is board-local and allocated as `task-<n>` in creation order. Task owners are agent Session ids; the subagent runtime, not the board, decides which agents belong to a tree.

## Shared task DAG

Every `team/task` event in the root Session stores a complete snapshot. `revision` is the compare-and-set value and increments by one per mutation. `blockedBy` edges must name non-deleted tasks and keep the graph acyclic. `writeScopes` are normalized advisory path prefixes rather than locks.

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

`pending` is unstarted or released, `in_progress` carries an owner, `completed` satisfies blockers, and `deleted` is a retained tombstone. Views add readiness and advisory write-scope overlap warnings without changing the durable snapshot.

## Replay

The host-only `agentTeam` projection folds the root Session's `team/task` records whose `teamId` names that Session, so a fork ignores the board it inherited. A record whose revision is not contiguous or whose graph is invalid stops the fold at the last valid state, and every later command reports that failure. Session event `seq` and `time` own ordering and timing. The [package README](../../packages/team/agent-team/README.md) defines task operations and limits.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [Agent](core.md)

Source: [`packages/team/agent-team/src/index.ts`](../../packages/team/agent-team/src/index.ts)
<!-- END GENERATED cordis-surface -->
