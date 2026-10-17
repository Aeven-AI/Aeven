// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@aeven/client-test-runtime'
import type {
  SessionListState, SessionSummary,
} from '@aeven/api-session-controller/client'
import type {
  WorkspaceId, WorkspaceSnapshot, WorkspaceView,
} from '@aeven/api-workspace-controller/client'
import type {
  SessionPendingInteractionBase, SessionPendingInteractionSnapshot,
} from '@aeven/client-ui-session/client'
import type { SessionId } from '@aeven/session/types'
import { zh as commonZh } from '@aeven/client-locale/src/locales/zh.ts'
import type {
  DirectoryFlowOwnerProps, WorkspaceBrowserProps, WorkspaceHeaderActionsProps,
} from '../src/client/contract/slots.ts'
import { createWorkspaceViewStore } from '../src/client/stores.ts'
import { STATUS_BUCKET_KEYS, UNGROUPED_KEY } from '../src/client/tree.ts'
import { WorkspaceHeaderActions } from '../src/client/HeaderActions.tsx'
import { WorkspaceBrowser } from '../src/client/rows/WorkspaceBrowser.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
const scrollIntoView = vi.fn()
beforeEach(() => {
  localStorage.clear()
  createWorkspaceViewStore().create().actions.setOrderBy('manual')
  Element.prototype.scrollIntoView = scrollIntoView
  scrollIntoView.mockClear()
})

// The seat's key domain is workspace ∪ common; the stub mirrors the real
// lookup chain (namespace, then common vocabulary, then the key).
const t: WorkspaceBrowserProps['t'] = makeTranslate(zh, commonZh)

const sid = (id: string) => id as SessionId
const wid = (id: string) => id as WorkspaceId
const summary = (id: string, updatedAt: number, overrides: Partial<SessionSummary> = {}): SessionSummary => ({
  id: sid(id), createdAt: 0, displayTitle: id, title: id, running: false, blank: false, updatedAt, ...overrides,
})
const sessionState = (items: readonly SessionSummary[], overrides: Partial<SessionListState> = {}): SessionListState => ({
  ids: items.map(item => item.id),
  byId: Object.fromEntries(items.map(item => [item.id, item])),
  current: undefined,
  phase: 'ready',
  subagentsByParent: {}, jobsBySession: {},
  currentAddress: undefined,
  ...overrides,
})
const workspace = (id: string, sessionIds: string[], title = id): WorkspaceView => ({
  workspaceId: wid(id), kind: 'folder', isDefault: false, isBuiltIn: false, path: `/projects/${id}`, title,
  sessionIds: sessionIds.map(sid), createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
})
const workspaceState = (
  items: readonly WorkspaceView[],
  archivedSessionIds: readonly SessionId[] = [],
): WorkspaceSnapshot => ({ items, archivedSessionIds, state: 'idle', phase: 'ready', error: null })
const noPendingInteraction: SessionPendingInteractionSnapshot = new Map()
function hook<T>(snapshot: T) {
  return function select<S>(selector: (state: T) => S): S { return selector(snapshot) }
}

/** jsdom lacks DragEvent — the fireEvent fallback drops clientY, so pin it on the built event. */
function fireDrag(row: HTMLElement, kind: 'dragOver' | 'drop', clientY: number): void {
  const event = kind === 'dragOver' ? createEvent.dragOver(row) : createEvent.drop(row)
  Object.defineProperty(event, 'clientY', { value: clientY })
  Object.defineProperty(event, 'dataTransfer', { value: { effectAllowed: '', dropEffect: '' } })
  fireEvent(row, event)
}

function dragData(): Pick<DataTransfer, 'effectAllowed' | 'dropEffect' | 'setData'> {
  return { effectAllowed: 'uninitialized', dropEffect: 'none', setData: vi.fn() }
}

/**
 * Mount the assembled browsing region: the shell's header cluster (view options
 * and add workspace) beside the list body, over the one shared viewing store the
 * two halves write and read. `flowOccupied` states whether a directory-flow
 * occupant fills this surface's hole; the slot stub draws only while the flow is
 * requested, as the composed picker's own client half does.
 */
function mount(
  overrides: Partial<WorkspaceBrowserProps> = {},
  { flowOccupied = false }: { flowOccupied?: boolean } = {},
) {
  const store = createWorkspaceViewStore().create()
  const props: WorkspaceBrowserProps = {
    wide: true,
    expandSidebar: vi.fn(),
    useSessions: hook(sessionState([])),
    useSessionPendingInteraction: hook(noPendingInteraction),
    useWorkspaces: hook(workspaceState([])),
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    startSession: vi.fn(),
    newSessionHref: () => ({ href: '/c/new-1', sessionId: sid('session-new-1') }),
    open: vi.fn(),
    renameSession: vi.fn(async () => {}),
    clearSessionRenameRequest: vi.fn(),
    forkSession: vi.fn(),
    renameWorkspace: vi.fn(async () => {}),
    deleteWorkspace: vi.fn(async () => {}),
    archiveSession: vi.fn(async () => {}),
    unarchiveSession: vi.fn(async () => {}),
    insertWorkspaceBefore: vi.fn(async () => {}),
    insertSessionBefore: vi.fn(async () => {}),
    useHostInfo: selector => selector({ home: undefined, isLoopback: true }),
    useSessionRenameRequest: selector => selector(null),
    t,
    ...overrides,
  }
  const headerProps: WorkspaceHeaderActionsProps = {
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    useWorkspaces: props.useWorkspaces,
    useSessions: props.useSessions,
    useSessionPendingInteraction: props.useSessionPendingInteraction,
    startSession: props.startSession,
    createWorkspace: vi.fn(async () => workspace('created', [])),
    useDirectoryFlow: selector => selector(flowOccupied),
    renderSlot: ((_key: string, owner: DirectoryFlowOwnerProps) =>
      owner.open ? <div data-testid="directory-flow" /> : null) as WorkspaceHeaderActionsProps['renderSlot'],
    t,
  }
  const view = render(
    <>
      <WorkspaceHeaderActions {...headerProps} />
      <WorkspaceBrowser {...props} />
    </>,
  )
  return {
    view,
    props,
    store,
    /** The same assembled pair, for a rerender after {@link rerender}'s props swap. */
    render: () => (
      <>
        <WorkspaceHeaderActions {...headerProps} />
        <WorkspaceBrowser {...props} />
      </>
    ),
  }
}

/** Re-render with (possibly) changed props — WorkspaceBrowser has no side channel. */
function rerender(b: ReturnType<typeof mount>, overrides: Partial<WorkspaceBrowserProps>) {
  Object.assign(b.props, overrides)
  b.view.rerender(b.render())
}

