/**
 * Workspace browser tree row components (figma Cell set 14:3080): pure presentational —
 * all data and callbacks arrive via props. Hover swaps (time->ellipsis, action
 * buttons) are CSS-only. Row ... menus are visual-only except workspace
 * Rename/Delete and session Rename/Fork/Archive; the session hover card is
 * suppressed while its menu is open, and a session row whose title is still
 * being created offers no Rename.
 *
 * A Workspace row's leading glyph has exactly two states — the open folder
 * while the group is expanded, the closed folder while it is folded — and the
 * row's own click owns the toggle.
 */
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import clsx from 'clsx'
import {
  IconAlarmClockOutline16, IconArchiveOutline20, IconBranchOutline16,
  IconEditOutline16, IconLucideEllipsis, IconLucideEllipsisVertical, IconLucideMessageCircle,
  IconLucideMessageCircleQuestionMark,
  IconLucideFolder, IconLucideFolderOpen,
  IconLucideMessageCirclePlus, IconTrashOutline16, Menu,
  Spinner, StateDot, Tooltip,
} from '@aeven/client-ui-primitives'
import type { StateDotState } from '@aeven/client-ui-primitives'
import type { SessionId } from '@aeven/session/types'
import type { WorkspaceBrowserProps } from '../contract/slots.ts'
import { sessionPathOf } from '../session-url.ts'
import type { GroupNode, SearchResultNode, SessionNode } from '../tree.ts'
import css from './Rows.module.css'

/** The standard locale seat, prop-passed from the browser root. */
type RowTranslate = WorkspaceBrowserProps['t']

/**
 * Modifier keys whose meaning is "open this link somewhere else": a new window,
 * a new tab, or a download the browser owns. Holding one must reach the browser
 * untouched, exactly as it does on the sidebar's New Session link.
 */
const NAVIGATION_MODIFIER_KEYS = ['metaKey', 'ctrlKey', 'shiftKey', 'altKey'] as const

/**
 * Whether an activation is the browser's own navigation, and so ours to handle.
 *
 * Only an unmodified primary pointer click is. Middle click, the context menu's
 * "Open link in new window", and Cmd/Ctrl/Shift/Alt-click each mean "somewhere
 * else", and swallowing them would leave a link that behaves like a button.
 * @param event - the React activation event on a row's link.
 * @returns true when the row should open the Session in place instead.
 */
function isPlainActivation(event: ReactMouseEvent): boolean {
  // A real primary click reports 0, and so does the click a link synthesizes
  // for Enter, which is the keyboard's own navigation and takes this path too.
  if (event.button !== 0) return false
  return !NAVIGATION_MODIFIER_KEYS.some(key => event[key])
}

/**
 * Row display title: a Session with no durable title — the provisional New
 * Session row, and the just-started row whose title the Host has not projected
 * yet — shows the localized New Session label rather than the fallback the data
 * layer resolves (its id). The label the reader saw when the row appeared is
 * the one it keeps until a real title arrives.
 */
function displayTitle(node: SessionNode, t: RowTranslate): string {
  return node.blank || node.untitled ? t('session.new') : node.title
}

/**
 * Whether the row withholds its own Rename action.
 *
 * A Session with no durable title is still having that title created: its
 * model call is in flight, or the deterministic fallback that fills a failed
 * call has not landed yet. The row's text is then the localized New Session
 * label rather than a name to edit, and renaming it would name a Session the
 * title revision is about to name. A title-less Session at rest — one whose
 * prompt produced no eligible title input — keeps the action, because nothing
 * is coming that could replace a name the reader gives it.
 * @param node - derived session node.
 * @returns true while the row offers no Rename action.
 */
function titleCreationPending(node: SessionNode): boolean {
  return node.untitled && node.running
}

/**
 * Row drag wiring supplied by the tree owner. `drop` reports the half of the
 * row where the pointer released so the owner can resolve an insert anchor.
 */
