/**
 * ui-workspace contracts. Four registrations share this package:
 *
 * - WorkspaceHeaderSearch fills the sidebar shell's `sidebar.header.leading`
 *   seat: the search control leading the shell's header row, which opens the
 *   Session search popup.
 * - WorkspaceHeaderActions fills the shell's `sidebar.header.action` seat: the
 *   view-options menu and add-workspace control at that row's trailing edge.
 * - WorkspaceBrowser fills the shell's `sidebar.workspaces` hole — the list
 *   body (grouped or flat session rows) plus the workspace dialogs. It shares
 *   the header actions' viewing store, so the view options reach it.
 * - WorkspacePicker fills the conversation empty-state hole (menu + error
 *   dialog shared with the browser).
 *
 * Each registration that offers adding also declares one **directory-flow
 * hole** (`single` kind): the slot a composed picker package's client half
 * fills with its picking interaction — a renderless native-chooser driver or
 * an in-app browsing dialog. ui-workspace owns the trigger (the "Add
 * workspace…" entry, present only while the hole is occupied) and the
 * adoption semantics (`createWorkspace({ path })`, the retryable error
 * dialog, Choose again); the occupant owns everything between `open` and the
 * picked path, including creating a new directory to hand back. That
 * occupant-owned creation is why adding a workspace has a single route: an
 * unoccupied hole leaves the surface with no add affordance at all.
 * Two holes exist because the two menu surfaces are independent slot entries
 * and a hole has exactly one declaring entry — they carry the same owner
 * contract and the same occupant.
 */
import type { HostObservable, PropsHooks, PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore } from '@aeven/client-ui-slots'
// Type-only: pull the owner SlotMap merges into programs that resolve the
// runtime shares below.
import type {} from '@aeven/client-ui-sidebar/client'
import type {} from '@aeven/client-ui-conversation/client'
import type { SessionSearchResultItem } from '@aeven/api-session-controller/client'
import type { RemoteHostFacts } from '@aeven/api-remotes/client'
import type { WorkspaceId, WorkspaceView } from '@aeven/api-workspace-controller/client'
import type { SessionId, SessionSeq } from '@aeven/session/types'
import type { SessionRenameRequest } from '../navigation.ts'
import type { createWorkspaceViewStore } from '../stores.ts'

/**
 * Owner share of the directory-flow holes: the complete conversation between
 * the trigger surface and the picking interaction. The occupant reads `open`
 * to run/render its interaction and reports exactly one outcome per open.
 */
export interface DirectoryFlowOwnerProps {
  /** True while a picking interaction is requested; flipping back to false withdraws the request. */
  open: boolean
  /** True while the owner adopts a picked path (`createWorkspace` in flight); occupants disable their commit affordances. */
  busy: boolean
  /** The operator picked a directory (absolute host path); the owner adopts it. */
  onPicked: (path: string) => void
  /** The operator dismissed the interaction; the owner just closes the flow. */
  onCancel: () => void
  /** The interaction itself failed (chooser missing, listing denied); the owner shows its error surface. */
  onError: (message: string) => void
}

declare module '@aeven/client-ui-slots' {
  interface SlotMap {
    /** Directory-flow hole under the conversation empty-state picker (declared by the WorkspacePicker entry). */
    'conversation.hero.workspace.directoryFlow': { kind: 'single'; scope: 'root'; owner: DirectoryFlowOwnerProps }
    /** Directory-flow hole under the sidebar header's add control (declared by the WorkspaceHeaderActions entry). */
    'sidebar.header.action.directoryFlow': { kind: 'single'; scope: 'root'; owner: DirectoryFlowOwnerProps }
  }
}

/** The two directory-flow holes; a flow package's client half registers its one component into both. */
export type DirectoryFlowSlotName =
  | 'conversation.hero.workspace.directoryFlow'
  | 'sidebar.header.action.directoryFlow'

