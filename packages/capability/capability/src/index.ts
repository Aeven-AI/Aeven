/**
 * Learned capabilities: Aeven-owned, per-user procedures an agent learned, stored as agentskills-compatible
 * directories. Learned capabilities are published through `ctx.skills`; candidates stay out of the catalog.
 *
 * @module @aeven/capability
 */
import { isAbsolute, join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SkillCandidate, SkillDefinition, SkillProvider } from '@aeven/skill'
import { randomUUID } from 'node:crypto'
import { capabilityName, CapabilityStore, supportingPath } from './store.ts'
import { currentEnvironment, evidenceNote, EXECUTABLE_STATUSES, judge, supportedStatus } from './policy.ts'
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
  JudgedExecution,
} from './types.ts'

export type * from './types.ts'
export { capabilityName, FILE_FOLDERS, supportingPath } from './store.ts'
export { currentEnvironment, EXECUTABLE_STATUSES } from './policy.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Per-user learned capabilities. */
    capabilities: Capabilities
  }

  interface Events {
    /**
     * One capability of an owner was saved, changed, or deleted. Emitted after the write is durable.
     * @param change - owner and capability name.
     * @avnScopeScan unsupported
     * @mode emit
     */
    'capabilities/changed'(change: CapabilityChange): void
  }
}

/** Service configuration. */
export interface Config {
  /** Absolute directory holding one subdirectory per owner. */
  root: string
  /** Skill-catalog rank of learned capabilities; lower ranks win duplicate names. */
  skillRank: number
  /** Successful executions of the current revision needed to become trusted; at least one must be verified. */
  trustAfter: number
  /** Consecutive failed executions of the current revision that degrade a capability, or retire a candidate. */
  degradeAfter: number
  /** Days an unused candidate stays in the skill catalog; a candidate never executed in that time decays out of it. */
  candidateTtlDays: number
}

/** Provider name learned capabilities are published under in `ctx.skills`. */
export const SKILL_PROVIDER = 'learned-capabilities'

interface Locator {
  readonly owner: string
  readonly name: string
}

/** Registry of learned capabilities for every signed-in user of this Host. */
export default class Capabilities extends Service {
  static Config: z<Config> = z.object({
    root: z.string().min(1).required(),
    skillRank: z.natural().default(550),
    trustAfter: z.natural().min(1).default(3),
    degradeAfter: z.natural().min(1).default(2),
    candidateTtlDays: z.natural().min(1).default(30),
  })

