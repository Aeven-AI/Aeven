// @vitest-environment jsdom
/**
 * The background-job list: the header trigger, the rows behind it, the foldout
 * every row offers (a job that printed nothing included), the observation
 * stream that follows visibility, the two-press human stop, and Clear.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { makeTranslate } from '@aeven/client-test-runtime'
import type { JobsSnapshot, JobView, ObservedJob } from '@aeven/api-job-controller/client'
import type { SessionId } from '@aeven/session/types'
import { JobListAction, type JobListActionProps } from '../src/client/JobListAction.tsx'
import { zh } from '../src/client/locales.ts'

const SESSION = 'session' as SessionId
const START = 1_700_000_000_000
const t: JobListActionProps['t'] = makeTranslate(zh)

// Rows derive their time cells from the clock, so every assertion pins it.
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(START)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** A running bash job; each case overrides what it cares about. */
function job(over: Partial<JobView> = {}): JobView {
  return {
    id: 'bash-1' as JobView['id'],
    kind: 'bash',
    label: 'pnpm run build',
    status: 'running',
    startedAt: START,
    output: { total: 0, earliest: 0 },
    ...over,
  }
}

/** A job that settled without printing anything, as a background subagent does. */
function silentJob(over: Partial<JobView> = {}): JobView {
  return job({ status: 'completed', finishedAt: START + 3_000, ...over })
}

/** A job that settled with retained output behind it. */
function settledJob(over: Partial<JobView> = {}): JobView {
  return silentJob({ output: { total: 12, earliest: 0 }, ...over })
}

/** One observed job's live view state, as the job stream accumulates it. */
function observed(over: Partial<ObservedJob> = {}): ObservedJob {
  return { jobId: 'bash-1' as JobView['id'], text: '', gapBefore: false, streaming: true, ...over }
}

/**
 * A rendered list's business face: the roster and observation state the next
 * render reads, the hook a real renderer binds from the inject `hooks`
 * compartment, and the seats' own controls.
 */
function bench(initial: readonly JobView[] | undefined, observedViews: Readonly<Record<string, ObservedJob>> = {}) {
  const state = { rows: {}, observed: observedViews } as { rows: JobsSnapshot['rows']; observed: JobsSnapshot['observed'] }
  /** Point the next render at a different roster and observation state. */
  const set = (jobs: readonly JobView[] | undefined, nextObserved = observedViews): void => {
    state.rows = jobs === undefined ? {} : { [SESSION]: jobs }
    state.observed = nextObserved
  }
  set(initial)
  const stops: ReturnType<typeof vi.fn>[] = []
  const watchRows = vi.fn(() => vi.fn())
  const observe = vi.fn(() => {
    const stop = vi.fn()
    stops.push(stop)
    return stop
  })
  const killJob = vi.fn(async () => true)
  const removeJob = vi.fn(async () => true)
  const useJobs = ((select: (snapshot: JobsSnapshot) => unknown) => select(state)) as JobListActionProps['useJobs']
  const props = { sessionId: SESSION, useJobs, watchRows, observe, killJob, removeJob, t } as unknown as JobListActionProps
  return { props, set, watchRows, observe, killJob, removeJob, stops }
}

type Bench = ReturnType<typeof bench>

/** Render the list and hand back the bench that drives it. */
function show(b: Bench) {
  return render(<JobListAction {...b.props} />)
}

/** Re-render after {@link Bench.set} pointed the roster somewhere else. */
function update(view: ReturnType<typeof show>, b: Bench): void {
  view.rerender(<JobListAction {...b.props} />)
}

/** The header trigger. */
function trigger(): HTMLElement {
  return screen.getAllByRole('button')[0] as HTMLElement
}

/** The open popover list. */
function list(): HTMLElement {
  return screen.getByRole('list', { name: zh['list.aria'] })
}

/** Open the popover through its trigger. */
function openList(): void {
  fireEvent.click(trigger())
}

/** The words a row toggle's accessible name carries before and after the job name. */
function toggleAffixes(key: 'row.expandAria' | 'row.collapseAria'): [string, string] {
  const [before = '', after = ''] = zh[key].split('{label}')
  return [before, after]
}

/** Every row toggle in render order, section headings excluded. */
function rowToggles(): HTMLElement[] {
  const [before] = toggleAffixes('row.expandAria')
  return within(list()).getAllByRole('button').filter(node => (node.getAttribute('aria-label') ?? '').startsWith(before))
}

