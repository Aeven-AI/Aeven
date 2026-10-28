---
description: "Account sync Consumer for conversation history: every device of an account lists and replays the account's sessions."
kind: "package-reference"
---

# @aeven/session-sync

English | [中文](README.zh.md)

## Summary

Publishes each session from the device that created it as compressed, encrypted stream batches and lists it in the synced `sessions/index` document; other devices import the events through session persistence with their original `seq`, so imported sessions replay exactly and never run a model or a tool. A device that writes a session keeps input and batches flowing to the account's other devices over the relay and, where both are on one local network, directly between them; a device that holds the whole log continues the conversation when its writer is idle and the relay is unreachable, instead of copying it. Configuration: `publishMs`, `batchBytes`, `backfillDays`, and `runnerLease`. See the [account sync group](../../sync/README.md).

History publication reports every discovered conversation before preparing its events. `publishConcurrency` limits concurrent compression batches (4 by default), while only one conversation log is loaded at a time, and `compressionQuality` sets Brotli quality (4 by default); event order within each conversation and the outbox limit remain enforced. Unchanged revisions produce no new uploads. Initialization-only drafts stay local; execution settings and seed markers wait for conversation activity before publication.

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
