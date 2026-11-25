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
import type { ChatFileMentions, TurnTailOwnerProps } from '@aeven/client-ui-chat/client'
import type { SessionId } from '@aeven/session/types'
import type { ISessions } from '@aeven/api-session-controller/client'
import type { TurnDeliverables } from '@aeven/session-turn-outline/client'
import type {} from '@aeven/client-locale/client'
import type {} from '@aeven/client-ui-conversation/client'
import type {} from '@aeven/client-ui-renderer/client'
import type {} from '@aeven/client-ui-sidebar-files/client'
import { ProducedFiles } from './ProducedFiles.tsx'
import { desktopFileMenus, fileMenuLabels, revealFile, showFileMenu } from './file-menu.ts'
import { openProducedFile, producedFileLinks, type FileOpening } from './file-links.ts'
import { en, es, NS, zh, type DeliverablesKey } from './locales.ts'
import {
  deliverablesDefinition, producedFileMentions, producedImagesDefinition, producedFilesForClosing, projectedTurnData,
  selectProducedFiles, type DeliverablesTurnData,
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
  // How a produced file opens from the prose: the Files sidebar first, with the file's stored copy, then the path on
  // the reader's own desktop, falling back to the copy where the path is missing, then a download of the copy.
  const openingFor = (sessionId: SessionId, openFile: TurnTailOwnerProps['openFile']): FileOpening => ({
    previewFile: (path: string, copy?: string) =>
      copy === undefined ? ctx.sidebarFiles.open(sessionId, path) : ctx.sidebarFiles.open(sessionId, path, copy),
    fileUrl: (path: string, download?: boolean) => ctx.sidebarFiles.fileUrl(sessionId, path, download),
    attachmentUrl: (attachmentId: string, download?: boolean) => attachmentUrl(sessionId, attachmentId, download),
    canOpenPath: () => ctx.remote.$host.isLoopback && workspacePathOpen.getSnapshot() === true,
    openFile,
  })
  // The prose side of the same vocabulary: the chat view reaches this face
  // via ctx.get, so its absence — this plugin composed out — is the off state.
  // A Turn whose `turn/start` the loaded window lacks has no Definition data; the Host's projection holds its files.
  const turnData = (turn: TurnTailOwnerProps['turn'], sessionId: SessionId): DeliverablesTurnData | undefined => {
    const own = turn.data.get('deliverables')
    if (own !== undefined || turn.start !== undefined) return own
    const sessions: ISessions | undefined = ctx.get('sessions')
    const projected = sessions?.binding(sessionId)?.session.projections.faceOf('turnDeliverables').getSnapshot()
    return projectedTurnData(projected as readonly TurnDeliverables[] | undefined, turn.turn)
  }
  const mentions: ChatFileMentions = {
    forClosing(owner, sessionId) {
      // Same claim test the turn-tail chain entry runs: no produced files,
      // no vocabulary — the two surfaces agree by construction.
      const match = selectProducedFiles(owner)
      const files = match === null || Array.isArray(match)
        ? match
        : producedFilesForClosing(turnData(owner.turn, sessionId), owner.seq)
      if (files === null || files.length === 0) return undefined
      ensureWorkspacePathOpen()
      const opening = openingFor(sessionId, owner.openFile)
      return producedFileMentions(
        files,
        (file) => { openProducedFile(file, opening) },
        path => t('produced.open', { name: path }),
        showMenu === undefined ? undefined : (path) => { showMenu(path, owner.cwd) },
      )
    },
    forLinks(owner, sessionId) {
      ensureWorkspacePathOpen()
      // Read when a link resolves, so files a later result of the same Turn settles are seen.
      const turn = owner.turn
      const produced = () => (turn === undefined ? [] : producedFilesForClosing(turnData(turn, sessionId)))
      return producedFileLinks(owner.cwd, produced, openingFor(sessionId, owner.openFile))
    },
  }
  ctx.provide('chatFileMentions', mentions)
}
