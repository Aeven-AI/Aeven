# Agent Note: Shared task board for subagent trees

Status: implemented

English | [中文](2026-11-04-shared-task-board.zh.md)

## Problem

Agents in one subagent tree can now find and message each other, but nothing records who owns which part of the work, what must finish first, or where two agents are about to edit the same files. The root has to assign and track every piece in its own context. The experimental Agent Teams packages kept a second roster, mailbox, and control tools beside the subagent runtime, declared a `team/task` event that a release package could not share, and could not ship because release packages may not depend on experimental ones.

## Decision

`@aeven/agent-team` and `@aeven/tool-agent-team` live in a new `packages/team/` release group and replace the five experimental Agent Teams packages. The service follows upstream deepseek-harness's current design: every root Agent and its descendants share one board stored as whole-task `team/task` events in the root Session, and membership comes from `ctx.subagents.rootOf()` rather than a roster. Claims, releases, edits, dependency changes, completion, reopening, reassignment, and deletion are compare-and-set on `revision`; only the owner or the root mutates a task, and only the root reassigns.

The board is always available. There is no Team mode, no `team/mode` event, and no system-prompt section; the four `team_task_*` tools carry their workflow guidance in their descriptions, and the aeven preset defers them behind `tool_search` beside `list_agents` and `send_message`. The base bundle mounts both packages. No client view or UI is added; the `agentTeam` projection is host-only.

No historical Team records exist in shipped data, so the format starts at `team/task` version 1 and decodes no roster or mailbox records. The [experimental Agent Teams packages](../architecture/2026-08-18-experimental-agent-teams-packages.md), [Agent Teams](2026-08-05-agent-teams.md), [Agent Teams Web](2026-08-06-agent-teams-web.md), and [trimmed Agent Teams surface](../simplification/2026-08-12-trim-agent-teams-read-and-lifecycle-surface.md) decisions are superseded.

## Alternatives considered

Porting upstream's Team mode keeps a per-session switch and a menu entry; the request ruled out both, and deferred tools already keep unused schemas out of requests. Keeping the experimental packages preserves a second identity system and blocks release use. A standing board view in the runtime context would cost prompt tokens on every step of every tree.

## Consequences

Task changes never wake or notify agents; agents read the board or receive `send_message`. Ownership is not released automatically when an owner stops. Write scopes stay advisory, while per-child worktrees provide the real isolation. Coordination is process-local, like the subagent capacity pool.

## Verification

Focused tests cover sequential ids, readiness, tree-wide sharing and root isolation, compare-and-set rejection, owner and root authority, reassignment to members only, write-scope warnings, dependency-graph rules, task limits, serialized concurrent commands, unconfirmed persistence, replay failures, and fork isolation. Tool tests cover registration and disposal, the claim workflow from a subagent, list filtering and paging, and refusals.
