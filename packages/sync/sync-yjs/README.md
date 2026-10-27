---
description: "Yjs Service Provider for account sync: local store, encrypted frames, device approval, and the Aeven relay connection."
kind: "package-reference"
---

# @aeven/sync-yjs

English | [中文](README.zh.md)

## Summary

The `ctx.sync` provider. Each enrolled account keeps `accounts/<hash>/sync/sync.db` with its device keys, keyring, device chain, document updates, outbox, and replay counters, and holds one relay connection while a client of the account has a session on the Host. Frames are applied in relay order; documents are compacted locally and snapshotted so the relay can prune covered updates; a frame the relay refuses outright is dropped rather than blocking the outbox. Configuration: `relayUrl`, `credentialRef`, `deviceName`, `reconnectMs`, `connectTimeoutMs`, `compactAfter`, and `snapshotAfter`. See the [account sync group](../README.md).

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

- **Shared with the group** — the limits of account sync are listed once in the [group README](../README.md#known-limitations-and-deferred-work).

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