/**
 * Directory-picking share both trigger surfaces consume. Occupancy rides the
 * inject face's reserved `hooks` compartment: the renderer binds the source
 * into the `useDirectoryFlow` selector hook, so an empty hole hides the
 * "Add workspace…" entry reactively and the surface withdraws an open
 * flow whose occupant unloaded mid-interaction (nobody is left to cancel).
 */
export type DirectoryPickingInjected = {
  hooks: {
    /** True while this surface's directory-flow hole is occupied. */
    directoryFlow: HostObservable<boolean>
  }
}

/** Component-side view of the picking share: the bound occupancy selector hook. */
export type DirectoryPickingHooks = PropsHooks<DirectoryPickingInjected['hooks']>

/**
 * Browser-private injected share (arrives via the register inject factory).
 * Data reads use the global framework hooks; these are the Host actions the
 * region drives.
 */
export type WorkspaceBrowserInjected = {
  hooks: {
    /**
     * Fixed Host facts, reached through a hook rather than injected as values:
     * the renderer memoizes an entry's inject result for the registration's
     * lifetime, so facts read there would freeze at whatever the first render
     * saw. Select the field the surface needs (`info => info.home`).
     */
    hostInfo: HostObservable<RemoteHostFacts>
    /** Rename requested by a surface outside this region, or null. */
    sessionRenameRequest: HostObservable<SessionRenameRequest | null>
  }
  /**
   * Start a New Session: reuse-or-create its blank Session in an explicit
   * Workspace and open it; without an explicit workspace, inherit the current
   * Session Workspace, then the recent Workspace, or clear into the New Session
   * view.
   *
   * Reuse comes first on purpose: a chat nobody has prompted yet holds whatever
   * was drafted in it, so a New Session action taken while that text is unsent
   * returns to the same chat instead of stranding the text behind a second one.
   * @param workspaceId - Workspace to start in; absent resolves by that policy.
   */
  startSession: (workspaceId?: WorkspaceId) => void
  /**
   * Address a New Session link publishes for the open the browser owns — a
   * middle click, "Open link in new window", a copied address. A plain press
   * runs `startSession` instead, so this is what those produce, not what a
   * plain press opens.
   */
  newSessionHref: () => { href: string; sessionId: SessionId }
  /** Open a real Session. */
  open: (sessionId: SessionId) => void
  /** Rename a Session (explicit user title; resolves on host acceptance). */
  renameSession: (sessionId: SessionId, title: string) => Promise<void>
  /** Clear the pending rename request once this region's dialog is open. */
  clearSessionRenameRequest: () => void
  /** Fork a Session at its last completed turn and open the child. */
  forkSession: (sessionId: SessionId) => void
  /** Rename a Host Workspace (rejects on name conflict; resolves on durability). */
  renameWorkspace: (workspaceId: WorkspaceId, title: string) => Promise<void>
  /** Delete only a Host Workspace registration; directory and Session logs remain. */
  deleteWorkspace: (workspaceId: WorkspaceId) => Promise<void>
  /** Ask for a folder of this device and give it to a Workspace that has none here. */
  bindWorkspace: (workspaceId: WorkspaceId) => void
  /**
   * Reorder a Workspace in the durable registry display order.
   * Omitted anchor appends to the end.
   */
  insertWorkspaceBefore: (workspaceId: WorkspaceId, beforeWorkspaceId?: WorkspaceId) => Promise<void>
  /**
   * Archive a Session into the registry-global set: hidden from grouping
   * surfaces, log and accounting slot retained. Archiving the current
   * session clears the selection into the New Session view state.
   */
  archiveSession: (sessionId: SessionId) => Promise<void>
  /**
   * Remove a Session from the registry-global archive set; it returns to its
   * recorded Workspace position.
   */
  unarchiveSession: (sessionId: SessionId) => Promise<void>
  /**
   * Reorder a session inside its Workspace account (DOM-insertBefore
   * semantics: omitted anchor appends to the end). The view refreshes from
   * the Host response/changed frame; failures leave the order unchanged.
   */
  insertSessionBefore: (workspaceId: WorkspaceId, sessionId: SessionId, beforeSessionId?: SessionId) => Promise<void>
}

