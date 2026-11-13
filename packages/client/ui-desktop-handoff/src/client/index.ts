/**
 * Browser half of the desktop hand-off. On a web client served by a Host that has no access to the reader's
 * computer, the right sidebar's Files, Browser, Terminal and Devices entries stay where they are and open the
 * "Available in Aeven Desktop" dialog, and so does a prompt the Host refuses because the conversation works in a
 * folder of a device that is not running it, and so does the model's `offer_desktop` call for a request that needs
 * the reader's computer. The desktop app's own window never mounts it: there those entries are real panes.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls ctx.locale into this program.
import type {} from '@aeven/client-locale/client'
// Type-only: pulls the renderer-owned slots service.
import type {} from '@aeven/client-ui-renderer/client'
// Type-only: the `shell.overlay` declaration and its root-scope props.
import type {} from '@aeven/client-ui-layout/client'
// Type-only: the right sidebar's content registry.
import type {} from '@aeven/client-ui-sidebar-select/client'
import type { SidebarContentKind } from '@aeven/client-ui-sidebar-select/client'
// Type-only: the conversation service's refusal handlers.
import type {} from '@aeven/client-ui-conversation/client'
// Type-only: the Remote Context merge (ctx.remote) and its forwarded `desktop-handoff/offer` request.
import type {} from '@aeven/api-remotes/client'
// Type-only: the sessions service that maps a scoped request to the session it belongs to.
import type {} from '@aeven/api-session-controller/client'
import type { SessionId } from '@aeven/session/types'
import { HandoffModal, type HandoffModalInjected } from './HandoffModal.tsx'
import { createHandoffStore, type HandoffReason } from './store.ts'
import { en, es, NS, zh, type DesktopHandoffKey } from './locales.ts'

declare module '@aeven/client-ui-slots' {
  interface LocaleNamespaceMap {
    'desktop-handoff': DesktopHandoffKey
  }
}

export type { HandoffModalInjected, HandoffModalProps } from './HandoffModal.tsx'
export type { HandoffReason, HandoffState } from './store.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A surface that cannot do its work in this client asks to continue in the desktop app, such as
     * the Browser entry when no Aeven extension is installed. Answered only where the hand-off dialog
     * is composed (a web client whose Host has no machine of the reader's).
     * @mode bail
     * @param reason - why the reader needs the desktop app; picks the dialog's message.
     * @param sessionId - the conversation to continue there, when one is current.
     * @returns true once the dialog opened; undefined where no hand-off dialog answers.
     */
    'desktop-handoff/request'(reason: HandoffReason, sessionId?: string): true | undefined
  }
}

export const inject = ['slots', 'locale']

/**
 * The right sidebar entries whose content lives on the reader's own computer. The Browser entry is
 * not among them: ui-sidebar-browser owns it and opens the reader's own browser through the Aeven
 * extension, asking for this dialog (`desktop-handoff/request`) only when no extension is installed.
 */
const LOCAL_KINDS = ['files', 'terminal', 'meeting', 'device'] as const satisfies readonly SidebarContentKind[]

/** The refusal a Host answers a prompt with when the conversation's folder is on a device that is not running it. */
const NO_LOCAL_DIRECTORY = 'workspace/no-local-directory'

/**
 * The download page of this deployment's Aeven site. `identity-user-aeven` states the site in the served page as
 * `webUrl`; a deployment that names none offers no download.
 * @returns the page, or undefined.
 */
function downloadPage(): string | undefined {
  const site = (globalThis as { __AVN_AEVEN__?: { readonly webUrl?: string } }).__AVN_AEVEN__?.webUrl
  return site === undefined || !URL.canParse(site) ? undefined : new URL('/downloads', site).href
}

/**
 * Register the dialog, the sidebar launchers, and the refusal handler.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  // The desktop shell renders real panes for these entries and runs folder conversations itself.
  if ((window as { avnDesktop?: unknown }).avnDesktop !== undefined) return
  ctx.effect(() => ctx.locale.register(NS, { zh, en, es }), 'ui-desktop-handoff: dictionaries')
  const store = createHandoffStore()
  ctx.effect(() => ctx.on('desktop-handoff/request', (reason, sessionId) => {
    store.show(reason, sessionId)
    return true
  }), 'ui-desktop-handoff: hand-off requests')
  const downloadUrl = downloadPage()

  ctx.inject(['sidebarContent'], (scoped) => {
    for (const kind of LOCAL_KINDS) {
      scoped.effect(
        () => scoped.sidebarContent.registerLauncher(kind, (sessionId) => { store.show(kind, sessionId) }),
        `ui-desktop-handoff: ${kind} launcher`,
      )
    }
  })
  ctx.inject(['uiConversation'], (scoped) => {
    scoped.effect(
      () => scoped.uiConversation.registerRefusalHandler(NO_LOCAL_DIRECTORY, (sessionId: SessionId) => { store.show('folder', sessionId) }),
      'ui-desktop-handoff: folder refusal',
    )
  })
  ctx.inject(['remote', 'sessions'], (shown) => {
    // The model's `offer_desktop` reaches the window showing its session; a window showing another session delegates.
    // It arrives as a live event, so a conversation loaded from its history never reopens the dialog.
    shown.remote.$on('desktop-handoff/offer', function (request, next) {
      const sessionId = shown.sessions.scopeOf(this)
      if (sessionId === undefined) return next()
      store.show(request.reason, sessionId)
      return Promise.resolve('shown')
    })
  })
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'desktop-handoff',
    locale: NS,
    inject: (): HandoffModalInjected => ({
      hooks: { handoff: store.state },
      downloadUrl,
      close: () => { store.hide() },
    }),
  }, HandoffModal))
}
