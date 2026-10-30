/** Registers the file explorer as a right sidebar content kind. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the Remote Context merge (ctx.remote) and its forwarded `workspace-files/show` request.
import type {} from '@aeven/api-remotes/client'
// Type-only: pulls the session client's Context merge (ctx.sessions).
import type {} from '@aeven/api-session-controller/client'
import type { SessionId } from '@aeven/api-remotes/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@aeven/client-locale/client'
// Type-only: pulls the content registry's Context merge (ctx.sidebarContent).
import type {} from '@aeven/client-ui-sidebar-select/client'
import type { SidebarContentPaneProps } from '@aeven/client-ui-sidebar-select/client'
import { createElement, useCallback, useEffect, useState } from 'react'
import { resolveWorkspacePath } from '@aeven/util-workspace-path'
import { FilesPane } from './FilesPane.tsx'
import { canPreviewFile } from './open-with.tsx'
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
       * @returns Whether the file can be displayed in the sidebar; false for documents and other binary files without a viewer.
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
    // The path the next new Files pill of a session opens: a file to preview or a folder to expand to.
    const pending = new Map<string, { readonly path: string; readonly type: 'file' | 'directory' }>()
    const openFiles = new Map<string, { sessionId: string; surfaceId: string; path: string | null; root: string | null }>()
    // Mounted panes, which reveal a folder in place instead of opening another pill.
    const revealers = new Map<string, { sessionId: string; surfaceId: string; reveal: (path: string) => void }>()
    const openFile = async (sessionId: SessionId, path: string): Promise<boolean> => {
      if (!await canPreviewFile(remote, sessionId, path)) return false
      for (const file of openFiles.values()) {
        if (file.sessionId === sessionId && file.path !== null
          && resolveWorkspacePath(file.root ?? undefined, file.path) === resolveWorkspacePath(file.root ?? undefined, path)) {
          scoped.sidebarContent.requestOpen(sessionId, 'files', false, file.surfaceId)
          return true
        }
      }
      pending.set(sessionId, { path, type: 'file' })
      scoped.sidebarContent.requestOpen(sessionId, 'files', true)
      return true
    }
    const openFolder = (sessionId: SessionId, path: string): void => {
      const mounted = [...revealers.values()].find(pane => pane.sessionId === sessionId)
      if (mounted !== undefined) {
        mounted.reveal(path)
        scoped.sidebarContent.requestOpen(sessionId, 'files', false, mounted.surfaceId)
        return
      }
      pending.set(sessionId, { path, type: 'directory' })
      scoped.sidebarContent.requestOpen(sessionId, 'files', true)
    }
    scoped.provide('sidebarFiles', { open: openFile })
    scoped.inject(['sessions'], (shown) => {
      // The model's `sidebar_files` reaches the window showing its session; a window showing another session delegates.
      shown.remote.$on('workspace-files/show', function (request, next) {
        const sessionId = shown.sessions.scopeOf(this)
        if (sessionId === undefined) return next()
        if (request.type === 'file') return openFile(sessionId, request.path).then(opened => opened ? 'shown' : 'not-previewable')
        openFolder(sessionId, request.path)
        return Promise.resolve('shown')
      })
    })
    const Pane = (props: SidebarContentPaneProps) => {
      const key = `${props.sessionId}\u0000${props.surfaceId}`
      const onFileChange = useCallback((path: string | null, root: string | null) => {
        openFiles.set(key, { sessionId: props.sessionId, surfaceId: props.surfaceId, path, root })
      }, [key, props.sessionId, props.surfaceId])
      useEffect(() => () => { openFiles.delete(key) }, [key])
      const registerReveal = useCallback((reveal: (path: string) => void) => {
        revealers.set(key, { sessionId: props.sessionId, surfaceId: props.surfaceId, reveal })
        return () => { if (revealers.get(key)?.reveal === reveal) revealers.delete(key) }
      }, [key, props.sessionId, props.surfaceId])
      const [requested] = useState(() => pending.get(props.sessionId))
      useEffect(() => {
        if (pending.get(props.sessionId) === requested) pending.delete(props.sessionId)
      }, [props.sessionId, requested])
      return createElement(FilesPane, {
        ...props, t, remote, onFileChange, registerReveal,
        requestedFile: requested?.type === 'file' ? { path: requested.path } : undefined,
        requestedFolder: requested?.type === 'directory' ? { path: requested.path } : undefined,
      })
    }
    scoped.effect(() => scoped.sidebarContent.register('files', Pane), 'ui-sidebar-files: files content kind')
  })
}
