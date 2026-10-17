/**
 * The workspace browser's viewing store: the session-list grouping, ordering,
 * section visibility and expansion state, persisted across reloads. Module level exports
 * the factory only (a module-level handle would pin the store identity across
 * plugin reloads); register() receives the handle and each component derives
 * its PropsStore share from the return type.
 */
import { defineStore, type EngineStoreHandle } from '@aeven/client-store'

/**
 * Session-list grouping mode: workspace sections, or the three status buckets
 * (Needs input, Working, Completed work) a Session moves between as its live
 * state changes.
 */
export type SessionGroupBy = 'workspace' | 'status'
/** Session order: user-arranged only, or user-arranged plus activity promotion. */
export type SessionOrderBy = 'manual' | 'updated'

/** Workspace browser viewing state persisted across surface remounts and reloads. */
type WorkspaceViewState = {
  groupBy: SessionGroupBy
  orderBy: SessionOrderBy
  /** Show managed Workspace groups such as Automations and their Sessions. */
  showAutomations: boolean
  /** Show the trailing Archived section listing every archived Session. */
  showArchived: boolean
  /**
   * Explicit zero-or-five-session state keyed by group identity: a Workspace id,
   * Ungrouped, Archived, or a status bucket. A status bucket reads as open until
   * the reader folds it, so status grouping opens on its rows.
   */
  groupExpansion: Record<string, boolean>
  /** Shared editable order per Workspace group. */
  sessionOrderByAccount: Record<string, string[]>
  /** Last observed update timestamps per order account for one-time promotion events. */
  sessionUpdatedAtByAccount: Record<string, Record<string, number>>
}

/**
 * Annotation twin of the actions literal below (the export needs a declared
 * return type); drift fails assignability at the defineStore call.
 */
type WorkspaceViewActions = {
  setGroupBy: (draft: WorkspaceViewState, mode: SessionGroupBy) => void
  setOrderBy: (draft: WorkspaceViewState, mode: SessionOrderBy) => void
  setShowAutomations: (draft: WorkspaceViewState, show: boolean) => void
  setShowArchived: (draft: WorkspaceViewState, show: boolean) => void
  setGroupExpanded: (draft: WorkspaceViewState, key: string, expanded: boolean) => void
  retainAccountKeys: (draft: WorkspaceViewState, workspaceKeys: readonly string[]) => void
  syncSessionOrderAccount: (
    draft: WorkspaceViewState,
    accountKey: string,
    order: string[],
    updatedAt: Record<string, number>,
  ) => void
  setSessionOrder: (draft: WorkspaceViewState, accountKey: string, order: string[]) => void
}

/**
 * Create the workspace browser viewing store handle.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createWorkspaceViewStore(): EngineStoreHandle<WorkspaceViewState, WorkspaceViewActions> {
  return defineStore({
    init: (): WorkspaceViewState => ({
      groupBy: 'workspace',
      orderBy: 'updated',
      showAutomations: true,
      showArchived: false,
      groupExpansion: {},
      sessionOrderByAccount: {},
      sessionUpdatedAtByAccount: {},
    }),
    persist: {
      key: 'avn.workspace.view.v6',
      fields: [
        'groupBy', 'orderBy', 'showAutomations', 'showArchived', 'groupExpansion', 'sessionOrderByAccount', 'sessionUpdatedAtByAccount',
      ],
    },
    actions: {
      setGroupBy: (d, mode: SessionGroupBy) => { d.groupBy = mode },
      setOrderBy: (d, mode: SessionOrderBy) => { d.orderBy = mode },
      setShowAutomations: (d, show: boolean) => { d.showAutomations = show },
      setShowArchived: (d, show: boolean) => { d.showArchived = show },
      setGroupExpanded: (d, key: string, expanded: boolean) => { d.groupExpansion[key] = expanded },
      retainAccountKeys: (d, workspaceKeys: readonly string[]) => {
        const retained = new Set(workspaceKeys)
        d.groupExpansion = Object.fromEntries(
          Object.entries(d.groupExpansion).filter(([key]) => retained.has(key)),
        )
        d.sessionOrderByAccount = Object.fromEntries(
          Object.entries(d.sessionOrderByAccount).filter(([key]) => retained.has(key)),
        )
        d.sessionUpdatedAtByAccount = Object.fromEntries(
          Object.entries(d.sessionUpdatedAtByAccount).filter(([key]) => retained.has(key)),
        )
      },
      syncSessionOrderAccount: (d, accountKey: string, order: string[], updatedAt: Record<string, number>) => {
        d.sessionOrderByAccount[accountKey] = order
        d.sessionUpdatedAtByAccount[accountKey] = updatedAt
      },
      setSessionOrder: (d, accountKey: string, order: string[]) => {
        d.sessionOrderByAccount[accountKey] = order
      },
    },
  })
}