/** The jobs the rows show, in render order, read from the names they render. */
function rowNames(): string[] {
  return rowToggles().map(node => node.querySelector('[title]')?.getAttribute('title') ?? '')
}

/** Rows in render order, each as all of its closed-row text. */
function rowTexts(): string[] {
  return rowToggles().map(node => node.textContent ?? '')
}

/** One row's toggle by the job name it renders. */
function rowToggle(name: string, expanded = false): HTMLElement {
  return within(list())
    .getByRole('button', { name: t(expanded ? 'row.collapseAria' : 'row.expandAria', { label: name }) })
}

/** One row's rendered text by the job name it shows. */
function rowText(name: string): string {
  const index = rowNames().indexOf(name)
  return rowTexts()[index] ?? ''
}

/** The opened row's facts as label → value. */
function facts(): Record<string, string> {
  const labels = [...list().querySelectorAll('dt')].map(node => node.textContent ?? '')
  const values = [...list().querySelectorAll('dd')].map(node => node.textContent ?? '')
  return Object.fromEntries(labels.map((label, index) => [label, values[index] ?? '']))
}

/** Unfold the settled tail, which folds itself while live work exists. */
function expandSettled(): void {
  const settledRows = within(list()).getAllByRole('button').filter(node => (node.textContent ?? '') === zh['section.clear']).length
  fireEvent.click(within(list()).getByRole('button', { name: t('section.settledCount', { count: settledRows }) }))
}

/** Open one of the opened row's disclosure cards by its header words. */
function openCard(title: string): void {
  fireEvent.click(within(list()).getByRole('button', { name: title }))
}

describe('JobListAction visibility', () => {
  it('renders nothing while the session has no jobs', () => {
    const { container } = render(<JobListAction {...bench(undefined).props} />)
    expect(container.innerHTML).toBe('')
  })

  it('counts live jobs, and falls back to the whole set once none are live', () => {
    const b = bench([job(), job({ id: 'bash-2' as JobView['id'] })])
    const view = show(b)
    expect(trigger().getAttribute('aria-label')).toBe(t('count.live.other', { count: 2 }))

    b.set([job()])
    update(view, b)
    expect(trigger().getAttribute('aria-label')).toBe(t('count.live.one', { count: 1 }))

    b.set([silentJob()])
    update(view, b)
    expect(trigger().getAttribute('aria-label')).toBe(t('count.idle.one', { count: 1 }))

    b.set([silentJob(), silentJob({ id: 'bash-2' as JobView['id'] })])
    update(view, b)
    expect(trigger().getAttribute('aria-label')).toBe(t('count.idle.other', { count: 2 }))
  })

  it('closes the list and unmounts when the last job disappears', () => {
    const b = bench([job()])
    const view = show(b)
    openList()
    expect(list()).toBeDefined()

    b.set([])
    update(view, b)
    expect(view.container.innerHTML).toBe('')
  })
})

