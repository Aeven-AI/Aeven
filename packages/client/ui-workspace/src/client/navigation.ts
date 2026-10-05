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
import { randomUUID } from '@aeven/util-crypto'
import { sessionPathOf, type SessionUrlNavigation } from './session-url.ts'

type InitialNavigation = 'waiting' | 'connecting' | 'done'

/** Workspace archive and directory operations consumed by Client UI domains. */
export interface UiWorkspace {
  /**
   * Resolve the reusable or newly created blank Session for a Workspace.
   *
   * Reusable means a chat nobody has prompted yet that the Workspace accounts
   * for and that sits in its directory; a Workspace with no directory of its
   * own takes the account alone. Reuse is what returns unsent composer text.
   * @param workspaceId - target Workspace.
   * @param sessionId - preallocated id to create under; when present the
   * Workspace's reusable blank is skipped, because the caller already
   * published that id as the address it is about to open.
   * @returns a Session already addressable through the Session Controller.
   */
  connectWorkspace(workspaceId: WorkspaceId, sessionId?: SessionId): Promise<SessionId>
  /**
   * Start a New Session flow and navigate to its Session.
   * @param workspaceId - explicit target; absent inherits the current or most recent Workspace, and
   * without any Workspace the chat is created outside one.
   * @param sessionId - the id the New Session link named. The Host creates the
   * Session under exactly this id, so the address that was opened and the
   * Session that appears are the same chat.
   */
  startSession(workspaceId?: WorkspaceId, sessionId?: SessionId): void
  /**
   * Address for a New Session that does not exist yet, with the id it names.
   *
   * A link's target has to be known before there is a Session to name, because
   * the browser — not this client — owns activation. The id is minted here,
   * under the Host's `session-<uuid>` scheme, and the caller hands it back to
   * {@link startSession}. Every call mints a fresh id, which is what re-arms
   * the link once a chat has been started from it.
   * @returns the absolute `/c/<uuid>` path, and the Session id it addresses.
   */
  newSessionHref(): { href: string; sessionId: SessionId }
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
  private readonly connecting = new Map<WorkspaceId | SessionId, Promise<SessionId>>()
  /** The archived current Session a new chat is being opened in place of, so the reconciler starts one only. */
  private replacingArchived: SessionId | undefined
  /** The orphaned current Session a new chat is being opened in place of, so the reconciler starts one only. */
  private replacingOrphan: SessionId | undefined
  /** Sessions this client created, until the lists catch up with them; they are arriving, not orphaned. */
  private readonly created = new Set<SessionId>()
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

  /**
   * Resolve which Workspace a New Session belongs to.
   *
   * One policy for both the link's target and the click that creates it: an
   * explicit Workspace wins, then the current Session's, then the most
   * recently touched. They must agree, or the address a reader opened would
   * name a chat in a different Workspace than the one where it is created.
   * @param workspaceId - explicit target, when the caller has one.
   * @returns the Workspace id, or undefined when nothing can host a chat yet.
   */
  private targetWorkspace(workspaceId?: WorkspaceId): WorkspaceId | undefined {
    const workspace = this.workspaces.list.getSnapshot()
    const sessions = this.sessions.list.getSnapshot()
    const current = sessions.current
    const currentWorkspaceId = current === undefined
      ? undefined
      : workspace.items.find(item => item.sessionIds.includes(current))?.workspaceId
    const recent = workspace.phase === 'ready' && sessions.phase === 'ready'
      ? recentWorkspace(workspace.items, sessions.byId)
      : undefined
    return workspaceId ?? currentWorkspaceId ?? recent
  }

