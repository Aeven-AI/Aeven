# Account Sync

English | [中文](sync.zh.md)

Account sync keeps one Aeven account's conversations, settings, and memory the same on every device signed in to it. Each device encrypts a change before it leaves, the relay stores and forwards ciphertext it cannot open, and devices exchange changes within a second while both are online and catch up when one returns. [sync/](../../packages/sync/README.md) maps the packages; this page is the reference for the `ctx.sync` vocabulary and the events it emits.

The seam follows the [capability-seam](../glossary.md) roles: [@aeven/sync](../../packages/sync/sync/README.md) declares `ctx.sync` and its types, [@aeven/sync-yjs](../../packages/sync/sync-yjs/README.md) provides documents, the local store, and the relay connection, and each consumer publishes its own data through it — [@aeven/session-sync](../../packages/session/session-sync/README.md) for conversation history and [@aeven/settings-sync](../../packages/settings/settings-sync/README.md) for the settings namespaces that declare the account reach. [@aeven/api-sync-controller](../../packages/api/sync-controller/README.md) exposes status and device calls to the Client, and [@aeven/client-ui-settings-sync](../../packages/client/ui-settings-sync/README.md) renders Settings → Sync.

A session another device writes opens as a local replica: readable and forkable, never resumed or repaired here ([persistence.md](persistence.md)). The design and its trade-offs are in the [account sync Agent Note](../../.agents/notes/proposed/architecture/2026-10-27-account-sync-network.md).

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxsync--sync-abstract-seam"></a>

### `ctx.sync` — `Sync` (abstract seam)

Account sync capability.

```ts cordis-catalog
/**
 * Read one account's status on this device.
 * @param owner - the account.
 * @returns the current status.
 */
abstract status(owner: string): SyncStatus

/**
 * Turn sync on or off for the account on this device. Syncing is on by default for every account signed in on
 * this Host; turning it off keeps the local copy and stops exchanging changes until it is turned on again.
 * @param owner - the account.
 * @param enabled - whether this device syncs the account.
 */
abstract setEnabled(owner: string, enabled: boolean): void

/**
 * List the devices of the account that have synced, by the names they gave themselves.
 * @param owner - an account whose documents this device can open.
 * @returns the devices, this one first.
 */
abstract devices(owner: string): Promise<SyncDevice[]>

/**
 * Take another device off the account's device list. It does not revoke the device: one that syncs again lists
 * itself again.
 * @param owner - an account whose documents this device can open.
 * @param device - a device {@link devices} lists, other than this one.
 * @returns when the list no longer names the device.
 */
abstract removeDevice(owner: string, device: DeviceId): Promise<void>

/**
 * The opaque id of a logical document name, the id `sync/document` reports.
 * @param owner - an account whose documents this device can open.
 * @param name - the logical name.
 * @returns the opaque id.
 */
abstract documentId(owner: string, name: string): string

/**
 * Open a document of an account whose key this device holds, loading its local state first.
 * @param owner - the account.
 * @param name - logical name, such as `settings/account`; never sent to the relay.
 * @returns the open document.
 */
abstract openDocument(owner: string, name: string): Promise<SyncDocument>

/**
 * List the documents this device holds state for, so a Consumer that mirrors many documents opens only those.
 * @param owner - an account whose documents this device can open.
 * @returns the opaque ids, as {@link documentId} returns them.
 */
abstract storedDocuments(owner: string): readonly string[]

/**
 * Read a value this device keeps for the account and never sends to another device, such as how far a Consumer
 * got with work that survives restarts.
 * @param owner - an account this device syncs.
 * @param key - the value's name, prefixed by the Consumer that owns it.
 * @returns the stored value, or undefined when none is stored.
 */
abstract localValue(owner: string, key: string): string | undefined

/**
 * Store a value this device keeps for the account and never sends to another device; see {@link localValue}.
 * @param owner - an account this device syncs.
 * @param key - the value's name, prefixed by the Consumer that owns it.
 * @param value - the value to keep.
 */
abstract setLocalValue(owner: string, key: string, value: string): void

/**
 * Queue one batch for a stream this device writes. Batches reach the relay in the order they were queued,
 * after every document change queued before them.
 * @param owner - an account whose documents this device can open.
 * @param name - the stream's logical name.
 * @param payload - the batch.
 */
abstract appendStream(owner: string, name: string, payload: Uint8Array): Promise<void>

/**
 * Read a stream's batches from the relay, oldest first, one page at a time. Requires a connection.
 * @param owner - an account whose documents this device can open.
 * @param name - the stream's logical name.
 * @param after - the last relay sequence number already read; 0 reads from the start.
 * @returns the next page of batches and whether more follow.
 */
abstract readStream(owner: string, name: string, after: number): Promise<{ batches: SyncStreamBatch[]; more: boolean }>

/**
 * Count the account's devices this device is linked to directly, outside the relay.
 * @param _owner - an account whose documents this device can open.
 * @returns the number of directly linked devices; 0 when this provider has no direct path.
 */
linked(_owner: string): Promise<number>

/**
 * Receive a stream's batches as another device of the account sends them, including over a local network while
 * the relay is unreachable. A provider without a direct path between devices yields nothing.
 * @param _owner - an account whose documents this device can open.
 * @param _name - the stream's logical name.
 * @param _listener - receives each batch payload once, in the order the writing device sent it.
 * @returns a disposer that stops the subscription.
 */
watchStream(_owner: string, _name: string, _listener: (payload: Uint8Array) => void): () => void

/**
 * Publish the local outbox and receive the relay's committed backlog before transferring exclusive work.
 * @param _owner - account whose vault must be online.
 * @returns when the outbox is acknowledged and the received documents are current.
 */
synchronize(_owner: string): Promise<void>

/**
 * Acquire or renew exclusive work on this device. Requires an online account; an unreachable relay
 * rejects the request. Callers must stop work before renewal fails or its requested duration elapses.
 * @param owner - the account.
 * @param name - logical work name, hidden from the relay.
 * @param ttlMs - requested lifetime, bounded by the relay's deployment policy.
 * @returns the current holder and whether this device acquired the lease.
 */
abstract acquireLease(owner: string, name: string, ttlMs: number): Promise<SyncLease>

/**
 * Release work held by this device; another device's lease is unaffected. Requires a connection.
 * @param owner - the account.
 * @param name - logical work name.
 */
abstract releaseLease(owner: string, name: string): Promise<void>
```

