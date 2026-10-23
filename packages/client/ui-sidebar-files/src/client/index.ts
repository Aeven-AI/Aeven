/** Registers the file explorer as a right sidebar content kind. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the Remote Context merge (ctx.remote).
import type {} from '@aeven/api-remotes/client'
import type { SessionId } from '@aeven/api-remotes/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@aeven/client-locale/client'
// Type-only: pulls the content registry's Context merge (ctx.sidebarContent).
import type {} from '@aeven/client-ui-sidebar-select/client'
import type { SidebarContentPaneProps } from '@aeven/client-ui-sidebar-select/client'
import { createElement, useCallback, useEffect, useState } from 'react'
import { fileKindOf } from '@aeven/client-ui-primitives'
import { resolveWorkspacePath } from '@aeven/util-workspace-path'
import { FilesPane } from './FilesPane.tsx'
import { en, es, zh, type SidebarFilesKey } from './locales.ts'

export type { FilesPaneProps } from './FilesPane.tsx'
export type { SidebarFilesKey } from './locales.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Open a workspace file in the session's Files sidebar. */
    sidebarFiles: {
      /**
       * Focus the file’s existing Files pane, or open a new pane.
       * @param sessionId - Session owning the workspace.
       * @param path - Workspace-relative or absolute file path.
       * @returns Whether the file can be displayed in the sidebar; false for non-text files without an image viewer.
       */
      open(sessionId: SessionId, path: string): Promise<boolean>
    }
  }
}

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
    const pending = new Map<string, string>()
    const openFiles = new Map<string, { sessionId: string; surfaceId: string; path: string | null; root: string | null }>()
    scoped.provide('sidebarFiles', {
      async open(sessionId, path) {
        if (fileKindOf(path) !== 'image') {
          const result = await remote.workspaceFiles.read(sessionId, path)
          if (!result.ok && result.error.code === 'workspace-file/not-text') return false
        }
        for (const file of openFiles.values()) {
          if (file.sessionId === sessionId && file.path !== null
            && resolveWorkspacePath(file.root ?? undefined, file.path) === resolveWorkspacePath(file.root ?? undefined, path)) {
            scoped.sidebarContent.requestOpen(sessionId, 'files', false, file.surfaceId)
            return true
          }
        }
        pending.set(sessionId, path)
        scoped.sidebarContent.requestOpen(sessionId, 'files', true)
        return true
      },
    })
    const Pane = (props: SidebarContentPaneProps) => {
      const key = `${props.sessionId}\u0000${props.surfaceId}`
      const onFileChange = useCallback((path: string | null, root: string | null) => {
        openFiles.set(key, { sessionId: props.sessionId, surfaceId: props.surfaceId, path, root })
      }, [key, props.sessionId, props.surfaceId])
      useEffect(() => () => { openFiles.delete(key) }, [key])
      const [requestedFile] = useState(() => {
        const path = pending.get(props.sessionId)
        return path === undefined ? undefined : { path }
      })
      useEffect(() => {
        if (pending.get(props.sessionId) === requestedFile?.path) pending.delete(props.sessionId)
      }, [props.sessionId, requestedFile])
      return createElement(FilesPane, { ...props, t, remote, requestedFile, onFileChange })
    }
    scoped.effect(() => scoped.sidebarContent.register('files', Pane), 'ui-sidebar-files: files content kind')
  })
}
