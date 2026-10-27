# Agent Note: One account, one synchronized data network

Status: proposed

English | [中文](2026-10-27-account-sync-network.zh.md)

## Problem

An Aeven account is bound to one machine. Signing in on a second computer gives the same identity, connectors, and credit, but an empty memory, no conversation history, no learned procedures, and no personalization. Long-term memory is the product's differentiator, and today it stops at the edge of one `$AVN_HOME`.

The goal is that an account is one network: every device signed in to it holds the same data, edits on one device appear on the others within a second or two, and a device that was offline catches up when it reconnects. Devices exchange data directly where they can, and the Aeven server relays and stores data for devices that cannot reach each other. The server never learns what the data says: every byte it relays or stores is encrypted end to end, and the account's recovery path is the only way back to the data. Local data stays unencrypted on disk.

The state that has to move is large, mixed in kind, and stored by different owners:

| State | Owner and location | Size on the developer's own home |
|---|---|---|
| Session logs | `@aeven/session-persistence-jsonl`, `sessions/<projectKey(cwd)>/<session id>/session.jsonl.zstd` ([`format.ts`](../../../../packages/session/session-persistence-jsonl/src/format.ts)) | 686 MB compressed |
| Memory | `@aeven/memory-memos`, one MemOS database per account at `accounts/<sha256(account)>/memory/data/memos.db` ([per-account memory databases](../../implemented/architecture/2026-10-07-per-account-memory-databases.md)) | 576 MB: 21,887 traces (58 MB text, 67 MB vectors), 888 policies, 328 skills, 24 world-model rows, 80,165 `api_logs` rows |
| Workspace registry | `@aeven/storage-domain` unit `workspace`: `storages/workspace/global.json` plus one record per workspace with a UUID, absolute `path`, `title`, and `sessionIds` | small |
| Personalization | `personalization/<userId>.json` | small |
| Settings | `settings.yaml`, mixing device facts (ports, paths, runtimes) with account preferences | small |
| Automations, message feedback | `storages/automations.json`, `storages/message_feedback/sessions/` | small |
| Learned capabilities | `capabilities/<owner>/` and memory procedures | small |
| Attachments | content-addressed attachment store | varies |

Four properties of this state shape the design:

- **Session logs already have the replication properties sync needs.** The persistence seam pins four invariants: append-only, contiguous `seq`, lossless JSON, and `append` resolving only after durability ([README](../../../../packages/session/session-persistence/README.md)). Rewind and compaction are appended events (`session/rewind`, `compaction/*` in [the session subsystem](../../../../docs/subsystems/session.md)), not rewrites, so copying a log means copying events in `seq` order.
- **One writer per session is enforced only within one home.** `acquireWriter` holds a kernel file lock per session under the storage root ([`writer-lock.ts`](../../../../packages/session/session-persistence-jsonl/src/writer-lock.ts)), so two Host processes on one home cannot both write a session, but nothing coordinates two devices. Two devices appending to one session would interleave.
- **Sessions are filed under machine paths.** `projectKey(cwd)` encodes the absolute working directory into the folder name, and the workspace record stores the absolute `path`. A second machine, especially Windows, has neither path.
- **MemOS writes from many places.** Turn capture, the revision loop, background L2 policy and L3 world-model induction, skill crystallization, consolidation, and the Aeven learner all write `memos.db`. A sync bridge that hooks individual write paths misses the next one added.

The server side constrains the key design. Sign-in is Apple, Google, or X OAuth, or email and password verified with bcrypt on the server (`servers/node/services/AuthService.js`). In every one of those flows the server can authenticate as the user, so any key the account sign-in alone can recover is a key the server can recover.

## Proposal

### Terms

- **Vault**: the synchronized data of one account. One vault per account.
- **Device**: one Aeven Host home signed in to the account and enrolled in the vault. A desktop install, a CLI home, and a headless home are each a device.
- **Document**: a CRDT-replicated unit of state (Yjs `Y.Doc`).
- **Stream**: an ordered, single-writer, append-only replicated sequence (one per session).
- **Envelope**: the encrypted, signed frame that carries one document update, document snapshot, or stream batch between devices and the server.
- **Lease**: a time-bounded, single-holder right to perform one kind of work (append to one session, run memory maintenance, run one automation).

