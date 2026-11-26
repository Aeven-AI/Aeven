/** Session-owned user terminals with the execution environment's system-user permissions. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool, jsonStringOutput } from '@aeven/tools'
import { assertNever } from '@aeven/util-values'
import type { Agent } from '@aeven/agent'
import type { SessionId } from '@aeven/session'
import type {} from '@aeven/sandbox-policy'
import type {} from '@aeven/session-query'
import type {} from '@aeven/api-session-controller'
import { observedSessionDirectory, sessionDirectory, WorkingDirectoryUnavailableError, type LocalDirectoryProblem } from '@aeven/working-directory'
import type {} from '@aeven/identity-user'
import { Remote, RemoteError, TypertRemoteService } from '@aeven/typert-protocol'
import { scopeTarget } from '@aeven/scope'
import { randomUUID } from 'node:crypto'
import { discoverShells, resolveShell } from './shells.ts'
import { BrowserTerminal } from './terminal.ts'
import { TerminalRetention, UNKNOWN_ACTIVITY } from './retention.ts'
import type {
  TerminalShell, TerminalAttachmentId, TerminalCreateRequest, TerminalEnvironment, TerminalFrame, TerminalRetentionFrame,
  WebTerminalId, WebTerminalInfo,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Interactive user terminals shared by the sidebar and session-scoped model tools. */
    terminalController: TerminalController
  }
}

/** Deployment limits, an optional shell profile, and where a Session's user shells run. */
export interface Config {
  /**
   * Run a Session's user shells on this Host's own execution providers, in this device's folder for the Session's
   * workspace, without resuming its Agent; the shells then live as long as the Host. A desktop Host, whose providers
   * are the user's own machine, enables it, so a conversation it holds only as a synced copy still opens a terminal
   * and a handover to another device leaves its shells running. A Host that runs each Session in its Agent's sandbox
   * leaves it off, and its shells start in that sandbox and end with the Agent.
   */
  readonly hostShells: boolean
  /** Explicit shell profile; omission uses the execution environment's default shell. */
  readonly shell?: {
    /** Executable path or PATH name, verified by the subprocess provider. */
    path: string
    /** User-visible profile name. */
    name: string
    /** Arguments passed to the interactive shell. */
    args: string[]
  } | undefined
  /** Executable names or paths checked for the new-terminal shell selector. */
  readonly shellCandidates: string[]
  /** Maximum retained terminals and pending allocations per Session. */
  readonly maxTerminals: number
  /** Maximum terminal width in columns. */
  readonly maxCols: number
  /** Maximum terminal height in rows. */
  readonly maxRows: number
  /** Screen history rows retained for reconnecting clients. */
  readonly scrollback: number
  /** Maximum queued UTF-8 frame bytes per output follower before disconnection. */
  readonly maxBufferedBytes: number
  /** Maximum UTF-8 bytes in one input request. */
  readonly maxInputBytes: number
  /** Maximum UTF-8 bytes of screen text returned by one model read. */
  readonly maxToolOutputBytes: number
  /** Provider process-termination grace period in milliseconds. */
  readonly disposeGraceMs: number
  /** Continuous confirmed idle time without window holds before reclamation; zero disables reclamation. */
  readonly unattendedTimeoutMs: number
  /** Interval between unattended shell and process observations. */
  readonly activityPollIntervalMs: number
  /** Delay before retrying failed owned terminal cleanup. */
  readonly cleanupRetryMs: number
  /** Columns of a shell the model opens, until the pane that shows it fits it to its width. */
  readonly openCols: number
  /** Rows of a shell the model opens, until the pane that shows it fits it to its height. */
  readonly openRows: number
  /** How long a model open waits for the window showing the Session to open its Terminal pill, and a send or close for its pointer. */
  readonly showTimeoutMs: number
}

/** Where one Session's user shells run and whom they belong to. */
interface TerminalPlace {
  readonly sessionId: SessionId
  /** Account the Session belongs to; only that account reaches its terminals. */
  readonly account: string | undefined
  readonly subprocess: Context['subprocess']
  /** Directory new shells start in. */
  readonly cwd: string
  /** The Agent context the Session's shells end with, or undefined when they live as long as the Host. */
  readonly lifetime: Context | undefined
}

