# Agent Note: The todo staleness nudge has a recorded pin

Status: implemented

English | [中文](2026-09-22-the-stale-nudge-has-a-recorded-pin.zh.md)

## Problem

`packages/todo/tool-todo`'s staleness reminder is model-visible output with no keyless recorded-session coverage: neither the text before #41 nor the text after it appeared in any fixture, and only `tests/stale-nudge.spec.ts` covered the behaviour. `STALE_WORK` and both reminder sentences could therefore change with both golden lanes staying green — which is what happened when #41 collapsed the thresholds from `3`/`12` to `12` and rewrote the sentence.

The existing `snapshots/session/todo-write` (`recording: live`) writes one plan and never triggers the reminder, because triggering it needs twelve non-`todo_write` tool calls after the write.

## Decision

`snapshots/session/todo-stale-reminder/` records both branches of the reminder in one session: a three-item plan written with `todo_write`, twelve distinct shell steps (which is the work the cadence counts), the reminder, a reconciliation, then one background `bash` job whose settlement is news on its own and produces the settlement sentence, and a final reconciliation. The `/` composition overlay beside the fixture mounts a real task provider (`@aeven/jobs-local`), so the settlement branch exists at all; the replay sibling (`cordis.snapshot.yml`) carries the same rows with `llm-replay` in place of the DeepSeek adapter.

The commands are distinct on purpose: twelve identical calls would also trip `repeat-tool-reminder`, and that reminder's own notice would then sit in the same recording.

## Alternatives considered

Extending `snapshots/session/todo-write` was rejected because that scenario is `recording: live` and the reminder needs twelve deliberate steps in its transcript; a re-record would have to be a live one, and the fixture's subject is the write, not the nudge. Pinning only the cadence branch was rejected because the settlement sentence is different text produced by a different decision path (`label !== undefined` skips the cadence check), so one pin would leave the other unguarded.

## Consequences

- Both sentences are now in the lane: `has not changed for 12 tool calls` and `has not been updated since the background work you started settled`, together with the `tool-todo` notice's transcript summary and the `tool-jobs` settlement notice around it.
- `pnpm run test:snapshot` is 115 passed with no failures, and the scenario passes in both replay and refresh modes; it is authored, so it costs no API key.
- The scenario owns its composition, so a change to the reminder's trigger conditions shows up as a diff in this fixture rather than passing unnoticed.