export interface RowDragProps {
  /** Start dragging this row. */
  start: () => void
  /** A compatible row drag is in flight. */
  active: boolean
  /** Current marker on this row: insert line above, below, or none. */
  marker: 'before' | 'after' | null
  /** Report the hovered half while a compatible drag passes over this row. */
  hover: (half: 'before' | 'after') => void
  drop: (half: 'before' | 'after') => void
  end: () => void
}

/** Drag lifecycle owned by a workspace row; its enclosing group owns hit testing. */
interface WorkspaceRowDragProps {
  start: () => void
  end: () => void
}

/** Pointer-position half of a row (insert line above or below). */
function rowHalf(e: { clientY: number; currentTarget: HTMLElement }): 'before' | 'after' {
  const rect = e.currentTarget.getBoundingClientRect()
  return e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
}

/**
 * Header row label: a Workspace group reads that Workspace's title, while every
 * derived bucket reads dictionary copy named by its discriminant.
 * @param group - derived group node.
 * @param t - the browser root's locale seat.
 * @returns the row's visible label.
 */
function groupLabel(group: GroupNode, t: RowTranslate): string {
  switch (group.bucket) {
    case 'ungrouped': return t('group.ungrouped')
    case 'archived': return t('group.archived')
    case 'needs-input': return t('status.group.needsInput')
    case 'working': return t('status.group.working')
    case 'completed': return t('status.group.completed')
    case undefined: return group.label
    /* v8 ignore next -- closed GroupBucket union */
    default: return assertNever(group.bucket)
  }
}

/**
 * Project (workspace) header row: folder + title, where the folder itself is
 * the fold state (open while the group is expanded, closed while it is
 * folded); row hover reveals the options and create controls, and dwelling on a real
 * Workspace shows its hover card (the ungrouped bucket has none).
 * `containsCurrent` arrives on the node (derivation fact, no renderer scan).
 * @param props.group - derived group node.
 * @param props.onToggle - expand/collapse the group.
 * @param props.newSessionHref - mint the address the row's New Session link names.
 * @param props.onCreate - start a New Session in this row's Workspace.
 * @param props.actions - real-Workspace actions; absent for the ungrouped bucket.
 * @param props.drag - optional workspace-row drag wiring.
 * @param props.t - the browser root's locale seat.
 * @returns the row element.
 */
