---
description: "Whole-log turn outline for clients and maintainers composing or debugging the turnOutline projection unit behind full-session turn navigation."
kind: "package-reference"
---

# @aeven/session-turn-outline

English | [中文](README.zh.md)

## Summary

`avn-session-turn-outline` serves the whole-log turn outline — one entry per human message of every started turn, including messages that steer a running turn, each with its jump seq and bounded message and response previews — as the `turnOutline` projection unit. A client that pages history in windows reads the outline to offer every message of the session (loaded or not) and to target its backwards paging at the exact seq that brings that message's events in. Choose it in compositions that already mount the projection registry, such as the web app bundle whose chat turn rail is the reference consumer; assemblies without the registry are unaffected and their consumers fall back to loaded-window navigation. Setup and entry semantics come first; the fold internals live in a collapsible developer section below.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin beside the session store and the projection registry when clients should navigate every turn of a session without holding its complete event log. The unit registers only when the registry is present.

### Composition

```yaml
- name: '@aeven/session'
- name: '@aeven/session-projection'
- name: '@aeven/session-turn-outline'
```

### What an entry means

| Field | Meaning |
|---|---|
| `turn` | Host-assigned number of the turn the message belongs to, from the `turn/start` payload |
| `seq` | Jump anchor: the turn's `turn/start` seq for its opening entry — paging a window back through it loads the whole turn — and the message's own `user/message` seq for a steering entry |
| `prompt` | Preview of the message text (space-joined text blocks, collapsed whitespace, 50-character cap with a trailing ellipsis when clipped — one rail-card line); `''` until the opening prompt lands, and for an images-only message |
| `response` | Preview of the newest text-bearing assistant message after this message and before the next one (same normalization, 120-character cap — up to three rail-card lines); `''` until such text lands |

The wire value is the complete entry array, strictly increasing by `seq` and non-decreasing by `turn` (whole-value rule): consumers replace, never merge. Entries come only from `user/message` events with the human `user` source, so injected context and tool results never leak into navigation; an images-only message keeps `''` and consumers label it by number. The response tracks the newest text-bearing `assistant/message` on the open entry, so an interrupted turn keeps the text it reached. Preview budgets match the chat rail's loaded-turn previews, so a message shows the same words before and after its events load.

### Failures and recovery

The unit is inert without the projection registry: `inject` keeps the fiber pending and nothing registers, so other assemblies lack the `turnOutline` key. Unmounting the plugin removes the key, because registrations are effects on the mounting fiber. Persisted-cache rows are schema-validated on restore — including the strictly-increasing turn order — so a corrupt row is discarded instead of seeding a broken fold.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the fold behind the outline; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design concept

The unit is a pure fold over committed session events. A turn's opening entry is anchored on `turn/start` — not the prompt `user/message` — because its seq is the load-through target for a jump: the agent loop logs `turn/start` before the turn's prompt and steps, so a window paged back through that seq contains the whole turn. The turn's first human `user/message` fills that entry's prompt; every later human message in the same turn (steering) settles the open entry and opens one of its own, anchored on its own seq. The response cannot fill from the message (`turn/end` carries no text), so each text-bearing `assistant/message` overwrites the open entry's response — the newest text wins, which is the loaded rail's `findLast` semantic.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `inject`, unit registration on the mounting fiber |
| [`src/projection.ts`](src/projection.ts) | The fold: entry append, preview fill, wire view |
| [`src/types.ts`](src/types.ts) | One home of the `turnOutline` projection-key declaration and entry types |
| — | No runtime invariant companion is published: the package owns one pure projection fold, `session-projection` schema-validates its served values, and re-folding the same log would duplicate the implementation instead of comparing independently maintained observations; session and agent-loop own turn-boundary ordering. |

### Fold rules

- Uninteresting events return the same state reference, and the wire view is memoized per state, so the registry's two `Object.is` gates suppress republication when nothing the client reads has changed.
- A `turn/start` that does not advance the turn number is skipped, keeping the outline sorted; a retried boundary's previews then land on the standing entry.
- State keeps the open entry apart from the settled ones: previews change several times per entry and rewrite one small object, while the outline array is rebuilt once per entry, when the open entry closes. The wire view concatenates the two and is cached per state.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the unit's contract is not enough. They move from the registry that drives units to adjacent session packages.

- [Session projection subsystem](../../../docs/subsystems/session-projection.md) — the registry that drives units and serves snapshot and change-feed values.
- [Session projection registry package](../session-projection/README.md) — the registry contract units register against.
- [Session package map](../README.md) — adjacent persistence, projection, title, and telemetry packages.

-----

<a id="model-experience"></a>
## Model Experience

None, as the turnOutline unit folds already-logged turn boundaries into a client-facing read model and registers nothing model-facing.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what the outline describes and when the unit is absent. They are current package constraints.

- **The wire value grows with the session** — every push carries the complete outline (whole-value rule), up to ~600 bytes per message at full CJK budgets and typically far less; splitting previews into an on-demand read is deferred until sessions with many thousands of messages need it.
- **An open entry's response preview moves while it streams** — it follows the newest text-bearing assistant message, so the words can change until the next message or `turn/end`.
- **A message without eligible text keeps `''`** — images-only and command-only messages are navigable but labeled by number, and an entry whose steps emit no text gets no response preview.
- **Mounted only where the projection registry is composed** — other assemblies serve no `turnOutline` key, and their consumers fall back to loaded-window navigation.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
