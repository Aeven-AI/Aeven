// @vitest-environment jsdom
/**
 * The session header's agents control: the pill and its list of the agents one
 * conversation started. These cases pin the pill's label and visibility, the
 * rows (running first, then the finished section, then catalog diagnostics),
 * what a row opens into, the catalogs observed while the list is shown, and the
 * way back to the conversation that started an agent.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { makeTranslate, RemoteError } from '@aeven/client-test-runtime'
import type {
  SessionListState, SessionSummary, SubagentCatalogSnapshot,
} from '@aeven/api-session-controller/client'
import type { SessionId } from '@aeven/session/types'
import {
  SubagentHeaderLineage, type SubagentHeaderLineageProps,
} from '../src/client/SubagentHeaderLineage.tsx'
import { SubagentReadOnlyComposer } from '../src/client/SubagentReadOnlyComposer.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const PARENT = 'parent' as SessionId
const CHILD = 'child' as SessionId
const GRANDCHILD = 'grandchild' as SessionId
const SIBLING = 'child-2' as SessionId
const t: SubagentHeaderLineageProps['t'] = makeTranslate(zh)

function catalog(over: Partial<SubagentCatalogSnapshot> = {}): SubagentCatalogSnapshot {
  return {
    entries: [
      {
        kind: 'child', id: CHILD, mode: 'continuable', label: 'worker',
        activity: 'running', hasChildren: true,
      },
      {
        kind: 'child', id: SIBLING, mode: 'one-shot',
        label: 'reviewer', activity: 'inactive', hasChildren: false,
      },
      { kind: 'diagnostic', id: 'bad' as SessionId, reason: 'corrupt' },
    ],
    parentAvailable: true,
    state: 'ready',
    error: null,
    ...over,
  }
}

function props(
  value: SubagentCatalogSnapshot | undefined,
  nested: Readonly<Record<SessionId, SubagentCatalogSnapshot>> = {},
  summaries?: Readonly<Record<SessionId, SessionSummary>>,
) {
  const state = {
    ids: [CHILD],
    byId: summaries ?? {
      [CHILD]: {
        id: CHILD,
        createdAt: 0,
        title: '正在扫描项目文件',
        displayTitle: 'worker',
        running: true,
        blank: false,
        updatedAt: Date.now(),
      },
    },
    current: PARENT, phase: 'ready',
    subagentsByParent: value === undefined ? nested : { [PARENT]: value, ...nested },
    jobsBySession: {},
    currentAddress: undefined,
  } satisfies SessionListState
  function useSessions<T>(select: (snapshot: SessionListState) => T): T {
    return select(state)
  }
  return {
    sessionId: PARENT,
    useSessions,
    openChild: vi.fn(),
    openSession: vi.fn(),
    refresh: vi.fn(),
    setCatalogOpen: vi.fn(),
    lineageSessionId: PARENT,
    displayTitle: 'Parent title',
    t,
  } as unknown as SubagentHeaderLineageProps
}

function summary(id: SessionId, updatedAt: number): SessionSummary {
  return {
    id,
    createdAt: 0,
    displayTitle: id,
    running: false,
    blank: false,
    updatedAt,
  }
}

/** The pill the header renders, addressed by the count it states. */
function pill(name: string | RegExp): HTMLElement {
  return screen.getByRole('button', { name })
}

/** The open list, by the accessible name it carries. */
function list(): HTMLElement {
  return screen.getByRole('list', { name: zh['agents.list'] })
}

/** Open the list from its pill. */
function openList(trigger: HTMLElement): HTMLElement {
  fireEvent.click(trigger)
  return list()
}

/** The list item showing one agent by name. */
function row(name: string): HTMLElement {
  const label = within(list()).getByText(name)
  const item = label.closest('li')
  if (item === null) throw new Error(`no list item shows ${name}`)
  return item
}

/** The row's own toggle, by the words it announces. */
function rowToggle(name: string, expanded: boolean): HTMLElement {
  return within(list()).getByRole('button', {
    name: zh[expanded ? 'row.collapse' : 'row.expand'].replace('{label}', name),
  })
}

