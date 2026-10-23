# Agent Note: A watcher baseline and a probe path, both only visible under contention

Status: implemented

English | [中文](2026-09-22-watcher-baseline-and-probe-paths-under-contention.zh.md)

## Problem

Two suites failed only when many processes ran over the same files, and both were reported as starvation.

`packages/boot/app-boot/tests/hmr-config.spec.ts` failed 3 of 36 runs at twelve-way contention after the accounting repair in PR #64: two sibling-case timeouts at `120000 ms`, and one target case reading `['one']` instead of `['one', 'two']`. The recorded hypothesis was that a poller starved for a whole 30 s budget, with `/var/...` and canonical `/private/var/...` StatWatchers named as a contributing factor.

`scripts/locale-dictionary-parity.spec.ts` failed a full `check:all` with `ENOENT` for a probe file named `oxlint-contract-<uuid>.ts` under `packages/fs/fs-observation-policy/src/`, which `scripts/oxlint-contract.spec.ts` had created and deleted.

## Decision

Neither failure was starvation, and the HMR hypothesis was wrong.

Chokidar emits `ready` when its directory scan completes, which does not say the per-file `fs.watchFile` StatWatcher that reports changes has taken its baseline. A write landing in that window produces **no tick at all**. Probing the vendored chokidar directly: 5 of 480 deliveries lost at twelve-way contention, 0 of 480 idle, and on every loss the edit was unambiguously on disk (size 3 → 14, mtime advanced) while the StatWatcher had fired no tick. Continuing to wait recovered none of them within 30 s, so the loss is permanent, not late. This is the same hazard PR #64 removed from the test helper; it still lived in the registration's own watcher, which no amount of waiting could fix.

`deliverChange` therefore takes a reading of what the registration has reported and re-touches the file until one arrives, failing with the on-disk size and modification time when nothing does. The case supplies that reading through an `fs.watchFile` witness on the same cadence and mechanism, proven live before the first refresh: HMR serializes the refresh callback, so the registration cannot report the second edit from inside the first, and the witness is what can. Repeats advance only the modification time, so the bytes the case asserts on stay exactly as the edit left them.

The sibling case boots polling like its neighbours and re-applies its stimulus until the first broadcast proves the watcher live, growing the file each time so a repeat is distinguishable from no write at all. Its file does not exist at registration, so its first event is an `add`, which is precisely where the baseline window bites.

For the parity spec, `withTransientProbeWindow` serializes the probe writers against the compiler but not against readers of the same trees. Rather than widening that lock to a reader that merely must not read a vanished file — which would serialize the sweep behind every probe and `tsc` run — `walk` skips the probe naming pattern, so such a path never enters the file list at all. A genuinely absent dictionary stays an error: no shipped source is named `oxlint-contract-<uuid>.*` or `staged-lint-probe-<uuid>.*`.

## Alternatives considered

**Widen the HMR budgets.** The lost delivery is permanent, so no budget reaches it. The 30 s measurement above is the direct evidence.

**Blame the `/var` and `/private/var` spellings.** `findWatchRoot` canonicalizes the watch root, and both spellings name one inode. The probe reproduced the loss without any spelling disagreement, so this was ruled out rather than left open.

**Put the parity spec inside the probe window.** It would serialize a read-only sweep behind every Oxlint probe and compiler run for a race that excluding one filename pattern removes outright.

**Let the parity reader swallow `ENOENT`.** The file already rethrows every non-`ENOENT` failure at `readEntries` so the sweep can never narrow silently; swallowing the same code at the read would let a genuinely missing dictionary pass as absent.

## Consequences

The HMR file passes 72 of 72 runs across two twelve-way sweeps, from 33 of 36. The sibling case's 120 s hang became a 32 s honest error on the way, which is the failure mode the issue asked for: no retries, sleeps, widened budgets or weakened assertions, and both oracles unchanged.

The parity spec passes 25 of 25 runs against continuous probe churn in the reporting tree, where the unfixed spec fails 9 of 25 with the recorded `ENOENT`.

The underlying chokidar behaviour is unchanged and still applies to any first write issued immediately after a watcher reports ready. The repository's answer remains `eventuallyObserved`: re-apply the stimulus until one notification proves the watcher live, then wait plainly.
