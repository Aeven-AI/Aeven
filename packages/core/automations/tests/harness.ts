/**
 * Shared mounting for the automation behavior suites.
 *
 * The subject is the real `Automations` service, the real storage-domain layer
 * over an in-memory medium, and the real Host web server on an OS-assigned
 * port. The peer services a run touches (agent registry, presets, workspace,
 * sessions, tools, connection, titles) are recording doubles: their real
 * implementations own composition the suites do not exercise, and every
 * assertion here reads the service's own HTTP surface, its durable tables, or
 * the message it hands to the run conversation.
 */
import { Context } from '@deepseek-ai/cordis'
import type { UserMessage } from '@aeven/llm'
import IdentityUsers from '@aeven/identity-user'
import WebServer from '@aeven/host-webserver'
import { DomainFacility } from '@aeven/storage-domain'
import { SessionId } from '@aeven/session'
import { vi } from 'vitest'
import type { ToolDefinition } from '@aeven/tools'
import Automations, { type Config } from '../src/index.ts'
import { registerAutomationTools } from '../src/tools.ts'
import type { AutomationDefinition, AutomationInput, AutomationRun, AutomationSchedule } from '../src/types.ts'

/** The definitions projection one `list()` call returns. */
export type AutomationList = Awaited<ReturnType<Automations['list']>>

/** One unit's stored records: table name → record key → value, what a medium holds. */
type UnitTables = Map<string, Map<string, unknown>>

/**
 * Storage medium double: the KV surface `DomainFacility` reads, held in maps so
 * a suite can inspect exactly what the service stored.
 */
export class MemoryMedium {
  private readonly units = new Map<string, UnitTables>()

  readonly kv = {
    open: async (descriptor: { readonly name: string; readonly tables: readonly string[] }) => {
      const tables: UnitTables = new Map(descriptor.tables.map(table => [table, new Map<string, unknown>()]))
      this.units.set(descriptor.name, tables)
      return {
        loadAll: async () => ({
          tables: Object.fromEntries([...tables].map(([table, records]) => [table, Object.fromEntries(records)])),
          global: null,
        }),
        putRecord: async (table: string, key: string, value: unknown) => { tables.get(table)?.set(key, value) },
        deleteRecord: async (table: string, key: string) => { tables.get(table)?.delete(key) },
        // The medium outlives a closed unit, as a real one does.
        close: async () => {},
      }
    },
  }

  /** Records one stored table as plain objects, keyed by record key. */
  table(unit: string, table: string): Record<string, unknown> {
    return Object.fromEntries(this.units.get(unit)?.get(table) ?? [])
  }

  /** Every stored record of one table, serialized, for asserting what a projection cannot carry. */
  json(unit: string, table: string): string {
    return JSON.stringify(this.table(unit, table))
  }
}

/** The session a run conversation would own; the notice and turn outcome come from the double. */
class RunSession {
  readonly header = {}
  seq = 1
  readonly appended: Array<{ type: string; data: unknown }> = []

  constructor(readonly id: SessionId) {}

  append(type: string, data: unknown): void { this.appended.push({ type, data }) }

  eventAt(): undefined { return undefined }

  /** One completed turn, so the service records the run as succeeded. */
  snapshotEvents(): Array<{ type: string; data: unknown }> {
    return [{ type: 'turn/end', data: { reason: { kind: 'completed' } } }]
  }
}

/**
 * The agent of one run conversation.
 *
 * `whenIdle` resolves while the conversation is idle; `holdNextIdle` arms one
 * idle wait that stays pending until `release`, which places the run in the
 * middle of its turn deterministically instead of racing a sleep.
 */
class RunAgent {
  readonly sent: UserMessage[] = []
  private readonly waiting: (() => void)[] = []
  private held: (() => void) | undefined
  private idle = true

  constructor(readonly session: RunSession) {}

  /** Keep the next idle wait pending until the suite releases it. */
  holdNextIdle(): void {
    this.idle = false
    this.held = () => {}
  }

  /** Let the held idle wait and every later one resolve. */
  release(): void {
    const held = this.held
    this.held = undefined
    this.idle = true
    held?.()
    for (const resolve of this.waiting.splice(0)) resolve()
  }

