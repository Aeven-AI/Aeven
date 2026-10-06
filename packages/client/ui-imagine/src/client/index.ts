/**
 * Imagine plugin, browser half. Imagine is a way to start an ordinary chat: `/imagine` is a start address of the
 * chat, which shows a blank Session with a gallery of starter prompts in place of the Hero and the regular composer
 * on the floor below it. Choosing a prompt puts it in the composer; sending it is an ordinary first message, after
 * which the address becomes the chat's own and `generate_image` makes the images. The sidebar's Imagine row opens
 * `/imagine`.
 *
 * The same plugin renders generated images at their tool call, and hangs the `/image-model` popup on the host
 * command in the chat composer.
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
import { ImageToolView } from './ImageToolView.tsx'
import { IMAGE_TOOLS, registerGeneratedImages } from './generated-images.ts'
import type {} from '@aeven/client-ui-tool/client'
import { imageModelDecoration } from './image-model-picker.ts'
import { ImaginePrompts } from './ImaginePrompts.tsx'
import { ImagineRow, type ImagineRowInjected } from './ImagineRow.tsx'
import { en, zh } from './locales.ts'

export type { ImagineKey } from './locales.ts'

/** Imagine's start address. */
const IMAGINE_PATH = '/imagine'

/** The Workspace UI's start-address face. */
interface StartAddresses {
  registerStartAddress(path: string): () => void
  openStartAddress(path: string): void
  readonly startAddress: { getSnapshot(): string | undefined; subscribe(fn: () => void): () => void }
}

/** The conversation's start-page switch. */
interface StartPageSwitch {
  readonly startPage: { set(active: boolean): void }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'imagine'

/** Required services: the slot registry and the copy. */
export const inject = ['slots', 'locale']

/**
 * Client plugin body: the Imagine row, the starter prompts, the in-chat image view and the image-model picker.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-imagine: dictionaries')

  // The picker waits on the surfaces it decorates rather than holding the page
  // behind them: a deployment with no command surface and no settings document
  // still gets Imagine, and its `/image-model` line reaches the host command.
  ctx.inject(['commandUi', 'settingsScope', 'sessions', 'remote', 'remote.session'], (pickerCtx: ClientContext) => {
    const command = pickerCtx.get('commandUi') as CommandUiContract
    pickerCtx.effect(() => command.decorate(imageModelDecoration(pickerCtx)),
      'ui-imagine: /image-model decoration')
  })

  ctx.inject(['uiConversation'], imageCtx => { registerGeneratedImages(imageCtx) })
  ctx.slots.inject('tool.call.toolview', function* () {
    for (const key of IMAGE_TOOLS) {
      yield ctx.slots.register({ name: 'tool.call.toolview', key, locale: NS }, ImageToolView)
    }
  })

  // `/imagine` is a start address of the chat: the Workspace UI keeps it over a blank Session, and while it is the
  // address the conversation shows this plugin's gallery in place of the Hero.
  ctx.inject(['uiWorkspace', 'uiConversation'], (startCtx: ClientContext) => {
    const addresses = startCtx.get('uiWorkspace') as unknown as StartAddresses
    const conversation = startCtx.get('uiConversation') as unknown as StartPageSwitch
    startCtx.effect(() => addresses.registerStartAddress(IMAGINE_PATH), 'ui-imagine: /imagine start address')
    startCtx.effect(() => {
      const sync = (): void => { conversation.startPage.set(addresses.startAddress.getSnapshot() === IMAGINE_PATH) }
      sync()
      const unsubscribe = addresses.startAddress.subscribe(sync)
      return () => {
        unsubscribe()
        conversation.startPage.set(false)
      }
    }, 'ui-imagine: start page')
    const row: ImagineRowInjected = {
      href: IMAGINE_PATH,
      open: () => { addresses.openStartAddress(IMAGINE_PATH) },
    }
    startCtx.slots.inject('sidebar.nav', () => startCtx.slots.register({
      name: 'sidebar.nav',
      id: 'imagine',
      locale: NS,
      inject: () => row,
    }, ImagineRow))
  })

  ctx.slots.inject('conversation.start', () => ctx.slots.register({
    name: 'conversation.start',
    id: 'imagine-prompts',
    locale: NS,
  }, ImaginePrompts))
}
