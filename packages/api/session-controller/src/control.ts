/** Live Session queue, jobs, and projection state with reconnect baselines. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@aeven/agent'
import { Deque } from '@aeven/deque'
import type { User } from '@aeven/identity-user'
import type { JobView, JobEvent } from '@aeven/jobs'
import type { MessageId } from '@aeven/llm/brand'
import type {
  Session, SessionEvent, SessionEventMap, SessionHeader, SessionId, UserMessage,
} from '@aeven/session'
import type {} from '@aeven/session-handoff'
import type { JsonValue } from '@aeven/util-values'
import type {
  SessionControlBaseline,
  SessionControlFrame,
  SessionJob,
  SessionProjectionBaseline,
  SessionProjectionValues,
  SessionQueuedItem,
} from './types.ts'
import { callerMayAccessSession } from './agent.ts'
import { InteractionRelay, type SharedInteraction } from './interactions.ts'

/** What the device writing a session shares of it with the account's other devices. */
interface RemoteLive {
  /** Whether a turn runs there. */
  readonly running: boolean
  /** What waits in its queue. */
  readonly queue: readonly SessionQueuedItem[]
  /** Approvals and questions waiting for an answer. */
  readonly interactions: readonly SharedInteraction[]
}

/** Read another device's live state, which arrives over the wire. */
function remoteLive(value: unknown): RemoteLive {
  const record = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
  return {
    running: record.running === true,
    queue: Array.isArray(record.queue) ? record.queue as SessionQueuedItem[] : [],
    interactions: Array.isArray(record.interactions) ? record.interactions as SharedInteraction[] : [],
  }
}

/** Owns the Host-wide Session control stream. */
export class SessionControlController {
  private readonly streams = new Set<ControlQueue>()
  /** Approvals and questions answered on whichever device of the account the user holds. */
  readonly interactions: InteractionRelay

  /**
   * @param ctx - Host context carrying live Agent, projection, and jobs services.
   * @param remoteAnswerMs - how long a request nobody answered here waits for another device's answer.
   */
  constructor(private readonly ctx: Context, remoteAnswerMs: number) {
    this.interactions = new InteractionRelay(ctx, (agent) => { this.shareLive(agent) }, remoteAnswerMs)
    ctx.on('session/event', (session, event) => { this.onSessionEvent(session, event) })
    // A turn running here, and what waits in its queue, show on the account's other devices too.
    ctx.on('agent/status', ({ agent }) => { this.shareLive(agent) })
    ctx.on('session-handoff/live', (owner, sessionId) => { this.onRemoteLive(owner, sessionId) })
    ctx.sessionProjections.onChanged((session, key, value, seq) => {
      this.broadcast({
        type: 'projection',
        sessionId: session.id,
        key,
        value: value as JsonValue,
        seq,
      })
    })
    ctx.inject(['jobs'], (jobsCtx) => {
      jobsCtx.jobs.events.subscribe({ owners: 'all' }, (event) => { this.onJobsChanged(event) })
    })
    ctx.on('session/created', (session) => {
      const jobs = this.jobsFor(this.ctx.agents.get(session.id))
      if (jobs.length > 0) this.broadcast({ type: 'jobs', sessionId: session.id, jobs })
    })
    ctx.effect(() => () => {
      for (const stream of this.streams) stream.end()
      this.streams.clear()
    }, 'session-controller.control')
  }

  /**
   * Open one generation of Host-wide live control state.
   * @param signal - Remote stream cancellation.
   * @returns one complete baseline followed by live replacement frames.
   */
  async *control(signal: AbortSignal): AsyncIterable<SessionControlFrame> {
    signal.throwIfAborted()
    // Each stream carries only the Sessions its caller owns.
    const queue = new ControlQueue(this.ctx.get('identityUsers')?.actingUser())
    this.streams.add(queue)
    try {
      yield { type: 'baseline', value: this.baseline(queue.caller) }
      yield* queue.iterate(signal)
    } finally {
      this.streams.delete(queue)
      queue.end()
    }
  }