Source: [`packages/sync/sync/src/index.ts`](../../packages/sync/sync/src/index.ts)

<a id="ctxsynccontroller--synccontroller"></a>

### `ctx.syncController` — `SyncController`

The signed-in user's account sync.

```ts cordis-catalog
/**
 * Read the caller's sync status.
 * @returns the status.
 */
@Remote async status(): Promise<SyncView>

/**
 * Turn sync on or off for the caller's account on this device.
 * @param enabled - whether this device syncs the account.
 * @returns the status afterwards.
 */
@Remote async setEnabled(enabled: boolean): Promise<SyncView>

/**
 * List the caller's devices.
 * @returns the devices, this one first.
 */
@Remote async devices(): Promise<SyncDeviceView[]>

/**
 * Take another of the caller's devices off the device list.
 * @param id - a listed device other than this one.
 * @returns the devices afterwards, this one first.
 */
@Remote async removeDevice(id: string): Promise<SyncDeviceView[]>
```

Source: [`packages/api/sync-controller/src/index.ts`](../../packages/api/sync-controller/src/index.ts)

<a id="sync-events"></a>

### `sync/*` events

<a id="syncdocument--emit"></a>

#### `sync/document` — emit

Another device's change to a document was stored on this device; open the document by name to read it.

```ts cordis-catalog
/**
 * Another device's change to a document was stored on this device; open the document by name to read it.
 * @mode emit
 * @param owner - the account.
 * @param id - the document's opaque id, as {@link Sync.documentId} returns it.
 */
'sync/document'(owner: string, id: string): void
```

Source: [`packages/sync/sync/src/index.ts`](../../packages/sync/sync/src/index.ts)

<a id="syncprogress--emit"></a>

#### `sync/progress` — emit

Collect an account's conversation publication progress without reading its logs.

```ts cordis-catalog
/**
 * Collect an account's conversation publication progress without reading its logs.
 * @mode emit
 * @param owner - the account whose progress is requested.
 * @param progress - publisher counters, initialized to zero by the caller.
 */
'sync/progress'(owner: string, progress: SyncProgress): void
```

Source: [`packages/sync/sync/src/index.ts`](../../packages/sync/sync/src/index.ts)

<a id="syncstatus--emit"></a>

#### `sync/status` — emit

An account's sync status changed.

```ts cordis-catalog
/**
 * An account's sync status changed.
 * @mode emit
 * @param owner - the account whose status changed.
 */
'sync/status'(owner: string): void
```

Source: [`packages/sync/sync/src/index.ts`](../../packages/sync/sync/src/index.ts)
<!-- END GENERATED cordis-surface -->