interface TerminalAllocation {
  info: WebTerminalInfo
  readonly cleanup: TerminalRetention
}

interface OwnedSession {
  /** Account the Session belongs to; only that account reaches its terminals. */
  readonly account: string | undefined
  readonly lifetime: AbortController
  readonly closedIds: Set<WebTerminalId>
  cleanup?: Promise<void>
  readonly terminals: Map<WebTerminalId, BrowserTerminal>
  readonly pending: Map<WebTerminalId, Promise<BrowserTerminal>>
  readonly allocations: Map<WebTerminalId, TerminalAllocation>
}

/** Typed Remote control of transient Session-owned terminal processes. */
export class TerminalController extends TypertRemoteService {
  static inject = ['subprocess', 'sandboxPolicy', 'typert']
  static Config: z<Config> = z.object({
    hostShells: z.boolean().default(false),
    shell: z.union([z.object({
      path: z.string().required(), name: z.string().required(), args: z.array(z.string()).default([]),
    }), z.const(undefined)]),
    shellCandidates: z.array(z.string().min(1)).default(['zsh', 'bash', 'fish', 'cmd', 'powershell', 'pwsh']),
    maxTerminals: z.number().step(1).min(1).default(8),
    maxCols: z.number().step(1).min(2).default(500),
    maxRows: z.number().step(1).min(1).default(200),
    scrollback: z.number().step(1).min(0).default(1000),
    maxBufferedBytes: z.number().step(1).min(1024).default(2 * 1024 * 1024),
    maxInputBytes: z.number().step(1).min(1).default(64 * 1024),
    maxToolOutputBytes: z.number().step(1).min(4096).default(32 * 1024),
    disposeGraceMs: z.number().step(1).min(1).default(1000),
    unattendedTimeoutMs: z.number().step(1).min(0).max(Number.MAX_SAFE_INTEGER).default(7_200_000),
    activityPollIntervalMs: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(30_000),
    cleanupRetryMs: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(60_000),
    openCols: z.number().step(1).min(2).default(120),
    openRows: z.number().step(1).min(1).default(32),
    showTimeoutMs: z.number().step(1).min(1).default(5_000),
  })

  private readonly owners = new Map<SessionId, OwnedSession>()
  private readonly lifetime = new AbortController()

  /**
   * @param ctx - Host context carrying typed Remote and execution providers.
   * @param config - validated terminal limits and optional shell profile.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'terminalController', { namespace: 'terminal' })
    ctx.inject(['tools'], (scoped) => { this.registerTool(scoped) })
    ctx.effect(() => async () => {
      this.lifetime.abort(new Error('Terminal controller disposed'))
      const results = await Promise.allSettled([...this.owners].map(([id, owner]) => this.disposeOwner(id, owner)))
      const errors = results.filter(result => result.status === 'rejected').map(result => result.reason as unknown)
      if (errors.length > 0) throw new AggregateError(errors, 'Browser terminal cleanup failed')
    }, 'terminal-controller.processes')
  }

  /**
   * Read the Session's local working directory and terminal limits without resolving a shell.
   * @param sessionId - the Session whose terminals the window shows.
   * @param signal - request cancellation.
   * @returns the directory this device starts the Session's terminals in, and terminal limits.
   * @throws RemoteError `workspace/no-local-directory` when the Session's workspace has no folder on this device.
   */
  @Remote
  async environment(sessionId: SessionId, signal: AbortSignal): Promise<TerminalEnvironment> {
    const place = await this.place(sessionId, signal)
    return { cwd: place.cwd,
      maxInputBytes: this.config.maxInputBytes, maxCols: this.config.maxCols,
      maxRows: this.config.maxRows, scrollback: this.config.scrollback }
  }

