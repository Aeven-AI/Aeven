/**
 * Browser location consumer over the scoped `location/request` Remote Event
 * waterfall. The browser's own permission prompt is the reader's one
 * approval: a site it already allows is read directly, and otherwise the read
 * starts at once while a composer card explains the prompt and offers OK to
 * check again or No to decline this request.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@aeven/api-remotes/client'
import type {} from '@aeven/api-session-controller/client'
import type { ComposerChainProps } from '@aeven/client-ui-conversation/client'
import type {} from '@aeven/client-ui-renderer/client'
import type { PendingInteractionPublisher } from '@aeven/client-ui-session/client'
import type { TypertClientEventListener } from '@aeven/typert-protocol'
import type {} from '@aeven/client-locale/client'
import { PendingLocation } from './contract/slots.ts'
import { geolocationPermission, readDevicePosition } from './device-position.ts'
import { LocationPanel } from './LocationPanel.tsx'
import { en, zh } from './locales.ts'

export type { LocationComposerProps, PendingLocation } from './contract/slots.ts'
export type { LocationKey } from './locales.ts'

/** Required services: Agent scopes, Remote Events, Session UI, Slot registry, and copy. */
export const inject = ['sessions', 'remote', 'uiSession', 'slots', 'locale']

const NS = 'location'

type LocationListener = TypertClientEventListener<'location/request'>
type ClientLocationRequest = Parameters<LocationListener>[0]
type ClientLocationNext = Parameters<LocationListener>[1]
type ClientLocationAnswer = Awaited<ReturnType<LocationListener>>

/**
 * Whether this window is where the reader is looking at the session: it shows
 * that session and the page is visible. Every connected window receives the
 * request, so only this one may read without presenting the card.
 * @param ctx - Client root context.
 * @param sessionId - the requesting session.
 * @returns whether the reader is looking at the session here.
 */
function showsSession(ctx: ClientContext, sessionId: string): boolean {
  return ctx.sessions.list.getSnapshot().current === sessionId && document.visibilityState === 'visible'
}

/**
 * Answer one request: read the device position directly when this window
 * shows the session and the browser already allows it, otherwise present the
 * card until the read succeeds, the reader declines, or the request's lifetime
 * ends.
 */
async function answerLocation(
  ctx: ClientContext,
  owner: ClientContext,
  request: ClientLocationRequest,
  next: ClientLocationNext,
  registerPendingInteraction: PendingInteractionPublisher<PendingLocation>,
): Promise<ClientLocationAnswer> {
  const sessionId = ctx.sessions.scopeOf(owner)
  if (sessionId === undefined) return next()
  if (showsSession(ctx, sessionId) && await geolocationPermission() === 'granted') {
    const read = await readDevicePosition()
    if (read.kind === 'device' || read.kind === 'unavailable') return read
  }
  const pending = new PendingLocation(sessionId, request.purpose, request.signal)
  const completed = Promise.withResolvers<void>()
  const remove = registerPendingInteraction(pending, async () => {
    pending.delegate()
    await completed.promise
  })
  try {
    try {
      return await pending.result
    } catch (error) {
      if (pending.isDelegation(error)) return await next()
      throw error
    }
  } finally {
    remove()
    completed.resolve()
  }
}

/**
 * Install location copy, the composer takeover, and the scoped waterfall consumer.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-location: dictionaries')
  const registerPendingInteraction = ctx.uiSession.registerPendingInteraction<PendingLocation>(
    () => 0,
  )
  ctx.slots.inject('conversation.composer', () => ctx.slots.register({
    name: 'conversation.composer',
    priority: 1,
    select: ({ pendingInteraction }: ComposerChainProps): PendingLocation | null =>
      pendingInteraction instanceof PendingLocation ? pendingInteraction : null,
    locale: NS,
  }, LocationPanel))
  ctx.remote.$on('location/request', function (request, next) {
    return answerLocation(ctx, this, request, next, registerPendingInteraction)
  })
}