  whenIdle(): Promise<void> {
    if (this.held !== undefined) return new Promise<void>((resolve) => { this.held = resolve })
    return this.idle ? Promise.resolve() : new Promise<void>((resolve) => { this.waiting.push(resolve) })
  }

  followup(message: UserMessage): void {
    this.sent.push(message)
    this.release()
  }

  cancel(): void { this.release() }
}

/** One run conversation the service created, and the agent that received its notice. */
export interface RunConversationHandle {
  readonly session: RunSession
  readonly agent: RunAgent
}

/** Agent-registry double: records the run conversations the service creates. */
export class RecordingAgents {
  readonly conversations: RunConversationHandle[] = []

  constructor(private readonly ctx: Context) {}

  /** Root conversations this registry holds; the suites own tool installation directly. */
  roots(): readonly unknown[] { return [] }

  withoutInitiator<T>(work: () => T): T { return work() }

  /** Arm the next created run so its first idle wait stays pending until `release`. */
  holdNextRun(): void { this.holdNext = true }

  /** Release every run conversation created so far. */
  release(): void {
    for (const conversation of this.conversations) conversation.agent.release()
  }

  private holdNext = false

  async create(options: {
    readonly sessionId: SessionId
    readonly setup?: (agentContext: never) => Promise<void>
  }): Promise<{ readonly agent: RunAgent }> {
    const session = new RunSession(options.sessionId)
    const agent = new RunAgent(session)
    if (this.holdNext) {
      this.holdNext = false
      agent.holdNextIdle()
    }
    this.conversations.push({ session, agent })
    // The real registry hands `setup` a child context carrying the agent and the
    // agent-scoped tool layer; `installModelSelection` reads `on` from it.
    const agentContext = {
      agent,
      on: this.ctx.on.bind(this.ctx),
      tools: { guard: () => () => {} },
    }
    await options.setup?.(agentContext as never)
    return { agent }
  }
}

/** Tool-registry double: records the definitions one root agent publishes. */
export class RecordingTools {
  readonly registered = new Map<string, ToolDefinition>()

  register(definition: ToolDefinition): () => void {
    this.registered.set(definition.name, definition)
    return () => { this.registered.delete(definition.name) }
  }

  get(name: string): ToolDefinition | undefined { return this.registered.get(name) }

  guard(): () => void { return () => {} }
}

/** Built-in workspace double: records the run conversations the service attaches. */
export class RecordingWorkspace {
  readonly sessionIds: SessionId[] = []
  async attachSession(sessionId: SessionId): Promise<void> { if (!this.sessionIds.includes(sessionId)) this.sessionIds.push(sessionId) }
  async detachSession(): Promise<void> {}
}

/** Mounted automation Host under test. */
export interface AutomationHarness {
  readonly ctx: Context
  readonly automations: Automations
  readonly agents: RecordingAgents
  readonly tools: RecordingTools
  readonly workspace: RecordingWorkspace
  readonly medium: MemoryMedium
  /** `http://127.0.0.1:<assigned port>` of the Host web server the route lives on. */
  readonly origin: string
  dispose(): Promise<void>
}

/** Limits the built-in Web profile ships, with a small body cap so a suite can reach it. */
export const TEST_CONFIG: Config = {
  maxConcurrentRuns: 2,
  runTimeoutMinutes: 60,
  misfireGraceMinutes: 15,
  historyLimit: 200,
  workspaceTitle: 'Automations',
  webhookMaxBodyBytes: 32,
  sync: { leaseTtlMs: 180_000, leaseRenewMs: 60_000 },
}

/**
 * Mount the automation service with the Host web server and recording peers.
 * @param overrides - config values a suite changes from {@link TEST_CONFIG}.
 * @returns the mounted Host, ready to answer requests.
 */