  /**
   * Discover installed shells in the Session's execution environment.
   * @param sessionId - the Session whose terminals the window shows.
   * @param signal - request cancellation.
   * @returns verified profiles, with the configured or system default first.
   */
  @Remote
  async shells(sessionId: SessionId, signal: AbortSignal): Promise<TerminalShell[]> {
    const place = await this.place(sessionId, signal)
    return discoverShells(place.subprocess, this.config.shell, this.config.shellCandidates, signal)
  }

  /**
   * List retained terminals without resolving or activating an Agent.
   * @param sessionId - displayed Session identity, including offline history.
   * @returns terminals retained for this Host lifetime.
   */
  @Remote
  list(sessionId: SessionId): WebTerminalInfo[] {
    const owner = this.owners.get(sessionId)
    if (owner === undefined || !this.callerMayAccess(owner)) return []
    return [...owner.terminals.values(), ...owner.allocations.values()].map(terminal => terminal.info)
  }

  /**
   * Allocate a user shell once for a caller-generated identity, without Agent sandbox or approval restrictions.
   * @param sessionId - the Session the shell belongs to.
   * @param request - initial dimensions and idempotency identity.
   * @param signal - allocation cancellation; committed terminals survive disconnection.
   * @returns the existing or newly committed terminal.
   */
  @Remote
  async create(sessionId: SessionId, request: TerminalCreateRequest, signal: AbortSignal): Promise<WebTerminalInfo> {
    this.lifetime.signal.throwIfAborted()
    return this.createIn(await this.place(sessionId, signal), request, signal)
  }

  private async createIn(place: TerminalPlace, request: TerminalCreateRequest, signal: AbortSignal): Promise<WebTerminalInfo> {
    this.lifetime.signal.throwIfAborted()
    if (!/^[\w-]{1,128}$/u.test(request.id)) throw new Error('Invalid terminal identity')
    this.dimensions(request.cols, request.rows)
    const owner = this.owner(place)
    owner.lifetime.signal.throwIfAborted()
    this.requireOpen(owner, request.id)
    const existing = owner.terminals.get(request.id)
    if (existing !== undefined) return existing.info
    const pending = owner.pending.get(request.id)
    if (pending !== undefined) {
      const terminal = await pending
      this.requireOpen(owner, request.id)
      return terminal.info
    }
    if (new Set([...owner.terminals.keys(), ...owner.pending.keys(), ...owner.allocations.keys()]).size >= this.config.maxTerminals) throw new RemoteError('terminal/limit-reached', 'Session terminal limit reached', { limit: this.config.maxTerminals })
    const allocation = this.spawn(place, owner, request, AbortSignal.any([signal, this.lifetime.signal, owner.lifetime.signal]))
    owner.pending.set(request.id, allocation)
    try {
      const terminal = await allocation
      owner.terminals.set(request.id, terminal)
      owner.allocations.delete(request.id)
      terminal.monitor(this.config, () => { owner.closedIds.add(request.id) }, () => {
        owner.terminals.delete(request.id)
      }, (error) => { this.ctx.logger.error('Browser terminal cleanup failed', error) })
      this.requireOpen(owner, request.id)
      return terminal.info
    } finally {
      owner.pending.delete(request.id)
    }
  }

  /**
   * Retain an existing terminal for a window without activating its Agent or taking input control.
   * @param sessionId - owning Session identity, including an inactive saved layout.
   * @param id - retained Host terminal identity.
   * @param signal - physical Remote stream cancellation.
   * @returns a hold acknowledgement followed by an open lifetime stream.
   */
  @Remote({ mode: 'stream' })
  retain(sessionId: SessionId, id: WebTerminalId, signal: AbortSignal): AsyncIterable<TerminalRetentionFrame> {
    const owner = this.owners.get(sessionId)
    const terminal = owner !== undefined && this.callerMayAccess(owner) ? owner.terminals.get(id) : undefined
    if (terminal === undefined || owner?.closedIds.has(id) === true || owner?.lifetime.signal.aborted === true) {
      throw new RemoteError('terminal/unavailable', 'Terminal is closing or unavailable', {})
    }
    return terminal.retain(signal)
  }

