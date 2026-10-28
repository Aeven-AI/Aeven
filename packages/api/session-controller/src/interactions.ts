/**
 * Approvals and questions of a session reach every device of its account. The device running the turn lists each
 * pending one in the session's live state and asks its own clients through a copy of the request it can withdraw;
 * another device presents the listed ones to its clients and forwards the answer. The first answer wins and
 * withdraws the other presentations. When nobody answers on the running device, it waits for another device's
 * answer for a bounded time before reporting the request unanswered, as it would without other devices.
 */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@aeven/agent'
import { scopeTarget } from '@aeven/scope'
import type { SessionHeader, SessionId } from '@aeven/session'
import type {} from '@aeven/session-handoff'
import type { ApprovalAnswer, ApprovalRequestEvent } from '@aeven/user-approval/types'
import type { AskUserQuestionAnswer, AskUserQuestionRequest } from '@aeven/user-questions'

/** The waterfalls whose requests every device of the account may answer. */
export type RelayedInteraction = 'approval/request' | 'user-questions/request'

/** One pending approval or question as the live state lists it. */
export interface SharedInteraction {
  /** Identity of this pending request, unique on the running device. */
  readonly id: string
  /** The waterfall that asks it. */
  readonly event: RelayedInteraction
  /** The request without its agent and signal, as JSON. */
  readonly request: Record<string, unknown>
}

/** What an answerer chain gives when nobody on this device answered. */
const UNANSWERED: Record<RelayedInteraction, (answer: unknown) => boolean> = {
  'approval/request': answer => answer === 'unavailable',
  'user-questions/request': () => false,
}

/** Whether another device's answer has the shape the asker accepts. */
const VALID: Record<RelayedInteraction, (answer: unknown) => boolean> = {
  'approval/request': answer => answer === 'allowed-once' || answer === 'allowed-session' || answer === 'rejected',
  'user-questions/request': answer => typeof answer === 'object' && answer !== null && Array.isArray((answer as { answers?: unknown }).answers),
}


interface Pending {
  readonly agent: Agent
  readonly shared: SharedInteraction
  readonly settle: (answer: unknown) => void
}

type Outcome = { readonly kind: 'answer'; readonly value: unknown } | { readonly kind: 'failed'; readonly error: unknown }

/** Relays approvals and questions between the devices of each session's account. */
export class InteractionRelay {
  private readonly pending = new Map<string, Pending>()
  private readonly copies = new WeakSet<object>()
  private readonly presented = new Map<string, AbortController>()

  /**
   * @param ctx - Host context.
   * @param changed - republishes an Agent's live state after its pending interactions changed.
   * @param waitMs - how long a request nobody answered here waits for another device's answer.
   */
  constructor(
    private readonly ctx: Context,
    private readonly changed: (agent: Agent) => void,
    private readonly waitMs: number,
  ) {
    ctx.on('approval/request', (request, next) => this.relay('approval/request', request, next) as Promise<ApprovalAnswer>, { prepend: true })
    ctx.on('user-questions/request', (request, next) => this.relay('user-questions/request', request, next) as Promise<AskUserQuestionAnswer>, {
      prepend: true,
    })
    ctx.effect(() => () => {
      for (const presentation of this.presented.values()) presentation.abort()
      this.presented.clear()
    }, 'session-controller.interactions')
  }

  /**
   * The approvals and questions pending for a session this device runs.
   * @param sessionId - the session.
   * @returns them in the order they were asked.
   */
  pendingFor(sessionId: SessionId): SharedInteraction[] {
    return [...this.pending.values()].filter(entry => entry.agent.id === sessionId).map(entry => entry.shared)
  }

  /**
   * Settle a pending request with another device's answer.
   * @param id - the shared interaction id.
   * @param answer - the answer, as JSON.
   */
  answer(id: string, answer: unknown): void {
    const pending = this.pending.get(id)
    if (pending === undefined || !VALID[pending.shared.event](answer)) return
    pending.settle(answer)
  }

  /**
   * Ask this device's answerers for one request on behalf of an Agent or a stand-in for one. The request object
   * passes unchanged, so the relay recognizes its own copy.
   */
  private ask(event: RelayedInteraction, agent: Agent, request: object): Promise<unknown> {
    const target = scopeTarget(agent, agent)
    if (event === 'approval/request') {
      return this.ctx.waterfall(target, event, request as ApprovalRequestEvent, () => Promise.resolve<ApprovalAnswer>('unavailable'))
    }
    return this.ctx.waterfall(target, event, request as AskUserQuestionRequest, () => Promise.reject(
      new Error('no user-questions answerer accepted the request'),
    ))
  }