  private baseline(caller: User | undefined): SessionControlBaseline {
    const sessions = this.ctx.sessions.list().filter(session => callerMayAccessSession(this.ctx, session.header, caller))
    const queues = Object.create(null) as Record<SessionId, readonly SessionQueuedItem[]>
    const jobs = Object.create(null) as Record<SessionId, readonly SessionJob[]>
    for (const session of sessions) {
      const agent = this.ctx.agents.get(session.id)
      queues[session.id] = agent?.session === session ? queueItems(agent) : []
      jobs[session.id] = this.jobsFor(agent)
    }
    return {
      queues,
      jobs,
      projections: this.projectionBaseline(sessions),
    }
  }

  private projectionBaseline(
    sessions: readonly Session[],
  ): Readonly<Record<SessionId, SessionProjectionBaseline>> {
    const blocks = Object.create(null) as Record<SessionId, SessionProjectionBaseline>
    for (const session of sessions) {
      const snapshot = this.ctx.sessionProjections.snapshot(session)
      blocks[session.id] = {
        asOfSeq: snapshot.asOfSeq,
        // Every projection definition validates its value before snapshot publication.
        values: snapshot.values as SessionProjectionValues,
      }
    }
    return blocks
  }

  private onSessionEvent(session: Session, event: SessionEvent): void {
    if (event.type !== 'agent/inbox/spliced') return
    const agent = this.ctx.agents.get(session.id)
    if (agent?.session !== session) return
    const claimed = claimedMessageIds(agent, event.data)
    const items = queueItems(agent, event.data)
    this.broadcast({
      type: 'queue',
      sessionId: session.id,
      items,
      ...claimed.length === 0 ? {} : { claimed },
    })
    this.shareLive(agent, items)
  }

  /** Publish an Agent's running state and queue to the account's other devices, clearing it once nothing is live. */
  private shareLive(agent: Agent, spliced?: readonly SessionQueuedItem[]): void {
    const owner = agent.session.header.owner
    const handoff = this.ctx.get('sessionHandoff')
    if (owner === undefined || handoff === undefined) return
    const items = spliced ?? queueItems(agent)
    const running = agent.status === 'running'
    const interactions = this.interactions.pendingFor(agent.id)
    const live = running || items.length > 0 || interactions.length > 0 ? { running, queue: items, interactions } : undefined
    handoff.publishLive(owner, agent.id, live)
  }

  /** Show what another device shares of a session it writes: its running state and queue. */
  private onRemoteLive(owner: string, sessionId: SessionId): void {
    const live = remoteLive(this.ctx.get('sessionHandoff')?.liveOf(owner, sessionId))
    const header = { id: sessionId, owner } as SessionHeader
    this.broadcastFor(header, { type: 'queue', sessionId, items: live.queue })
    this.ctx.emit('api-session/status', sessionId, live.running)
    this.interactions.present(owner, sessionId, live.interactions)
  }

  private onJobsChanged(event: JobEvent): void {
    if (event.type === 'output') return
    const owner = event.job.owner
    if (owner !== undefined) {
      this.broadcast({ type: 'jobs', sessionId: owner, jobs: this.jobsFor(this.ctx.agents.get(owner)) })
      return
    }
    for (const session of this.ctx.sessions.list()) {
      this.broadcast({
        type: 'jobs',
        sessionId: session.id,
        jobs: this.jobsFor(this.ctx.agents.get(session.id)),
      })
    }
  }

  private jobsFor(agent: Agent | undefined): SessionJob[] {
    const jobs = this.ctx.get('jobs')
    return jobs === undefined ? [] : jobs.list(agent?.id).map(jobView)
  }

  private broadcast(frame: SessionControlFrame & { readonly sessionId: SessionId }): void {
    const header = this.ctx.sessions.get(frame.sessionId)?.header
    if (header !== undefined) this.broadcastFor(header, frame)
  }