export async function mountAutomations(overrides: Partial<Config> = {}): Promise<AutomationHarness> {
  const ctx = new Context()
  const medium = new MemoryMedium()
  // The medium is the only faked storage surface; the domain layer, its record
  // schemas, and its write chain stay real.
  ctx.provide('storage', { backend: { get: () => medium } })
  // Constructed rather than mounted through the hub: the hub's other jobs are
  // invariant resolution, which this package does not publish.
  ctx.provide('storageDomain', new DomainFacility(ctx, { backend: 'memory' }))
  await ctx.plugin(IdentityUsers)
  const agents = new RecordingAgents(ctx)
  const tools = new RecordingTools()
  const workspace = new RecordingWorkspace()
  ctx.provide('agents', agents)
  ctx.provide('tools', tools)
  ctx.provide('sessions', { flush: async () => {} })
  ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'test-provider', model: 'test-model' }) })
  ctx.provide('agentPresets', {
    defaultId: 'test-preset',
    resolve: async (id: string) => ({ id }),
    mount: async () => {},
  })
  ctx.provide('permissionPresets', { set: () => {} })
  ctx.provide('sessionTitle', { rename: () => {} })
  ctx.provide('connection', { rpc: { handle: () => () => {} } })
  ctx.provide('workspaceRegistry', {
    builtIn: async () => workspace,
    list: () => [],
    archivedSessionIds: [] as string[],
    archiveSession: async () => {},
  })
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(Automations, { ...TEST_CONFIG, ...overrides })
  const automations = ctx.automations
  // Startup opens both domains and sweeps the tables; this settles that work
  // before a suite inspects the medium.
  await automations.list()
  return {
    ctx,
    automations,
    agents,
    tools,
    workspace,
    medium,
    origin: `http://127.0.0.1:${String(ctx.webServer.port)}`,
    dispose: async () => { await ctx.fiber.dispose() },
  }
}

/**
 * Install the management tools on a stand-in root conversation of this Host.
 * @param harness - mounted Host; its tool registry double records the definitions.
 * @returns disposer removing every tool the call registered.
 */
export function installManagementTools(harness: AutomationHarness): () => void {
  const agent = { ctx: harness.ctx, session: { id: SessionId('automation-tools-root'), header: {} } }
  return registerAutomationTools(harness.automations, agent as never, harness.ctx.identityUsers)
}

/** A far-future calendar recurrence, so a suite's own creation arms no near timer. */
export const QUIET_SCHEDULE: AutomationSchedule = { kind: 'cron', expression: '0 0 1 1 *', timeZone: 'UTC' }

/**
 * Create one owned automation with a schedule whose next occurrence is far away.
 * @param harness - mounted Host.
 * @param overrides - editable values a suite changes.
 * @returns the stored definition.
 */
export function createAutomation(harness: AutomationHarness, overrides: Partial<AutomationInput> = {}): Promise<AutomationDefinition> {
  return harness.automations.create({
    name: 'Nightly report',
    prompt: 'Write the nightly report and verify its numbers.',
    schedule: QUIET_SCHEDULE,
    permission: 'read-only',
    ...overrides,
  })
}

/** Read the current `list()` projection. */
export async function listAutomations(harness: AutomationHarness): Promise<AutomationList> {
  return harness.automations.list()
}

/** Read one stored run record from the projection. */
export async function runRecord(harness: AutomationHarness, id: string): Promise<AutomationRun | undefined> {
  return (await harness.automations.list()).runs.find(run => run.id === id)
}

/**
 * Wait until `probe` returns a value, sampling on the timer rather than a fixed sleep.
 * @param probe - observed state; `undefined` keeps waiting.
 * @param label - state named in the timeout diagnostic.
 * @param timeoutMs - bound on the wait, never the condition.
 * @returns the first value the probe returned.
 */
export async function waitFor<T>(probe: () => Promise<T | undefined>, label: string, timeoutMs = 5_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await probe()
    if (value !== undefined) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
    await new Promise<void>((resolve) => { setTimeout(resolve, 5) })
  }
}

/**
 * Move a faked clock forward, let the work it starts settle, and return the state
 * the probe reports. Authored for suites that control the clock, where `waitFor`
 * cannot wait: it samples a settle budget instead of wall time.
 * @param ms - time to advance, firing every timer that falls inside it.
 * @param probe - observed state; `undefined` keeps settling.
 * @param label - state named in the failure diagnostic.
 * @returns the first value the probe reported.
 */
export async function advanceUntil<T>(ms: number, probe: () => Promise<T | undefined>, label: string): Promise<T> {
  await vi.advanceTimersByTimeAsync(ms)
  for (let turn = 0; turn < 500; turn += 1) {
    const value = await probe()
    if (value !== undefined) return value
    await vi.advanceTimersByTimeAsync(0)
  }
  throw new Error(`timed out waiting for ${label}`)
}
