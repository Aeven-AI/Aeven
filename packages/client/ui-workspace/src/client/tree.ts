/**
 * Derives the workspace browser tree from Host Workspace order and membership.
 * Unassigned Sessions trail under Ungrouped; only the selected blank Session
 * remains visible.
 */
import {
  type SessionListState, type SessionSearchResultItem, type SessionSummary,
} from '@aeven/api-session-controller/client'
import type { WorkspaceId, WorkspaceView } from '@aeven/api-workspace-controller/client'
import type {
  SessionPendingInteractionBase,
} from '@aeven/client-ui-session/client'
import type {} from '@aeven/schedule/client'
import type { SessionId, SessionSeq } from '@aeven/session/types'
import { workspaceTitleOf } from '@aeven/util-workspace-path'
import {
  indexSubagentDescendants, type SubagentDescendantSummary,
} from './subagent-lineage.ts'

/** Group key for Sessions outside every Workspace. */
export const UNGROUPED_KEY = ''

/** Group key of the trailing Archived section; never a Workspace id. */
export const ARCHIVED_KEY = '__archived__'

/**
 * Resolve the Workspace browser group that owns one Session.
 * @param workspaces - authoritative Workspace membership.
 * @param sessionId - Session whose browser group is required.
 * @returns owning Workspace id, or {@link UNGROUPED_KEY} when no Workspace accounts for it.
 */
export function owningGroupKey(
  workspaces: readonly WorkspaceView[],
  sessionId: SessionId,
): string {
  return (workspaces.find(workspace => workspace.sessionIds.includes(sessionId))
    ?.workspaceId as string | undefined) ?? UNGROUPED_KEY
}

/** Pending interaction kinds with dedicated Workspace-row presentation. */
export type SessionPendingInteractionStatus = 'approval' | 'plan-review' | 'question'
type SessionPendingInteractions = ReadonlyMap<SessionId, SessionPendingInteractionBase>

/** One top-level session row in a group or the flat list. */
export interface SessionNode {
  id: SessionId
  /** Stored display title; the renderer substitutes the localized New Session label for a Session with no durable title. */
  title: string
  /** The provisional blank session (renderer shows the localized New Session title). */
  blank: boolean
  /**
   * The Session has no durable title, so `title` is only the identity fallback
   * the list resolves. The renderer keeps the New Session label on these rows:
   * the fallback is the Session id, and a row named after its own id is worse
   * than one that says no title has arrived.
   */
  untitled: boolean
  /** A Session-scoped UI consumer is awaiting this user. */
  pendingInteraction?: SessionPendingInteractionStatus
  running: boolean
  /** Running descendants connected through uninterrupted subagent-origin lineage. */
  runningSubagentCount: number
  /**
   * Background jobs this Session owns that are still live. A Session whose
   * Agent is idle between turns but whose job keeps working is still working,
   * so its row keeps the in-flight mark instead of reading as finished.
   */
  runningJobCount: number
  /** Finished running while not selected and not yet opened (the green "done" reminder dot). */
  completed: boolean
  /** The current list projection contains at least one active Schedule record. */
  hasActiveSchedule: boolean
  /** Session header creation time, epoch ms (the row tooltip's created distance). */
  createdAt: number
  updatedAt: number
}

/** Session order selected by the Workspace browser. */
export type SessionOrderBy = 'manual' | 'updated'

/** One workspace group section: header row facts + visible top-level session rows. */
export interface GroupNode {
  /** Group key: the workspace id or {@link UNGROUPED_KEY}. */
  key: string
  /** Backing Workspace id; absent only for the ungrouped bucket. */
  workspaceId: WorkspaceId | undefined
  /**
   * Whether the backing Workspace is built-in (Chats, or a plugin-declared one
   * such as Automations). Such a row is part of the product rather than a
   * registration the reader owns, so the renderer offers it no actions and no
   * drag — there are none to offer, and the registry refuses every one of them.
   */
  isBuiltIn: boolean
  /**
   * Whether the backing Workspace is a plugin-declared built-in one, such as
   * Automations: its plugin creates every Session in it, so the renderer offers
   * no New Session control there.
   */
  managed: boolean
  cwd: string | undefined
  /** Workspace creation time (epoch ms); absent only for the ungrouped bucket. */
  createdAt: number | undefined
  label: string
  /** Total visible sessions in the group. */
  sessionCount: number
  expanded: boolean
  /** The group contains the selected session (active folder tint; supplied here so the renderer never scans). */
  containsCurrent: boolean
  /** Visible session rows (empty while the group is folded). */
  sessions: readonly SessionNode[]
}

