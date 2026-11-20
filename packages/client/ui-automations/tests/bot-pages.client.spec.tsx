// @vitest-environment jsdom
/**
 * The bot pages: the overview drafts an idea into the composer without sending it and opens a bot's page from its
 * card, the options menu offers Edit before Delete, a bot's page deletes through the page's own dialog, and an address
 * naming no bot shows a not-found state.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { makeTranslate } from '@aeven/client-test-runtime'
import { AutomationsPanel } from '../src/client/AutomationsPanel.tsx'
import type { AutomationList, AutomationView, Task } from '../src/client/model.ts'
import { en } from '../src/client/locales.ts'

const t = makeTranslate(en)
const BOT = '3a2b1c0d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'

beforeAll(() => {
  // The facts grids measure themselves; jsdom has no layout to observe.
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** A daily cloud bot; each case overrides what it cares about. */
function task(over: Partial<Task> = {}): Task {
  return {
    id: BOT, name: 'Nightly AI radar', prompt: 'Produce a compact nightly digest of AI news.', permission: 'read-only', status: 'active',
    triggers: [{ kind: 'schedule', schedule: { kind: 'daily', time: '06:00', timeZone: 'UTC' } }], connectors: 'all', overlap: 'skip',
    grants: [], nextRunAt: null, lastRun: null, webhook: false, requires: [], runOn: 'auto', placement: { runsOn: 'cloud', available: true },
    ...over,
  }
}

/** Mount one bot page over the given bots and record the operations it calls. */
function mount(view: AutomationView, bots: Task[], address = view === 'bot' ? `/bots/${BOT}` : view === 'runs' ? '/bots/runs' : '/bots') {
  const data: AutomationList = { definitions: bots, runs: [], capabilities: { host: 'cloud', triggers: ['daily', 'weekly'], webhook: false } }
  const call = vi.fn(async (_operation: string, _payload: unknown) => ({}))
  const inputActions = { setDraft: vi.fn(), submit: vi.fn() }
  const showView = vi.fn()
  const showBot = vi.fn()
  const props = {
    t, inputActions, call, view, showView, showBot,
    list: async () => data, openRun: vi.fn(), services: async () => null, openConnector: vi.fn(),
    useGeneration: (select: (generation: object | undefined) => boolean) => select({}),
    useAddress: (select: (value: string | undefined) => string | undefined) => select(address),
  }
  const Panel = AutomationsPanel as unknown as (p: typeof props) => ReturnType<typeof AutomationsPanel>
  render(<Panel {...props} />)
  return { call, inputActions, showView, showBot }
}

describe('bot overview', () => {
  it('puts an idea in the composer without sending it', async () => {
    const { inputActions } = mount('overview', [task()])
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(en.roleMarketingTitle) }))
    expect(inputActions.setDraft).toHaveBeenCalledWith(expect.stringContaining('marketing assistant'))
    expect(inputActions.submit).not.toHaveBeenCalled()
  })

  it('shows the empty state above the ideas while the account has no bot', async () => {
    mount('overview', [])
    expect(await screen.findByText(en.empty)).toBeTruthy()
    expect(screen.getByText(en.roleSalesTitle)).toBeTruthy()
  })

  it('opens a bot\'s page from its card and offers no New action', async () => {
    const { showBot } = mount('overview', [task()])
    const link = await screen.findByRole('link', { name: /Nightly AI radar/ })
    expect(link.getAttribute('href')).toBe(`/bots/${BOT}`)
    fireEvent.click(link)
    expect(showBot).toHaveBeenCalledWith(BOT)
    expect(screen.queryByRole('button', { name: 'New' })).toBeNull()
  })
})

describe('bot options menu', () => {
  it('lists Edit before Delete, and Edit on the overview opens the bot\'s page', async () => {
    const { showBot, call } = mount('overview', [task()])
    fireEvent.click(await screen.findByRole('button', { name: en.more }))
    const items = await screen.findAllByRole('menuitem')
    expect(items.map(item => item.textContent)).toEqual([en.edit, en.remove])
    fireEvent.click(items[0]!)
    expect(showBot).toHaveBeenCalledWith(BOT)
    expect(call).not.toHaveBeenCalledWith('delete', expect.anything())
  })

  it('keeps the reader on the bot\'s page when Edit is chosen there', async () => {
    const { showBot } = mount('bot', [task()])
    fireEvent.click(await screen.findByRole('button', { name: en.more }))
    fireEvent.click(await screen.findByRole('menuitem', { name: en.edit }))
    expect(showBot).not.toHaveBeenCalled()
  })
})

describe('bot page', () => {
  it('deletes through the options menu and the page\'s own dialog, then returns to the overview', async () => {
    const { call, showView } = mount('bot', [task()])
    fireEvent.click(await screen.findByRole('button', { name: en.more }))
    fireEvent.click(await screen.findByRole('menuitem', { name: en.remove }))
    const dialog = await screen.findByRole('dialog')
    expect(call).not.toHaveBeenCalledWith('delete', expect.anything())
    fireEvent.click(within(dialog).getByRole('button', { name: en.remove }))
    await waitFor(() => { expect(call).toHaveBeenCalledWith('delete', { id: BOT }) })
    await waitFor(() => { expect(showView).toHaveBeenCalledWith('overview') })
  })

  it('shows the whole task and keeps Advanced open', async () => {
    const prompt = Array.from({ length: 12 }, (_, line) => `Step ${String(line + 1)}`).join('\n')
    mount('bot', [task({ prompt })])
    expect((await screen.findByText(/Step 12/)).textContent).toBe(prompt)
    expect(screen.getByText(en.advanced)).toBeTruthy()
    expect(screen.getByText(en.overlapSkip)).toBeTruthy()
  })

  it('shows a not-found state with the way back for an address naming no bot', async () => {
    const { showView } = mount('bot', [])
    expect(await screen.findByText(en.notFound)).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: en.backToBots }).at(-1)!)
    expect(showView).toHaveBeenCalledWith('overview')
  })
})
