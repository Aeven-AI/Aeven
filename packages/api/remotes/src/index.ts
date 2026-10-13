/** Host BFF entry and Loader shell for the Remote contribution assembly. */

import { homedir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import type {
  RemoteEventAudience,
  TypertRemoteEventDispatch,
  TypertRemoteEventInvocation,
  TypertRemoteEventOutcome,
  TypertRemoteEventSource,
} from '@aeven/api-gateway'
import { Deque } from '@aeven/deque'
import type { SessionId } from '@aeven/session'
import { carrierKeyOf } from '@aeven/scope'
import { isJsonValue, type JsonValue } from '@aeven/util-values'
import { API_REMOTE_FORWARDED_EVENTS } from './remote-events.ts'

// The owner packages' client-safe `./types` exports carry the cordis `Events`
// declarations for every allowlisted event. Pulling them into this face is what
// makes the shape assertion below judge real signatures rather than an empty
// event vocabulary.
import type {} from '@aeven/commands/types'
import type {} from '@aeven/cordis-host-runner/types'
import type {} from '@aeven/credentials/types'
import type {} from '@aeven/llm/types'
import type {} from '@aeven/agent-presets/types'
import type {} from '@aeven/settings/types'
import type {} from '@aeven/user-approval'
import type {} from '@aeven/tool-browser/types'
import type {} from '@aeven/tool-location/types'
import type {} from '@aeven/user-questions'
export type {} from '@aeven/api-session-controller/types'

export { API_REMOTE_FORWARDED_EVENTS } from './remote-events.ts'
export type { ApiRemoteForwardedEvent } from './types.ts'

/** Required Host service: the Gateway owns the physical Remote stream mux. */
export const inject = ['typertGateway']

/** Host plugin body registering this application's selected Cordis event source. */
export function apply(ctx: Context): void {
  ctx.effect(
    () => ctx.typertGateway.registerRemoteEvents(remoteEventSource(ctx), { home: homedir() }),
    'api-remotes: forwarded Cordis event source',
  )
}

/**
 * The Session a forwarded notification belongs to, read from its arguments.
 * A notification without an entry is Host-wide and reaches every Client.
 */
const NOTIFICATION_SESSION: Readonly<Partial<Record<string, (args: readonly unknown[]) => unknown>>> = {
  'agent-preset/selected': args => args[0],
  'api-session/activity': args => args[0],
  'api-session/added': args => fieldOf(args[0], 'sessionId'),
  'api-session/error': args => args[0],
  'api-session/removed': args => args[0],
  'api-session/status': args => args[0],
  'cordis/dynamic-package': args => fieldOf(args[0], 'agentId'),
  'cordis/dynamic-retract': args => fieldOf(args[0], 'agentId'),
  'cordis/inspect-query': args => fieldOf(args[0], 'agentId'),
  'cordis/request-run': args => fieldOf(args[0], 'agentId'),
}

function fieldOf(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined
}

/** Create the sole queue and listener set consumed by the registered Gateway. */
function remoteEventSource(ctx: Context): TypertRemoteEventSource {
  return (signal) => {
    const queue = new RemoteEventQueue()
    // Owners of the Sessions seen while this source lives, so a notification
    // about a Session that has already left memory still reaches its owner.
    const owners = new Map<string, string | undefined>()
    const audienceOf = (event: string, args: readonly unknown[]): RemoteEventAudience | undefined => {
      const sessionId = NOTIFICATION_SESSION[event]?.(args)
      if (typeof sessionId !== 'string') return undefined
      const live = ctx.get('sessions')?.get(sessionId as SessionId)
      if (live !== undefined) owners.set(sessionId, live.header.owner)
      return { owner: owners.get(sessionId) }
    }
    const disposers = API_REMOTE_FORWARDED_EVENTS.map(({ event, mode }) => {
      if (mode === 'emit') {
        return ctx.on(event as never, ((...args: unknown[]) => {
          const audience = audienceOf(event, args)
          queue.push({ event, args: assertJsonArgs(event, args), ...audience === undefined ? {} : { audience } })
        }) as never)
      }
      return ctx.on(event as never, (function (
        this: unknown,
        request: object,
        next: () => unknown,
      ) {
        const subject = carrierKeyOf(this)
        if (subject === undefined) return next()
        const value = Reflect.get(subject, 'ctx') as unknown
        if (typeof value !== 'object' || value === null) {
          throw new TypeError(`forwarded scoped event ${JSON.stringify(event)} has no live Context`)
        }
        return forwardWaterfall(
          queue,
          event,
          request,
          { value: value as Context, subject },
          next,
        )
      }) as never)
    })
    return queue.iterate(signal, () => {
      for (const dispose of disposers) dispose()
    })
  }
}

/** One pull-driven queue bridging synchronous Cordis listeners to an AsyncIterable. */
class RemoteEventQueue {
  private readonly buffer = new Deque<TypertRemoteEventDispatch>()
  private waiter: (() => void) | undefined
  private done = false

  push(frame: TypertRemoteEventDispatch): boolean {
    if (this.done) return false
    this.buffer.pushBack(frame)
    this.waiter?.()
    return true
  }

  private end(reason: unknown): void {
    if (this.done) return
    this.done = true
    while (this.buffer.size > 0) {
      const dispatch = this.buffer.popFront() as TypertRemoteEventDispatch
      if ('context' in dispatch) dispatch.reject(reason)
    }
    this.waiter?.()
  }

  async *iterate(signal: AbortSignal, cleanup: () => void): AsyncGenerator<TypertRemoteEventDispatch> {
    const abort = (): void => { this.end(remoteEventSourceEndReason(signal)) }
    signal.addEventListener('abort', abort, { once: true })
    try {
      while (true) {
        if (this.done || signal.aborted) return
        while (this.buffer.size > 0) yield this.buffer.popFront() as TypertRemoteEventDispatch
        await new Promise<void>((resolve) => { this.waiter = resolve })
        this.waiter = undefined
      }
    } finally {
      signal.removeEventListener('abort', abort)
      this.end(remoteEventSourceEndReason(signal))
      cleanup()
    }
  }
}

/**
 * Normalize an event-source shutdown for pending Host waterfalls.
 * @param signal - source lifetime whose reason wins after cancellation.
 * @returns the cancellation reason or an unexpected-end failure.
 */
function remoteEventSourceEndReason(signal: AbortSignal): unknown {
  if (signal.aborted) return signal.reason
  return new Error('api-remotes: forwarded Remote event source ended')
}

/** Bridge one Cordis waterfall listener through the Gateway-owned pending event. */
function forwardWaterfall(
  queue: RemoteEventQueue,
  event: string,
  request: object,
  context: TypertRemoteEventInvocation['context'],
  next: () => unknown,
): Promise<unknown> {
  const settled = Promise.withResolvers<unknown>()
  const dispatch: TypertRemoteEventInvocation = {
    event,
    request,
    context,
    resolve: (outcome: TypertRemoteEventOutcome) => {
      if (outcome.kind === 'result') {
        settled.resolve(outcome.value)
        return
      }
      void Promise.resolve().then(next).then(settled.resolve, settled.reject)
    },
    reject: settled.reject,
  }
  if (!queue.push(dispatch)) void Promise.resolve().then(next).then(settled.resolve, settled.reject)
  return settled.promise
}

/** Reject an allowlisted event whose runtime arguments are not lossless JSON data. */
function assertJsonArgs(event: string, args: readonly unknown[]): JsonValue[] {
  for (const [index, arg] of args.entries()) {
    if (!isJsonValue(arg)) {
      throw new Error(`forwarded host event "${event}" argument ${String(index)} is not lossless JSON data`)
    }
  }
  return args as JsonValue[]
}