  /**
   * Attach to a terminal without binding its process lifetime to the transport.
   * @param sessionId - the Session the terminal belongs to.
   * @param id - terminal identity.
   * @param attachmentId - new exclusive input attachment.
   * @param signal - physical stream cancellation.
   * @returns screen recovery followed by output and metadata changes.
   */
  @Remote({ mode: 'stream' })
  follow(sessionId: SessionId, id: WebTerminalId, attachmentId: TerminalAttachmentId, signal: AbortSignal): AsyncIterable<TerminalFrame> {
    if (!/^[\w-]{1,128}$/u.test(attachmentId)) throw new Error('Invalid terminal attachment identity')
    return this.callerTerminal(sessionId, id).follow(attachmentId, signal)
  }

  /**
   * Deliver raw input, including Tab completion and control characters.
   * @param sessionId - the Session the terminal belongs to.
   * @param id - terminal identity.
   * @param attachmentId - current writable attachment.
   * @param data - input bytes represented as UTF-8 text.
   * @returns after provider input acceptance.
   */
  @Remote
  async write(sessionId: SessionId, id: WebTerminalId, attachmentId: TerminalAttachmentId, data: string): Promise<void> {
    if (Buffer.byteLength(data, 'utf8') > this.config.maxInputBytes) throw new Error('Terminal input exceeds the configured limit')
    await this.callerTerminal(sessionId, id).write(attachmentId, data)
  }

  /**
   * Update the dimensions of the PTY and recovery screen.
   * @param sessionId - the Session the terminal belongs to.
   * @param id - terminal identity.
   * @param attachmentId - current writable attachment.
   * @param cols - column count.
   * @param rows - row count.
   * @returns after the resize completes.
   */
  @Remote
  async resize(sessionId: SessionId, id: WebTerminalId, attachmentId: TerminalAttachmentId, cols: number, rows: number): Promise<void> {
    this.dimensions(cols, rows)
    await this.callerTerminal(sessionId, id).resize(attachmentId, cols, rows)
  }

  /**
   * Rename a terminal without changing its shell.
   * @param sessionId - the Session the terminal belongs to.
   * @param id - terminal identity.
   * @param title - nonempty display title, at most 120 characters.
   */
  @Remote
  rename(sessionId: SessionId, id: WebTerminalId, title: string): void {
    this.callerTerminal(sessionId, id)
    this.renameIn(sessionId, id, title)
  }

  private renameIn(sessionId: SessionId, id: WebTerminalId, title: string): void {
    if (title.trim().length === 0 || title.length > 120) throw new Error('Terminal title must contain 1–120 characters')
    this.terminal(sessionId, id).rename(title.trim())
  }

  /**
   * Close an identity to future creation and kill its process range; repeated closes succeed, and closing in a
   * Session with no terminals on this Host does nothing.
   * @param sessionId - the Session the terminal belongs to.
   * @param id - terminal identity.
   * @returns after provider cleanup succeeds. A failure retains the terminal for retry.
   */
  @Remote
  async close(sessionId: SessionId, id: WebTerminalId): Promise<void> {
    const owner = this.owners.get(sessionId)
    if (owner === undefined || !this.callerMayAccess(owner)) return
    await this.closeIn(owner, id)
  }

  private async closeIn(owner: OwnedSession, id: WebTerminalId): Promise<void> {
    owner.closedIds.add(id)
    // create publishes the allocation before this wait settles; close owns it even if create then rejects.
    await owner.pending.get(id)?.catch(() => { /* Creation reports its failure; close still owns any allocated process. */ })
    const terminal = owner.terminals.get(id)
    if (terminal !== undefined) {
      await terminal.close()
      owner.terminals.delete(id)
    } else {
      const allocation = owner.allocations.get(id)
      if (allocation === undefined) return
      await allocation.cleanup.close()
      owner.allocations.delete(id)
    }
  }

