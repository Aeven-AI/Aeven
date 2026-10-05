// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react'
import type { WorkspaceId } from '@aeven/api-workspace-controller/client'
import type { SessionId, SessionSeq } from '@aeven/session/types'
import { makeTranslate } from '@aeven/client-test-runtime'
import { zh as commonZh } from '@aeven/client-locale/src/locales/zh.ts'
import type { RowDragProps } from '../src/client/rows/Rows.tsx'
import { ProjectRowItem, SearchResultItem, SessionNodeItem } from '../src/client/rows/Rows.tsx'
import type { GroupNode, SearchResultNode, SessionNode } from '../src/client/tree.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(zh, commonZh) as never

const sid = (id: string) => id as SessionId
const wid = (id: string) => id as WorkspaceId

/** Half detection reads the row rect; jsdom rects are all-zero by default. */
function stubRect(row: HTMLElement): void {
  row.getBoundingClientRect = () => ({
    top: 100, bottom: 134, left: 0, right: 200, width: 200, height: 34,
    x: 0, y: 100, toJSON: () => ({}),
  })
}

function dragProps(overrides: Partial<RowDragProps> = {}): RowDragProps {
  return {
    start: vi.fn(), active: false, marker: null,
    hover: vi.fn(), drop: vi.fn(), end: vi.fn(),
    ...overrides,
  }
}

const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn() }

/** jsdom lacks DragEvent — the fireEvent fallback drops clientY, so pin it on the built event. */
function fireDrag(row: HTMLElement, kind: 'dragOver' | 'drop', clientY: number): void {
  const event = kind === 'dragOver' ? createEvent.dragOver(row) : createEvent.drop(row)
  Object.defineProperty(event, 'clientY', { value: clientY })
  Object.defineProperty(event, 'dataTransfer', { value: { ...dataTransfer } })
  fireEvent(row, event)
}

