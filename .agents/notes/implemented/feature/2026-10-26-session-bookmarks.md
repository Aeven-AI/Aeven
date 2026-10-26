# Agent Note: Session bookmarks as a logged event, not a header field

Status: implemented

English | [中文](2026-10-26-session-bookmarks.zh.md)

## Problem

A session log is a flat, append-only sequence with no names for its own points. A client can jump to a turn (`turnOutline`) and search the log (`session-query`), but a user who wants to mark "the run where the cache first missed" has nowhere to put that mark: the header carries metadata that must not depend on log content, and a projection can only fold what an event recorded.

Branching already exists as whole-session forking by prefix copy, and `session/rewind` already hides a range inside one session. Neither gives a session a way to remember a point by name.

## Decision

### One event, one point, replay order decides

`session/label` carries `{ at, label }` and points at an earlier `seq`. The fold keeps one row per `at`, sorted by `seq`; a later label at the same point replaces the earlier one, and an empty label deletes the row. One event type covers setting, renaming, and removal, so no union, no second event, and no header field is needed.

The event is not a surface event: `deriveMessages` never sees it, no prompt is derived from it, and the model of a labelled session is the model of an unlabelled one. That is the property that lets bookmarks ship in a product that also answers general questions — nothing about the conversation changes.

### The projection is the read side; the write side is a command

`@aeven/session-labels` registers the `sessionLabels` unit on `ctx.sessionProjections`, so the bookmark list reaches a client through the same seam the turn outline and session stats use, with the same cache key and change feed. The plugin owns the fold only; delivery stays the seam's, and unloading the plugin removes the key.

No command appends the event yet. The event type and its fold are the part that must exist before either a Host RPC or a client control can be designed, because both have to agree on what a label points at.

### What this deliberately does not do

It is not a session tree. A bookmark names a point in one session's log; continuing from that point is already `session.edit` (rewind plus the edited prompt) or a fork at that boundary, and neither needs a tree format to work. Nor is it a header field: the header is written once, describes the session to a loader, and cannot be replayed, while a bookmark is content that arrives throughout a session's life.

## Verification

`packages/session/session-labels/tests/projection.spec.ts` covers the fold: empty start, oldest-first order regardless of the order labels arrive in, replacement at one point, removal by empty label, and the two unchanged-state paths (an unrelated event, and a removal that removes nothing) that the change feed depends on. The package typechecks, `gen-persistence-catalog` lists `session/label` in `KNOWN_SESSION_EVENT_TYPES`, and the web-app bundle mounts the plugin beside `session-turn-outline`.

Not covered: a client surface and a Host command. No shipped UI reads the projection yet, so there is no browser check to run and no `session/label` event in any recorded snapshot.
