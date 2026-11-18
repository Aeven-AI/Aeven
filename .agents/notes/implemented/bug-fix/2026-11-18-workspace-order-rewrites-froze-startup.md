# Agent Note: rewriting the synced workspace order froze every Host start

Status: implemented

English | [中文](2026-11-18-workspace-order-rewrites-froze-startup.zh.md)

## Problem

A CPU profile of a desktop Host that had not answered for three minutes after its start showed all of its main thread in `sync-yjs` `openDocument`, replaying stored updates of one synced document. That document, `workspaces`, held 644 MB in 158 updates on the desktop and 406 MB on the hosted Host; each replay took four to six minutes, and a document is replayed again whenever its last handle closed.

Two defects produced it. `WorkspaceSync.publish` deleted and re-inserted the whole `order` array on every publication, changed or not, and two devices that replaced it at the same time each kept their copy, so the array gathered duplicates no code removed: about 92,000 entries, 3.6 MB per publication. And `sync-yjs` merged a document's stored updates only after 200 of them, so 158 large updates were never merged.

## Decision

- `WorkspaceSync.publish` lists each workspace once and writes the order only when it differs from the document's; reading the order drops duplicates too. The first publication after this change replaces the duplicated list with the short one.
- `sync-yjs` also merges a document once the updates since its last merge exceed `compactBytes` (8 MiB by default).
- `openDocument` first merges a document that is due, on the sync worker, so a document that outgrew its thresholds while closed is never replayed in full on the Host's thread.

## Alternatives considered

- **Keep documents open instead of destroying them at the last close.** Deferred: it removes repeated replays, not the first one.
- **Replace the order array with a map of positions.** Deferred: a format change every device must understand; removing duplicates and unchanged writes ends the growth.

## Consequences

The first open of an oversized document after this change waits for its merge on the sync worker, minutes for the 644 MB document, once per device. Stores keep the merged state, which holds the deleted history as tombstones.