/**
 * Full browser props: shell owner share + the shared viewing store + injected
 * actions + the locale seat.
 */
export type WorkspaceBrowserProps =
  PropsRuntime<'sidebar.workspaces'>
  & PropsStore<ReturnType<typeof createWorkspaceViewStore>>
  & Omit<WorkspaceBrowserInjected, 'hooks'>
  & PropsHooks<WorkspaceBrowserInjected['hooks']>
  & PropsLocale<'workspace'>

/**
 * Search-control injected share (arrives via the register inject factory):
 * the Host search the popup runs and the Session it opens.
 */
export type WorkspaceHeaderSearchInjected = {
  /** Open a real Session, optionally revealing an exact matched event. */
  open: (sessionId: SessionId, matchSeq?: SessionSeq) => void
  /**
   * Search current visible conversation messages. The Host fixes the result
   * bound; `hasMore` means the query needs narrowing.
   */
  searchSessions: (
    query: string,
    signal: AbortSignal,
  ) => Promise<{ items: readonly SessionSearchResultItem[]; hasMore: boolean }>
  /** Maximum number of rows the popup renders, for recent Sessions and for one search. */
  searchResultLimit: number
}

/**
 * Full search-control props: the shell's empty owner share + injected search
 * actions + the locale seat. The popup reads Sessions and Workspaces through
 * the global hooks the owner share carries.
 */
export type WorkspaceHeaderSearchProps =
  PropsRuntime<'sidebar.header.leading'>
  & WorkspaceHeaderSearchInjected
  & PropsLocale<'workspace'>

/**
 * Header-controls injected share (arrives via the register inject factory):
 * the two Host actions the cluster drives plus this surface's picking
 * occupancy.
 */
export type WorkspaceHeaderActionsInjected = DirectoryPickingInjected & {
  /**
   * Start a New Session in a Workspace: reuse-or-create its blank session and
   * open it.
   */
  startSession: (workspaceId?: WorkspaceId) => void
  /** Adopt a picked host directory as a real Workspace before targeting a Session. */
  createWorkspace: (input: { path: string }) => Promise<WorkspaceView>
}

/**
 * Full header slot props: the shell's empty owner share + the shared viewing
 * store + injected actions + the locale seat.
 */
export type WorkspaceHeaderActionsProps =
  PropsRuntime<'sidebar.header.action'>
  & PropsRenderSlots<'sidebar.header.action.directoryFlow'>
  & PropsStore<ReturnType<typeof createWorkspaceViewStore>>
  & Omit<WorkspaceHeaderActionsInjected, 'hooks'>
  & PropsHooks<WorkspaceHeaderActionsInjected['hooks']>
  & PropsLocale<'workspace'>

/**
 * Picker-private injected share. Pick semantics remain in the owner's onPick
 * callback; this callback creates only the real Host Workspace. A type alias
 * supplies the implicit index signature required by the registry.
 */
export type WorkspacePickerInjected = DirectoryPickingInjected & {
  /** Adopt a picked host directory as a real Workspace before targeting a Session. */
  createWorkspace: (input: { path: string }) => Promise<WorkspaceView>
}

/**
 * Full picker props: the owner share plus the creation callback and the
 * locale seat. The two picker holes (blank-session hero / New-Session view)
 * share one owner currency, so one composed type serves both registrations.
 */
export type WorkspacePickerProps =
  PropsRuntime<'conversation.hero.workspace'>
  & PropsRenderSlots<'conversation.hero.workspace.directoryFlow'>
  & Omit<WorkspacePickerInjected, 'hooks'>
  & DirectoryPickingHooks
  & PropsLocale<'workspace'>
