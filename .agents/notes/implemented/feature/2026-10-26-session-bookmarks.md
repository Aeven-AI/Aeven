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

### The projection is the read side; the verb and the Remote are the write side

`@aeven/session-labels` registers the `sessionLabels` unit on `ctx.sessionProjections`, so the bookmark list reaches a client through the same seam the turn outline and session stats use, with the same cache key and change feed. Delivery stays the seam's, and unloading the plugin removes the key.

`SessionLabelsService.label(session, at, text)` is the one write path: it refuses a point with no logged event (`SessionLabelTargetError`), normalizes the text under the plugin's `maxLabelBytes`, and appends the event. The normalization is `normalizeSessionTitle` imported from `@aeven/session-title` rather than a second sanitizer: both texts are user-authored and render on one line, and two copies of that rule would drift.

`session.label` is a unary Session Remote that resolves or resumes an ordinary Session like `rename` does, and returns the text the point now carries plus the committed seq; the client's `Session.label` mirrors it one-to-one. The byte budget lives on this plugin's `Config` because it bounds this domain's text, so the web-app bundle row sets `maxLabelBytes` explicitly instead of inheriting a default.

### What this deliberately does not do

It is not a session tree. A bookmark names a point in one session's log; continuing from that point is already `session.edit` (rewind plus the edited prompt) or a fork at that boundary, and neither needs a tree format to work. Nor is it a header field: the header is written once, describes the session to a loader, and cannot be replayed, while a bookmark is content that arrives throughout a session's life.

## Verification

`packages/session/session-labels/tests/projection.spec.ts` covers the fold: empty start, oldest-first order regardless of the order labels arrive in, replacement at one point, removal by empty label, and the two unchanged-state paths (an unrelated event, and a removal that removes nothing) that the change feed depends on. `packages/api/session-controller/tests/session-label.host.spec.ts` covers the verb through the Remote: the committed `session/label` event and its echoed seq, the view the fold then serves, removal by blank text, the byte budget cutting a long label, a point with no logged event mapping to `session/label-target-invalid`, a negative point mapping to `gateway/bad-request` rather than a log lookup, and an unmounted plugin mapping to `gateway/internal`. The package typechecks, `gen-config-catalog` lists `maxLabelBytes`, `gen-persistence-catalog` lists `session/label` in `KNOWN_SESSION_EVENT_TYPES`, and the web-app bundle mounts the plugin beside `session-turn-outline` with its config.

Not covered: a client surface. No shipped UI calls `label` yet, so there is no browser check to run and no `session/label` event in any recorded snapshot.

## Alternatives considered

**A separate bookmark store beside the log.** A durable index of its own would have to be kept consistent with the log through forks, rewinds, imports, and deletions, and it would not travel with an export unless the export learned about it. A projection over events the log already holds needs none of that.

**A client-side store (IndexedDB or local storage).** Bookmarks would then be per device and lost on export or a fresh browser, for a mark whose whole value is that it outlives the session view it was set in.

**A header field.** The header is written once, describes the session to a loader, and cannot be replayed; the reasons are under what this deliberately does not do, above.

**A session tree.** Continuing from a point is already `session.edit` or a fork at that boundary; a tree format would add a structural change to `SESSION_FORMAT_VERSION` for navigation the log already supports.

## Consequences

A bookmark is a log event, so it survives an export, travels through a fork's prefix copy, reaches every client through the projection seam the turn outline uses, and costs one fold when nothing is labelled. The costs are visible in the package README: removal is an append rather than a deletion, a label depends on a `seq` that a rewind can hide, and the seam answers nothing across sessions. The one structural debt this creates is that `session/label` is required-on-read, so a build that does not know the type refuses a log that carries it — the same rule every new event is subject to.