/** One flat search row combining list metadata with an optional content match. */
export interface SearchResultNode {
  id: SessionId
  /** Exact matched message event, when this row came from content search. */
  matchSeq?: SessionSeq
  /** Stored display title; the renderer substitutes the localized New Session label for a Session with no durable title. */
  title: string
  /**
   * The Session has no durable title, so `title` is only the identity fallback
   * the list resolves. Blank Sessions never reach search, so this is the same
   * fact {@link SessionNode.untitled} carries.
   */
  untitled: boolean
  workspace: string
  /** A Session-scoped UI consumer is awaiting this user. */
  pendingInteraction?: SessionPendingInteractionStatus
  running: boolean
  /** Running descendants connected through uninterrupted subagent-origin lineage. */
  runningSubagentCount: number
  /** Live background jobs of this Session; see {@link SessionNode.runningJobCount}. */
  runningJobCount: number
  /** Finished running while not selected and not yet opened (the green "done" reminder dot). */
  completed: boolean
  /** The current list projection contains at least one active Schedule record. */
  hasActiveSchedule: boolean
  snippet?: string
}

/** Bounded merged search projection plus the refine-query hint bit. */
export interface SearchResultSet {
  items: readonly SearchResultNode[]
  hasMore: boolean
}

/** Viewing state consumed by the derivation. */
export interface TreeView {
  expandedGroups: readonly string[]
  /** Browser-local order for Sessions without a backing Workspace account. */
  ungroupedOrder?: readonly string[]
  /** Leave out managed Workspace groups such as Automations; their Sessions stay accounted, not Ungrouped. */
  hideManaged?: boolean
}

interface Group {
  key: string
  workspaceId: WorkspaceId | undefined
  isBuiltIn: boolean
  managed: boolean
  cwd: string | undefined
  createdAt: number | undefined
  label: string
  sessions: SessionSummary[]
}

/**
 * Whether a Workspace is a plugin-declared built-in one, whose plugin creates
 * every Session in it; New Sessions never start there.
 * @param workspace - Workspace projection.
 * @returns true for a built-in Workspace other than the default one.
 */
export function isManagedWorkspace(workspace: WorkspaceView): boolean {
  return workspace.isBuiltIn && !workspace.isDefault
}

/**
 * Sessions accounted by managed Workspaces, which the Show automations view
 * option hides from every list.
 * @param workspaces - Workspace membership.
 * @returns the Session ids those Workspaces account for.
 */
export function managedSessionIds(workspaces: readonly WorkspaceView[]): ReadonlySet<SessionId> {
  return new Set(workspaces.filter(isManagedWorkspace).flatMap(workspace => workspace.sessionIds))
}

/**
 * Directory display label: basename of the path (both separators accepted).
 * Ungrouped-bucket fallback for surfaces without a workspace title.
 * @param cwd - directory path, or undefined for the ungrouped bucket.
 * @returns basename, the raw cwd when it has no basename, or an empty ungrouped marker.
 */
export function workspaceLabel(cwd: string | undefined): string {
  if (cwd === undefined || cwd === '') return ''
  const base = workspaceTitleOf(cwd)
  return base !== '' ? base : cwd
}

/** Recency comparator: newest first, id as the deterministic tiebreak (ids are unique per group). */
function byRecency(a: SessionSummary, b: SessionSummary): number {
  if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt
  return a.id < b.id ? -1 : 1
}

/**
 * A group's last update: the newest `updatedAt` among the sessions the list
 * accounts to it, falling back to the Workspace record's own last-mutation
 * instant. A Workspace with nothing in it therefore ranks by when it was
 * created or last touched, which is the figure that puts one just added
 * directly below the built-in workspace.
 */
function groupRecency(workspace: WorkspaceView, byId: SessionListState['byId']): number {
  let newest: number | undefined
  for (const id of workspace.sessionIds) {
    const updatedAt = byId[id]?.updatedAt
    if (updatedAt === undefined || (newest !== undefined && updatedAt <= newest)) continue
    newest = updatedAt
  }
  return newest ?? Date.parse(workspace.updatedAt)
}

