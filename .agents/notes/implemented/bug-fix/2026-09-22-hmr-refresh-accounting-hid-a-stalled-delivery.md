# Agent Note: HMR refresh accounting hid a stalled delivery

Status: implemented

English | [中文](2026-09-22-hmr-refresh-accounting-hid-a-stalled-delivery.zh.md)

## Problem

`packages/boot/app-boot/tests/hmr-config.spec.ts`'s `serializes refreshes and waits for them during disposal` failed the `test` gate of a full `pnpm run check:all` at commit 27066260e0 with `expected 2 to be 1` from `expect(maxActive).toBe(1)`, an assertion that reports two refresh callbacks running at once.

Neither the case nor the product could observe that overlap. The callback's `active += 1` / `active -= 1` pair had no `try`/`finally`, and its first invocation delivers the second edit from inside the running refresh through `deliverChange`. A rejected delivery propagated past `active -= 1` and left `active` at 1. HMR keeps a registration after a rejected refresh — `refreshConfig` in `vendor/hmr/src/index.ts` catches the rejection, broadcasts `hmr/config-update-failed`, and re-runs the callback while `state.dirty` holds the still-queued edit — so that queued run added 1 to the stale 1 and reported `maxActive = 2`. In the failing run the case took 30020 ms, the helper's own 30 s delivery expiry, so the rejection was the whole event.

The helper also proved the wrong thing with a tool that cannot prove it. It registered its own `fs.watchFile` and waited for that watcher to report the edit, but `fs.watchFile` compares against the first stat it takes, and that stat is asynchronous: a write issued from the same process immediately after registration can land before it, become the baseline, and then never be reported. A probe on this host lost 10 of 100 immediate writes that way, reported 100 of 100 writes delayed by 20 ms, and lost none to timestamp granularity (0 of 50 same-millisecond rewrites), so the baseline — not the clock, the interval, or the disk — is the hazard. Its failure text claimed the edit "never reached the disk" while the refresh that `maxActive` counted had itself been queued by the registration's watcher, which reports only a path that changed.

## Decision

The oracle is unchanged: `expect(maxActive).toBe(1)` and `expect(observed).toEqual(['one', 'two'])` stay exactly as they were.

The `active += 1` / `active -= 1` pair sits in `try`/`finally`, so a rejected refresh cannot leave the counter raised, and the case records that rejection and rethrows it after `await disposal`. A failed delivery or a rejected refresh therefore fails this case with that error, naming the file and the values it awaited, and `maxActive === 1` reports only a real overlap.

`deliverChange` proves the edit from the file's own size and modification time immediately before and after it — no timer, no second watcher — and throws naming both when neither moved. One poll cadence still follows, for the registration's own `usePolling` watcher, which is what turns the on-disk edit into a queued refresh.

## Alternatives considered

**Fix serialization in `vendor/hmr/src/index.ts`.** No concurrent refresh exists to fix. `refreshConfig` keeps one state object and one task per registration, returns while `state.running` is set, and drains queued edits in `do { state.dirty = false; await refresh() } while (state.dirty)`; the registration disposer awaits that same task. Overlapping callbacks would need a second task, which needs `refreshConfig` to run inside the synchronous prefix of the first task's body — before `state.running = task` — and that needs a synchronous watcher callback from within a refresh. Chokidar delivers its callbacks from the event loop. An instrumented run of the failing shape measured at most one callback inside the body (`maxBodies = 1`) while the counter read 2.

**Widen the helper's 30 s expiry.** The stall is the poller's baseline, not latency; a larger budget relocates the wait and still reports an overlap that never happened.

**Re-apply the edit until the watcher reports it.** A second write would be visible against the new baseline, but that substitutes a different edit for the one the case delivers, and the helper would report a delivery it never verified. `eventuallyObserved` re-applies its stimulus for a watcher that is not yet listening, which is a different state.

**Drop the delivery proof and keep only the cadence.** The case would race the registration's poller and fail at `observed` with `['one']` — an honest but later, harder-to-read signal, with no statement of what the edit left on disk.

## Consequences

A stalled delivery now fails this case with its own error instead of a phantom overlap: the fault injection that reproduced `maxActive = 2` pre-fix fails in 357 ms post-fix with the delivery error, and a real overlap remains the only way to fail `maxActive === 1`.

Why the helper's `fs.watchFile` and the registration's poller diverged for a whole 30 s budget in that run is still unexplained. The probe shows a real, load-sensitive baseline window, and `tmpdir()`'s `/var/...` spelling and the canonical `/private/var/...` root the registration watches are two independent `StatWatcher`s — registering both raises the process's active `StatWatcher` count from 1 to 2 — so they can disagree; which one starved was not reproduced. The sibling case `normalizes refresh failures and broadcasts them without escaping the watcher`, which awaits its first broadcast through a native watcher, timed out at 120000 ms once under the same contention and is unchanged here.