  private async relay(
    event: RelayedInteraction,
    request: { readonly agent?: Agent; readonly signal?: AbortSignal },
    next: () => Promise<unknown>,
  ): Promise<unknown> {
    const agent = request.agent
    const owner = agent?.session.header.owner
    if (this.copies.has(request) || agent === undefined || owner === undefined || this.ctx.get('sessionHandoff') === undefined) {
      return await next()
    }
    const withdraw = new AbortController()
    const forward = (): void => { withdraw.abort(request.signal?.reason) }
    request.signal?.addEventListener('abort', forward, { once: true })
    const copy = { ...request, signal: withdraw.signal }
    this.copies.add(copy)
    const { agent: _agent, signal: _signal, ...shown } = request
    const id = randomUUID()
    const remote = Promise.withResolvers<unknown>()
    this.pending.set(id, { agent, shared: { id, event, request: shown }, settle: remote.resolve })
    this.changed(agent)
    try {
      const local: Promise<Outcome> = this.ask(event, agent, copy)
        .then(value => ({ kind: 'answer' as const, value }), (error: unknown) => ({ kind: 'failed' as const, error }))
      const elsewhere = remote.promise.then(value => ({ kind: 'remote' as const, value }))
      const first = await Promise.race([local, elsewhere])
      if (first.kind === 'remote') return first.value
      if (first.kind === 'answer' && !UNANSWERED[event](first.value)) return first.value
      // Nobody answered on this device; another device of the account still may, for a bounded time.
      const timer = Promise.withResolvers<'timeout'>()
      const timeout = setTimeout(() => { timer.resolve('timeout') }, this.waitMs)
      const late = await Promise.race([elsewhere, timer.promise, aborted(request.signal)])
      clearTimeout(timeout)
      if (late !== 'timeout' && late !== 'aborted') return late.value
      if (first.kind === 'failed') throw first.error
      return first.value
    } finally {
      withdraw.abort()
      request.signal?.removeEventListener('abort', forward)
      this.pending.delete(id)
      this.changed(agent)
    }
  }

  /**
   * Present the approvals and questions another device lists for a session it runs to this device's clients,
   * forward each answer to that device, and withdraw the ones it no longer lists.
   * @param owner - the account.
   * @param sessionId - the session.
   * @param interactions - what the running device lists now.
   */
  present(owner: string, sessionId: SessionId, interactions: readonly SharedInteraction[]): void {
    const listed = new Set(interactions.map(interaction => `${sessionId}:${interaction.id}`))
    for (const [key, presentation] of this.presented) {
      if (key.startsWith(`${sessionId}:`) && !listed.has(key)) {
        presentation.abort()
        this.presented.delete(key)
      }
    }
    for (const interaction of interactions) {
      const key = `${sessionId}:${interaction.id}`
      if (this.presented.has(key)) continue
      const presentation = new AbortController()
      this.presented.set(key, presentation)
      // The entry stays until the running device stops listing the request, so an answered one is not asked again.
      void this.presentOne(owner, sessionId, interaction, presentation.signal).catch((error: unknown) => {
        this.ctx.logger.warn(`session: an answer for ${sessionId} could not reach the device running it: ${String(error)}`)
      })
    }
  }

  private async presentOne(owner: string, sessionId: SessionId, interaction: SharedInteraction, signal: AbortSignal): Promise<void> {
    // This device runs no Agent for the session; a stand-in carries the session identity its clients scope by.
    const header = { id: sessionId, owner } as SessionHeader
    const stand = { id: sessionId, session: { id: sessionId, header } } as unknown as Agent & { ctx: Context }
    Object.assign(stand, { ctx: this.ctx.extend({ agent: stand }) })
    let answer: unknown
    try {
      const request = { ...interaction.request, agent: stand, signal }
      // Presented here on behalf of the running device, so this device's relay does not list it again.
      this.copies.add(request)
      answer = await this.ask(interaction.event, stand, request)
    } catch {
      // No client here answered, or the running device withdrew the request; it keeps its own outcome.
      return
    }
    if (signal.aborted || UNANSWERED[interaction.event](answer)) return
    await this.ctx.get('sessionHandoff')?.forward(owner, sessionId, { operation: 'interaction', request: { id: interaction.id, answer } })
  }
}

/** Settles once a request's lifetime ends. */
function aborted(signal: AbortSignal | undefined): Promise<'aborted'> {
  if (signal === undefined) return new Promise(() => {})
  if (signal.aborted) return Promise.resolve('aborted')
  return new Promise((resolve) => { signal.addEventListener('abort', () => { resolve('aborted') }, { once: true }) })
}
