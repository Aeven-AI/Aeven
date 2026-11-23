/**
 * Deliverables plugin, browser half: registers the produced-files row into
 * the chat view's turn-tail chain, and provides the `chatFileMentions`
 * service that links inline-code mentions of produced files in the closing
 * prose and opens prose links whose destination is a local path. All policy lives here — the supported mutation calls, mention
 * matching, chip cap, and copy — so
 * composing this plugin out of cordis.yml removes both surfaces entirely;
 * the owning view renders an empty chain and inert prose at zero cost.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@aeven/api-remotes/client'
import { createSnapshotStore } from '@aeven/client-store'
import type { ChatFileMentions } from '@aeven/client-ui-chat/client'
import type {} from '@aeven/client-locale/client'
import type {} from '@aeven/client-ui-conversation/client'
import type {} from '@aeven/client-ui-renderer/client'
import type {} from '@aeven/client-ui-sidebar-files/client'
import { ProducedFiles } from './ProducedFiles.tsx'
import { desktopFileMenus, fileMenuLabels, revealFile, showFileMenu } from './file-menu.ts'
import { downloadUrl, producedFileLinks } from './file-links.ts'
import { en, es, NS, zh, type DeliverablesKey } from './locales.ts'
import {
  deliverablesDefinition, producedFileMentions, producedImagesDefinition, producedFilesForClosing, selectProducedFiles,
} from './turn-deliverables.ts'

declare module '@aeven/client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Produced-files row copy. */
    'deliverables': DeliverablesKey
  }
}

export { ProducedFiles, type ProducedFilesProps } from './ProducedFiles.tsx'
export { producedFilesForClosing, producedForClosing, type ProducedFile } from './turn-deliverables.ts'

/**
 * The URL of a stored copy a Session's log cites.
 * @param sessionId - the Session whose log cites the copy.
 * @param attachmentId - the copy's attachment id.
 * @param download - whether the browser saves the file instead of showing it.
 * @returns the absolute `/api/attachment-file` URL on this app's origin.
 */
function attachmentUrl(sessionId: string, attachmentId: string, download = false): string {
  const url = new URL('api/attachment-file', document.baseURI)
  url.searchParams.set('sessionId', sessionId)
  url.searchParams.set('id', attachmentId)
  if (download) url.searchParams.set('download', '1')
  return url.href
}

/** Required services for the tail-slot registration and its dictionaries. */
export const inject = ['slots', 'locale', 'uiConversation', 'remote', 'remote.session', 'sidebarFiles']

/**
 * Client plugin body: register the dictionaries and the turn-tail entry.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const workspacePathOpen = createSnapshotStore<boolean | undefined>(undefined)
  let requestedWorkspacePathOpen = false
  let capabilityRevision = 0
  let pendingCapability: Promise<void> | undefined
  const loadWorkspacePathOpen = (): void => {
    if (pendingCapability !== undefined) return
    const revision = capabilityRevision
    const pending = ctx.remote.session.canOpenWorkspacePath()
      .then((result) => {
        if (revision === capabilityRevision) workspacePathOpen.set(result.ok && result.value)
      })
      .finally(() => {
        if (pendingCapability === pending) pendingCapability = undefined
      })
    pendingCapability = pending
  }
  const ensureWorkspacePathOpen = (): void => {
    requestedWorkspacePathOpen = true
    if (workspacePathOpen.getSnapshot() === undefined) loadWorkspacePathOpen()
  }
  ctx.on('connection/reset', () => {
    capabilityRevision++
    pendingCapability = undefined
    workspacePathOpen.set(undefined)
    if (requestedWorkspacePathOpen) loadWorkspacePathOpen()
  })
  ctx.uiConversation.events.register(deliverablesDefinition)
  ctx.uiConversation.events.register(producedImagesDefinition)
  ctx.effect(() => ctx.locale.register(NS, { zh, en, es }), 'ui-deliverables: dictionaries')
  const t = ctx.locale.bind(NS)
  // The desktop draws the file menu; the browser-served client leaves the
  // platform's own right-click menu alone, which is what its reader expects.
  const menus = desktopFileMenus()
  const showMenu = menus === undefined
    ? undefined
    : (path: string, cwd: string | undefined): void => {
      void showFileMenu({ menus, remote: ctx.remote, labels: fileMenuLabels(t) }, path, cwd)
    }
  ctx.slots.inject(
    'conversation.chat.turnTail',
    () => ctx.slots.register({
      name: 'conversation.chat.turnTail',
      select: selectProducedFiles,
      locale: NS,
      inject: sessionId => ({
        previewFile: (path: string, copy?: string) =>
          copy === undefined ? ctx.sidebarFiles.open(sessionId, path) : ctx.sidebarFiles.open(sessionId, path, copy),
        fileUrl: (path: string, download?: boolean) => ctx.sidebarFiles.fileUrl(sessionId, path, download),
        attachmentUrl: (attachmentId: string, download?: boolean) => attachmentUrl(sessionId, attachmentId, download),
        isLoopback: ctx.remote.$host.isLoopback,
        ensureWorkspacePathOpen,
        openFileMenu: showMenu,
        revealFile: (path: string, cwd: string | undefined) => { void revealFile(ctx.remote, path, cwd) },
        hooks: { workspacePathOpen },
      }),
    }, ProducedFiles),
  )
  // The prose side of the same vocabulary: the chat view reaches this face
  // via ctx.get, so its absence — this plugin composed out — is the off state.
  const mentions: ChatFileMentions = {
    forClosing(owner, sessionId) {
      // Same claim test the turn-tail chain entry runs: no produced files,
      // no vocabulary — the two surfaces agree by construction.
      const files = selectProducedFiles(owner)
      if (files === null) return undefined
      return producedFileMentions(
        files,
        // The conversation may run on another device of the account: a file with a stored copy downloads from it,
        // as the row's does, where the page is not the Host's own desktop or the Host has nothing at the path.
        (file) => {
          const attachmentId = file.attachmentId
          if (attachmentId === undefined) {
            owner.openFile(file.path)
            return
          }
          const download = () => { downloadUrl(attachmentUrl(sessionId, attachmentId, true)) }
          if (ctx.remote.$host.isLoopback) owner.openFile(file.path, download)
          else download()
        },
        path => t('produced.open', { name: path }),
        showMenu === undefined ? undefined : (path) => { showMenu(path, owner.cwd) },
      )
    },
    forLinks(owner, sessionId) {
      ensureWorkspacePathOpen()
      // Read when a link resolves, so files a later result of the same Turn settles are seen.
      const produced = () => producedFilesForClosing(owner.turn?.data.get('deliverables'))
      return producedFileLinks(owner.cwd, produced, {
        previewFile: (path: string, copy?: string) =>
          copy === undefined ? ctx.sidebarFiles.open(sessionId, path) : ctx.sidebarFiles.open(sessionId, path, copy),
        fileUrl: (path: string, download?: boolean) => ctx.sidebarFiles.fileUrl(sessionId, path, download),
        attachmentUrl: (attachmentId: string, download?: boolean) => attachmentUrl(sessionId, attachmentId, download),
        canOpenPath: () => ctx.remote.$host.isLoopback && workspacePathOpen.getSnapshot() === true,
        openFile: owner.openFile,
      })
    },
  }
  ctx.provide('chatFileMentions', mentions)
}