  private registerTool(ctx: Context): void {
    ctx.on('tools/pre-execute', async (exec, next) => {
      const decision = await next()
      if (decision.kind !== 'allow' || exec.name !== 'sidebar_terminal' || exec.agent === undefined) return decision
      const args = exec.arguments
      if (typeof args !== 'object' || args === null || Array.isArray(args) || !('action' in args) || args.action === 'list') return decision
      const policy = this.execution(exec.agent).sandboxPolicy.resolve({ session: exec.agent.session })
      if (policy.mode === 'danger-full-access') return decision
      const id = 'terminalId' in args && typeof args.terminalId === 'string' ? args.terminalId : undefined
      if (id === undefined) return decision
      const terminal = this.terminal(exec.agent.id, id as WebTerminalId)
      return {
        kind: 'ask',
        reason: `Allow ${String(args.action)} access to sidebar terminal "${terminal.info.title}" (${id}) with system-user permissions?`,
        allowSession: JSON.stringify([exec.agent.session.header.owner ?? exec.agent.id, id, args.action]),
      }
    })
    ctx.effect(() => ctx.tools.register(defineTool({
      name: 'sidebar_terminal',
      description: 'Control the terminals beside this chat in web or Electron. Open starts a new shell in the workspace and shows it in a Terminal tab in the sidebar, returning its id; use it when the user asks for a terminal. List returns this session’s terminal ids; read returns bounded rendered screen and history text without taking keyboard ownership. Send shares the same shell and writes text, optionally followed by Enter; use submit=false for raw control keys such as Ctrl-C (\\u0003), Tab (\\t), or arrow escape sequences. Input acceptance does not prove command completion: read again to inspect output. Rename, resize, and close affect that same sidebar terminal. These are user shells with system-user permissions; restricted agent sessions require approval to use them.',
      parameters: {
        action: { type: 'string', required: true, enum: ['open', 'list', 'read', 'send', 'rename', 'resize', 'close'] },
        terminalId: { type: 'string', description: 'Id from open or list; required for every action except open and list.' },
        text: { type: 'string', description: 'Required for send; UTF-8 input, including control characters.' },
        submit: { type: 'boolean', description: 'Append Enter for send (default true). False sends text exactly.' },
        count: { type: 'integer', description: 'Maximum newest lines for read (default 100).' },
        title: { type: 'string', description: 'Required nonempty display title for rename.' },
        cols: { type: 'integer', description: 'Required columns for resize.' },
        rows: { type: 'integer', description: 'Required rows for resize.' },
      },
      output: jsonStringOutput(),
      execute: async (args, exec) => {
        const agent = exec.agent
        if (agent === undefined) throw new Error('Sidebar terminal control requires a calling agent')
        exec.signal.throwIfAborted()
        if (args.action === 'list') return JSON.stringify(this.list(agent.id))
        if (args.action === 'open') return JSON.stringify(await this.openShown(ctx, agent, exec.signal))
        if (args.terminalId === undefined) throw new Error('terminalId is required for this action; call list for current ids')
        const id = args.terminalId as WebTerminalId
        const terminal = this.terminal(agent.id, id)
        switch (args.action) {
          case 'read': {
            const count = args.count ?? 100
            if (count < 1) throw new Error('count must be a positive integer')
            return JSON.stringify({ info: terminal.info, ...await terminal.read(count, this.config.maxToolOutputBytes) })
          }
          case 'send': {
            if (args.text === undefined) throw new Error('text is required for send')
            const data = args.text + (args.submit === false ? '' : '\r')
            if (Buffer.byteLength(data, 'utf8') > this.config.maxInputBytes) throw new Error('Terminal input exceeds the configured limit')
            await this.present(ctx, agent, id, 'send', exec.signal)
            await terminal.send(data)
            return JSON.stringify({ accepted: true, info: terminal.info })
          }
          case 'rename':
            if (args.title === undefined) throw new Error('title is required for rename')
            this.renameIn(agent.id, id, args.title)
            return JSON.stringify(terminal.info)
          case 'resize':
            if (args.cols === undefined || args.rows === undefined) throw new Error('cols and rows are required for resize')
            this.dimensions(args.cols, args.rows)
            await terminal.setDimensions(args.cols, args.rows)
            return JSON.stringify(terminal.info)
          case 'close':
            // The pointer's press on the pill's close button closes it the way the reader would; the shell is closed
            // here either way, so a window that does not answer still loses nothing.
            await this.present(ctx, agent, id, 'close', exec.signal)
            await this.closeIn(this.owner(this.placeOfAgent(agent)), id)
            return JSON.stringify({ closed: id })
          default: return assertNever(args.action)
        }
      },
      presentCall: args => ({
        card: 'generic', title: `Sidebar terminal: ${args.action}`,
        kind: args.action === 'list' || args.action === 'read' ? 'read' : args.action === 'close' ? 'delete' : 'execute',
        rawInput: args.text ?? args.terminalId,
      }),
    })), 'terminal-controller.model-tool')
  }

