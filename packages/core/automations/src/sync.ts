/**
 * Keeps each account's automation definitions the same on all of its devices through the account's synced
 * `automations` document, while `ctx.sync` serves the account. Each definition is one map entry; a removed
 * automation leaves a tombstone, and the entry changed last wins. Opening the document publishes every local
 * definition it does not name yet. The same document's `hosts` map holds the profile of every Host that opened
 * it, keyed by the Host's runner id, so each Host can tell where the account's definitions can run. A Host that
 * stops serving the account stays listed. Manual cloud requests and their execution snapshots share this
 * document; only the addressed cloud Host admits a request, independently of the requesting client.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Map as YMap, Transaction, YMapEvent } from 'yjs'
import type { SyncDocument } from '@aeven/sync'
import { runSchema } from './domain.ts'
import type { AutomationDefinition, AutomationId, AutomationRun, AutomationRunId, AutomationRunnerId, HostProfile } from './types.ts'

const DOCUMENT = 'automations'

/** One automation as the document holds it. */
export interface SyncedDefinition {
  /** The stored definition, or absent once the automation was removed. */
  definition?: AutomationDefinition
  /** When the definition or its removal was written, in milliseconds since the Unix epoch. */
  changedAt: number
}

/** Applies another device's definition or removal locally. */
export type DefinitionApply = (id: AutomationId, entry: SyncedDefinition) => void

/** Publishes the account's definitions on this device that the document does not name. */
export type DefinitionSeed = (owner: string, present: ReadonlySet<string>) => Promise<void>

/** This Host's runner id and its profile for one account, read once its definition domain is open. */
export type HostSelf = (owner: string) => Promise<{ id: AutomationRunnerId; profile: HostProfile }>

/**
 * A manual admission addressed to one cloud Host, with the approved failed run for a retry. `stop` is the
 * owner's request to stop the run; the addressed Host cancels it, or records it as cancelled before it starts.
 */
export interface CloudRunRequest {
  readonly run: AutomationRun
  readonly original?: AutomationRun
  readonly stop?: true
}

/** Mirror between the definition table and each account's synced document. */
export class DefinitionSync {
  private readonly open = new Map<string, Promise<SyncDocument | undefined>>()
  private readonly unobserve = new WeakMap<SyncDocument, () => void>()
  private readonly documents = new Map<string, SyncDocument>()
  /** The `hosts` map of each account whose document is open. */
  private readonly registered = new Map<string, YMap<HostProfile>>()

  /**
   * @param ctx - the service context; `sync` is read optionally.
   * @param apply - stores another device's definition or removal.
   * @param warn - receives failures to open or seed the document.
   * @param seed - publishes local definitions the document does not name yet.
   * @param self - reads this Host's runner id and profile.
   * @param hostsChanged - called when another device changes the account's registered Hosts.
   * @param receiveRun - admits or removes a cloud request on its addressed Host.
   * @param receiveResult - retains remote execution snapshots across client restarts.
   */
  constructor(
    private readonly ctx: Context,
    private readonly apply: DefinitionApply,
    private readonly warn: (message: string) => void,
    private readonly seed: DefinitionSeed,
    private readonly self: HostSelf,
    private readonly hostsChanged: (owner: string) => void,
    private readonly receiveRun: (owner: string, id: AutomationRunId, request: CloudRunRequest | undefined) => void,
    private readonly receiveResult: (owner: string, run: AutomationRun) => void,
  ) {}

  /**
   * The Hosts of an account that registered a profile, this one included once the document is open.
   * @param owner - the account.
   * @returns the registered profiles; empty while sync does not serve the account here.
   */
  hosts(owner: string): HostProfile[] {
    return [...this.registered.get(owner)?.values() ?? []]
  }

