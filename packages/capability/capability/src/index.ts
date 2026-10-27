/**
 * Learned capabilities: Aeven-owned, per-user procedures an agent learned, stored as agentskills-compatible
 * directories. Recall consumers read procedures directly; the registry contributes no skills.
 *
 * @module @aeven/capability
 */
import { isAbsolute } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { randomUUID } from 'node:crypto'
import { capabilityName, CapabilityStore, supportingPath } from './store.ts'
import { CapabilitySync, type SyncedCapability } from './sync.ts'
import { judge, supportedStatus } from './policy.ts'
import { redactSecrets } from './redact.ts'
import type {
  Capability,
  CapabilityAmendment,
  CapabilityChange,
  CapabilityDraft,
  CapabilityExecution,
  CapabilityOrigin,
  CapabilityRecord,
  CapabilitySource,
  CapabilityStatus,
  CapabilityVersion,
  JudgedExecution,
} from './types.ts'

export type * from './types.ts'
export { capabilityName, FILE_FOLDERS, supportingPath } from './store.ts'
export { currentEnvironment, EXECUTABLE_STATUSES } from './policy.ts'
export { redactSecrets } from './redact.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Per-user learned capabilities. */
    capabilities: Capabilities
  }

  interface Events {
    /**
     * One capability of an owner was saved, changed, or deleted. Emitted after the write is durable.
     * @param change - owner and capability name.
     * @mode emit
     */
    'capabilities/changed'(change: CapabilityChange): void
  }
}

/** Service configuration. */
export interface Config {
  /** Absolute directory holding one subdirectory per owner. */
  root: string
  /** Successful executions of the current revision needed to become trusted; at least one must be verified. */
  trustAfter: number
  /** Consecutive failed executions of the current revision that degrade a capability, or retire a candidate. */
  degradeAfter: number
}

/** Registry of learned capabilities for every signed-in user of this Host. */
export default class Capabilities extends Service {
  static Config: z<Pick<Config, 'root'> & Partial<Config>, Config> = z.object({
    root: z.string().min(1).required(),
    trustAfter: z.natural().min(1).default(3),
    degradeAfter: z.natural().min(1).default(2),
  })