  /**
   * Have the window showing the Session draw the agent pointer acting on one terminal, waiting at most
   * `showTimeoutMs`: an action never waits on a window that does not answer.
   * @param ctx - the context the tool is registered in, which dispatches the request.
   * @param agent - the Session the terminal belongs to.
   * @param terminalId - the terminal acted on.
   * @param action - what the pointer shows.
   * @param signal - the tool call's cancellation.
   */
  private async present(ctx: Context, agent: Agent, terminalId: WebTerminalId, action: 'send' | 'close', signal: AbortSignal): Promise<void> {
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(this.config.showTimeoutMs)])
    const unanswered = new Promise<boolean>((resolve) => {
      if (bounded.aborted) resolve(false)
      else bounded.addEventListener('abort', () => { resolve(false) }, { once: true })
    })
    await Promise.race([
      ctx.waterfall(scopeTarget(agent, agent), 'terminal/present', { terminalId, action, agent, signal: bounded }, () => Promise.resolve(false))
        .catch(() => false),
      unanswered,
    ])
    signal.throwIfAborted()
  }

  /**
   * Start a shell for the model and have the window showing its Session open a Terminal pill on it. A shell no window
   * shows is closed again, since nobody could see what the model types into it.
   * @param ctx - the context the tool is registered in, which dispatches the show request.
   * @param agent - the Session the shell belongs to.
   * @param signal - the tool call's cancellation.
   * @returns the new terminal.
   */
  private async openShown(ctx: Context, agent: Agent, signal: AbortSignal): Promise<WebTerminalInfo> {
    const info = await this.createIn(this.placeOfAgent(agent), {
      id: randomUUID() as WebTerminalId, cols: this.config.openCols, rows: this.config.openRows,
    }, signal)
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(this.config.showTimeoutMs)])
    const unanswered = new Promise<boolean>((resolve) => {
      if (bounded.aborted) resolve(false)
      else bounded.addEventListener('abort', () => { resolve(false) }, { once: true })
    })
    const shown = await Promise.race([
      ctx.waterfall(scopeTarget(agent, agent), 'terminal/show', { terminalId: info.id, agent, signal: bounded }, () => Promise.resolve(false)),
      unanswered,
    ])
    if (shown) return info
    await this.closeIn(this.owner(this.placeOfAgent(agent)), info.id)
    signal.throwIfAborted()
    throw new Error('No window is showing this chat, so no terminal was opened. Ask the user to open Terminal in the sidebar.')
  }

  private callerMayAccess(owner: OwnedSession): boolean {
    return this.ctx.get('identityUsers')?.mayAccess(owner.account) ?? true
  }

  /**
   * Where a Session's shells run, read without resuming its Agent when `hostShells` is on: from the live Agent when
   * this process runs the Session, otherwise from the stored header and this device's folder for its workspace.
   * Without `hostShells`, the Session's Agent is resolved and resumed, and a Session it cannot resume is refused.
   * A Session another account owns answers exactly as an absent one.
   */
  private async place(sessionId: SessionId, signal: AbortSignal): Promise<TerminalPlace> {
    signal.throwIfAborted()
    const live = this.ctx.get('agents')?.get(sessionId)
    if (live !== undefined) {
      this.assertMayAccess(sessionId, live.session.header.owner)
      return this.placeOfAgent(live)
    }
    if (!this.config.hostShells) {
      const controller = this.ctx.get('sessionController')
      if (controller === undefined) throw notFound(sessionId)
      const found = await controller.resolveAgent(sessionId)
      if ('error' in found) throw found.error
      return this.placeOfAgent(found.agent)
    }
    const query = this.ctx.get('sessionQuery')
    if (query === undefined) throw notFound(sessionId)
    let observation
    try {
      observation = await query.observeSession(sessionId, { signal })
    } catch (error: unknown) {
      if ((error as { code?: unknown } | null)?.code === 'SESSION_QUERY_SESSION_NOT_FOUND') throw notFound(sessionId)
      throw error
    }
    using held = observation
    this.assertMayAccess(sessionId, held.header.owner)
    const local = observedSessionDirectory(this.ctx, held.header, held.projections?.values.workingDirectory)
    if (local.state === 'unresolved') throw noLocalDirectory(sessionId, local.reason)
    return {
      sessionId, account: held.header.owner, subprocess: this.ctx.subprocess,
      cwd: local.state === 'local' ? local.cwd : this.ctx.sandboxPolicy.workspaceRoot, lifetime: undefined,
    }
  }

  /** Where a live Agent's shells run: the Host's own providers under `hostShells`, otherwise the Agent's. */
  private placeOfAgent(agent: Agent): TerminalPlace {
    let cwd: string | undefined
    try {
      cwd = sessionDirectory(this.ctx, agent.session)
    } catch (error) {
      if (!(error instanceof WorkingDirectoryUnavailableError)) throw error
      throw noLocalDirectory(agent.id, error.reason)
    }
    if (this.config.hostShells) {
      return {
        sessionId: agent.id, account: agent.session.header.owner, subprocess: this.ctx.subprocess,
        cwd: cwd ?? this.ctx.sandboxPolicy.workspaceRoot, lifetime: undefined,
      }
    }
    const { subprocess, sandboxPolicy } = this.execution(agent)
    return {
      sessionId: agent.id, account: agent.session.header.owner, subprocess,
      cwd: cwd ?? sandboxPolicy.workspaceRoot, lifetime: agent.ctx,
    }
  }

  /** Refuse a Session another account owns exactly as an absent one, so a caller cannot learn which exist. */
  private assertMayAccess(sessionId: SessionId, account: string | undefined): void {
    if (this.ctx.get('identityUsers')?.mayAccess(account) === false) throw notFound(sessionId)
  }

  private owner(place: TerminalPlace): OwnedSession {
    let owner = this.owners.get(place.sessionId)
    if (owner === undefined) {
      owner = {
        account: place.account, terminals: new Map(), pending: new Map(),
        allocations: new Map(), closedIds: new Set(), lifetime: new AbortController(),
      }
      this.owners.set(place.sessionId, owner)
      const owned = owner
      place.lifetime?.effect(() => async () => { await this.disposeOwner(place.sessionId, owned) }, 'terminal-controller.owner')
    }
    return owner
  }

  private disposeOwner(id: SessionId, owner: OwnedSession): Promise<void> {
    if (owner.cleanup !== undefined) return owner.cleanup
    owner.lifetime.abort(new Error('Terminal Session owner disposed'))
    owner.cleanup = (async () => {
      await Promise.allSettled(owner.pending.values())
      const results = await Promise.allSettled([
        ...[...owner.terminals.values()].map(terminal => terminal.dispose()),
        ...[...owner.allocations.values()].map(allocation => allocation.cleanup.dispose()),
      ])
      const errors = results.filter(result => result.status === 'rejected').map(result => result.reason as unknown)
      if (errors.length > 0) throw new AggregateError(errors, 'Session terminal cleanup failed')
      owner.terminals.clear()
      owner.allocations.clear()
      this.owners.delete(id)
    })().catch((error: unknown) => { delete owner.cleanup; throw error })
    return owner.cleanup
  }

  private terminal(sessionId: SessionId, id: WebTerminalId): BrowserTerminal {
    const terminal = this.owners.get(sessionId)?.terminals.get(id)
    if (terminal === undefined) throw new RemoteError('terminal/unavailable', 'Terminal no longer exists in this Session', {})
    this.requireOpen(this.owners.get(sessionId) as OwnedSession, id)
    return terminal
  }

  /** A terminal a Remote caller names, answering a Session another account owns as one without that terminal. */
  private callerTerminal(sessionId: SessionId, id: WebTerminalId): BrowserTerminal {
    const owner = this.owners.get(sessionId)
    if (owner !== undefined && !this.callerMayAccess(owner)) {
      throw new RemoteError('terminal/unavailable', 'Terminal no longer exists in this Session', {})
    }
    return this.terminal(sessionId, id)
  }

  private requireOpen(owner: OwnedSession, id: WebTerminalId): void {
    if (owner.closedIds.has(id)) throw new RemoteError('terminal/unavailable', 'Terminal was closed in this Session', {})
  }

  private dimensions(cols: number, rows: number): void {
    if (!Number.isSafeInteger(cols) || cols < 2 || cols > this.config.maxCols
      || !Number.isSafeInteger(rows) || rows < 1 || rows > this.config.maxRows) throw new Error('Terminal dimensions exceed the configured limits')
  }

  private execution(agent: Agent): { subprocess: Context['subprocess']; sandboxPolicy: Context['sandboxPolicy'] } {
    // The Agent context selects execution providers but does not inject consumer services.
    const subprocess = agent.ctx.get('subprocess')
    const sandboxPolicy = agent.ctx.get('sandboxPolicy')
    if (subprocess === undefined || sandboxPolicy === undefined) throw new Error('The Session execution environment requires subprocess and sandbox policy providers')
    return { subprocess, sandboxPolicy }
  }

  private async spawn(
    place: TerminalPlace, owner: OwnedSession, request: TerminalCreateRequest, signal: AbortSignal,
  ): Promise<BrowserTerminal> {
    const { subprocess, cwd } = place
    const shell = request.shellPath === undefined
      ? await resolveShell(subprocess, this.config.shell, signal)
      : (await discoverShells(subprocess, this.config.shell, this.config.shellCandidates, signal))
        .find(candidate => candidate.path === request.shellPath)
    if (shell === undefined) throw new Error('Selected shell is not available in this execution environment')
    const handle = await subprocess.spawnTerminal({
      argv: [shell.path, ...shell.args], cwd, cols: request.cols, rows: request.rows,
      env: { TERM: 'xterm-256color', AVN_SESSION_ID: place.sessionId },
      graceMs: this.config.disposeGraceMs, signal,
    })
    const info: WebTerminalInfo = {
      id: request.id, shell, title: shell.name, cwd,
      cols: request.cols, rows: request.rows, state: 'running', exitCode: null,
    }
    try {
      signal.throwIfAborted()
      return new BrowserTerminal(handle, info, this.config.scrollback, this.config.maxBufferedBytes)
    } catch (error) {
      const cleanup = new TerminalRetention(this.config, () => Promise.resolve(UNKNOWN_ACTIVITY), async () => {
        owner.closedIds.add(request.id)
        await handle.terminate()
        owner.allocations.delete(request.id)
      }, (cleanupError) => { this.ctx.logger.error('Browser terminal allocation cleanup failed', cleanupError) })
      owner.allocations.set(request.id, {
        info: { ...info, state: 'failed', error: error instanceof Error ? error.message : String(error) }, cleanup,
      })
      try {
        await cleanup.close()
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Terminal allocation cleanup failed')
      }
      throw error
    }
  }
}

function notFound(sessionId: SessionId): RemoteError<'session/not-found'> {
  return new RemoteError('session/not-found', `session "${sessionId}" not found`, { sessionId })
}

function noLocalDirectory(sessionId: SessionId, reason: LocalDirectoryProblem): RemoteError<'workspace/no-local-directory'> {
  return new RemoteError('workspace/no-local-directory', new WorkingDirectoryUnavailableError(sessionId, reason).message, { sessionId, reason })
}

/** Browser terminal service plugin. */
export default TerminalController
