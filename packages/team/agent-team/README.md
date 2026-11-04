---
description: "Shared task board for one subagent tree: compare-and-set task ownership, dependencies, and advisory write-scope warnings stored in the root Session."
kind: "package-reference"
---

# @aeven/agent-team

English | [中文](README.zh.md)

## Summary

`avn-agent-team` gives every agent in one subagent tree a shared task board. A task has a title, details, an optional owner, the tasks that must finish first, and the files or directories it expects to change. Agents claim ready tasks, complete them, or hand them back, and every change states the revision it read, so a stale update can never overwrite newer work. The board lives in the tree root's Session log, survives restarts, and is always available — there is no mode to switch on. Mount `avn-tool-agent-team` beside it so the model can use the board.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

### When to choose it

Choose it when several delegated agents divide one piece of work and need to see who owns which part, what is blocked, and where their edits might collide. Plain subagents suffice when the delegating agent assigns every piece itself and nothing needs tracking.

### Smallest working setup

Mount the service and its tools in a composition that already provides continuable subagents and durable session storage, such as one built on `@aeven/base`:

```yaml
- name: '@aeven/agent-team'
- name: '@aeven/tool-agent-team'
```

`maxTasks` (default `256`) bounds the non-deleted tasks on one board; the [configuration catalog](../../../docs/config-catalog.md#aevenagent-team) lists every accepted field.

### Who shares a board

Every root agent and all of its subagents, at any depth, share the board stored in the root Session. The subagent runtime decides membership through `ctx.subagents.rootOf()`; the board keeps no roster of its own. A separate root, including an ordinary Session fork, starts an empty board.

### Task lifecycle

A new task is `pending` and unowned. It is ready once every task it depends on is `completed`. Any member can claim a ready task, which makes it `in_progress` and records the member as owner. The owner or the root can release it back to `pending`, edit it, change its dependencies, complete it, reopen a completed task, or delete it. Only the root reassigns a task, to itself or any continuable descendant, or unassigns it. Deleted tasks stay readable by id but leave the list.

Dependency changes that would create a cycle, name a missing task, or leave a deleted task blocking another are rejected. Write scopes are workspace-relative prefixes; a task whose scopes overlap another task in progress reports a warning and is never blocked.

### What success and failure look like

Every command returns the committed task view with its new revision. Refusals are typed `TeamError` codes: `TEAM_TASK_NOT_FOUND`, `TEAM_TASK_STALE_REVISION`, `TEAM_TASK_BLOCKED`, `TEAM_TASK_ALREADY_CLAIMED`, `TEAM_TASK_UNAUTHORIZED`, `TEAM_ROOT_REQUIRED`, `TEAM_MEMBER_NOT_FOUND`, `TEAM_TASK_DEPENDENCY_CYCLE`, `TEAM_TASK_HAS_DEPENDENTS`, `TEAM_TASK_DELETED`, `TEAM_TASK_INVALID_TRANSITION`, `TEAM_INVALID_ARGUMENT`, `TEAM_INVALID_WRITE_SCOPE`, and `TEAM_TASK_LIMIT`. `TEAM_TASK_PERSISTENCE_UNCONFIRMED` means the change is visible but its flush failed; read the task before retrying.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design philosophy

- **One tree identity.** The subagent runtime resolves the root; the board adds no membership records.
- **Durable log, derived state.** Each change appends one whole-task `team/task` event to the root Session, and the host-only `agentTeam` projection folds those events into the board.
- **Explicit authority.** Every method takes the exact live calling Agent; the owner or the root mutates a task, and only the root reassigns.
- **Bounds that fail loud.** `maxTasks` is a validated deployment value, and exhaustion reports a typed error instead of reusing an id.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Service entry, configuration, and projection registration |
| [`src/task-board.ts`](src/task-board.ts) | Task commands, authorization, and compare-and-set transitions |
| [`src/journal.ts`](src/journal.ts) | Serialized per-root transactions, append, and flush |
| [`src/projection.ts`](src/projection.ts) | Replay of `team/task` events into board state |
| [`src/task-graph.ts`](src/task-graph.ts) | Dependency validation over the complete task graph |
| [`src/task-view.ts`](src/task-view.ts) | Readiness and write-overlap derivation |
| [`src/validation.ts`](src/validation.ts) | Text and write-scope normalization |

### Transactions

Commands for one root run one at a time in arrival order. Each reads the projected board, checks the expected revision and the caller's authority, appends the next revision, and flushes the Session before returning. Replay rejects a record whose revision is not contiguous or whose graph is invalid; the board then keeps its last valid tasks and every later command reports the failure.

### Invariant ownership

No invariant companion is published because the board has a single source of truth: the root Session's `team/task` events and the projection folded from them. There is no second observation that could diverge.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Agent Teams subsystem](../../../docs/subsystems/agent-team.md) — the `team/task` event, task types, and the service API.
- [`avn-tool-agent-team`](../tool-agent-team/README.md) — the model-facing task tools.
- [Subagent tree coordination](../../../.agents/notes/implemented/feature/2026-11-04-subagent-tree-coordination.md) — tree-wide discovery and messaging the board relies on.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `avn-tool-agent-team`, which renders every task view and refusal as its tool result; the service itself adds no tool, prompt section, or request input.

#### KV Cache effect

Task results append after the reusable request prefix; the service changes no earlier request content.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Single process only** — the transaction queue is in memory, so two Hosts sharing one Session store cannot coordinate one board.
- **No automatic release** — a task stays owned when its owner finishes or stops; the owner or the root must release or reassign it.
- **Write scopes are advisory** — overlaps warn and never lock; separate worktrees per subagent are the actual isolation.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
