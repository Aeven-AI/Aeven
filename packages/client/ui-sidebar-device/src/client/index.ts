/** Registers iOS Simulators and Android Emulators as a right sidebar content kind. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the Client Remote's Context merge (ctx.remote) with the device namespace.
import type {} from '@aeven/api-remotes/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@aeven/client-locale/client'
// Type-only: pulls the content registry's Context merge (ctx.sidebarContent).
import type {} from '@aeven/client-ui-sidebar-select/client'
import type { SidebarContentPaneProps } from '@aeven/client-ui-sidebar-select/client'
import { createElement } from 'react'
import { DevicePane } from './DevicePane.tsx'
import { en, es, zh } from './locales.ts'
import { DeviceClient } from './state.ts'

export type { DevicePaneProps } from './DevicePane.tsx'

/** Dictionary namespace owned by this plugin. */
const NS = 'sidebarDevice'

/** Services required by the device plugin. */
export const inject = ['locale']

/**
 * Registers the device pane for the `device` kind once the column's registry
 * and the Client Remote are both present.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, es }), 'ui-sidebar-device: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.inject(['sidebarContent', 'remote', 'remote.device'], (scoped) => {
    // One device client per Remote: every pane shares its state subscription.
    const client = new DeviceClient(scoped.remote)
    let seen: Set<string> | undefined
    scoped.effect(() => client.subscribe(() => {
      const current = new Set(client.getSnapshot().sessions.map(session =>
        JSON.stringify([session.sessionId, session.hostId, session.deviceId, session.openedAt])))
      if (seen !== undefined) {
        for (const session of client.getSnapshot().sessions) {
          const id = JSON.stringify([session.sessionId, session.hostId, session.deviceId, session.openedAt])
          if (!seen.has(id)) {
            scoped.sidebarContent.requestOpen(session.sessionId, 'device')
          }
        }
      }
      seen = current
    }), 'ui-sidebar-device: opened sessions')
    const Pane = (props: SidebarContentPaneProps) => createElement(DevicePane, { ...props, t, client })
    scoped.effect(() => scoped.sidebarContent.register('device', Pane), 'ui-sidebar-device: device content kind')
  })
}