describe('WorkspaceBrowser', () => {
  // Divergence: the row's hover card was removed from the product (no
  // HoverCard consumer remains under packages/client/*/src), taking the row's
  // directory path and its `~` home abbreviation with it. ui-workspace's
  // README ("Hover cards"), Rows.tsx's module doc, and the browser's injected
  // hooks.hostInfo — which now has no reader — still describe that surface.
  it('shows a Workspace row as its title, without its directory path', () => {
    vi.useFakeTimers()
    try {
      mount({
        useWorkspaces: hook(workspaceState([{
          ...workspace('project', []),
          path: '/home/u/Documents/project',
          title: 'Project',
        }])),
        useHostInfo: selector => selector({ home: '/home/u', isLoopback: true }),
      })
      const row = screen.getByRole('treeitem')
      expect(row.textContent).toContain('Project')
      // The row's own content is the title alone: dwelling adds no card, and
      // no directory path (abbreviated or not) is drawn anywhere in the region.
      fireEvent.pointerEnter(row)
      act(() => { vi.advanceTimersByTime(500) })
      expect(screen.queryByText('/home/u/Documents/project')).toBeNull()
      expect(screen.queryByText('~/Documents/project')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('prunes deleted Workspace view state only after the Workspace baseline is ready', async () => {
    const pending = {
      ...workspaceState([]),
      phase: 'pending' as const,
      state: 'loading' as const,
    }
    const b = mount({ useWorkspaces: hook(pending) })
    act(() => {
      b.store.actions.setGroupExpanded('deleted', true)
      b.store.actions.syncSessionOrderAccount('deleted', ['session'], { session: 1 })
    })
    expect(b.store.getSnapshot().groupExpansion).toEqual({ deleted: true })

    rerender(b, { useWorkspaces: hook(workspaceState([])) })
    await waitFor(() => {
      expect(b.store.getSnapshot().groupExpansion).toEqual({})
      expect(b.store.getSnapshot().sessionOrderByAccount).toEqual({ [UNGROUPED_KEY]: [] })
      expect(b.store.getSnapshot().sessionUpdatedAtByAccount).toEqual({ [UNGROUPED_KEY]: {} })
    })
  })

  it('renders the Workspace tree by default and switches to the status buckets via Group by', () => {
    const sessions = sessionState([summary('alpha-s', 2), summary('beta-s', 1)])
    const b = mount({
      useSessions: hook(sessions),
      useWorkspaces: hook(workspaceState([workspace('alpha', ['alpha-s']), workspace('beta', ['beta-s'])])),
    })
    // Grouped: one session tree whose sections are the Workspaces, folded
    // until their row is opened.
    expect(screen.getByRole('tree', { name: '会话' })).toBeTruthy()
    expect(screen.getByText('alpha')).toBeTruthy()
    expect(screen.queryByText('alpha-s')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '视图选项' }))
    expect(screen.getByText('分组方式')).toBeTruthy() // the menu heading label
    expect(screen.getAllByRole('separator')).toHaveLength(2)
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual([
      '按状态', '按工作区', '手动排序', '最近更新', '显示已归档', '显示自动化',
    ])
    expect(screen.getByRole('menuitem', { name: '按工作区' }).querySelector('svg')).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '手动排序' }).querySelector('svg')).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: '按状态' }))
    // Store-driven flip: the three status buckets replace the Workspace
    // sections and open on their rows.
    expect(b.store.getSnapshot().groupBy).toBe('status')
    expect(screen.queryByText('alpha')).toBeNull()
    expect(screen.getByText('需要输入')).toBeTruthy()
    expect(screen.getByText('进行中')).toBeTruthy()
    expect(screen.getByText('已完成的工作')).toBeTruthy()
    expect(screen.getByText('alpha-s')).toBeTruthy()
    expect(screen.getByText('beta-s')).toBeTruthy()

    // Status buckets hold activity order, so the order options are absent.
    fireEvent.click(screen.getByRole('button', { name: '视图选项' }))
    expect(screen.getAllByRole('separator')).toHaveLength(1)
    expect(screen.queryByRole('menuitem', { name: '手动排序' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: '按工作区' }))
    expect(b.store.getSnapshot().groupBy).toBe('workspace')
    expect(screen.getByText('alpha')).toBeTruthy()

    // Escape closes the menu without picking.
    fireEvent.click(screen.getByRole('button', { name: '视图选项' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(b.store.getSnapshot().groupBy).toBe('workspace')
  })

  it('moves a Session between buckets as it works, waits on the reader, and settles', () => {
    const working = summary('working-s', 3, { running: true })
    const awaiting = summary('awaiting-s', 2)
    const resting = summary('resting-s', 1)
    const queued = summary('queued-s', 4)
    // The browsing region reads only `kind`, which the base shape carries; the
    // assembled snapshot's values are the contributing domains' own carriers.
    const attention = new Map<SessionId, SessionPendingInteractionBase>([[
      awaiting.id,
      { key: 'question:1', kind: 'question', sessionId: awaiting.id },
    ]]) as unknown as SessionPendingInteractionSnapshot
    const b = mount({
      useSessions: hook(sessionState([working, awaiting, resting, queued])),
      useSessionPendingInteraction: hook(attention),
    })
    fireEvent.click(screen.getByRole('button', { name: '视图选项' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '按状态' }))
    // Folder rows and their sessions in render order: a Session waiting on the
    // reader leads, in-flight work follows, everything at rest trails.
    expect(screen.getAllByRole('treeitem').map(row => row.textContent)).toEqual([
      expect.stringContaining('需要输入'), expect.stringContaining('awaiting-s'),
      expect.stringContaining('进行中'), expect.stringContaining('working-s'),
      expect.stringContaining('已完成的工作'), expect.stringContaining('queued-s'),
      expect.stringContaining('resting-s'),
    ])

    // The same Sessions keep their identity while their state changes: the
    // answer arrives, one turn ends, and the queued Session starts working.
    rerender(b, {
      useSessions: hook(sessionState(
        [{ ...working, running: false }, awaiting, resting, { ...queued, running: true }],
      )),
      useSessionPendingInteraction: hook(noPendingInteraction),
    })
    expect(screen.getAllByRole('treeitem').map(row => row.textContent)).toEqual([
      expect.stringContaining('需要输入'),
      expect.stringContaining('进行中'), expect.stringContaining('queued-s'),
      expect.stringContaining('已完成的工作'), expect.stringContaining('working-s'),
      expect.stringContaining('awaiting-s'), expect.stringContaining('resting-s'),
    ])
  })

  it('opens every bucket by default and keeps the one the reader folds folded', () => {
    const done = summary('done-s', 1)
    const b = mount({ useSessions: hook(sessionState([done])) })
    fireEvent.click(screen.getByRole('button', { name: '视图选项' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '按状态' }))
    // A bucket opens on its rows until the reader folds it.
    expect(screen.getByText('done-s')).toBeTruthy()
    fireEvent.click(screen.getByText('已完成的工作'))
    expect(screen.queryByText('done-s')).toBeNull()
    expect(b.store.getSnapshot().groupExpansion[STATUS_BUCKET_KEYS.completed]).toBe(false)

    // The fold holds: selecting a Session inside it does not reopen the bucket.
    rerender(b, { useSessions: hook(sessionState([done], { current: done.id })) })
    expect(b.store.getSnapshot().groupExpansion[STATUS_BUCKET_KEYS.completed]).toBe(false)
    expect(screen.queryByText('done-s')).toBeNull()

    // The reader's own click reopens it.
    fireEvent.click(screen.getByText('已完成的工作'))
    expect(screen.getByText('done-s')).toBeTruthy()
    expect(b.store.getSnapshot().groupExpansion[STATUS_BUCKET_KEYS.completed]).toBe(true)
  })

  it('keeps the new chat in Needs input until its first prompt starts a turn', () => {
    const blank = { ...summary('blank-s', 5), blank: true }
    const b = mount({ useSessions: hook(sessionState([blank], { current: blank.id })) })
    fireEvent.click(screen.getByRole('button', { name: '视图选项' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '按状态' }))
    expect(screen.getAllByRole('treeitem').map(row => row.textContent)).toEqual([
      expect.stringContaining('需要输入'),
      expect.stringContaining('新会话'),
      expect.stringContaining('进行中'),
      expect.stringContaining('已完成的工作'),
    ])

    // The first prompt starts the turn: the same row moves to Working.
    rerender(b, {
      useSessions: hook(sessionState([{ ...blank, blank: false, running: true }], { current: blank.id })),
    })
    expect(screen.getAllByRole('treeitem').map(row => row.textContent)).toEqual([
      expect.stringContaining('需要输入'),
      expect.stringContaining('进行中'),
      expect.stringContaining('blank-s'),
      expect.stringContaining('已完成的工作'),
    ])
  })

  it('expands a bucket’s overflow when the chosen Session sits past the collapsed limit', async () => {
    const rows = Array.from({ length: 6 }, (_, index) => summary(`done-${index}`, 10 - index))
    const b = mount({ useSessions: hook(sessionState(rows)) })
    fireEvent.click(screen.getByRole('button', { name: '视图选项' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '按状态' }))
    expect(screen.queryByText('done-5')).toBeNull()
    rerender(b, { useSessions: hook(sessionState(rows, { current: sid('done-5') })) })
    await waitFor(() => { expect(screen.getByText('done-5')).toBeTruthy() })
  })

  it('expands a group on click and opens a session row', () => {
    const open = vi.fn()
    mount({
      useSessions: hook(sessionState([summary('alpha-s', 1)])),
      useWorkspaces: hook(workspaceState([workspace('alpha', ['alpha-s'])])),
      open,
    })
    fireEvent.click(screen.getByText('alpha'))
    fireEvent.click(screen.getByText('alpha-s'))
    expect(open).toHaveBeenCalledWith(sid('alpha-s'))
    // Collapse hides the row again.
    fireEvent.click(screen.getByText('alpha'))
    expect(screen.queryByText('alpha-s')).toBeNull()
  })

  it('shows five sessions by default and clears transient show-all when the Workspace collapses', () => {
    const items = Array.from({ length: 7 }, (_, index) => summary(`session-${index + 1}`, 7 - index))
    const b = mount({
      useSessions: hook(sessionState(items)),
      useWorkspaces: hook(workspaceState([workspace('alpha', items.map(item => item.id))])),
    })
    fireEvent.click(screen.getByText('alpha'))
    for (const item of items.slice(0, 5)) expect(screen.getByText(item.displayTitle)).toBeTruthy()
    expect(screen.queryByText('session-6')).toBeNull()
    expect(screen.queryByText('session-7')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '显示全部' }))
    expect(screen.getByText('session-6')).toBeTruthy()
    expect(screen.getByText('session-7')).toBeTruthy()
    expect(screen.getByRole('button', { name: '收起' })).toBeTruthy()

    fireEvent.click(screen.getByText('alpha'))
    expect(b.store.getSnapshot().groupExpansion).toEqual({ alpha: false })
    fireEvent.click(screen.getByText('alpha'))
    expect(b.store.getSnapshot().groupExpansion).toEqual({ alpha: true })
    expect(screen.queryByText('session-6')).toBeNull()
    expect(screen.getByRole('button', { name: '显示全部' })).toBeTruthy()
  })

  // Divergence: the blank promotion's order write is superseded by
  // reconciledSessionOrder (WorkspaceBrowser.tsx), so a just-prompted chat keeps
  // the account's stored position instead of moving to the front. Verified fix,
  // reverted: returning [...ordered, ...sessionIds.filter(…)] there makes this
  // case and the two promotion cases below pass with no other failure in the
  // package.
  it('folds a just-prompted chat with the ordinary rows while the blank New Session stays outside the quota', () => {
    const ordinary = Array.from({ length: 6 }, (_, index) => summary(`session-${index + 1}`, 6 - index))
    const blank = summary('blank', 7, { blank: true })
    const b = mount({
      useSessions: hook(sessionState([blank, ...ordinary], { current: blank.id })),
      useWorkspaces: hook(workspaceState([workspace('alpha', [blank.id, ...ordinary.map(item => item.id)])])),
    })
    // Still the blank New Session, the quota exempts it: six ordinary rows fold
    // to five, and the provisional row stays beside them.
    expect(screen.getByText('新会话')).toBeTruthy()
    for (const item of ordinary.slice(0, 5)) expect(screen.getByText(item.displayTitle)).toBeTruthy()
    expect(screen.queryByText('session-6')).toBeNull()
    expect(screen.getByRole('button', { name: '显示全部' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '显示全部' }))
    expect(screen.getByText('session-6')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '收起' }))
    expect(screen.queryByText('session-6')).toBeNull()

    // Its first prompt makes it an ordinary row: the account keeps it last, so
    // the fold takes the five leading rows and the just-prompted chat waits
    // behind the overflow control with the sixth.
    rerender(b, {
      useSessions: hook(sessionState([{ ...blank, blank: false }, ...ordinary], { current: blank.id })),
    })
    expect(b.store.getSnapshot().sessionOrderByAccount.alpha).toEqual([
      'session-1', 'session-2', 'session-3', 'session-4', 'session-5', 'session-6', 'blank',
    ])
    expect(screen.queryByText('blank')).toBeNull()
    expect(screen.getByText('session-5')).toBeTruthy()
    expect(screen.getByRole('button', { name: '显示全部' })).toBeTruthy()

    // Nothing is lost: the overflow control still reveals both hidden rows.
    fireEvent.click(screen.getByRole('button', { name: '显示全部' }))
    expect(screen.getByText('blank')).toBeTruthy()
    expect(screen.getByText('session-6')).toBeTruthy()
  })

  // Divergence: same cause as the case above — the account holds the blank last,
  // not first, so the collapsed drag starts from the boundary the fold renders
  // last. The drag policy it covers (boundaries follow rendered rows and the
  // source stays visible) is unchanged.
  it('anchors collapsed drags before hidden rows so the source stays visible, with the blank New Session ordered last', async () => {
    const ordinary = Array.from({ length: 6 }, (_, index) => summary(`session-${index + 1}`, 6 - index))
    const blank = summary('blank', 7, { blank: true })
    const insertSessionBefore = vi.fn(async () => {})
    const b = mount({
      useSessions: hook(sessionState([blank, ...ordinary], { current: blank.id })),
      useWorkspaces: hook(workspaceState([workspace('alpha', [blank.id, ...ordinary.map(item => item.id)])])),
      insertSessionBefore,
    })
    await waitFor(() => {
      expect(b.store.getSnapshot().sessionOrderByAccount.alpha)
        .toEqual(['session-1', 'session-2', 'session-3', 'session-4', 'session-5', 'session-6', 'blank'])
    })

    fireEvent.click(screen.getByRole('button', { name: '显示全部' }))
    const blankRow = screen.getByText('新会话').closest('[role="treeitem"]') as HTMLElement
    const session6 = screen.getByText('session-6').closest('[role="treeitem"]') as HTMLElement
    session6.getBoundingClientRect = () => ({
      top: 200, bottom: 234, left: 0, right: 200, width: 200, height: 34,
      x: 0, y: 200, toJSON: () => ({}),
    })
    fireEvent.dragStart(blankRow, { dataTransfer: dragData() })
    fireDrag(session6, 'drop', 230)
    // The blank was already last: the drop on the last row's lower half keeps
    // it there.
    expect(b.store.getSnapshot().sessionOrderByAccount.alpha)
      .toEqual(['session-1', 'session-2', 'session-3', 'session-4', 'session-5', 'session-6', 'blank'])

    insertSessionBefore.mockClear()
    fireEvent.click(screen.getByRole('button', { name: '收起' }))
    const collapsedBlank = screen.getByText('新会话').closest('[role="treeitem"]') as HTMLElement
    collapsedBlank.getBoundingClientRect = () => ({
      top: 200, bottom: 234, left: 0, right: 200, width: 200, height: 34,
      x: 0, y: 200, toJSON: () => ({}),
    })
    const session5 = screen.getByText('session-5').closest('[role="treeitem"]') as HTMLElement
    fireEvent.dragStart(session5, { dataTransfer: dragData() })
    fireDrag(collapsedBlank, 'drop', 205)
    expect(insertSessionBefore).not.toHaveBeenCalled()

    const session4 = screen.getByText('session-4').closest('[role="treeitem"]') as HTMLElement
    fireEvent.dragStart(session4, { dataTransfer: dragData() })
    fireDrag(collapsedBlank, 'drop', 205)
    expect(b.store.getSnapshot().sessionOrderByAccount.alpha)
      .toEqual(['session-1', 'session-2', 'session-3', 'session-5', 'session-4', 'session-6', 'blank'])
    expect(insertSessionBefore).toHaveBeenCalledWith(wid('alpha'), sid('session-4'), sid('session-6'))
    expect(screen.getByText('session-4')).toBeTruthy()
    expect(screen.queryByText('session-6')).toBeNull()
  })

  // Divergence: rows are draggable only while Manual is active
  // (drag={orderBy === 'manual' ? … : undefined}); status rows are never
  // draggable because their buckets hold activity order.
  it('shares one editable order across the order modes and promotes only while Last updated is active', async () => {
    const initial = sessionState([summary('one', 3), summary('two', 2)])
    const b = mount({
      useSessions: hook(initial),
      useWorkspaces: hook(workspaceState([workspace('alpha', ['two', 'one'])])),
    })
    fireEvent.click(screen.getByText('alpha'))
    fireEvent.click(screen.getByRole('button', { name: '视图选项' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '最近更新' }))
    await waitFor(() => {
      const rows = screen.getAllByRole('treeitem').slice(1)
      expect(rows[0]?.textContent).toContain('one')
      expect(rows[1]?.textContent).toContain('two')
    })
    // Last updated owns the sort, so its rows offer no drag of their own:
    // arranging is Manual's edit, and it edits this same account.
    expect(screen.getAllByRole('treeitem')[1]?.getAttribute('draggable')).toBe('false')

    fireEvent.click(screen.getByRole('button', { name: '视图选项' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '手动排序' }))
    expect(screen.getAllByRole('treeitem').slice(1)[0]?.textContent).toContain('one')

    const [one, two] = screen.getAllByRole('treeitem').slice(1) as [HTMLElement, HTMLElement]
    two.getBoundingClientRect = () => ({
      top: 150, bottom: 184, left: 0, right: 200, width: 200, height: 34, x: 0, y: 150, toJSON: () => ({}),
    })
    fireEvent.dragStart(one, { dataTransfer: dragData() })
    fireDrag(two, 'drop', 180)
    expect(b.store.getSnapshot().sessionOrderByAccount.alpha).toEqual(['two', 'one'])
    expect(screen.getAllByRole('treeitem').slice(1)[0]?.textContent).toContain('two')

    // User activity updates the timestamp baseline in Manual mode without
    // changing the shared visual order.
    const updated = sessionState([summary('one', 4), summary('two', 2)])
    rerender(b, { useSessions: hook(updated) })
    await waitFor(() => {
      expect(b.store.getSnapshot().sessionUpdatedAtByAccount.alpha).toEqual({ one: 4, two: 2 })
    })
    expect(b.store.getSnapshot().sessionOrderByAccount.alpha).toEqual(['two', 'one'])
    expect(screen.getAllByRole('treeitem').slice(1)[0]?.textContent).toContain('two')

    // Entering Last updated performs one complete recency sort.
    fireEvent.click(screen.getByRole('button', { name: '视图选项' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '最近更新' }))
    await waitFor(() => {
      expect(b.store.getSnapshot().sessionOrderByAccount.alpha).toEqual(['one', 'two'])
      expect(screen.getAllByRole('treeitem').slice(1)[0]?.textContent).toContain('one')
    })

    // A later user activity timestamp promotes that Session once while the
    // mode remains active.
    const promoted = sessionState([summary('one', 4), summary('two', 5)])
    rerender(b, { useSessions: hook(promoted) })
    await waitFor(() => {
      expect(b.store.getSnapshot().sessionOrderByAccount.alpha).toEqual(['two', 'one'])
      expect(screen.getAllByRole('treeitem').slice(1)[0]?.textContent).toContain('two')
    })

    b.view.unmount()
    const restored = mount({
      useSessions: hook(promoted),
      useWorkspaces: hook(workspaceState([workspace('alpha', ['two', 'one'])])),
    })
    expect(restored.store.getSnapshot().sessionOrderByAccount.alpha).toEqual(['two', 'one'])
    expect(screen.getAllByRole('treeitem').slice(1)[0]?.textContent).toContain('two')
  })

  it('archives a session from the row menu and hides archived rows in both modes', async () => {
    const archiveSession = vi.fn(async () => {})
    const b = mount({
      useSessions: hook(sessionState([summary('kept-s', 2), summary('gone-s', 1)])),
      useWorkspaces: hook(workspaceState([workspace('alpha', ['kept-s', 'gone-s'])])),
      archiveSession,
    })
    fireEvent.click(screen.getByText('alpha'))
    fireEvent.click(screen.getByRole('button', { name: '会话“gone-s”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '归档会话' }))
    expect(archiveSession).toHaveBeenCalledWith(sid('gone-s'))

    // The archive-set echo hides the row in both browsing modes.
    rerender(b, { useWorkspaces: hook(workspaceState([workspace('alpha', ['kept-s', 'gone-s'])], [sid('gone-s')])) })
    expect(screen.queryByText('gone-s')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '视图选项' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '按状态' }))
    expect(screen.getByText('kept-s')).toBeTruthy()
    expect(screen.queryByText('gone-s')).toBeNull()
  })

  it('names the Archived section through its bucket, not a Workspace title', () => {
    mount({
      useSessions: hook(sessionState([summary('kept-s', 1), summary('gone-s', 2)])),
      useWorkspaces: hook(workspaceState([workspace('alpha', ['kept-s', 'gone-s'])], [sid('gone-s')])),
    })
    fireEvent.click(screen.getByRole('button', { name: '视图选项' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '显示已归档' }))
    expect(screen.getByText('已归档的对话')).toBeTruthy()
  })

  it('logs and keeps the tree when the archive call rejects', async () => {
    const rejection = new Error('archive exploded')
    const archiveSession = vi.fn(async () => { throw rejection })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      mount({
        useSessions: hook(sessionState([summary('alpha-s', 1)])),
        useWorkspaces: hook(workspaceState([workspace('alpha', ['alpha-s'])])),
        archiveSession,
      })
      fireEvent.click(screen.getByText('alpha'))
      fireEvent.click(screen.getByRole('button', { name: '会话“alpha-s”的操作' }))
      fireEvent.click(screen.getByRole('menuitem', { name: '归档会话' }))
      await Promise.resolve()
      await Promise.resolve()
      expect(warn).toHaveBeenCalledWith('session archive rejected:', rejection)
      expect(screen.getByText('alpha-s')).toBeTruthy()
    } finally {
      warn.mockRestore()
    }
  })

  it('renders a fork child as a top-level row without a session twist', () => {
    const parent = summary('parent-s', 2)
    const child = { ...summary('child-s', 1), parentId: parent.id }
    mount({
      useSessions: hook(sessionState([parent, child])),
      useWorkspaces: hook(workspaceState([workspace('alpha', ['parent-s', 'child-s'])])),
    })
    fireEvent.click(screen.getByText('alpha'))
    expect(screen.getByText('child-s')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /展开|收起/ })).toBeNull()
    expect(screen.getByText('child-s').closest('[role="treeitem"]')?.getAttribute('draggable')).toBe('true')
  })

  it('expands the target group before starting a session from its New Session link', () => {
    const startSession = vi.fn()
    const b = mount({
      useSessions: hook(sessionState([summary('alpha-s', 1)])),
      useWorkspaces: hook(workspaceState([workspace('alpha', ['alpha-s'])])),
      startSession,
    })
    startSession.mockImplementation(() => {
      expect(b.store.getSnapshot().groupExpansion).toEqual({ alpha: true })
    })
    expect(screen.queryByText('alpha-s')).toBeNull()
    fireEvent.click(screen.getByRole('link', { name: '在“alpha”中新建会话' }))
    expect(b.store.getSnapshot().groupExpansion).toEqual({ alpha: true })
    expect(screen.getByText('alpha-s')).toBeTruthy()
    // The press runs the New Session flow for this Workspace without naming an
    // id: the flow reuses that Workspace's never-prompted chat before it
    // creates one, which is what keeps unsent text in front of the reader.
    expect(startSession).toHaveBeenCalledWith(wid('alpha'))
  })

  it('auto-expands the Ungrouped bucket for a loose current session; its header has no menu and no create link', () => {
    const startSession = vi.fn()
    mount({
      useSessions: hook(sessionState([summary('loose', 1)], { current: sid('loose') })),
      useWorkspaces: hook(workspaceState([workspace('alpha', [])])),
      startSession,
    })
    // The loose session's group is UNGROUPED_KEY: expanded by the effect.
    expect(screen.getByText('loose')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '工作区“未分组”的操作' })).toBeNull()
    expect(screen.queryByRole('link', { name: '在“未分组”中新建会话' })).toBeNull()
    expect(startSession).not.toHaveBeenCalled()
  })

  it('keeps an already-expanded group when the selection moves within it', () => {
    const first = sessionState([summary('a', 2), summary('b', 1)], { current: sid('a') })
    const b = mount({
      useSessions: hook(first),
      useWorkspaces: hook(workspaceState([workspace('alpha', ['a', 'b'])])),
    })
    expect(screen.getByText('a')).toBeTruthy()
    // Selection hop inside the same group: the effect re-runs and leaves the
    // expansion list unchanged (no duplicate key, group still open).
    rerender(b, { useSessions: hook({ ...first, current: sid('b') }) })
    expect(screen.getByText('b')).toBeTruthy()
    fireEvent.click(screen.getByText('alpha'))
    expect(screen.queryByText('b')).toBeNull()
  })

  it('keeps the blank selected by New Session at the head of its Workspace account', async () => {
    const items = [
      summary('old', 100),
      summary('blank', 150, { blank: true }),
      summary('mid', 200),
    ]
    const startSession = vi.fn()
    const b = mount({
      useSessions: hook(sessionState(items)),
      useWorkspaces: hook(workspaceState([workspace('alpha', ['old', 'blank', 'mid'])])),
      startSession,
    })
    await waitFor(() => {
      expect(b.store.getSnapshot().sessionOrderByAccount.alpha).toEqual(['old', 'blank', 'mid'])
    })
    startSession.mockImplementation(() => {
      rerender(b, { useSessions: hook(sessionState(items, { current: sid('blank') })) })
    })
    fireEvent.click(screen.getByRole('link', { name: '在“alpha”中新建会话' }))
    expect(startSession).toHaveBeenCalledWith(wid('alpha'))
    await waitFor(() => {
      // The promoted blank leads the account it was selected in.
      expect(b.store.getSnapshot().sessionOrderByAccount.alpha).toEqual(['blank', 'old', 'mid'])
    })
    expect(screen.getAllByRole('treeitem').map(row => row.textContent)).toEqual([
      expect.stringContaining('alpha'),
      expect.stringContaining('新会话'),
      expect.stringContaining('old'),
      expect.stringContaining('mid'),
    ])
  })

  // Divergence: as in the case above, the account keeps the blank where the
  // stored order puts it, so its promotion is not what holds the blank's
  // position. What the case covers — one order across the drag and the first
  // prompt, with no second reordering and the Host told where it went — is
  // unchanged.
  it('holds one order through a blank New Session\'s drag and first prompt, without reordering it again', async () => {
    const insertSessionBefore = vi.fn(async () => {})
    const b = mount({
      useSessions: hook(sessionState([
        summary('old', 100),
        summary('blank', 150, { blank: true }),
        summary('mid', 200),
      ], { current: sid('blank') })),
      useWorkspaces: hook(workspaceState([workspace('alpha', ['old', 'blank', 'mid'])])),
      insertSessionBefore,
    })
    await waitFor(() => {
      expect(b.store.getSnapshot().sessionOrderByAccount.alpha).toEqual(['old', 'mid', 'blank'])
    })
    const blank = screen.getByText('新会话').closest('[role="treeitem"]') as HTMLElement
    const old = screen.getByText('old').closest('[role="treeitem"]') as HTMLElement
    old.getBoundingClientRect = () => ({
      top: 150, bottom: 184, left: 0, right: 200, width: 200, height: 34, x: 0, y: 150, toJSON: () => ({}),
    })
    // The reader drags the blank row above "old": the arrangement is theirs now,
    // and the Host is told where it went.
    fireEvent.dragStart(blank, { dataTransfer: dragData() })
    fireDrag(old, 'drop', 155)
    expect(b.store.getSnapshot().sessionOrderByAccount.alpha).toEqual(['blank', 'old', 'mid'])
    expect(insertSessionBefore).toHaveBeenCalledWith(wid('alpha'), sid('blank'), sid('old'))

    // Its first prompt leaves that arrangement alone: nothing promotes it again.
    rerender(b, {
      useSessions: hook(sessionState([
        summary('old', 100),
        summary('blank', 150),
        summary('mid', 200),
      ], { current: sid('blank') })),
    })
    await waitFor(() => {
      expect(b.store.getSnapshot().sessionOrderByAccount.alpha).toEqual(['blank', 'old', 'mid'])
    })
    expect(screen.getAllByRole('treeitem').slice(1).map(row => row.textContent)).toEqual([
      expect.stringContaining('blank'),
      expect.stringContaining('old'),
      expect.stringContaining('mid'),
    ])
  })

  it('reveals a Session selected by address rather than through search', async () => {
    const sessions = sessionState([
      summary('newest-1', 6),
      summary('newest-2', 5),
      summary('newest-3', 4),
      summary('newest-4', 3),
      summary('newest-5', 2),
      summary('target', 1, { displayTitle: 'Needle session' , title: 'Needle session' }),
    ])
    const b = mount({
      useSessions: hook(sessions),
      useWorkspaces: hook(workspaceState([workspace('research', [...sessions.ids])])),
    })

    expect(screen.queryByText('Needle session')).toBeNull()
    expect(scrollIntoView).not.toHaveBeenCalled()

    // Back, Forward, and a pasted /c/<id> address all reach the browser this
    // way: the selection changes while search was never used.
    rerender(b, { useSessions: hook({ ...sessions, current: sid('target') }) })

    await waitFor(() => {
      expect(screen.getByText('Needle session')).toBeTruthy()
    })
    const targetRow = screen.getByText('Needle session').closest('[role="treeitem"]')
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
    expect(scrollIntoView.mock.instances.at(-1)).toBe(targetRow)
    expect(b.store.getSnapshot().groupExpansion).toEqual({ research: true })
  })

  it('rail add-workspace raises the directory flow in place, with no menu and no expansion', () => {
    const expandSidebar = vi.fn()
    mount(
      { wide: false, expandSidebar, useWorkspaces: hook(workspaceState([workspace('alpha', [])])) },
      { flowOccupied: true },
    )
    fireEvent.click(screen.getByRole('button', { name: '添加工作区' }))
    expect(expandSidebar).not.toHaveBeenCalled()
    // Adding is the header's only action, so the gesture IS that action: no
    // one-row popover, and existing workspaces stay in the tree below.
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'alpha' })).toBeNull()
    expect(screen.getByTestId('directory-flow')).toBeTruthy()
  })

  it('hides the add button when no directory-flow occupant is composed', () => {
    mount({
      useWorkspaces: hook(workspaceState([workspace('alpha', [])])),
    })
    // Nothing to add with, so the header offers no dead button.
    expect(screen.queryByRole('button', { name: '添加工作区' })).toBeNull()
    expect(screen.getByText('alpha')).toBeTruthy()
  })

  it('uses the full expanded Workspace section when resolving a Workspace drop half', () => {
    const insertWorkspaceBefore = vi.fn(async () => {})
    const sessions = sessionState(Array.from({ length: 5 }, (_, index) => summary(`beta-${index}`, index)))
    mount({
      useSessions: hook(sessions),
      useWorkspaces: hook(workspaceState([
        workspace('alpha', []),
        workspace('beta', sessions.ids),
        workspace('tail', []),
      ])),
      insertWorkspaceBefore,
    })
    fireEvent.click(screen.getByText('beta'))
    const source = screen.getByText('tail').closest('[role="treeitem"]') as HTMLElement
    let targetSection = screen.getByText('beta').closest('[role="treeitem"]')?.parentElement as HTMLElement
    while (targetSection.parentElement?.getAttribute('role') !== 'tree') {
      targetSection = targetSection.parentElement as HTMLElement
    }
    targetSection.getBoundingClientRect = () => ({
      top: 100, bottom: 300, left: 0, right: 200, width: 200, height: 200, x: 0, y: 100, toJSON: () => ({}),
    })
    fireEvent.dragStart(source, { dataTransfer: dragData() })
    // y=190 is below the header row but still in the top half of the whole
    // expanded section, so the target is before beta rather than after it.
    fireDrag(targetSection, 'drop', 190)
    expect(insertWorkspaceBefore).toHaveBeenCalledWith(wid('tail'), wid('beta'))
  })

  it('draws the first Workspace insertion boundary on the scroll container', () => {
    mount({
      useWorkspaces: hook(workspaceState([
        workspace('alpha', []),
        workspace('beta', []),
      ])),
    })
    const source = screen.getByText('beta').closest('[role="treeitem"]') as HTMLElement
    let firstSection = screen.getByText('alpha').closest('[role="treeitem"]')?.parentElement as HTMLElement
    while (firstSection.parentElement?.getAttribute('role') !== 'tree') {
      firstSection = firstSection.parentElement as HTMLElement
    }
    firstSection.getBoundingClientRect = () => ({
      top: 100, bottom: 134, left: 0, right: 200, width: 200, height: 34, x: 0, y: 100, toJSON: () => ({}),
    })
    fireEvent.dragStart(source, { dataTransfer: dragData() })
    fireDrag(firstSection, 'dragOver', 105)
    expect(firstSection.parentElement?.className).toContain('listTopDropActive')
    const marker = firstSection.parentElement?.previousElementSibling
    expect(marker?.className).toContain('listTopDropIndicator')
  })

  it('accepts a document-level drop and commits the last Workspace marker on drag end', () => {
    const insertWorkspaceBefore = vi.fn(async () => {})
    mount({
      useWorkspaces: hook(workspaceState([
        workspace('alpha', []),
        workspace('beta', []),
        workspace('tail', []),
      ])),
      insertWorkspaceBefore,
    })
    const source = screen.getByText('tail').closest('[role="treeitem"]') as HTMLElement
    let target = screen.getByText('beta').closest('[role="treeitem"]')?.parentElement as HTMLElement
    while (target.parentElement?.getAttribute('role') !== 'tree') {
      target = target.parentElement as HTMLElement
    }
    target.getBoundingClientRect = () => ({
      top: 100, bottom: 134, left: 0, right: 200, width: 200, height: 34, x: 0, y: 100, toJSON: () => ({}),
    })
    fireEvent.dragStart(source, { dataTransfer: dragData() })
    fireDrag(target, 'dragOver', 105)
    const outsideDrop = createEvent.drop(document.body)
    Object.defineProperty(outsideDrop, 'dataTransfer', { value: dragData() })
    fireEvent(document.body, outsideDrop)
    expect(outsideDrop.defaultPrevented).toBe(true)
    fireEvent.dragEnd(source)
    expect(insertWorkspaceBefore).toHaveBeenCalledWith(wid('tail'), wid('beta'))
  })

  it('drag reorder reports the anchor to insertSessionBefore and skips no-op drops', () => {
    const insertSessionBefore = vi.fn(async () => {})
    const sessions = sessionState([summary('one', 3), summary('two', 2), summary('three', 1)])
    mount({
      useSessions: hook(sessions),
      useWorkspaces: hook(workspaceState([workspace('alpha', ['one', 'two', 'three'])])),
      insertSessionBefore,
    })
    fireEvent.click(screen.getByText('alpha'))
    const rows = screen.getAllByRole('treeitem').slice(1) // drop the group header
    const [one, , three] = rows as [HTMLElement, HTMLElement, HTMLElement]
    three.getBoundingClientRect = () => ({
      top: 200, bottom: 234, left: 0, right: 200, width: 200, height: 34, x: 0, y: 200, toJSON: () => ({}),
    })
    const dataTransfer = dragData()
    fireEvent.dragStart(one, { dataTransfer })
    // Drop on the top half of "three": insert one before three.
    fireDrag(three, 'dragOver', 205)
    fireDrag(three, 'drop', 205)
    expect(insertSessionBefore).toHaveBeenCalledWith(wid('alpha'), sid('one'), sid('three'))

    // Dropping right back onto its own position is a no-op — top half
    // (anchor = itself) and bottom half (anchor = the next root) alike.
    fireEvent.dragStart(one, { dataTransfer })
    one.getBoundingClientRect = () => ({
      top: 100, bottom: 134, left: 0, right: 200, width: 200, height: 34, x: 0, y: 100, toJSON: () => ({}),
    })
    fireDrag(one, 'dragOver', 105)
    fireDrag(one, 'drop', 105)
    expect(insertSessionBefore).toHaveBeenCalledTimes(1)
    fireEvent.dragStart(one, { dataTransfer })
    fireDrag(one, 'drop', 130)
    expect(insertSessionBefore).toHaveBeenCalledTimes(1)
  })

  // Divergence: as above — Manual owns the drags, so the case re-enters Manual
  // before arranging again rather than dragging under Last updated.
  it('persists Ungrouped drag order while Manual is active, without writing a Host Workspace account', async () => {
    const insertSessionBefore = vi.fn(async () => {})
    const sessions = sessionState([summary('one', 3), summary('two', 2), summary('three', 1)])
    const b = mount({
      useSessions: hook(sessions),
      useWorkspaces: hook(workspaceState([])),
      insertSessionBefore,
    })
    fireEvent.click(screen.getByText('未分组'))

    const dragAfter = (sourceTitle: string, targetTitle: string): void => {
      const source = screen.getByText(sourceTitle).closest('[role="treeitem"]') as HTMLElement
      const target = screen.getByText(targetTitle).closest('[role="treeitem"]') as HTMLElement
      target.getBoundingClientRect = () => ({
        top: 150, bottom: 184, left: 0, right: 200, width: 200, height: 34, x: 0, y: 150, toJSON: () => ({}),
      })
      fireEvent.dragStart(source, { dataTransfer: dragData() })
      fireDrag(target, 'drop', 180)
    }

    dragAfter('one', 'three')
    expect(b.store.getSnapshot().sessionOrderByAccount[UNGROUPED_KEY]).toEqual(['two', 'three', 'one'])
    dragAfter('two', 'one')
    expect(b.store.getSnapshot().sessionOrderByAccount[UNGROUPED_KEY]).toEqual(['three', 'one', 'two'])
    expect(insertSessionBefore).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '视图选项' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '最近更新' }))
    await waitFor(() => {
      expect(b.store.getSnapshot().sessionOrderByAccount[UNGROUPED_KEY]).toEqual(['one', 'two', 'three'])
    })
    // Last updated replaced the arrangement with a recency sort; Manual takes
    // the drags again, over the same browser-local account.
    fireEvent.click(screen.getByRole('button', { name: '视图选项' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '手动排序' }))
    dragAfter('one', 'three')
    expect(b.store.getSnapshot().sessionOrderByAccount[UNGROUPED_KEY]).toEqual(['two', 'three', 'one'])
    expect(insertSessionBefore).not.toHaveBeenCalled()

    b.view.unmount()
    const restored = mount({
      useSessions: hook(sessions),
      useWorkspaces: hook(workspaceState([])),
      insertSessionBefore,
    })
    expect(restored.store.getSnapshot().sessionOrderByAccount[UNGROUPED_KEY]).toEqual(['two', 'three', 'one'])
    expect(screen.getAllByRole('treeitem').slice(1).map(row => row.textContent)).toEqual([
      expect.stringContaining('two'),
      expect.stringContaining('three'),
      expect.stringContaining('one'),
    ])
  })

  it('still sends the reorder when the dragged row left the group mid-drag', () => {
    const insertSessionBefore = vi.fn(async () => {})
    const sessions = sessionState([summary('one', 2), summary('two', 1)])
    const b = mount({
      useSessions: hook(sessions),
      useWorkspaces: hook(workspaceState([workspace('alpha', ['one', 'two'])])),
      insertSessionBefore,
    })
    fireEvent.click(screen.getByText('alpha'))
    const one = screen.getByText('one').closest('[role="treeitem"]') as HTMLElement
    fireEvent.dragStart(one, { dataTransfer: dragData() })
    // The host dropped "one" from the workspace account while the drag is in
    // flight: the source index is gone but the drop still resolves its anchor.
    rerender(b, { useWorkspaces: hook(workspaceState([workspace('alpha', ['two'])])) })
    const two = screen.getByText('two').closest('[role="treeitem"]') as HTMLElement
    two.getBoundingClientRect = () => ({
      top: 150, bottom: 184, left: 0, right: 200, width: 200, height: 34, x: 0, y: 150, toJSON: () => ({}),
    })
    fireDrag(two, 'drop', 155)
    expect(insertSessionBefore).toHaveBeenCalledWith(wid('alpha'), sid('one'), sid('two'))
  })

  it('drag end without a drop clears markers; bottom-half drop appends past the last row', () => {
    const insertSessionBefore = vi.fn(async () => {})
    const sessions = sessionState([summary('one', 2), summary('two', 1)])
    mount({
      useSessions: hook(sessions),
      useWorkspaces: hook(workspaceState([workspace('alpha', ['one', 'two'])])),
      insertSessionBefore,
    })
    fireEvent.click(screen.getByText('alpha'))
    const [one, two] = screen.getAllByRole('treeitem').slice(1) as [HTMLElement, HTMLElement]
    two.getBoundingClientRect = () => ({
      top: 150, bottom: 184, left: 0, right: 200, width: 200, height: 34, x: 0, y: 150, toJSON: () => ({}),
    })
    const dataTransfer = dragData()
    fireEvent.dragStart(one, { dataTransfer })
    fireEvent.dragEnd(one)
    // The drag ended: rows no longer accept drops.
    fireDrag(two, 'drop', 180)
    expect(insertSessionBefore).not.toHaveBeenCalled()

    // Bottom half of the last row: append (anchor omitted).
    fireEvent.dragStart(one, { dataTransfer })
    fireDrag(two, 'dragOver', 180)
    fireDrag(two, 'drop', 180)
    expect(insertSessionBefore).toHaveBeenCalledWith(wid('alpha'), sid('one'), undefined)
  })

  it('accepts a document-level drop and commits the last Session marker on drag end', () => {
    const insertSessionBefore = vi.fn(async () => {})
    mount({
      useSessions: hook(sessionState([summary('one', 2), summary('two', 1)])),
      useWorkspaces: hook(workspaceState([workspace('alpha', ['one', 'two'])])),
      insertSessionBefore,
    })
    fireEvent.click(screen.getByText('alpha'))
    const [one, two] = screen.getAllByRole('treeitem').slice(1) as [HTMLElement, HTMLElement]
    two.getBoundingClientRect = () => ({
      top: 150, bottom: 184, left: 0, right: 200, width: 200, height: 34, x: 0, y: 150, toJSON: () => ({}),
    })
    fireEvent.dragStart(one, { dataTransfer: dragData() })
    fireDrag(two, 'dragOver', 180)
    const outsideDrop = createEvent.drop(document.body)
    Object.defineProperty(outsideDrop, 'dataTransfer', { value: dragData() })
    fireEvent(document.body, outsideDrop)
    expect(outsideDrop.defaultPrevented).toBe(true)
    fireEvent.dragEnd(one)
    expect(insertSessionBefore).toHaveBeenCalledWith(wid('alpha'), sid('one'), undefined)
  })

  it('logs and keeps the order when the reorder call rejects', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const insertSessionBefore = vi.fn(async () => { throw new Error('stale anchor') })
      const sessions = sessionState([summary('one', 2), summary('two', 1)])
      mount({
        useSessions: hook(sessions),
        useWorkspaces: hook(workspaceState([workspace('alpha', ['one', 'two'])])),
        insertSessionBefore,
      })
      fireEvent.click(screen.getByText('alpha'))
      const [one, two] = screen.getAllByRole('treeitem').slice(1) as [HTMLElement, HTMLElement]
      two.getBoundingClientRect = () => ({
        top: 150, bottom: 184, left: 0, right: 200, width: 200, height: 34, x: 0, y: 150, toJSON: () => ({}),
      })
      const dataTransfer = dragData()
      fireEvent.dragStart(one, { dataTransfer })
      fireDrag(two, 'drop', 180)
      await waitFor(() => { expect(warn).toHaveBeenCalledWith('session reorder rejected:', expect.any(Error)) })
    } finally {
      warn.mockRestore()
    }
  })

  it('renames a workspace through the row menu dialog', async () => {
    let resolveRename!: () => void
    const renameWorkspace = vi.fn(() => new Promise<void>((resolve) => { resolveRename = resolve }))
    mount({
      useWorkspaces: hook(workspaceState([workspace('alpha', [], 'Alpha'), workspace('beta', [], 'Beta')])),
      renameWorkspace,
    })
    fireEvent.click(screen.getByRole('button', { name: '工作区“Alpha”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }))
    const input = screen.getByLabelText<HTMLInputElement>('工作区名称')
    expect(input.value).toBe('Alpha')
    // Unchanged and blank names stay blocked.
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '重命名' }).disabled).toBe(true)
    fireEvent.change(input, { target: { value: '   ' } })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '重命名' }).disabled).toBe(true)
    // A duplicate of another workspace's title shows the inline conflict.
    fireEvent.change(input, { target: { value: ' Beta ' } })
    expect(screen.getByRole('alert').textContent).toBe('已存在名为“Beta”的工作区。')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '重命名' }).disabled).toBe(true)
    fireEvent.change(input, { target: { value: 'Gamma' } })
    fireEvent.click(screen.getByRole('button', { name: '重命名' }))
    expect(renameWorkspace).toHaveBeenCalledWith(wid('alpha'), 'Gamma')
    // While renaming: input disabled, close blocked, Enter ignored.
    expect(input.disabled).toBe(true)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('dialog')).toBeTruthy()
    await act(async () => { resolveRename() })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('rename via Enter, failure surfaces the error, Cancel closes', async () => {
    const renameWorkspace = vi.fn(async () => { throw new Error('rename conflict') })
    mount({
      useWorkspaces: hook(workspaceState([workspace('alpha', [], 'Alpha')])),
      renameWorkspace,
    })
    fireEvent.click(screen.getByRole('button', { name: '工作区“Alpha”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }))
    const input = screen.getByLabelText<HTMLInputElement>('工作区名称')
    // Enter with a blocked draft (unchanged) does nothing.
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(renameWorkspace).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: 'Renamed' } })
    fireEvent.keyDown(input, { key: 'a' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(renameWorkspace).toHaveBeenCalledWith(wid('alpha'), 'Renamed')
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe('rename conflict') })
    // The dialog stays for retry; typing clears the error; Cancel closes.
    fireEvent.change(input, { target: { value: 'Renamed2' } })
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('reports non-Error rename failures as text', async () => {
    const renameWorkspace = vi.fn(async () => { throw 'denied' })
    mount({
      useWorkspaces: hook(workspaceState([workspace('alpha', [], 'Alpha')])),
      renameWorkspace,
    })
    fireEvent.click(screen.getByRole('button', { name: '工作区“Alpha”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }))
    fireEvent.change(screen.getByLabelText('工作区名称'), { target: { value: 'Other' } })
    fireEvent.click(screen.getByRole('button', { name: '重命名' }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe('denied') })
  })

  it('confirms Workspace deletion, explains retention, and blocks duplicate submission', async () => {
    let resolveDelete!: () => void
    const deleteWorkspace = vi.fn(() => new Promise<void>((resolve) => { resolveDelete = resolve }))
    const browser = mount({
      useWorkspaces: hook(workspaceState([workspace('alpha', ['session'], 'Alpha')])),
      deleteWorkspace,
    })
    fireEvent.click(screen.getByRole('button', { name: '工作区“Alpha”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '删除工作区' }))
    const dialog = screen.getByRole('dialog', { name: '删除工作区' })
    expect(dialog.textContent).toContain('将把“Alpha”从工作区列表中移除')
    expect(dialog.textContent).toContain('文件夹与会话记录会保留')
    expect(dialog.textContent).toContain('其会话将被归档')

    const confirm = screen.getByRole<HTMLButtonElement>('button', { name: '删除工作区' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    expect(deleteWorkspace).toHaveBeenCalledOnce()
    expect(deleteWorkspace).toHaveBeenCalledWith(wid('alpha'))
    expect(confirm.disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '取消' }).disabled).toBe(true)
    expect(screen.getByRole('status').textContent).toBe('正在删除工作区…')
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(screen.getByRole('dialog', { name: '删除工作区' })).toBeTruthy()
    await act(async () => { resolveDelete() })
    // RPC success alone does not close: the component waits until its
    // useWorkspaces projection has committed the removal, preventing a stale
    // Workspace frame from leaking into the next gesture.
    expect(screen.getByRole('dialog', { name: '删除工作区' })).toBeTruthy()
    rerender(browser, { useWorkspaces: hook(workspaceState([])) })
    expect(screen.queryByRole('dialog', { name: '删除工作区' })).toBeNull()
  })

  it('keeps the delete dialog open on failure and allows retry or cancellation', async () => {
    const deleteWorkspace = vi.fn()
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockRejectedValueOnce('denied')
    mount({
      useWorkspaces: hook(workspaceState([workspace('alpha', [], 'Alpha')])),
      deleteWorkspace,
    })
    fireEvent.click(screen.getByRole('button', { name: '工作区“Alpha”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '删除工作区' }))
    fireEvent.click(screen.getByRole('button', { name: '删除工作区' }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe('storage unavailable') })
    expect(screen.getByRole('dialog', { name: '删除工作区' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '删除工作区' }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe('denied') })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog', { name: '删除工作区' })).toBeNull()
  })

  it('Cancel, Escape, and Close dismiss deletion without calling the action', () => {
    const deleteWorkspace = vi.fn(async () => {})
    mount({
      useWorkspaces: hook(workspaceState([workspace('alpha', [], 'Alpha')])),
      deleteWorkspace,
    })
    const open = () => {
      fireEvent.click(screen.getByRole('button', { name: '工作区“Alpha”的操作' }))
      fireEvent.click(screen.getByRole('menuitem', { name: '删除工作区' }))
    }
    open()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    open()
    fireEvent.keyDown(document, { key: 'Escape' })
    open()
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(deleteWorkspace).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: '删除工作区' })).toBeNull()
  })

})
