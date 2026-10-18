/** Registers the file explorer as a right sidebar content kind. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the Remote Context merge (ctx.remote).
import type {} from '@aeven/api-remotes/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@aeven/client-locale/client'
// Type-only: pulls the content registry's Context merge (ctx.sidebarContent).
import type {} from '@aeven/client-ui-sidebar-select/client'
import type { SidebarContentPaneProps } from '@aeven/client-ui-sidebar-select/client'
import { createElement } from 'react'
import { FilesPane } from './FilesPane.tsx'
import { en, es, zh, type SidebarFilesKey } from './locales.ts'

export type { FilesPaneProps } from './FilesPane.tsx'
export type { SidebarFilesKey } from './locales.ts'

declare module '@aeven/client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Right sidebar file explorer copy. */
    sidebarFiles: SidebarFilesKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'sidebarFiles'

/** Services required by the explorer plugin. */
export const inject = ['locale']

/**
 * Registers the explorer pane for the `files` kind once the column's registry
 * and the `workspaceFiles` and `session` Remotes are present.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, es }), 'ui-sidebar-files: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.inject(['sidebarContent', 'remote', 'remote.workspaceFiles', 'remote.session'], (scoped) => {
    const remote = scoped.remote
    const Pane = (props: SidebarContentPaneProps) => createElement(FilesPane, { ...props, t, remote })
    scoped.effect(() => scoped.sidebarContent.register('files', Pane), 'ui-sidebar-files: files content kind')
  })
}
