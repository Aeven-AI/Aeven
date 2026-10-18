/** Registers interactive shells as a right sidebar content kind. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the terminal client's Context merge (ctx.webTerminals).
import type {} from '@aeven/api-terminal-controller/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@aeven/client-locale/client'
// Type-only: pulls the content registry's Context merge (ctx.sidebarContent).
import type {} from '@aeven/client-ui-sidebar-select/client'
import type { SidebarContentPaneProps } from '@aeven/client-ui-sidebar-select/client'
// Type-only: pulls the theme service's Context merge (ctx.theme).
import type {} from '@aeven/client-ui-theme/client'
import type { SessionId } from '@aeven/session/types'
import { createElement } from 'react'
import { TerminalPane, type TerminalHolds, type ThemeSource } from './TerminalPane.tsx'
import { en, es, zh } from './locales.ts'

export type { TerminalPaneProps } from './TerminalPane.tsx'

/** Dictionary namespace owned by this plugin. */
const NS = 'sidebarTerminal'

/** Services required by the terminal plugin. */
export const inject = ['locale', 'theme']

/**
 * Registers the terminal pane for the `terminal` kind once the column's
 * registry and the terminal client are both present.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, es }), 'ui-sidebar-terminal: dictionaries')
  const t = ctx.locale.bind(NS)
  const theme: ThemeSource = {
    getSnapshot: () => ctx.theme.getTheme(),
    subscribe: listener => ctx.on('theme/change', listener),
  }
  ctx.inject(['sidebarContent', 'webTerminals'], (scoped) => {
    const terminals = scoped.webTerminals
    // Every mounted pane holds its shell; the Host lets an unheld shell go
    // once it is provably idle for the configured unattended timeout.
    const open = new Map<string, { sessionId: SessionId; tabId: string; contentId: string }>()
    const holds: TerminalHolds = {
      hold: (sessionId, surfaceId) => {
        const key = JSON.stringify([sessionId, surfaceId])
        open.set(key, { sessionId, tabId: surfaceId, contentId: surfaceId })
        terminals.retainTabs([...open.values()])
        return () => {
          open.delete(key)
          terminals.retainTabs([...open.values()])
        }
      },
    }
    scoped.effect(() => () => { terminals.retainTabs([]) }, 'ui-sidebar-terminal: holds')
    const Pane = (props: SidebarContentPaneProps) => createElement(TerminalPane, { ...props, t, terminals, theme, holds })
    scoped.effect(() => scoped.sidebarContent.register('terminal', Pane), 'ui-sidebar-terminal: terminal content kind')
    // Closing the pill ends its shell; a pane unmounting on a session switch does not.
    scoped.effect(() => scoped.sidebarContent.registerCloseHandler('terminal', (sessionId, surfaceId) => {
      terminals.close(sessionId as SessionId, surfaceId, surfaceId)
    }), 'ui-sidebar-terminal: close shells')
  })
}
