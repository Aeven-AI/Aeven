---
description: "Account sync: every device signed in to one Aeven account holds the same memory, conversations, and preferences, encrypted end to end."
kind: "package-group"
---

# Account sync

English | [中文](README.zh.md)

## Summary

Account sync keeps an account's data the same on every device signed in to it. Each device encrypts every change before it leaves, the Aeven relay stores and forwards ciphertext it cannot open, and devices exchange changes within a second while both are online and catch up when one comes back. Local data stays unencrypted on disk. The design and its trade-offs are in the [account sync Agent Note](../../.agents/notes/proposed/architecture/2026-10-27-account-sync-network.md). The [account sync subsystem page](../../docs/subsystems/sync.md) is the reference for the `ctx.sync` vocabulary and the events it emits.

## Table of Contents

- [Packages](#packages)
- [What synchronizes](#what-synchronizes)
- [Devices and keys](#devices-and-keys)
- [Relay protocol](#relay-protocol)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="packages"></a>
## Packages

| Package | Role |
|---|---|
| [`@aeven/sync`](sync/README.md) | Service Definition `ctx.sync`: per-account documents, streams, devices, and joining |
| [`@aeven/sync-vault`](sync-vault/README.md) | Library: device keys, key epochs, encrypted and signed envelopes, the device chain, the approval code |
| [`@aeven/sync-yjs`](sync-yjs/README.md) | Service Provider: Yjs documents, the local store, and the relay connection |
| [`@aeven/api-sync-controller`](../api/sync-controller/README.md) | The `sync` Remote for Settings |
| [`@aeven/client-ui-settings-sync`](../client/ui-settings-sync/README.md) | Settings → Sync |
| [`@aeven/session-sync`](../session/session-sync/README.md) | Consumer: conversation history |
| [`@aeven/session-handoff`](../session/session-handoff/README.md) | Service Definition `ctx.sessionHandoff`: typing into and answering a conversation another device writes |

`@aeven/memory-memos` and `@aeven/personalization` consume `ctx.sync` directly when it is mounted; without it they behave as before.

<a id="what-synchronizes"></a>
## What synchronizes

| Data | Mechanism |
|---|---|
| Memory | SQLite triggers record every write to the replicated MemOS tables; rows travel in shard documents (`memory/<table>/<id prefix>`), are upserted on the other devices, and a delete wins over a concurrent edit. Vectors travel tagged with their embedding model and are applied only on a device that runs the same model. |
| Conversations | The device writing a session publishes its events as compressed stream batches and lists it in the `sessions/index` document; other devices import them through session persistence with their original `seq`. That device holds the session's runner lease, and a device without it forwards prompts, approvals, and cancels to the holder, which applies them as input of its own; on one local network the batches travel between the two directly as well. Sessions created within the backfill window before a device first publishes are included. |
| Preferences | Each account's personalization lives in the `personalization` document, merged per field. |
| Device names | The `devices` document maps each device id to the name it gave itself. |

Credentials, provider keys, connector tokens, device settings, caches, indexes, and logs stay on the device.

<a id="devices-and-keys"></a>
## Devices and keys

The first device creates the vault: a device key pair and the epoch-0 vault key, recorded in a signed, hash-linked device chain. A new device joins only through a device whose Settings → Sync add-device screen is open: the joining device commits to its keys, the open device answers with a challenge, and both show the same six-digit code that the user compares before approving. The approving device wraps the keyring for the new device and appends it to the chain. Removing a device rotates the vault key, wraps the new keyring for the remaining devices, and records the removal; the removed device keeps what it already has but cannot read anything synced afterwards, and it joins again with new keys.

<a id="relay-protocol"></a>
## Relay protocol

One WebSocket per account and device, authenticated with the account's Aeven access token (`servers/node`, `/sync` on the WebSocket port). JSON requests carry `rid` and receive `ok` or `error`: `chain.get`, `chain.append`, `keys.put`, `keys.get`, `publish` (with `covers` for a snapshot that prunes the frames it covers), `sync` (pushes every document frame after a cursor, then answers), `stream.get` (one stream's frames, a page at a time), and `signal` (device-to-device messages for joining). The relay reads only frame routing headers.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **A device syncs only while its account holds a session on that Host.** The access token lives in memory for signed-in clients, so a Host with no client of the account waits and catches up when one connects.
- **Input waits while no device can run the conversation.** A session whose writer is unreachable and whose log this device cannot take over keeps the input in its inbox until a device that holds it appears.
- **A conversation body arrives when it is opened.** Devices exchange session metadata first and download a log on open or in a throttled background pass, so a session older than `backfillDays` that was never opened stays on its writing device.
- **The relay's storage per account is unmeasured.** An account with several gigabytes of sessions keeps all of them on the relay.