export function ProjectRowItem({ group, onToggle, newSessionHref, onCreate, actions, drag, t }: {
  group: GroupNode
  onToggle: () => void
  /** Mint the address for a browser-owned open of this row's New Session link. */
  newSessionHref: () => { href: string; sessionId: SessionId }
  /** Start a New Session in this row's Workspace. */
  onCreate: () => void
  /** Real-Workspace actions; absent for the ungrouped bucket (no menu shown). */
  actions?: { rename: () => void; delete: () => void; bind?: (() => void) | undefined } | undefined
  /** Present only for real Workspace rows in the grouped view. */
  drag?: WorkspaceRowDragProps | undefined
  t: RowTranslate
}) {
  const row = group
  const label = groupLabel(row, t)
  const [menuOpen, setMenuOpen] = useState(false)
  /**
   * The chat a browser-owned open of this row's New Session link starts.
   *
   * Asked once and held in state, not re-asked every render: the address has to
   * hold still while the reader looks at it, or it could not be copied or
   * opened deliberately. A plain press runs the New Session flow instead — see
   * the link's own comment — so this is what middle click, the context menu and
   * a copied address produce, not what a plain press opens.
   *
   * The ungrouped bucket accounts for Sessions no Workspace owns, so it has no
   * Workspace to name and mints no chat: its row carries no create control
   * rather than one that would start a chat somewhere else.
   */
  const [newSession, setNewSession] = useState(() => (
    row.workspaceId === undefined || row.managed ? undefined : newSessionHref().href
  ))
  // Deleting a workspace keeps its folder and session logs and archives its
  // sessions, so the row reads like the others rather than as destructive.
  const workspaceMenuItems = [
    // A workspace another device registered opens here once it has a folder of this device.
    ...actions?.bind === undefined ? [] : [{ id: 'bind', label: t('bind.workspace'), icon: <IconLucideFolder /> }],
    { id: 'rename', label: t('rename'), icon: <IconEditOutline16 /> },
    { id: 'delete', label: t('delete.workspace'), icon: <IconTrashOutline16 /> },
  ]
  return (
    <div
      className={clsx(css.projectRow, menuOpen && css.menuOpen)}
      role="treeitem"
      aria-expanded={row.expanded}
      onClick={onToggle}
      draggable={drag !== undefined}
      onDragStart={drag === undefined
        ? undefined
        : (e) => {
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', row.key)
          drag.start()
        }}
      onDragEnd={drag?.end}
    >
      <span className={clsx(css.slot, css.folder)}>
        {row.expanded ? <IconLucideFolderOpen /> : <IconLucideFolder />}
      </span>
      <span className={css.projectText}>
        <span className={css.title}>{label}</span>
      </span>
      <span className={css.rowActions}>
        {actions !== undefined && (
          <Menu
            open={menuOpen}
            onClose={() => { setMenuOpen(false) }}
            items={workspaceMenuItems}
            onSelect={(id) => {
              setMenuOpen(false)
              // Unknown ids leave before the dispatch: a future menu row must
              // not inherit the destructive branch as an else fallback.
              if (id === 'bind') {
                actions.bind?.()
                return
              }
              /* v8 ignore next -- Menu can emit only the bind, rename, and delete rows supplied above. */
              if (id !== 'rename' && id !== 'delete') return
              if (id === 'rename') actions.rename()
              else actions.delete()
            }}
            portal
            closeOnPointerLeave
            anchor={(
              <Tooltip label={t('actions.workspace.tooltip')} side="top" anchor="icon">
                <button
                  type="button"
                  className={clsx(css.iconButton, css.fullHeightAction)}
                  aria-label={t('actions.workspace.aria', { name: label })}
                  onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v) }}
                >
                  <IconLucideEllipsis className={css.actionIcon} />
                </button>
              </Tooltip>
            )}
          />
        )}
        {newSession !== undefined && (
          <Tooltip label={t('actions.newSession.tooltip')} side="top" anchor="icon">
            {/* A real anchor, not a button with a click handler: the browser
                then owns middle-click, "Open link in new window" and the
                status-bar address, which no scripted `window.open` gives back.
                A plain press runs the New Session flow, which reuses the
                Workspace's never-prompted chat before it creates one — text
                left unsent there comes back with it. `draggable` is off so a
                press here starts the row's own reorder drag rather than the
                browser's link drag. */}
            <a
              className={clsx(css.iconButton, css.trailingAction)}
              href={newSession}
              draggable={false}
              aria-label={t('actions.newSession.aria', { name: label })}
              onClick={(event) => {
                // The row's own click owns the fold toggle, so this control
                // stays separate from it whatever the activation means.
                event.stopPropagation()
                if (!isPlainActivation(event)) return
                // A plain press is ours: the SPA starts the chat, and cancelling
                // the default action is what keeps the browser from following
                // the href out of the page. Every other activation is left to
                // the browser, which owns the window it can open this address
                // in.
                event.preventDefault()
                onCreate()
                setNewSession(newSessionHref().href)
              }}
            >
              {/* The New Session mark itself, so the row's add affordance and the
                  Chat row above it read as the same action. */}
              <IconLucideMessageCirclePlus className={css.actionIcon} />
            </a>
          </Tooltip>
        )}
      </span>
    </div>
  )
}

/* v8 ignore next 3 -- closed-union backstop; only reached if the status is forged */
function assertNever(value: never): never {
  throw new Error(`unknown pending interaction: ${String(value)}`)
}

/** A row's status mark: one of the dot states, or the pending-interaction mark
 * every pending kind shares — one glyph whose label carries the kind. */
type SessionMarkState = StateDotState | 'pending'

interface SessionStatus {
  state: SessionMarkState
  label: string
}

/**
 * Session status presentation; pending interaction is primary and live activity
 * outranks completion reminders. A Session's own Agent, its running subagents,
 * and its live background jobs are all work in flight, so each one that applies
 * contributes a status beside the primary.
 */