  async connectWorkspace(workspaceId: WorkspaceId, sessionId?: SessionId): Promise<SessionId> {
    const workspace = this.workspaces.list.getSnapshot().items
      .find(item => item.workspaceId === workspaceId)
    if (workspace === undefined) {
      throw new Error(`uiWorkspace.connectWorkspace: unknown workspace ${workspaceId}`)
    }
    // A named id IS the identity, so the in-flight map keys on it. The
    // workspace key would collide two different chats in one Workspace and
    // hand the second caller the first one's Session.
    const key = sessionId ?? workspaceId
    const inflight = this.connecting.get(key)
    if (inflight !== undefined) return inflight

    if (sessionId === undefined) {
      const archived = this.workspaces.list.getSnapshot().archivedSessionIds
      const sessions = this.sessions.list.getSnapshot()
      for (const id of sessions.ids) {
        const summary = sessions.byId[id]
        // A Workspace with no directory of its own — the built-in Chats, or a
        // remote one — has no cwd for its chats to match, which is why the
        // account alone decides there. A folder Workspace needs both, so a chat
        // that only shares the directory it was started in is not adopted.
        const inWorkspaceDirectory = workspace.path === null || summary?.cwd === workspace.path
        if (summary !== undefined && summary.blank && inWorkspaceDirectory
          && workspace.sessionIds.includes(summary.id)
          && !archived.includes(summary.id)) return summary.id
      }
    }

    const attempt = this.sessions.create({ workspaceId, ...(sessionId === undefined ? {} : { sessionId }) })
      .then((id) => { this.created.add(id); return id })
      .finally(() => { this.connecting.delete(key) })
    this.connecting.set(key, attempt)
    return attempt
  }

  startSession(workspaceId?: WorkspaceId, sessionId?: SessionId): void {
    const target = this.targetWorkspace(workspaceId)
    // Without a Workspace to put it in, the chat is created without one:
    // clearing the selection instead would leave a page with no composer.
    const opening = target === undefined
      ? this.createChat(sessionId)
      : this.connectWorkspace(target, sessionId).catch((reason: unknown) => {
        // The target can vanish between choosing it and creating in it: deleting a Workspace archives its
        // Sessions first, and the archived current Session is replaced in the Workspace being deleted. A New
        // Session then lands in the built-in Workspace instead of leaving the selection without one.
        const fallback = this.defaultWorkspaceId()
        if (fallback === undefined || fallback === target) throw reason
        return this.connectWorkspace(fallback, sessionId)
      })
    void opening.then(
      (opened) => { this.sessions.open(opened) },
      (reason: unknown) => { console.warn('new session failed:', reason) },
    )
  }

  /** The built-in Workspace every reader has, when the Host seeds one. */
  private defaultWorkspaceId(): WorkspaceId | undefined {
    return this.workspaces.list.getSnapshot().items.find(item => item.isDefault)?.workspaceId
  }

  /**
   * Create a chat that belongs to no Workspace, sharing one in-flight creation.
   * @param sessionId - the id to create under, when a link already names one.
   * @returns the created Session id.
   */
  private createChat(sessionId?: SessionId): Promise<SessionId> {
    const key = sessionId ?? ('' as SessionId)
    const inflight = this.connecting.get(key)
    if (inflight !== undefined) return inflight
    const attempt = this.sessions.create(sessionId === undefined ? {} : { sessionId })
      .then((id) => { this.created.add(id); return id })
      .finally(() => { this.connecting.delete(key) })
    this.connecting.set(key, attempt)
    return attempt
  }

