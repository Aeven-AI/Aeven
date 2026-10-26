---
description: "Session bookmark projection: the labels a user sets on points of a session log, folded from the session/label event and served through the session-projection seam."
kind: "package-reference"
---

# @aeven/session-labels

English | [中文](README.zh.md)

## Summary

A long session has no names for its own points. The turn rail can jump to a turn and the log can be searched, but "the run where the cache first missed" is not a place a client can point at, and re-finding it means re-reading the conversation.

`@aeven/session-labels` owns both halves of a bookmark. `SessionLabelsService.label()` normalizes the text under the deployment's byte budget and appends one `session/label` event; the `sessionLabels` projection folds those events into one label per logged `seq`, oldest first, so a client can list a session's bookmarks and jump to their points without paging the log. Setting a label at the same `seq` replaces the earlier one; text that normalizes to nothing removes it. Delivery, caching, and the wire view stay the projection seam's.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

### When to choose it

Mount it wherever a client lists or navigates a session's history: it is both the verb that writes a bookmark and the read model that serves it. A deployment that never labels anything costs one empty fold and no prompt or request change.

### Minimal configuration

```yaml
- id: session-labels
  name: '@aeven/session-labels'
  config:
    maxLabelBytes: 120
```

`maxLabelBytes` is required: it bounds one label's UTF-8 size, and a label rides a rail marker where a longer string cannot render. The row depends on `sessionProjections`; without that service the fiber stays pending rather than registering anywhere else.

### The verb

`ctx.sessionLabels.label(session, at, text)` returns the text the point now carries (`null` after removal) and the committed event's seq. It throws `SessionLabelTargetError` when `at` names no event in that session's log, so a stale client cannot invent a point. Text is normalized like a session title — one line, control characters stripped, byte-bounded — because both are user-authored text the client renders as one line.

## Understand the implementation

### Design concept

The event carries `{ at, label }` and points at an earlier `seq`, so replay order alone decides the result: the fold keeps rows sorted by `at`, a later label at the same point replaces the earlier one, and an empty label deletes the row. No cross-event state, no header field, and no second event type for removal.

Nothing in the log is rewritten, and the log's meaning for a model is unchanged: the event is not a surface event, so `deriveMessages` never sees it and no request is built from it.

### Source map

- `src/index.ts` — the `session/label` event declaration, the default-exported service (verb, target check, normalization, append), and the `ctx.sessionLabels` Context member.
- `src/projection.ts` — the `sessionLabels` fold and its wire view.
- `src/types.ts` — event payload, fold state, config, snapshot, and the projection-key declarations.

## Model Experience

### Bookmark events

#### What the model sees

Nothing. A `session/label` event is log-only: it is not a surface event, it produces no message, and no prompt text is derived from it. A labelled session and an unlabelled one send identical requests.

#### Token effect

None. The fold runs on the host over events the session already logs.

#### KV Cache effect

None. No prompt token changes, so the cached prefix is untouched.

## Known Limitations and Deferred Work

- **No client surface yet.** The projection is readable and the verb is wired to the Session Remote as `label`, but no shipped client renders a bookmark list, a turn-rail mark, or a "jump to bookmark" control; that is the next slice.
- **Labels are per session.** There is no cross-session index, so "every bookmark in this workspace" is not a query the seam answers.
- **A label survives its target only by `seq`.** If a rewind hides the range a bookmark points at, the row stays and the client must decide how to present a point the transcript no longer shows.
- **A removal is a write, not a deletion.** Clearing a bookmark appends an event with an empty label; the earlier label stays in the log, which is what replay needs and what an export therefore carries.

<a id="dev-note"></a>
### Dev Note

**Runtime invariant:** No companion is published. The plugin's only owned relation is with the projection registry it registers on, which the registry's own fiber disposal already proves; the view it serves is a pure fold of events the log holds, so there is no second observation to diverge.

- The label text contract is the session-title contract on purpose: `normalizeSessionTitle` is imported rather than copied, so the two one-line user-authored texts cannot drift. Changing that rule changes both surfaces, and that is the intended coupling.
- `at` is validated against the log before the append, so an out-of-range point fails as the caller's mistake (`session/label-target-invalid`) rather than writing a bookmark that can never resolve.
- The next slice is the client half: a bookmark action on a turn, a rail marker, and the list. It needs no event or verb change — only a caller.
