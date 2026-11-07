# Agent Note: Turn-start handoff wait and motion on Linux arm64

Status: implemented

English | [中文](2026-11-06-turn-start-handoff-wait-and-motion-linux-arm64.zh.md)

## Problem

On a Linux arm64 Desktop working in a repository another device had checkpointed, every turn waited about 60 s before its first step. `workspace-git-sync` runs `WorkState.apply` in `agent/pre-step`; it found the other device's newer checkpoint, shared its transfer folder, and waited `handoffWaitMs` (60 s) for it. The other device was offline, so the folder never arrived, nothing recorded the miss, and each later turn waited the full 60 s again. The wait also ignored the turn's abort signal, so stopping the turn did not end it. Session logs show the gap between `turn/start` and the first `step/start`: 74 s and 60 s in one session, and 60-63 s in four of five turns of another.

In the same session, `/motion` failed on Linux arm64 for two reasons. The checkout's `@aeven/ffmpeg-linux-arm64` package had no built `bin/`, a local setup gap. `motion-hyperframes` also refused to download Chrome for Testing's headless shell on Linux arm64, citing a missing build; Chrome for Testing now publishes `linux-arm64`, and `@puppeteer/browsers` resolves and downloads it. Once both were present, the render captured every frame and then failed: on the transcode path, ffmpeg wrote `renders/.review.mp4` into a `renders/` directory that did not exist, although `MotionRenderRequest.outputPath` promises the directory is created.

## Decision

- `untilFolder` takes an optional abort signal and resolves false when it aborts. `WorkState.apply` passes the turn's signal.
- `WorkState` remembers, for the Host run, each checkpoint whose wait ran out. A later turn checks that checkpoint once through `folderComplete` and does not wait; a newer checkpoint gets the full `handoffWaitMs` wait again. The miss is logged once per checkpoint.
- `resolveBrowser` downloads the headless shell on every platform `detectBrowserPlatform` reports, Linux arm64 included.
- The HyperFrames renderer creates the output's directory before either encode path runs.

## Alternatives considered

**Skip the wait when the peer is offline.** `FileSync` reports no peer connectivity, and adding it to the Service Definition for this one Consumer is a larger change than bounding the wait.

**Persist missed checkpoints across Host restarts.** The first turn after a restart then could not pick up a checkpoint whose device came back online in the meantime without waiting; one 60 s wait per Host run per checkpoint is the cost kept.

## Consequences

With the other device offline, only the first turn of a Host run waits for its checkpoint; later turns start without the 60 s delay, and Stop ends the wait. `packages/workspace/workspace-git-sync/tests/wait.spec.ts` covers the abort and the single check. On a Linux arm64 host without an installed Chromium, the patched `resolveBrowser` downloaded the 156.0.8078.47 headless shell in 35 s, and that shell rendered a page.