  private broadcastFor(header: SessionHeader, frame: SessionControlFrame): void {
    for (const stream of this.streams) {
      if (callerMayAccessSession(this.ctx, header, stream.caller)) stream.push(frame)
    }
  }
}

class ControlQueue {
  /** @param caller - the user the stream was opened for; only their Sessions reach it. */
  constructor(readonly caller: User | undefined) {}

  private readonly buffer = new Deque<SessionControlFrame>()
  private wake: (() => void) | undefined
  private done = false

  push(frame: SessionControlFrame): void {
    if (this.done) return
    this.buffer.pushBack(frame)
    const wake = this.wake
    this.wake = undefined
    wake?.()
  }

  end(): void {
    if (this.done) return
    this.done = true
    const wake = this.wake
    this.wake = undefined
    wake?.()
  }

  async *iterate(signal: AbortSignal): AsyncIterable<SessionControlFrame> {
    const onAbort = (): void => { this.end() }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      while (!this.done && !signal.aborted) {
        const frame = this.buffer.popFront()
        if (frame !== undefined) {
          yield frame
          continue
        }
        await new Promise<void>((resolve) => { this.wake = resolve })
      }
      while (this.buffer.size > 0 && !signal.aborted) yield this.buffer.popFront() as SessionControlFrame
    } finally {
      signal.removeEventListener('abort', onAbort)
      this.end()
    }
  }
}

function queueItems(
  agent: Agent,
  splice?: SessionEventMap['agent/inbox/spliced'],
): SessionQueuedItem[] {
  const project = (target: 'next-turn' | 'next-step'): readonly UserMessage[] => {
    const messages = target === 'next-turn' ? agent.inbox.nextTurn : agent.inbox.nextStep
    return splice?.target === target
      ? messages.toSpliced(splice.start, splice.removedCount ?? 0, ...splice.inserted)
      : messages
  }
  return [
    ...project('next-turn').map(message => ({
      id: message.id,
      placement: 'queued' as const,
      ...promptRpcId(message),
      message: { id: message.id, content: message.content as unknown as JsonValue[] },
    })),
    ...project('next-step').map(message => ({
      id: message.id,
      placement: message.source.kind === 'user' ? 'steering' as const : 'context' as const,
      ...promptRpcId(message),
      message: { id: message.id, content: message.content as unknown as JsonValue[] },
    })),
  ]
}

/**
 * User-authored messages removed by a claim splice. Runs before the Inbox applies the splice, so the removed range is still readable.
 * @param agent - agent whose inbox the splice mutates.
 * @param splice - durable splice; a removal without `outcome` is a claim.
 * @returns claimed user message ids, empty for inserts and cancellations.
 */
function claimedMessageIds(agent: Agent, splice: SessionEventMap['agent/inbox/spliced']): MessageId[] {
  if (splice.outcome !== undefined || splice.removedCount === undefined) return []
  const messages = splice.target === 'next-turn' ? agent.inbox.nextTurn : agent.inbox.nextStep
  return messages
    .slice(splice.start, splice.start + splice.removedCount)
    .flatMap(message => message.source.kind === 'user' ? [message.id] : [])
}

/** Prompt-RPC identity carried by a browser-submitted message's user source. */
function promptRpcId(message: UserMessage): Pick<SessionQueuedItem, 'rpcId'> {
  const source = message.source
  return source.kind === 'user' && 'rpcId' in source ? { rpcId: source.rpcId } : {}
}

function jobView(job: JobView): SessionJob {
  return {
    id: job.id,
    kind: job.kind,
    label: job.label,
    status: job.status,
    ...(job.detail === undefined ? {} : { detail: job.detail }),
    startedAt: job.startedAt,
    ...(job.finishedAt === undefined ? {} : { finishedAt: job.finishedAt }),
  }
}