/**
 * Order the workspace groups: the built-in Workspace first, then the rest by
 * last update, newest first.
 *
 * The built-in Workspace holds the head whatever the durable registry order
 * says (the registry pins it there); every other group ranks by activity, so
 * the Workspace being worked in sits directly under it. Ties keep the incoming
 * order, which is the durable registry order — the arrangement a reader made by
 * dragging, and the one that shows while the order mode is manual.
 * @param workspaces - Workspaces in durable order, with their session order already applied.
 * @param list - sessions list snapshot supplying each group's last update.
 * @returns Workspaces in render order.
 */
export function orderGroupsByRecency(
  workspaces: readonly WorkspaceView[],
  list: SessionListState,
): WorkspaceView[] {
  return workspaces
    .map((workspace, index) => ({ workspace, index, recency: groupRecency(workspace, list.byId) }))
    .sort((left, right) =>
      Number(right.workspace.isDefault) - Number(left.workspace.isDefault)
      || Number(right.workspace.isBuiltIn) - Number(left.workspace.isBuiltIn)
      || right.recency - left.recency
      || left.index - right.index)
    .map(entry => entry.workspace)
}

/**
 * Ordinary sessions are visible; among blank sessions, only the current one
 * is visible. Subagent children use their parent header catalog; archived
 * sessions are visible nowhere, while their accounting slots remain so
 * unarchiving restores position.
 */
function sessionVisible(session: SessionSummary, current: SessionId | undefined, archived: ReadonlySet<SessionId>): boolean {
  return session.origin !== 'subagent'
    && !archived.has(session.id)
    && (!session.blank || session.id === current)
}

/**
 * A blank session is the selected Workspace's provisional New Session row;
 * its canonical title never enters search (blank rows are query-excluded)
 * and the renderer localizes its display label.
 */
function sessionTitle(session: SessionSummary): string {
  return session.blank ? '' : session.displayTitle
}

/** The list projection alone owns the best-effort active-Schedule indicator. */
function hasActiveSchedule(session: SessionSummary): boolean {
  return (session.projectionValues?.schedule?.length ?? 0) > 0
}

/**
 * Count each Session's live background jobs. A job outlives the turn that
 * started it, so a Session whose Agent is idle between turns is still working
 * while one runs, and its row must not read as finished.
 * @param jobsBySession - the list's per-Session job rows.
 * @returns live-job counts by owning Session; an absent key means none.
 */
function indexRunningJobs(
  jobsBySession: SessionListState['jobsBySession'],
): ReadonlyMap<SessionId, number> {
  const counts = new Map<SessionId, number>()
  for (const [sessionId, jobs] of Object.entries(jobsBySession)) {
    const live = jobs.filter(job => job.status === 'running' || job.status === 'stopping').length
    if (live > 0) counts.set(sessionId as SessionId, live)
  }
  return counts
}

/** Build one group without projecting session lineage into presentation. */
function buildGroup(
  key: string,
  workspaceId: WorkspaceId | undefined,
  isBuiltIn: boolean,
  managed: boolean,
  cwd: string | undefined,
  createdAt: number | undefined,
  label: string,
  members: readonly SessionSummary[],
  order: 'account' | 'recency',
): Group {
  const sessions = [...members]
  // Real Workspace order comes from sessionIds. Ungrouped falls back to
  // recency until the browser supplies its persisted local order.
  if (order === 'recency') sessions.sort(byRecency)
  return { key, workspaceId, isBuiltIn, managed, cwd, createdAt, label, sessions }
}

/** Apply a stored Ungrouped order and append newly loose Sessions by recency. */
function orderedUngrouped(members: readonly SessionSummary[], stored: readonly string[]): SessionSummary[] {
  const byId = new Map(members.map(session => [session.id as string, session]))
  const included = new Set<string>()
  const ordered: SessionSummary[] = []
  for (const key of stored) {
    const session = byId.get(key)
    if (session === undefined || included.has(key)) continue
    ordered.push(session)
    included.add(key)
  }
  for (const session of [...members].sort(byRecency)) {
    if (included.has(session.id)) continue
    ordered.push(session)
  }
  return ordered
}

/**
 * Group Sessions by Host Workspace: one group per entity in stable Host
 * order, with members resolved from sessionIds in their stored order. Sessions
 * outside every Workspace trail in the browser-local Ungrouped order, which
 * falls back to recency before that order is initialized.
 */
