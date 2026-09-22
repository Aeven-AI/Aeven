# Agent Note: The user patch layer reconciles when the watch reports ready

Status: implemented

English | [中文](2026-09-22-user-patch-layer-reconciles-at-readiness.zh.md)

## Problem

`watchUserPatches()` awaited `hmr.registerConfig(filename, refresh)` and returned its disposer, documented as "after the exact-path watcher is ready". `registerConfig` resolves when chokidar's initial scan finishes, which is not when its notification stream delivers: a `cordis.patch.yml` write landing between the two was announced by nothing, the refresh callback ran zero times, and the layer the app booted with stayed stale for the rest of the process with no error, warning, or diagnostic.

Measured on a 12-core macOS host: 6 of 30 runs under six-way contention, and one of two full-suite runs, where `packages/boot/app-boot/tests/user-patches.spec.ts`'s "watches add, failure, recovery, and removal through transactional HMR" consumed its whole 120 s budget — the budget [the contention case waits Agent Note](2026-09-22-contention-decided-spec-waits.md) had already sized to that case, which the loss made unrecoverable. `refreshes=0` and an independent `node:fs` `watch()` armed before `watchUserPatches()` reporting `fsEvents=0` for the lost write locate the loss in the notification channel rather than in event classification: nothing reached the process.

## Decision

`packages/boot/app-boot/src/index.ts` reconciles once after the registration resolves. It runs the same refresh the watcher runs for an announced event — re-read the patch file, recompose the layer through the caller's `compose`, reapply it to the root Include transactionally — so readiness means what callers already assume: the file on disk when the disposer is handed back is the layer applied, and every later write is announced. The Include's `Entry.update` does no work for a config that deep-equals the mounted one, so a file that did not change costs that read and nothing else.

The reconciliation is app-boot behavior, not watcher behavior:

- app-boot is the side that knows what the consumer loaded. `hmr` sees paths; the mounted layer is the root Include's own config, which is what makes "apply it when the file differs" expressible at all.
- It leaves `vendor/` — pinned upstream source with a sync procedure and an exhaustive local-modification log — untouched.
- It contains a failure the way the watcher contains an announced refresh, per [the config hot-reload resilience Agent Note](2026-07-20-config-hot-reload-resilience.md): the app is live, keeps the layer it booted with, logs the failure, and broadcasts it through the same `hmr/config-update-failed(filename, Error)` event. Only a file that appeared or changed after the boot read can fail here, so the registration promise resolves rather than rejecting for a write that raced startup.

## Alternatives considered

Treating `ready` as sufficient and changing how chokidar classifies `add`/`change` was rejected: the lost write produced no event at all (`fsEvents=0`), so classification is not the defect.

Polling the file, retrying the refresh, or lengthening the case's budget were rejected: the case already consumed its own 120 s budget while the same notification normally arrives in 10–22 ms, so no wait can recover an event the channel never delivered, and a poll or retry only makes the loss rarer while keeping the stale layer.

Reconciling inside `vendor/hmr` after `ready` was rejected: hmr cannot tell what a consumer loaded, so it would have to re-run that consumer's refresh at every registration even when the layer is unchanged, and it would change `registerConfig`'s documented callback contract ("run serially on add, change, or unlink") for every caller — a vendored divergence needing the modification log and sync procedure.

Keeping the workaround the specs use (write the patch file before the watcher opens, so the initial scan reports it as an `add`) was rejected: it moves the loss out of the tests and leaves it in the app.

## Consequences

- A write that races the watcher's startup is applied instead of lost, and a caller of `watchUserPatches()` may now rely on the layer on disk at readiness.
- Each registration costs one extra read of the patch file; an unchanged layer adds no Include work and no event.
- Coverage: `packages/boot/app-boot/tests/user-patches.spec.ts` adds "applies the write the watcher never announced by the time the exact watch is ready" — which fails before this change with the layer still `generated` while the file holds `live` — and "keeps the last applied layer and broadcasts when the missed write cannot be applied", both driving the scan-to-ready window through a stubbed HMR service instead of a contention loop. The 120 s HMR case is unchanged and no longer depends on the initial scan announcing the write.