function sessionStatuses(
  node: Pick<SessionNode,
    'pendingInteraction' | 'running' | 'runningSubagentCount' | 'runningJobCount' | 'completed'>,
  t: RowTranslate,
): readonly [SessionStatus, ...SessionStatus[]] {
  const subagents: SessionStatus | undefined = node.runningSubagentCount === 0
    ? undefined
    : {
      state: 'ongoing',
      label: t(
        node.runningSubagentCount === 1
          ? 'status.subagentsRunning.one'
          : 'status.subagentsRunning.other',
        { n: node.runningSubagentCount },
      ),
    }
  // A job keeps working between turns, so its status is what tells a reader
  // that an idle-looking Session is not finished.
  const jobs: SessionStatus | undefined = node.runningJobCount === 0
    ? undefined
    : {
      state: 'ongoing',
      label: t(
        node.runningJobCount === 1
          ? 'status.jobsRunning.one'
          : 'status.jobsRunning.other',
        { n: node.runningJobCount },
      ),
    }
  let pending: SessionStatus | undefined
  switch (node.pendingInteraction) {
    case 'approval':
      pending = { state: 'pending', label: t('status.waitingApproval') }
      break
    case 'plan-review':
      pending = { state: 'pending', label: t('status.planReview') }
      break
    case 'question':
      pending = { state: 'pending', label: t('status.waitingAnswer') }
      break
    case undefined: break
    /* v8 ignore next -- closed PendingInteractionStatus union */
    default: return assertNever(node.pendingInteraction)
  }
  if (pending !== undefined) return withLiveWork(pending, subagents, jobs)
  if (node.running) return withLiveWork({ state: 'ongoing', label: t('status.running') }, subagents, jobs)
  if (subagents !== undefined) return withLiveWork(subagents, jobs)
  if (jobs !== undefined) return [jobs]
  if (node.completed) return [{ state: 'done', label: t('status.completed') }]
  return [{ state: 'done', label: t('status.idle') }]
}

/** One primary status followed by every live-work status that also applies. */
function withLiveWork(
  primary: SessionStatus,
  ...extras: readonly (SessionStatus | undefined)[]
): readonly [SessionStatus, ...SessionStatus[]] {
  return [primary, ...extras.filter((extra): extra is SessionStatus => extra !== undefined)]
}

/**
 * The status mark itself: work in flight is the shared Aeven loading glyph —
 * one 18px #000000 mark rotating — rather than a state dot, so a running
 * Session reads the same in the list as every other in-flight surface; a
 * Session at rest carries the empty chat bubble the View menu's Chat row
 * draws, at low opacity until the pointer is on the row, the row is the
 * selected Session, or its menu is open.
 */
function StatusMark({ state }: { state: SessionMarkState }) {
  if (state === 'ongoing') return <Spinner className={css.runningMark} />
  if (state === 'done') return <IconLucideMessageCircle className={css.idleMark} />
  if (state === 'pending') return <IconLucideMessageCircleQuestionMark className={css.pendingMark} />
  return <StateDot state={state} />
}

/** Primary status mark plus every status's screen-reader label, shared by the search and session rows. */
function SessionStatusDots({ statuses }: { statuses: readonly [SessionStatus, ...SessionStatus[]] }) {
  return (
    <>
      <StatusMark state={statuses[0].state} />
      {statuses.map(status => (
        <span className={css.visuallyHidden} key={status.label}>{status.label}</span>
      ))}
    </>
  )
}

/** Non-interactive active-Schedule marker; the enclosing row remains the only action. */
function ActiveScheduleIndicator({ t, search = false }: { t: RowTranslate; search?: boolean }) {
  const label = t('schedule.active')
  return (
    <span
      className={clsx(css.scheduleIndicator, search && css.searchScheduleIndicator)}
      role="img"
      aria-label={label}
      title={label}
    >
      <IconAlarmClockOutline16 />
    </span>
  )
}