function groupByWorkspace(
  list: SessionListState,
  workspaces: readonly WorkspaceView[],
  archived: ReadonlySet<SessionId>,
  ungroupedOrder: readonly string[] | undefined,
  hideManaged: boolean,
): Group[] {
  const groups: Group[] = []
  const accounted = new Set<SessionId>()
  for (const workspace of workspaces) {
    const members: SessionSummary[] = []
    for (const id of workspace.sessionIds) {
      const summary = list.byId[id]
      if (summary === undefined) continue // account may lead the list pull; the row appears when the summary lands
      accounted.add(id)
      if (!sessionVisible(summary, list.current, archived)) continue
      members.push(summary)
    }
    // A managed Workspace exists to hold its plugin's Sessions, so it shows only while it holds a visible one.
    if (isManagedWorkspace(workspace) && (hideManaged || members.length === 0)) continue
    groups.push(buildGroup(
      // The wire carries "no directory" as JSON `null`; the grouping vocabulary
      // speaks `undefined`, so absence is translated once, here.
      workspace.workspaceId, workspace.workspaceId, workspace.isBuiltIn, isManagedWorkspace(workspace), workspace.path ?? undefined,
      Date.parse(workspace.createdAt), workspace.title, members, 'account',
    ))
  }
  const stray = list.ids
    .map(id => list.byId[id])
    .filter((s): s is SessionSummary =>
      s !== undefined && !accounted.has(s.id) && sessionVisible(s, list.current, archived))
  if (stray.length > 0) {
    groups.push(buildGroup(
      UNGROUPED_KEY,
      undefined,
      // The ungrouped bucket has no backing Workspace at all, so it is never
      // the built-in one; it already renders without row actions.
      false,
      false,
      undefined,
      undefined,
      '',
      ungroupedOrder === undefined ? stray : orderedUngrouped(stray, ungroupedOrder),
      ungroupedOrder === undefined ? 'recency' : 'account',
    ))
  }
  return groups
}

/** Keep navigation presentation independent from domain-owned interaction objects. */
function visiblePendingKind(kind: string | undefined): SessionPendingInteractionStatus | undefined {
  switch (kind) {
    case 'approval':
    case 'plan-review':
    case 'question':
      return kind
    default:
      return undefined
  }
}

function sessionNode(
  s: SessionSummary,
  descendants: ReadonlyMap<SessionId, SubagentDescendantSummary>,
  runningJobs: ReadonlyMap<SessionId, number>,
  pendingInteractions: SessionPendingInteractions,
): SessionNode {
  const pendingInteraction = visiblePendingKind(pendingInteractions.get(s.id)?.kind)
  return {
    id: s.id,
    title: sessionTitle(s),
    blank: s.blank,
    untitled: !s.blank && s.title === undefined,
    running: s.running,
    runningSubagentCount: descendants.get(s.id)?.runningCount ?? 0,
    runningJobCount: runningJobs.get(s.id) ?? 0,
    completed: s.completed === true,
    hasActiveSchedule: hasActiveSchedule(s),
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    ...(pendingInteraction === undefined ? {} : { pendingInteraction }),
  }
}

/**
 * Derive the workspace browser groups with every session as a top-level row.
 *
 * Every group shows; sessions populate under expanded groups in the selected
 * local order. Blank sessions are excluded except for the selected
 * provisional New Session row; archived sessions are excluded everywhere.
 * Content search lives outside this derivation
 * (see {@link deriveSearchResults}).
 * @param list - sessions list snapshot (`current` feeds containsCurrent).
 * @param workspaces - real workspaces in stable Host order.
 * @param archivedSessionIds - registry-global archive set.
 * @param pendingInteractions - pending UI interactions by Session.
 * @param view - local expansion arrays.
 * @returns group sections in render order.
 */
export function deriveGroups(
  list: SessionListState,
  workspaces: readonly WorkspaceView[],
  archivedSessionIds: readonly SessionId[],
  pendingInteractions: SessionPendingInteractions,
  view: TreeView,
): GroupNode[] {
  const archived = new Set(archivedSessionIds)
  const expandedGroups = new Set(view.expandedGroups)
  const descendants = indexSubagentDescendants(list.byId)
  const runningJobs = indexRunningJobs(list.jobsBySession)
  const currentGroup = list.current === undefined
    ? undefined
    : owningGroupKey(workspaces, list.current)
  const groups: GroupNode[] = []
  for (const g of groupByWorkspace(list, workspaces, archived, view.ungroupedOrder, view.hideManaged === true)) {
    const expanded = expandedGroups.has(g.key)
    groups.push({
      key: g.key,
      workspaceId: g.workspaceId,
      isBuiltIn: g.isBuiltIn,
      managed: g.managed,
      cwd: g.cwd,
      createdAt: g.createdAt,
      label: g.label,
      sessionCount: g.sessions.length,
      expanded,
      containsCurrent: g.key === currentGroup,
      sessions: expanded
        ? g.sessions.map(session => sessionNode(session, descendants, runningJobs, pendingInteractions))
        : [],
    })
  }
  return groups
}

