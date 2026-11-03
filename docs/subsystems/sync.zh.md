# 账户同步

[English](sync.md) | 中文

账户同步让同一 Aeven 账户的对话、设置与记忆在每台已登录设备上保持一致。设备在变更离开本机前就完成加密，中继存储并转发这些帧，在中继创建并保存账户密钥期间，它能打开这些内容；用户用通行密钥保护账户后，只有该账户的设备持有密钥，中继只保存它无法解开的副本。两台设备同时在线时在一秒内交换变更，某台设备重新上线后补齐落后的部分。[sync/](../../packages/sync/README.zh.md) 是包地图；本页是 `ctx.sync` 词汇与它发出的事件的参考。

该 seam 遵循[能力 seam](../glossary.zh.md)的角色划分：[@aeven/sync](../../packages/sync/sync/README.zh.md) 声明 `ctx.sync` 及其类型，[@aeven/sync-yjs](../../packages/sync/sync-yjs/README.zh.md) 提供文档、本地存储与中继连接，各 consumer 通过它发布自己的数据——[@aeven/session-sync](../../packages/session/session-sync/README.zh.md) 负责对话历史，[@aeven/settings-sync](../../packages/settings/settings-sync/README.zh.md) 负责声明账户归属的设置命名空间。[@aeven/api-sync-controller](../../packages/api/sync-controller/README.zh.md) 向 Client 暴露状态与设备调用，[@aeven/client-ui-settings-sync](../../packages/client/ui-settings-sync/README.zh.md) 渲染设置 → 同步。

另一台设备写入的会话以本地副本打开：可读取、可 fork，但不在此处恢复或修复（见 [persistence.md](persistence.zh.md)）。设计与取舍见[账户同步 Agent Note](../../.agents/notes/proposed/architecture/2026-10-27-account-sync-network.zh.md)。

同步状态在应用中转历史或接收帧时报告 `catchingUp`，并通过 `error` 标识上传或下载失败。`sync/devices` 独立于传输进度报告账户设备列表的变化。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
 * Move the account key from the relay to the user's passkey: this device creates a new key, the relay keeps it
 * only wrapped under the passkey, purges what it stored under the earlier key, and every device starts over. The
 * account's other devices unlock with the passkey before they sync again. Requires a connection.
 * @param _owner - an account whose key the relay holds.
 * @param _passkey - a newly created passkey's credential id and PRF output.
 * @returns when the relay holds only the wrapped key.
 */
protect(_owner: string, _passkey: SyncPasskey): Promise<void>

/**
 * Wrap the account key under one more passkey, so either of them unlocks a new device. Requires a connection and
 * an unlocked account.
 * @param _owner - an account whose key a passkey holds.
 * @param _passkey - the additional passkey's credential id and PRF output.
 * @returns when the relay stores the additional copy.
 */
addPasskey(_owner: string, _passkey: SyncPasskey): Promise<void>

/**
 * Drop one passkey's copy of the account key; the last one stays until {@link unprotect}. Requires a connection.
 * @param _owner - an account whose key passkeys hold.
 * @param _credentialId - a credential id {@link SyncProtection.passkeys} lists.
 * @returns when the relay no longer stores that copy.
 */
removePasskey(_owner: string, _credentialId: string): Promise<void>

/**
 * Unlock the account on this device with one of its passkeys: the device unwraps the key the relay stores and
 * syncs from then on without asking again. Requires a connection.
 * @param _owner - an account whose status is locked.
 * @param _passkey - the passkey's credential id and PRF output.
 * @returns when the key is stored on this device.
 * @throws {Error} when the passkey does not open the account key.
 */
unlock(_owner: string, _passkey: SyncPasskey): Promise<void>

/**
 * Hand the account key back to the relay: it creates a new key it holds, purges what it stored, and every device
 * starts over. The account's other devices ask the user before syncing under it. Requires a connection.
 * @param _owner - an account whose key passkeys hold, unlocked on this device.
 * @returns when this device holds the relay's new key.
 */
unprotect(_owner: string): Promise<void>

/**
 * Confirm syncing under the key the relay holds after it took the key back from the account's passkeys.
 * @param _owner - an account whose status is downgraded.
 * @returns when this device holds the relay's key.
 */
acceptServerKey(_owner: string): Promise<void>

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
 * Start a passkey step: the returned page creates a passkey (`protect`, `add`) or asks for one of the account's
 * passkeys (`unlock`) in the system browser, and this Host collects the result and applies it in the background.
 * The step shows in {@link status} until it succeeds; a new step replaces one in progress.
 * @param purpose - what the passkey is for.
 * @returns the page to open.
 */
@Remote async startPasskey(purpose: SyncPasskeyPurpose): Promise<SyncPasskeyStart>

/**
 * Stop a passkey step, or dismiss one that did not finish.
 * @returns the status afterwards.
 */
@Remote async cancelPasskey(): Promise<SyncView>

/**
 * Hand the caller's account key back to the Aeven relay; every device starts over under the relay's new key.
 * @returns the status afterwards.
 */
@Remote async unprotect(): Promise<SyncView>

/**
 * Keep syncing under the key the relay took back from the account's passkeys.
 * @returns the status afterwards.
 */
@Remote async acceptServerKey(): Promise<SyncView>

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

<a id="syncdevices--emit"></a>

#### `sync/devices` — emit

The account's device list changed.

```ts cordis-catalog
/**
 * The account's device list changed.
 * @mode emit
 * @param owner - the account whose devices changed.
 */
'sync/devices'(owner: string): void
```

Source: [`packages/sync/sync/src/index.ts`](../../packages/sync/sync/src/index.ts)

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

<a id="syncreset--emit"></a>

#### `sync/reset` — emit

An account's documents started over under a new key: this device dropped every document, its outbox, and the values it kept with Sync.setLocalValue, and the relay purged what it stored under the earlier key. Consumers close the documents they hold for the account and forget cached document ids; once the account syncs again they open the documents anew and publish their data again.

```ts cordis-catalog
/**
 * An account's documents started over under a new key: this device dropped every document, its outbox, and the
 * values it kept with {@link Sync.setLocalValue}, and the relay purged what it stored under the earlier key.
 * Consumers close the documents they hold for the account and forget cached document ids; once the account
 * syncs again they open the documents anew and publish their data again.
 * @mode emit
 * @param owner - the account.
 */
'sync/reset'(owner: string): void
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
