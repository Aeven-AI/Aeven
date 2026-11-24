---
title: Hand-edited session logs and protected Host stores
kind: bug-fix
status: implemented
date: 2026-11-24
---

# Hand-edited session logs and protected Host stores

## Summary

An agent on a new desktop account wrote 22 session logs straight into `~/.aeven/sessions` and rewrote them about ten times to fix titles and validation errors. Four product defects turned that into runaway turns, a Host that would not start, and a stop button that did nothing. This change fixes those four.

## What failed

- **Sync re-asked every prompt of a rewritten log.** A log the agent rewrote no longer matched the history this device had published. When another device renamed the session, the fold rewrote the local log and, because the rewrite started after this device's claim base, enqueued every user message in the dropped tail as a new prompt. The prompts carried fresh request ids, so the answered-check missed them, and 372 turns ran across 17 sessions before they were stopped.
- **One corrupt log stopped the Host.** `readArtifactHeader` threw on a log whose first Zstandard frame held more than the header line, and the listing rejected as a whole, so the workspace plugin failed to load.
- **Stop could not reach a turn on another device.** `cancel` and queue edits forward only when `runnerOf` finds a live runner entry. The device running the replayed turns published none (its build predates live runners), so stop fell through to the local path and failed with `session/not-found`.
- **Nothing stopped an agent from writing the Host's stores.** An approved escalation to `danger-full-access` runs bash unconfined, and the file tools return the target unfenced in that mode.

## Changes

- `session-sync` `rewrite()` now asks dropped prompts again only when the accepted events belong to another device's claim. A divergence under this device's own claim means the stored log was changed on disk after publication; the log is put back to the accepted history and no prompt is re-sent.
- `session-persistence-jsonl` classifies header failures as `CorruptSessionHeaderError`; listings skip such a log with a warning, and loading it by id still fails.
- `SessionHandoff.turnElsewhere` falls back to the index entry's `running` mark and `writer` device; `session-controller` routes `cancel` and `updateQueue` through it when no agent is attached here. A stale mark costs one forwarded input that expires unapplied.
- `sandbox-policy` gains `protectedRoots`, set in the base bundle to the Host's stores under `$AVN_HOME`. The file tools refuse writes under them in every mode, Seatbelt profiles end with a denial for them, bwrap mounts them read-only, and `SandboxProvider.protect` wraps `danger-full-access` bash on macOS in an allow-default profile carrying only those denials.

## Not covered

- Landlock cannot carve a protected root out of a writable root, and full-access bash on Linux and Windows still runs unconfined.
- An agent can still stop its own Host with `pkill`; a guard needs its own package.
- Conversations cannot be deleted across devices, and there is no supported conversation import, so an agent asked to import chats still has no product path.