/**
 * Derive the flat session list ("In one list" mode): every session — fork
 * children included — as a top-level row, strictly newest-first. No grouping,
 * no parent/child adjacency. Content search lives outside this derivation
 * (see {@link deriveSearchResults}).
 * @param list - sessions list snapshot.
 * @param archivedSessionIds - registry-global archive set.
 * @param pendingInteractions - pending UI interactions by Session.
 * @param hidden - Sessions a view option leaves out, such as managed Workspace members.
 * @returns flat rows in render order.
 */
export function deriveFlat(
  list: SessionListState,
  archivedSessionIds: readonly SessionId[],
  pendingInteractions: SessionPendingInteractions,
  hidden: ReadonlySet<SessionId> = new Set(),
): SessionNode[] {
  const archived = new Set(archivedSessionIds)
  const descendants = indexSubagentDescendants(list.byId)
  const runningJobs = indexRunningJobs(list.jobsBySession)
  const rows: SessionSummary[] = []
  for (const id of list.ids) {
    const s = list.byId[id]
    if (s === undefined || hidden.has(s.id) || !sessionVisible(s, list.current, archived)) continue
    rows.push(s)
  }
  rows.sort(byRecency)
  return rows.map(session => sessionNode(session, descendants, runningJobs, pendingInteractions))
}

/**
 * Derive the Archived section's rows: every archived top-level Session,
 * newest update first, whatever Workspace accounts for it.
 * @param list - sessions list snapshot.
 * @param archivedSessionIds - registry-global archive set.
 * @param pendingInteractions - pending UI interactions by Session.
 * @param hidden - Sessions a view option leaves out, such as managed Workspace members.
 * @returns archived rows in render order.
 */
export function deriveArchived(
  list: SessionListState,
  archivedSessionIds: readonly SessionId[],
  pendingInteractions: SessionPendingInteractions,
  hidden: ReadonlySet<SessionId>,
): SessionNode[] {
  const descendants = indexSubagentDescendants(list.byId)
  const runningJobs = indexRunningJobs(list.jobsBySession)
  const rows: SessionSummary[] = []
  for (const id of archivedSessionIds) {
    const s = list.byId[id]
    if (s === undefined || hidden.has(s.id) || s.origin === 'subagent' || s.blank) continue
    rows.push(s)
  }
  rows.sort(byRecency)
  return rows.map(session => sessionNode(session, descendants, runningJobs, pendingInteractions))
}

/**
 * Project Session summaries into flat result rows with their Workspace label,
 * activity, and optional content excerpt.
 * @param list - session metadata authority.
 * @param workspaces - Workspace membership and display labels.
 * @param pendingInteractions - pending UI interactions by Session.
 * @param summaries - the Sessions to project, in display order.
 * @param content - content matches by Session; a matched row carries its event seq and snippet.
 * @returns one row per summary, in the given order.
 */
function resultRows(
  list: SessionListState,
  workspaces: readonly WorkspaceView[],
  pendingInteractions: SessionPendingInteractions,
  summaries: readonly SessionSummary[],
  content: ReadonlyMap<SessionId, SessionSearchResultItem>,
): SearchResultNode[] {
  const descendants = indexSubagentDescendants(list.byId)
  const runningJobs = indexRunningJobs(list.jobsBySession)
  const workspaceBySession = new Map<SessionId, string>()
  for (const workspace of workspaces) {
    for (const sessionId of workspace.sessionIds) {
      if (!workspaceBySession.has(sessionId)) workspaceBySession.set(sessionId, workspace.title)
    }
  }
  return summaries.map((summary) => {
    const match = content.get(summary.id)
    const pendingInteraction = visiblePendingKind(pendingInteractions.get(summary.id)?.kind)
    return {
      id: summary.id,
      title: sessionTitle(summary),
      untitled: summary.title === undefined,
      workspace: workspaceBySession.get(summary.id) ?? workspaceLabel(summary.cwd),
      running: summary.running,
      runningSubagentCount: descendants.get(summary.id)?.runningCount ?? 0,
      runningJobCount: runningJobs.get(summary.id) ?? 0,
      ...(pendingInteraction === undefined
        ? {}
        : { pendingInteraction }),
      completed: summary.completed === true,
      hasActiveSchedule: hasActiveSchedule(summary),
      ...match === undefined ? {} : { matchSeq: match.seq, snippet: match.snippet },
    }
  })
}