  private readonly store: CapabilityStore
  private readonly writes = new Map<string, Promise<unknown>>()
  private readonly synced: CapabilitySync
  /** Capabilities whose files another device wrote here, which must not be published back. */
  private readonly applying = new Set<string>()

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'capabilities')
    if (!isAbsolute(config.root)) throw new Error(`capabilities root must be absolute: ${config.root}`)
    this.store = new CapabilityStore(config.root)
    this.synced = new CapabilitySync(
      ctx,
      (owner, name, entry) => { this.applySynced(owner, name, entry) },
      (message) => { ctx.logger('capabilities').warn(message) },
    )
    // Each account's capabilities follow it to every device its sync vault holds, once that vault is served here.
    this.ctx.on('sync/status', (owner) => { void this.synced.attach(owner) })
    ctx.effect(() => () => this.synced.dispose(), 'capabilities.sync')
  }

  /**
   * List an owner's capabilities.
   * @param owner - account id.
   * @returns records sorted by name.
   */
  list(owner: string): Promise<CapabilityRecord[]> {
    return this.store.list(owner)
  }

  /**
   * Read one capability with its body.
   * @param owner - account id.
   * @param name - capability name.
   * @returns the capability, or undefined when the owner has none by that name.
   */
  get(owner: string, name: string): Promise<Capability | undefined> {
    return this.store.get(owner, capabilityName(name))
  }

  /**
   * Create a capability or replace its body and description, keeping its supporting files. Credentials in the
   * description, the procedure, and the origin's request are redacted before they are stored.
   * @param owner - account id.
   * @param draft - name, description, and procedure.
   * @param options - resulting status, who originated it, the writing session (undefined outside a session), and
   * the work it was learned from; a later save keeps the first origin.
   * @returns the stored capability.
   */
  save(
    owner: string,
    draft: CapabilityDraft,
    options: {
      readonly status: CapabilityStatus
      readonly source: CapabilitySource
      readonly sessionId: string | undefined
      readonly origin?: CapabilityOrigin
    },
  ): Promise<Capability> {
    const name = capabilityName(draft.name)
    return this.serialize(owner, name, async () => {
      const existing = await this.store.record(owner, name)
      const work = existing?.origin ?? (options.origin === undefined ? undefined : redactedOrigin(options.origin))
      const now = Date.now()
      await this.store.write(owner, {
        name,
        description: oneLine(redactSecrets(draft.description)),
        status: options.status,
        revision: (existing?.revision ?? 0) + 1,
        ...existing?.trustedRevision === undefined ? {} : { trustedRevision: existing.trustedRevision },
        source: existing?.source ?? options.source,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        files: existing?.files ?? [],
        provenance: [...existing?.provenance ?? [], { ...origin(options.sessionId), at: now, action: existing ? 'update' : 'save' }],
        ...work === undefined ? {} : { origin: work },
        content: redactSecrets(draft.content),
      })
      return await this.settle(owner, name)
    })
  }

  /**
   * Replace one exact, unique passage of a capability's procedure; credentials in the result are redacted.
   * @param owner - account id.
   * @param name - capability name.
   * @param edit - the passage to replace and its replacement.
   * @param sessionId - the writing session; undefined when the user changed it outside a session.
   * @returns the updated capability.
   * @throws when the capability does not exist or the passage is missing or ambiguous.
   */
  patch(
    owner: string,
    name: string,
    edit: { readonly oldString: string; readonly newString: string },
    sessionId: string | undefined,
  ): Promise<Capability> {
    return this.serialize(owner, capabilityName(name), async () => {
      const current = await this.require(owner, name)
      const occurrences = current.content.split(edit.oldString).length - 1
      if (occurrences !== 1) throw new Error(`the passage to replace must occur exactly once in ${name}; found ${occurrences}`)
      const now = Date.now()
      await this.store.write(owner, {
        ...record(current),
        revision: current.revision + 1,
        updatedAt: now,
        provenance: [...current.provenance, { ...origin(sessionId), at: now, action: 'update' }],
        content: redactSecrets(current.content.replace(edit.oldString, edit.newString)),
      })
      return await this.settle(owner, name)
    })
  }

  /**
   * Write one supporting file, such as a script the procedure runs; credentials in it are redacted.
   * @param owner - account id.
   * @param name - capability name.
   * @param path - path inside a supporting-file folder.
   * @param content - file content.
   * @param sessionId - the writing session; undefined when the user changed it outside a session.
   * @returns the updated capability.
   */
  writeFile(owner: string, name: string, path: string, content: string, sessionId: string | undefined): Promise<Capability> {
    const file = supportingPath(path)
    return this.serialize(owner, capabilityName(name), async () => {
      const current = await this.require(owner, name)
      await this.store.writeFile(owner, name, file, redactSecrets(content))
      const now = Date.now()
      await this.store.write(owner, {
        ...record(current),
        revision: current.revision + 1,
        updatedAt: now,
        files: [...new Set([...current.files, file])].sort(),
        provenance: [...current.provenance, { ...origin(sessionId), at: now, action: 'file' }],
        content: current.content,
      })
      return await this.settle(owner, name)
    })
  }

  /**
   * Change a capability's status, such as confirming a candidate.
   * @param owner - account id.
   * @param name - capability name.
   * @param status - new status.
   * @param sessionId - the session the change was made from; undefined when the user changed it outside a session.
   * @returns the updated capability.
   */
  setStatus(owner: string, name: string, status: CapabilityStatus, sessionId: string | undefined): Promise<Capability> {
    return this.serialize(owner, capabilityName(name), async () => {
      const current = await this.require(owner, name)
      const now = Date.now()
      await this.store.write(owner, {
        ...record(current),
        status,
        updatedAt: now,
        provenance: [...current.provenance, { ...origin(sessionId), at: now, action: 'status' }],
        content: current.content,
      })
      return await this.settle(owner, name)
    })
  }

  /**
   * Delete a capability and its supporting files.
   * @param owner - account id.
   * @param name - capability name.
   * @returns true when a capability was deleted.
   */
  remove(owner: string, name: string): Promise<boolean> {
    return this.serialize(owner, capabilityName(name), async () => {
      if (await this.store.record(owner, name) === undefined) return false
      await this.store.remove(owner, name)
      return true
    })
  }

  /**
   * List the revisions whose body is still kept, oldest first.
   *
   * Every write keeps its revision's procedure, so a capability whose current revision turned out worse than an
   * earlier one can be restored instead of rewritten from memory.
   * @param owner - account id.
   * @param name - capability name.
   * @returns one entry per kept revision.
   */
  versions(owner: string, name: string): Promise<CapabilityVersion[]> {
    return this.store.versions(owner, capabilityName(name))
  }

  /**
   * Restore one kept revision as a new revision.
   *
   * The earlier procedure and the description it carried become the current revision, so the history stays
   * append-only and a later execution is attributable to the text it actually followed. The restored revision
   * then answers to its evidence like any other: a revision whose runs fail is degraded rather than trusted.
   * @param owner - account id.
   * @param name - capability name.
   * @param revision - revision whose body to restore.
   * @param sessionId - the session the restore was made from; undefined when the user restored it outside a session.
   * @returns the capability at its new revision.
   * @throws when the capability does not exist, or no body was kept for that revision.
   */
  rollback(owner: string, name: string, revision: number, sessionId: string | undefined): Promise<Capability> {
    return this.serialize(owner, capabilityName(name), async () => {
      const current = await this.require(owner, name)
      const kept = await this.store.version(owner, name, revision)
      if (kept === undefined) throw new Error(`no kept revision ${revision} of ${name}`)
      const now = Date.now()
      await this.store.write(owner, {
        ...record(current),
        revision: current.revision + 1,
        ...kept.description === undefined ? {} : { description: kept.description },
        updatedAt: now,
        provenance: [...current.provenance, { ...origin(sessionId), at: now, action: 'rollback', restored: revision }],
        content: kept.content,
      })
      return await this.settle(owner, name)
    })
  }

  /**
   * Record one use of an executable capability; its revision is the current one.
   * @param owner - account id.
   * @param name - capability name.
   * @param execution - what happened in the turn that used it.
   * @returns the execution id, for amendments.
   */
  recordExecution(owner: string, name: string, execution: Omit<CapabilityExecution, 'kind' | 'id' | 'revision'>): Promise<string> {
    return this.serialize(owner, capabilityName(name), async () => {
      const current = await this.require(owner, name)
      const id = randomUUID()
      await this.store.appendEvidence(owner, name, { ...execution, kind: 'execution', id, revision: current.revision })
      await this.settle(owner, name)
      return id
    })
  }

  /**
   * Attach later evidence, a correction or a rating, to a recorded execution.
   * @param owner - account id.
   * @param name - capability name.
   * @param amendment - the evidence.
   */
  amend(owner: string, name: string, amendment: CapabilityAmendment): Promise<void> {
    return this.serialize(owner, capabilityName(name), async () => {
      await this.require(owner, name)
      await this.store.appendEvidence(owner, name, amendment)
      await this.settle(owner, name)
    })
  }

  /**
   * Read a capability's executions with their verdicts.
   * @param owner - account id.
   * @param name - capability name.
   * @returns judged executions in the order they ran.
   */
  async evidence(owner: string, name: string): Promise<JudgedExecution[]> {
    return judge(await this.store.evidence(owner, capabilityName(name)))
  }

  /** Move the capability to the status its evidence supports; runs inside the capability's write. */
  private async settle(owner: string, name: string): Promise<Capability> {
    const current = await this.require(owner, name)
    const supported = supportedStatus(current, judge(await this.store.evidence(owner, name)), this.config)
    const settled = supported.status === current.status
      && (supported.trustedRevision ?? current.trustedRevision) === current.trustedRevision
    if (settled) return current
    const now = Date.now()
    await this.store.write(owner, {
      ...record(current),
      status: supported.status,
      ...supported.trustedRevision === undefined ? {} : { trustedRevision: supported.trustedRevision },
      updatedAt: now,
      provenance: [...current.provenance, { at: now, action: 'evidence' }],
      content: current.content,
    })
    return await this.store.get(owner, name) as Capability
  }

  /**
   * Publish one capability to the account's other devices after a local write.
   * @param owner - account id.
   * @param name - capability name.
   */
  private publish(owner: string, name: string): void {
    void this.publishOne(owner, name).catch((error: unknown) => {
      this.ctx.logger('capabilities').warn(`capabilities: ${name} was not published to the account: ${String(error)}`)
    })
  }

  private async publishOne(owner: string, name: string): Promise<void> {
    const record = await this.store.record(owner, name)
    if (record === undefined) {
      await this.synced.forget(owner, name, Date.now())
      return
    }
    await this.synced.publish(owner, name, {
      files: await this.store.files(owner, name),
      revision: record.revision,
      changedAt: record.updatedAt,
    })
  }

  /**
   * Apply another device's capability or removal when it is newer than what this device holds.
   * @param owner - account id.
   * @param name - capability name.
   * @param entry - the synced files or the removal.
   */
  private applySynced(owner: string, name: string, entry: SyncedCapability): void {
    const key = JSON.stringify([owner, name])
    this.applying.add(key)
    void this.serialize(owner, name, async () => {
      const current = await this.store.record(owner, name)
      // A later write wins; at the same instant the entry the document stored last wins.
      if (current !== undefined && current.updatedAt > entry.changedAt) return
      if (entry.removed === true) {
        if (current === undefined) return
        await this.store.remove(owner, name)
        return
      }
      if (entry.files === undefined) return
      const files = await this.store.files(owner, name).catch(() => ({} as Record<string, string>))
      if (JSON.stringify(files) === JSON.stringify(entry.files)) return
      await this.store.replaceFiles(owner, name, entry.files)
    }).catch((error: unknown) => {
      this.ctx.logger('capabilities').warn(`capabilities: another device's ${name} was not stored: ${String(error)}`)
    }).finally(() => { this.applying.delete(key) })
  }

  private async require(owner: string, name: string): Promise<Capability> {
    const current = await this.store.get(owner, name)
    if (current === undefined) throw new Error(`no capability named ${name}`)
    return current
  }

  /** Run writes to one capability one at a time, and announce each after it commits. */
  private serialize<T>(owner: string, name: string, write: () => Promise<T>): Promise<T> {
    const key = JSON.stringify([owner, name])
    const run = (this.writes.get(key) ?? Promise.resolve()).then(write)
    const settled = run.then(() => undefined, () => undefined)
    this.writes.set(key, settled)
    void settled.then(() => {
      if (this.writes.get(key) === settled) this.writes.delete(key)
    })
    return run.then((result) => {
      if (!this.applying.has(key)) this.publish(owner, name)
      try {
        this.ctx.emit('capabilities/changed', { owner, name })
      } catch (error: unknown) {
        // The write already committed; observers are notified best-effort.
        this.ctx.logger('capabilities').warn(`capabilities/changed listener threw: ${error instanceof Error ? error.message : String(error)}`)
      }
      return result
    })
  }


}

function record(capability: Capability): CapabilityRecord {
  const { content: _content, directory: _directory, ...rest } = capability
  return rest
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function redactedOrigin(work: CapabilityOrigin): CapabilityOrigin {
  return { ...work, request: redactSecrets(work.request) }
}

function origin(sessionId: string | undefined): { sessionId?: string } {
  return sessionId === undefined ? {} : { sessionId }
}