describe('JobListAction rows', () => {
  it('orders live rows newest start first, then settled rows newest finish first', () => {
    const b = bench([
      job({ id: 'bash-3' as JobView['id'], title: 'old done', status: 'completed', finishedAt: START + 1_000 }),
      job({ id: 'bash-4' as JobView['id'], title: 'new done', status: 'failed', finishedAt: START + 9_000 }),
      job({ id: 'bash-2' as JobView['id'], title: 'later live', startedAt: START + 5_000 }),
      job({ id: 'bash-1' as JobView['id'], title: 'earlier live' }),
    ])
    show(b)
    openList()
    expandSettled()
    expect(rowNames()).toEqual(['later live', 'earlier live', 'new done', 'old done'])
  })

  it('breaks a settled tie on the newest start, so map iteration never decides it', () => {
    const b = bench([
      job({
        id: 'bash-2' as JobView['id'], title: 'second', status: 'completed',
        startedAt: START + 10, finishedAt: START + 100,
      }),
      job({ id: 'bash-1' as JobView['id'], title: 'first', status: 'completed', startedAt: START, finishedAt: START + 100 }),
    ])
    show(b)
    openList()
    expect(rowNames()).toEqual(['second', 'first'])
  })

  it('names a job by its producer title, its known kind, or its capitalized producer id', () => {
    const b = bench([
      job({ id: 'bash-5' as JobView['id'], kind: 'bash', title: 'Build the Web bundle' }),
      job({ id: 'bash-1' as JobView['id'], kind: 'pwsh' }),
      job({ id: 'bash-2' as JobView['id'], kind: 'subagent' }),
      job({ id: 'bash-3' as JobView['id'], kind: 'workflow' }),
      job({ id: 'bash-4' as JobView['id'], kind: 'pty-send' }),
    ])
    show(b)
    openList()
    expect(rowNames()).toEqual(['Build the Web bundle', t('kind.pwsh'), t('kind.subagent'), t('kind.workflow'), 'Pty-send'])
  })

  it('says how a settled row ended, and leaves work that is still live to its run time', () => {
    const b = bench([
      job({ id: 'bash-1' as JobView['id'], title: 'running' }),
      job({ id: 'bash-2' as JobView['id'], title: 'stopping', status: 'stopping' }),
      job({ id: 'bash-3' as JobView['id'], title: 'done', status: 'completed', finishedAt: START }),
      job({ id: 'bash-4' as JobView['id'], title: 'stopped', status: 'killed', finishedAt: START }),
      job({ id: 'bash-5' as JobView['id'], title: 'failed', status: 'failed', finishedAt: START }),
    ])
    show(b)
    openList()
    expandSettled()
    expect(rowText('running')).not.toContain(t('status.running'))
    expect(rowText('stopping')).not.toContain(t('status.stopping'))
    expect(rowText('done')).toContain(t('status.completed'))
    expect(rowText('stopped')).toContain(t('status.killed'))
    expect(rowText('failed')).toContain(t('status.failed'))
  })

  it('carries the producer progress while live and the terminal detail once settled', () => {
    const b = bench([
      job({ id: 'bash-1' as JobView['id'], title: 'live', progress: '3/10 files' }),
      job({ id: 'bash-2' as JobView['id'], title: 'done', status: 'failed', finishedAt: START, detail: 'exit code: 3' }),
    ])
    show(b)
    openList()

    fireEvent.click(rowToggle('live'))
    expect(facts()[zh['facts.progress']]).toBe('3/10 files')
    expandSettled()
    fireEvent.click(rowToggle('done'))
    expect(facts()[zh['facts.details']]).toBe('exit code: 3')
    expect(facts()[zh['facts.result']]).toBe(t('status.failed'))
  })

  it('counts a live run time up, ticking every second', () => {
    const b = bench([
      job({ id: 'bash-1' as JobView['id'], title: 'seconds' }),
      job({ id: 'bash-2' as JobView['id'], title: 'minutes', startedAt: START - 125_000 }),
      job({ id: 'bash-3' as JobView['id'], title: 'hours', startedAt: START - 7_380_000 }),
    ])
    show(b)
    openList()
    expect(rowText('seconds')).toContain(t('duration.seconds', { seconds: '00' }))
    expect(rowText('minutes')).toContain(t('duration.minutes', { minutes: '02', seconds: '05' }))
    expect(rowText('hours')).toContain(t('duration.hours', { hours: '02', minutes: '03' }))
    expect(within(rowToggle('hours')).getByTitle(
      t('duration.title.live', { duration: t('duration.hours', { hours: '02', minutes: '03' }) }),
    )).toBeDefined()

    act(() => { vi.advanceTimersByTime(2_000) })
    expect(rowText('seconds')).toContain(t('duration.seconds', { seconds: '02' }))
  })

  it('reads each settled row as how long ago it ended, refreshing half a minute at a time', () => {
    const b = bench([
      job({ id: 'bash-1' as JobView['id'], title: 'now', status: 'completed', finishedAt: START }),
      job({ id: 'bash-2' as JobView['id'], title: 'minutes', status: 'completed', finishedAt: START - 300_000 }),
      job({ id: 'bash-3' as JobView['id'], title: 'hour', status: 'completed', finishedAt: START - 3_600_000 }),
      job({ id: 'bash-4' as JobView['id'], title: 'hours', status: 'completed', finishedAt: START - 7_200_000 }),
      job({ id: 'bash-5' as JobView['id'], title: 'day', status: 'completed', finishedAt: START - 86_400_000 }),
      job({ id: 'bash-6' as JobView['id'], title: 'days', status: 'completed', finishedAt: START - 172_800_000 }),
    ])
    show(b)
    openList()
    expect(rowText('now')).toContain(t('ago.now'))
    expect(rowText('minutes')).toContain(t('ago.minutes', { n: '05' }))
    expect(rowText('hour')).toContain(t('ago.hour', { n: '01' }))
    expect(rowText('hours')).toContain(t('ago.hours', { n: '02' }))
    expect(rowText('day')).toContain(t('ago.day', { n: '01' }))
    expect(rowText('days')).toContain(t('ago.days', { n: '02' }))

    act(() => { vi.advanceTimersByTime(60_000) })
    expect(rowText('now')).toContain(t('ago.minutes', { n: '01' }))
    expect(rowText('minutes')).toContain(t('ago.minutes', { n: '06' }))
  })

  it('reads a settled row with no finish time as zero duration, ordered by start', () => {
    const b = bench([
      job({ id: 'bash-1' as JobView['id'], title: 'no finish', status: 'completed' }),
      job({
        id: 'bash-2' as JobView['id'], title: 'finished', status: 'completed',
        startedAt: START + 5_000, finishedAt: START + 2_000,
      }),
      job({ id: 'bash-3' as JobView['id'], title: 'older', status: 'failed', startedAt: START - 10_000 }),
    ])
    show(b)
    openList()
    // Rows without a finish time fall back to their start, so a clock that
    // moved backwards still never renders a negative time.
    expect(rowNames()).toEqual(['finished', 'no finish', 'older'])
    expect(rowText('finished')).toContain(t('ago.now'))

    fireEvent.click(rowToggle('no finish'))
    expect(facts()[zh['facts.ranFor']]).toBe(t('duration.seconds', { seconds: '00' }))
  })
})

