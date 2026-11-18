---
description: "Account sync Consumer for conversation history: every device of an account lists and replays the account's sessions."
kind: "package-reference"
---

# @aeven/session-sync

English | [中文](README.zh.md)

## Summary

Publishes each session from the device that created it as compressed, encrypted stream batches and lists it in the synced `sessions/index` document; other devices import the events through session persistence with their original `seq`, so imported sessions replay exactly and never run a model or a tool. A device that writes a session keeps input and batches flowing to the account's other devices over the relay and, where both are on one local network, directly between them; a device that holds the whole log continues the conversation when its writer is idle and the relay is unreachable, instead of copying it. Configuration: `publishMs`, `scanMs`, `batchBytes`, `backfillDays`, `importConcurrency`, and `runnerLease`. See the [account sync group](../../sync/README.md).

History publication reports every discovered conversation before preparing its events. `publishConcurrency` limits concurrent compression batches (4 by default), while only one conversation log is loaded at a time, and `compressionQuality` sets Brotli quality (4 by default); event order within each conversation and the outbox limit remain enforced. Unchanged revisions produce no new uploads. Initialization-only drafts stay local; execution settings and seed markers wait for conversation activity before publication.

A session this process writes publishes from its commit events: the mirror keeps up to `tailEvents` committed events per session (2,000 by default) until they are published, so publishing a running session does not read its stored log, and a session that commits more than that before a publication is published from the log. An import pass reads only the sessions whose index entries another device changed, so neither publication nor import reads every stored session. A scan of every stored session runs when the mirror starts, when the account reconnects, and every `scanMs` (30 s by default; `0` keeps only the first two) to find logs another process wrote into the shared session root; the mirrors of all accounts on one Host share a scan that is in flight. A publication that failed, or a session moved to another workspace here, publishes again after `publishMs` (3 s by default). Settling also repairs the index: it publishes from its start a stored copy of the account's conversation that the index does not list, publishes the tail of a copy whose stored log runs past its index entry, and raises an index entry left behind the stream; a conversation this device writes that the index does not list publishes again even at a revision recorded as published. An import pass downloads up to `importConcurrency` conversations at once (4 by default), each conversation's batches still applied in order; one whose entry names no workspace downloads at once, since no workspace will hold it. An entry that names no workspace gains the one a device here files the conversation in, and a device that files it in no workspace keeps the workspace another device named.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="model-experience"></a>
## Model Experience

None, as account sync moves stored data between devices and adds nothing to model requests. Imported conversations and memory reach a model only through the packages that already own them.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Shared with the group** — the limits of account sync are listed once in the [group README](../../sync/README.md#known-limitations-and-deferred-work).

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No runtime invariant companion is published because download progress is derived from the session index and locally committed event positions; upload preparation and relay frames report their own pending work. Settings remains syncing until all three finish.
