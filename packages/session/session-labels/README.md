---
description: "Session bookmark projection: the labels a user sets on points of a session log, folded from the session/label event and served through the session-projection seam."
kind: "package-reference"
---

# @aeven/session-labels

English | [中文](README.zh.md)

## Summary

A long session has no names for its own points. The turn rail can jump to a turn and the log can be searched, but "the run where the cache first missed" is not a place a client can point at, and re-finding it means re-reading the conversation.

`@aeven/session-labels` folds the `session/label` event into a `sessionLabels` projection: one label per logged `seq`, oldest first, so a client can list a session's bookmarks and jump to their points without paging the log. Setting a label at the same `seq` replaces the earlier one; an empty label removes it. The plugin owns only the fold — delivery, caching, and the wire view are the projection seam's.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Use this package

### When to choose it

Mount it wherever a client lists or navigates a session's history: it is the read side of bookmarks. A deployment that never sets `session/label` costs one empty fold and no prompt or request change.

### Minimal configuration

```yaml
- id: session-labels
  name: '@aeven/session-labels'
```

The row depends on `sessionProjections`; without that service the fiber stays pending rather than registering anywhere else.

## Understand the implementation

### Design concept

The event carries `{ at, label }` and points at an earlier `seq`, so replay order alone decides the result: the fold keeps rows sorted by `at`, a later label at the same point replaces the earlier one, and an empty label deletes the row. No cross-event state, no header field, and no second event type for removal.

Nothing in the log is rewritten, and the log's meaning for a model is unchanged: the event is not a surface event, so `deriveMessages` never sees it and no request is built from it.

### Source map

- `src/index.ts` — plugin identity, the `session/label` event declaration, and the registration.
- `src/projection.ts` — the `sessionLabels` fold and its wire view.
- `src/types.ts` — event payload, fold state, and the projection-key declarations.

## Model Experience

### Bookmark events

#### What the model sees

Nothing. A `session/label` event is log-only: it is not a surface event, it produces no message, and no prompt text is derived from it. A labelled session and an unlabelled one send identical requests.

#### Token effect

None. The fold runs on the host over events the session already logs.

#### KV Cache effect

None. No prompt token changes, so the cached prefix is untouched.

## Known Limitations and Deferred Work

- **No client surface yet.** The projection is readable, but no shipped client renders a bookmark list, a turn-rail mark, or a "jump to bookmark" control; that is the next slice.
- **A label is one string with no length bound.** The bound belongs with the command that writes it, which does not exist yet; a UI that accepts arbitrary text needs it before the first write.
- **Labels are per session.** There is no cross-session index, so "every bookmark in this workspace" is not a query the seam answers.
- **A label survives its target only by `seq`.** If a rewind hides the range a bookmark points at, the row stays and the client must decide how to present a point the transcript no longer shows.
