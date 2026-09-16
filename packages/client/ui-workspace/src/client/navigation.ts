/** Workspace archive and directory UI capability. */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { ClientRemote, DirectoryListing, RemoteFailure } from '@aeven/api-remotes/client'
import type {
  ISessions,
  SessionFace,
  SessionListState,
} from '@aeven/api-session-controller/client'
import type {
  IWorkspaces, WorkspaceId, WorkspaceView,
} from '@aeven/api-workspace-controller/client'
import type { SessionId } from '@aeven/session/types'
import type { SessionUrlNavigation } from './session-url.ts'

type InitialNavigation = 'waiting' | 'connecting' | 'done'

/** Workspace archive and directory operations consumed by Client UI domains. */
export interface UiWorkspace {
  /**
   * Resolve the reusable or newly created blank Session for a Workspace.
   * @param workspaceId - target Workspace.
   * @returns a Session already addressable through the Session Controller.
   */
  connectWorkspace(workspaceId: WorkspaceId): Promise<SessionId>
  /**
   * Start a New Session flow and navigate to its Session.
   * @param workspaceId - explicit target; absent inherits the current or most recent Workspace.
   */
  startSession(workspaceId?: WorkspaceId): void
  /**
   * Archive a Session and clear it when it is the current selection.
   * @param sessionId - Session to archive.
   */
  archiveSession(sessionId: SessionId): Promise<void>
  /**
   * Open the Host-native directory picker.
   * @returns the selected directory, or null when cancelled.
   */
  pickDirectory(): Promise<string | null>
  /**
   * List one Host directory level.
   * @param path - directory path; absent selects the Host home.
   * @param signal - cancellation for a superseded scan.
   * @returns directory entries and breadcrumb ancestry.
   */
  listDirectory(path?: string, signal?: AbortSignal): Promise<DirectoryListing>
  /**
   * Create a child directory.
   * @param path - existing parent directory.
   * @param name - child directory name.
   * @returns created absolute path.
   */
  createDirectory(path: string, name: string): Promise<string>
  /**
   * Wait until the first Workspace and Session lists have arrived and the
   * selected Session's first history page has settled. Later navigation does
   * not reset the wait. Resolves on plugin disposal so boot cannot hang
   * behind teardown.
   * @returns when that first shell payload is ready to reveal.
   */
  whenInitialDataReady(): Promise<void>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Cross-Controller Workspace navigation and directory UI capability. */
    uiWorkspace: UiWorkspace
  }
}

/** Structured directory failure exposed to directory UI consumers. */
export class DirectoryBrowseError extends Error {
  override readonly name = 'DirectoryBrowseError'

  /** @param rpcError - Host directory business failure. */
  constructor(readonly rpcError: RemoteFailure) {
    super(`directory browse failed: ${rpcError.code}: ${rpcError.message}`)
  }
}

/** Implements Workspace archive and directory UI operations. */
class UiWorkspaceService extends Service implements UiWorkspace {
  private readonly connecting = new Map<WorkspaceId, Promise<SessionId>>()
  private initialNav: InitialNavigation = 'waiting'
  private initialDataReady: Promise<void> | undefined
  private initialDataCheck: (() => void) | undefined
  private watchedSessionId: SessionId | undefined
  private watchedSession: SessionFace | undefined
  private sessionUnsub: (() => void) | undefined

  /**
   * @param ctx - Client root Context.
   * @param directoryPicker - the directory-picking Remote namespace.
   * @param workspaces - pure Workspace Controller.
   * @param sessions - pure Session Controller.
   * @param sessionUrl - address-bar projection for Session selection.
   */
  constructor(
    ctx: Context,
    private readonly directoryPicker: ClientRemote['directoryPicker'],
    private readonly workspaces: IWorkspaces,
    private readonly sessions: ISessions,
    private readonly sessionUrl: SessionUrlNavigation,
  ) {
    super(ctx, 'uiWorkspace')
    ctx.effect(() => this.watchNavigation(), 'ui-workspace: Workspace navigation policy')
  }