describe('JobListAction foldout', () => {
  it('folds a settled job that printed nothing out into its facts, command, and an empty output card', () => {
    const b = bench([settledJob({
      id: 'subagent-1' as JobView['id'], kind: 'subagent', title: 'A01 FileService coverage',
      label: 'A01 FileService coverage', output: { total: 0, earliest: 0 },
    })])
    show(b)
    openList()
    expect(rowText('A01 FileService coverage')).toContain(t('status.completed'))

    fireEvent.click(rowToggle('A01 FileService coverage'))
    expect(b.observe).not.toHaveBeenCalled()
    expect(facts()[zh['facts.started']]).toBeDefined()
    expect(facts()[zh['facts.ended']]).toContain(t('ago.now'))
    expect(facts()[zh['facts.ranFor']]).toBe(t('duration.seconds', { seconds: '03' }))
    expect(facts()[zh['facts.result']]).toBe(t('status.completed'))

    openCard(zh['panel.command'])
    expect(list().textContent).toContain('A01 FileService coverage')
    expect(within(list()).getByRole('button', { name: zh['terminal.copy'] })).toBeDefined()

    openCard(zh['panel.output'])
    expect(list().textContent).toContain(zh['panel.noOutput'])
    // A card with nothing to copy keeps its header to the title alone.
    expect(within(list()).getAllByRole('button', { name: zh['terminal.copy'] })).toHaveLength(1)
  })

  it('folds a settled row with retained output out and renders the output it holds', () => {
    const b = bench([settledJob({ title: 'build' })])
    const view = show(b)
    openList()
    fireEvent.click(rowToggle('build'))
    expect(b.observe).toHaveBeenCalledWith(SESSION, 'bash-1')

    openCard(zh['panel.output'])
    expect(list().textContent).toContain(zh['panel.noOutput'])

    b.set([settledJob({ title: 'build' })], { 'bash-1': observed({ text: 'built in 3s\n', streaming: false }) })
    update(view, b)
    expect(list().textContent).toContain('built in 3s')
    fireEvent.scroll(list().querySelector('pre') as HTMLElement)
    expect(list().textContent).toContain('built in 3s')

    // The gap marker reports bytes the ring no longer holds.
    b.set([settledJob({ title: 'build' })], { 'bash-1': observed({ text: 'tail\n', gapBefore: true, streaming: false }) })
    update(view, b)
    expect(list().textContent).toContain(zh['output.gap'])

    b.set([settledJob({ title: 'build' })], { 'bash-1': observed({ error: 'stream lost' }) })
    update(view, b)
    expect(list().textContent).toContain(t('output.error', { error: 'stream lost' }))
  })

  it('waits for output on a live row', () => {
    const b = bench([job({ title: 'build' })])
    show(b)
    openList()
    fireEvent.click(rowToggle('build'))
    openCard(zh['panel.output'])
    expect(list().textContent).toContain(zh['panel.waiting'])
  })

  it('folds an expanded row away when the roster drops it', () => {
    const b = bench([job({ title: 'build' })])
    const view = show(b)
    openList()
    fireEvent.click(rowToggle('build'))

    b.set([silentJob({ id: 'bash-2' as JobView['id'], title: 'other' })])
    update(view, b)
    expect(list().textContent).not.toContain(zh['facts.started'])
    expect(rowNames()).toEqual(['other'])
  })

  it('follows an open row stream, and releases it when the row collapses or the list closes', () => {
    const b = bench([settledJob({ title: 'build' })])
    show(b)
    openList()
    expect(b.observe).not.toHaveBeenCalled()

    fireEvent.click(rowToggle('build'))
    expect(b.observe).toHaveBeenCalledWith(SESSION, 'bash-1')
    fireEvent.click(rowToggle('build', true))
    expect(b.stops[0]).toHaveBeenCalledTimes(1)

    fireEvent.click(rowToggle('build'))
    openList()
    expect(b.stops[1]).toHaveBeenCalledTimes(1)
    expect(b.observe).toHaveBeenCalledTimes(2)
  })
})

