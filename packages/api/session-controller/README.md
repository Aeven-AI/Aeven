---
description: "Host and Client session control: create, resume, prompt, follow history, and project live session state."
kind: "package-reference"
---
# Session Controller

English | [中文](README.zh.md)

## Summary

`@aeven/api-session-controller` owns the Host `ctx.sessionController` service and the generated Client `session`, `skills`, and `fileReferences` Remote namespaces. It serves Session lifecycle and history, the Host-generation model catalog, workspace-path opening, user-invocable skill discovery, and the adapter for Agent-scoped file references. Use it through API Gateway when a Client needs operations addressed by a Session.

## Table of Contents

- [Use this package](#use-this-package)
- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

History pages and follow opening snapshots carry a discriminated `SessionHistoryRecord`. Both variants use `{ type, event }`: `type: 'event'` carries one raw `SessionWireEvent`, while `type: 'chunks'` carries one lossless `ChunkRowEvent` for consecutive same-block `assistant/chunk` deltas. Both inner values expose `type`, `seq`, `time`, and `data`, so the Client retains each accepted record as one `SessionEventLikeEntry` without record-by-record conversion. A packed event's `seq` and `time` identify its first member, and `data` retains the fragment and timestamp-gap arrays. Live follow frames remain individual `event` records. Tool arguments, result content, failures, and `tool/result.data.meta` pass through unchanged; the controller does not resolve a Tool definition, run a presenter, or attach UI data.

Each endpoint states its activation policy. List, search, attachment, history pages, log following, skill discovery, and workspace-path opening can inspect persistence without activating an Agent; `canOpenWorkspacePath()` reports native-opening availability without addressing a Session. Queue mutation and cancellation require live state; model, rename, prompt, and file-reference operations may resolve or resume an ordinary Session. Create and fork are the only operations that create a new Agent directly. The skill catalog instead uses a live Agent when present or the recorded preset's standing scope when cold, so listing never starts an Agent.

The Client adapter exposes `SessionEventStream`, a Gateway `RemoteJournalStream` bound to one ordinary or direct-subagent address. It opens follow before the initial page, publishes only contiguous `replace`, `prepend`, and `append` changes, and repairs reconnect or sequence gaps through a tail page. Backwards paging has two verbs: `loadOlder()` pulls one 50-message page, and `loadThrough(seq)` — the turn-jump loader — installs one 200-message window anchored on the target seq in a single round trip however far back that is, lowering a shared target when a repeated call joins the pass in flight, stopping once the installed window already covers that target, and reporting busy through the same `loadingOlder` snapshot bit. Ordinary records cover `[event.seq, event.seq]`; packed rows cover `[event.seq, event.seq + memberCount - 1]`. A business, persistence, or unresolved continuity failure terminates the stream, while only physical carrier loss selects automatic resumption. `SessionControlStream` is a Gateway `RemoteSnapshotStream`; every generation opens with a complete process-local baseline, so reconnect replaces queue, jobs, and projection state instead of treating transient values as durable events.

The Session object also carries local submission echoes: `session.beginSubmission` inserts one into `SessionSnapshot.pendingSubmissions` synchronously, before the caller serializes and prompts, so a conversation UI can show the message on the submit click's own frame. Session derives each echo's `transcript`, `queued`, or `steering` placement from its current running state and the requested delivery mode, then retains that placement while serialization is in flight. The prompt's `requestId` is the correlation identity: the Host echoes it as the durable user source's `rpcId`, and queue occurrences project it as `SessionQueuedItem.rpcId`. An echo retires one animation frame after its durable event or queue occurrence is observed (the delay keeps it renderable until the replacement is ready), immediately when its identified prompt fails or is abandoned, and as failed on disposal; each retirement fires the registered `onRetire` callback exactly once. Echoes are Client memory only; reload and reconnect rebuild the conversation from durable events alone.

-----

<a id="configuration"></a>
## Configuration

| Field | Default | Meaning |
|---|---:|---|
| `coldBlankProbeMaxBytes` | `1,024` | Maximum physical size of a cold Session artifact eligible for blankness verification; `0` disables probes |
| `nativeOpen` | platform-detected | Whether Session workspace paths can be handed to a native desktop opener |

`modelCatalog()` builds from the live LLM registry on every call, so a route whose model list grew since startup — a `catalogRefresh` that landed after mount, for instance — is reflected without a restart. Providers, and the models inside each provider, are ordered by the label the browser shows, with the model id as a tie-break so entries sharing a name keep a stable order between calls. Comparison is numeric-aware, so `GLM 5.2` precedes `GLM 5.3` precedes `GLM 5.10`. Provider failures keep registry order: that list is the diagnostic channel, not the list a person scans. Ordering lives here rather than in the route's own catalog, which stays in configuration order for everything that dispatches.

The generated [configuration catalog](../../../docs/config-catalog.md#aevenapi-session-controller) is the exhaustive source for accepted fields and their JSDoc.

-----

<a id="model-experience"></a>
## Model Experience

None, as invoked Agent commands own any model-visible effect.

#### KV Cache effect

No direct effect; model requests remain owned by the Agent and LLM packages.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- `list()` serves cold rows from the durable projection cache, and refolds at most 20 title-less rows per call from their logs. A home whose cache is wholly unreadable — an older build facing records a newer one wrote — therefore recovers a slice of its titles per listing rather than all at once, though each refold writes its row back, so repeated listings converge.
- Control baselines represent process-local state and therefore cannot reconstruct jobs after a Host restart.
- A failed follow resumption remains visible to the caller instead of retrying indefinitely.
- File-reference completion uses the shared Agent lookup and can resume a cold Session; the `skills/list` catalog is the non-activating alternative for skill metadata.


<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. Every page and frame is checked against the addressed durable Session.
