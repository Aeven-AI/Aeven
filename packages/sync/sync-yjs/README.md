---
description: "Yjs Service Provider for account sync: the local store, encrypted frames, local-network links, and the Aeven relay connection."
kind: "package-reference"
---

# @aeven/sync-yjs

English | [中文](README.zh.md)

## Summary

The `ctx.sync` provider. Each account keeps `accounts/<hash>/sync/sync.db` with its device id, the account key and who holds it, document updates, outbox, and replay counters, and holds one relay connection while a client of the account has a session on the Host. Frames are applied in relay order; documents are compacted locally and snapshotted so the relay can prune covered updates; unacknowledged frames remain in the outbox. A transient relay refusal closes the connection so publication resumes through the configured reconnect loop; other refusals remain visible as upload failures. Two devices linked on a local network exchange document updates and stream batches directly, so a conversation that streams keeps reaching the other device while the relay is unreachable. Configuration: `relayUrl`, `credentialRef`, `deviceName`, `reconnectMs`, `connectTimeoutMs`, `compactAfter`, and `snapshotAfter`. See the [account sync group](../README.md).

A device without its account key, including one locked until a passkey unlocks it and one waiting for the user to accept a key the relay took back, stays in `starting`; `connecting`, `online`, and `offline` allow local documents to open.

Status distinguishes a connected relay from completed download catch-up. A failed catch-up reconnects from the durable cursor. Upload queue operations reuse prepared SQLite statements, and received batches group updates without copying each document's accumulated updates for every frame.

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

**Runtime invariant:** No runtime invariant companion is published because the store rows and the relay frames are the only copies, compared by package tests over the database itself.
