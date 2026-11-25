# Agent Note: bounded projections restore their state across session rewinds

Status: implemented

English | [中文](2026-11-25-projection-rewind-transition.zh.md)

## Problem

`contextBreakdown` and `contextPressure` keep a running surface-token total plus at most one shadow-price claim, so their persisted checkpoints stay O(1). `session/rewind` is not a surface event for that fold, so it left the total unchanged. A rewind restores the surface as it stood before its target, including spans a later compaction shadowed, and the total kept its post-compaction value instead. The next compaction subtracted the logged price of the restored range from that too-small total. On a real session, a compaction took the figure from 169,090 to 42,544, a rewind to before that compaction left it there, and the next compaction priced 131,936 tokens against 53,158, folding `messageTokens` to −76,829. `contextBreakdown`'s view schema rejects negative counts, so loading the session's history failed with `failed to project session … messageTokens … Too small`. `contextPressure` drifted the same way, and its view clamp hid the error.

## Decision

`ProjectionDefinition` gains an optional `rewind(state, atTarget, event)` transition. For a unit that declares it, `SessionProjectionRegistry` passes `session/rewind` to `rewind` instead of `apply`, together with the unit's own state folded from `init` over exactly the events before the rewind target. A full fold (`buildCell`, and `restore` without a usable row) resolves every rewind in one pass by retaining the unit's state at each targeted seq. States are immutable, so retention holds references only. A live rewind (`drive`/`advanceCell`) replays the Session log before its target once. A `restore` whose replayed tail contains a rewind refolds the unit from seq 0 in one pass, and throws asking for a re-read from seq 0 when the supplied log starts later. Every current caller supplies the complete log.

Both token-meter units declare `rewind`. `contextBreakdown` takes `messageTokens` from the target state and keeps the newest envelope figures, matching `measure()`, which keeps the current request header in force across a rewind. `contextPressure` takes `surfaceTokens` from the target state and keeps its newest usage sample, so `projectedTokens` moves by the surface the rewind dropped or restored. Both drop any armed claim. Both bump `stateVersion`, so the session-projection cache discards checkpoint rows folded under the old semantics.

The shared `addSurfaceTokens` floors the running total at zero. Logged shadow prices come from the estimator of the build that wrote them, while appends reprice under the replaying build's estimator. A total replayed across an estimator change can therefore undershoot a later claim, and the floor keeps that drift a display error instead of making a session's projection fail.

## Alternatives considered

**Retain the running total at every possible rewind target in the unit state.** This is exact without log access, but the persisted checkpoint grows by one entry per turn, which breaks the O(1) bound the shadow-price protocol exists to keep ([context-meter note](2026-08-05-context-meter-blind-to-compaction.md)).

**Log a shadow price next to each `session/rewind`.** This keeps the fold free of log access, but it adds a session event that every rewind producer must emit through the token meter. It also leaves every rewind already on disk unpriced, including the session that exposed the bug.

**Only clamp the total at zero.** That makes the session loadable, but `messageTokens` stays wrong for the rest of the session after any rewind across a compaction.

## Consequences

A rewind costs one replay of the log before its target for each rewind-aware unit, which is the same work `ctx.tokenMeter` already does to rebuild its priced surface. Cold folds stay single-pass and keep extra memory proportional to the number of rewinds only during the fold. Units that fold `session/rewind` in `apply` themselves (the turn-outline units) or must ignore it (`tokenUsage`, whose billed totals never rewind) are unaffected. A projection error after an estimator change shows as an understated figure floored at zero rather than an unloadable session.

## Testing

`packages/session/session-projection/tests/registry.spec.ts` pins the rewind transition on the live drive, identical results for nested rewinds across live, lazily built, cold, and checkpoint-seeded folds, the re-read error for a tail starting after the target, and `apply` still receiving `session/rewind` for a unit without the transition. `packages/llm/token-meter/tests/context-breakdown-projection.spec.ts` reproduces compaction, rewind across it, and a second compaction, keeping `messageTokens` equal to `measure().surfaceTokens` at each step and on a cold restore, and pins the zero floor; it fails without the token-meter `rewind` transitions. Replaying the failing session's stored log through `SessionProjectionRegistry` matches a full canonical reprice of the final surface (`foldSurface` + `estimateMessage`, 58,798 tokens) on all three paths: cold `restore`, the live event drive (which returns to 169,090 at the rewind), and a `restore` seeded from a checkpoint taken before the rewind. Over 64,081 events the cold fold takes about 20 ms. A tail `restore` starting after the rewind target throws the re-read error.
