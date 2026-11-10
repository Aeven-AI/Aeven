# Agent Note: A user patch written while the watcher arms is still applied

Status: implemented

English | [中文](2026-11-10-user-patch-watch-arming.zh.md)

## Problem

`watchUserPatches` in `packages/boot/app-boot/src/index.ts` resolves once Cordis HMR's chokidar watcher reports `ready` and one reconciliation read has applied the file on disk. Chokidar emits `ready` before its directory watch delivers: a probe that created the watched file at `ready` lost the creation in 28 of 480 runs under twelve-way contention, and none of the lost creations was announced later; a creation 50 ms after `ready` was announced in all 480. A user patch file created or edited in that window stayed unapplied for the life of the process. The same race failed `user-patches.spec.ts` "watches add, failure, recovery, and removal" in 2 of 48 contended runs, at its first write, and timed out the full unit suite once on 2026-11-10.

## Decision

For one second after `ready` (`WATCH_ARMING_WINDOW_MS`, twenty times the measured arming time), `watchUserPatches` also polls the patch file's identity (inode, size, and modification time) every 25 ms. It records the identity each refresh read, announced or reconciled, and applies a changed identity only after it has gone unannounced for 300 ms (`WATCH_ARMING_GRACE_MS`), so a write the armed watcher does announce is applied once and a failing candidate is broadcast once. The poll stops when the window ends with nothing pending, or when the watch is disposed.

The test's `eventually` deadline drops from 120 s to 20 s per step, below the case timeout, so a lost write names its step instead of surfacing as a case timeout.

## Alternatives considered

A longer test timeout or a sleep before the first write would hide the product race that leaves a real user's edit unapplied.

Writing a sentinel file into the watched directory and awaiting its `add` would prove the watch armed, but the watch root can be an ancestor of a missing profile directory, so the sentinel would land in a directory the user owns.

Polling for the life of the process duplicates the watcher; the race exists only while the watch arms.

## Consequences

A patch file created or edited right after boot is applied within the grace. The watcher costs at most forty `stat` calls per registration. A write the watcher announces more than 300 ms late during the window can be applied twice; the second application is a no-op when the file is valid.

## Verification

The chokidar probe above measured the loss and the arming time. After the change, `user-patches.spec.ts` passed 96 of 96 whole-file runs in twelve concurrent processes, where the same harness failed 2 of 48 before, and the app-boot specs pass (141).