  async connectWorkspace(workspaceId: WorkspaceId): Promise<SessionId> {
    const workspace = this.workspaces.list.getSnapshot().items
      .find(item => item.workspaceId === workspaceId)
    if (workspace === undefined) {
      throw new Error(`uiWorkspace.connectWorkspace: unknown workspace ${workspaceId}`)
    }
    const inflight = this.connecting.get(workspaceId)
    if (inflight !== undefined) return inflight

    const archived = this.workspaces.list.getSnapshot().archivedSessionIds
    const sessions = this.sessions.list.getSnapshot()
    for (const id of sessions.ids) {
      const summary = sessions.byId[id]
      if (summary !== undefined && summary.blank && summary.cwd === workspace.path
        && workspace.sessionIds.includes(summary.id)
        && !archived.includes(summary.id)) return summary.id
    }

    const attempt = this.sessions.create({ workspaceId })
      .finally(() => { this.connecting.delete(workspaceId) })
    this.connecting.set(workspaceId, attempt)
    return attempt
  }

  startSession(workspaceId?: WorkspaceId): void {
    const workspace = this.workspaces.list.getSnapshot()
    const sessions = this.sessions.list.getSnapshot()
    const current = sessions.current
    const currentWorkspaceId = current === undefined
      ? undefined
      : workspace.items.find(item => item.sessionIds.includes(current))?.workspaceId
    const recent = workspace.phase === 'ready' && sessions.phase === 'ready'
      ? recentWorkspace(workspace.items, sessions.byId)
      : undefined
    const target = workspaceId ?? currentWorkspaceId ?? recent
    if (target === undefined) {
      this.sessions.clear()
      return
    }
    void this.connectWorkspace(target).then(
      (sessionId) => { this.sessions.open(sessionId) },
      (reason: unknown) => { console.warn('new session failed:', reason) },
    )
  }

  async archiveSession(sessionId: SessionId): Promise<void> {
    await this.workspaces.archiveSession(sessionId)
  }

  async pickDirectory(): Promise<string | null> {
    const result = await this.directoryPicker.pick()
    if (!result.ok) throw new Error(`directory picker failed: ${result.error.message}`)
    return result.value
  }

  async listDirectory(path?: string, signal?: AbortSignal): Promise<DirectoryListing> {
    const result = await this.directoryPicker.list(path, signal)
    if (!result.ok) throw new DirectoryBrowseError(result.error)
    return result.value
  }

  async createDirectory(path: string, name: string): Promise<string> {
    const result = await this.directoryPicker.createDirectory(path, name)
    if (!result.ok) throw new DirectoryBrowseError(result.error)
    return result.value
  }

  whenInitialDataReady(): Promise<void> {
    if (this.initialDataReady !== undefined) return this.initialDataReady
    this.initialDataReady = new Promise((resolve) => {
      if (this.initialDataIsReady()) {
        resolve()
        return
      }
      let settled = false
      // Placeholders: both are replaced with the real disposers before anything
      // can settle this wait, so neither empty body is ever the one that runs.
      /* v8 ignore next -- replaced before this wait can settle */
      let unsubWorkspaces = (): void => {}
      /* v8 ignore next -- replaced before this wait can settle */
      let unsubSessions = (): void => {}
      const finish = (): void => {
        if (settled) return
        settled = true
        this.initialDataCheck = undefined
        unsubWorkspaces()
        unsubSessions()
        this.detachSession()
        resolve()
      }
      const check = (): void => {
        this.attachSession(this.sessions.list.getSnapshot().current, check)
        if (this.initialDataIsReady()) finish()
      }
      this.initialDataCheck = check
      unsubWorkspaces = this.workspaces.list.subscribe(check)
      unsubSessions = this.sessions.list.subscribe(check)
      this.ctx.effect(() => () => { finish() }, 'ui-workspace: initial shell data wait')
      check()
    })
    return this.initialDataReady
  }

  /** True when the first sidebar lists and selected history page can be revealed. */
  private initialDataIsReady(): boolean {
    const workspace = this.workspaces.list.getSnapshot()
    const sessions = this.sessions.list.getSnapshot()
    const workspaceArrived = workspace.phase === 'ready' || workspace.state === 'error'
    if (!workspaceArrived || sessions.phase !== 'ready') return false
    if (workspace.phase === 'ready' && this.initialNav !== 'done') return false
    const current = sessions.current
    if (current === undefined) return true
    const openState = this.sessions.binding(current)?.session.getSnapshot().openState
    return openState === 'open' || openState === 'error'
  }

  /** Follow the selected Session snapshot so a still-loading history can settle. */
  private attachSession(current: SessionId | undefined, onChange: () => void): void {
    const session = current === undefined ? undefined : this.sessions.binding(current)?.session
    if (current === this.watchedSessionId && session === this.watchedSession) return
    this.detachSession()
    this.watchedSessionId = current
    this.watchedSession = session
    if (session === undefined) return
    this.sessionUnsub = session.subscribe(onChange)
  }

