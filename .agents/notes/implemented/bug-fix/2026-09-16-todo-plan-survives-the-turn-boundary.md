# Agent Note: Todo plan survives the turn boundary

Status: implemented

English | [中文](2026-09-16-todo-plan-survives-the-turn-boundary.zh.md)

## Problem

The dock's plan strip emptied at every turn boundary, and readers reported it as deleted work. The [clear-on-next-turn rule](../feature/2026-07-28-todo-plan-clears-on-next-turn.md) made the `todos` projection return `null` on each `turn/start`, on the premise that a reader takes the strip as "what this turn is doing". That premise held only while an agent re-wrote its list early in each turn. Two later changes removed that pressure: letting the model read its own plan back as runtime context on every step (`fix(todo): let the model read its own plan back`), and the stale-plan nudge whose own commit message measured an agent holding one plan for 96 consecutive steps without a write (`feat(todo): nudge a plan that has gone stale`). An agent with no reason to re-write an unchanged list does not re-write it, so the clear stopped emptying the dock for a few seconds and started emptying it for the whole turn.

The failure was a divergence, not just an empty box: `todoPlan` kept the plan while the dock rendered nothing, so the model believed its plan was on screen and the reader saw an empty dock. In the session that surfaced this, three reader complaints ("check todos", "why did the todo get removed?", "again the todos are gone") each landed in a window where the fold had cleared the dock, while the host-only read-back still held the same 13, 21 and 23 items the reader had been watching. An earlier investigation of the same complaint tested only for a cap on item count and concluded that nothing deleted the todos, which is exactly what a diverged fold looks like from the model's side.

## Decision

A plan's lifetime is the session's, not the turn's. The `todos` fold takes the whole list from each `todo/write`, is `null` only before the first write, and returns the same state reference for every other event, including `turn/start` and `turn/end` (`stateVersion` 3). Both projection units now fold identical input — `todos` for the client, `todoPlan` for the model's read-back — so the dock and the agent cannot disagree about the standing plan. Because the registry's change feed notifies only on an `Object.is` change of the raw result, a turn boundary now pushes no `todos` frame at all, and the plan leaves the dock in exactly one way: the next write replaces it.

## Supersedes

The [todo plan clears on next turn](../feature/2026-07-28-todo-plan-clears-on-next-turn.md) decision is reversed: its `turn/start` clearance is gone, along with the distinction it drew between the dock's turn-scoped `todos` and the model's cross-turn `todoPlan`. Its other content still stands — the projection unit and its `wire` contract, last-write-wins whole-list replacement, `turn/end` never clearing, and the rejection of a log-mutating empty `todo/write`.

## Alternatives considered

- **Keep the clear and re-populate the dock from the host-only read-back** — needs `todoPlan` to reach a client, which means either wiring a second client-visible key or letting the dock read a key the wire contract deliberately excludes. Both recreate the two-sources problem this change removes, and both leave the dock briefly empty at every turn boundary.
- **Clear only when every item is `completed`** — narrower, and it does fix the reported case of an in-flight plan disappearing. Rejected because a partially finished plan would still cross the boundary into unrelated later work, which is the staleness the original rule existed to prevent, and because it makes the dock's value depend on statuses the model mutates at arbitrary moments.
- **Clear on `turn/end`** — the original note's first alternative, still worse: it hides the finished checklist while the reader is reading the answer that the checklist explains.
- **Have the reader dismiss the strip** — a real product option, but it needs new persistent per-session UI state and a control in the dock; the projection change is the smaller complete fix, and a dismiss control can layer on top of it later.

## Consequences

The dock keeps showing the plan the agent is actually working to, including across a turn boundary where the plan has not changed, and a completed checklist now stays until the next write replaces it. Staleness is the cost, and it is owned elsewhere: the stale-plan nudge exists precisely to push an agent back to `todo_write` when a plan has gone unchanged, and the runtime-context read-back keeps the model's copy of that same list explicit rather than reconstructed. Reader-visible state now has one meaning instead of two, which is the property the session evidence shows was worth more than the automatic retirement.

The `stateVersion` bump to 3 discards persisted v2 checkpoints, which is required rather than incidental: a v2 row can hold the `null` the cleared fold produced after a `turn/start`, a value the current fold never returns, so restoring it would reintroduce the empty dock from the projection cache. Coverage: the projection specs pin the plan carried across the next `turn/start` and the two folds agreeing at one cut, the client fixture mirror drops `turn/start` from the key's fold and stops pushing a frame for it, and the tool-todo README plus this note carry the lifetime rule.