  /**
   * Open the account's document once this device syncs it and apply what other devices wrote.
   * @param owner - the account.
   * @returns the open document, or undefined while sync does not serve the account.
   */
  /* jscpd:ignore-start -- parallel to the other account-document attachers; this capability owns its map name and element type. */
  attach(owner: string): Promise<SyncDocument | undefined> {
    const existing = this.open.get(owner)
    if (existing !== undefined) return existing
    const sync = this.ctx.get('sync')
    const state = sync?.status(owner).state
    if (sync === undefined || state === 'disabled' || state === 'starting') return Promise.resolve(undefined)
    const opening = sync.openDocument(owner, DOCUMENT).then(async (handle) => {
      const hosts = handle.doc.getMap<HostProfile>('hosts')
      const { id, profile } = await this.self(owner)
      if (this.open.get(owner) !== opening) return handle
      if (JSON.stringify(hosts.get(id)) !== JSON.stringify(profile)) hosts.set(id, profile)
      this.registered.set(owner, hosts)
      this.documents.set(owner, handle)
      const onHosts = (_event: YMapEvent<HostProfile>, transaction: Transaction): void => {
        if (!transaction.local) this.hostsChanged(owner)
      }
      hosts.observe(onHosts)
      const map = handle.doc.getMap<SyncedDefinition>('definitions')
      this.take(map, map.keys())
      // Definitions written before this device synced, or before the account's documents started over.
      void this.seed(owner, new Set(map.keys())).catch((error: unknown) => {
        this.warn(`automations: publishing this device's definitions failed: ${String(error)}`)
      })
      const onDefinitions = (event: YMapEvent<SyncedDefinition>, transaction: Transaction): void => {
        if (!transaction.local) this.take(map, event.keysChanged)
      }
      map.observe(onDefinitions)
      const requests = handle.doc.getMap<CloudRunRequest | null>('run-requests')
      const takeRequests = (keys: Iterable<string>): void => {
        for (const key of keys) {
          const value = requests.get(key)
          if (value == null) { this.receiveRun(owner, key as AutomationRunId, undefined); continue }
          const parsed = runSchema.safeParse(value.run)
          const parsedOriginal = value.original === undefined ? undefined : runSchema.safeParse(value.original)
          if (!parsed.success || parsedOriginal?.success === false) { this.warn('automations: invalid cloud request'); continue }
          const run = parsed.data
          const original = parsedOriginal?.data
          if (run.id !== key || run.definition.owner !== owner || (original !== undefined && original.definition.owner !== owner)) { this.warn('automations: cloud request belongs to another account or run'); continue }
          const stop = value.stop === true ? { stop: true as const } : {}
          this.receiveRun(owner, run.id, { run, ...original === undefined ? {} : { original }, ...stop })
        }
      }
      takeRequests(requests.keys())
      const onRequests = (event: YMapEvent<CloudRunRequest | null>, transaction: Transaction): void => {
        if (!transaction.local) takeRequests(event.keysChanged)
      }
      requests.observe(onRequests)
      const results = handle.doc.getMap<AutomationRun>('run-results')
      const takeResults = (keys: Iterable<string>): void => {
        for (const key of keys) {
          const value = results.get(key)
          if (value === undefined) continue
          const run = runSchema.parse(value)
          if (run.id !== key || run.definition.owner !== owner) throw new Error('Automation result belongs to another account or run.')
          this.receiveResult(owner, run)
        }
      }
      takeResults(results.keys())
      const onResults = (event: YMapEvent<AutomationRun>, transaction: Transaction): void => {
        if (!transaction.local) takeResults(event.keysChanged)
      }
      results.observe(onResults)
      this.unobserve.set(handle, () => {
        hosts.unobserve(onHosts); map.unobserve(onDefinitions); requests.unobserve(onRequests); results.unobserve(onResults)
      })
      return handle
    }).catch((error: unknown) => {
      this.open.delete(owner)
      this.warn(`automations: opening the synced document failed: ${String(error)}`)
      return undefined
    })
    this.open.set(owner, opening)
    return opening
  }
  /* jscpd:ignore-end */

  private take(map: YMap<SyncedDefinition>, keys: Iterable<string>): void {
    for (const key of keys) {
      const entry = map.get(key)
      if (entry === undefined) continue
      this.apply(key as AutomationId, entry)
    }
  }

  /**
   * Write this Host's profile for an account again, such as once account sync names this device.
   * @param owner - the account; nothing happens while its document is not open here.
   */
  async reregister(owner: string): Promise<void> {
    const hosts = this.registered.get(owner)
    if (hosts === undefined) return
    const { id, profile } = await this.self(owner)
    if (JSON.stringify(hosts.get(id)) !== JSON.stringify(profile)) hosts.set(id, profile)
  }

  /**
   * Publish one definition after a local change.
   * @param owner - the account the automation belongs to.
   * @param definition - the stored definition.
   */
  async publish(owner: string, definition: AutomationDefinition): Promise<void> {
    const handle = await this.attach(owner)
    handle?.doc.getMap<SyncedDefinition>('definitions').set(definition.id, { definition, changedAt: Date.parse(definition.updatedAt) })
  }

  /**
   * Publish the removal of one automation.
   * @param owner - the account the automation belonged to.
   * @param id - the removed automation.
   * @param changedAt - when the removal was stored, in milliseconds since the Unix epoch.
   */
  async forget(owner: string, id: AutomationId, changedAt: number): Promise<void> {
    const handle = await this.attach(owner)
    handle?.doc.getMap<SyncedDefinition>('definitions').set(id, { changedAt })
  }