  private detachSession(): void {
    this.sessionUnsub?.()
    this.sessionUnsub = undefined
    this.watchedSessionId = undefined
    this.watchedSession = undefined
  }

  private markInitialNav(next: InitialNavigation): void {
    this.initialNav = next
    this.initialDataCheck?.()
  }

  private watchNavigation(): () => void {
    let urlInitialized = false
    let disposed = false
    const reconcile = (): void => {
      if (disposed) return
      if (this.clearArchivedCurrent()) return
      const workspace = this.workspaces.list.getSnapshot()
      const sessions = this.sessions.list.getSnapshot()
      if (workspace.phase !== 'ready' || sessions.phase !== 'ready') return

      if (!urlInitialized) {
        const requested = this.sessionUrl.read()
        if (requested !== undefined && sessions.byId[requested] !== undefined) {
          urlInitialized = true
          this.markInitialNav('done')
          if (sessions.current !== requested) this.sessions.open(requested)
          return
        }
        if (requested !== undefined) this.sessionUrl.replace(undefined)
        if (sessions.current !== undefined) {
          urlInitialized = true
          this.markInitialNav('done')
          this.sessionUrl.replace(sessions.current)
          return
        }
      } else if (this.sessionUrl.read() !== sessions.current) {
        this.sessionUrl.push(sessions.current)
      }

      if (this.initialNav !== 'waiting') return
      /* v8 ignore next 4 -- guard only: every branch above that sets
       * `urlInitialized` also marks navigation done, and a done navigation
       * returns on the line before, so a selection is already settled here. */
      if (sessions.current !== undefined) {
        this.markInitialNav('done')
        return
      }
      const target = recentWorkspace(workspace.items, sessions.byId)
      if (target === undefined) {
        this.markInitialNav('done')
        urlInitialized = true
        this.sessionUrl.replace(undefined)
        return
      }
      this.markInitialNav('connecting')
      void this.connectWorkspace(target).then(
        (sessionId) => {
          if (disposed) return
          if (this.sessions.list.getSnapshot().current === undefined) {
            this.sessions.open(sessionId)
          }
          this.markInitialNav('done')
        },
        (reason: unknown) => {
          if (disposed) return
          this.markInitialNav('waiting')
          console.warn('initial workspace selection failed:', reason)
        },
      )
    }
    const navigateFromUrl = (): void => {
      if (disposed || !urlInitialized) return
      const sessions = this.sessions.list.getSnapshot()
      if (sessions.phase !== 'ready') return
      const requested = this.sessionUrl.read()
      if (requested === sessions.current) return
      if (requested === undefined) {
        this.sessions.clear()
        return
      }
      if (sessions.byId[requested] !== undefined) {
        this.sessions.open(requested)
        return
      }
      this.sessionUrl.replace(sessions.current)
    }
    const disposeWorkspaces = this.workspaces.list.subscribe(reconcile)
    const disposeSessions = this.sessions.list.subscribe(reconcile)
    const disposeUrl = this.sessionUrl.subscribe(navigateFromUrl)
    reconcile()
    return () => {
      disposed = true
      disposeUrl()
      disposeSessions()
      disposeWorkspaces()
    }
  }

  /** @returns true when an archived current selection was cleared. */
  private clearArchivedCurrent(): boolean {
    const current = this.sessions.list.getSnapshot().current
    if (current === undefined
      || !this.workspaces.list.getSnapshot().archivedSessionIds.includes(current)) return false
    this.sessions.clear()
    return true
  }

}

/** Stable tie-breaking follows Host Workspace order. */
function recentWorkspace(
  workspaces: readonly WorkspaceView[],
  sessions: SessionListState['byId'],
): WorkspaceId | undefined {
  let selected: WorkspaceId | undefined
  let selectedTime = Number.NEGATIVE_INFINITY
  for (const workspace of workspaces) {
    let latest = Number.NEGATIVE_INFINITY
    for (const sessionId of workspace.sessionIds) {
      const session = sessions[sessionId]
      if (session !== undefined) latest = Math.max(latest, session.updatedAt)
    }
    if (latest === Number.NEGATIVE_INFINITY) latest = Date.parse(workspace.createdAt)
    if (selected === undefined || latest > selectedTime) {
      selected = workspace.workspaceId
      selectedTime = latest
    }
  }
  return selected
}

export { UiWorkspaceService }