describe('JobListAction sections', () => {
  it('folds the settled tail while live work exists, and folds it back on request', () => {
    const b = bench([job({ title: 'live' }), silentJob({ id: 'bash-2' as JobView['id'], title: 'done' })])
    show(b)
    openList()
    expect(rowNames()).toEqual(['live'])

    const settledToggle = within(list()).getByRole('button', { name: t('section.settledCount', { count: 1 }) })
    fireEvent.click(settledToggle)
    expect(rowNames()).toEqual(['live', 'done'])

    fireEvent.click(settledToggle)
    expect(rowNames()).toEqual(['live'])
  })

  it('hides cleared rows at once, folding the open one and dropping each from the registry', () => {
    const b = bench([
      job({ id: 'bash-3' as JobView['id'], title: 'live' }),
      silentJob({ id: 'bash-1' as JobView['id'], title: 'one' }),
      silentJob({ id: 'bash-2' as JobView['id'], title: 'two' }),
    ])
    show(b)
    openList()
    expandSettled()
    fireEvent.click(rowToggle('one'))
    expect(list().textContent).toContain(zh['facts.started'])

    fireEvent.click(within(list()).getByRole('button', { name: zh['section.clear'] }))
    expect(b.removeJob).toHaveBeenCalledWith(SESSION, 'bash-1')
    expect(b.removeJob).toHaveBeenCalledWith(SESSION, 'bash-2')
    expect(rowNames()).toEqual(['live'])
    expect(list().textContent).not.toContain(zh['facts.started'])
  })

  it('takes the whole control away once the last settled row is cleared', () => {
    const b = bench([silentJob({ title: 'one' })])
    const view = show(b)
    openList()
    fireEvent.click(within(list()).getByRole('button', { name: zh['section.clear'] }))
    expect(b.removeJob).toHaveBeenCalledWith(SESSION, 'bash-1')
    expect(view.container.innerHTML).toBe('')
  })
})

describe('JobListAction dismissal', () => {
  it('closes on Escape and returns focus to the trigger', () => {
    const b = bench([job()])
    show(b)
    const header = trigger()
    openList()
    expect(header.getAttribute('aria-expanded')).toBe('true')

    fireEvent.keyDown(header, { key: 'Escape' })
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(header)
  })

  it('ignores other keys and a closed-list Escape', () => {
    const b = bench([job()])
    show(b)
    const header = trigger()
    fireEvent.keyDown(header, { key: 'Escape' })
    expect(header.getAttribute('aria-expanded')).toBe('false')

    openList()
    fireEvent.keyDown(header, { key: 'ArrowDown' })
    expect(header.getAttribute('aria-expanded')).toBe('true')
  })

  it('closes on an outside pointer press but not on one inside', () => {
    const b = bench([job()])
    show(b)
    const header = trigger()
    openList()

    fireEvent.pointerDown(list())
    expect(header.getAttribute('aria-expanded')).toBe('true')

    fireEvent.pointerDown(document.body)
    expect(header.getAttribute('aria-expanded')).toBe('false')
  })

  it('leaves the list open while the stop dialog owns Escape', () => {
    const b = bench([job({ title: 'build' })])
    show(b)
    const header = trigger()
    openList()
    fireEvent.click(within(list()).getByRole('button', { name: t('kill.stop') }))

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBe(null)
    expect(header.getAttribute('aria-expanded')).toBe('true')
  })
})