  private readonly store: CapabilityStore
  private readonly writes = new Map<string, Promise<unknown>>()
  private invalidateSkills: (() => void) | undefined

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'capabilities')
    if (!isAbsolute(config.root)) throw new Error(`capabilities root must be absolute: ${config.root}`)
    this.store = new CapabilityStore(config.root)
    ctx.inject(['skills'], (skillsCtx) => {
      skillsCtx.effect(() => skillsCtx.skills.registerProvider((control) => {
        this.invalidateSkills = control.invalidate
        return this.skillProvider()
      }), 'capabilities.skills')
    })
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
   * Create a capability or replace its body and description, keeping its supporting files.
   * @param owner - account id.
   * @param draft - name, description, and procedure.
   * @param options - resulting status, who originated it, the writing session (undefined outside a session), and
   * the work it was learned from; a later save keeps the first origin.
   * @returns the stored capability.
   */
  save(owner: string, draft: CapabilityDraft, options: { readonly status: CapabilityStatus; readonly source: CapabilitySource; readonly sessionId: string | undefined; readonly origin?: CapabilityOrigin }): Promise<Capability> {
    const name = capabilityName(draft.name)
    return this.serialize(owner, name, async () => {
      const existing = await this.store.record(owner, name)
      const now = Date.now()
      await this.store.write(owner, {
        name,
        description: oneLine(draft.description),
        status: options.status,
        revision: (existing?.revision ?? 0) + 1,
        ...existing?.trustedRevision === undefined ? {} : { trustedRevision: existing.trustedRevision },
        source: existing?.source ?? options.source,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        files: existing?.files ?? [],
        provenance: [...existing?.provenance ?? [], { ...origin(options.sessionId), at: now, action: existing ? 'update' : 'save' }],
        ...(existing?.origin ?? options.origin) === undefined ? {} : { origin: existing?.origin ?? options.origin },
        content: draft.content,
      })
      return await this.settle(owner, name)
    })
  }

  /**
   * Replace one exact, unique passage of a capability's procedure.
   * @param owner - account id.
   * @param name - capability name.
   * @param edit - the passage to replace and its replacement.
   * @param sessionId - the writing session; undefined when the user changed it outside a session.
   * @returns the updated capability.
   * @throws when the capability does not exist or the passage is missing or ambiguous.
   */
  patch(owner: string, name: string, edit: { readonly oldString: string; readonly newString: string }, sessionId: string | undefined): Promise<Capability> {
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
        content: current.content.replace(edit.oldString, edit.newString),
      })
      return await this.settle(owner, name)
    })
  }

  /**
   * Write one supporting file, such as a script the procedure runs.
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
      await this.store.writeFile(owner, name, file, content)
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
    if (supported.status === current.status && (supported.trustedRevision ?? current.trustedRevision) === current.trustedRevision) return current
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
      this.invalidateSkills?.()
      try {
        this.ctx.emit('capabilities/changed', { owner, name })
      } catch (error: unknown) {
        // The write already committed; observers are notified best-effort.
        this.ctx.logger('capabilities').warn(`capabilities/changed listener threw: ${error instanceof Error ? error.message : String(error)}`)
      }
      return result
    })
  }

  /** Publish the viewing owner's executable capabilities; a candidate unused for `candidateTtlDays` decays out. */
  private skillProvider(): SkillProvider {
    return {
      name: SKILL_PROVIDER,
      list: async (options) => {
        if (options.owner === undefined) return []
        const owner = options.owner
        const records = await this.store.list(owner)
        const expired = Date.now() - this.config.candidateTtlDays * 86_400_000
        const stale = new Set(await Promise.all(records
          .filter(record => record.status === 'candidate' && record.updatedAt < expired)
          .map(async record => (await this.store.evidence(owner, record.name)).length === 0 ? record.name : '')))
        return records.filter(record => EXECUTABLE_STATUSES.includes(record.status) && !stale.has(record.name)).map((record): SkillCandidate => {
          const directory = this.store.directory(owner, record.name)
          return {
            name: record.name,
            description: record.description,
            invocation: { modelInvocable: true, userInvocable: true },
            source: 'learned',
            provider: SKILL_PROVIDER,
            resourceBase: { kind: 'directory', path: directory },
            rank: this.config.skillRank,
            locator: { owner, name: record.name } satisfies Locator,
            path: join(directory, 'SKILL.md'),
          }
        })
      },
      get: async (candidate): Promise<SkillDefinition | undefined> => {
        const { owner, name } = candidate.locator as Locator
        const capability = await this.store.get(owner, name)
        if (capability === undefined || !EXECUTABLE_STATUSES.includes(capability.status)) return undefined
        const note = evidenceNote(capability, judge(await this.store.evidence(owner, name)), currentEnvironment())
        return {
          name: capability.name,
          description: capability.description,
          invocation: candidate.invocation,
          source: candidate.source,
          provider: SKILL_PROVIDER,
          resourceBase: { kind: 'directory', path: capability.directory },
          content: note ? `${note}\n\n${capability.content}` : capability.content,
          path: join(capability.directory, 'SKILL.md'),
        }
      },
    }
  }
}

function record(capability: Capability): CapabilityRecord {
  const { content: _content, directory: _directory, ...rest } = capability
  return rest
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function origin(sessionId: string | undefined): { sessionId?: string } {
  return sessionId === undefined ? {} : { sessionId }
}
