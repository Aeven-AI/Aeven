/**
 * Built-in bot authority: durable admission from every trigger, owner-scoped agents, connector binding, grants, boards,
 * handoffs, and run history.
 */
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { randomUUID, createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { installModelSelection, type Agent, type AgentHandle } from '@aeven/agent'
import type {} from '@aeven/agent-default-model'
import type {} from '@aeven/agent-presets'
import type {} from '@aeven/identity-user'
import type {} from '@aeven/permission-presets'
import type {} from '@aeven/session-title'
import type {} from '@aeven/session-handoff'
import type { Workspace } from '@aeven/workspace'
import type {} from '@aeven/mail'
import type {} from '@aeven/client-connection'
import type {} from '@aeven/host-webserver'
import { brandString } from '@aeven/brand'
import { boundContextSummary, createUserMessage, type TokenUsage } from '@aeven/llm'
import { SessionId, SessionSeq, type Session } from '@aeven/session'
import { LeaseHolder } from '@aeven/sync'
import type { Domain } from '@aeven/storage-domain'
import { setApprovalPolicy, type ApprovalRequestId } from '@aeven/user-approval'
import { automationDomain, webhookDomain, inputSchema, patchSchema, boardInputSchema, CONNECTOR_IDS } from './domain.ts'
import { connectorRefusal } from './connectors.ts'
import { matchesGitHub, summarizeGitHub, verifiesGitHub } from './github.ts'
import { describeMail, matchesMail, newMail } from './mail-events.ts'
import { runNotice } from './notice.ts'
import { registerRunTools } from './run-tools.ts'
import { eligibility, placementMode, placementRefusal, resolvePlacement } from './placement.ts'
import { latestDueOccurrence, nextOccurrence, SCHEDULE_KINDS } from './recurrence.ts'
import { DefinitionSync, type CloudRunRequest, type RecordKinds, type SyncedDefinition, type SyncedRecord } from './sync.ts'
import { registerAutomationTools } from './tools.ts'
import type { AutomationBoard, AutomationDefinition, AutomationDesktop, AutomationId, AutomationInput, AutomationPlacement, AutomationRun, AutomationRunId, AutomationRunnerId, AutomationSchedule, AutomationTrigger, BoardId, BoardInput, BotTrigger, ConnectorBinding, DeviceCapability, Handoff, HandoffId, HostDevice, HostProfile, RunUsage } from './types.ts'

export type * from './types.ts'

/** Absolute path prefix of the inbound trigger endpoint; one automation per trailing segment. */
const WEBHOOK_PATH = '/automation-webhook'
/**
 * Brand the desktop of validated management input.
 * @param input - input that passed {@link inputSchema}.
 * @returns the same input with its desktop typed as a vault device id.
 */
function withDesktop<T extends { desktop?: string | undefined }>(input: T): Omit<T, 'desktop'> & { desktop?: HostDevice } {
  const { desktop, ...rest } = input
  return desktop === undefined ? rest : { ...rest, desktop: brandString<HostDevice>(desktop) }
}

/** Error recorded on a run its owner stopped. */
const STOPPED = 'Stopped by its owner.'

/** One run executing on this Host; `stopRequested` marks an owner's stop that lands before or during its turn. */
interface ActiveRun {
  /** The account the run belongs to; its concurrency counts against this account only. */
  owner: string | undefined
  /** The bot the run belongs to; its overlap policy reads the runs in progress. */
  definition: AutomationId
  promise: Promise<void>
  handle?: AgentHandle
  stopRequested?: boolean
}

/** Refusal of one inbound request, carrying the status the endpoint answers with. */
class WebhookRefusal extends Error {
  /**
   * @param status - HTTP status to answer with.
   * @param message - client-facing reason; it names no record the caller may not address.
   */
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

/** Write one JSON response.
 * @param res - response that owns its own lifecycle.
 * @param status - HTTP status.
 * @param body - JSON-serializable payload.
 */
function reply(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

/** Read the bearer credential of an inbound request.
 * @param header - raw `authorization` header value.
 * @returns the presented key, or undefined when the header is absent or not a bearer credential.
 */
function bearerCredential(header: string | undefined): string | undefined {
  if (header === undefined) return undefined
  const [scheme, value] = header.split(' ')
  return scheme?.toLowerCase() === 'bearer' && value !== undefined && value !== '' ? value : undefined
}

/** Compare a presented key with the stored secret in constant time.
 * @param secret - stored credential.
 * @param presented - credential the caller presented.
 * @returns whether they are the same bytes.
 */
function matchesSecret(secret: string, presented: string): boolean {
  const expected = Buffer.from(secret)
  const actual = Buffer.from(presented)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

/** Read one request body up to a byte ceiling.
 * An oversized body is drained without being retained, so the ceiling bounds
 * memory rather than the client's upload.
 * @param req - inbound request.
 * @param res - response to answer on when the body exceeds the ceiling.
 * @param limit - largest accepted body in bytes.
 * @returns the accepted body, or null when this call already answered 413.
 */
async function readCappedBody(req: IncomingMessage, res: ServerResponse, limit: number): Promise<Buffer | null> {
  const declared = Number(req.headers['content-length'])
  if (Number.isFinite(declared) && declared > limit) {
    req.resume()
    reply(res, 413, { error: `The request body must not exceed ${limit} bytes.` })
    return null
  }
  const chunks: Buffer[] = []
  let size = 0
  let overflow = false
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > limit) { overflow = true; chunks.length = 0; continue }
    chunks.push(buffer)
  }
  if (overflow) {
    reply(res, 413, { error: `The request body must not exceed ${limit} bytes.` })
    return null
  }
  return Buffer.concat(chunks)
}

/** Sum a run conversation's token accounting over its model calls.
 * @param events - the conversation's events.
 * @returns the run's usage; zero when no adapter reported any.
 */
function usageOf(events: readonly { type: string; data?: unknown }[]): RunUsage {
  let inputTokens = 0
  let outputTokens = 0
  let totalTokens = 0
  for (const event of events) {
    if (event.type !== 'assistant/message') continue
    const usage = (event.data as { usage?: TokenUsage }).usage
    if (usage === undefined) continue
    const input = usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
    inputTokens += input
    outputTokens += usage.outputTokens
    totalTokens += usage.totalTokens ?? input + usage.outputTokens
  }
  return { inputTokens, outputTokens, totalTokens }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Durable local automations and their execution history. */
    automations: Automations
  }
}
/** Deployment limits for unattended local agent work. */
export interface Config {
  /**
   * Most runs of one account that may execute at once on this Host; that account's next queued run starts when one
   * of them finishes. Each account counts only its own runs. Absent, every queued run starts at once.
   */
  readonly maxConcurrentRunsPerAccount?: number
  /** Budget of one run in minutes, counted from its start; a run still active at the deadline is cancelled. */
  readonly runTimeoutMinutes: number
  /**
   * Grace in minutes after a scheduled instant during which that occurrence may still start; a later one
   * is admitted as skipped, and `0` skips any occurrence whose instant has passed.
   */
  readonly misfireGraceMinutes: number
  /** Finished run records kept per owner; older ones are archived and removed, while queued and running records are never pruned. */
  readonly historyLimit: number
  /** Display title of the built-in workspace that holds every run conversation. */
  readonly workspaceTitle: string
  /**
   * Largest inbound trigger request accepted, in bytes. A larger request is refused
   * before it is read, and the accepted body becomes the run's untrusted payload.
   */
  readonly webhookMaxBodyBytes: number
  /**
   * Largest GitHub delivery accepted on a bot's GitHub endpoint, in bytes. The run reads a summary of the delivery
   * cut at `webhookMaxBodyBytes` characters, never the whole body.
   */
  readonly githubMaxBodyBytes: number
  /** Most occurrences of one `overlap: queue` bot that wait at once; a further one is recorded as skipped. */
  readonly queueDepth: number
  /** Days a saved approval answers before the next run asks again; absent saves approvals without an end. */
  readonly grantLifetimeDays?: number
  /** Seconds between two checks of a watched mail account for new email; each check is a search, not a model turn. */
  readonly mailPollSeconds: number
  /**
   * What this Host is and which device capabilities its runs can use. A `cloud` Host runs the definitions that
   * need nothing from a computer; a `device` Host runs the ones whose requirements it provides.
   */
  readonly placement: {
    /** `cloud` for a Host on Aeven's infrastructure, `device` for one on the owner's computer. */
    readonly kind: HostProfile['kind']
    /** The device capabilities runs on this Host can use: any of `files`, `browser`, and `computer-use`. */
    readonly provides: DeviceCapability[]
  }
  /** How this device claims one automation for its scheduled runs while account sync serves its owner. */
  readonly sync: {
    /** Lifetime requested on each renewal of an automation's claim, in milliseconds. */
    readonly leaseTtlMs: number
    /** Interval between renewals of that claim, in milliseconds. */
    readonly leaseRenewMs: number
    /**
     * How long after a scheduled instant a `device` Host waits before it admits a run that the account's
     * cloud Host should have admitted, in milliseconds.
     */
    readonly fallbackDelayMs: number
  }
}
/** Built-in automation service; schedules never authorize additional tool access. */
export class Automations extends Service<Config> {
  static inject = ['storageDomain', 'agents', 'sessions', 'agentDefaultModel', 'agentPresets', 'permissionPresets', 'workspaceRegistry', 'identityUsers', 'connection', 'webServer', 'tools', 'sessionTitle']
  static Config = z.object({
    maxConcurrentRunsPerAccount: z.number().step(1).min(1), runTimeoutMinutes: z.number().min(1).required(),
    misfireGraceMinutes: z.number().min(0).required(), historyLimit: z.number().step(1).min(1).required(),
    workspaceTitle: z.string().required(), webhookMaxBodyBytes: z.number().step(1).min(1).required(),
    githubMaxBodyBytes: z.number().step(1).min(1).default(1_048_576),
    queueDepth: z.number().step(1).min(1).default(5),
    grantLifetimeDays: z.number().min(1),
    mailPollSeconds: z.number().step(1).min(30).default(120),
    placement: z.object({
      kind: z.union(['cloud', 'device'] as const).required(),
      provides: z.array(z.union(['files', 'browser', 'computer-use'] as const)).required(),
    }).required(),
    sync: z.object({
      leaseTtlMs: z.natural().min(1_000).default(180_000),
      leaseRenewMs: z.natural().min(100).default(60_000),
      fallbackDelayMs: z.natural().default(120_000),
    }).default({ leaseTtlMs: 180_000, leaseRenewMs: 60_000, fallbackDelayMs: 120_000 }),
  })
  private readonly ready: Promise<Domain<typeof automationDomain>>
  private readonly hooks: Promise<Domain<typeof webhookDomain>>
  private tail: Promise<unknown> = Promise.resolve()
  private timer: ReturnType<typeof setTimeout> | undefined
  private stopped = false
  private readonly executionSessions = new Set<SessionId>()
  /** The connector binding of each run conversation while its run executes. */
  private readonly bindings = new Map<SessionId, ConnectorBinding>()
  private readonly active = new Map<AutomationRunId, ActiveRun>()
  private readonly synced: DefinitionSync
  /** This device's claim on each automation's scheduled runs, by account and automation. */
  private readonly leases = new Map<string, LeaseHolder>()
  /** The due occurrence of each automation another device holds the claim for; it waits for a lease change. */
  private readonly deferred = new Map<AutomationId, string>()
  /** This device's vault id per account, as account sync last reported it. */
  private readonly devices = new Map<string, HostDevice>()

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'automations')
    this.synced = new DefinitionSync(
      ctx,
      (id, entry) => { this.applySynced(id, entry) },
      (message) => { ctx.logger.warn(message) },
      async (owner, present) => {
        const domain = await this.ready
        for (const [id, definition] of domain.table('definitions').entries()) {
          if (definition.owner === owner && !present.definitions.has(id)) await this.synced.publish(owner, definition)
        }
        for (const [id, board] of domain.table('boards').entries()) {
          if (board.owner === owner && !present.boards.has(id)) await this.synced.publishRecord(owner, 'boards', id, board, Date.parse(board.updatedAt))
        }
        for (const [id, handoff] of domain.table('handoffs').entries()) {
          if (handoff.owner === owner && !present.handoffs.has(id)) await this.synced.publishRecord(owner, 'handoffs', id, handoff, Date.parse(handoff.updatedAt))
        }
      },
      async owner => ({ id: this.runnerId(await this.ready), profile: this.here(owner) }),
      // Another Host of the account changes which of them runs a definition; the scheduler looks again.
      () => { this.rearm() },
      (owner, id, request) => { this.receiveCloudRun(owner, id, request) },
      (owner, run) => {
        void this.transaction(async (domain) => {
          if (run.admittedBy === this.runnerId(domain) || run.definition.owner !== owner) return
          await domain.table('runs').put(run.id, run)
        }).catch((error: unknown) => { ctx.logger.warn(`automations: the cloud result was not stored: ${String(error)}`) })
      },
      (kind, id, entry) => { this.applyRecord(kind, id, entry) },
    )
    // Inbound secrets open before definitions, so a rejected trigger record cannot
    // leave the definition domain open without its owner.
    this.hooks = ctx.storageDomain.open(webhookDomain)
    this.ready = ctx.storageDomain.open(automationDomain).then(async (domain) => {
      if (domain.table('runners').get('local') === undefined) await domain.table('runners').put('local', { id: brandString<AutomationRunnerId>(randomUUID()) })
      // Every run conversation belongs to the Automations workspace, including one a crash left unattached.
      const workspace = await this.workspace()
      for (const [, { sessionId }] of domain.table('runs').entries()) {
        if (sessionId === null || workspace.sessionIds.includes(sessionId)) continue
        const holder = ctx.workspaceRegistry.list().find(candidate => candidate.sessionIds.includes(sessionId))
        if (holder?.path !== undefined) continue
        await holder?.detachSession(sessionId)
        await workspace.attachSession(sessionId).catch((error: unknown) => { ctx.logger.warn(`automations: run conversation ${sessionId} stays outside the Automations workspace: ${String(error)}`) })
      }
      // A conversation whose run record is gone is removed history, so it stays out of the sidebar.
      const recorded = new Set([...domain.table('runs').entries()].map(([, run]) => run.sessionId))
      for (const sessionId of workspace.sessionIds) {
        if (recorded.has(sessionId) || ctx.workspaceRegistry.archivedSessionIds.includes(sessionId)) continue
        await ctx.workspaceRegistry.archiveSession(sessionId).catch((error: unknown) => { ctx.logger.warn(`automations: run conversation ${sessionId} was not archived: ${String(error)}`) })
      }
      for (const [id, run] of domain.table('runs').entries()) {
        if (run.admittedBy === this.runnerId(domain) && (run.status === 'queued' || run.status === 'running')) await domain.table('runs').put(id, {
          ...run, status: 'failed', finishedAt: new Date().toISOString(), error: 'Execution was interrupted. External changes may already exist; inspect the conversation before retrying.',
        })
        if (run.trigger === 'schedule') await this.advanceAdmission(domain, run.definition.id, run.triggerIndex ?? 0, run.scheduledFor)
      }
      // A handoff whose run this Host lost to a restart fails with it rather than waiting forever.
      for (const [, handoff] of domain.table('handoffs').entries()) {
        const run = handoff.run === null ? undefined : domain.table('runs').get(handoff.run)
        if (handoff.status === 'claimed' && run !== undefined && run.status !== 'queued' && run.status !== 'running') {
          await this.storeHandoff(domain, { ...handoff, status: run.status === 'succeeded' ? 'done' : 'failed', result: run.summary, reason: run.error, updatedAt: new Date().toISOString() })
        }
      }
      for (const [, run] of domain.table('runs').entries()) {
        if (run.retryOfRunId !== null) {
          const original = domain.table('runs').get(run.retryOfRunId)
          if (original !== undefined && original.resolution === null) await domain.table('runs').put(original.id, { ...original, resolution: { kind: 'retried', at: run.scheduledFor, retryRunId: run.id } })
        }
      }
      await this.prune(domain)
      // A removal interrupted between the two domains leaves a secret with no definition.
      const hooks = await this.hooks
      for (const [id] of [...hooks.table('webhooks').entries()]) {
        if (domain.table('definitions').get(id) === undefined) await hooks.table('webhooks').delete(id)
      }
      return domain
    })
    ctx.effect(async () => {
      const [domain, hooks] = [await this.ready, await this.hooks]
      this.arm(domain)
      this.pumpHandoffs()
      const polls = new AbortController()
      const mailTimer = setInterval(() => { void this.pollMail(polls.signal) }, this.config.mailPollSeconds * 1_000)
      return async () => {
        this.stopped = true
        clearTimeout(this.timer)
        clearInterval(mailTimer)
        polls.abort()
        await this.tail
        for (const entry of this.active.values()) entry.handle?.agent.cancel({ kind: 'user' })
        await Promise.allSettled([...this.active.values()].map(entry => entry.promise))
        await domain.close()
        await hooks.close()
      }
    })
    // Each account's automations follow it to every device its sync vault holds, once that vault is served here.
    this.ctx.on('sync/status', (owner) => {
      void this.synced.attach(owner)
      // A bot placed on one desktop becomes due here once account sync names this device.
      const device = this.ctx.get('sync')?.status(owner).device
      if (device !== undefined && this.devices.get(owner) !== device) {
        this.devices.set(owner, device)
        void this.synced.reregister(owner).catch((error: unknown) => { ctx.logger.warn(`automations: this device's profile was not updated: ${String(error)}`) })
        this.rearm()
      }
    })
    this.ctx.on('sync/reset', (owner) => { void this.synced.reset(owner) })
    this.ctx.effect(() => async () => {
      await this.synced.dispose()
      await Promise.all([...this.leases.values()].map(holder => holder.dispose()))
      this.leases.clear()
    }, 'automations.sync')
    ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: WEBHOOK_PATH, handler: (req, res) => this.answerWebhook(req, res) }), 'automations: inbound trigger')
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
    ctx.on('agent/created', ({ agent }) =>{  installTools(agent) })
    // An approval the owner gave once in a run conversation answers the same request in every later run.
    ctx.on('approval/request', async (req, next) => {
      const scope = req.allowSession
      if (scope === undefined) return next()
      const definition = this.definitionOf(await this.ready, req.agent.session.id)
      const now = Date.now()
      return definition?.grants.some(grant => grant.toolName === req.toolName && grant.scope === scope && (grant.expiresAt === undefined || Date.parse(grant.expiresAt) > now)) ? 'allowed-session' : next()
    }, { prepend: true })
    ctx.on('session/event', (session, event) => {
      if (event.type !== 'approval/decided' || event.data.outcome !== 'allowed-once') return
      this.rememberGrant(session, event.data.id).catch((error: unknown) => { ctx.logger.warn(`automations: an approval was not saved for later runs: ${String(error)}`) })
    })
    ctx.on('tools/pre-execute', async (exec, next) => {
      const decision = await next()
      if (decision.kind !== 'allow' || !exec.name.startsWith('automation_')) return decision
      if (exec.name === 'automation_board') {
        const args = exec.arguments as Record<string, unknown>
        if (args.action === 'remove') return decision
        return { kind: 'ask', reason: 'Confirm which bots share this board and its budget.' }
      }
      if (exec.name === 'automation_create' || exec.name === 'automation_update' || exec.name === 'automation_retry') {
        const args = exec.arguments as Record<string, unknown>
        if (exec.name === 'automation_update' && args.status === 'paused' && Object.keys(args).every(key => key === 'id' || key === 'status')) return decision
        return { kind: 'ask', reason: exec.name === 'automation_retry'
          ? 'Inspect the earlier run before retrying: external changes may already exist.'
          : 'Confirm this automation’s task, triggers, connectors, and allowed file access before enabling unattended work.' }
      }
      return decision
    })
  }

  /** Read the acting account's definitions, newest created first, and bounded execution history, newest scheduled first.
   * History leaves out runs whose conversation is archived, so it lists what the sidebar's Automations
   * workspace shows; unarchiving the conversation lists the run again. Each definition's `lastRun` is its
   * latest retained run either way.
   * @returns owned definitions, latest run records, the account's boards with the handoffs between their members,
   * and this Host's kind and the triggers it evaluates. A definition's `placement` says where it runs among the
   * account's registered Hosts, its `nextRunAt` is the earliest next occurrence of its schedule triggers, and its
   * `webhook` says an inbound credential exists; the secret itself never enters this projection.
   */
  async list(): Promise<{
    definitions: (AutomationDefinition & {
      placement: AutomationPlacement
      nextRunAt: string | null
      lastRun: AutomationRun | null
      webhook: boolean
    })[]
    runs: AutomationRun[]
    boards: AutomationBoard[]
    handoffs: Handoff[]
    capabilities: { host: HostProfile['kind']; triggers: readonly AutomationSchedule['kind'][]; webhook: boolean; events: readonly ('mail' | 'github')[]; connectors: readonly string[] }
    hosts: { cloud: boolean; desktops: AutomationDesktop[] }
  }> {
    const domain = await this.ready
    const hooks = await this.hooks
    const definitions = [...domain.table('definitions').entries()].map(([, value]) => value).filter(value => this.ctx.identityUsers.mayAccess(value.owner))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    const runs = this.runs(domain).filter(value => this.ctx.identityUsers.mayAccess(value.definition.owner))
      .sort((a, b) => Date.parse(b.scheduledFor) - Date.parse(a.scheduledFor))
    const archived = new Set(this.ctx.workspaceRegistry.archivedSessionIds)
    const now = new Date().toISOString()
    const boards = [...domain.table('boards').entries()].map(([, board]) => board).filter(board => this.ctx.identityUsers.mayAccess(board.owner))
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    const handoffs = [...domain.table('handoffs').entries()].map(([, handoff]) => handoff).filter(handoff => this.ctx.identityUsers.mayAccess(handoff.owner))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, this.config.historyLimit)
    return { definitions: definitions.map(definition => ({ ...definition,
      placement: resolvePlacement(definition, this.hostsOf(definition.owner)),
      nextRunAt: definition.status === 'paused' ? null : this.nextRunAt(definition, now),
      lastRun: runs.find(run => run.definition.id === definition.id) ?? null,
      webhook: hooks.table('webhooks').get(definition.id) !== undefined,
    })), runs: runs.filter(run => run.sessionId === null || !archived.has(run.sessionId)),
    boards, handoffs,
    capabilities: { host: this.config.placement.kind, triggers: SCHEDULE_KINDS, webhook: true, events: ['mail', 'github'], connectors: CONNECTOR_IDS },
    hosts: this.accountHosts(this.ctx.identityUsers.actingUser()?.id) }
  }

  /** The earliest next occurrence of a definition's schedule triggers, or null when none recurs again. */
  private nextRunAt(definition: AutomationDefinition, now: string): string | null {
    const next = definition.triggers.flatMap(trigger => trigger.kind === 'schedule' ? [nextOccurrence(trigger.schedule, now)] : [])
      .filter((value): value is string => value !== null).sort((a, b) => Date.parse(a) - Date.parse(b))
    return next[0] ?? null
  }

  /**
   * Where the acting account's bots can be placed: whether it has registered a cloud Host, and its desktops.
   * @param owner - the acting account, or undefined without one.
   * @returns this desktop first when this Host is one, then the account's other desktops as account sync lists
   * them; each desktop carries what its registered Host offers bots.
   */
  private accountHosts(owner: string | undefined): { cloud: boolean; desktops: AutomationDesktop[] } {
    const hosts = this.hostsOf(owner)
    const cloud = hosts.some(host => host.kind === 'cloud')
    const devices = owner === undefined ? undefined : this.ctx.get('sessionHandoff')?.devicesOf(owner)
    if (devices === undefined) return { cloud, desktops: [] }
    const offers = (device: string): readonly DeviceCapability[] | undefined =>
      hosts.find(host => host.kind === 'device' && host.device === device)?.provides
    const others = devices.desktops.map((desktop): AutomationDesktop => ({
      device: desktop.device as HostDevice, name: desktop.name, present: desktop.present,
      ...desktop.seenAt === undefined ? {} : { seenAt: desktop.seenAt }, self: false, provides: offers(desktop.device),
    }))
    if (devices.alwaysOnHere) return { cloud, desktops: others }
    const self: AutomationDesktop = {
      device: devices.device as HostDevice, name: devices.name, present: true, self: true, provides: this.config.placement.provides,
    }
    return { cloud, desktops: [self, ...others] }
  }

  /**
   * The connectors a conversation may use while it executes a bot's run, so a connector provider can leave the
   * others unmounted; the run's tool guard refuses them either way.
   * @param sessionId - any conversation.
   * @returns the bot's binding while the conversation executes a run, otherwise undefined.
   */
  connectorBinding(sessionId: SessionId): ConnectorBinding | undefined {
    return this.bindings.get(sessionId)
  }

  /** Give one owned automation an inbound webhook trigger and its credential, keeping an existing credential.
   * @param id - owned definition identity.
   * @returns the credential path and key to show once; the key is never listed again.
   */
  async enableWebhook(id: AutomationId): Promise<{ path: string; keyId: string; secret: string }> {
    const current = this.owned(await this.ready, id)
    if (!current.triggers.some(trigger => trigger.kind === 'webhook')) {
      await this.update(id, { triggers: [...current.triggers, { kind: 'webhook', idempotency: 'none' }] })
    }
    return this.credential(current.id)
  }

  /** The inbound credential of one definition, created when it has none.
   * @param id - a definition this call's caller already resolved as owned.
   * @returns the credential path and key.
   */
  private async credential(id: AutomationId): Promise<{ path: string; keyId: string; secret: string }> {
    const hooks = await this.hooks
    const existing = hooks.table('webhooks').get(id)
    if (existing !== undefined) return { path: this.webhookPath(id), keyId: existing.keyId, secret: existing.secret }
    const secret = randomBytes(24).toString('base64url')
    await hooks.table('webhooks').put(id, { secret, keyId: secret.slice(0, 6), createdAt: new Date().toISOString(), lastDeliveredAt: null })
    return { path: this.webhookPath(id), keyId: secret.slice(0, 6), secret }
  }

  /**
   * Keep one definition's inbound credential in step with its triggers: a webhook or GitHub event trigger needs it,
   * and a definition with neither holds none.
   * @param definition - the stored definition.
   */
  private async alignCredential(definition: AutomationDefinition): Promise<void> {
    const needs = definition.triggers.some(trigger => trigger.kind === 'webhook' || (trigger.kind === 'event' && trigger.source === 'github'))
    if (needs) { await this.credential(definition.id); return }
    await (await this.hooks).table('webhooks').delete(definition.id)
  }

  /** Replace one owned automation's inbound credential, invalidating the previous key.
   * @param id - owned definition identity.
   * @returns the credential path and the replacement key.
   */
  async rotateWebhook(id: AutomationId): Promise<{ path: string; keyId: string; secret: string }> {
    const definition = this.owned(await this.ready, id)
    const hooks = await this.hooks
    await hooks.table('webhooks').delete(definition.id)
    return this.credential(definition.id)
  }

  /** Remove one owned automation's inbound webhook trigger; its credential goes too unless a GitHub trigger uses it.
   * @param id - owned definition identity.
   * @returns resolution after the trigger is gone; a later bearer request is refused.
   */
  async disableWebhook(id: AutomationId): Promise<void> {
    const definition = this.owned(await this.ready, id)
    await this.update(definition.id, { triggers: definition.triggers.filter(trigger => trigger.kind !== 'webhook') })
  }

  /** Read one owned automation's inbound credential for display.
   * @param id - owned definition identity.
   * @returns the credential path and key; refused when the automation has none.
   */
  async webhookSecret(id: AutomationId): Promise<{ path: string; keyId: string; secret: string }> {
    const definition = this.owned(await this.ready, id)
    const record = (await this.hooks).table('webhooks').get(definition.id)
    if (record === undefined) throw new Error('This automation has no inbound trigger.')
    return { path: this.webhookPath(definition.id), keyId: record.keyId, secret: record.secret }
  }

  /** Path an outside service posts to for one automation. */
  private webhookPath(id: AutomationId): string {
    return `${WEBHOOK_PATH}/${id}`
  }

  /** Save one confirmed task using the caller's execution context.
   * @param input - editable task values.
   * @param agent - creating conversation, when called by an agent tool.
   * @returns durably stored definition.
   */
  create(input: AutomationInput, agent?: Agent): Promise<AutomationDefinition> {
    const owner = agent?.session.header.owner ?? this.ctx.identityUsers.actingUser()?.id
    if (!this.ctx.identityUsers.mayAccess(owner)) return Promise.reject(new Error('Sign in to create an automation.'))
    return this.transaction(async (domain) => {
      const parsed = withDesktop(inputSchema.parse(input))
      const now = new Date().toISOString()
      const id = brandString<AutomationId>(randomUUID())
      this.checkTriggers(domain, owner, id, parsed.triggers, now)
      const refusal = placementRefusal({ ...parsed, runOn: parsed.runOn ?? 'auto' }, this.hostsOf(owner))
      if (refusal !== undefined) throw new Error(refusal)
      const agentPreset = agent?.session.header.agentPreset ?? this.ctx.agentPresets.defaultId
      if (owner !== undefined && this.ctx.get('settings')?.accountSections === true) {
        await this.ctx.agentDefaultModel.prepare(owner)
      }
      const model = this.ctx.agentDefaultModel.currentSelection(owner)
      const definition: AutomationDefinition = {
        ...parsed, runOn: parsed.runOn ?? 'auto', connectors: parsed.connectors ?? 'all', overlap: parsed.overlap ?? 'skip',
        id, ...owner === undefined ? {} : { owner }, revision: 1, status: 'active', agentPreset, grants: [],
        model, createdAt: now, updatedAt: now, lastAdmittedAt: {}, executionTarget: { kind: 'local', runnerId: this.runnerId(domain) },
      }
      await this.store(domain, definition)
      await this.alignCredential(definition)
      this.arm(domain)
      return definition
    })
  }

  /** Revise or pause an owned automation, or change where it may run, without changing earlier run snapshots.
   * @param id - owned definition identity.
   * @param patch - replacement editable fields or status.
   * @returns durably revised definition.
   */
  update(id: AutomationId, patch: { [K in keyof AutomationInput]?: AutomationInput[K] | undefined } & { status?: 'active' | 'paused' | undefined }): Promise<AutomationDefinition> {
    return this.transaction(async (domain) => {
      const current = this.owned(domain, id)
      const parsed = withDesktop(inputSchema.parse({
        name: patch.name ?? current.name, prompt: patch.prompt ?? current.prompt,
        triggers: patch.triggers ?? current.triggers, permission: patch.permission ?? current.permission,
        connectors: patch.connectors ?? current.connectors, overlap: patch.overlap ?? current.overlap,
        requires: patch.requires ?? current.requires, runOn: patch.runOn ?? current.runOn,
        // A new choice of where the bot runs replaces its desktop; an edit that names neither keeps it.
        desktop: patch.runOn === undefined && patch.desktop === undefined ? current.desktop : patch.desktop,
      }))
      const status = patch.status ?? current.status
      const { desktop: _replaced, ...kept } = current
      const next: AutomationDefinition = {
        ...kept, ...parsed, runOn: parsed.runOn ?? current.runOn, connectors: parsed.connectors ?? current.connectors,
        overlap: parsed.overlap ?? current.overlap, status, revision: current.revision + 1, updatedAt: new Date().toISOString(),
      }
      if (patch.triggers !== undefined) this.checkTriggers(domain, current.owner, current.id, next.triggers)
      const refusal = placementRefusal(next, this.hostsOf(current.owner))
      if (refusal !== undefined) throw new Error(refusal)
      await this.store(domain, next)
      await this.alignCredential(next)
      this.arm(domain)
      if (status === 'active') this.pumpHandoffs()
      return next
    })
  }

  /**
   * Refuse a trigger list the owner cannot have meant: a schedule without a future occurrence when one is required,
   * or a `bot` trigger naming the bot itself or a bot of another account.
   * @param domain - the open definition domain.
   * @param owner - the account the bot belongs to.
   * @param self - the bot's id.
   * @param triggers - the validated list.
   * @param now - the creation instant; schedules must still occur after it. Absent on an edit, where a finished
   * schedule stays as it is.
   */
  private checkTriggers(
    domain: Domain<typeof automationDomain>, owner: string | undefined, self: AutomationId, triggers: readonly BotTrigger[], now?: string,
  ): void {
    for (const trigger of triggers) {
      switch (trigger.kind) {
        case 'schedule':
          if (now !== undefined && nextOccurrence(trigger.schedule, now) === null) throw new Error('Choose a schedule with a future occurrence.')
          break
        case 'bot': {
          if (trigger.from === self) throw new Error('A bot cannot hand work to itself.')
          const sender = domain.table('definitions').get(trigger.from)
          if (sender === undefined || sender.owner !== owner) throw new Error('A bot can receive work only from another bot of the same account.')
          break
        }
        case 'webhook':
        case 'event':
          break
      }
    }
  }

  /** Admit a manual run on its execution Host; paused tasks can be run manually.
   * Cloud requests are durable in account sync and continue after the requesting client stops.
   * @param id - owned automation identity.
   * @returns durable run admission.
   */
  runNow(id: AutomationId): Promise<AutomationRun> {
    return this.transaction(async (domain) => {
      const definition = this.owned(domain, id)
      const forwarded = await this.cloudRun(domain, definition)
      if (forwarded !== undefined) return forwarded
      const run = await this.admit(domain, definition, { trigger: 'manual', scheduledFor: new Date().toISOString() })
      this.drain(domain)
      return run
    })
  }

  /** Stop one queued or running run of the acting account.
   * A run of this Host stops here; a cloud run is asked to stop through account sync and ends on its cloud Host.
   * @param id - owned run identity.
   * @returns the run as stored once the stop is recorded or, for a cloud run, acknowledged by the relay.
   */
  stopRun(id: AutomationRunId): Promise<AutomationRun> {
    return this.transaction(async (domain) => {
      const run = this.ownedRun(domain, id)
      if (run.status !== 'queued' && run.status !== 'running') throw new Error('This run has already finished.')
      if (run.admittedBy === this.runnerId(domain)) return this.stopHere(domain, run)
      await this.synced.stopRun(run)
      return run
    })
  }

  /** Cancel an executing run's turn, or record a run that has not started as cancelled. */
  private async stopHere(domain: Domain<typeof automationDomain>, run: AutomationRun): Promise<AutomationRun> {
    const entry = this.active.get(run.id)
    if (entry !== undefined) {
      entry.stopRequested = true
      entry.handle?.agent.cancel({ kind: 'user' })
      return run
    }
    const stopped: AutomationRun = { ...run, status: 'cancelled', finishedAt: new Date().toISOString(), error: STOPPED }
    await this.storeRun(domain, stopped)
    return stopped
  }

  /**
   * Admit one run from an authenticated inbound request.
   * The presented key is the whole authority, so this path reads no acting account.
   * A paused automation, one without a webhook trigger, or one this Host may not run refuses the request; work
   * already in flight follows the bot's overlap policy.
   * @param id - automation named by the request path.
   * @param key - bearer credential presented by the caller.
   * @param payload - accepted request body, marked untrusted in the run notice.
   * @param idempotencyKey - the request's `Idempotency-Key`, which deduplicates only when the trigger asks for it.
   * @returns the admitted, skipped, or earlier run of the same key; its execution proceeds in the background.
   */
  async requestRun(id: AutomationId, key: string, payload: string | null, idempotencyKey?: string): Promise<AutomationRun> {
    const hooks = await this.hooks
    const record = hooks.table('webhooks').get(id)
    if (record === undefined || !matchesSecret(record.secret, key)) throw new WebhookRefusal(401, 'Unknown inbound trigger.')
    const run = await this.transaction(async (domain) => {
      const definition = domain.table('definitions').get(id)
      if (definition === undefined) throw new WebhookRefusal(401, 'Unknown inbound trigger.')
      const index = definition.triggers.findIndex(trigger => trigger.kind === 'webhook')
      const trigger = definition.triggers[index]
      if (trigger?.kind !== 'webhook') throw new WebhookRefusal(404, 'This bot has no webhook trigger.')
      if (definition.status !== 'active') throw new WebhookRefusal(409, 'This automation is paused.')
      if (!this.runsHere(domain, definition)) throw new WebhookRefusal(409, 'This automation runs on another device.')
      const requestedId = trigger.idempotency === 'sender' && idempotencyKey !== undefined ? this.occurrenceId(definition.id, index, `key:${idempotencyKey}`) : undefined
      const earlier = requestedId === undefined ? undefined : domain.table('runs').get(requestedId)
      if (earlier !== undefined) return earlier
      const admitted = await this.admit(domain, definition, { trigger: 'webhook', triggerIndex: index, scheduledFor: new Date().toISOString(), payload, ...requestedId === undefined ? {} : { requestedId } })
      this.drain(domain)
      return admitted
    })
    await hooks.table('webhooks').put(id, { ...record, lastDeliveredAt: new Date().toISOString() })
    return run
  }

  /**
   * Admit the runs one signed GitHub delivery wakes: one per matching `github` event trigger of the bot, each
   * identified by the trigger and the delivery id, so a redelivery admits nothing new.
   * @param id - automation named by the request path.
   * @param body - raw request body the signature covers.
   * @param signature - the `X-Hub-Signature-256` header.
   * @param event - the `X-GitHub-Event` header.
   * @param delivery - the `X-GitHub-Delivery` header.
   * @returns the runs the delivery admitted or had admitted before; empty when no trigger's filter matches.
   */
  private async requestGitHub(
    id: AutomationId, body: Buffer, signature: string | undefined, event: string, delivery: string,
  ): Promise<AutomationRun[]> {
    const hooks = await this.hooks
    const record = hooks.table('webhooks').get(id)
    if (record === undefined || !verifiesGitHub(record.secret, body, signature)) throw new WebhookRefusal(401, 'Invalid signature.')
    let payload: unknown
    try {
      payload = JSON.parse(body.toString('utf8'))
    } catch {
      // JSON.parse is the only statement; a body GitHub signed but that is not JSON is refused as malformed.
      throw new WebhookRefusal(400, 'The body is not JSON.')
    }
    const runs = await this.transaction(async (domain) => {
      const definition = domain.table('definitions').get(id)
      if (definition === undefined) throw new WebhookRefusal(401, 'Invalid signature.')
      if (definition.status !== 'active') throw new WebhookRefusal(409, 'This automation is paused.')
      if (!this.runsHere(domain, definition)) throw new WebhookRefusal(409, 'This automation runs on another device.')
      const summary = summarizeGitHub(event, payload, this.config.webhookMaxBodyBytes)
      const admitted: AutomationRun[] = []
      for (const [index, trigger] of definition.triggers.entries()) {
        if (trigger.kind !== 'event' || trigger.source !== 'github' || !matchesGitHub(trigger.filter, event, payload)) continue
        admitted.push(await this.admitEvent(domain, definition, index, { source: 'github', id: delivery, summary }))
      }
      if (admitted.length === 0 && !definition.triggers.some(trigger => trigger.kind === 'event' && trigger.source === 'github')) throw new WebhookRefusal(404, 'This bot has no GitHub trigger.')
      this.drain(domain)
      return admitted
    })
    await hooks.table('webhooks').put(id, { ...record, lastDeliveredAt: new Date().toISOString() })
    return runs
  }

  /**
   * Admit one event for one trigger, once: the occurrence is the bot, the trigger, and the source's event id.
   * @param domain - the open definition domain.
   * @param definition - the bot.
   * @param index - the matching trigger's index.
   * @param event - the source, its event id, and the text the run reads.
   * @returns the admitted run, or the run the same event admitted before.
   */
  private async admitEvent(domain: Domain<typeof automationDomain>, definition: AutomationDefinition, index: number, event: { source: 'mail' | 'github'; id: string; summary: string }): Promise<AutomationRun> {
    const requestedId = this.occurrenceId(definition.id, index, `event:${event.source}:${event.id}`)
    const earlier = domain.table('runs').get(requestedId)
    if (earlier !== undefined) return earlier
    return this.admit(domain, definition, {
      trigger: 'event', triggerIndex: index, scheduledFor: new Date().toISOString(), payload: event.summary,
      event: { source: event.source, id: event.id, summary: event.summary.split('\n', 1)[0] ?? '' }, requestedId,
    })
  }

  /** Answer one inbound trigger request; the admitted run continues after the response. */
  private async answerWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const path = new URL(req.url ?? '/', 'http://localhost').pathname
      const rest = path.startsWith(`${WEBHOOK_PATH}/`) ? path.slice(WEBHOOK_PATH.length + 1).split('/') : []
      const [id = '', channel] = rest
      if (id === '' || rest.length > 2 || (channel !== undefined && channel !== 'github')) { reply(res, 404, { error: 'Not found.' }); return }
      if (req.method !== 'POST') { res.setHeader('allow', 'POST'); reply(res, 405, { error: channel === 'github' ? 'GitHub delivers with POST.' : 'Use POST with the key in an Authorization: Bearer header.' }); return }
      if (channel === 'github') {
        const event = req.headers['x-github-event']
        const delivery = req.headers['x-github-delivery']
        if (typeof event !== 'string' || typeof delivery !== 'string' || event === '' || delivery === '') { reply(res, 400, { error: 'Missing GitHub delivery headers.' }); return }
        const body = await readCappedBody(req, res, this.config.githubMaxBodyBytes)
        if (body === null) return
        const signature = req.headers['x-hub-signature-256']
        // GitHub's own ping proves the address and the secret; it admits no run.
        if (event === 'ping') {
          const record = (await this.hooks).table('webhooks').get(brandString<AutomationId>(id))
          if (record === undefined || !verifiesGitHub(record.secret, body, typeof signature === 'string' ? signature : undefined)) { reply(res, 401, { error: 'Invalid signature.' }); return }
          reply(res, 200, { ok: true }); return
        }
        const runs = await this.requestGitHub(brandString<AutomationId>(id), body, typeof signature === 'string' ? signature : undefined, event, delivery)
        reply(res, 202, { runs: runs.map(run => ({ run: run.id, status: run.status })) })
        return
      }
      const key = bearerCredential(req.headers.authorization)
      if (key === undefined) { reply(res, 401, { error: 'Present the key as an Authorization: Bearer header.' }); return }
      const body = await readCappedBody(req, res, this.config.webhookMaxBodyBytes)
      if (body === null) return
      const idempotency = req.headers['idempotency-key']
      const run = await this.requestRun(brandString<AutomationId>(id), key, body.length === 0 ? null : body.toString('utf8'), typeof idempotency === 'string' && idempotency !== '' ? idempotency : undefined)
      if (run.status === 'skipped') { reply(res, 409, { run: run.id, status: run.status, error: run.error ?? 'A previous run is still active.' }); return }
      reply(res, 202, { run: run.id, status: run.status })
    } catch (error) {
      if (error instanceof WebhookRefusal) { reply(res, error.status, { error: error.message }); return }
      this.ctx.logger.warn(`automations: an inbound trigger was not admitted: ${String(error)}`)
      reply(res, 500, { error: 'The Host could not admit this request.' })
    }
  }

  /** Remove an owned definition and its inbound credential while retaining its run history; it leaves its boards.
   * @param id - owned definition identity.
   * @returns resolution after durable deletion.
   */
  remove(id: AutomationId): Promise<void> {
    return this.transaction(async (domain) => {
      const definition = this.owned(domain, id)
      await domain.table('definitions').delete(id)
      this.forget(definition)
      // The credential dies with its definition; an interrupted second write leaves
      // an orphan secret that the startup sweep removes.
      await (await this.hooks).table('webhooks').delete(id)
      // A removed bot leaves every board, and the work handed to it that no run carries is released, not reassigned.
      for (const [, board] of domain.table('boards').entries()) {
        if (!board.members.includes(id)) continue
        const members = board.members.filter(member => member !== id)
        await this.storeBoard(domain, { ...board, members, updatedAt: new Date().toISOString() })
      }
      await this.releaseHandoffs(domain, handoff => handoff.to === id, 'Its bot was removed.')
      this.arm(domain)
    })
  }

  /** Delete the acting account's finished run history and archive each removed run's conversation.
   * A run that is queued or running is kept, so clearing never hides work in flight.
   * @returns the number of run records removed.
   */
  clearRuns(): Promise<{ cleared: number }> {
    return this.transaction(async (domain) => {
      let cleared = 0
      for (const run of this.runs(domain)) {
        const id = run.id
        if (run.status === 'queued' || run.status === 'running') continue
        if (!this.ctx.identityUsers.mayAccess(run.definition.owner)) continue
        await this.archiveRun(run)
        await domain.table('runs').delete(id)
        this.synced.forgetRun(run)
        cleared += 1
      }
      return { cleared }
    })
  }

  /** Remove one finished run from the acting account's history and archive its conversation.
   * A queued or running run is refused, so removal never hides work in flight.
   * @param id - owned run identity.
   * @returns resolution after durable deletion.
   */
  removeRun(id: AutomationRunId): Promise<void> {
    return this.transaction(async (domain) => {
      const run = this.ownedRun(domain, id)
      if (run.status === 'queued' || run.status === 'running') throw new Error('Wait for the run to finish.')
      await this.archiveRun(run)
      await domain.table('runs').delete(id)
      this.synced.forgetRun(run)
    })
  }

  /** Hide one removed run's conversation from the sidebar, keeping its log readable.
   * The archive write lands before the run record is deleted: an interruption
   * between the two leaves a record whose conversation is already archived,
   * which a repeated removal finishes, while the reverse order would strand the
   * conversation in the sidebar with no record naming it.
   * A run that never started has no conversation, and one whose conversation its
   * owner already deleted is absent; neither leaves the removal incomplete.
   */
  private async archiveRun(run: AutomationRun): Promise<void> {
    const sessionId = run.sessionId
    if (sessionId === null) return
    await this.ctx.workspaceRegistry.archiveSession(sessionId).catch((error: unknown) => { this.ctx.logger.warn(`automations: run conversation ${sessionId} was not archived: ${String(error)}`) })
  }

  /** Deliberately retry one unresolved failed run using its original approved task.
   * @param id - owned failed, skipped, or cancelled run identity.
   * @returns a new linked admission or durable cloud request; execution follows the original task placement.
   * No earlier conversation or grant is inherited.
   */
  retry(id: AutomationRunId): Promise<AutomationRun> {
    return this.transaction(async (domain) => {
      const original = this.ownedRun(domain, id)
      this.requireInactive(domain, original)
      if (original.status === 'succeeded' || original.resolution !== null) throw new Error('Choose an unresolved failed run.')
      if (this.runs(domain).some(run => run.retryOfRunId === id)) throw new Error('This run already has a linked retry. Inspect that retry first.')
      const forwarded = await this.cloudRun(domain, original.definition, original)
      if (forwarded !== undefined) return forwarded
      const retry = await this.admit(domain, original.definition, { trigger: 'manual', scheduledFor: new Date().toISOString(), retryOfRunId: id })
      await this.storeRun(domain, { ...original, resolution: { kind: 'retried', at: retry.scheduledFor, retryRunId: retry.id } })
      this.drain(domain)
      return retry
    })
  }

  /** Current definition of the automation whose run created a session, when the session is a run conversation. */
  private definitionOf(domain: Domain<typeof automationDomain>, sessionId: SessionId): AutomationDefinition | undefined {
    for (const [, run] of domain.table('runs').entries()) {
      if (run.sessionId === sessionId) return domain.table('definitions').get(run.definition.id)
    }
    return undefined
  }

  /** Save one scoped approval from a run conversation on its automation, so later runs need no answer. */
  private rememberGrant(session: Session, id: ApprovalRequestId): Promise<void> {
    let asked: { toolName: string; allowSession?: string } | undefined
    for (let seq = session.seq - 1; seq >= 0 && asked === undefined; seq -= 1) {
      const event = session.eventAt(SessionSeq(seq))
      if (event?.type === 'approval/asked' && event.data.id === id) asked = event.data
    }
    const scope = asked?.allowSession
    if (asked === undefined || scope === undefined) return Promise.resolve()
    const toolName = asked.toolName
    return this.transaction(async (domain) => {
      const definition = this.definitionOf(domain, session.id)
      const now = Date.now()
      const live = (grant: AutomationDefinition['grants'][number]): boolean => grant.expiresAt === undefined || Date.parse(grant.expiresAt) > now
      const held = definition?.grants.some(grant => grant.toolName === toolName && grant.scope === scope && live(grant))
      if (definition === undefined || held === true) return
      const lifetime = this.config.grantLifetimeDays
      // An expired grant for the same request gives way to the new answer.
      await this.store(domain, { ...definition, grants: [
        ...definition.grants.filter(grant => grant.toolName !== toolName || grant.scope !== scope),
        {
          toolName, scope, grantedAt: new Date(now).toISOString(),
          ...lifetime === undefined ? {} : { expiresAt: new Date(now + lifetime * 86_400_000).toISOString() },
        },
      ] })
    })
  }

  /** Revoke one saved approval of an owned automation, so its next run asks again.
   * @param id - owned definition identity.
   * @param toolName - the approved tool.
   * @param scope - the approved scope.
   * @returns the definition without that grant.
   */
  revokeGrant(id: AutomationId, toolName: string, scope: string): Promise<AutomationDefinition> {
    return this.transaction(async (domain) => {
      const current = this.owned(domain, id)
      const grants = current.grants.filter(grant => grant.toolName !== toolName || grant.scope !== scope)
      const next = { ...current, grants, updatedAt: new Date().toISOString() }
      await this.store(domain, next)
      return next
    })
  }

  private ownedRun(domain: Domain<typeof automationDomain>, id: AutomationRunId): AutomationRun {
    const run = this.runs(domain).find(candidate => candidate.id === id)
    if (run === undefined || !this.ctx.identityUsers.mayAccess(run.definition.owner)) throw new Error('Run not found.')
    return run
  }

  private requireInactive(domain: Domain<typeof automationDomain>, run: AutomationRun): void {
    if (this.runs(domain).some(value => value.definition.id === run.definition.id && (value.status === 'queued' || value.status === 'running'))) throw new Error('Wait for the active run to finish.')
  }

  /** The built-in pathless workspace that holds every account's run conversations; each account sees only its own. */
  private workspace(): Promise<Workspace> {
    return this.ctx.workspaceRegistry.builtIn('automations', this.config.workspaceTitle)
  }

  private runs(domain: Domain<typeof automationDomain>): AutomationRun[] {
    return [...new Map([...[...domain.table('runs').entries()].map(([, run]) => run), ...this.synced.runs()].map(run => [run.id, run])).values()]
  }

  private async storeRun(domain: Domain<typeof automationDomain>, run: AutomationRun): Promise<void> {
    await domain.table('runs').put(run.id, run)
    this.synced.publishRun(run)
  }

  private async cloudRun(
    domain: Domain<typeof automationDomain>, definition: AutomationDefinition, original?: AutomationRun,
  ): Promise<AutomationRun | undefined> {
    const owner = definition.owner
    if (owner === undefined || this.config.placement.kind !== 'device' || placementMode(definition) !== 'cloud' || eligibility(definition, this.here(owner)) === 'preferred') return undefined
    await this.synced.attach(owner)
    const target = this.synced.cloudRunner(owner)
    if (target === undefined) return undefined
    const run: AutomationRun = {
      id: original === undefined ? brandString<AutomationRunId>(randomUUID()) : brandString<AutomationRunId>(createHash('sha256').update(`retry:${original.id}`).digest('hex')),
      definition, trigger: 'manual', scheduledFor: new Date().toISOString(), status: 'queued', sessionId: null,
      startedAt: null, finishedAt: null, summary: null, error: null, admittedBy: target,
      retryOfRunId: original?.id ?? null, payload: null, resolution: null,
    }
    await this.synced.requestRun(owner, { run, ...original === undefined ? {} : { original } })
    await domain.table('runs').put(run.id, run)
    if (original !== undefined) {
      const resolved = { ...original, resolution: { kind: 'retried' as const, at: run.scheduledFor, retryRunId: run.id } }
      if (domain.table('runs').get(original.id) !== undefined) await this.storeRun(domain, resolved)
    }
    return run
  }

  private receiveCloudRun(owner: string, id: AutomationRunId, request: CloudRunRequest | undefined): void {
    if (request !== undefined && this.config.placement.kind !== 'cloud') return
    void this.ctx.identityUsers.runAs({ id: owner }, () => this.transaction(async (domain) => {
      const existing = domain.table('runs').get(id)
      if (existing !== undefined && existing.definition.owner !== owner) throw new Error('Run not found.')
      if (request === undefined) {
        if (existing === undefined || existing.status === 'queued' || existing.status === 'running') return
        await this.archiveRun(existing)
        await domain.table('runs').delete(id)
        return
      }
      const { run, original } = request
      if (run.admittedBy !== this.runnerId(domain)) return
      if (existing !== undefined) {
        if (request.stop === true && (existing.status === 'queued' || existing.status === 'running')) await this.stopHere(domain, existing)
        else this.synced.publishRun(existing)
        return
      }
      if (request.stop === true) {
        await this.storeRun(domain, { ...run, status: 'cancelled', finishedAt: new Date().toISOString(), error: STOPPED })
        return
      }
      try {
        if (run.trigger !== 'manual' || run.status !== 'queued' || run.sessionId !== null || eligibility(run.definition, this.here(owner)) !== 'preferred') throw new Error('This bot cannot run in the cloud.')
        if (original !== undefined) {
          if (original.id !== run.retryOfRunId || JSON.stringify(original.definition) !== JSON.stringify(run.definition) || original.status === 'running' || original.status === 'queued' || original.status === 'succeeded' || original.resolution !== null) throw new Error('Choose an unresolved failed run.')
          const storedOriginal = domain.table('runs').get(original.id)
          if (storedOriginal !== undefined && (storedOriginal.status === 'succeeded' || storedOriginal.resolution !== null)) throw new Error('Choose an unresolved failed run.')
          const prior = this.runs(domain).find(candidate => candidate.retryOfRunId === original.id && candidate.id !== id)
          if (prior !== undefined) throw new Error('This run already has a linked retry. Inspect that retry first.')
        } else if (run.retryOfRunId !== null) throw new Error('Choose an unresolved failed run.')
        const admitted = await this.admit(domain, run.definition, { trigger: 'manual', scheduledFor: run.scheduledFor, retryOfRunId: run.retryOfRunId, requestedId: id })
        if (original !== undefined) {
          const resolved = { ...original, resolution: { kind: 'retried' as const, at: admitted.scheduledFor, retryRunId: admitted.id } }
          if (domain.table('runs').get(original.id) !== undefined) await this.storeRun(domain, resolved)
          else this.synced.publishRun(resolved)
        }
        this.drain(domain)
      } catch (error) {
        await this.storeRun(domain, { ...run, status: 'failed', finishedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) })
      }
    })).catch((error: unknown) => {
      this.ctx.logger.warn(`automations: the cloud request was not stored: ${String(error)}`)
    })
  }

  /**
   * Save one board of the acting account: a new one without `id`, or a replacement of an owned one. A member that
   * leaves releases the open handoffs addressed to it on this board.
   * @param input - name, members, and budget; every member must be an owned bot.
   * @param id - the board to replace, or undefined for a new one.
   * @returns the stored board.
   */
  saveBoard(input: BoardInput, id?: BoardId): Promise<AutomationBoard> {
    const owner = this.ctx.identityUsers.actingUser()?.id
    if (!this.ctx.identityUsers.mayAccess(owner)) return Promise.reject(new Error('Sign in to manage boards.'))
    return this.transaction(async (domain) => {
      const parsed = boardInputSchema.parse(input)
      for (const member of parsed.members) this.owned(domain, member)
      const current = id === undefined ? undefined : this.ownedBoard(domain, id)
      const now = new Date().toISOString()
      const board: AutomationBoard = {
        id: current?.id ?? brandString<BoardId>(randomUUID()), ...owner === undefined ? {} : { owner },
        name: parsed.name, members: [...new Set(parsed.members)], budget: parsed.budget ?? {},
        createdAt: current?.createdAt ?? now, updatedAt: now,
      }
      await this.storeBoard(domain, board)
      if (current !== undefined) {
        const left = new Set(current.members.filter(member => !board.members.includes(member)))
        await this.releaseHandoffs(domain, handoff => handoff.board === board.id && left.has(handoff.to), 'Its bot left the board.')
      }
      return board
    })
  }

  /** Remove one board of the acting account; the handoffs it carried stay with their bots.
   * @param id - owned board identity.
   * @returns resolution after durable deletion.
   */
  removeBoard(id: BoardId): Promise<void> {
    return this.transaction(async (domain) => {
      const board = this.ownedBoard(domain, id)
      await domain.table('boards').delete(board.id)
      if (board.owner !== undefined) {
        this.synced.publishRecord(board.owner, 'boards', board.id, undefined, Date.now()).catch((error: unknown) => {
          this.ctx.logger.warn(`automations: the board removal was not published to the account: ${String(error)}`)
        })
      }
    })
  }

  private ownedBoard(domain: Domain<typeof automationDomain>, id: BoardId): AutomationBoard {
    const board = domain.table('boards').get(id)
    if (board === undefined || !this.ctx.identityUsers.mayAccess(board.owner)) throw new Error('Board not found.')
    return board
  }

  /** Store one board and publish it to the account's other devices. */
  private async storeBoard(domain: Domain<typeof automationDomain>, board: AutomationBoard): Promise<void> {
    await domain.table('boards').put(board.id, board)
    if (board.owner === undefined) return
    this.synced.publishRecord(board.owner, 'boards', board.id, board, Date.parse(board.updatedAt)).catch((error: unknown) => {
      this.ctx.logger.warn(`automations: the board was not published to the account: ${String(error)}`)
    })
  }

  /** Store one handoff and publish it to the account's other devices. */
  private async storeHandoff(domain: Domain<typeof automationDomain>, handoff: Handoff): Promise<void> {
    await domain.table('handoffs').put(handoff.id, handoff)
    if (handoff.owner === undefined) return
    this.synced.publishRecord(handoff.owner, 'handoffs', handoff.id, handoff, Date.parse(handoff.updatedAt)).catch((error: unknown) => {
      this.ctx.logger.warn(`automations: the handoff was not published to the account: ${String(error)}`)
    })
  }

  /** Release every open or claimed handoff a predicate selects, recording the reason, without reassigning it. */
  private async releaseHandoffs(
    domain: Domain<typeof automationDomain>, select: (handoff: Handoff) => boolean, reason: string,
  ): Promise<void> {
    for (const [, handoff] of [...domain.table('handoffs').entries()]) {
      if ((handoff.status === 'open' || handoff.status === 'claimed') && select(handoff)) {
        await this.storeHandoff(domain, { ...handoff, status: 'released', reason, updatedAt: new Date().toISOString() })
      }
    }
  }

  /**
   * Apply another device's board or handoff, or its removal, when it is newer than what this device holds.
   * @param kind - `boards` or `handoffs`.
   * @param id - its id.
   * @param entry - the synced value or its removal.
   */
  private applyRecord<K extends keyof RecordKinds>(kind: K, id: string, entry: SyncedRecord<RecordKinds[K]>): void {
    void this.transaction(async (domain) => {
      const table = domain.table(kind) as unknown as {
        get: (key: string) => { updatedAt: string } | undefined
        put: (key: string, value: RecordKinds[K]) => Promise<void>
        delete: (key: string) => Promise<void>
      }
      const current = table.get(id)
      if (current !== undefined && Date.parse(current.updatedAt) > entry.changedAt) return
      if (entry.value === undefined) {
        if (current !== undefined) await table.delete(id)
        return
      }
      if (current !== undefined && JSON.stringify(current) === JSON.stringify(entry.value)) return
      await table.put(id, entry.value)
      if (kind === 'handoffs') this.pumpHandoffs()
    }).catch((error: unknown) => {
      this.ctx.logger.warn(`automations: another device's ${kind} entry was not stored: ${String(error)}`)
    })
  }

  /**
   * The run tools' operations for one run: the bots that accept its handoffs and the boards it belongs to.
   * @param domain - the open definition domain.
   * @param run - the run that executes.
   * @returns operations the run tools call; each checks the stored definitions again.
   */
  private runToolsAccess(domain: Domain<typeof automationDomain>, run: AutomationRun): Parameters<typeof registerRunTools>[1] {
    const self = run.definition
    const targets = [...domain.table('definitions').entries()].flatMap(([, target]) => {
      if (target.owner !== self.owner || target.id === self.id) return []
      const edge = target.triggers.find(trigger => trigger.kind === 'bot' && trigger.from === self.id)
      return edge?.kind === 'bot' ? [{ id: target.id, name: target.name, mode: edge.mode }] : []
    })
    const boards = (): AutomationBoard[] => [...domain.table('boards').entries()].map(([, board]) => board).filter(board => board.owner === self.owner && board.members.includes(self.id))
    return {
      targets,
      onBoard: boards().length > 0,
      handoff: (to, task) => this.transaction(current => this.handOff(current, run, to, task)),
      tasks: () => {
        const ids = new Set(boards().map(board => board.id))
        return [...domain.table('handoffs').entries()].map(([, handoff]) => handoff).filter(handoff => handoff.board !== null && ids.has(handoff.board))
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 50)
      },
      settle: (id, status, result) => this.transaction(async (current) => {
        const handoff = current.table('handoffs').get(id)
        if (handoff?.run !== run.id || handoff.status !== 'claimed') throw new Error('Settle only the handoff this run carries out.')
        const settled: Handoff = { ...handoff, status, result, updatedAt: new Date().toISOString() }
        await this.storeHandoff(current, settled)
        return settled
      }),
    }
  }

  /**
   * Store one handoff from a run to a bot whose `bot` trigger names the run's bot. A paused or removed receiver
   * refuses it at once, so the sender learns why instead of leaving work that cannot run.
   * @param domain - the open definition domain.
   * @param run - the sending run.
   * @param to - the receiver's id or exact name.
   * @param task - the request.
   * @returns the stored handoff; the same request from the same run returns the handoff it stored before.
   */
  private async handOff(domain: Domain<typeof automationDomain>, run: AutomationRun, to: string, task: string): Promise<Handoff> {
    const sender = run.definition
    const target = [...domain.table('definitions').entries()].map(([, value]) => value)
      .find(value => value.owner === sender.owner && (value.id === to || value.name === to))
    if (target === undefined) throw new Error(`No bot named ${to} exists any more.`)
    const edge = target.triggers.findIndex(trigger => trigger.kind === 'bot' && trigger.from === sender.id)
    const trigger = target.triggers[edge]
    if (trigger?.kind !== 'bot') throw new Error(`${target.name} does not accept work from ${sender.name}. Only their owner can connect them.`)
    if (target.status !== 'active') throw new Error(`${target.name} is paused, so it cannot take this task.`)
    const id = brandString<HandoffId>(createHash('sha256').update(`${run.id}\n${target.id}\n${task}`).digest('hex'))
    const earlier = domain.table('handoffs').get(id)
    if (earlier !== undefined) return earlier
    const board = [...domain.table('boards').entries()].map(([, value]) => value)
      .find(value => value.owner === sender.owner && value.members.includes(sender.id) && value.members.includes(target.id))
    const now = new Date().toISOString()
    const handoff: Handoff = {
      id, ...sender.owner === undefined ? {} : { owner: sender.owner }, board: board?.id ?? null,
      from: sender.id, fromName: sender.name, fromRun: run.id, to: target.id, toName: target.name, edge, mode: trigger.mode, replyTo: null,
      task, status: 'open', run: null, result: null, reason: null, tokens: null, createdAt: now, updatedAt: now,
    }
    await this.storeHandoff(domain, handoff)
    this.pumpHandoffs()
    return handoff
  }

  /**
   * Admit the open handoffs this Host may run: the receiver runs here, this device holds its claim while account
   * sync serves the account, and the receiver has no run in progress unless it runs in parallel. A paused or
   * removed receiver, or a board budget, refuses the handoff with the reason.
   */
  private pumpHandoffs(): void {
    if (this.stopped) return
    void this.transaction(async (current) => {
      const open = [...current.table('handoffs').entries()].map(([, handoff]) => handoff).filter(handoff => handoff.status === 'open')
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
      for (const handoff of open) {
        const target = current.table('definitions').get(handoff.to)
        if (target === undefined) continue
        const place = eligibility(target, this.here(target.owner))
        if (place === 'never' || (place === 'fallback' && this.yields(target)) || !this.runsHere(current, target)) continue
        const now = new Date().toISOString()
        if (target.status !== 'active') {
          await this.storeHandoff(current, { ...handoff, status: 'refused', reason: `${target.name} is paused.`, updatedAt: now })
          continue
        }
        if (target.overlap !== 'parallel' && this.runs(current).some(run => run.definition.id === target.id && (run.status === 'queued' || run.status === 'running'))) continue
        if (!await this.claimsScheduler(target)) continue
        const requestedId = this.occurrenceId(target.id, handoff.edge ?? -1, `handoff:${handoff.id}`)
        const run = current.table('runs').get(requestedId) ?? await this.admit(current, target, {
          trigger: 'bot', scheduledFor: now, requestedId, ...handoff.edge === null ? {} : { triggerIndex: handoff.edge },
          handoff: {
            id: handoff.id, from: handoff.from, fromName: handoff.fromName, fromRun: handoff.fromRun, edge: handoff.edge,
            mode: handoff.mode, replyTo: handoff.replyTo, board: handoff.board, task: handoff.task,
          },
        })
        await this.storeHandoff(current, run.status === 'skipped'
          ? { ...handoff, status: 'refused', run: run.id, reason: run.error, updatedAt: now }
          : { ...handoff, status: 'claimed', run: run.id, updatedAt: now })
      }
      this.drain(current)
    }).catch((error: unknown) => {
      // A stopping Host refuses the transaction; the handoffs stay open for the next start.
      if (!this.stopped) this.ctx.logger.warn(`automations: handoffs were not admitted: ${String(error)}`)
    })
  }

  /**
   * Record a settled run on the handoff it carried out, and wake the sender of a `wait` edge with the result.
   * @param domain - the open definition domain.
   * @param run - the settled run.
   */
  private async settleRun(domain: Domain<typeof automationDomain>, run: AutomationRun): Promise<void> {
    const reference = run.handoff
    if (reference == null) return
    const handoff = domain.table('handoffs').get(reference.id)
    if (handoff === undefined) return
    const now = new Date().toISOString()
    const done = run.status === 'succeeded'
    const settled: Handoff = handoff.status === 'claimed'
      ? { ...handoff, status: done ? 'done' : 'failed', result: run.summary, reason: run.error, tokens: run.usage?.totalTokens ?? null, updatedAt: now }
      : { ...handoff, tokens: run.usage?.totalTokens ?? null, updatedAt: now }
    await this.storeHandoff(domain, settled)
    if (handoff.mode !== 'wait' || handoff.replyTo !== null) return
    const sender = domain.table('definitions').get(handoff.from)
    if (sender === undefined) return
    const answer = settled.result ?? settled.reason ?? `${handoff.toName} finished without a result.`
    const reply: Handoff = {
      id: brandString<HandoffId>(createHash('sha256').update(`reply\n${handoff.id}`).digest('hex')), ...handoff.owner === undefined ? {} : { owner: handoff.owner },
      board: handoff.board, from: handoff.to, fromName: handoff.toName, fromRun: run.id, to: sender.id, toName: sender.name,
      edge: null, mode: 'dispatch', replyTo: handoff.id,
      task: `${settled.status === 'done' ? 'Done' : 'Not done'}: ${answer}`.slice(0, 32_000),
      status: 'open', run: null, result: null, reason: null, tokens: null, createdAt: now, updatedAt: now,
    }
    if (domain.table('handoffs').get(reply.id) === undefined) await this.storeHandoff(domain, reply)
  }

  /**
   * Check every watched mail account once and admit a run for each new email a `mail` trigger matches. Only bots
   * this Host may run are watched, so a cloud Host and a desktop do not both poll for one bot.
   * @param signal - aborts the searches when the Host stops.
   */
  private async pollMail(signal: AbortSignal): Promise<void> {
    const mail = this.ctx.get('mail')
    if (mail === undefined || this.stopped) return
    const domain = await this.ready
    const watched = new Map<string, AutomationDefinition[]>()
    for (const [, definition] of domain.table('definitions').entries()) {
      if (definition.status !== 'active' || definition.owner === undefined || !definition.triggers.some(trigger => trigger.kind === 'event' && trigger.source === 'mail')) continue
      const place = eligibility(definition, this.here(definition.owner))
      if (place === 'never' || (place === 'fallback' && this.yields(definition)) || !this.runsHere(domain, definition)) continue
      watched.set(definition.owner, [...watched.get(definition.owner) ?? [], definition])
    }
    for (const [owner, definitions] of watched) {
      let accounts: { address: string }[]
      try {
        accounts = await mail.accounts(owner)
      } catch (error) {
        this.ctx.logger.warn(`automations: mail accounts were not listed: ${String(error)}`)
        continue
      }
      for (const { address } of accounts) {
        const filters = definitions.flatMap(definition => definition.triggers.flatMap(trigger => trigger.kind === 'event' && trigger.source === 'mail' ? [trigger.filter] : []))
        if (!filters.some(filter => filter.account === undefined || filter.account.toLowerCase() === address.toLowerCase())) continue
        const key = `${owner}\n${address.toLowerCase()}`
        let result: Awaited<ReturnType<typeof newMail>>
        try {
          result = await newMail(mail, owner, address, domain.table('cursors').get(key)?.seen, signal)
        } catch (error) {
          if (!signal.aborted) this.ctx.logger.warn(`automations: ${address} was not checked for new email: ${String(error)}`)
          continue
        }
        await this.transaction(async (current) => {
          await current.table('cursors').put(key, { seen: result.seen })
          for (const envelope of result.fresh) {
            for (const definition of definitions) {
              const latest = current.table('definitions').get(definition.id)
              if (latest?.status !== 'active') continue
              for (const [index, trigger] of latest.triggers.entries()) {
                if (trigger.kind !== 'event' || trigger.source !== 'mail' || !matchesMail(trigger.filter, address, envelope)) continue
                if (!await this.claimsScheduler(latest)) continue
                await this.admitEvent(current, latest, index, { source: 'mail', id: `${address.toLowerCase()}:${envelope.folder}:${envelope.id}`, summary: describeMail(address, envelope) })
              }
            }
          }
          this.drain(current)
        }).catch((error: unknown) => {
          if (!this.stopped) this.ctx.logger.warn(`automations: new email was not admitted: ${String(error)}`)
        })
      }
    }
  }

  private runnerId(domain: Domain<typeof automationDomain>): AutomationRunnerId {
    const runner = domain.table('runners').get('local')
    if (runner === undefined) throw new Error('Automation execution target is unavailable.')
    return runner.id
  }

  /** Move one schedule trigger's shared admission watermark forward to `at`. */
  private async advanceAdmission(domain: Domain<typeof automationDomain>, id: AutomationId, index: number, at: string): Promise<void> {
    const definition = domain.table('definitions').get(id)
    const previous = definition?.lastAdmittedAt[String(index)]
    if (definition === undefined || (previous !== undefined && Date.parse(previous) >= Date.parse(at))) return
    await this.store(domain, { ...definition, lastAdmittedAt: { ...definition.lastAdmittedAt, [String(index)]: at } })
  }

  private async prune(domain: Domain<typeof automationDomain>): Promise<void> {
    const counts = new Map<string | undefined, number>()
    const completed = [...domain.table('runs').entries()].map(([, run]) => run).filter(run => run.status !== 'queued' && run.status !== 'running')
      .sort((a, b) => Date.parse(b.scheduledFor) - Date.parse(a.scheduledFor))
    for (const run of completed) {
      const count = (counts.get(run.definition.owner) ?? 0) + 1
      counts.set(run.definition.owner, count)
      if (count <= this.config.historyLimit) continue
      await this.archiveRun(run)
      await domain.table('runs').delete(run.id)
      this.synced.forgetRun(run)
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
    // A payload the caller omitted arrives nullish; an empty record leaves each endpoint to report its own input.
    const input = (payload ?? {}) as Record<string, unknown>
    switch (endpoint) {
      case 'list': return this.list()
      case 'clear': return this.clearRuns()
      case 'create': return this.create(inputSchema.parse(payload))
      case 'update': {
        if (typeof input.id !== 'string' || input.patch === null || typeof input.patch !== 'object') throw new Error('Invalid automation update.')
        return this.update(brandString<AutomationId>(input.id), patchSchema.parse(input.patch))
      }
      case 'retry': {
        if (typeof input.id !== 'string') throw new Error('Choose a run.')
        return this.retry(brandString<AutomationRunId>(input.id))
      }
      case 'remove-run': {
        if (typeof input.id !== 'string') throw new Error('Choose a run.')
        return this.removeRun(brandString<AutomationRunId>(input.id))
      }
      case 'stop': {
        if (typeof input.id !== 'string') throw new Error('Choose a run.')
        return this.stopRun(brandString<AutomationRunId>(input.id))
      }
      case 'grant-revoke': {
        if (typeof input.id !== 'string' || typeof input.toolName !== 'string' || typeof input.scope !== 'string') throw new Error('Choose a saved approval.')
        return this.revokeGrant(brandString<AutomationId>(input.id), input.toolName, input.scope)
      }
      case 'board-save': {
        const board = boardInputSchema.parse(input.board)
        return this.saveBoard(board, typeof input.id === 'string' ? brandString<BoardId>(input.id) : undefined)
      }
      case 'board-remove': {
        if (typeof input.id !== 'string') throw new Error('Choose a board.')
        await this.removeBoard(brandString<BoardId>(input.id))
        return { deleted: true }
      }
      case 'webhook-enable': {
        if (typeof input.id !== 'string') throw new Error('Choose an automation.')
        return this.enableWebhook(brandString<AutomationId>(input.id))
      }
      case 'webhook-secret': {
        if (typeof input.id !== 'string') throw new Error('Choose an automation.')
        return this.webhookSecret(brandString<AutomationId>(input.id))
      }
      case 'webhook-rotate': {
        if (typeof input.id !== 'string') throw new Error('Choose an automation.')
        return this.rotateWebhook(brandString<AutomationId>(input.id))
      }
      case 'webhook-disable': {
        if (typeof input.id !== 'string') throw new Error('Choose an automation.')
        await this.disableWebhook(brandString<AutomationId>(input.id))
        return { disabled: true }
      }
      case 'run':
      case 'delete': {
        if (typeof input.id !== 'string') throw new Error('Choose an automation.')
        const id = brandString<AutomationId>(input.id)
        if (endpoint === 'run') return this.runNow(id)
        await this.remove(id)
        return { deleted: true }
      }
      default: throw new Error('Unknown automation operation.')
    }
  }

  /**
   * The latest scheduled occurrence of each schedule trigger of an active definition that neither a run record of
   * this Host nor that trigger's admission watermark, which the account's Hosts share, covers.
   * @returns one entry per uncovered schedule trigger, with the trigger's index.
   */
  private unadmitted(
    domain: Domain<typeof automationDomain>, definition: AutomationDefinition, now: string,
  ): { index: number; at: string }[] {
    if (definition.status !== 'active') return []
    return definition.triggers.flatMap((trigger, index) => {
      if (trigger.kind !== 'schedule') return []
      const latest = latestDueOccurrence(trigger.schedule, now)
      if (latest === null) return []
      const mark = definition.lastAdmittedAt[String(index)]
      const admitted = Math.max(Date.parse(definition.updatedAt), mark === undefined ? -Infinity : Date.parse(mark))
      return Date.parse(latest) > admitted && domain.table('runs').get(this.occurrenceId(definition.id, index, latest)) === undefined ? [{ index, at: latest }] : []
    })
  }

  private arm(domain: Domain<typeof automationDomain>): void {
    clearTimeout(this.timer)
    if (this.stopped) return
    const now = new Date().toISOString()
    const due = [...domain.table('definitions').entries()].flatMap(([, value]) => {
      if (value.status !== 'active') return []
      // An occurrence another device's claim covers is due again only once this device's claim changes, and
      // one this Host may never admit is not due here at all.
      const waiting = this.unadmitted(domain, value, now).filter(({ index, at }) => this.deferred.get(value.id) !== `${index}:${at}`)
        .map(({ at }) => this.admitsFrom(value, at)).filter(from => from !== Infinity).map(from => Math.max(Date.now(), from))
      if (waiting.length > 0) return waiting
      const next = this.nextRunAt(value, now)
      return next === null ? [] : [Date.parse(next)]
    })
    if (due.length === 0) return
    this.timer = setTimeout(() => {
      void this.transaction(async (current) => {
        const at = new Date().toISOString()
        for (const [, definition] of current.table('definitions').entries()) {
          for (const occurrence of this.unadmitted(current, definition, at)) {
            const from = this.admitsFrom(definition, occurrence.at)
            if (from === Infinity) { await this.release(definition); break }
            if (Date.now() < from) continue
            // While the account is served here, one of its devices runs an automation's occurrence.
            if (!await this.claimsScheduler(definition)) {
              this.deferred.set(definition.id, `${occurrence.index}:${occurrence.at}`)
              continue
            }
            this.deferred.delete(definition.id)
            const latest = current.table('definitions').get(definition.id) ?? definition
            await this.admit(current, latest, { trigger: 'schedule', triggerIndex: occurrence.index, scheduledFor: occurrence.at })
          }
          // The cloud Host takes the next occurrence back once it can.
          if (this.yields(definition) && this.unadmitted(current, current.table('definitions').get(definition.id) ?? definition, at).length === 0) await this.release(definition)
        }
        this.drain(current)
        this.arm(current)
      }).catch((error: unknown) => { this.stopped = true; clearTimeout(this.timer); this.ctx.logger.error(error) })
    }, Math.min(2_147_483_647, Math.max(0, Math.min(...due) - Date.now())))
  }

  /** Look at the schedule again after something outside a transaction changed what is due here. */
  private rearm(): void {
    void this.transaction((domain) => { this.arm(domain); return Promise.resolve() }).catch(() => {
      // A stopping Host refuses the transaction; nothing remains to schedule.
    })
  }

  /**
   * The registered Hosts of an account, this one included.
   * @param owner - the account, or undefined for a definition without one.
   * @returns the profiles placement reads; only this Host's while sync does not serve the account here.
   */
  private hostsOf(owner: string | undefined): readonly HostProfile[] {
    const hosts = owner === undefined ? [] : this.synced.hosts(owner)
    return hosts.length === 0 ? [this.here(owner)] : hosts
  }

  /**
   * This Host's profile for one account: the configured placement and, while account sync serves the account here,
   * this device's id in the account's vault.
   * @param owner - the account, or undefined for a definition without one.
   * @returns the profile placement reads for this Host.
   */
  private here(owner: string | undefined): HostProfile {
    const device = owner === undefined ? undefined : this.ctx.get('sync')?.status(owner).device
    return device === undefined ? this.config.placement : { ...this.config.placement, device }
  }

  /**
   * Whether this Host leaves a definition's scheduled runs to the account's cloud Host first: it is a
   * `fallback` for the definition and a cloud Host registered for the account.
   */
  private yields(definition: AutomationDefinition): boolean {
    return eligibility(definition, this.here(definition.owner)) === 'fallback' && this.hostsOf(definition.owner).some(host => host.kind === 'cloud')
  }

  /**
   * The earliest instant this Host may admit one scheduled occurrence.
   * @param definition - the automation that is due.
   * @param occurrence - the scheduled instant.
   * @returns milliseconds since the Unix epoch, or `Infinity` when this Host may never run the definition.
   */
  private admitsFrom(definition: AutomationDefinition, occurrence: string): number {
    if (eligibility(definition, this.here(definition.owner)) === 'never') return Infinity
    return Date.parse(occurrence) + (this.yields(definition) ? this.config.sync.fallbackDelayMs : 0)
  }

  /** Give up this device's claim on one automation's scheduled runs, when it holds or awaits one. */
  private async release(definition: AutomationDefinition): Promise<void> {
    const key = `${definition.owner ?? ''}\n${definition.id}`
    const holder = this.leases.get(key)
    if (holder === undefined) return
    this.leases.delete(key)
    await holder.dispose()
  }

  /**
   * Store one definition and publish it to the account's other devices.
   * @param domain - the open definition domain.
   * @param definition - the definition to store.
   * @returns when the definition is durable.
   */
  private async store(domain: Domain<typeof automationDomain>, definition: AutomationDefinition): Promise<void> {
    await domain.table('definitions').put(definition.id, definition)
    const owner = definition.owner
    if (owner === undefined) return
    this.synced.publish(owner, definition).catch((error: unknown) => {
      this.ctx.logger.warn(`automations: the definition was not published to the account: ${String(error)}`)
    })
  }

  /** Publish the removal of one automation to the account's other devices. */
  private forget(definition: AutomationDefinition): void {
    const owner = definition.owner
    if (owner === undefined) return
    this.synced.forget(owner, definition.id, Date.now()).catch((error: unknown) => {
      this.ctx.logger.warn(`automations: the removal was not published to the account: ${String(error)}`)
    })
  }

  /**
   * Apply another device's definition or removal when it is newer than what this device holds.
   * @param id - the automation.
   * @param entry - the synced definition or its removal.
   */
  private applySynced(id: AutomationId, entry: SyncedDefinition): void {
    void this.transaction(async (domain) => {
      const current = domain.table('definitions').get(id)
      // A later edit wins over an earlier one, and a removal wins over an edit stored at the same instant.
      if (current !== undefined && Date.parse(current.updatedAt) > entry.changedAt) return
      if (entry.definition === undefined) {
        if (current === undefined) return
        await domain.table('definitions').delete(id)
        this.arm(domain)
        return
      }
      if (current !== undefined && JSON.stringify(current) === JSON.stringify(entry.definition)) return
      await domain.table('definitions').put(id, entry.definition)
      this.arm(domain)
    }).catch((error: unknown) => {
      this.ctx.logger.warn(`automations: another device's automation was not stored: ${String(error)}`)
    })
  }

  /**
   * Whether this device may admit one automation's scheduled occurrence: always while sync does not serve the
   * automation's account, and otherwise only while this device holds the automation's claim.
   * @param definition - the automation that is due.
   * @returns whether to admit the occurrence.
   */
  private async claimsScheduler(definition: AutomationDefinition): Promise<boolean> {
    const owner = definition.owner
    if (owner === undefined) return true
    const sync = this.ctx.get('sync')
    const state = sync?.status(owner).state
    if (sync === undefined || state === undefined || state === 'disabled' || state === 'starting') return true
    const key = `${owner}\n${definition.id}`
    let holder = this.leases.get(key)
    if (holder === undefined) {
      const id = definition.id
      holder = new LeaseHolder(sync, owner, `automations/${id}`, {
        ttlMs: this.config.sync.leaseTtlMs, renewMs: this.config.sync.leaseRenewMs,
      }, {
        // Gaining the claim makes a waiting occurrence due here; the scheduler looks again. A claim gained
        // with nothing left to admit goes back to the cloud Host this device yields to.
        changed: (held) => {
          if (!held) return
          this.deferred.delete(id)
          void this.transaction(async (domain) => {
            const current = domain.table('definitions').get(id)
            const idle = current !== undefined && this.unadmitted(domain, current, new Date().toISOString()).length === 0
            if (current !== undefined && idle && this.yields(current)) await this.release(current)
            this.arm(domain)
          }).catch(() => {
            // A stopping Host refuses the transaction; nothing remains to schedule.
          })
        },
      })
      this.leases.set(key, holder)
      holder.start()
    }
    await holder.renew()
    return holder.held()
  }

  /**
   * Whether this device may execute an automation: a Host whose profile the definition's placement accepts, on
   * any device of an account that sync serves here, since its definitions are the account's; otherwise only on
   * the device that created it.
   * @param domain - the open definition domain.
   * @param definition - the automation.
   * @returns whether this device may admit its runs.
   */
  private runsHere(domain: Domain<typeof automationDomain>, definition: AutomationDefinition): boolean {
    if (eligibility(definition, this.here(definition.owner)) === 'never') return false
    const owner = definition.owner
    const state = owner === undefined ? undefined : this.ctx.get('sync')?.status(owner).state
    if (state !== undefined && state !== 'disabled' && state !== 'starting') return true
    return definition.executionTarget.runnerId === this.runnerId(domain)
  }

  /**
   * Identity of one occurrence: the bot, the trigger, and the instant, event, key, or handoff that caused it, so
   * every Host that admits the same occurrence names the same run.
   */
  private occurrenceId(id: AutomationId, index: number, cause: string): AutomationRunId {
    return brandString<AutomationRunId>(createHash('sha256').update(`${id}:${index}:${cause}`).digest('hex'))
  }

  /**
   * Store one occurrence as queued, or as skipped with the reason: a stale scheduled instant, another run of the bot
   * under `overlap: skip`, a full queue under `overlap: queue`, or a board budget it would exceed.
   * @param domain - the open definition domain.
   * @param definition - the bot as admitted; the run keeps this snapshot.
   * @param occurrence - what woke the bot and the provenance the run record carries.
   * @returns the stored run.
   */
  private async admit(domain: Domain<typeof automationDomain>, definition: AutomationDefinition, occurrence: {
    trigger: AutomationTrigger
    scheduledFor: string
    triggerIndex?: number
    retryOfRunId?: AutomationRunId | null
    payload?: string | null
    requestedId?: AutomationRunId
    event?: AutomationRun['event']
    handoff?: AutomationRun['handoff']
  }): Promise<AutomationRun> {
    if (!this.runsHere(domain, definition)) {
      throw new Error(this.config.placement.kind === 'cloud'
        ? 'This bot needs your computer. Run it from Aeven on that computer.'
        : 'This bot cannot run on this computer.')
    }
    const { trigger, scheduledFor } = occurrence
    const active = [...domain.table('runs').entries()].map(([, run]) => run).filter(run => run.definition.id === definition.id && (run.status === 'queued' || run.status === 'running'))
    const overlapping = active.length > 0 && definition.overlap === 'skip'
    const full = definition.overlap === 'queue' && active.filter(run => run.status === 'queued').length >= this.config.queueDepth
    const stale = trigger === 'schedule' && Date.now() - Date.parse(scheduledFor) > this.config.misfireGraceMinutes * 60_000
    const budget = this.budgetRefusal(domain, definition)
    const error = overlapping ? 'A previous run is still active.'
      : full ? `This bot already has ${this.config.queueDepth} runs waiting.`
        : stale ? 'Missed while this computer was unavailable.'
          : budget ?? null
    const run: AutomationRun = {
      // A scheduled occurrence is its automation, trigger, and instant, so a second Host admits it once; an event or
      // handoff is its trigger and the cause's own id; an inbound or manual run is one request.
      id: occurrence.requestedId ?? (trigger === 'schedule' ? this.occurrenceId(definition.id, occurrence.triggerIndex ?? 0, scheduledFor) : brandString<AutomationRunId>(randomUUID())), definition,
      trigger, scheduledFor, status: error === null ? 'queued' : 'skipped', sessionId: null, startedAt: null,
      finishedAt: error === null ? null : new Date().toISOString(), summary: null, error,
      admittedBy: this.runnerId(domain), retryOfRunId: occurrence.retryOfRunId ?? null, triggerIndex: occurrence.triggerIndex ?? null,
      payload: occurrence.payload ?? null, event: occurrence.event ?? null, handoff: occurrence.handoff ?? null,
      usage: null, resolution: null,
    }
    await this.storeRun(domain, run)
    if (trigger === 'schedule') await this.advanceAdmission(domain, definition.id, occurrence.triggerIndex ?? 0, scheduledFor)
    await this.prune(domain)
    return run
  }

  /**
   * The ceiling a new run of a bot would exceed on one of its boards, named for the run record and the chain view.
   * @param domain - the open definition domain.
   * @param definition - the bot about to run.
   * @returns the refusal, or undefined while every board of the bot has room.
   */
  private budgetRefusal(domain: Domain<typeof automationDomain>, definition: AutomationDefinition): string | undefined {
    const since = Date.now() - 86_400_000
    const runs = this.runs(domain)
    for (const [, board] of domain.table('boards').entries()) {
      if (board.owner !== definition.owner || !board.members.includes(definition.id)) continue
      const members = new Set<AutomationId>(board.members)
      const { maxConcurrentRuns, maxTokensPerDay } = board.budget
      if (maxConcurrentRuns !== undefined && runs.filter(run => members.has(run.definition.id) && (run.status === 'queued' || run.status === 'running')).length >= maxConcurrentRuns) {
        return `Board “${board.name}” allows at most ${maxConcurrentRuns} member runs at once.`
      }
      if (maxTokensPerDay !== undefined) {
        const counted = new Set<AutomationRunId>()
        let spent = 0
        for (const run of runs) {
          if (!members.has(run.definition.id) || run.finishedAt === null || Date.parse(run.finishedAt) < since) continue
          counted.add(run.id)
          spent += run.usage?.totalTokens ?? 0
        }
        // Runs another Host admitted reach this one through the handoffs their results settled.
        for (const [, handoff] of domain.table('handoffs').entries()) {
          if (handoff.run === null || counted.has(handoff.run) || !members.has(handoff.to)) continue
          if (Date.parse(handoff.updatedAt) < since) continue
          spent += handoff.tokens ?? 0
        }
        if (spent >= maxTokensPerDay) return `Board “${board.name}” has spent its budget of ${maxTokensPerDay} tokens for the last 24 hours.`
      }
    }
    return undefined
  }

  private drain(domain: Domain<typeof automationDomain>): void {
    if (this.stopped) return
    const queued = [...domain.table('runs').entries()].map(([, run]) => run)
      .filter(run => run.admittedBy === this.runnerId(domain) && run.status === 'queued' && !this.active.has(run.id))
      .sort((a, b) => Date.parse(a.scheduledFor) - Date.parse(b.scheduledFor))
    for (const run of queued) {
      const owner = run.definition.owner
      // An account at its limit waits for one of its own runs; other accounts' queued runs still start.
      const limit = this.config.maxConcurrentRunsPerAccount
      if (limit !== undefined && [...this.active.values()].filter(entry => entry.owner === owner).length >= limit) continue
      // A queued occurrence of a bot that does not run in parallel waits for the bot's run in progress.
      const current = domain.table('definitions').get(run.definition.id)
      if ((current?.overlap ?? run.definition.overlap) !== 'parallel' && [...this.active.values()].some(entry => entry.definition === run.definition.id)) continue
      const entry: ActiveRun = { owner, definition: run.definition.id, promise: Promise.resolve() }
      this.active.set(run.id, entry)
      entry.promise = this.ctx.identityUsers.runAs(
        run.definition.owner === undefined ? undefined : { id: run.definition.owner },
        () => this.execute(domain, run, entry),
      ).catch((error: unknown) => { this.stopped = true; clearTimeout(this.timer); this.ctx.logger.error(error) }).finally(() => {
        this.active.delete(run.id)
        this.drain(domain)
        this.pumpHandoffs()
      })
    }
  }

  /**
   * Execute one admitted run in a fresh root conversation of the Automations workspace.
   * Approvals reach the owner's open client or a saved grant; without either they fail closed. The
   * conversation stays live after the run so the owner can open it, continue it, and grant what it needed.
   */
  private async execute(domain: Domain<typeof automationDomain>, run: AutomationRun, entry: ActiveRun): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined
    let timedOut = false
    let releaseGuard: (() => void) | undefined
    const sessionId = SessionId(`session-${randomUUID()}`)
    const startedAt = new Date().toISOString()
    const running: AutomationRun = { ...run, status: 'running', sessionId, startedAt }
    // A stop lands from another call while this one awaits, so each read goes through a call TypeScript does not narrow.
    const stopRequested = (): boolean => entry.stopRequested === true
    await this.storeRun(domain, running)
    this.executionSessions.add(sessionId)
    try {
      const preset = await this.ctx.agentPresets.resolve(run.definition.agentPreset)
      const workspace = await this.workspace()
      const handle = await this.ctx.agents.withoutInitiator(() => this.ctx.agents.create({
        sessionId, meta: { agentPreset: preset.id, ...run.definition.owner === undefined ? {} : { owner: run.definition.owner } },
        agentOptions: { provider: run.definition.model.provider, model: run.definition.model.model },
        setup: async (agentCtx) => {
          await this.ctx.agentPresets.mount(agentCtx, preset.id)
          installModelSelection(agentCtx, { current: run.definition.model, assembled: undefined })
          const agent = agentCtx.agent
          if (agent === undefined) throw new Error('Automation agent was not created.')
          this.ctx.permissionPresets.set(agent.session, run.definition.permission)
          setApprovalPolicy(agent.session, 'ask')
          // The connector binding is the stored one, so an owner's narrowing applies from the next run on.
          const connectors = domain.table('definitions').get(run.definition.id)?.connectors ?? run.definition.connectors
          this.bindings.set(sessionId, connectors)
          releaseGuard = agentCtx.tools.guard(exec => exec.name.startsWith('automation_') || exec.name === 'ask_user'
            ? 'Bots cannot create more unattended work or ask interactive questions.'
            : connectorRefusal(connectors, exec.name))
          agentCtx.effect(() => registerRunTools(agentCtx, this.runToolsAccess(domain, run)))
        },
      }))
      entry.handle = handle
      if (this.stopped) throw new Error('Automation Host is stopping.')
      await workspace.attachSession(sessionId)
      this.ctx.sessionTitle.rename(handle.agent.session, run.definition.name)
      await handle.agent.whenIdle()
      if (stopRequested()) throw new Error(STOPPED)
      handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: runNotice(run) }], source: { kind: 'plugin', plugin: 'automations', form: 'notice', summary: boundContextSummary(run.definition.name) } }))
      timeout = setTimeout(() => { timedOut = true; handle.agent.cancel({ kind: 'user' }) }, this.config.runTimeoutMinutes * 60_000)
      await handle.agent.whenIdle()
      await this.ctx.sessions.flush(handle.agent.session)
      const events = handle.agent.session.snapshotEvents()
      const end = [...events].reverse().find(event => event.type === 'turn/end')
      const messages = events.filter(event => event.type === 'assistant/message')
      const last = messages.at(-1)
      const summary = last?.type === 'assistant/message' ? last.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n') : null
      const completed = end?.type === 'turn/end' && end.data.reason.kind === 'completed'
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- the run timeout is set while the turns above are awaited.
      const status = stopRequested() ? 'cancelled' : completed && !timedOut ? 'succeeded' : this.stopped ? 'cancelled' : 'failed'
      const error = stopRequested() ? STOPPED
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- the run timeout is set while the turns above are awaited.
        : timedOut ? 'Execution timed out.' : completed ? null : 'Execution did not complete; inspect its conversation.'
      const settled: AutomationRun = { ...running, status, finishedAt: new Date().toISOString(), summary, error, usage: usageOf(events) }
      await this.storeRun(domain, settled)
      await this.settleRun(domain, settled)
    } catch (error) {
      const status = stopRequested() ? 'cancelled' : 'failed'
      const message = error instanceof Error ? error.message : String(error)
      const usage = entry.handle === undefined ? null : usageOf(entry.handle.agent.session.snapshotEvents())
      const settled: AutomationRun = { ...running, status, finishedAt: new Date().toISOString(), error: message, usage }
      await this.storeRun(domain, settled)
      await this.settleRun(domain, settled)
    } finally {
      clearTimeout(timeout)
      releaseGuard?.()
      this.bindings.delete(sessionId)
      this.executionSessions.delete(sessionId)
      await this.prune(domain)
    }
  }
}
export default Automations