/**
 * One flat search result: title, Workspace context, and optional content
 * excerpt. Content matches retain their exact durable event destination.
 *
 * The title follows the Session row's rule: a Session with no durable title
 * reads as the New Session label rather than the identity fallback the data
 * layer resolves, so a content match inside a chat the reader just started is
 * named the way the navigation names it.
 * @param props.result - merged local/content search row.
 * @param props.currentId - selected session id.
 * @param props.onOpen - open the selected session.
 * @param props.t - Workspace-browser translation seat.
 * @returns the result button.
 */
export function SearchResultItem({ result, currentId, onOpen, t }: {
  result: SearchResultNode
  currentId: string | undefined
  onOpen: (id: SearchResultNode['id'], matchSeq?: SearchResultNode['matchSeq']) => void
  t: RowTranslate
}) {
  const selected = result.id === currentId
  const statuses = sessionStatuses(result, t)
  return (
    <button
      type="button"
      className={clsx(css.searchResultRow, selected && css.selected)}
      role="treeitem"
      aria-selected={selected}
      onClick={() => { onOpen(result.id, result.matchSeq) }}
    >
      <span className={css.searchResultHeading}>
        <span className={css.slot}>
          <SessionStatusDots statuses={statuses} />
        </span>
        <span className={css.searchResultTitle}>
          {result.untitled ? t('session.new') : result.title}
        </span>
        {result.hasActiveSchedule && <ActiveScheduleIndicator t={t} search />}
      </span>
      <span className={css.searchResultMeta}>
        <span className={css.searchResultWorkspace}>{result.workspace || t('group.ungrouped')}</span>
        {result.snippet !== undefined && (
          <span className={css.searchResultSnippet}>{result.snippet}</span>
        )}
      </span>
    </button>
  )
}

/**
 * One top-level 34px session row: status dot (pending user interaction outranks
 * own or descendant activity), title, relative time, and the row actions menu.
 * The row's content is an anchor on the Session's `/c/<id>` address, so the
 * browser can open the chat in a new window; the row keeps the hit area and the
 * actions cell around it.
 * @param props.node - derived session node.
 * @param props.currentId - selected session id (row highlight).
 * @param props.onOpen - open a session by id (a plain click on the row).
 * @param props.onRename - open the session rename dialog (id + current title).
 * @param props.onFork - fork a session at its last completed turn.
 * @param props.onArchive - archive a session by id.
 * @param props.onUnarchive - unarchive a session by id; present only on Archived-section rows, which offer it in place of Archive.
 * @param props.onReveal - scroll this row into view after search navigation, then acknowledge it.
 * @param props.drag - optional draggable-row wiring.
 * @param props.t - the browser root's locale seat.
 * @returns the session row.
 */