### What synchronizes

| Data | Primitive | Conflict rule |
|---|---|---|
| Session events | Stream per session | One writer at a time through the session lease; contiguous `seq`; receivers request gaps |
| Session metadata (title, pin, archive, fork parent) | Document | Field-level merge |
| Workspace registry | Document; `path` becomes a per-device binding kept local | Field-level merge; membership by set |
| Memory rows (traces, episodes, MemOS sessions, policies, trace-policy links, world model, skills, skill trials, feedback, decision repairs, L2 candidate pool) | Documents sharded by table and by the leading characters of the row id | Field-level merge; a forget tombstone wins over a concurrent edit |
| Learned capabilities | Document (file contents keyed by path) | Field-level merge |
| Personalization, account-scoped settings | Document | Field-level merge |
| Automation definitions | Document; runs execute under a per-automation lease | Field-level merge |
| Message feedback | Document per session | Field-level merge |
| Attachments | Encrypted content-addressed blobs, fetched on demand | Content address; no conflict |
| Embeddings, FTS indexes, projection caches, MemOS `api_logs`, `audit_events`, `kv`, `embedding_retry_queue`, and hub tables | Not synchronized; rebuilt or kept local | — |
| Credentials, provider keys, connector tokens | Not synchronized; connectors already live on the server per account | — |
| Device-specific settings (ports, paths, runtimes, Chrome profile, speech models) | Not synchronized | — |

This replicates raw memory traces, which the [long-term memory roadmap](../feature/2026-09-28-long-term-memory-roadmap.md) row 10 proposed to keep local by default. Recall reads traces, so a device without them recalls less, and an account that is one network cannot have per-device memory.

### Two replication primitives

