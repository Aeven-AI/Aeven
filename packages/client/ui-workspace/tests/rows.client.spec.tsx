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

  // Divergence: a row's marks no longer carry data-state, and idle and
  // completed share the still glyph, so the status is read off the slot's own
  // label instead.
  it('marks the leading status slot of a flat row, idle included', () => {
    const idle: SessionNode = {
      id: sid('flat'), title: 'Flat Session', blank: false, untitled: false, running: false,
      runningSubagentCount: 0, runningJobCount: 0, completed: false, hasActiveSchedule: false, createdAt: 0, updatedAt: 0,
    }
    const view = render(<SessionNodeItem node={idle} currentId={undefined} onOpen={vi.fn()}
      onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} t={t} />)
    // The slot leads the title in both states, and its own status changes:
    // the still mark the link carries at rest…
    const slot = (): HTMLElement => screen.getByText('Flat Session').previousElementSibling as HTMLElement
    expect(slot().textContent).toBe('空闲')
    expect(slot().firstElementChild?.tagName).toBe('svg')

    // …the loading mark, which brings its own box, once the Session works.
    view.rerender(<SessionNodeItem node={{ ...idle, running: true }} currentId={undefined}
      onOpen={vi.fn()} onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} t={t} />)
    expect(slot().textContent).toBe('进行中')
    expect(slot().firstElementChild?.tagName).toBe('SPAN')
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
    // The row's leading slot reports the live state beside the title.
    expect(screen.getByText('Result title').previousElementSibling?.textContent).toBe('进行中')
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
    // User attention outranks the running state: the row reports the pending
    // status alone, and the running Session it sits in is not reported.
    expect(screen.getByText('Needs input').previousElementSibling?.textContent).toBe(label)
    expect(screen.getByText(label)).toBeTruthy()
    expect(screen.queryByText('进行中')).toBeNull()
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
      key: 'project', workspaceId: wid('project'), isBuiltIn: false, managed: false, remote: false, cwd: '/projects/project', createdAt: 0, label: 'Project',
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
      key: 'project', workspaceId: wid('project'), isBuiltIn: false, managed: false, remote: false, cwd: '/projects/project', createdAt: 0, label: 'Project',
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

  // Divergence: the row carries no update-time cell, so the marker closes the
  // row's own content rather than sitting between the title and a time.
  it('keeps the active-Schedule marker after the title in the session row', () => {
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
      const indicator = screen.getByRole('img', { name: '有活动定时任务' })
      expect(title.nextElementSibling).toBe(indicator)
      // It closes the row's own content: the row carries no time cell after
      // it, and the actions cell stays outside the row's link.
      expect(indicator.nextElementSibling).toBeNull()
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
    // The status the row's leading slot reports, read off the title it precedes.
    const status = (): string | null | undefined =>
      screen.getByText('One').previousElementSibling?.textContent
    // At rest: the still mark, reporting Idle.
    const plain = renderRow({})
    expect(status()).toBe('空闲')
    expect(screen.queryByText('进行中')).toBeNull()
    plain.unmount()
    // Finished while unviewed: the same still mark reports Completed.
    const done = renderRow({ completed: true })
    expect(status()).toBe('已完成')
    done.unmount()
    // Running wins the slot: the loading mark, and no completion report.
    const running = renderRow({ completed: true, running: true })
    expect(status()).toBe('进行中')
    expect(screen.queryByText('已完成')).toBeNull()
    running.unmount()
    // Descendant activity also wins until the last running descendant stops.
    renderRow({ completed: true, runningSubagentCount: 1 })
    expect(status()).toBe('1 个子代理运行中')
    expect(screen.queryByText('已完成')).toBeNull()
  })

  it('shows descendant activity without describing an idle parent as running', () => {
    const node: SessionNode = {
      id: sid('owner'), title: 'Delegating', blank: false, untitled: false, running: false,
      runningSubagentCount: 2, runningJobCount: 0, completed: false, hasActiveSchedule: false, createdAt: 0, updatedAt: 0,
    }
    render(<SessionNodeItem node={node} currentId={undefined} onOpen={vi.fn()}
      onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} t={t} />)
    const row = screen.getByRole('treeitem')
    // One loading mark in the row, and the slot names the descendants rather
    // than the idle parent.
    expect(row.querySelectorAll('span > svg')).toHaveLength(1)
    const slot = screen.getByText('Delegating').previousElementSibling as HTMLElement
    expect(slot.firstElementChild?.tagName).toBe('SPAN')
    expect(slot.textContent).toBe('2 个子代理运行中')
    expect(screen.getByText('2 个子代理运行中')).toBeTruthy()
    expect(screen.queryByText('进行中')).toBeNull()
  })

  it('keeps descendant activity secondary while the parent is running', () => {
    const node: SessionNode = {
      id: sid('owner'), title: 'Delegating', blank: false, untitled: false, running: true,
      runningSubagentCount: 1, runningJobCount: 0, completed: false, hasActiveSchedule: false, createdAt: 0, updatedAt: 0,
    }
    render(<SessionNodeItem node={node} currentId={undefined} onOpen={vi.fn()}
      onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} t={t} />)
    // One mark carries the work in flight; the slot names the parent's status
    // first and the descendant's beside it.
    const slot = screen.getByText('Delegating').previousElementSibling as HTMLElement
    expect(slot.firstElementChild?.tagName).toBe('SPAN')
    expect(slot.textContent).toBe('进行中1 个子代理运行中')
    expect(screen.getByText('进行中')).toBeTruthy()
    expect(screen.getByText('1 个子代理运行中')).toBeTruthy()
  })

  it('keeps child activity as a secondary status while user attention is primary', () => {
    const node: SessionNode = {
      id: sid('owner'), title: 'Needs input', blank: false, untitled: false, pendingInteraction: 'question',
      running: false, runningSubagentCount: 1, runningJobCount: 0, completed: false, hasActiveSchedule: false, createdAt: 0, updatedAt: 0,
    }
    render(<SessionNodeItem node={node} currentId={undefined} onOpen={vi.fn()}
      onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} t={t} />)
    // The pending mark leads, the descendant's status follows it, and the
    // Session's own running state is what user attention replaced.
    const slot = screen.getByText('Needs input').previousElementSibling as HTMLElement
    expect(slot.firstElementChild?.tagName).toBe('svg')
    expect(slot.textContent).toBe('等待回答1 个子代理运行中')
    expect(screen.getByText('等待回答')).toBeTruthy()
    expect(screen.getByText('1 个子代理运行中')).toBeTruthy()
    expect(screen.queryByText('进行中')).toBeNull()
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

  it('reports a finished search result row as Completed', () => {
    render(<SearchResultItem
      result={{
        id: sid('result'), title: 'Done', untitled: false, workspace: 'Workspace', running: false,
        runningSubagentCount: 0, runningJobCount: 0, completed: true, hasActiveSchedule: false,
      }}
      currentId={undefined} onOpen={vi.fn()} t={t}
    />)
    expect(screen.getByText('Done').previousElementSibling?.textContent).toBe('已完成')
  })

  it('offers a workspace without a folder here to choose one on this device', () => {
    const onBind = vi.fn()
    const group: GroupNode = {
      key: 'research', workspaceId: wid('research'), isBuiltIn: false, managed: false, remote: true, cwd: undefined, createdAt: 0, label: 'Research',
      sessionCount: 0, expanded: false, containsCurrent: false, sessions: [],
    }
    render(<ProjectRowItem
      group={group} onToggle={vi.fn()} onCreate={vi.fn()}
      newSessionHref={() => ({ href: '/c/new-1', sessionId: sid('session-new-1') })}
      actions={{ rename: vi.fn(), delete: vi.fn(), bind: onBind }} t={t}
    />)
    fireEvent.click(screen.getByRole('button', { name: '工作区“Research”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '选择工作区' }))
    expect(onBind).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('workspace row menu opens on the ellipsis, renames, and deletes', () => {
    const onRename = vi.fn()
    const onDelete = vi.fn()
    const onToggle = vi.fn()
    const group: GroupNode = {
      key: 'project', workspaceId: wid('project'), isBuiltIn: false, managed: false, remote: false, cwd: '/projects/project', createdAt: 0, label: 'Project',
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
    // The delete row reads like the others: the workspace's folder and session
    // logs survive it, so it carries no destructive styling.
    expect(screen.getByRole('menuitem', { name: '删除工作区' }).className).not.toMatch(/danger/)
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
      key: '', workspaceId: undefined, isBuiltIn: false, managed: false, remote: false, cwd: undefined, createdAt: undefined, label: 'Ungrouped',
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

  // Divergence: the row's hover card and update-time cell were both removed
  // from the product, so a blank row's only content is its label and status.
  it('blank New Session rows carry no menu, no time label, and no hover card', () => {
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
      // Dwelling adds nothing beside the row's own label and status: the row
      // raises no card, and so carries no timestamp line on hover either.
      const row = screen.getByRole('treeitem')
      fireEvent.pointerEnter(row)
      act(() => { vi.advanceTimersByTime(500) })
      expect(screen.getAllByText('新会话')).toHaveLength(1)
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


  it('withholds Rename while the row has no title yet and offers it once the title lands', () => {
    const creating: SessionNode = {
      id: sid('s-creating'), title: 's-creating', blank: false, untitled: true, running: true,
      runningSubagentCount: 0, runningJobCount: 0, completed: false, hasActiveSchedule: false, createdAt: 0, updatedAt: 0,
    }
    const rendered = (node: SessionNode) => (
      <SessionNodeItem node={node} currentId={undefined} onOpen={vi.fn()}
        onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} t={t} />
    )
    const view = render(rendered(creating))
    // The row's own title is still being created, so it offers fork and archive
    // but no Rename: the text it shows is the New Session label, not a name.
    fireEvent.click(screen.getByRole('button', { name: '会话“新会话”的操作' }))
    expect(screen.queryByRole('menuitem', { name: '重命名' })).toBeNull()
    expect(screen.getByRole('menuitem', { name: '分叉会话' })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })

    // A title-less Session at rest keeps Rename: no revision is coming for it.
    view.rerender(rendered({ ...creating, running: false }))
    fireEvent.click(screen.getByRole('button', { name: '会话“新会话”的操作' }))
    expect(screen.getByRole('menuitem', { name: '重命名' })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })

    // The accepted title restores the action while the Session keeps working.
    view.rerender(rendered({ ...creating, title: 'Created title', untitled: false }))
    fireEvent.click(screen.getByRole('button', { name: '会话“Created title”的操作' }))
    expect(screen.getByRole('menuitem', { name: '重命名' })).toBeTruthy()
  })

  // Divergence: the row's hover card was removed from the product — no
  // HoverCard consumer remains under packages/client/*/src — so a dwell adds
  // nothing beside the row itself.
  it('raises no hover card on a dwell, with or without the row menu open', () => {
    vi.useFakeTimers()
    try {
      const node: SessionNode = {
        id: sid('s1'), title: 'Hovered', blank: false, untitled: false, running: true,
        runningSubagentCount: 0, runningJobCount: 0, completed: false, hasActiveSchedule: false, createdAt: 0, updatedAt: 0,
      }
      render(<SessionNodeItem node={node} currentId={undefined} onOpen={vi.fn()}
        onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} t={t} />)
      const row = screen.getByRole('treeitem')
      fireEvent.pointerEnter(row)
      act(() => { vi.advanceTimersByTime(500) })
      // Dwelling shows the row alone: no card body joins the title, and no
      // relative time is reported anywhere in it.
      expect(screen.getAllByText('Hovered')).toHaveLength(1)
      expect(screen.queryByText('1分钟前')).toBeNull()
      expect(screen.queryByText('刚刚')).toBeNull()
      fireEvent.pointerLeave(row)
      fireEvent.click(screen.getByRole('button', { name: '会话“Hovered”的操作' }))
      fireEvent.pointerEnter(row)
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
  ] as const)('shows %s ahead of the running state', (pendingInteraction, label) => {
    const node: SessionNode = {
      id: sid(pendingInteraction), title: 'Needs input', blank: false, untitled: false,
      pendingInteraction, running: true, runningSubagentCount: 0, runningJobCount: 0, completed: false,
      hasActiveSchedule: false, createdAt: 0, updatedAt: 0,
    }
    const view = render(<SessionNodeItem node={node} currentId={undefined} onOpen={vi.fn()}
      onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} t={t} />)
    // The pending mark leads the slot, and the running state it replaced is
    // not reported beside it.
    const slot = (): HTMLElement => screen.getByText('Needs input').previousElementSibling as HTMLElement
    expect(slot().firstElementChild?.tagName).toBe('svg')
    expect(slot().textContent).toBe(label)
    expect(screen.queryByText('进行中')).toBeNull()

    view.rerender(<SessionNodeItem node={{ ...node, running: false }} currentId={undefined}
      onOpen={vi.fn()} onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} t={t} />)
    expect(slot().textContent).toBe(label)
  })

  // Divergence: as above — the hover card is gone, so the row's own status line
  // is the only one reported, dwell or not.
  it('reports an idle row\'s status once, hover or not', () => {
    vi.useFakeTimers()
    try {
      const node: SessionNode = {
        id: sid('s1'), title: 'Quiet', blank: false, untitled: false, running: false,
        runningSubagentCount: 0, runningJobCount: 0, completed: false, hasActiveSchedule: false, createdAt: 0, updatedAt: 0,
      }
      render(<SessionNodeItem node={node} currentId={undefined} onOpen={vi.fn()}
        onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} t={t} />)
      fireEvent.pointerEnter(screen.getByRole('treeitem'))
      act(() => { vi.advanceTimersByTime(500) })
      // The row's own status line is the only one an idle Session reports,
      // hover or not, and it carries no timestamp beside it.
      expect(screen.getAllByText('空闲')).toHaveLength(1)
      expect(screen.queryByText('刚刚')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  // Divergence: as above — the hover card is gone, so dwelling adds no second
  // report of the reminder the row already carries.
  it('reports a completed row\'s status once, hover or not', () => {
    vi.useFakeTimers()
    try {
      const node: SessionNode = {
        id: sid('s1'), title: 'Done', blank: false, untitled: false, running: false,
        runningSubagentCount: 0, runningJobCount: 0, completed: true, hasActiveSchedule: false, createdAt: 0, updatedAt: 0,
      }
      render(<SessionNodeItem node={node} currentId={undefined} onOpen={vi.fn()}
        onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} t={t} />)
      fireEvent.pointerEnter(screen.getByRole('treeitem'))
      act(() => { vi.advanceTimersByTime(500) })
      // The row's own reminder line, reported once: dwelling adds no second
      // report of it.
      expect(screen.getAllByText('已完成')).toHaveLength(1)
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
