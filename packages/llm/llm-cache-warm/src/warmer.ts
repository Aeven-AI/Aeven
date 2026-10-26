/**
 * Tool-block prompt-cache warmer. While one tool call keeps the agent loop
 * waiting, replay the session's last conversation request with a one-token
 * output cap so the provider's cached prefix stays warm and the tool's result
 * lands on it. Nothing warms while a session waits for a human, and nothing
 * warms when the provider has no entry in the interval table.
 * @module @aeven/llm-cache-warm/src/warmer
 */

import { BlockAssembler } from '@aeven/llm'
import type { GenerateOptions, StreamChunk, TokenUsage } from '@aeven/llm'
import type { Session } from '@aeven/session'
import type { SessionId } from '@aeven/session/types'
import { deadline } from '@aeven/timeout'
import type { CacheWarmRoute } from './types.ts'

/** Timeout reason code for one warm request. */
export const CACHE_WARM_TIMEOUT_CODE = 'CACHE_WARM_TIMEOUT'

/** One provider's warming schedule; its presence in the table enables that provider. */
export interface ProviderSchedule {
  /** Delay between warms while a tool call is in flight, under that provider's cache lifetime. */
  readonly intervalMs: number
  /** Warms per tool call for this provider; absent uses the plugin-wide cap. */
  readonly maxPings?: number
}

/** Resolved configuration the warmer runs under; every value comes from a `Config` field. */
export interface WarmerSettings {
  /** Journal the warms a real dispatch would send, and send none. */
  readonly dryRun: boolean
  /** Providers to warm, keyed by the provider name a request names. */
  readonly providers: Readonly<Record<string, ProviderSchedule>>
  /** Tool names whose block is a human wait; never warmed. */
  readonly excludeTools: readonly string[]
  /** Prefix size below which a cache miss is cheaper than a warm. */
  readonly minPrefixChars: number
  /** Warms allowed in flight across all sessions. */
  readonly maxConcurrentPings: number
  /** Warm dispatches allowed per UTC day. */
  readonly dailyPingBudget: number
  /** Cap on one warm request's lifetime. */
  readonly pingTimeoutMs: number
  /** Warms per tool call when the provider entry sets none. */
  readonly maxPings: number
}

/** What the warmer needs from its host. */
export interface WarmerPorts {
  /** Dispatch one request through the LLM waterfall. */
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>
  /** Wall clock, milliseconds since the epoch. */
  now(): number
  /** Report a warm the provider billed but could not confirm. */
  warn(message: string, ...args: unknown[]): void
}

/** The captured conversation request a warm replays. */
interface CapturedRequest {
  readonly options: GenerateOptions
  readonly route: CacheWarmRoute
  readonly prefixChars: number
}

/** One tool call's warming window. */
interface Block {
  readonly tool: string
  readonly signal: AbortSignal
  pings: number
  timer: ReturnType<typeof setTimeout> | undefined
}

/** Per-session warming state. */
interface SessionState {
  request?: CapturedRequest
  block?: Block
  /** Open tool calls; the window stays open while a composite's sub-calls run. */
  depth: number
}

/** Attachment-bearing requests are never replayed: a warm can re-upload their files. */
function hasAttachment(options: GenerateOptions): boolean {
  return options.messages.some(message => message.content.some(block => block.type === 'file' || block.type === 'image'))
}

/** Characters of the prefix a warm replays. */
function measurePrefix(options: GenerateOptions): number {
  const tools = options.tools === undefined ? '' : JSON.stringify(options.tools)
  const messages = options.messages.map(message => JSON.stringify(message.content)).join('')
  return (options.system?.length ?? 0) + tools.length + messages.length
}

/** Pin the UTC day boundary the daily budget resets on. */
function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10)
}

/**
 * Keep one session's cached prompt prefix warm while its loop waits inside a
 * tool call. `capture` observes every request the loop sends; `beginBlock` and
 * `endBlock` open and close the only window in which warms fire.
 */
export class CacheWarmer {
  private readonly states = new Map<string, SessionState>()
  private inFlight = 0
  private budgetDay = ''
  private budgetUsed = 0

  constructor(
    private readonly ports: WarmerPorts,
    private readonly settings: WarmerSettings,
  ) {}

  /**
   * Remember the request a warm would replay. A request without a session, with
   * an auxiliary purpose, on an unwarmed provider, below the size floor, or
   * carrying attachments replaces no captured request.
   * @param options - the request the loop sent through the waterfall.
   */
  capture(options: GenerateOptions): void {
    if (options.sessionId === undefined || options.purpose !== undefined) return
    const schedule = this.settings.providers[options.provider]
    if (schedule === undefined || hasAttachment(options)) return
    const prefixChars = measurePrefix(options)
    if (prefixChars < this.settings.minPrefixChars) return
    this.state(options.sessionId).request = {
      options,
      route: { provider: options.provider, model: options.model },
      prefixChars,
    }
  }