describe('JobListAction stop', () => {
  /** Press a row's stop control, with the list already open. */
  function pressStop(): void {
    fireEvent.click(within(list()).getByRole('button', { name: t('kill.stop') }))
  }

  it('offers a stop only on a running row, and confirms before killing', () => {
    const b = bench([
      job({ id: 'bash-1' as JobView['id'], title: 'live' }),
      silentJob({ id: 'bash-2' as JobView['id'], title: 'done' }),
    ])
    show(b)
    openList()
    expect(within(list()).getAllByRole('button', { name: t('kill.stop') })).toHaveLength(1)

    pressStop()
    expect(screen.getByRole('dialog', { name: t('confirm.title', { name: 'live' }) })).toBeDefined()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: t('confirm.cancel') }))
    expect(b.killJob).not.toHaveBeenCalled()

    pressStop()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: t('confirm.stop') }))
    expect(b.killJob).toHaveBeenCalledWith(SESSION, 'bash-1')
  })

  it('keeps the stop pending until the row itself settles', async () => {
    const b = bench([job({ title: 'live' })])
    const view = show(b)
    openList()
    pressStop()
    await act(async () => {
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: t('confirm.stop') }))
    })

    const pending = within(list()).getByRole('button', { name: t('kill.pending') })
    expect(pending.hasAttribute('disabled')).toBe(true)

    b.set([silentJob({ title: 'live' })])
    update(view, b)
    expect(within(list()).queryByRole('button', { name: t('kill.pending') })).toBe(null)
  })

  it('reports a refused kill and resets the hint on its own', async () => {
    const b = bench([job({ title: 'live' })])
    show(b)
    b.killJob.mockResolvedValue(false)
    openList()
    pressStop()
    await act(async () => {
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: t('confirm.stop') }))
    })
    expect(within(list()).getByRole('button', { name: t('kill.failed') })).toBeDefined()

    act(() => { vi.advanceTimersByTime(4_000) })
    expect(within(list()).getByRole('button', { name: t('kill.stop') })).toBeDefined()
  })

  it('leaves no failed hint behind when the row settles before the answer arrives', async () => {
    const answers: ((ok: boolean) => void)[] = []
    const b = bench([job({ title: 'live' })])
    const view = show(b)
    b.killJob.mockImplementation(() => new Promise<boolean>((resolve) => { answers.push(resolve) }))
    openList()
    pressStop()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: t('confirm.stop') }))

    b.set([silentJob({ title: 'live' })])
    update(view, b)
    await act(async () => { answers[0]?.(false) })
    expect(within(list()).queryByRole('button', { name: t('kill.failed') })).toBe(null)
  })

  it('kills nothing when the row settles while the dialog is open', () => {
    const b = bench([job({ title: 'live' })])
    const view = show(b)
    openList()
    pressStop()

    b.set([silentJob({ title: 'live' })])
    update(view, b)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: t('confirm.stop') }))
    expect(b.killJob).not.toHaveBeenCalled()
  })
})

describe('JobListAction popover fit', () => {
  /** Place the open popover at a viewport position, as the real layout would. */
  function place(left: number, right: number): void {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left, right, width: right - left, top: 40, bottom: 80, height: 40, x: left, y: 40, toJSON: () => ({}),
    })
  }

  it('shifts the popover back inside the viewport and refits on resize', () => {
    const b = bench([job()])
    show(b)
    place(2, 400)
    openList()
    expect(list().style.getPropertyValue('--activity-shift')).toBe('10px')

    place(900, 1_200)
    fireEvent(window, new Event('resize'))
    expect(list().style.getPropertyValue('--activity-shift')).toBe('-188px')

    place(100, 400)
    fireEvent(window, new Event('resize'))
    expect(list().style.getPropertyValue('--activity-shift')).toBe('0px')
  })

  it('keeps the stylesheet anchor when the popover has no measured box', () => {
    const b = bench([job()])
    show(b)
    openList()
    expect(list().style.getPropertyValue('--activity-shift')).toBe('0px')
  })
})

describe('JobListAction clock', () => {
  it('runs no clock while the list is closed', () => {
    const interval = vi.spyOn(globalThis, 'setInterval')
    show(bench([job()]))
    expect(interval).not.toHaveBeenCalled()
  })

  it('ticks every second while work is live, and half a minute once only settled rows are left', () => {
    const interval = vi.spyOn(globalThis, 'setInterval')
    const b = bench([job()])
    const view = show(b)
    openList()
    expect(interval.mock.calls.at(-1)?.[1]).toBe(1_000)

    b.set([silentJob()])
    update(view, b)
    expect(interval.mock.calls.at(-1)?.[1]).toBe(30_000)
  })
})
