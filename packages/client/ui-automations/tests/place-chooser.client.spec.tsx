// @vitest-environment jsdom
/**
 * The bots page's place chooser: an open card offers Aeven Cloud and each desktop of the account, a place that cannot
 * give the bot what it uses stays listed with the reason, an offline desktop can be chosen, a choice saves the bot's
 * new place, and a bot placed on one desktop names it on its card.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { makeTranslate } from '@aeven/client-test-runtime'
import { AutomationsPanel, type AutomationList, type Desktop, type Task } from '../src/client/AutomationsPanel.tsx'
import { en } from '../src/client/locales.ts'

const t = makeTranslate(en)
const NOW = Date.now()

beforeAll(() => {
  // The card list measures itself; jsdom has no layout to observe.
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

/** A bot needing nothing from a computer, placed in the cloud; each case overrides what it cares about. */
function task(over: Partial<Task> = {}): Task {
  return {
    id: 'bot-1', name: 'Morning news', prompt: 'Summarise the morning news.', permission: 'read-only', status: 'active',
    schedule: { kind: 'daily', time: '08:00', timeZone: 'UTC' }, nextRunAt: null, lastRun: null, webhook: false,
    requires: [], runOn: 'auto', placement: { runsOn: 'cloud', available: true },
    ...over,
  }
}

const DESKTOPS: Desktop[] = [
  { device: 'device-1', name: 'MacBook', present: true, self: true, provides: ['files', 'browser', 'computer-use'] },
  { device: 'device-2', name: 'Ubuntu VM', present: false, seenAt: NOW - 2 * 3_600_000, self: false, provides: ['files'] },
  { device: 'device-3', name: 'Old laptop', present: true, self: false },
]

/** Mount the page over one bot and record every management call. */
function mount(bot: Task) {
  const data: AutomationList = {
    definitions: [bot], runs: [],
    capabilities: { host: 'device', triggers: ['daily'], webhook: false },
    hosts: { cloud: true, desktops: DESKTOPS },
  }
  const call = vi.fn(async (_operation: string, _payload: unknown) => ({}))
  const props = {
    t, inputActions: { setDraft: vi.fn() },
    list: async () => data, call, openRun: vi.fn(), view: 'automations', showView: vi.fn(),
    services: async () => null, openConnector: vi.fn(),
    useGeneration: (select: (generation: object | undefined) => boolean) => select({}),
  }
  const Panel = AutomationsPanel as unknown as (p: typeof props) => ReturnType<typeof AutomationsPanel>
  render(<Panel {...props} />)
  return { call }
}

/** Open the bot's card and its place chooser. */
async function openChooser(name: string): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(name) }))
  fireEvent.click(screen.getByRole('button', { name: en.placeChoose }))
  return screen.findByRole('dialog')
}

/** The row button of one place in the open chooser. */
const row = (dialog: HTMLElement, name: string): HTMLElement => within(dialog).getByRole('button', { name: new RegExp(name) })

describe('bot place chooser', () => {
  it('offers Aeven Cloud first and each desktop with its status', async () => {
    mount(task())
    const dialog = await openChooser('Morning news')
    const rows = within(dialog).getAllByRole('button').filter(button => button.closest('li') !== null)
    expect(rows.map(button => button.textContent)).toEqual([
      `${en.runsOnCloud}${en.placeCloudStatus}`,
      `MacBook${en.placeSelf}`,
      `Ubuntu VM${t('placeSeen', { when: t('placeTimeHours', { n: '2' }) })}`,
      `Old laptop${en.placeUpdate}`,
    ])
    expect(row(dialog, en.runsOnCloud).getAttribute('aria-current')).toBe('true')
    expect(row(dialog, 'Old laptop')).toHaveProperty('disabled', true)
    expect(row(dialog, 'Ubuntu VM')).toHaveProperty('disabled', false)
  })

  it('saves an offline desktop as the bot\'s place', async () => {
    const { call } = mount(task())
    const dialog = await openChooser('Morning news')
    fireEvent.click(row(dialog, 'Ubuntu VM'))
    await waitFor(() => { expect(call).toHaveBeenCalledWith('update', { id: 'bot-1', patch: { runOn: 'device', desktop: 'device-2' } }) })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('keeps a bot that uses your files out of the cloud and off a desktop that cannot reach them', async () => {
    const { call } = mount(task({ requires: ['browser'], runOn: 'device', placement: { runsOn: 'device', available: true } }))
    const dialog = await openChooser('Morning news')
    expect(row(dialog, en.runsOnCloud)).toHaveProperty('disabled', true)
    expect(row(dialog, en.runsOnCloud).textContent).toContain(t('placeNeeds', { needs: en.needBrowser }))
    expect(row(dialog, 'Ubuntu VM')).toHaveProperty('disabled', true)
    expect(row(dialog, 'MacBook')).toHaveProperty('disabled', false)
    fireEvent.click(row(dialog, en.runsOnCloud))
    expect(call).not.toHaveBeenCalledWith('update', expect.anything())
  })

  it('names the chosen desktop on the card and marks it in the chooser', async () => {
    mount(task({ runOn: 'device', desktop: 'device-2', placement: { runsOn: 'device', available: true } }))
    const card = await screen.findByRole('button', { name: /Morning news/ })
    expect(card.textContent).toContain('Ubuntu VM')
    const dialog = await openChooser('Morning news')
    expect(row(dialog, 'Ubuntu VM').getAttribute('aria-current')).toBe('true')
    expect(row(dialog, en.runsOnCloud).getAttribute('aria-current')).toBeNull()
    expect(screen.getByText(t('placementDesktopChosen', { name: 'Ubuntu VM' }))).toBeTruthy()
  })
})
