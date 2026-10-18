/**
 * Desktop update popup plugin, browser half: one `shell.overlay` entry that
 * shows what the Electron shell's release stream is doing and asks the reader
 * before Aeven replaces itself. The shell owns the stream — checks, download,
 * install — and this plugin only mirrors its states, so the same client served
 * over HTTP has no carrier and registers nothing.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls ctx.locale into this program.
import type {} from '@aeven/client-locale/client'
// Type-only: pulls the renderer-owned slots service.
import type {} from '@aeven/client-ui-renderer/client'
// Type-only: the `shell.overlay` declaration and its root-scope props.
import type {} from '@aeven/client-ui-layout/client'
import { UpdatePopup, type UpdatePopupInjected } from './UpdatePopup.tsx'
import { createUpdateStore } from './update-store.ts'
import { SHOW_UPDATE_COMMAND, desktopUpdateCarrier, type DesktopUpdateCarrier } from './update-carrier.ts'
import { en, es, NS, zh, type UpdateKey } from './locales.ts'

declare module '@aeven/client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Update popup copy. */
    update: UpdateKey
  }
}

export type { UpdatePopupInjected, UpdatePopupProps } from './UpdatePopup.tsx'
export type { UpdateSurfaceState } from './update-store.ts'
export type { DesktopUpdateStatus } from './update-carrier.ts'

/** Required services: the slot registry and dictionaries. */
export const inject = ['slots', 'locale']

/** The preload carrier, as this plugin needs it: the release stream and menu commands. */
interface DesktopUpdateShell {
  readonly update?: DesktopUpdateCarrier
  /** @param listener - called with each application-menu command. @returns disposer removing the listener. */
  onCommand?(listener: (command: string) => void): () => void
}

/**
 * Register the `update` dictionaries and the popup, which the shell opens from
 * its menu or when a downloaded release is ready.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, es }), 'ui-update: dictionaries')
  const scope = window as { avnDesktop?: DesktopUpdateShell }
  const carrier = desktopUpdateCarrier(scope)
  // The browser build has no shell: nothing checks, downloads, or restarts.
  if (carrier === undefined) return
  const store = createUpdateStore()
  ctx.effect(
    () => carrier.onChange((status) => { store.publish(status) }),
    'ui-update: shell states',
  )
  const onCommand = scope.avnDesktop?.onCommand?.bind(scope.avnDesktop)
  if (onCommand !== undefined) {
    ctx.effect(
      () => onCommand((command) => {
        if (command !== SHOW_UPDATE_COMMAND) return
        store.show()
        // The popup opens on the shell's latest state, then follows the check.
        void carrier.get().then((status) => { store.publish(status) }, () => {})
      }),
      'ui-update: menu command',
    )
  }
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'update',
    locale: NS,
    inject: (): UpdatePopupInjected => ({
      hooks: { update: store.state },
      check: () => { void carrier.check().then((status) => { store.publish(status) }, () => {}) },
      install: () => { void carrier.install() },
      close: () => { store.hide() },
    }),
  }, UpdatePopup))
}