**Documents** use [Yjs](https://github.com/yjs/yjs). A Yjs update is an opaque binary value; updates merge in any order, and applying one twice has no effect. That lets each update be encrypted on its own and lets the server store and forward ciphertext it cannot read or merge. Concurrent writes to one map key resolve deterministically by client id, not by wall clock, so no device clock affects the outcome. Each device keeps document state locally and loads a document only while a consumer has it open; sharding memory tables by row-id prefix keeps a loaded document under one megabyte ([phase 0 findings](#phase-0-findings)). The server keeps, per document, the latest encrypted snapshot plus the encrypted updates after it. Any device holding a document periodically uploads a new snapshot, after which the server drops the updates it covers. The [secsync](https://github.com/serenity-kit/secsync) design for encrypted Yjs is the reference for the snapshot and update chain.

**Streams** carry session events. A session has one writer at a time, so the events need ordering, not merging. The writer sends batches of consecutive events (closed after 100 ms or a size limit) as stream envelopes tagged with their first and last `seq`. A receiver appends a batch only when it continues its local log contiguously, and requests the missing range otherwise. Streaming `assistant/chunk` events this way lets a second device watch a reply as it is generated.

Both primitives use the same envelope, keys, transports, and server store.

### Topology and transports

Each online device holds one authenticated WebSocket to the server's sync relay for its account, and one WebSocket to each vault peer it finds on the local network. Every envelope goes to the server, because the server is the backup and the catch-up source for offline and new devices. Live delivery takes whichever path arrives first; receivers deduplicate by envelope id. The server is therefore the delivery path of last resort and the storage path of every change.

Local-network peers find each other with mDNS (`_aeven-sync._tcp`). The announcement carries a token derived from the current vault key epoch, so only devices of the same vault recognize it and the announcement does not name the account. Peers authenticate each other with their device signing keys against the device chain before exchanging envelopes. The listener is a separate port that speaks only the sync protocol; the Host API stays on loopback.

Direct connections across the internet (WebRTC or QUIC hole punching) are deferred. Each requires a native module in the Node Host on three platforms, and relay latency through the server is measured first.

### Encryption and keys

All cryptography uses `node:crypto` built-ins: X25519, Ed25519, HKDF-SHA-256, and AES-256-GCM. No native or WASM cryptography dependency is added.

- **Vault key epoch**: a random 256-bit key generated by the first device. A new epoch replaces it when a device is removed. Older epochs remain available to current devices for reading old ciphertext.
- **Per-document keys**: `HKDF(vault key epoch, document or stream id)`, which bounds the number of AES-GCM nonces drawn under one key.
- **Opaque ids**: document and stream ids sent to the server are `HMAC(vault key, logical name)`, so the server sees neither "memory/traces/2026-10" nor a session id.
- **Device keys**: each device holds an Ed25519 signing key and an X25519 key-agreement key in a mode-0600 file under `accounts/<hash>/sync/`. Local data is unencrypted by requirement, so an OS keychain would protect the key but not the data it unlocks; the desktop app may store them through Electron `safeStorage` instead.
- **Envelope**: protocol version, opaque id, kind (update, snapshot, stream batch), key epoch, sender device id, per-device counter, 96-bit random nonce, AES-256-GCM ciphertext with every preceding field as associated data, and an Ed25519 signature by the sender over the whole frame. Receivers reject a frame whose sender is not an active device in the chain, whose counter does not advance, or whose signature fails.
- **Device chain**: an append-only list of signed entries (genesis, add device, remove device, set recovery key). The first device signs the genesis. Each later entry is signed by an active device or by the recovery signing key. The server stores the chain and cannot add an entry, so it cannot introduce a device that receives keys or joins peer connections.

### Recovery and device enrollment

The account cannot be the recovery key by itself, because the server can authenticate as the user. The closest form that keeps the server blind is a **passkey on the Aeven account with the WebAuthn PRF extension**:

1. During enrollment, a device holding the vault key registers a passkey for `aeven.io` and evaluates its PRF with a fixed salt. HKDF over the PRF output yields a wrapping key and a recovery signing key pair. The device stores on the server the vault key wrapped under the wrapping key and appends the recovery public key to the device chain.
2. On a new device, signing in with that passkey both authenticates and produces the same PRF output. The device unwraps the vault key locally, signs its own add-device entry with the recovery signing key, and starts syncing. No other device needs to be online.
3. Apple, Google, and password-manager passkey stores sync the passkey across the user's devices, so the passkey follows the account the way the user expects.

The second enrollment path is **approval from an existing device**. The new device shows its public keys as a short code; the user confirms the same code on a device that is already enrolled; that device appends the add-device entry and wraps the vault key for the new device's X25519 key. The code comparison prevents the server from substituting its own key.

Losing the passkey and every enrolled device loses the vault. The product states this when the passkey is created. Account deletion purges every envelope, snapshot, wrapped key, and chain entry on the server.

Removing a device appends a remove-device entry, generates a new vault key epoch, and wraps it for the remaining devices and the passkey. The removed device keeps whatever it already decrypted; it cannot read changes made after its removal, and peers refuse its connections.

### What the server stores and sees

The server stores the device chain, wrapped vault keys, passkey credentials, encrypted snapshots, encrypted updates, encrypted stream batches, encrypted attachment blobs, and lease records. It sees the account id, device ids, opaque document and stream ids, sizes, timing, IP addresses, and which device holds which lease. It does not see memory text, session content, file names, titles, settings, or which opaque id is which logical document.

Two paths outside sync still carry plaintext through Aeven infrastructure and need their own commitments:

- **Inference.** Model requests from a local Host go through the Aeven gateway, so each turn's prompt, including recalled memory, passes through it in plaintext, as does the background memory work that calls a model. The gateway must not store request or response bodies, and that is stated publicly beside the sync promise.
- **An Aeven-hosted Host.** A hosted Web surface ([hosted Web surface note](2026-09-30-hosted-web-surface-and-sync.md)) run by Aeven would need the vault key, which breaks the promise. Browser access to a vault goes through one of the user's own devices.

### Sessions: replication, writer lease, and paths

- **Writer lease.** A device appends to a session only while it holds that session's lease. The server grants leases; when the server is unreachable, the device currently holding a lease can hand it over directly to a LAN peer. A device that cannot reach either continues the conversation as a fork (a new session with a parent reference) rather than appending. Within one home, the existing per-session file lock keeps two Host processes from appending to one session; the lease extends that rule across devices.
- **Import.** A received batch is written through the persistence provider with its original `seq`, envelope fields, and event ids; projections and caches rebuild from the log as they do on resume. Imported events never enter a live agent loop, and no tool runs because an event arrived. The log is the model-visible record, so reconstructability is unchanged.
- **Live view.** A device that does not hold the lease renders the session as its events arrive and shows which device is running it. "Continue here" asks for the lease; the holder releases it when its turn is idle, and otherwise the requester forks.
- **Workspaces and paths.** The synchronized workspace record keeps its UUID, title, and session ids; `path` becomes a per-device binding stored locally. On a device without a binding, the workspace and its sessions are readable and the user binds a folder, or Aeven proposes the folder whose git remote matches. Imported logs are filed under the local binding's `projectKey`, or under a per-workspace remote folder before binding. Continuing a session whose recorded working directory belongs to another machine forks it with the local directory, because its tool history refers to the other machine's paths.
- **Lazy bodies.** A new device downloads session metadata first and session bodies when opened or in a throttled background pass, so the session list is available long before 686 MB has arrived.

### Memory: capture, materialization, and maintenance

- **Change capture.** On core open, `@aeven/memory-memos` installs `AFTER INSERT/UPDATE/DELETE` SQLite triggers on each replicated table. Each trigger writes `(table, primary key, operation)` into a `sync_changes` table in the same database. Every write path, current or future, is captured without modifying vendored MemOS code. Triggers are checked and reinstalled after MemOS migrations.
- **Publishing.** The memory sync consumer drains `sync_changes`, reads the current row (without vector columns), writes it into its shard document, and deletes the processed changes in one transaction.
- **Materialization.** Remote rows are written inside a transaction that sets a marker row the triggers check, so applied rows are not echoed back. Applied traces enter MemOS's `embedding_retry_queue` so vectors are computed locally; FTS tables update through their own triggers.
- **Forget.** Forgetting writes a tombstone that wins over concurrent edits and is never resurrected. It also requests a fresh snapshot of the shard so the server drops the updates that held the forgotten content.
- **Maintenance lease.** Background work that derives new memory from existing memory runs only on the holder of the account's maintenance lease: MemOS policy, world-model, and skill induction, Aeven learner merges and consolidation, and the memory profile build. Two devices otherwise derive duplicate policies from the same traces and pay the model cost twice. If the holder is offline past the lease expiry, another device takes over. Capture for a turn runs on the device that ran the turn.

### Package layout

| Package | Role |
|---|---|
| `packages/sync/sync` (`@aeven/sync`) | Service Definition `ctx.sync`: open documents by logical name, append and subscribe to streams, acquire and observe leases, list devices, report status |
| `packages/sync/sync-vault` | Library: vault key epochs, device keys, envelope seal and open, device chain verification, PRF unwrap |
| `packages/sync/sync-yjs` | Service Provider: Yjs document manager, local `sync.db` (`better-sqlite3`, already a dependency) for document state, outbox, and cursors |
| `packages/sync/sync-transport-aeven` | Server relay transport and lease client |
| `packages/sync/sync-transport-lan` | mDNS discovery and peer WebSocket transport |
| `packages/memory/memory-sync` | Consumer: triggers, shard publishing, materialization, maintenance lease |
| `packages/session/session-sync` | Consumer: streams, import, session lease, workspace bindings |
| `packages/sync/sync-account-documents` | Consumer: personalization, account settings, workspace registry, automations, feedback, capabilities |
| `packages/attachment/attachment-sync` | Consumer: encrypted blob upload and on-demand fetch |
| `packages/api/sync-controller` | Remote for the client UI |
| `packages/client/ui-settings-sync` | Settings → Sync, device approval, passkey setup, status |

The base bundle mounts the sync rows disabled; the desktop profile patch enables them. New dependencies are `yjs` (with `lib0`), `multicast-dns`, and `@simplewebauthn/browser` on the client; none is native.

### Prerequisites in existing packages

- Workspace records already carry `owner` ([per-account isolation](../../implemented/architecture/2026-09-30-per-account-isolation-on-a-shared-host.md)), and the JSONL provider already locks each session writer per home.
- The settings capability declares each namespace as account-scoped or device-scoped, and only account-scoped namespaces synchronize. Account-scoped namespaces include `ui-theme`, `locale`, `ui-chat`, `ui-conversation`, `agent-default-model`, `media`, and `media-video`; `device`, `ui-developer`, and provider-key namespaces stay on the device. The declaration lands in phase 3 together with the consumer that reads it.

### Server changes (`servers/node`)

- Device chain and wrapped-key storage per account (MongoDB).
- Passkey registration and assertion with the PRF extension (`@simplewebauthn/server`).
- A sync WebSocket endpoint beside the existing socket service: one room per account, authenticated with the Aeven access token, relaying envelopes between the account's devices.
- Encrypted envelope storage: metadata in MongoDB, ciphertext in object storage, snapshot compaction, gap and catch-up queries by opaque id and cursor.
- Lease service with expiry.
- Quotas per account and purge on account deletion.

### Product surface

- **Settings → Sync**: on/off, this device and the others with last-seen times, add a device, passkey status, remove a device, storage used.
- **Sign-in on a new device**: "Unlock with passkey" or "Approve from another device", with the code comparison for the latter, and the data-loss statement before passkey creation.
- **Status**: synced, syncing, or offline, in the account menu.
- **Sessions**: sessions from other devices appear in the list; a running session shows the device running it and "Continue here".
- **Workspaces**: an unbound workspace shows "Not on this device" and a folder picker.

All copy goes through the locale dictionaries.

### Migration of existing data

Turning sync on for the first time on a device that already has data publishes it in the background: account documents first, memory shards next, then session metadata, then session bodies oldest to newest, throttled and resumable across restarts. A device joining an existing vault downloads in the same order.

### Phases and effort

Estimates are engineer-weeks for one developer who knows this codebase, including the work each phase's acceptance criteria need.

| Phase | Scope | Engineer-weeks |
|---|---|---|
| 0. Experiments | MemOS row ids and triggers, Yjs shard size, vector recomputation, Electron passkeys ([findings](#phase-0-findings)) | done |
| 1. Vault and devices | Keys, envelope, device chain, approval with code comparison, passkey PRF enrollment and unlock, removal and epochs; server storage and passkey endpoints; minimal UI | 3–4 |
| 2. Sync core and relay | `ctx.sync`, Yjs manager, `sync.db`, outbox, server WebSocket rooms, encrypted store, snapshots, catch-up, status | 3–4 |
| 3. Account documents | Settings scope declaration, personalization, account settings, workspace registry with bindings, automations, feedback, capabilities | 2–2.5 |
| 4. Memory | Triggers, shards, materialization, local vectors, forget, maintenance lease, backfill | 3–4 |
| 5. Sessions | Streams, import, live view, session lease, continue or fork, path rebinding, lazy bodies, backfill | 3–4 |
| 6. Attachments | Encrypted blobs, on-demand fetch | 1 |
| 7. Local-network peers | mDNS, peer transport, peer authentication, lease handover | 1.5–2 |
| 8. Hardening and release | Convergence, crash, offline, and revocation verification on macOS, Windows, and Linux; resource budgets; documentation; fixes from security review | 3 |
| **Total** | | **19.5–24.5** |

An external review of the vault and envelope design and code is recommended before release; it runs in parallel with phases 5–8. Phases 1–4 alone deliver memory, learned capabilities, personalization, and settings that are identical across devices, which is 11–14.5 engineer-weeks.

<a id="phase-0-findings"></a>
### Phase 0 findings

Measured on the developer's own account (21,887 traces) on an Apple-silicon Mac.

- **Prerequisites.** Workspace ownership and the per-home session writer lock already exist; only the settings scope remains, and it lands in phase 3.
- **Row ids.** MemOS ids are a type prefix plus 12 random Crockford base-32 characters, 60 random bits (`vendor/memos-local-plugin/src/core/id.ts`). MemOS `sessions` rows use Aeven session ids, and `trace_policy_links` keys on two such ids. Rows created on different devices do not collide.
- **Replicated and local tables.** Replicated: `traces`, `episodes`, `sessions`, `policies`, `trace_policy_links`, `world_model`, `skills`, `skill_trials`, `feedback`, `decision_repairs`, and `l2_candidate_pool`, the induction working set, so a new maintenance-lease holder continues where the previous one stopped. Local: `api_logs`, `audit_events`, `embedding_retry_queue`, `kv` (induction retry bookkeeping), hub tables, `schema_migrations`, and FTS tables.
- **Triggers.** MemOS already maintains its FTS tables with triggers, and none of its 14 migrations drops or rebuilds a table, so added triggers survive migrations. A trigger records only table, key, and operation, and the publisher reads the whole row, so columns added by later migrations replicate without trigger changes. A receiver writes the columns its schema has and keeps the rest in the document.
- **Shard key.** October 2026 alone holds 21,878 traces with 56 MB of text, so month shards fail. Sharding by the first two characters of the random id part gives 1,024 shards per table; the largest is 587 KB and loads in 3.7 ms. The Yjs encoding of all trace rows without vectors (71 MB) is the size of their JSON, and a one-field edit is a 43-byte update. Tables with fewer than a few thousand rows use one character (32 shards).
- **Vectors.** `Xenova/multilingual-e5-small` (q8, CPU) embeds a summary in 2.6 ms, about 2 minutes for both vectors of every trace; texts longer than 512 tokens are split into pieces and take longer. Vectors are recomputed locally and not replicated.
- **Passkeys in Electron.** Electron's built-in WebAuthn does not reach platform passkeys on macOS ([electron/electron#24573](https://github.com/electron/electron/issues/24573)); pull request [#51563](https://github.com/electron/electron/pull/51563) proposes `app.configureWebAuthn()`, and community native modules expose PRF on macOS 15 and later. The first release runs the passkey ceremony in the system browser on an `aeven.io` page, which unwraps the vault key in the page and hands it to the Host through a loopback request. A native ceremony replaces it once a released Electron supports platform passkeys with PRF.

### Built so far

The [account sync packages](../../../../packages/sync/README.md) and the `servers/node` relay implement phases 1–5 with these differences from the plan above:

- **Joining** is answered only by a device whose add-device screen is open, and opening that screen asks a waiting device to repeat its request, so a background or headless device never takes a join meant for the user's open screen.
- **Memory vectors travel** with the rows, tagged with the embedding model, instead of being recomputed: MemOS's vector source texts are internal to it. A device on another model keeps its own vectors.
- **Memory rows** replicate per row, last writer wins, with tombstones that win over concurrent edits; shards key on the first one or two characters of the random id part.
- **Conversations** are published by the device that created each session; the writer lease, "Continue here", and live viewing of another device's running turn are not built.
- **Devices** are named by host name, listed in Settings → Sync, and removed with a key rotation; a removed device joins again with new keys.
- Not built: passkey recovery, the maintenance lease, the local-network transport, attachments, the settings scope declaration, and the production `/sync` route on aeven.io.

### Open questions

1. Which browsers and passkey providers return PRF results in the system-browser ceremony on Windows and Linux. A device without one enrolls through approval from another device.
2. Server storage per account and the quota policy for accounts with several gigabytes of sessions.
3. Resharding when a table outgrows 1,024 shards, at roughly ten times the current largest account.

## Alternatives considered

**GUN.** GUN relays merge using the graph's soul ids, field names, and state timestamps, so those stay readable to the server; SEA encrypts values only. Conflicts resolve per field by wall-clock state, so device clock skew changes outcomes. The graph is held in memory, it gives no ordering guarantee for append-only logs, its storage adapter has reported data-loss issues, and maintenance is concentrated in one person. Its peer mesh is its main strength, and here the server must stay in the storage path anyway.

**Automerge.** Automerge supports the same encrypted-update pattern and is well engineered. It ships as WebAssembly, retains full change history, and costs more per update in realtime use; Yjs is pure JavaScript, smaller, faster for frequent small updates, and has published designs for encrypted synchronization.

**Server-readable sync.** Encryption in transit and at rest with server-held keys gives the simplest recovery and allows server-side search and an Aeven-hosted Web app. Rejected because the server must not be able to read the data.

**A key derived from account sign-in.** OAuth sign-in and bcrypt-verified passwords both let the server authenticate as the user, so a key derived from them is a key the server can derive.

**Copying the home folder or SQLite files** (a Syncthing-style file sync of `$AVN_HOME`). Concurrent writes to SQLite and JSONL files on two devices corrupt or interleave them, nothing merges in realtime, and there is no unit smaller than a file.

**Peer-to-peer only, without server storage.** Two devices of one person are rarely online at the same time, and a single remaining device would be the only copy.

**Hole-punched direct connections now.** WebRTC or QUIC in the Node Host needs a native module per platform. Relay latency is measured first.

**Re-deriving memory from synchronized sessions.** Every device would pay the model cost of capture again, results differ between runs, and manual edits, imports, and feedback would not carry over.

**Session logs as CRDT documents** (`Y.Array` per session). A session has one writer, so merging is never needed, and holding gigabytes of events in CRDT documents costs memory and storage for no gain.

**Building on the hosted Web surface's sync stage.** That note's Stage 4 proposes moving settings, capabilities, and memory first and importing sessions before any replication service, and rejects log replication because one writer per session was not enforced across Hosts. The per-session file lock covers Hosts on one home, this note's session lease covers devices, and this note owns account synchronization.

## Acceptance criteria

- With two devices online through the server, a memory captured on one is recalled on the other within 2 seconds at the 95th percentile; on one local network, within 1 second.
- A session running on device A appears on device B with its reply streaming; B cannot append without the lease; "Continue here" hands the lease over when A is idle and forks otherwise.
- A new device that signs in with the passkey restores memory, capabilities, personalization, settings, and the session list with no other device online.
- A new device without the passkey joins only after the user confirms matching codes on an enrolled device.
- A search of the server's database and object storage for a known memory sentence, session title, and file name finds nothing; no document or stream id on the server matches its logical name.
- A removed device cannot decrypt any change made after its removal, and local-network peers refuse it.
- Forgetting a memory on one device removes it on the others, and after the next snapshot the server holds no envelope containing it.
- Edits made on two devices while both are offline converge after reconnection; killing the Host during sync loses no change that was acknowledged locally.
- With sync disabled or the server unreachable, the app starts without delay and works locally.
- Memory induction runs on one device of the account at a time.
- Idle Host memory rises by at most 25 MB and the installed size by at most 2 MB with sync enabled.

## Risks

- **Permanent loss.** Losing the passkey and every enrolled device loses the vault. This is accepted and has to be stated where the user creates the passkey.
- **Served unlock page.** While the passkey ceremony runs in the system browser, the user trusts the code `aeven.io` serves for the unlock page.
- **Plaintext outside sync.** The inference gateway sees each turn's prompt and recalled memory; without a body-free logging commitment, end-to-end sync does not make the product private.
- **Metadata.** The server still learns device count, activity timing, sizes, and IP addresses.
- **Local-network listener.** The LAN transport opens a listening port, which triggers the macOS incoming-connection prompt and is new attack surface; it speaks only the sync protocol and authenticates every peer against the chain.
- **Cryptography mistakes.** Nonce handling, signature coverage, chain verification, and epoch rotation are easy to get subtly wrong; this is why the external review is part of the plan.
- **Vendored MemOS changes.** A MemOS update that renames or restructures tables breaks the triggers; the vendor sync procedure gains a step to re-check them.
- **Server cost.** Accounts with gigabytes of sessions cost storage the subscription has to cover.
- **Maintenance pauses.** While the maintenance-lease holder is offline and the lease has not expired, no device induces new policies.
- **What the change gives up:** server-side features over account data (server search, an Aeven-hosted Host or Web app with the user's memory), and recovery by Aeven support when the passkey and devices are gone.