/**
 * The most recently updated Sessions a search starts from before any query is
 * typed. Blank placeholders and archived Sessions are left out, as they are
 * from search results.
 * @param list - session metadata authority.
 * @param workspaces - Workspace membership and display labels.
 * @param archivedSessionIds - registry-global archive set.
 * @param pendingInteractions - pending UI interactions by Session.
 * @param limit - maximum row count.
 * @returns up to `limit` rows, newest first.
 */
export function deriveRecentResults(
  list: SessionListState,
  workspaces: readonly WorkspaceView[],
  archivedSessionIds: readonly SessionId[],
  pendingInteractions: SessionPendingInteractions,
  limit: number,
): readonly SearchResultNode[] {
  const archived = new Set(archivedSessionIds)
  const recent: SessionSummary[] = []
  for (const id of list.ids) {
    const summary = list.byId[id]
    if (summary === undefined || summary.blank || !sessionVisible(summary, list.current, archived)) continue
    recent.push(summary)
  }
  recent.sort(byRecency)
  return resultRows(list, workspaces, pendingInteractions, recent.slice(0, limit), new Map())
}

/**
 * Merge immediate title/Workspace substring matches with ranked Host content
 * matches. Local rows lead newest-first, content-only rows retain backend
 * order, and duplicate sessions receive the backend snippet in place.
 * @param list - session metadata authority.
 * @param workspaces - Workspace membership and display labels.
 * @param query - caller text; surrounding whitespace is ignored.
 * @param archivedSessionIds - registry-global archive set (members never match).
 * @param pendingInteractions - pending UI interactions by Session.
 * @param content - ranked Host content-search page.
 * @param limit - protocol-owned maximum merged row count.
 * @returns bounded deduplicated flat rows and a refine-query hint bit.
 */
export function deriveSearchResults(
  list: SessionListState,
  workspaces: readonly WorkspaceView[],
  query: string,
  archivedSessionIds: readonly SessionId[],
  pendingInteractions: SessionPendingInteractions,
  content: { items: readonly SessionSearchResultItem[]; hasMore: boolean },
  limit: number,
): SearchResultSet {
  const q = query.trim().toLowerCase()
  if (q === '') return { items: [], hasMore: false }
  const archived = new Set(archivedSessionIds)

  const workspaceBySession = new Map<SessionId, string>()
  for (const workspace of workspaces) {
    for (const sessionId of workspace.sessionIds) {
      if (!workspaceBySession.has(sessionId)) workspaceBySession.set(sessionId, workspace.title)
    }
  }
  const labelOf = (summary: SessionSummary): string =>
    workspaceBySession.get(summary.id) ?? workspaceLabel(summary.cwd)
  const contentBySession = new Map<SessionId, SessionSearchResultItem>()
  for (const item of content.items) {
    if (!contentBySession.has(item.sessionId)) contentBySession.set(item.sessionId, item)
  }

  const local: SessionSummary[] = []
  for (const id of list.ids) {
    const summary = list.byId[id]
    // Blank placeholders never match a query (their canonical title displays
    // localized, so matching it would tie search to one language).
    if (summary === undefined || summary.blank || !sessionVisible(summary, list.current, archived)) continue
    if (
      sessionTitle(summary).toLowerCase().includes(q)
      || labelOf(summary).toLowerCase().includes(q)
    ) {
      local.push(summary)
    }
  }
  local.sort(byRecency)

  const ordered: SessionSummary[] = []
  const included = new Set<SessionId>()
  const include = (summary: SessionSummary): void => {
    if (included.has(summary.id)) return
    included.add(summary.id)
    ordered.push(summary)
  }
  for (const summary of local) include(summary)
  for (const item of content.items) {
    const summary = list.byId[item.sessionId]
    if (summary !== undefined && !summary.blank && sessionVisible(summary, list.current, archived)) include(summary)
  }

  return {
    items: resultRows(list, workspaces, pendingInteractions, ordered.slice(0, limit), contentBySession),
    hasMore: content.hasMore || ordered.length > limit,
  }
}