describe('workspace browser rows', () => {
  it('keeps the New Session label on a session whose durable title has not arrived', () => {
    // The reported row: a session whose first prompt has landed but whose
    // title the list has not resolved yet used to switch from the New Session
    // label to an untitled one mid-flight, then to the generated title. It now
    // holds the label it was created with, and never shows its id.
    const untitled: SessionNode = {
      id: sid('untitled'), title: 'untitled', blank: false, untitled: true, running: false,
      runningSubagentCount: 0, runningJobCount: 0, completed: false, hasActiveSchedule: false, createdAt: 0, updatedAt: 0,
    }
    render(<SessionNodeItem node={untitled} currentId={undefined} onOpen={vi.fn()}
      onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} t={t} />)
    expect(screen.getByText('新会话')).toBeTruthy()
    expect(screen.queryByText('untitled')).toBeNull()
  })

  it('omits only an empty leading status slot in the hierarchy-free flat list', () => {
    const idle: SessionNode = {
      id: sid('flat'), title: 'Flat Session', blank: false, untitled: false, running: false,
      runningSubagentCount: 0, runningJobCount: 0, completed: false, hasActiveSchedule: false, createdAt: 0, updatedAt: 0,
    }
    const view = render(<SessionNodeItem node={idle} currentId={undefined} onOpen={vi.fn()}
      onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} t={t} />)
    const title = screen.getByText('Flat Session')
    expect(title.previousElementSibling).toBeNull()

    view.rerender(<SessionNodeItem node={{ ...idle, running: true }} currentId={undefined}
      onOpen={vi.fn()} onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} t={t} />)
    expect(screen.getByText('Flat Session').previousElementSibling?.querySelector('[data-state="ongoing"]')).toBeTruthy()
  })

  it('renders a selected content-search row and opens only its session', () => {
    const onOpen = vi.fn()
    const result: SearchResultNode = {
      id: sid('result'),
      title: 'Result title',
      untitled: false,
      workspace: 'Workspace context',
      running: true,
      runningSubagentCount: 0, runningJobCount: 0,
      completed: false,
      hasActiveSchedule: false,
      matchSeq: 12 as SessionSeq,
      snippet: 'matching message excerpt',
    }
    render(<SearchResultItem result={result} currentId={result.id} onOpen={onOpen} t={t} />)
    const row = screen.getByRole('treeitem')
    expect(row.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('Workspace context')).toBeTruthy()
    expect(screen.getByText('matching message excerpt')).toBeTruthy()
    expect(row.querySelector('[data-state="ongoing"]')).toBeTruthy()
    expect(screen.getByText('进行中')).toBeTruthy()
    expect(row.hasAttribute('draggable')).toBe(false)
    fireEvent.click(row)
    // The matched event travels with the open: the transcript needs it to land
    // on the message the snippet came from.
    expect(onOpen).toHaveBeenCalledWith(result.id, 12)
  })

  it('keeps the New Session label on a title-less search row instead of its id', () => {
    // A content match inside a chat that has no durable title yet: the row used
    // to render the identity fallback the data layer resolves, so searching
    // surfaced a raw `session-<uuid>` where the navigation says New Session.
    const result: SearchResultNode = {
      id: sid('session-0f1e'), title: 'session-0f1e', untitled: true, workspace: 'Project',
      running: false, runningSubagentCount: 0, runningJobCount: 0, completed: false,
      hasActiveSchedule: false, matchSeq: 4 as SessionSeq, snippet: 'three primary colors',
    }
    render(<SearchResultItem result={result} currentId={undefined} onOpen={vi.fn()} t={t} />)
    expect(screen.getByText('新会话')).toBeTruthy()
    expect(screen.queryByText('session-0f1e')).toBeNull()
  })

  it('keeps the active-Schedule marker after a search title and inside the row action', () => {
    const onOpen = vi.fn()
    const result: SearchResultNode = {
      id: sid('scheduled-result'), title: 'Scheduled result', untitled: false, workspace: 'Project',
      running: false, runningSubagentCount: 0, runningJobCount: 0, completed: false, hasActiveSchedule: true,
    }
    render(<SearchResultItem result={result} currentId={undefined} onOpen={onOpen} t={t} />)

    const row = screen.getByRole('treeitem')
    const title = screen.getByText('Scheduled result')
    const indicator = screen.getByRole('img', { name: '有活动定时任务' })
    expect(title.nextElementSibling).toBe(indicator)
    expect(indicator.getAttribute('title')).toBe('有活动定时任务')
    expect(indicator.getAttribute('tabindex')).toBeNull()
    expect(row.querySelectorAll('button')).toHaveLength(0)

    fireEvent.click(indicator)
    expect(onOpen).toHaveBeenCalledWith(result.id, undefined)
  })

  it.each([
    ['approval', '等待审批'],
    ['plan-review', '计划待审'],
    ['question', '等待回答'],
  ] as const)('shows %s ahead of running in search results', (pendingInteraction, label) => {
    const result: SearchResultNode = {
      id: sid(pendingInteraction), title: 'Needs input', untitled: false, workspace: 'Project',
      pendingInteraction, running: true, runningSubagentCount: 0, runningJobCount: 0, completed: false,
      hasActiveSchedule: false,
    }
    render(<SearchResultItem result={result} currentId={undefined} onOpen={vi.fn()} t={t} />)
    const row = screen.getByRole('treeitem')
    expect(row.querySelector('[data-state="warning"]')).toBeTruthy()
    expect(row.querySelector('[data-state="ongoing"]')).toBeNull()
    expect(screen.getByText(label)).toBeTruthy()
  })

  it('addresses a Workspace row\'s New Session action as a link the browser can open in a new window', () => {
    const onToggle = vi.fn()
    const onCreate = vi.fn()
    let minted = 0
    const newSessionHref = () => {
      minted += 1
      return { href: `/c/new-${minted}`, sessionId: sid(`session-new-${minted}`) }
    }
    const group: GroupNode = {
      key: 'project', workspaceId: wid('project'), isDefault: false, cwd: '/projects/project', createdAt: 0, label: 'Project',
      sessionCount: 1, expanded: true, containsCurrent: true, sessions: [],
    }
    render(
      <ProjectRowItem group={group} onToggle={onToggle} newSessionHref={newSessionHref} onCreate={onCreate} t={t} />,
    )

    expect(screen.getByRole('treeitem').getAttribute('aria-expanded')).toBe('true')
    // The create control is a real anchor on a New Session address, in the same
    // shape the address bar uses: a real href is the only thing that gives the
    // browser's context menu an "Open link in new window" to offer. The id it
    // names is what a browser-owned open starts, not what the plain press opens.
    const link = screen.getByRole('link', { name: '在“Project”中新建会话' })
    expect(link.getAttribute('href')).toBe('/c/new-1')
    // The press belongs to the row's own reorder drag, not to the browser's link drag.
    expect(link.getAttribute('draggable')).toBe('false')
    // A plain press is the SPA's: it starts the New Session — the flow reuses
    // the Workspace's never-prompted chat before it creates one, so unsent text
    // comes back with it — and cancelling the default action is what keeps the
    // browser from following the href out of the page.
    const press = createEvent.click(link)
    fireEvent(link, press)
    expect(press.defaultPrevented).toBe(true)
    expect(onCreate).toHaveBeenCalledOnce()
    // The link then names the fresh chat a browser-owned open would start.
    expect(link.getAttribute('href')).toBe('/c/new-2')
    // The row's own click owns the fold toggle: the create action never reaches it.
    expect(onToggle).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Project'))
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it('leaves every non-plain press on a Workspace row\'s New Session link to the browser', () => {
    const onCreate = vi.fn()
    const group: GroupNode = {
      key: 'project', workspaceId: wid('project'), isDefault: false, cwd: '/projects/project', createdAt: 0, label: 'Project',
      sessionCount: 0, expanded: false, containsCurrent: false, sessions: [],
    }
    render(
      <ProjectRowItem
        group={group} onToggle={vi.fn()} onCreate={onCreate} t={t}
        newSessionHref={() => ({ href: '/c/new-1', sessionId: sid('session-new-1') })}
      />,
    )

    // Middle click, Cmd/Ctrl/Shift/Alt-click and the context menu's own items
    // each mean "somewhere else". Intercepting them would start the chat in
    // place as well as in the window the reader asked for, and would cancel the
    // navigation that window depends on.
    const link = screen.getByRole('link', { name: '在“Project”中新建会话' })
    for (const modifier of [
      { button: 1 }, { metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true },
    ]) {
      const press = createEvent.click(link, modifier)
      fireEvent(link, press)
      expect(press.defaultPrevented).toBe(false)
    }
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('renders and opens a selected running Session row', () => {
    const node: SessionNode = {
      id: sid('session'), title: 'Session', blank: false, untitled: false, running: true,
      runningSubagentCount: 0, runningJobCount: 0, completed: false, hasActiveSchedule: false, createdAt: 0, updatedAt: 0,
    }
    const onOpen = vi.fn()
    render(
      <SessionNodeItem node={node} currentId={node.id} onOpen={onOpen}
        onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} t={t} />,
    )

    const row = screen.getByRole('treeitem')
    expect(row.getAttribute('aria-selected')).toBe('true')
    expect(row.hasAttribute('aria-expanded')).toBe(false)
    expect(screen.queryByRole('button', { name: /展开|收起/ })).toBeNull()
    fireEvent.click(row)
    expect(onOpen).toHaveBeenCalledWith(node.id)
  })

  it('addresses a Session row as a link the browser can open in a new window', () => {
    const node: SessionNode = {
      id: sid('session-abc-123'), title: 'Story', blank: false, untitled: false, running: false,
      runningSubagentCount: 0, runningJobCount: 0, completed: false, hasActiveSchedule: false, createdAt: 0, updatedAt: 0,
    }
    const onOpen = vi.fn()
    const view = render(
      <SessionNodeItem node={node} currentId={undefined} onOpen={onOpen}
        onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} t={t} />,
    )

    // The row's content is a real anchor on the Session's own address, in the
    // same shape the address bar uses (the leading `session-` dropped), because
    // a real href is the only thing that gives the browser's context menu an
    // "Open link in new window" to offer.
    const link = screen.getByRole('link', { name: /Story/ })
    expect(link.getAttribute('href')).toBe('/c/abc-123')
    // A press on the link is not the browser's navigation to make: the SPA
    // opens the Session in place, and cancelling the default action is what
    // keeps the page from following the href.
    const press = createEvent.click(link)
    fireEvent(link, press)
    expect(press.defaultPrevented).toBe(true)
    expect(onOpen).toHaveBeenCalledWith(node.id)
    // The actions menu stays outside the link: interactive content may not
    // nest inside an anchor, and its own press already stops there.
    expect(link.contains(view.getByRole('button', { name: '会话“Story”的操作' }))).toBe(false)
  })

  it('leaves every non-plain press on a Session row to the browser', () => {
    const node: SessionNode = {
      id: sid('session-abc-123'), title: 'Story', blank: false, untitled: false, running: false,
      runningSubagentCount: 0, runningJobCount: 0, completed: false, hasActiveSchedule: false, createdAt: 0, updatedAt: 0,
    }
    const onOpen = vi.fn()
    render(
      <SessionNodeItem node={node} currentId={undefined} onOpen={onOpen}
        onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} t={t} />,
    )

    // Middle click, Cmd/Ctrl/Shift/Alt-click and the context menu's own items
    // each mean "somewhere else". Intercepting them would open the Session in
    // place as well as in the window the reader asked for, and would cancel the
    // navigation that window depends on.
    const row = screen.getByRole('treeitem')
    for (const modifier of [
      { button: 1 }, { metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true },
    ]) {
      const press = createEvent.click(row, modifier)
      fireEvent(row, press)
      expect(press.defaultPrevented).toBe(false)
    }
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('keeps the active-Schedule marker between the title and time in grouped and flat rows', () => {
    const onOpen = vi.fn()
    const node: SessionNode = {
      id: sid('scheduled-session'), title: 'Scheduled Session', blank: false, untitled: false, running: false,
      runningSubagentCount: 0, runningJobCount: 0, completed: false, hasActiveSchedule: true, createdAt: 0, updatedAt: 0,
    }
    const view = render(
      <SessionNodeItem node={node} currentId={undefined} onOpen={onOpen}
        onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} t={t} />,
    )

    const assertIndicator = (): HTMLElement => {
      const title = screen.getByText('Scheduled Session')
      const time = screen.getByText('刚刚')
      const indicator = screen.getByRole('img', { name: '有活动定时任务' })
      expect(title.nextElementSibling).toBe(indicator)
      expect(indicator.nextElementSibling).toBe(time)
      expect(indicator.getAttribute('title')).toBe('有活动定时任务')
      expect(indicator.getAttribute('tabindex')).toBeNull()
      return indicator
    }

    fireEvent.click(assertIndicator())
    expect(onOpen).toHaveBeenCalledWith(node.id)

    view.rerender(
      <SessionNodeItem node={node} currentId={undefined} onOpen={onOpen}
        onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} t={t} />,
    )
    assertIndicator()
  })

  it('shows the green done dot only on a finished, unviewed session (live activity wins the slot)', () => {
    const renderRow = (over: Partial<SessionNode>) => render(
      <SessionNodeItem
        node={{
          id: sid('s1'), title: 'One', blank: false, untitled: false, running: false,
          runningSubagentCount: 0, runningJobCount: 0, completed: false, hasActiveSchedule: false, createdAt: 0, updatedAt: 0, ...over,
        }}
        currentId={undefined} onOpen={vi.fn()}
        onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} t={t}
      />,
    )
    const stateDot = (view: ReturnType<typeof renderRow>) =>
      view.container.querySelector('[data-state]')
    // No completion reminder, not running: no state dot at all.
    const plain = renderRow({})
    expect(stateDot(plain)).toBeNull()
    plain.unmount()
    // Completed while unviewed: the green done dot.
    const done = renderRow({ completed: true })
    expect(done.container.querySelector('[data-state="done"]')).not.toBeNull()
    done.unmount()
    // Running wins the slot: the animated ongoing dot, no done dot.
    const running = renderRow({ completed: true, running: true })
    expect(running.container.querySelector('[data-state="ongoing"]')).not.toBeNull()
    expect(running.container.querySelector('[data-state="done"]')).toBeNull()
    running.unmount()
    // Descendant activity also wins until the last running descendant stops.
    const delegated = renderRow({ completed: true, runningSubagentCount: 1 })
    expect(delegated.container.querySelector('[data-state="ongoing"]')).not.toBeNull()
    expect(delegated.container.querySelector('[data-state="done"]')).toBeNull()
  })

  it('shows descendant activity without describing an idle parent as running', () => {
    vi.useFakeTimers()
    try {
      const node: SessionNode = {
        id: sid('owner'), title: 'Delegating', blank: false, untitled: false, running: false,
        runningSubagentCount: 2, runningJobCount: 0, completed: false, hasActiveSchedule: false, createdAt: 0, updatedAt: 0,
      }
      render(<SessionNodeItem node={node} currentId={undefined} onOpen={vi.fn()}
        onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} t={t} />)
      const row = screen.getByRole('treeitem')
      expect(row.querySelector('[data-state="ongoing"]')).not.toBeNull()
      expect(screen.getByText('2 个子代理运行中')).toBeTruthy()
      expect(screen.queryByText('进行中')).toBeNull()

      fireEvent.pointerEnter(row.parentElement as HTMLElement)
      act(() => { vi.advanceTimersByTime(500) })
      expect(screen.getAllByText('2 个子代理运行中')).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps descendant activity secondary while the parent is running', () => {
    vi.useFakeTimers()
    try {
      const node: SessionNode = {
        id: sid('owner'), title: 'Delegating', blank: false, untitled: false, running: true,
        runningSubagentCount: 1, runningJobCount: 0, completed: false, hasActiveSchedule: false, createdAt: 0, updatedAt: 0,
      }
      render(<SessionNodeItem node={node} currentId={undefined} onOpen={vi.fn()}
        onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} t={t} />)
      const row = screen.getByRole('treeitem')
      expect(row.querySelectorAll('[data-state="ongoing"]')).toHaveLength(1)
      expect(screen.getByText('进行中')).toBeTruthy()
      expect(screen.getByText('1 个子代理运行中')).toBeTruthy()

      fireEvent.pointerEnter(row.parentElement as HTMLElement)
      act(() => { vi.advanceTimersByTime(500) })
      expect(screen.getAllByText('进行中')).toHaveLength(2)
      expect(screen.getAllByText('1 个子代理运行中')).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps child activity as a secondary status while user attention is primary', () => {
    const node: SessionNode = {
      id: sid('owner'), title: 'Needs input', blank: false, untitled: false, pendingInteraction: 'question',
      running: false, runningSubagentCount: 1, runningJobCount: 0, completed: false, hasActiveSchedule: false, createdAt: 0, updatedAt: 0,
    }
    render(<SessionNodeItem node={node} currentId={undefined} onOpen={vi.fn()}
      onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} t={t} />)
    const row = screen.getByRole('treeitem')
    expect(row.querySelector('[data-state="warning"]')).not.toBeNull()
    expect(row.querySelector('[data-state="ongoing"]')).toBeNull()
    expect(screen.getByText('等待回答')).toBeTruthy()
    expect(screen.getByText('1 个子代理运行中')).toBeTruthy()
  })

  it('keeps job activity visible while the Session sits between turns', () => {
    // The reported row: a background job keeps working after the turn that
    // started it ends, and the row read as finished — no spinner — while the
    // job was still running.
    const node: SessionNode = {
      id: sid('jobs'), title: 'Benchmarking', blank: false, untitled: false, running: false,
      runningSubagentCount: 0, runningJobCount: 1, completed: true, hasActiveSchedule: false, createdAt: 0, updatedAt: 0,
    }
    render(<SessionNodeItem node={node} currentId={undefined} onOpen={vi.fn()}
      onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} t={t} />)
    // The job carries the status: the mark it selects is the loading glyph, and
    // the reminder the ended turn armed is not what the row reports.
    // The row's status mark is asserted by the live spinner check; here the
    // status text is the handle this markup exposes.
    expect(screen.getByText('1 个任务进行中')).toBeTruthy()
    expect(screen.queryByText('已完成')).toBeNull()
    expect(screen.queryByText('空闲')).toBeNull()
    // The job is the reason the row spins: an idle Agent is still not reported
    // as running.
    expect(screen.queryByText('进行中')).toBeNull()
  })

  it('keeps job activity secondary while the parent is running', () => {
    const node: SessionNode = {
      id: sid('jobs'), title: 'Benchmarking', blank: false, untitled: false, running: true,
      runningSubagentCount: 0, runningJobCount: 2, completed: false, hasActiveSchedule: false, createdAt: 0, updatedAt: 0,
    }
    render(<SessionNodeItem node={node} currentId={undefined} onOpen={vi.fn()}
      onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} t={t} />)
    expect(screen.getByText('进行中')).toBeTruthy()
    expect(screen.getByText('2 个任务进行中')).toBeTruthy()
  })

  it('shows the green done dot on a finished search result row', () => {
    render(<SearchResultItem
      result={{
        id: sid('result'), title: 'Done', untitled: false, workspace: 'Workspace', running: false,
        runningSubagentCount: 0, runningJobCount: 0, completed: true, hasActiveSchedule: false,
      }}
      currentId={undefined} onOpen={vi.fn()} t={t}
    />)
    expect(screen.getByRole('treeitem').querySelector('[data-state="done"]')).not.toBeNull()
  })

  it('workspace row menu opens on the ellipsis, renames, and shows the danger delete row', () => {
    const onRename = vi.fn()
    const onDelete = vi.fn()
    const onToggle = vi.fn()
    const group: GroupNode = {
      key: 'project', workspaceId: wid('project'), isDefault: false, cwd: '/projects/project', createdAt: 0, label: 'Project',
      sessionCount: 0, expanded: false, containsCurrent: false, sessions: [],
    }
    render(<ProjectRowItem
      group={group} onToggle={onToggle} onCreate={vi.fn()}
      newSessionHref={() => ({ href: '/c/new-1', sessionId: sid('session-new-1') })}
      actions={{ rename: onRename, delete: onDelete }} t={t}
    />)
    fireEvent.click(screen.getByRole('button', { name: '工作区“Project”的操作' }))
    // Opening the menu neither toggles the group nor renames yet.
    expect(onToggle).not.toHaveBeenCalled()
    expect(screen.getByRole('menuitem', { name: '删除工作区' }).className).toMatch(/danger/)
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }))
    expect(onRename).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '工作区“Project”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '删除工作区' }))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(onRename).toHaveBeenCalledOnce()
    expect(onDelete).toHaveBeenCalledOnce()
    // Escape closes without selecting (Menu onClose path).
    fireEvent.click(screen.getByRole('button', { name: '工作区“Project”的操作' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('ungrouped bucket renders no workspace menu and no create control', () => {
    const group: GroupNode = {
      key: '', workspaceId: undefined, isDefault: false, cwd: undefined, createdAt: undefined, label: 'Ungrouped',
      sessionCount: 0, expanded: false, containsCurrent: false, sessions: [],
    }
    const newSessionHref = vi.fn(() => ({ href: '/c/new-1', sessionId: sid('session-new-1') }))
    render(<ProjectRowItem group={group} onToggle={vi.fn()} newSessionHref={newSessionHref} onCreate={vi.fn()} t={t} />)
    expect(screen.queryByRole('button', { name: /工作区/ })).toBeNull()
    // No Workspace to start in means no chat to name: the bucket carries no
    // control rather than a link that would open a chat somewhere else.
    expect(screen.queryByRole('link', { name: /新建会话/ })).toBeNull()
    expect(newSessionHref).not.toHaveBeenCalled()
  })

  it('blank New Session rows carry no menu, no time label, and no hover-card time', () => {
    vi.useFakeTimers()
    try {
      const node: SessionNode = {
        id: sid('s-blank'), title: 'ignored', blank: true, untitled: false, running: false,
        runningSubagentCount: 0, runningJobCount: 0, completed: false, hasActiveSchedule: false, createdAt: 0, updatedAt: 0,
      }
      render(<SessionNodeItem node={node} currentId={node.id} onOpen={vi.fn()}
        onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} t={t} />)
      // The placeholder has no content yet: no row verbs, no "now" stamp.
      expect(screen.queryByRole('button', { name: /会话.*的操作/ })).toBeNull()
      expect(screen.queryByText('刚刚')).toBeNull()
      // The hover card keeps title + status but drops the timestamp line.
      const wrapper = screen.getByRole('treeitem').parentElement as HTMLElement
      fireEvent.pointerEnter(wrapper)
      act(() => { vi.advanceTimersByTime(500) })
      expect(screen.getAllByText('新会话').length).toBeGreaterThanOrEqual(2)
      expect(screen.getByText('空闲')).toBeTruthy()
      expect(screen.queryByText('刚刚')).toBeNull()
      expect(screen.getByText('空闲').closest('[role="button"]')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('session row menu opens without opening the session and dispatches rename, fork, and archive', () => {
    const onOpen = vi.fn()
    const onRename = vi.fn()
    const onFork = vi.fn()
    const onArchive = vi.fn()
    const node: SessionNode = {
      id: sid('s1'), title: 'One', blank: false, untitled: false, running: false,
      runningSubagentCount: 0, runningJobCount: 0, completed: false, hasActiveSchedule: false, createdAt: 0, updatedAt: 0,
    }
    render(<SessionNodeItem node={node} currentId={undefined} onOpen={onOpen}
      onRename={onRename} onFork={onFork} onArchive={onArchive} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: '会话“One”的操作' }))
    expect(onOpen).not.toHaveBeenCalled()
    // Archive is not destructive (log and accounting slot remain): no danger styling.
    expect(screen.getByRole('menuitem', { name: '归档会话' }).className).not.toMatch(/danger/)
    // Rename dispatches with the current display title (dialog prefill).
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(onRename).toHaveBeenCalledWith(node.id, 'One')
    expect(onOpen).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '会话“One”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '分叉会话' }))
    expect(onFork).toHaveBeenCalledWith(node.id)
    // Archive dispatches without opening the session.
    fireEvent.click(screen.getByRole('button', { name: '会话“One”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '归档会话' }))
    expect(onArchive).toHaveBeenCalledWith(node.id)
    expect(onRename).toHaveBeenCalledOnce()
    expect(onOpen).not.toHaveBeenCalled()
    // Escape closes without selecting (Menu onClose path).
    fireEvent.click(screen.getByRole('button', { name: '会话“One”的操作' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })


  it('shows the hover card after the dwell and suppresses it while the row menu is open', () => {
    vi.useFakeTimers()
    try {
      const node: SessionNode = {
        id: sid('s1'), title: 'Hovered', blank: false, untitled: false, running: true,
        runningSubagentCount: 0, runningJobCount: 0, completed: false, hasActiveSchedule: false, createdAt: 0, updatedAt: 0,
      }
      render(<SessionNodeItem node={node} currentId={undefined} onOpen={vi.fn()}
        onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} t={t} />)
      const wrapper = screen.getByRole('treeitem').parentElement as HTMLElement
      fireEvent.pointerEnter(wrapper)
      act(() => { vi.advanceTimersByTime(500) })
      // Card body: full title + relative time + running status.
      expect(screen.getAllByText('Hovered')).toHaveLength(2)
      expect(screen.getByText('1分钟前')).toBeTruthy()
      expect(screen.getAllByText('进行中')).toHaveLength(2)
      fireEvent.pointerLeave(wrapper)
      // Menu open (disabled=true) suppresses the card for the same hover.
      fireEvent.click(screen.getByRole('button', { name: '会话“Hovered”的操作' }))
      fireEvent.pointerEnter(wrapper)
      act(() => { vi.advanceTimersByTime(1000) })
      expect(screen.queryByText('1分钟前')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    ['approval', '等待审批'],
    ['plan-review', '计划待审'],
    ['question', '等待回答'],
  ] as const)('shows %s as warning ahead of the running state', (pendingInteraction, label) => {
    vi.useFakeTimers()
    try {
      const node: SessionNode = {
        id: sid(pendingInteraction), title: 'Needs input', blank: false, untitled: false,
        pendingInteraction, running: true, runningSubagentCount: 0, runningJobCount: 0, completed: false,
        hasActiveSchedule: false, createdAt: 0, updatedAt: 0,
      }
      const view = render(<SessionNodeItem node={node} currentId={undefined} onOpen={vi.fn()}
        onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} t={t} />)
      const row = screen.getByRole('treeitem')
      expect(row.querySelector('[data-state="warning"]')).toBeTruthy()
      expect(row.querySelector('[data-state="ongoing"]')).toBeNull()
      expect(screen.getByText(label)).toBeTruthy()

      view.rerender(<SessionNodeItem node={{ ...node, running: false }} currentId={undefined}
        onOpen={vi.fn()} onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} t={t} />)
      expect(screen.getByRole('treeitem').querySelector('[data-state="warning"]')).toBeTruthy()

      fireEvent.pointerEnter(screen.getByRole('treeitem').parentElement as HTMLElement)
      act(() => { vi.advanceTimersByTime(500) })
      expect(screen.getAllByText(label)).toHaveLength(2)
      expect(document.querySelectorAll('[data-state="warning"]')).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('idle hover card shows the Idle status line', () => {
    vi.useFakeTimers()
    try {
      const node: SessionNode = {
        id: sid('s1'), title: 'Quiet', blank: false, untitled: false, running: false,
        runningSubagentCount: 0, runningJobCount: 0, completed: false, hasActiveSchedule: false, createdAt: 0, updatedAt: 0,
      }
      render(<SessionNodeItem node={node} currentId={undefined} onOpen={vi.fn()}
        onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} t={t} />)
      fireEvent.pointerEnter(screen.getByRole('treeitem').parentElement as HTMLElement)
      act(() => { vi.advanceTimersByTime(500) })
      expect(screen.getByText('空闲')).toBeTruthy()
      expect(screen.getAllByText('刚刚')).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('completed hover card shows the Completed status line', () => {
    vi.useFakeTimers()
    try {
      const node: SessionNode = {
        id: sid('s1'), title: 'Done', blank: false, untitled: false, running: false,
        runningSubagentCount: 0, runningJobCount: 0, completed: true, hasActiveSchedule: false, createdAt: 0, updatedAt: 0,
      }
      render(<SessionNodeItem node={node} currentId={undefined} onOpen={vi.fn()}
        onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} t={t} />)
      fireEvent.pointerEnter(screen.getByRole('treeitem').parentElement as HTMLElement)
      act(() => { vi.advanceTimersByTime(500) })
      // Row's visually-hidden reminder label plus the hover card's status line.
      expect(screen.getAllByText('已完成')).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('draggable row wires start/end and gates hover/drop on an active same-group drag', () => {
    const node: SessionNode = {
      id: sid('s1'), title: 'Drag me', blank: false, untitled: false, running: false,
      runningSubagentCount: 0, runningJobCount: 0, completed: false, hasActiveSchedule: false, createdAt: 0, updatedAt: 0,
    }
    const inactive = dragProps()
    const { rerender } = render(
      <SessionNodeItem node={node} currentId={undefined} onOpen={vi.fn()}
        onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} drag={inactive} t={t} />,
    )
    const row = screen.getByRole('treeitem')
    stubRect(row)
    expect(row.getAttribute('draggable')).toBe('true')
    fireEvent.dragStart(row, { dataTransfer })
    expect(inactive.start).toHaveBeenCalledOnce()
    // Inactive drag: hover and drop are rejected.
    fireEvent.dragOver(row, { dataTransfer })
    fireEvent.drop(row, { dataTransfer })
    expect(inactive.hover).not.toHaveBeenCalled()
    expect(inactive.drop).not.toHaveBeenCalled()
    fireEvent.dragEnd(row)
    expect(inactive.end).toHaveBeenCalledOnce()

    const active = dragProps({ active: true, marker: 'before' })
    rerender(
      <SessionNodeItem node={node} currentId={undefined} onOpen={vi.fn()}
        onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} drag={active} t={t} />,
    )
    stubRect(screen.getByRole('treeitem'))
    // Top half hovers/drops 'before'; bottom half 'after' (row mid = 117).
    fireDrag(screen.getByRole('treeitem'), 'dragOver', 105)
    expect(active.hover).toHaveBeenCalledWith('before')
    fireDrag(screen.getByRole('treeitem'), 'dragOver', 130)
    expect(active.hover).toHaveBeenCalledWith('after')
    fireDrag(screen.getByRole('treeitem'), 'drop', 130)
    expect(active.drop).toHaveBeenCalledWith('after')

    const after = dragProps({ active: true, marker: 'after' })
    rerender(
      <SessionNodeItem node={node} currentId={undefined} onOpen={vi.fn()}
        onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} drag={after} t={t} />,
    )
    expect(screen.getByRole('treeitem').className).toMatch(/dropAfter/)
  })
})