  newSessionHref(): { href: string; sessionId: SessionId } {
    // Deliberately not remembered: a link nobody activates must not reserve an
    // id, so every call names a chat that can still be created.
    const sessionId = `session-${randomUUID()}` as SessionId
    return { href: sessionPathOf(sessionId), sessionId }
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
      if (this.replaceOrphanedCurrent()) return

      if (!urlInitialized) {
        const requested = this.sessionUrl.read()
        if (requested !== undefined && workspace.archivedSessionIds.includes(requested)) {
          // An archived chat is not reopened from its address: the current selection, or the New Session the
          // archive already started in its place, keeps the page and takes over the address.
          urlInitialized = true
          if (sessions.current !== undefined && sessions.current !== requested) {
            this.markInitialNav('done')
            this.sessionUrl.replace(sessions.current)
          }
          return
        }
        if (requested !== undefined && sessions.byId[requested] !== undefined) {
          urlInitialized = true
          this.markInitialNav('done')
          if (sessions.current !== requested) this.sessions.open(requested)
          return
        }
        if (requested !== undefined && this.adoptRequestedSession(requested, () => { urlInitialized = true })) return
        if (requested !== undefined) {
          // The address named nothing this client can open. Dropping it settles
          // this pass: the blank-view fallback below would otherwise rewrite the
          // very same entry a second time before the pass ended.
          this.sessionUrl.replace(undefined)
          urlInitialized = true
          return
        }
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
      // No Workspace yet: open a chat outside one rather than an empty page.
      if (target === undefined) urlInitialized = true
      this.markInitialNav('connecting')
      void (target === undefined ? this.createChat() : this.connectWorkspace(target)).then(
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
      // Another surface's address selects no chat: Back into Imagine must
      // not start a New Session.
      if (disposed || !urlInitialized || !this.sessionUrl.ownsAddress()) return
      const sessions = this.sessions.list.getSnapshot()
      if (sessions.phase !== 'ready') return
      const requested = this.sessionUrl.read()
      if (requested === sessions.current) return
      // An address naming no chat opens one, as the New Session action does;
      // an empty selection has no composer to continue from.
      if (requested === undefined) {
        this.startSession()
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

  /**
   * Create the Session an address already names.
   *
   * The New Session link publishes its `/c/<uuid>` address before the chat
   * exists, because the browser — not this client — decides when a link opens.
   * Following that link in a new window therefore lands on an id no Session has
   * yet, and this is where the promise is kept: the address that named the chat
   * is the id the Host is asked to create, so a fresh window yields the same
   * chat the link offered rather than an arbitrary recent one.
   * @param requested - the Session id the address names.
   * @param claim - marks the address as initialised. Called synchronously, so a
   * reconcile triggered by the creation itself cannot adopt it a second time.
   * @returns true when the address was claimed, so the caller keeps the URL.
   */
  private adoptRequestedSession(requested: SessionId, claim: () => void): boolean {
    const workspace = this.targetWorkspace()
    if (workspace === undefined) return false
    claim()
    this.markInitialNav('connecting')
    void this.connectWorkspace(workspace, requested).then(
      (opened) => {
        this.sessions.open(opened)
        this.markInitialNav('done')
      },
      (reason: unknown) => {
        // The id could not be claimed, so it is not an address this client can
        // honour; drop it rather than presenting a browser URL naming nothing.
        this.markInitialNav('waiting')
        console.warn('address-named session failed:', reason)
      },
    )
    return true
  }

  /**
   * Replace an unused current Session that no Workspace owns, such as the blank chat of a Workspace that was
   * just deleted, with a blank chat in the built-in Workspace. A New Session always has a Workspace; without
   * one the composer has nothing to send into. A Session with history keeps its selection.
   * @returns true while the current selection is such an orphan.
   */
  private replaceOrphanedCurrent(): boolean {
    const workspace = this.workspaces.list.getSnapshot()
    const sessions = this.sessions.list.getSnapshot()
    const current = sessions.current
    if (current === undefined || workspace.items.some(item => item.sessionIds.includes(current))) {
      if (current !== undefined) this.created.delete(current)
      this.replacingOrphan = undefined
      return false
    }
    const summary = sessions.byId[current]
    const snapshot = this.sessions.binding(current)?.session.getSnapshot()
    if ((summary?.blank ?? snapshot?.blank) !== true || snapshot?.promptAttempted === true) return false
    // A Session this client just created, or one whose directory a Workspace still registers, is joining
    // that Workspace; its membership arrives with a later list.
    if (summary === undefined && this.created.has(current)) return false
    if (summary !== undefined && workspace.items.some(item => item.path === (summary.cwd ?? null))) return false
    if (this.replacingOrphan !== current) {
      this.replacingOrphan = current
      this.startSession(this.defaultWorkspaceId())
    }
    return true
  }

  /**
   * Replace an archived current selection with a new chat, as the New Session
   * action does: an empty selection has no composer to continue from.
   * @returns true while the current selection is archived.
   */
  private clearArchivedCurrent(): boolean {
    const current = this.sessions.list.getSnapshot().current
    if (current === undefined
      || !this.workspaces.list.getSnapshot().archivedSessionIds.includes(current)) {
      // The selection moved on; an archived Session selected again is replaced again.
      this.replacingArchived = undefined
      return false
    }
    if (this.replacingArchived !== current) {
      this.replacingArchived = current
      this.startSession()
    }
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
