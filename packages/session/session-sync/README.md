---
description: "Account sync Consumer for conversation history: every device of an account lists and replays the account's sessions."
kind: "package-reference"
---

# @aeven/session-sync

English | [中文](README.zh.md)

## Summary

Publishes each session from the device that created it as compressed, encrypted stream batches and lists it in the synced `sessions/index` document; other devices import the events through session persistence with their original `seq`, so imported sessions replay exactly and never run a model or a tool. Configuration: `publishMs`, `batchBytes`, and `backfillDays`. See the [account sync group](../../sync/README.md).

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