  /**
   * Open a warming window for one tool call. An excluded tool, a missing
   * captured request, or an exhausted daily budget opens nothing.
   * @param session - the session whose prefix stays warm.
   * @param tool - the model-facing name of the running tool.
   * @param signal - that call's cancellation signal.
   */
  beginBlock(session: Session, tool: string, signal: AbortSignal): void {
    if (this.settings.excludeTools.includes(tool)) return
    const state = this.state(session.id)
    if (state.request === undefined) return
    state.depth += 1
    if (state.depth > 1) return
    state.block = { tool, signal, pings: 0, timer: undefined }
    this.schedule(session, state)
  }

  /**
   * Close a session's warming window; an already-scheduled warm is dropped while
   * an in-flight one settles on its own signal.
   * @param session - the session whose tool call settled or whose turn ended.
   */
  endBlock(session: Session): void {
    const state = this.states.get(session.id)
    if (state === undefined) return
    state.depth = Math.max(0, state.depth - 1)
    if (state.depth > 0) return
    this.closeBlock(state)
  }

  private closeBlock(state: SessionState): void {
    if (state.block?.timer !== undefined) clearTimeout(state.block.timer)
    delete state.block
  }

  /**
   * Forget a session entirely.
   * @param id - the disposed session.
   */
  forget(id: SessionId): void {
    const state = this.states.get(id)
    if (state !== undefined) this.closeBlock(state)
    this.states.delete(id)
  }

  /** Drop every pending warm; called when the plugin unloads. */
  dispose(): void {
    for (const state of this.states.values()) this.closeBlock(state)
    this.states.clear()
  }

  private state(id: string): SessionState {
    const existing = this.states.get(id)
    if (existing !== undefined) return existing
    const created: SessionState = { depth: 0 }
    this.states.set(id, created)
    return created
  }

  private schedule(session: Session, state: SessionState): void {
    const block = state.block
    const request = state.request
    if (block === undefined || request === undefined) return
    const schedule = this.settings.providers[request.route.provider]
    if (schedule === undefined) return
    const cap = schedule.maxPings ?? this.settings.maxPings
    if (block.pings >= cap) return
    block.timer = setTimeout(() => { void this.warm(session, state) }, schedule.intervalMs)
  }

  private async warm(session: Session, state: SessionState): Promise<void> {
    const block = state.block
    const request = state.request
    if (block === undefined || request === undefined) return
    const schedule = this.settings.providers[request.route.provider]
    if (schedule === undefined) return
    block.timer = undefined
    const cap = schedule.maxPings ?? this.settings.maxPings
    if (block.pings >= cap) return
    if (this.inFlight >= this.settings.maxConcurrentPings) {
      block.timer = setTimeout(() => { void this.warm(session, state) }, schedule.intervalMs)
      return
    }
    if (!this.claimBudget()) return
    const ping = block.pings + 1
    block.pings = ping
    session.append('cache-warm/start', {
      tool: block.tool,
      ping,
      route: request.route,
      prefixChars: request.prefixChars,
    })
    if (this.settings.dryRun) {
      this.schedule(session, state)
      return
    }
    this.inFlight += 1
    let usage: TokenUsage | undefined
    let error: string | undefined
    try {
      using ping_deadline = deadline(block.signal, this.settings.pingTimeoutMs, CACHE_WARM_TIMEOUT_CODE)
      const assembler = new BlockAssembler()
      const options: GenerateOptions = {
        ...request.options,
        maxTokens: 1,
        signal: ping_deadline.signal,
      }
      delete options.sessionId
      for await (const chunk of this.ports.stream(options)) {
        ping_deadline.signal.throwIfAborted()
        assembler.push(chunk)
      }
      const finish = assembler.finish
      if (finish.kind !== 'stop' && finish.kind !== 'max-tokens') {
        error = `warm finished with ${finish.kind}`
      }
      usage = assembler.usage
    } catch (failure: unknown) {
      error = failure instanceof Error ? failure.message : String(failure)
    } finally {
      this.inFlight -= 1
    }
    if (block.signal.aborted) return
    session.append('cache-warm/result', {
      tool: block.tool,
      ping,
      route: request.route,
      ...usage === undefined ? {} : { usage },
      ...error === undefined ? {} : { error },
    })
    if (error !== undefined) this.ports.warn('warm %d for %s failed: %s', ping, block.tool, error)
    this.schedule(session, state)
  }

  private claimBudget(): boolean {
    const day = utcDay(this.ports.now())
    if (day !== this.budgetDay) {
      this.budgetDay = day
      this.budgetUsed = 0
    }
    if (this.budgetUsed >= this.settings.dailyPingBudget) return false
    this.budgetUsed += 1
    return true
  }
}