export function SessionNodeItem({
  node, currentId, onOpen, onRename, onFork, onArchive, onUnarchive, onReveal, drag, t,
}: {
  node: SessionNode
  currentId: string | undefined
  onOpen: (id: SessionNode['id']) => void
  /** Open the browser-owned session rename dialog (row menu action). */
  onRename: (id: SessionNode['id'], currentTitle: string) => void
  /** Fork a session at its last completed turn (row menu action). */
  onFork: (id: SessionNode['id']) => void
  /** Archive this session (row menu action; commits without a dialog). */
  onArchive: (id: SessionNode['id']) => void
  /** Unarchive this session; present only on rows of the Archived section. */
  onUnarchive?: ((id: SessionNode['id']) => void) | undefined
  /** Scroll this row into view after search navigation, then acknowledge it. */
  onReveal?: (() => void) | undefined
  /** Present only on draggable rows (workspace-group sessions outside search). */
  drag?: RowDragProps | undefined
  t: RowTranslate
}) {
  const row = node
  const title = displayTitle(node, t)
  const selected = node.id === currentId
  const statuses = sessionStatuses(node, t)
  const [menuOpen, setMenuOpen] = useState(false)
  const rowRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (onReveal === undefined) return
    rowRef.current?.scrollIntoView({ block: 'nearest' })
    onReveal()
  }, [onReveal])
  // Archive hides the row through the registry-global archive set and never
  // touches the session log, so it is not styled as destructive and needs no
  // confirmation dialog.
  const sessionMenuItems = [
    // Withheld while the row's title is still being created; see
    // {@link titleCreationPending}.
    ...(titleCreationPending(row) ? [] : [{ id: 'rename', label: t('rename'), icon: <IconEditOutline16 /> }]),
    { id: 'fork', label: t('menu.fork'), icon: <IconBranchOutline16 /> },
    // 20-native glyph in the menu's 16px icon slot (Menu.module.css .itemIcon).
    onUnarchive === undefined
      ? { id: 'archive', label: t('menu.archiveSession'), icon: <IconArchiveOutline20 size={16} /> }
      : { id: 'unarchive', label: t('menu.unarchiveSession'), icon: <IconArchiveOutline20 size={16} /> },
  ]
  // Figma session cell: pad 8, status slot 16, then a 4px title gap.
  const ownRow = (
    <div
      ref={rowRef}
      className={clsx(
        css.sessionRow, selected && css.selected, menuOpen && css.menuOpen,
        drag?.marker === 'before' && css.dropBefore, drag?.marker === 'after' && css.dropAfter,
      )}
      role="treeitem"
      aria-selected={selected}
      onClick={(event) => {
        if (!isPlainActivation(event)) return
        // A plain click is ours: the SPA opens the Session and pushes history,
        // and cancelling the default action is what keeps the browser from
        // following the href out of the page. Every other activation is left
        // to the browser, which owns the new window this link can be opened in.
        event.preventDefault()
        onOpen(node.id)
      }}
      draggable={drag !== undefined}
      onDragStart={drag === undefined
        ? undefined
        : (e) => {
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', node.id)
          drag.start()
        }}
      onDragEnd={drag?.end}
      onDragOver={drag === undefined
        ? undefined
        : (e) => {
          if (!drag.active) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          drag.hover(rowHalf(e))
        }}
      onDrop={drag === undefined
        ? undefined
        : (e) => {
          if (!drag.active) return
          e.preventDefault()
          drag.drop(rowHalf(e))
        }}
    >
      {/* A real anchor, not a click handler on a row: the browser then owns
          middle-click, "Open link in new window" and the status-bar address,
          which no scripted `window.open` gives back. The row's own handler
          above still opens a plain click in place, and the trailing actions
          cell stays OUTSIDE this link because interactive content may not
          nest inside one. `draggable` is off so a press here starts the row's
          own reorder drag rather than the browser's link drag. */}
      <a
        className={css.sessionLink}
        href={sessionPathOf(node.id)}
        draggable={false}
      >
        {/* Pending interaction and own or descendant activity outrank the
            finished-but-unviewed reminder, which returns after activity stops
            and is cleared by opening the session. */}
        <span className={css.slot}>
          <SessionStatusDots statuses={statuses} />
        </span>
        <span className={css.title}>{title}</span>
        {row.hasActiveSchedule && <ActiveScheduleIndicator t={t} />}
      </a>
      {!row.blank && (
        <span className={css.rowActions}>
          <Menu
            open={menuOpen}
            onClose={() => { setMenuOpen(false) }}
            items={sessionMenuItems}
            onSelect={(id) => {
              setMenuOpen(false)
              if (id === 'rename') onRename(node.id, row.title)
              if (id === 'fork') onFork(node.id)
              if (id === 'archive') onArchive(node.id)
              if (id === 'unarchive') onUnarchive?.(node.id)
            }}
            portal
            closeOnPointerLeave
            anchor={(
              <Tooltip label={t('actions.session.tooltip')} side="top" anchor="icon">
                <button
                  type="button"
                  className={clsx(css.iconButton, css.trailingAction)}
                  aria-label={t('actions.session.aria', { name: title })}
                  onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v) }}
                >
                  <IconLucideEllipsisVertical className={css.actionIcon} />
                </button>
              </Tooltip>
            )}
          />
        </span>
      )}
    </div>
  )
  return ownRow
}
