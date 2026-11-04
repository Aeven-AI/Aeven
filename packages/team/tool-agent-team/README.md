---
description: "The four team_task_* tools that let agents in one subagent tree create, list, read, and change their shared tasks."
kind: "package-reference"
---

# @aeven/tool-agent-team

English | [中文](README.zh.md)

## Summary

`avn-tool-agent-team` gives the model four tools over the task board its subagent tree shares: `team_task_create`, `team_task_list`, `team_task_get`, and `team_task_update`. With them, agents split parallel work into tasks, claim ready ones, record which files they will touch, and mark progress. The tools are registered for every agent; the aeven preset defers them behind `tool_search`, so a conversation that never loads them pays nothing for them.

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

Mount it with `avn-agent-team` whenever the model should coordinate delegated agents through shared tasks. It takes no configuration.

```yaml
- name: '@aeven/agent-team'
- name: '@aeven/tool-agent-team'
```

### What each tool does

- `team_task_create` adds one unowned pending task with a subject, details, optional `blocked_by` task ids, and optional `write_scopes`.
- `team_task_list` returns tasks in creation order, filtered by `status`, `owner` (an agent id or `unowned`), and `ready`, paged by `cursor` and `limit` (1–100, default 50).
- `team_task_get` returns the latest value of one task, including a deleted one.
- `team_task_update` applies one action — `claim`, `release`, `edit`, `set_dependencies`, `complete`, `reopen`, `reassign`, or `delete` — when `expected_revision` still matches.

Owners are agent ids as `list_agents` reports them. Task changes never notify or start another agent; the model uses `send_message` when an agent must act on one.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Tool definitions over `ctx.agentTeams` |

### Call mechanics

Each tool resolves the calling Agent and passes it to `ctx.agentTeams`, which selects the board from the caller's subagent tree. Results are the board's task views serialized as compact JSON; a board refusal becomes a tool error carrying the board's message. A call without a calling Agent fails with `<tool> requires a calling agent`.

### Invariant ownership

No invariant companion is published because the tools hold no state of their own; `avn-agent-team` owns the board and its single durable source.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`avn-agent-team`](../agent-team/README.md) — board semantics, authority, and refusal codes.
- [Agent Teams subsystem](../../../docs/subsystems/agent-team.md) — the `team/task` event and service API.
- [Generated tool catalog](../../../docs/tool-catalog.md#aeventool-agent-team) — the exact schemas.

-----

<a id="model-experience"></a>
## Model Experience

### Tool schema

#### What the model sees

The generated [task tool schemas](../../../docs/tool-catalog.md#aeventool-agent-team). In the aeven preset the four tools are deferred: the system prompt's deferred-tool index lists them under "Running subagents and workflows", and their schemas join the request only after the model loads them with `tool_search`.

#### Token effect

Nothing until loaded; afterwards a fixed schema cost on every request of that agent.

#### KV Cache effect

Loading appends the schemas to the request tool list once, which re-bills the cached prompt for that agent from the tool list onward; the schemas then stay stable.

### Tool-call history and result

#### What the model sees

Each successful call returns one JSON task view — `id`, `revision`, `subject`, `description`, `status`, optional `ownerId`, `blockedBy`, `writeScopes`, `ready`, and `writeScopeWarnings` — or, for `team_task_list`, `{ tasks, nextCursor? }`. A refusal returns the board's error message, such as `stale team task "task-1" revision 1; current revision is 2`.

#### Token effect

Each result is bounded by the task text the agents wrote; `team_task_list` pages at 50 rows by default and 100 at most.

#### KV Cache effect

Append-only; results follow the reusable request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No standing board view** — the model reads the board only through `team_task_list` and `team_task_get`; nothing injects it into the prompt.
- **No change notifications** — task changes reach other agents only when they read the board or receive a `send_message`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
