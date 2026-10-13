# Agent Note: Session search stays opt-in

Status: implemented

English | [中文](2026-10-01-session-query-stays-opt-in.zh.md)

## Problem

[Session search is offered by default](2026-10-01-session-query-by-default.md) mounted `@aeven/tool-session-query` in all four shipped presets: five tools (`session_search`, `session_event_search`, `session_trace`, `session_event_trace`, `session_event_read`) and a guidance section, about **426 tokens** of model-facing text on every turn. The argument for the row was that no shipped composition offered any route from a session to its own workspace's earlier sessions; the argument against it was measured afterwards.

The memory benchmark's memory arm answered 20 of 21 probes with recall alone, and no probe called a session-query tool. That observation is **not** evidence about the tools: the benchmark mounts its own rows (`@aeven/memory`, `@aeven/memory-memos`, `@aeven/memory-context`, `@aeven/tool-memory`) and no preset roster, so the probes never had the five tools. A scan of 126 recorded sessions finds no call to any of them either, for the same reason: the rows were uncommitted, so no session ever offered them.

What remains is the cost against an unmeasured benefit, in a session budget where recall already answers the measured questions, and the fix that makes recall answerable ([an explicit search returns the captured message](../bug-fix/2026-10-01-recall-returns-the-captured-message.md)) covers the case the row was added for: material a distilled summary dropped.

## Decision

The four shipped presets do not mount `@aeven/tool-session-query`. The package stays in the tree, `apps/cli/package.json` keeps declaring it so a profile that mounts the row resolves it, and the generated tool catalog keeps describing it: its entry already says the package is opt-in, which is true again.

Claiming the row back requires a measurement that mounts it beside a memory provider and reports what it answers that recall did not.

## Alternatives considered

- **Keep the row and revisit after measuring.** The row costs every session and every turn until that measurement exists, and the measurement needs a benchmark condition rather than a committed default; the default can be restored in one row once such a condition shows a gain.
- **Delete the package.** It is the only surface that reads a session's own earlier transcripts, including material no provider distilled; a debugging or forensic composition still wants it, and deleting it would make an opt-in capability unreachable instead of unpriced.
- **Mount only the two search tools.** Halves the row and keeps the same unmeasured bet, and the earlier note's own reasoning — that lineage and payload are what a hit needs next — argues against splitting it.
- **Raise the memory provider's recall budget instead.** Recall and the session record answer different questions: recall states what was remembered, the record holds what was said.

## Consequences

Every shipped session loses five tool descriptions and one guidance section from its request, about 426 tokens per turn, and a model choosing among tools has a smaller field. A session that needs the raw record must mount the row itself.

The sharp edge recorded with the row remains for anyone who mounts it: a Host started before the package was declared cannot resolve it through `$AVN_HOME/profiles/node_modules`, and the preset then fails to mount. The declaration in `apps/cli/package.json` is kept for that reason.

## Verification

`pnpm exec vitest run packages/preset/agent-presets` passes 186 tests across 12 files, including the preset roster and mount specs. `grep -rn tool-session-query packages/preset/agent-presets/presets` returns nothing while `apps/cli/package.json` still declares the dependency, and the snapshot case `snapshots/session/session-query-spill` still mounts the row directly. The frozen memory benchmark is re-run unchanged after the removal; its memory arm is the baseline that any later claim for the row has to beat.
