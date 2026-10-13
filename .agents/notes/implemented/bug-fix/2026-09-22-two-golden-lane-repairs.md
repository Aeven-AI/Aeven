# Agent Note: Two golden-lane repairs: a scenario with no script, and a case that opened the starting session

Status: implemented

English | [中文](2026-09-22-two-golden-lane-repairs.zh.md)

## Problem

Two golden-lane cases were red on `main` for reasons of their own.

`snapshots/session/subagent-tool-filter` (an authored scenario) failed before it could compare anything: `llm-replay: script exhausted — session requested model call #1 but its script has only 0`. `deriveReplayScript` builds a scenario's model script from `assistant/chunk` groups only, and neither of this scenario's two fixtures had ever contained one (`git log -S'assistant/chunk' -- snapshots/session/subagent-tool-filter/` is empty). No sidecar override existed either, and `loadSessionScripts` derives a *child* script from the child fixture without consulting an override, so a primary-only override could not have closed it.

`apps/web/tests/minimal-preset.snapshot.ts`'s "expands the completed persistent Bash call in the Web conversation" opened its session positionally — `page.locator('[role="treeitem"]').nth(1)` — while the app boots with its own empty starting session, which sorts first. The case therefore opened that session and waited for recorded history in a correctly empty conversation. Two budgets hid it: the case pinned `60_000` below its lane's `testTimeout: 180_000`, and its locator waits were 10-15 s, so the failure surfaced as a short locator timeout that read as slow rendering.

## Decision

The scenario's fixtures carry the chunk groups its messages imply, authored from the messages themselves (`snapshots/session/subagent-tool-filter/session.jsonl`, `session.1.jsonl`), and the scenario was then refreshed through the harness so the fixture and the harvest agree; the refresh also regenerated the child's `tool-schemas.1.expected.json`, which had been missing `str_replace_editor`.

The web case reaches recorded history the way the scaffold documents — a content search, which is also the first search that opens the lazy `session-query-sqlite` index (`openAt: 'first-search'`) — instead of a row position. Its waits became a named `RENDER_WAIT_MS` in `apps/web/tests/support.ts`, and the case stopped pinning a budget narrower than its lane's.

## Alternatives considered

For the scenario, re-recording with a key was not available (it is `authored`, not `live`, and `AVN_SNAPSHOT=record` re-runs only live scenarios) and would have replaced authored content with a live session's. A `replay.override.json` sidecar closes only the primary session, and the child's empty script would still exhaust on its second call.

For the web case, matching the row by its title was rejected: the starting session's title is a prefix of the recorded one's, so the selector would be a substring accident. Clicking the last row (the pattern one neighbouring spec uses) still encodes an ordering assumption rather than an identity.

## Consequences

- Both lanes are green where they were red: `pnpm run test:snapshot` reports 114 passed with no failures, and the web file passes three of three twice in a row under `AVN_SNAPSHOT=replay`.
- The scenario now proves what it was written for: the child runs with the filtered tool set rather than failing before its first model call.
- The web case fails on the state it is waiting for. Its earlier shape could not distinguish "slow" from "wrong session", which is how the wrong-session bug survived the narrowed budget.
- The refreshed web golden records the current chrome (`Open right sidebar`, `Back to bottom`) and where the loading status sits; `captureStableAria` polls until two snapshots agree, so that frame is stable rather than mid-load.