describe('SubagentHeaderLineage', () => {
  it('states the descendant count the pill stands for and marks live activity', () => {
    const summaries: Record<SessionId, SessionSummary> = {
      [CHILD]: {
        ...summary(CHILD, Date.now()), parentId: PARENT, origin: 'subagent', running: true,
      },
      [GRANDCHILD]: {
        ...summary(GRANDCHILD, Date.now()), parentId: CHILD, origin: 'subagent', running: true,
      },
      [SIBLING]: { ...summary(SIBLING, Date.now()), parentId: PARENT, origin: 'subagent' },
    }
    const view = render(<SubagentHeaderLineage {...props(catalog(), {}, summaries)} />)

    // Three descendants are known; two of them run, and the pill says so while
    // the running mark rides the trigger.
    const trigger = pill('2 个代理进行中')
    expect(trigger.querySelector('[class*="triggerSpinner"]')).not.toBeNull()

    view.rerender(<SubagentHeaderLineage {...props(catalog({
      entries: [
        {
          kind: 'child', id: CHILD, mode: 'continuable', label: 'worker',
          activity: 'inactive', hasChildren: true,
        },
        {
          kind: 'child', id: SIBLING, mode: 'one-shot', label: 'reviewer',
          activity: 'inactive', hasChildren: false,
        },
      ],
    }), {}, {
      ...summaries,
      [CHILD]: { ...summaries[CHILD]!, running: false },
      [GRANDCHILD]: { ...summaries[GRANDCHILD]!, running: false },
    })} />)
    const settled = pill('3 个代理')
    expect(settled.querySelector('[class*="triggerSpinner"]')).toBeNull()
  })

  it('does not count subagents reached through an ordinary fork', () => {
    const fork = 'fork' as SessionId
    const forkChild = 'fork-child' as SessionId
    render(<SubagentHeaderLineage {...props(catalog({
      entries: [
        {
          kind: 'child', id: CHILD, mode: 'continuable', label: 'worker',
          activity: 'inactive', hasChildren: false,
        },
        {
          kind: 'child', id: SIBLING, mode: 'one-shot', label: 'reviewer',
          activity: 'inactive', hasChildren: false,
        },
      ],
    }), {}, {
      [CHILD]: { ...summary(CHILD, 1), parentId: PARENT, origin: 'subagent' },
      [SIBLING]: { ...summary(SIBLING, 1), parentId: PARENT, origin: 'subagent' },
      [fork]: { ...summary(fork, 1), parentId: PARENT },
      [forkChild]: { ...summary(forkChild, 1), parentId: fork, origin: 'subagent', running: true },
    })} />)

    // The fork's own subagent hangs off the fork, so it neither joins the count
    // nor makes the pill read as running.
    const trigger = pill('2 个代理')
    expect(trigger.querySelector('[class*="triggerSpinner"]')).toBeNull()
  })

  it('selects the singular count keys for one descendant', () => {
    const base = props(catalog({
      entries: [{
        kind: 'child', id: CHILD, mode: 'continuable', label: 'worker',
        activity: 'running', hasChildren: false,
      }],
    }), {}, {
      [CHILD]: {
        ...summary(CHILD, Date.now()), parentId: PARENT, origin: 'subagent', running: true,
      },
    })
    const translate = vi.fn(base.t)
    const view = render(<SubagentHeaderLineage {...base} t={translate} />)

    expect(translate).toHaveBeenCalledWith('agents.active.one', { count: 1 })

    view.rerender(<SubagentHeaderLineage {...props(catalog({
      entries: [{
        kind: 'child', id: CHILD, mode: 'continuable', label: 'worker',
        activity: 'inactive', hasChildren: false,
      }],
    }), {}, {
      [CHILD]: { ...summary(CHILD, Date.now()), parentId: PARENT, origin: 'subagent' },
    })} t={translate} />)
    expect(translate).toHaveBeenCalledWith('agents.count.one', { count: 1 })
  })

  it('keeps the pill away until something is evidence of an agent', () => {
    const absent = render(<SubagentHeaderLineage {...props(undefined)} />)
    expect(screen.queryByRole('button')).toBeNull()
    absent.unmount()

    const empty = render(<SubagentHeaderLineage {...props(catalog({ entries: [] }))} />)
    expect(screen.queryByRole('button')).toBeNull()
    empty.unmount()

    // An idle read must not flash the pill in; the failure below is different.
    const loading = render(<SubagentHeaderLineage {...props(catalog({ entries: [], state: 'loading' }))} />)
    expect(screen.queryByRole('button')).toBeNull()
    loading.unmount()

    const failed = props(catalog({
      entries: [],
      state: 'error',
      error: new RemoteError('gateway/internal', 'index down', {}),
    }))
    render(<SubagentHeaderLineage {...failed} />)
    openList(pill('0 个代理'))
    expect(within(list()).getByText('index down')).toBeTruthy()
    fireEvent.click(within(list()).getByRole('button', { name: zh['retry'] }))
    expect(failed.refresh).toHaveBeenCalledWith(PARENT)
  })

  it('lists known descendants while their catalog is absent or stale-empty', () => {
    const summaries = {
      [CHILD]: {
        ...summary(CHILD, 1), parentId: PARENT, origin: 'subagent' as const, running: true,
      },
      [SIBLING]: { ...summary(SIBLING, 1), parentId: PARENT, origin: 'subagent' as const },
    }
    const absent = props(undefined, {}, summaries)
    const view = render(<SubagentHeaderLineage {...absent} />)

    // The count comes from the session list, so the pill is there before the
    // catalog is; the list it opens says what it is waiting for.
    openList(pill('1 个代理进行中'))
    expect(absent.setCatalogOpen).toHaveBeenCalledWith(PARENT, true)
    expect(within(list()).getByText(zh['loading.label'])).toBeTruthy()
    expect(absent.openChild).not.toHaveBeenCalled()
    // Reading a catalog is the reader's request, not a side effect of mounting.
    expect(absent.refresh).not.toHaveBeenCalled()

    const staleEmpty = props(catalog({ entries: [] }), {}, summaries)
    view.rerender(<SubagentHeaderLineage {...staleEmpty} />)
    expect(pill('1 个代理进行中')).toBeTruthy()
    // A ready catalog that lists no row has nothing to show: the list is empty
    // rather than claiming a load still in flight.
    expect(within(list()).queryAllByRole('listitem')).toHaveLength(0)
  })

  it('presents a bare load failure without any row to open', () => {
    render(<SubagentHeaderLineage {...props(catalog({ entries: [], state: 'error', error: null }))} />)

    openList(pill('0 个代理'))
    expect(within(list()).getByText(zh['load.error'])).toBeTruthy()
    // The retry is the list's only control: no catalog row arrived to open.
    const controls = within(list()).getAllByRole('button')
    expect(controls.map(control => control.textContent)).toEqual([zh['retry']])
  })

  it('lists the running agent first and folds the finished ones away', () => {
    const input = props(catalog())
    render(<SubagentHeaderLineage {...input} />)

    openList(pill('1 个代理进行中'))
    expect(input.setCatalogOpen).toHaveBeenCalledWith(PARENT, true)
    // The running row, then the finished section heading; reviewer is inside it.
    expect(within(list()).getAllByRole('listitem').map(item => item.textContent))
      .toEqual(['worker', zh['agents.finished'], `bad${zh['diagnostic.corrupt']}`])
    expect(within(list()).queryByText('reviewer')).toBeNull()

    fireEvent.click(within(list()).getByRole('button', { name: zh['agents.finished'] }))
    expect(within(row('reviewer')).getByText(zh['status.done'])).toBeTruthy()

    fireEvent.click(within(list()).getByRole('button', { name: zh['agents.finished'] }))
    expect(within(list()).queryByText('reviewer')).toBeNull()
  })

  it('states a catalog diagnostic as a static, reasoned row', () => {
    const input = props(catalog({
      entries: [
        {
          kind: 'child', id: CHILD, mode: 'continuable', label: 'worker',
          activity: 'running', hasChildren: false,
        },
        { kind: 'diagnostic', id: 'old' as SessionId, reason: 'unsupported' },
        { kind: 'diagnostic', id: 'gone' as SessionId, reason: 'unavailable' },
      ],
    }))
    render(<SubagentHeaderLineage {...input} />)
    openList(pill('1 个代理进行中'))

    expect(within(list()).getByText('old')).toBeTruthy()
    expect(within(list()).getByText(zh['diagnostic.unsupported'])).toBeTruthy()
    expect(within(list()).getByText(zh['diagnostic.unavailable'])).toBeTruthy()
    // A record that never loaded has nothing to open.
    expect(within(list()).getAllByRole('button')).toHaveLength(1)
  })

  it('opens a row into its facts and the way into its conversation', () => {
    const input = props(catalog({
      entries: [{
        kind: 'child', id: CHILD, mode: 'continuable', label: 'worker',
        activity: 'running', hasChildren: false,
      }],
    }))
    render(<SubagentHeaderLineage {...input} />)
    openList(pill('1 个代理进行中'))

    const toggle = rowToggle('worker', false)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)

    const expanded = rowToggle('worker', true)
    expect(expanded.getAttribute('aria-expanded')).toBe('true')
    const details = within(row('worker'))
    expect(details.getByText(zh['fact.status'])).toBeTruthy()
    expect(details.getByText(zh['status.running'])).toBeTruthy()
    expect(details.getByText(zh['fact.type'])).toBeTruthy()
    expect(details.getByText(zh['type.continuable'])).toBeTruthy()

    fireEvent.click(details.getByRole('button', { name: zh['open.conversation'] }))
    expect(input.openChild).toHaveBeenCalledWith({
      parentSessionId: PARENT, childSessionId: CHILD, mode: 'continuable',
    })
    // Handing the reader over closes the list.
    expect(screen.queryByRole('list', { name: zh['agents.list'] })).toBeNull()
  })

  it('closes on Escape with the focus back on the pill, and on an outside press', () => {
    const input = props(catalog())
    render(<SubagentHeaderLineage {...input} />)
    const trigger = pill('1 个代理进行中')

    openList(trigger)
    fireEvent.keyDown(list(), { key: 'Escape' })
    expect(screen.queryByRole('list', { name: zh['agents.list'] })).toBeNull()
    expect(document.activeElement).toBe(trigger)
    expect(input.setCatalogOpen).toHaveBeenLastCalledWith(PARENT, false)

    openList(trigger)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('list', { name: zh['agents.list'] })).toBeNull()
  })

  it('shifts an open list back inside the viewport', () => {
    render(<SubagentHeaderLineage {...props(catalog())} />)
    openList(pill('1 个代理进行中'))

    const menu = list()
    vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue({ left: -50, right: 150, width: 200 } as DOMRect)
    act(() => { window.dispatchEvent(new Event('resize')) })
    // The list keeps the sheet's anchor until the measure says it would run off
    // the left edge; then it moves over by exactly that overhang plus the margin.
    expect(menu.style.getPropertyValue('--activity-shift')).toBe('62px')
  })

  it('states durable token totals and ticks a running row by the second', async () => {
    const now = 2_000_000_000_000
    vi.useFakeTimers()
    vi.setSystemTime(now)
    const rows = [
      ['running', 'running', 65_000, now - 5_000, now - 1_000, now],
      ['finished', 'inactive', 3_723_000, undefined, undefined, now - 60_000],
      ['interrupted', 'inactive', 2_000, now - 7_000, now - 3_000, now + 60_000],
    ] as const
    const usageById = {
      running: {
        uncachedInputTokens: 1_000,
        outputTokens: 200,
        cacheReadTokens: 3_000,
        cacheWriteTokens: 400,
      },
      finished: {
        uncachedInputTokens: 123,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      interrupted: {
        uncachedInputTokens: 123_000_000,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    } as const
    const entries = rows.map(([id, activity]) => ({
      kind: 'child' as const,
      id: id as SessionId,
      mode: 'continuable' as const,
      label: id,
      activity,
      hasChildren: false,
    }))
    const summaries = Object.fromEntries(rows.map(([
      id, activity, settledMs, activeSince, activeThrough, updatedAt,
    ]) => {
      const childId = id as SessionId
      return [id, {
        ...summary(childId, updatedAt),
        parentId: PARENT,
        origin: 'subagent' as const,
        running: activity === 'running',
        projectionValues: {
          subagentTiming: {
            settledMs,
            ...(activeSince === undefined || activeThrough === undefined
              ? {}
              : { active: { since: activeSince, through: activeThrough } }),
          },
          tokenUsage: usageById[id],
        },
      }]
    })) as Record<SessionId, SessionSummary>
    render(<SubagentHeaderLineage {...props(catalog({ entries }), {}, summaries)} />)
    openList(pill('1 个代理进行中'))

    // The closed row carries the active time; the tokens wait in its details.
    expect(within(row('running')).getByText('01 分 10 秒')).toBeTruthy()
    fireEvent.click(rowToggle('running', false))
    expect(within(row('running')).getByText('4.6K tok')).toBeTruthy()
    expect(within(row('running')).getByText(zh['fact.activeFor'])).toBeTruthy()

    fireEvent.click(within(list()).getByRole('button', { name: zh['agents.finished'] }))
    expect(within(row('finished')).getByText('01 小时 02 分')).toBeTruthy()
    fireEvent.click(rowToggle('finished', false))
    expect(within(row('finished')).getByText('123 tok')).toBeTruthy()

    const interrupted = row('interrupted')
    fireEvent.click(rowToggle('interrupted', false))
    // A settled row states its whole active time, not the time since it settled.
    expect(within(interrupted).getByText('123M tok')).toBeTruthy()
    expect(within(interrupted).getByText('06 秒')).toBeTruthy()

    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    expect(within(row('running')).getByText('01 分 11 秒')).toBeTruthy()
    expect(within(row('finished')).getByText('01 小时 02 分')).toBeTruthy()
    expect(within(row('interrupted')).getByText('06 秒')).toBeTruthy()
  })

  it('observes the catalog of an agent only while its row is open', () => {
    const childCatalog = catalog({
      entries: [{
        kind: 'child', id: GRANDCHILD, mode: 'continuable',
        label: 'indexer', activity: 'inactive', hasChildren: false,
      }],
    })
    const input = props(catalog(), { [CHILD]: childCatalog })
    render(<SubagentHeaderLineage {...input} />)
    openList(pill('1 个代理进行中'))

    fireEvent.click(rowToggle('worker', false))
    expect(input.setCatalogOpen).toHaveBeenCalledWith(CHILD, true)

    const nested = within(row('worker')).getByRole('button', { name: /indexer/ })
    expect(within(nested).getByText(zh['status.done'])).toBeTruthy()
    fireEvent.click(nested)
    expect(input.openChild).toHaveBeenCalledWith({
      parentSessionId: CHILD, childSessionId: GRANDCHILD, mode: 'continuable',
    })
    // Handing the reader over unmounts the row, so that catalog stops being
    // observed with it.
    expect(input.setCatalogOpen).toHaveBeenCalledWith(CHILD, false)
  })

  it('says what it waits for when an expanded agent has no catalog yet', () => {
    const input = props(catalog({
      entries: [{
        kind: 'child', id: CHILD, mode: 'continuable', label: 'worker',
        activity: 'running', hasChildren: true,
      }],
    }))
    render(<SubagentHeaderLineage {...input} />)
    openList(pill('1 个代理进行中'))
    fireEvent.click(rowToggle('worker', false))

    expect(input.setCatalogOpen).toHaveBeenCalledWith(CHILD, true)
    expect(within(row('worker')).getByText(zh['loading.label'])).toBeTruthy()
    expect(input.openChild).not.toHaveBeenCalled()

    // Folding the row back stops observing that catalog.
    fireEvent.click(rowToggle('worker', true))
    expect(input.setCatalogOpen).toHaveBeenLastCalledWith(CHILD, false)
  })

  it('names an agent by its label, then its log title, then its id', () => {
    const titled = 'titled' as SessionId
    const bare = 'bare' as SessionId
    const input = props(catalog({
      entries: [
        {
          kind: 'child', id: CHILD, mode: 'continuable', label: 'worker',
          activity: 'inactive', hasChildren: false,
        },
        { kind: 'child', id: titled, mode: 'one-shot', activity: 'inactive', hasChildren: false },
        { kind: 'child', id: bare, mode: 'one-shot', activity: 'inactive', hasChildren: false },
      ],
    }), {}, {
      [CHILD]: { ...summary(CHILD, 1), parentId: PARENT, origin: 'subagent' },
      [titled]: {
        ...summary(titled, 1), title: 'indexer', parentId: PARENT, origin: 'subagent',
      },
      [bare]: { ...summary(bare, 1), parentId: PARENT, origin: 'subagent' },
    })
    render(<SubagentHeaderLineage {...input} />)
    openList(pill('3 个代理'))

    expect(within(list()).getByText('worker')).toBeTruthy()
    expect(within(list()).getByText('indexer')).toBeTruthy()
    expect(within(list()).getByText(String(bare))).toBeTruthy()
  })

  it('offers the way back to the conversation that started an agent', () => {
    const input = {
      ...props(catalog({
        entries: [
          {
            kind: 'child', id: CHILD, mode: 'continuable', label: 'worker',
            activity: 'inactive', hasChildren: false,
          },
          {
            kind: 'child', id: SIBLING, mode: 'one-shot', label: 'reviewer',
            activity: 'inactive', hasChildren: false,
          },
        ],
      }), {}, {
        [PARENT]: { ...summary(PARENT, 1), displayTitle: 'Main title' },
        [CHILD]: { ...summary(CHILD, 1), parentId: PARENT, origin: 'subagent' as const },
        [SIBLING]: { ...summary(SIBLING, 1), parentId: PARENT, origin: 'subagent' as const },
      }),
      sessionId: CHILD,
      lineageSessionId: CHILD,
      displayTitle: 'worker',
    }
    render(<SubagentHeaderLineage {...input} />)

    fireEvent.click(pill('Main title'))
    expect(input.openSession).toHaveBeenCalledWith(PARENT)

    openList(pill('2 个代理'))
    // The agent this conversation shows is marked, and its own row offers no
    // way into the conversation already on screen.
    const current = rowToggle('worker', false)
    expect(current.getAttribute('aria-current')).toBe('true')
    expect(current.textContent).toContain(zh['status.viewing'])
    fireEvent.click(current)
    fireEvent.click(rowToggle('reviewer', false))
    const links = within(list()).getAllByRole('button', { name: zh['open.conversation'] })
    expect(links).toHaveLength(1)
    fireEvent.click(links[0]!)
    expect(input.openChild).toHaveBeenCalledWith({
      parentSessionId: PARENT, childSessionId: SIBLING, mode: 'one-shot',
    })
  })

  it('names the way back by its fallback when the parent is not in the list', () => {
    const input = {
      ...props(catalog(), {}, {
        [CHILD]: { ...summary(CHILD, 1), parentId: PARENT, origin: 'subagent' as const },
      }),
      sessionId: CHILD,
      lineageSessionId: CHILD,
      displayTitle: 'worker',
    }
    render(<SubagentHeaderLineage {...input} />)

    expect(pill(zh['back.fallback'])).toBeTruthy()
  })
})

describe('SubagentReadOnlyComposer', () => {
  it('explains the exact missing-parent recovery path', () => {
    render(<SubagentReadOnlyComposer matched={{ reason: 'parent-unavailable' }} t={t} />)
    expect(screen.getByRole('status').textContent).toContain('父会话当前不在线')
  })

  it('explains that one-shot histories never accept follow-ups', () => {
    render(<SubagentReadOnlyComposer matched={{ reason: 'one-shot' }} t={t} />)
    expect(screen.getByRole('status').textContent).toContain('一次性任务不支持后续消息')
  })
})
