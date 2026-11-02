---
description: "Account sync: every device signed in to one Aeven account holds the same memory, conversations, and preferences, encrypted on the device and relayed by the Aeven API."
kind: "package-group"
---

# Account sync

English | [中文](README.zh.md)

## Summary

Account sync keeps an account's data the same on every device signed in to it. Each device encrypts every change before it leaves and the Aeven relay stores and forwards the frames; the relay creates and keeps each account's key today, so it can open what it stores, and moving that key onto a passkey in the user's own password manager is in progress. Devices exchange changes within a second while both are online and catch up when one comes back. Local data stays unencrypted on disk. The design and its trade-offs are in the [account sync Agent Note](../../.agents/notes/proposed/architecture/2026-10-27-account-sync-network.md). The [account sync subsystem page](../../docs/subsystems/sync.md) is the reference for the `ctx.sync` vocabulary and the events it emits.

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
| [`@aeven/sync`](sync/README.md) | Service Definition `ctx.sync`: per-account documents, streams, devices, and leases |
| [`@aeven/sync-vault`](sync-vault/README.md) | Library: the account key, opaque document ids, and AES-256-GCM envelopes |
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

The relay creates one 32-byte account key per account on first use, wraps it under a key derived from the API's `encryptionSecret`, and returns it over `key.get` to any device that authenticates for the account; the device stores it in its `sync.db`. Every document key derives from it, and a document's opaque id is an HMAC of its logical name under it, so a party holding the key can open payloads and map an id back to a name.

A relay that answers with a different key starts the account over: the device drops its documents, outbox, counters, and cursor, and publishes its data again under the new key.

Removing a device deletes its entry from the account's `devices` document. It keeps the key it already holds, so it reads whatever it syncs again.

Devices on one local network authenticate each other with an HMAC proof under the same account key; no device holds a key pair of its own.

<a id="relay-protocol"></a>
## Relay protocol

One WebSocket per account and device, authenticated with the account's Aeven access token (`servers/node`, `/sync` on the WebSocket port). JSON requests carry `rid` and receive `ok` or `error`: `key.get`, `publish` (with `covers` for a snapshot that prunes the frames it covers), `sync` (pushes every stored frame after a cursor, then answers), `stream.get` (one stream's frames, a page at a time), `lease.acquire`, and `lease.release`. A frame's header is plaintext so the relay can route it, and its payload is sealed under a key the relay derives from the account key it holds.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **The relay can open what it stores.** It creates each account key and keeps it wrapped under the API's `encryptionSecret`, so synced memory and conversations are private from other accounts and from the network, not from Aeven. Moving the key to a passkey held by the user's own password manager is in progress ([plan](../../.agents/notes/proposed/architecture/2026-10-27-account-sync-network.md)).
- **Removing a device does not revoke it.** The account key does not change, so a removed device reads anything it syncs again.
- **A device syncs only while its account holds a session on that Host.** The access token lives in memory for signed-in clients, so a Host with no client of the account waits and catches up when one connects.
- **Input waits while no device can run the conversation.** A session whose writer is unreachable and whose log this device cannot take over keeps the input in its inbox until a device that holds it appears.
- **A conversation body arrives when it is opened.** Devices exchange session metadata first and download a log on open or in a throttled background pass, so a session older than `backfillDays` that was never opened stays on its writing device.
- **The relay's storage per account is unmeasured.** An account with several gigabytes of sessions keeps all of them on the relay.