  /**
   * Select one registered cloud Host deterministically.
   * @param owner - account whose Hosts are registered.
   * @returns its cloud runner, or undefined while none is registered.
   */
  cloudRunner(owner: string): AutomationRunnerId | undefined {
    return [...this.registered.get(owner)?.entries() ?? []].filter(([, profile]) => profile.kind === 'cloud')
      .map(([id]) => id as AutomationRunnerId).sort()[0]
  }

  /**
   * Queue a manual run for its addressed Host and flush the account outbox before acknowledging it.
   * @param owner - requesting account.
   * @param request - approved task and optional failed original.
   * @returns when the relay has acknowledged the request.
   */
  async requestRun(owner: string, request: CloudRunRequest): Promise<void> {
    const handle = await this.attach(owner)
    if (handle === undefined) throw new Error('Account sync must be connected to run this bot in the cloud.')
    handle.doc.getMap<CloudRunRequest | null>('run-requests').set(request.run.id, request)
    const sync = this.ctx.get('sync')
    if (sync === undefined) throw new Error('Account sync is unavailable.')
    await sync.synchronize(owner)
  }

  /**
   * Ask the addressed cloud Host to stop a requested run and flush the account outbox before acknowledging it.
   * @param run - a queued or running cloud run of this account.
   * @returns when the relay has acknowledged the stop.
   */
  async stopRun(run: AutomationRun): Promise<void> {
    const owner = run.definition.owner
    const handle = owner === undefined ? undefined : await this.attach(owner)
    const requests = handle?.doc.getMap<CloudRunRequest | null>('run-requests')
    const request = requests?.get(run.id)
    if (owner === undefined || requests === undefined || request == null) throw new Error('Account sync must be connected to stop this run.')
    requests.set(run.id, { ...request, stop: true })
    const sync = this.ctx.get('sync')
    if (sync === undefined) throw new Error('Account sync is unavailable.')
    await sync.synchronize(owner)
  }

  /**
   * Read cloud requests with their latest execution snapshots.
   * @returns queued and admitted runs visible to the accounts served here.
   */
  runs(): AutomationRun[] {
    const runs: AutomationRun[] = []
    for (const [owner, handle] of this.documents) {
      const results = handle.doc.getMap<AutomationRun>('run-results')
      for (const [id, request] of handle.doc.getMap<CloudRunRequest | null>('run-requests')) {
        if (request === null) continue
        const run = runSchema.parse(results.get(id) ?? request.run)
        if (run.id !== id || run.definition.owner !== owner) throw new Error('Automation result belongs to another account or run.')
        runs.push(run)
      }
    }
    return runs
  }

  /**
   * Publish an addressed run's durable execution state; ordinary local runs stay local.
   * @param run - execution snapshot committed by its Host.
   */
  publishRun(run: AutomationRun): void {
    const owner = run.definition.owner
    const handle = owner === undefined ? undefined : this.documents.get(owner)
    if (handle !== undefined && handle.doc.getMap<CloudRunRequest | null>('run-requests').get(run.id) != null) handle.doc.getMap<AutomationRun>('run-results').set(run.id, run)
  }

  /**
   * Remove a finished cloud run's request and result from shared history.
   * @param run - the owned finished run.
   */
  forgetRun(run: AutomationRun): void {
    const owner = run.definition.owner
    const handle = owner === undefined ? undefined : this.documents.get(owner)
    if (handle === undefined || !handle.doc.getMap<CloudRunRequest | null>('run-requests').has(run.id)) return
    handle.doc.transact(() => {
      handle.doc.getMap<CloudRunRequest | null>('run-requests').set(run.id, null)
      handle.doc.getMap<AutomationRun>('run-results').delete(run.id)
    })
  }

  /* jscpd:ignore-start -- identical in every account-document mirror; each owns its own open map and document. */
  /**
   * Close the account's document because its documents started over under a new key; the next attach opens it anew.
   * @param owner - the account.
   * @returns when the document is closed.
   */
  async reset(owner: string): Promise<void> {
    const opening = this.open.get(owner)
    this.open.delete(owner)
    this.registered.delete(owner)
    this.documents.delete(owner)
    const handle = await opening
    if (handle !== undefined) {
      this.unobserve.get(handle)?.()
      this.unobserve.delete(handle)
      handle.close()
    }
  }

  /** Close every open document. */
  async dispose(): Promise<void> {
    for (const [owner] of this.open) await this.reset(owner)
    this.open.clear()
    this.registered.clear()
    this.documents.clear()
  }
  /* jscpd:ignore-end */
}
