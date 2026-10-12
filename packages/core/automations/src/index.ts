/** Built-in local automation authority: durable admission, owner-scoped agents, and run history. */
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { randomUUID, createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { installModelSelection, type Agent, type AgentHandle } from '@aeven/agent'
import type {} from '@aeven/agent-default-model'
import type {} from '@aeven/agent-presets'
import type {} from '@aeven/identity-user'
import type {} from '@aeven/permission-presets'
import type {} from '@aeven/workspace'
import type {} from '@aeven/client-connection'
import { brandString } from '@aeven/brand'
import { avnHomePath } from '@aeven/home-paths'
import { boundContextSummary, createUserMessage } from '@aeven/llm'
import { SessionId } from '@aeven/session'
import type { Domain } from '@aeven/storage-domain'
import { setApprovalPolicy } from '@aeven/user-approval'
import { automationDomain, inputSchema, patchSchema } from './domain.ts'
import { latestDueOccurrence, nextOccurrence } from './recurrence.ts'
import { registerAutomationTools } from './tools.ts'
import type { AutomationDefinition, AutomationId, AutomationInput, AutomationRun, AutomationRunId, AutomationRunnerId } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Durable local automations and their execution history. */
    automations: Automations
  }
}
/** Deployment limits for unattended local agent work. */
export interface Config {
  readonly maxConcurrentRuns: number
  readonly runTimeoutMinutes: number
  readonly misfireGraceMinutes: number
  readonly historyLimit: number
}
/** Built-in automation service; schedules never authorize additional tool access. */
export class Automations extends Service<Config> {
  static inject = ['storageDomain', 'agents', 'sessions', 'agentDefaultModel', 'agentPresets', 'permissionPresets', 'workspaceRegistry', 'identityUsers', 'connection', 'webServer', 'tools']
  static Config = z.object({
    maxConcurrentRuns: z.number().step(1).min(1).required(), runTimeoutMinutes: z.number().min(1).required(),
    misfireGraceMinutes: z.number().min(0).required(), historyLimit: z.number().step(1).min(1).required(),
  })
  private readonly ready: Promise<Domain<typeof automationDomain>>
  private tail: Promise<unknown> = Promise.resolve()
  private timer: ReturnType<typeof setTimeout> | undefined
  private stopped = false
  private readonly executionSessions = new Set<SessionId>()
  private readonly active = new Map<AutomationRunId, { promise: Promise<void>; handle?: AgentHandle }>()

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'automations')
    this.ready = ctx.storageDomain.open(automationDomain).then(async domain => {
      if (domain.table('runners').get('local') === undefined) await domain.table('runners').put('local', { id: brandString<AutomationRunnerId>(randomUUID()) })
      for (const [id, run] of domain.table('runs').entries()) {
        if (run.status === 'queued' || run.status === 'running') await domain.table('runs').put(id, {
          ...run, status: 'failed', finishedAt: new Date().toISOString(), error: 'Execution was interrupted. External changes may already exist; inspect the conversation before retrying.',
        })
        if (run.trigger === 'schedule') await this.advanceAdmission(domain, run.definition.id, run.scheduledFor)
      }
      for (const [, run] of domain.table('runs').entries()) {
        if (run.retryOfRunId !== null) {
          const original = domain.table('runs').get(run.retryOfRunId)
          if (original !== undefined && original.resolution === null) await domain.table('runs').put(original.id, { ...original, resolution: { kind: 'retried', at: run.scheduledFor, retryRunId: run.id } })
        }
      }
      await this.prune(domain)
      return domain
    })
    ctx.effect(async () => {
      const domain = await this.ready
      this.arm(domain)
      return async () => {
        this.stopped = true
        clearTimeout(this.timer)
        await this.tail
        for (const entry of this.active.values()) entry.handle?.agent.cancel({ kind: 'user' })
        await Promise.allSettled([...this.active.values()].map(entry => entry.promise))
        await domain.close()
      }
    })
    ctx.effect(() => ctx.connection.rpc.handle('/automation-control', async (endpoint, payload, signal) => {
      try {
        signal.throwIfAborted()
        const value = await this.dispatch(endpoint, payload)
        return { ok: true, value }
      } catch (error) {
        return { ok: false, error: { code: 'automation_error', message: error instanceof Error ? error.message : String(error), details: {} } }
      }
    }))
    const installTools = (agent: Agent): void => {
      if (!this.executionSessions.has(agent.session.id) && ctx.agents.roots().includes(agent)) {
        ctx.effect(() => agent.ctx.effect(() => registerAutomationTools(this, agent, ctx.identityUsers)))
      }
    }
    for (const agent of ctx.agents.roots()) installTools(agent)
    ctx.on('agent/created', ({ agent }) => installTools(agent))
    ctx.on('tools/pre-execute', async (exec, next) => {
      const decision = await next()
      if (decision.kind !== 'allow' || !exec.name.startsWith('automation_')) return decision
      if (exec.name === 'automation_create' || exec.name === 'automation_update' || exec.name === 'automation_retry' || exec.name === 'automation_confirm_result') {
        const args = exec.arguments as Record<string, unknown>
        if (exec.name === 'automation_update' && args.status === 'paused' && Object.keys(args).every(key => key === 'id' || key === 'status')) return decision
        return { kind: 'ask', reason: exec.name === 'automation_retry'
          ? 'Inspect the earlier run before retrying: external changes may already exist.'
          : exec.name === 'automation_confirm_result' ? 'Confirm that you inspected the result and the intended work was completed.'
            : 'Confirm this automation’s task, schedule, and allowed file access before enabling unattended work.' }
      }
      return decision
    })
  }

  /** Read the acting account's definitions and bounded execution history.
   * @returns owned definitions and latest run records.
   */
  async list(): Promise<{ definitions: (AutomationDefinition & { nextRunAt: string | null; lastRun: AutomationRun | null })[]; runs: AutomationRun[]; capabilities: { executionTarget: 'local'; triggers: readonly ['once', 'interval', 'daily', 'weekly'] } }> {
    const domain = await this.ready
    const definitions = [...domain.table('definitions').entries()].map(([, value]) => value).filter(value => this.ctx.identityUsers.mayAccess(value.owner))
    const runs = [...domain.table('runs').entries()].map(([, value]) => value).filter(value => this.ctx.identityUsers.mayAccess(value.definition.owner))
      .sort((a, b) => Date.parse(b.scheduledFor) - Date.parse(a.scheduledFor))
    const now = new Date().toISOString()
    return { definitions: definitions.map(definition => ({ ...definition,
      nextRunAt: definition.status === 'paused' ? null : nextOccurrence(definition.schedule, now),
      lastRun: runs.find(run => run.definition.id === definition.id) ?? null,
    })), runs, capabilities: { executionTarget: 'local', triggers: ['once', 'interval', 'daily', 'weekly'] } }
  }

  /** Save one confirmed task using the caller's execution context.
   * @param input - editable task values.
   * @param agent - creating conversation, when called by an agent tool.
   * @returns durably stored definition.
   */
  create(input: AutomationInput, agent?: Agent): Promise<AutomationDefinition> {
    const owner = agent?.session.header.owner ?? this.ctx.identityUsers.actingUser()?.id
    if (!this.ctx.identityUsers.mayAccess(owner)) return Promise.reject(new Error('Sign in to create an automation.'))
    return this.transaction(async domain => {
      const parsed = inputSchema.parse(input)
      const now = new Date().toISOString()
      if (nextOccurrence(parsed.schedule, now) === null) throw new Error('Choose a schedule with a future occurrence.')
      const id = brandString<AutomationId>(randomUUID())
      const cwd = agent?.session.header.cwd ?? avnHomePath('automations', id)
      const agentPreset = agent?.session.header.agentPreset ?? this.ctx.agentPresets.defaultId
      const model = this.ctx.agentDefaultModel.currentSelection()
      await mkdir(cwd, { recursive: true })
      const definition: AutomationDefinition = {
        ...parsed, id, ...owner === undefined ? {} : { owner }, revision: 1, status: 'active', cwd, agentPreset,
        model, createdAt: now, updatedAt: now, lastAdmittedAt: null, executionTarget: { kind: 'local', runnerId: this.runnerId(domain) },
      }
      await domain.table('definitions').put(id, definition)
      this.arm(domain)
      return definition
    })
  }

  /** Revise or pause an owned automation without changing earlier run snapshots.
   * @param id - owned definition identity.
   * @param patch - replacement editable fields or status.
   * @returns durably revised definition.
   */
  update(id: AutomationId, patch: { [K in keyof AutomationInput]?: AutomationInput[K] | undefined } & { status?: 'active' | 'paused' | undefined }): Promise<AutomationDefinition> {
    return this.transaction(async domain => {
      const current = this.owned(domain, id)
      const parsed = inputSchema.parse({ name: patch.name ?? current.name, prompt: patch.prompt ?? current.prompt, schedule: patch.schedule ?? current.schedule, permission: patch.permission ?? current.permission })
      const status = patch.status ?? current.status
      if (status !== 'active' && status !== 'paused') throw new Error('Invalid automation status.')
      const next: AutomationDefinition = { ...current, ...parsed, status, revision: current.revision + 1, updatedAt: new Date().toISOString() }
      await domain.table('definitions').put(id, next)
      this.arm(domain)
      return next
    })
  }

  /** Admit a manual run; paused tasks can be run manually.
   * @param id - owned automation identity.
   * @returns durable run admission.
   */
  runNow(id: AutomationId): Promise<AutomationRun> {
    return this.transaction(async domain => {
      const definition = this.owned(domain, id)
      const run = await this.admit(domain, definition, 'manual', new Date().toISOString())
      this.drain(domain)
      return run
    })
  }

  /** Remove an owned definition while retaining its run history.
   * @param id - owned definition identity.
   * @returns resolution after durable deletion.
   */
  remove(id: AutomationId): Promise<void> {
    return this.transaction(async domain => {
      this.owned(domain, id)
      await domain.table('definitions').delete(id)
      this.arm(domain)
    })
  }

  /** Delete the acting account's finished run history.
   * A run that is queued or running is kept, so clearing never hides work in flight.
   * @returns the number of run records removed.
   */
  clearRuns(): Promise<{ cleared: number }> {
    return this.transaction(async domain => {
      let cleared = 0
      for (const [id, run] of [...domain.table('runs').entries()]) {
        if (run.status === 'queued' || run.status === 'running') continue
        if (!this.ctx.identityUsers.mayAccess(run.definition.owner)) continue
        await domain.table('runs').delete(id)
        cleared += 1
      }
      return { cleared }
    })
  }

  /** Record the owner's explicit verification of an inactive run's actual result.
   * @param id - owned run identity.
   * @returns the durably confirmed run.
   */
  confirm(id: AutomationRunId): Promise<AutomationRun> {
    return this.transaction(async domain => {
      const run = this.ownedRun(domain, id)
      this.requireInactive(domain, run)
      if (run.resolution !== null) throw new Error('This run has already been resolved.')
      const confirmed: AutomationRun = { ...run, resolution: { kind: 'confirmed', at: new Date().toISOString(), retryRunId: null } }
      await domain.table('runs').put(id, confirmed)
      return confirmed
    })
  }

  /** Deliberately retry one unresolved failed run using its original approved task.
   * @param id - owned failed, skipped, or cancelled run identity.
   * @returns a new linked admission; no earlier conversation or grant is inherited.
   */
  retry(id: AutomationRunId): Promise<AutomationRun> {
    return this.transaction(async domain => {
      const original = this.ownedRun(domain, id)
      this.requireInactive(domain, original)
      if (original.status === 'succeeded' || original.resolution !== null) throw new Error('Choose an unresolved failed run.')
      if ([...domain.table('runs').entries()].some(([, run]) => run.retryOfRunId === id)) throw new Error('This run already has a linked retry. Inspect that retry first.')
      const retry = await this.admit(domain, original.definition, 'manual', new Date().toISOString(), id)
      await domain.table('runs').put(id, { ...original, resolution: { kind: 'retried', at: retry.scheduledFor, retryRunId: retry.id } })
      this.drain(domain)
      return retry
    })
  }

  private ownedRun(domain: Domain<typeof automationDomain>, id: AutomationRunId): AutomationRun {
    const run = domain.table('runs').get(id)
    if (run === undefined || !this.ctx.identityUsers.mayAccess(run.definition.owner)) throw new Error('Run not found.')
    return run
  }

  private requireInactive(domain: Domain<typeof automationDomain>, run: AutomationRun): void {
    if ([...domain.table('runs').entries()].some(([, value]) => value.definition.id === run.definition.id && (value.status === 'queued' || value.status === 'running'))) throw new Error('Wait for the active run to finish.')
  }

  private runnerId(domain: Domain<typeof automationDomain>): AutomationRunnerId {
    const runner = domain.table('runners').get('local')
    if (runner === undefined) throw new Error('Automation execution target is unavailable.')
    return runner.id
  }

  private async advanceAdmission(domain: Domain<typeof automationDomain>, id: AutomationId, at: string): Promise<void> {
    const definition = domain.table('definitions').get(id)
    if (definition === undefined || (definition.lastAdmittedAt !== null && Date.parse(definition.lastAdmittedAt) >= Date.parse(at))) return
    await domain.table('definitions').put(id, { ...definition, lastAdmittedAt: at })
  }

  private async prune(domain: Domain<typeof automationDomain>): Promise<void> {
    const counts = new Map<string | undefined, number>()
    const completed = [...domain.table('runs').entries()].map(([, run]) => run).filter(run => run.status !== 'queued' && run.status !== 'running')
      .sort((a, b) => Date.parse(b.scheduledFor) - Date.parse(a.scheduledFor))
    for (const run of completed) {
      const count = (counts.get(run.definition.owner) ?? 0) + 1
      counts.set(run.definition.owner, count)
      if (count > this.config.historyLimit) await domain.table('runs').delete(run.id)
    }
  }

  private owned(domain: Domain<typeof automationDomain>, id: AutomationId): AutomationDefinition {
    const value = domain.table('definitions').get(id)
    if (value === undefined || !this.ctx.identityUsers.mayAccess(value.owner)) throw new Error('Automation not found.')
    return value
  }

  private transaction<T>(work: (domain: Domain<typeof automationDomain>) => Promise<T>): Promise<T> {
    const result = this.tail.then(async () => {
      if (this.stopped) throw new Error('Automation Host is stopping.')
      return work(await this.ready)
    })
    this.tail = result.catch(() => undefined)
    return result
  }

  private async dispatch(endpoint: string, payload: unknown): Promise<unknown> {
    const input = payload as Record<string, unknown>
    switch (endpoint) {
      case 'list': return this.list()
      case 'clear': return this.clearRuns()
      case 'create': return this.create(inputSchema.parse(payload))
      case 'update': {
        if (typeof input?.id !== 'string' || input.patch === null || typeof input.patch !== 'object') throw new Error('Invalid automation update.')
        return this.update(brandString<AutomationId>(input.id), patchSchema.parse(input.patch))
      }
      case 'confirm':
      case 'retry': {
        if (typeof input?.id !== 'string') throw new Error('Choose a run.')
        const id = brandString<AutomationRunId>(input.id)
        return endpoint === 'confirm' ? this.confirm(id) : this.retry(id)
      }
      case 'run':
      case 'delete': {
        if (typeof input?.id !== 'string') throw new Error('Choose an automation.')
        const id = brandString<AutomationId>(input.id)
        if (endpoint === 'run') return this.runNow(id)
        await this.remove(id)
        return { deleted: true }
      }
      default: throw new Error('Unknown automation operation.')
    }
  }

  private arm(domain: Domain<typeof automationDomain>): void {
    clearTimeout(this.timer)
    if (this.stopped) return
    const now = new Date().toISOString()
    const due = [...domain.table('definitions').entries()].flatMap(([, value]) => {
      if (value.status !== 'active') return []
      const latest = latestDueOccurrence(value.schedule, now)
      const key = latest === null ? undefined : this.occurrenceId(value.id, latest)
      if (latest !== null && Date.parse(latest) > Math.max(Date.parse(value.updatedAt), value.lastAdmittedAt === null ? -Infinity : Date.parse(value.lastAdmittedAt)) && key !== undefined && domain.table('runs').get(key) === undefined) return [Date.now()]
      const next = nextOccurrence(value.schedule, now)
      return next === null ? [] : [Date.parse(next)]
    })
    if (due.length === 0) return
    this.timer = setTimeout(() => {
      void this.transaction(async current => {
        const at = new Date().toISOString()
        for (const [, definition] of current.table('definitions').entries()) {
          if (definition.status !== 'active') continue
          const occurrence = latestDueOccurrence(definition.schedule, at)
          if (occurrence === null || Date.parse(occurrence) <= Math.max(Date.parse(definition.updatedAt), definition.lastAdmittedAt === null ? -Infinity : Date.parse(definition.lastAdmittedAt))) continue
          const id = this.occurrenceId(definition.id, occurrence)
          if (current.table('runs').get(id) === undefined) await this.admit(current, definition, 'schedule', occurrence)
        }
        this.drain(current)
        this.arm(current)
      }).catch(error => { this.stopped = true; clearTimeout(this.timer); this.ctx.logger.error(error) })
    }, Math.min(2_147_483_647, Math.max(0, Math.min(...due) - Date.now())))
  }

  private occurrenceId(id: AutomationId, at: string): AutomationRunId {
    return brandString<AutomationRunId>(createHash('sha256').update(`${id}:${at}`).digest('hex'))
  }

  private async admit(domain: Domain<typeof automationDomain>, definition: AutomationDefinition, trigger: 'schedule' | 'manual', scheduledFor: string, retryOfRunId: AutomationRunId | null = null): Promise<AutomationRun> {
    if (definition.executionTarget.runnerId !== this.runnerId(domain)) throw new Error('This automation belongs to another execution target.')
    const overlapping = [...domain.table('runs').entries()].some(([, run]) => run.definition.id === definition.id && (run.status === 'queued' || run.status === 'running'))
    const stale = trigger === 'schedule' && Date.now() - Date.parse(scheduledFor) > this.config.misfireGraceMinutes * 60_000
    const skipped = overlapping || stale
    const run: AutomationRun = {
      id: trigger === 'manual' ? brandString<AutomationRunId>(randomUUID()) : this.occurrenceId(definition.id, scheduledFor), definition,
      trigger, scheduledFor, status: skipped ? 'skipped' : 'queued', sessionId: null, startedAt: null,
      finishedAt: skipped ? new Date().toISOString() : null, summary: null,
      error: overlapping ? 'A previous run is still active.' : stale ? 'Missed while this computer was unavailable.' : null,
      admittedBy: this.runnerId(domain), retryOfRunId, resolution: null,
    }
    await domain.table('runs').put(run.id, run)
    if (trigger === 'schedule') await this.advanceAdmission(domain, definition.id, scheduledFor)
    await this.prune(domain)
    return run
  }

  private drain(domain: Domain<typeof automationDomain>): void {
    if (this.stopped) return
    for (const [, run] of domain.table('runs').entries()) {
      if (this.active.size >= this.config.maxConcurrentRuns) return
      if (run.status !== 'queued' || this.active.has(run.id)) continue
      const entry: { promise: Promise<void>; handle?: AgentHandle } = { promise: Promise.resolve() }
      this.active.set(run.id, entry)
      entry.promise = this.ctx.identityUsers.runAs(run.definition.owner === undefined ? undefined : { id: run.definition.owner }, () => this.execute(domain, run, entry)).catch(error => { this.stopped = true; clearTimeout(this.timer); this.ctx.logger.error(error) }).finally(() => {
        this.active.delete(run.id)
        this.drain(domain)
      })
    }
  }

  private async execute(domain: Domain<typeof automationDomain>, run: AutomationRun, entry: { handle?: AgentHandle }): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined
    let timedOut = false
    const sessionId = SessionId(`session-${randomUUID()}`)
    const startedAt = new Date().toISOString()
    const running: AutomationRun = { ...run, status: 'running', sessionId, startedAt }
    await domain.table('runs').put(run.id, running)
    this.executionSessions.add(sessionId)
    try {
      const preset = await this.ctx.agentPresets.resolve(run.definition.agentPreset)
      const handle = await this.ctx.agents.withoutInitiator(() => this.ctx.agents.create({
        sessionId, meta: { cwd: run.definition.cwd, agentPreset: preset.id, ...run.definition.owner === undefined ? {} : { owner: run.definition.owner } },
        agentOptions: { provider: run.definition.model.provider, model: run.definition.model.model },
        setup: async agentCtx => {
          await this.ctx.agentPresets.mount(agentCtx, preset.id)
          installModelSelection(agentCtx, { current: run.definition.model, assembled: undefined })
          const agent = agentCtx.agent
          if (agent === undefined) throw new Error('Automation agent was not created.')
          this.ctx.permissionPresets.set(agent.session, run.definition.permission)
          setApprovalPolicy(agent.session, 'never')
          agentCtx.tools.guard(exec => exec.name.startsWith('automation_') || exec.name === 'ask_user' ? 'Automations cannot create more unattended work or ask interactive questions.' : undefined)
        },
      }))
      entry.handle = handle
      if (this.stopped) throw new Error('Automation Host is stopping.')
      const workspace = await this.ctx.workspaceRegistry.create(run.definition.cwd, undefined, run.definition.owner)
      await workspace.attachSession(sessionId)
      await handle.agent.whenIdle()
      handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: `Automation: ${run.definition.name}\nRun: ${run.id}\nScheduled for: ${run.scheduledFor}\n\n${run.definition.prompt}\n\nReport completed work with evidence. Do not claim an external action succeeded without confirmation.` }], source: { kind: 'plugin', plugin: 'automations', form: 'notice', summary: boundContextSummary(run.definition.name) } }))
      timeout = setTimeout(() => { timedOut = true; handle.agent.cancel({ kind: 'user' }) }, this.config.runTimeoutMinutes * 60_000)
      await handle.agent.whenIdle()
      await this.ctx.sessions.flush(handle.agent.session)
      const events = handle.agent.session.snapshotEvents()
      const end = [...events].reverse().find(event => event.type === 'turn/end')
      const messages = events.filter(event => event.type === 'assistant/message')
      const last = messages.at(-1)
      const summary = last?.type === 'assistant/message' ? last.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n') : null
      const completed = end?.type === 'turn/end' && end.data.reason.kind === 'completed'
      await domain.table('runs').put(run.id, { ...running, status: completed && !timedOut ? 'succeeded' : this.stopped ? 'cancelled' : 'failed',
        finishedAt: new Date().toISOString(), summary, error: timedOut ? 'Execution timed out.' : completed ? null : 'Execution did not complete; inspect its conversation.' })
    } catch (error) {
      await domain.table('runs').put(run.id, { ...running, status: 'failed', finishedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) })
    } finally {
      clearTimeout(timeout)
      await entry.handle?.dispose()
      this.executionSessions.delete(sessionId)
      await this.prune(domain)
    }
  }
}
export default Automations
