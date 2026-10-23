/**
 * Imagine plugin, browser half. Imagine is a way to start an ordinary chat: `/imagine` is a start address of the
 * chat, which shows a blank Session with a gallery of starter prompts in place of the Hero and the regular composer
 * on the floor below it. Choosing a prompt puts it in the composer; sending it is an ordinary first message, after
 * which the address becomes the chat's own and `generate_image` makes the images. The sidebar's Imagine row opens
 * `/imagine`.
 *
 * The same plugin renders generated images and videos at their tool call, and hangs the `/image-model` and
 * `/video-model` popups on the host commands in the chat composer.
 * @module @aeven/client-ui-imagine/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@aeven/client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@aeven/client-ui-renderer/client'
// Type-only: pulls the sidebar's `sidebar.nav` slot declaration.
import type {} from '@aeven/client-ui-sidebar/client'
import type { CommandUiContract } from '@aeven/client-ui-commands/client'
import { ImageResultView } from './ImageResultView.tsx'
import { ImageToolView } from './ImageToolView.tsx'
import { VideoToolView } from './VideoToolView.tsx'
import { IMAGE_RESULT_TOOLS, IMAGE_TOOLS, VIDEO_TOOLS, registerGeneratedImages } from './generated-images.ts'
import type {} from '@aeven/client-ui-tool/client'
import { imageModelDecoration, videoModelDecoration } from './image-model-picker.ts'
import { ImaginePrompts } from './ImaginePrompts.tsx'
import { ImagineRow, type ImagineRowInjected } from './ImagineRow.tsx'
import { en, es, zh } from './locales.ts'

export type { ImagineKey } from './locales.ts'

/** Imagine's start address. */
const IMAGINE_PATH = '/imagine'

/** The Workspace UI's start-address face. */
interface StartAddresses {
  registerStartAddress(path: string, copy?: { composerPlaceholder?: () => string }): () => void
  openStartAddress(path: string): void
  readonly startAddress: { getSnapshot(): string | undefined; subscribe(fn: () => void): () => void }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'imagine'

/** Required services: the slot registry and the copy. */
export const inject = ['slots', 'locale']

/**
 * Client plugin body: the Imagine row, the starter prompts, the in-chat image and video views and the model pickers.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, es }), 'ui-imagine: dictionaries')
  const t = ctx.locale.bind(NS)

  // The picker waits on the surfaces it decorates rather than holding the page
  // behind them: a deployment with no command surface and no settings document
  // still gets Imagine, and its `/image-model` line reaches the host command.
  ctx.inject(['commandUi', 'settingsScope', 'sessions', 'remote', 'remote.session'], (pickerCtx: ClientContext) => {
    const command = pickerCtx.get('commandUi') as CommandUiContract
    pickerCtx.effect(() => command.decorate(imageModelDecoration(pickerCtx)),
      'ui-imagine: /image-model decoration')
    pickerCtx.effect(() => command.decorate(videoModelDecoration(pickerCtx)),
      'ui-imagine: /video-model decoration')
  })

  ctx.inject(['uiConversation'], (imageCtx) => { registerGeneratedImages(imageCtx) })
  ctx.slots.inject('tool.call.toolview', function* () {
    for (const key of IMAGE_TOOLS) {
      yield ctx.slots.register({ name: 'tool.call.toolview', key, locale: NS }, ImageToolView)
    }
    for (const key of VIDEO_TOOLS) {
      yield ctx.slots.register({ name: 'tool.call.toolview', key, locale: NS }, VideoToolView)
    }
    // Tools that show photographs found elsewhere: the same lane, the same row,
    // so the images a result carries are visible without unfolding anything.
    for (const key of IMAGE_RESULT_TOOLS) {
      yield ctx.slots.register({ name: 'tool.call.toolview', key, locale: NS }, ImageResultView)
    }
  })

  // `/imagine` is a start address of the chat: the Workspace UI keeps it over a blank Session, and while it is the
  // address the conversation shows this plugin's gallery in place of the Hero.
  ctx.inject(['uiWorkspace'], (startCtx: ClientContext) => {
    const addresses = startCtx.get('uiWorkspace') as unknown as StartAddresses
    startCtx.effect(() => addresses.registerStartAddress(IMAGINE_PATH, {
      // The page's own composer prompt: what the reader describes here is an
      // image or a video, not a question.
      composerPlaceholder: () => t('composer.placeholder'),
    }), 'ui-imagine: /imagine start address')
    const row: ImagineRowInjected = {
      href: IMAGINE_PATH,
      open: () => { addresses.openStartAddress(IMAGINE_PATH) },
    }
    startCtx.slots.inject('sidebar.nav', () => startCtx.slots.register({
      name: 'sidebar.nav',
      id: 'imagine',
      // After the Bots row: the two shares an order, so the explicit step keeps
      // Imagine second regardless of which package registers first.
      order: 1,
      locale: NS,
      inject: () => row,
    }, ImagineRow))
  })

  ctx.slots.inject('conversation.start', () => ctx.slots.register({
    name: 'conversation.start',
    key: IMAGINE_PATH,
    locale: NS,
  }, ImaginePrompts))
}
