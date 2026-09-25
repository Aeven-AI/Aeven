/**
 * Imagine plugin, browser half: claims the `/i` path root on the layout's
 * surface router and contributes the Imagine page to the `surface` slot, so
 * `/i/<id>` shows Imagine in the center column in place of the chat. Imagine
 * is independent of chat Sessions: the id in its address names no Session.
 * @module @aeven/client-ui-imagine/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the layout Context merge (ctx.layout) and the `surface` slot.
import type {} from '@aeven/client-ui-layout/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@aeven/client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@aeven/client-ui-renderer/client'
import { ImaginePage } from './ImaginePage.tsx'
import { IMAGINE_ROOT, imagineIdOf, newImaginePath } from './imagine-url.ts'
import type { ImaginePageInjected } from './slots.ts'
import { en, zh } from './locales.ts'

export { IMAGINE_ROOT, imagineIdOf, newImaginePath } from './imagine-url.ts'
export type { ImaginePageInjected, ImaginePageProps } from './slots.ts'
export type { ImagineKey } from './locales.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'imagine'

/** Surface id; the `surface` slot key the page registers under. */
const SURFACE = 'imagine'

/** Required services: the slot registry, the layout's surface router, and the copy. */
export const inject = ['slots', 'layout', 'locale']

/**
 * Client plugin body: the `/i` claim, its address canonicalization, and the page.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const { surfaces } = ctx.layout
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-imagine: dictionaries')
  ctx.effect(() => surfaces.register({ id: SURFACE, root: IMAGINE_ROOT }), 'ui-imagine: /i surface')

  // Every Imagine address names an id: a bare `/i`, or one whose id is not a
  // UUID, is rewritten in place to a fresh `/i/<uuid>`, as a New Session
  // link names its chat before the chat exists.
  ctx.effect(() => {
    const canonicalize = (): void => {
      if (surfaces.current.getSnapshot() !== SURFACE) return
      if (imagineIdOf(surfaces.pathname()) !== undefined) return
      surfaces.replace(newImaginePath())
    }
    const unsubscribe = surfaces.current.subscribe(canonicalize)
    canonicalize()
    return unsubscribe
  }, 'ui-imagine: address canonicalization')

  const injected: ImaginePageInjected = { heroT: ctx.locale.bind('conversation') }
  ctx.slots.inject('surface', () => ctx.slots.register({
    name: 'surface',
    key: SURFACE,
    locale: NS,
    inject: () => injected,
  }, ImaginePage))
}
