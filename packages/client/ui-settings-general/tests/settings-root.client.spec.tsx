// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect, useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@aeven/client-test-runtime'
import type { SettingsRootComponentProps } from '../src/client/shell-contract.ts'
import type { SettingsAddress } from '../src/client/settings-url.ts'
import { SettingsRoot } from '../src/client/SettingsRoot.tsx'
import { en } from '../src/client/locales.ts'

// jsdom has no scrollIntoView; the panel calls it on the active nav cell.
const scrollIntoView = vi.fn()

/** jsdom has no ResizeObserver; the panel measures its scrollbar from one. */
const resizeObservers: { callback: ResizeObserverCallback; targets: Element[]; disconnected: boolean }[] = []
class ResizeObserverStub {
  private readonly record: (typeof resizeObservers)[number]
  constructor(callback: ResizeObserverCallback) {
    this.record = { callback, targets: [], disconnected: false }
    resizeObservers.push(this.record)
  }

  observe(target: Element) { this.record.targets.push(target) }
  disconnect() { this.record.disconnected = true }
}

beforeEach(() => {
  Element.prototype.scrollIntoView = scrollIntoView
  scrollIntoView.mockClear()
  resizeObservers.length = 0
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

type Row = { id: string; order: number; label: string }
type Step = { id: string; order: number }

/** Handle of the most recent mount, so openPanel() can write that mount's address. */
let mountedHandle: { requestOpen: (section?: string) => void } | undefined

/** Slot-content stand-ins: the shell renders whatever the seats contribute. */
const SEAT_CONTENT: Record<string, string> = {
  'settings.header': 'Settings Title',
  'settings.action': 'Open configuration file',
  'settings.close': 'Close',
}

type AttentionSnapshot = Parameters<Parameters<SettingsRootComponentProps['useSessionPendingInteraction']>[0]>[0]
type ConnectionSnapshot = Parameters<Parameters<SettingsRootComponentProps['useConnectionState']>[0]>[0]
const noAttention: AttentionSnapshot = new Map()
const useSessionPendingInteraction: SettingsRootComponentProps['useSessionPendingInteraction'] = selector => selector(noAttention)

function mount({
  wide = true,
  connectionState = 'connected',
  onboardingActive = true,
  rows = [
    { id: 'general', order: 0, label: 'General' },
    { id: 'models', order: 10, label: 'Models' },
    { id: 'agent-presets', order: 20, label: 'Agent presets' },
  ],
  steps = [
    { id: 'welcome', order: -100 },
    { id: 'credential', order: 0 },
  ],
}: {
  wide?: boolean
  connectionState?: ConnectionSnapshot
  onboardingActive?: boolean
  rows?: Row[]
  steps?: Step[]
} = {}) {
  // Mutable row source standing in for the bound useSections hook; bump()
  // plays a ledger change through the same observable contract.
  let current = rows
  // Mutable address source standing in for the bound useSettingsAddress hook;
  // show/close play the injected commands that write the browser address.
  let address: SettingsAddress | undefined
  let currentConnectionState = connectionState
  const listeners = new Set<() => void>()
  const connectionListeners = new Set<() => void>()
  const addressListeners = new Set<() => void>()
  const reconnect = vi.fn()
  const setAddress = (next: SettingsAddress | undefined) => {
    act(() => {
      address = next
      for (const fn of [...addressListeners]) fn()
    })
  }
  const show = vi.fn((section?: string) => { setAddress(section === undefined ? {} : { section }) })
  const close = vi.fn(() => { setAddress(undefined) })
  const requestOpen = (section?: string) => { show(section) }
  const renderSlot = vi.fn(
    ((key: string, _owner: unknown, opts?: { only?: string }) => {
      if (key === 'settings.section') return <div data-testid={`section-${opts?.only ?? 'all'}`} />
      return SEAT_CONTENT[key]
    }) as SettingsRootComponentProps['renderSlot'],
  )
  const useSessions = ((select: (state: unknown) => unknown) => select(onboardingActive
    ? { phase: 'ready', current: undefined, byId: {} }
    : {
      phase: 'ready',
      current: 'active-session',
      byId: { 'active-session': { blank: false } },
    })) as never
  const unusedHook = (() => { throw new Error('unused by SettingsRoot') }) as never
  const props: SettingsRootComponentProps = {
    useSessions,
    useSessionPendingInteraction,
    useWorkspaces: unusedHook,
    wide,
    reconnect,
    show,
    close,
    t: makeTranslate(en),
    useConnectionState: (select) => {
      const [, force] = useState(0)
      useEffect(() => {
        const listener = () => { force(n => n + 1) }
        connectionListeners.add(listener)
        return () => { connectionListeners.delete(listener) }
      }, [])
      return select(currentConnectionState)
    },
    useSettingsAddress: (select) => {
      const [, force] = useState(0)
      useEffect(() => {
        const listener = () => { force(n => n + 1) }
        addressListeners.add(listener)
        return () => { addressListeners.delete(listener) }
      }, [])
      return select(address)
    },
    useOnboardingSteps: select => select(steps),
    useSections: (select) => {
      const [, force] = useState(0)
      useEffect(() => {
        const listener = () => { force(n => n + 1) }
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      }, [])
      return select(current)
    },
    renderSlot,
  }
  const view = render(<SettingsRoot {...props} />)
  const bump = (next: Row[]) => {
    act(() => {
      current = next
      for (const fn of [...listeners]) fn()
    })
  }
  const setConnectionState = (next: typeof currentConnectionState) => {
    act(() => {
      currentConnectionState = next
      for (const fn of [...connectionListeners]) fn()
    })
  }
  const handle = {
    view, renderSlot, bump, listeners, reconnect, setConnectionState, requestOpen, addressListeners, show, close,
  }
  mountedHandle = handle
  return handle
}

function openPanel() {
  mountedHandle!.requestOpen()
}

describe('SettingsRoot', () => {
  it('opens the panel from the address and stops observing it on unmount', () => {
    const { view, requestOpen, addressListeners } = mount()
    expect(screen.queryByRole('dialog')).toBeNull()
    requestOpen()
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByTestId('section-general')).toBeTruthy()
    view.unmount()
    expect(addressListeners.size).toBe(0)
  })

  it('shows outage, retry progress, and a two-second recovery confirmation', () => {
    vi.useFakeTimers()
    const mounted = mount()
    expect(screen.queryByRole('button', { name: 'Disconnected, reconnect now' })).toBeNull()

    mounted.setConnectionState('disconnected')
    // The toast states the outage in its own label; the reconnect action beside
    // it carries the state in its accessible name.
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Disconnected')
    expect(alert.querySelector('svg')).toBeTruthy()
    const indicator = screen.getByRole('button', { name: 'Disconnected, reconnect now' })
    expect(indicator.textContent).toBe('Reconnect now')
    expect(indicator.hasAttribute('title')).toBe(false)
    fireEvent.click(indicator)
    expect(mounted.reconnect).toHaveBeenCalledOnce()

    mounted.setConnectionState('connecting')
    expect(screen.getByRole('alert').textContent).toContain('Connecting...')
    expect(screen.getByRole('button', { name: 'Connecting, restart now' }).textContent)
      .toBe('Reconnect now')

    mounted.setConnectionState('connected')
    // The confirmation toast carries its own dismiss control, so its role and
    // its visible text are what say the state landed.
    const recovered = () => screen.getByRole('status').textContent
    expect(recovered()).toContain('Connected')
    act(() => { vi.advanceTimersByTime(1_999) })
    expect(recovered()).toContain('Connected')
    act(() => { vi.advanceTimersByTime(1) })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('keeps the reconnect toast out of the sidebar whatever its width', () => {
    mount({ wide: false, connectionState: 'disconnected' })
    // The toast is portaled to the document body, so a collapsed sidebar — or
    // any transformed ancestor — cannot clip it.
    const alert = screen.getByRole('alert')
    expect(alert.parentElement).toBe(document.body)
    expect(screen.getByRole('button', { name: 'Disconnected, reconnect now' })).toBeTruthy()
  })
})

describe('SettingsPanel chrome seats', () => {
  it('names the dialog via aria-labelledby pointing at the header seat node', () => {
    mount()
    openPanel()
    const dialog = screen.getByRole('dialog')
    const titleId = dialog.getAttribute('aria-labelledby')!
    expect(titleId).toBeTruthy()
    const title = document.getElementById(titleId)!
    expect(title.textContent).toBe('Settings Title')
    expect(screen.getByRole('dialog', { name: 'Settings Title' })).toBeTruthy()
  })

  it('names the close button through the visually-hidden close seat text', () => {
    mount()
    openPanel()
    const close = screen.getByRole('button', { name: 'Close' })
    expect(close.hasAttribute('aria-label')).toBe(false)
    expect(close.textContent).toContain('Close')
  })

  it('renders header actions before the shell-owned close control', () => {
    const { renderSlot } = mount()
    openPanel()
    expect(screen.getByText('Open configuration file')).toBeTruthy()
    // The action seat reads the addressed section and hands it the page verb.
    expect(renderSlot).toHaveBeenCalledWith('settings.action', {
      section: 'general',
      detail: undefined,
      showDetail: expect.any(Function) as unknown,
    })
    const calls = renderSlot.mock.calls.map(call => call[0] as string)
    expect(calls.indexOf('settings.action')).toBeGreaterThanOrEqual(0)
    expect(calls.indexOf('settings.action')).toBeLessThan(calls.indexOf('settings.close'))
  })
})

describe('SettingsPanel close paths', () => {
  it('closes via the header button and drops the panel address', () => {
    const { close } = mount()
    openPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(close).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes via a mask click', () => {
    mount()
    openPanel()
    const dialog = screen.getByRole('dialog')
    fireEvent.click(dialog.parentElement!.firstElementChild!)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes via document-level Escape and unhooks the listener', () => {
    mount()
    openPanel()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    // Ignored while closed (listener removed with the panel) and non-Escape
    // keys are ignored while open.
    fireEvent.keyDown(document, { key: 'Escape' })
    openPanel()
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('lands focus on the close button when the dialog opens', () => {
    mount()
    openPanel()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }))
  })
})

describe('SettingsPanel navigation', () => {
  it('projects rows, marks the first active, and renders only that section', () => {
    mount()
    openPanel()
    expect(screen.getByRole('button', { name: 'General' }).getAttribute('aria-current')).toBe('true')
    expect(screen.getByRole('button', { name: 'Models' }).getAttribute('aria-current')).toBeNull()
    expect(screen.getByTestId('section-general')).toBeTruthy()
  })

  it('scrolls the active nav cell into view on open and on selection', () => {
    mount()
    openPanel()
    expect(scrollIntoView.mock.contexts).toEqual([screen.getByRole('button', { name: 'General' })])
    fireEvent.click(screen.getByRole('button', { name: 'Agent presets' }))
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(screen.getByRole('button', { name: 'Agent presets' }))
    // `inline: 'start'` rests the active cell on the content inset.
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest', inline: 'start' })
  })

  it('returns a classic scrollbar\'s width to the section\'s right inset', () => {
    mount()
    openPanel()
    const [observer] = resizeObservers
    const [scroller, body] = observer!.targets
    expect(body!.parentElement).toBe(scroller)
    expect(body!.contains(screen.getByTestId('section-general'))).toBe(true)
    Object.defineProperty(scroller, 'offsetWidth', { value: 600 })
    Object.defineProperty(scroller, 'clientWidth', { value: 585, configurable: true })
    act(() => { observer!.callback([], observer as unknown as ResizeObserver) })
    expect((scroller as HTMLElement).style.getPropertyValue('--avn-settings-scrollbar')).toBe('15px')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(observer!.disconnected).toBe(true)
  })

  it('gives every section a nav glyph, distinct for the ids the shell knows', () => {
    mount({
      rows: [
        { id: 'account', order: 0, label: 'Account' },
        { id: 'appearance', order: 5, label: 'Appearance' },
        { id: 'models', order: 10, label: 'Models' },
        { id: 'personalization', order: 15, label: 'Personalization' },
        { id: 'plugins', order: 30, label: 'Plugins' },
        { id: 'skills', order: 35, label: 'Skills' },
        { id: 'grok-build', order: 40, label: 'Subscriptions' },
        { id: 'memory', order: 45, label: 'Memory' },
        { id: 'general', order: 50, label: 'General' },
        { id: 'contributed', order: 60, label: 'Contributed' },
      ],
    })
    openPanel()
    // Glyphs carry no id of their own, so the drawn paths are what tells them apart.
    const glyphs = ['Account', 'Appearance', 'Models', 'Personalization', 'Plugins', 'Skills', 'Subscriptions', 'Memory', 'General', 'Contributed']
      .map(name => screen.getByRole('button', { name }).querySelector('svg')?.innerHTML)

    expect(glyphs.every(glyph => glyph !== undefined && glyph !== '')).toBe(true)
    // The ids the shell names get their own glyph; every other section —
    // General included, and one this package never heard of — shares the gear.
    expect(new Set(glyphs.slice(0, 8)).size).toBe(8)
    expect(glyphs[8]).toBe(glyphs[9])
    expect(glyphs[8]).not.toBe(glyphs[0])
  })

  it('switches the rendered section on nav click', () => {
    mount()
    openPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Models' }))
    expect(screen.getByRole('button', { name: 'Models' }).getAttribute('aria-current')).toBe('true')
    expect(screen.getByTestId('section-models')).toBeTruthy()
    // A section the reader already opened stays mounted with the state it
    // holds; only the addressed one is the active pane.
    const panes = ['general', 'models'].map(id => screen.getByTestId(`section-${id}`))
    expect(panes[0]!.parentElement!.className).not.toBe(panes[1]!.parentElement!.className)
  })

  it('mounts onboarding steps in order and transfers ownership only on completion', () => {
    const { renderSlot } = mount()
    const first = renderSlot.mock.calls.find(call => call[0] === 'settings.onboarding')
    expect(first?.[1]).toMatchObject({ stepId: 'welcome' })
    expect(first?.[2]).toEqual({ only: 'welcome' })
    act(() => {
      (first?.[1] as { complete: () => void }).complete()
      ;(first?.[1] as { complete: () => void }).complete()
    })
    const onboardingCalls = renderSlot.mock.calls.filter(call => call[0] === 'settings.onboarding')
    const second = onboardingCalls.at(-1)
    expect(second?.[1]).toMatchObject({ stepId: 'credential' })
    expect(second?.[2]).toEqual({ only: 'credential' })

    act(() => {
      (second?.[1] as { openSection: (id: string) => void }).openSection('models')
    })
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByTestId('section-models')).toBeTruthy()

    cleanup()
    const inactive = mount({ onboardingActive: false }).renderSlot.mock.calls
      .filter(call => call[0] === 'settings.onboarding')
    expect(inactive).toHaveLength(0)
  })

  it('paints no takeover chrome of its own around the mounted step', () => {
    // The chrome (mask, opaque stage, #root inert) belongs to the step via
    // the step-owned dialog surface — a mounted-but-deciding step that
    // renders null must show and block nothing (the reload white-flash fix;
    // onboarding-surface.spec.tsx pins the primitive's half).
    const appRoot = document.createElement('div')
    appRoot.id = 'root'
    document.body.append(appRoot)
    const { view } = mount()
    expect(view.container.querySelector('[class*="onboarding"]')).toBeNull()
    expect(document.body.querySelector('[class*="onboarding"]')).toBeNull()
    expect(appRoot.inert).not.toBe(true)
    view.unmount()
    appRoot.remove()
  })

  it('falls back to the first row when the active entry unregisters', () => {
    const { bump } = mount()
    openPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Models' }))
    bump([{ id: 'general', order: 0, label: 'General' }])
    expect(screen.queryByRole('button', { name: 'Models' })).toBeNull()
    expect(screen.getByTestId('section-general')).toBeTruthy()
  })

  it('renders an empty content column when the ledger is empty', () => {
    const { renderSlot } = mount({ rows: [] })
    openPanel()
    expect(screen.getByRole('dialog')).toBeTruthy()
    const sectionCalls = renderSlot.mock.calls.filter(c => c[0] === 'settings.section')
    expect(sectionCalls).toHaveLength(0)
  })

  it('drops the ledger subscription on unmount', () => {
    const { view, listeners } = mount()
    expect(listeners.size).toBe(1)
    view.unmount()
    expect(listeners.size).toBe(0)
  })
})
