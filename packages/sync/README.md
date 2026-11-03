---
description: "Account sync: every device signed in to one Aeven account holds the same memory, conversations, and preferences, encrypted on the device and relayed by the Aeven API."
kind: "package-group"
---

# Account sync

English | [中文](README.zh.md)

## Summary

Account sync keeps an account's data the same on every device signed in to it. Each device encrypts every change before it leaves and the Aeven relay stores and forwards the frames. By default the relay creates and keeps each account's key, so it can open what it stores; once the user protects the account with a passkey, a device creates a new key and the relay keeps it only wrapped under that passkey, so only the account's devices can open what it stores and a new device restores everything by unlocking with the same passkey. Devices exchange changes within a second while both are online and catch up when one comes back. Local data stays unencrypted on disk. The design and its trade-offs are in the [account sync Agent Note](../../.agents/notes/proposed/architecture/2026-10-27-account-sync-network.md). The [account sync subsystem page](../../docs/subsystems/sync.md) is the reference for the `ctx.sync` vocabulary and the events it emits.

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
| [`@aeven/file-sync`](file-sync/README.md) | Service Definition `ctx.fileSync`: folders kept the same on the account's devices, peer to peer |
| [`@aeven/file-sync-syncthing`](file-sync-syncthing/README.md) | Service Provider: one supervised Syncthing process |
| [`@aeven/workspace-file-sync`](../workspace/workspace-file-sync/README.md) | Consumer: folder workspaces and where they land on another device |

`@aeven/memory-memos` and `@aeven/personalization` consume `ctx.sync` directly when it is mounted; without it they behave as before.

<a id="what-synchronizes"></a>
## What synchronizes

| Data | Mechanism |
|---|---|
| Memory | SQLite triggers record every write to the replicated MemOS tables; rows travel in shard documents (`memory/<table>/<id prefix>`), are upserted on the other devices, and a delete wins over a concurrent edit. Vectors travel tagged with their embedding model and are applied only on a device that runs the same model. |
| Conversations | The device writing a session publishes its events as compressed stream batches and lists it in the `sessions/index` document; other devices import them through session persistence with their original `seq`. That device holds the session's runner lease, and a device without it forwards prompts, approvals, and cancels to the holder, which applies them as input of its own; on one local network the batches travel between the two directly as well. Sessions created within the backfill window before a device first publishes are included. |
| Preferences | Each account's personalization lives in the `personalization` document, merged per field. |
| Device names | The `devices` document maps each device id to the name it gave itself. |
| Workspace files | A folder workspace's files travel peer to peer through Syncthing on the desktop app, outside the relay; the `file-sync/peers` and `file-sync/folders` documents carry each device's transport id and each workspace's folder id, size, and location hint. |

Credentials, provider keys, connector tokens, device settings, caches, indexes, and logs stay on the device.

<a id="devices-and-keys"></a>
## Devices and keys

Every document key derives from one 32-byte account key, and a document's opaque id is an HMAC of its logical name under it, so a party holding the key can open payloads and map an id back to a name. The relay and the devices name the current key by its key id, the first 16 bytes of an HMAC under the key. The key is held in one of two modes:

| Mode | Who holds the key | How a device gets it |
|---|---|---|
| `server` (default) | The relay creates it on first use and keeps it wrapped under a key derived from the API's `encryptionSecret` | `key.get` returns it to any device that authenticates for the account |
| `passkey` | A device created it; the relay keeps only copies wrapped under each passkey's WebAuthn PRF output | `key.get` returns the wrapped copies; the device unwraps one with the passkey's PRF output and checks it against the key id |

Protecting the account runs the passkey step: the Host opens `/passkey/vault` on the Aeven site in the system browser, the page creates or asks for a passkey, evaluates its PRF with a fixed salt, and seals the output and the credential id to a one-use X25519 key of the Host; the Host collects the sealed result with a verifier. The site and the relay see only ciphertext. A browser or passkey provider without PRF reports that, and the account stays in `server` mode. Settings → Sync offers protecting, adding a passkey, unlocking, and turning protection off, and a popup offers protection after a sign-in on the page and asks for the passkey while a device is locked.

Every change of key starts the account over: the relay purges the frames and leases of the earlier key and closes the account's other connections, and each device drops its documents, outbox, counters, cursor, and Consumers' local values, emits `sync/reset`, and publishes its data again under the new key. A device that holds no copy of a passkey-held key stays in `starting` and reports itself locked until it is unlocked. A device that last saw a passkey hold the key and now gets a relay-held key waits until the user confirms it, so a relay cannot switch an account back to a key it can read without the user noticing.

Removing a device deletes its entry from the account's `devices` document. It keeps the key it already holds, so it reads whatever it syncs again.

Devices on one local network authenticate each other with an HMAC proof under the same account key; no device holds a key pair of its own.

<a id="relay-protocol"></a>
## Relay protocol

One WebSocket per account and device, authenticated with the account's Aeven access token (`servers/node`, `/sync` on the WebSocket port). JSON requests carry `rid` and receive `ok` or `error`: `key.get`, `key.protect` and `key.unprotect` (change the key's mode), `passkey.add` and `passkey.remove`, `publish` (refused under a key id other than the account's current one) (with `covers` for a snapshot that prunes the frames it covers), `sync` (pushes every stored frame after a cursor, then answers), `stream.get` (one stream's frames, a page at a time), `lease.acquire`, and `lease.release`. A frame's header is plaintext so the relay can route it, and its payload is sealed under a key derived from the account key.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **The relay can open what it stores until the user protects the account.** In `server` mode synced memory and conversations are private from other accounts and from the network, not from Aeven. Protection is optional, and a passkey provider without PRF leaves the account in `server` mode.
- **Losing every device and every passkey loses the protected data.** No copy of a passkey-held key exists outside the user's devices and passkeys, and the passkey step says so before it creates the passkey.
- **The passkey page is served code.** While the ceremony runs in the system browser, the user trusts the page `aeven.io` serves; a native ceremony replaces it once Electron exposes platform passkeys with PRF.
- **Starting over loses what only the relay held.** A change of key purges the relay's frames; data that no device holds any more, such as a conversation body whose writing device is gone and that no other device downloaded, does not come back, and tombstones of deletions made while a device was offline are lost with the earlier documents.
- **Message feedback is not published again after a change of key.** Its rows do not record their account, so ratings reach the new documents only when they change.
- **Removing a device does not revoke it.** The account key does not change, so a removed device reads anything it syncs again; revoking it needs a new key, which a passkey-held account can only wrap with a passkey step.
- **Deleting the Aeven account does not purge synced frames.** The relay's vault, frames, and leases of the account stay until they are removed by hand.
- **A device syncs only while its account holds a session on that Host.** The access token lives in memory for signed-in clients, so a Host with no client of the account waits and catches up when one connects.
- **Input waits while no device can run the conversation.** A session whose writer is unreachable and whose log this device cannot take over keeps the input in its inbox until a device that holds it appears.
- **A conversation body arrives when it is opened.** Devices exchange session metadata first and download a log on open or in a throttled background pass, so a session older than `backfillDays` that was never opened stays on its writing device.
- **The relay's storage per account is unmeasured.** An account with several gigabytes of sessions keeps all of them on the relay.
- **Workspace files move only between online devices.** Without the cloud copy the workspace file sync note plans, a device receives a folder only while another device that holds it is online, and a repository workspace syncs no files until its Git mode exists. Discovery and relaying use the public Syncthing servers until Aeven runs its own.
