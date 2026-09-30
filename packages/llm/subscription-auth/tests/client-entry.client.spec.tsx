/**
 * @vitest-environment happy-dom
 *
 * The plugin's browser entry, driven the way the shell drives it: what it
 * publishes to the AVN client, and the self-contained settings entry it mounts
 * when the shell has no slot to offer.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GrokBuildSettings } from '../src/client/GrokBuildSettings.tsx'
import { STATUS_PATH } from '../src/client/constants.ts'
import { apply, inject, name } from '../src/client/index.tsx'
import { en, type GrokBuildSettingsKey } from '../src/client/locales.ts'

/** The exact selector the entry uses to decide what it can tab to. */
const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** The real English dictionary, so a missing key fails the test rather than passing silently. */
function t(key: GrokBuildSettingsKey, params?: Record<string, unknown>): string {
  const template = en[key]
  if (params === undefined) return template
  return Object.entries(params).reduce<string>(
    (text, [entry, value]) => text.replaceAll(`{${entry}}`, String(value)),
    template,
  )
}

/** A status answer with every provider signed out, so only the entry itself is under test. */
function statusBody(): unknown {
  return {
    accessMode: 'loopback',
    uiOwner: 'standalone',
    compatibility: { coreAbi: 'test', avnVersion: null, status: 'healthy', diagnostics: [] },
    providers: {
      grok: { status: 'signed-out', grokImportAvailable: false },
      codex: {
        provider: 'codex',
        route: 'codex-oauth',
        displayName: 'Codex',
        loginMethods: ['device', 'browser'],
        recommendedLoginMethod: 'browser',
        models: [],
        available: [],
        selected: [],
        status: 'signed-out',
      },
      claude: {
        provider: 'claude',
        route: 'claude-code-oauth',
        displayName: 'Claude',
        loginMethods: ['browser'],
        recommendedLoginMethod: 'browser',
        models: [],
        available: [],
        selected: [],
        status: 'signed-out',
      },
    },
  }
}

function stubStatusRoute(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) =>
      path === STATUS_PATH
        ? Response.json(statusBody())
        : Response.json({ error: `unexpected ${path}` }, { status: 404 }),
    ),
  )
}

interface MountedEntry {
  disposers: Array<() => void>
  registered: Array<{ namespace: string; dictionaries: Record<string, unknown> }>
}

/**
 * Run the entry against a shell that offers no slots, which is the only route
 * that reaches the fallback the plugin mounts for itself.
 */
async function mountEntry(): Promise<MountedEntry> {
  const disposers: Array<() => void> = []
  const registered: Array<{ namespace: string; dictionaries: Record<string, unknown> }> = []
  const context = {
    effect(callback: () => (() => void) | undefined) {
      const dispose = callback()
      if (dispose !== undefined) disposers.push(dispose)
    },
    locale: {
      register(namespace: string, dictionaries: Record<string, unknown>) {
        registered.push({ namespace, dictionaries })
      },
      bind: () => t,
    },
  } as unknown as ClientContext

  await act(async () => {
    apply(context)
  })
  return { disposers, registered }
}

let mounted: MountedEntry | undefined

afterEach(() => {
  for (const dispose of mounted?.disposers ?? []) dispose()
  mounted = undefined
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.sessionStorage.clear()
  for (const node of [...document.body.children]) node.remove()
})

describe('client plugin contract', () => {
  it('names itself for the shell and asks only for the locale service', () => {
    expect(name).toBe('avn-grok-build-client')
    expect(inject).toEqual(['locale'])
  })

  it('publishes its own copy for the settings namespace', async () => {
    stubStatusRoute()

    mounted = await mountEntry()

    expect(mounted.registered).toHaveLength(1)
    expect(mounted.registered[0]?.namespace).toBe('settings.grok-build')
    expect(mounted.registered[0]?.dictionaries['en']).toBe(en)
    expect(Object.keys(mounted.registered[0]?.dictionaries['zh'] ?? {})).toContain('title')
  })

  it('registers its section with the settings shell when slots are available', () => {
    const dispose = vi.fn()
    const register = vi.fn((_definition: unknown, _component: unknown) => dispose)
    const injectSlot = vi.fn()
    const context = {
      effect(callback: () => (() => void) | undefined) {
        callback()
      },
      locale: { register() {}, bind: () => t },
      slots: { inject: injectSlot, register },
    } as unknown as ClientContext

    apply(context)

    // The section is offered to the shell's slot rather than mounted directly.
    expect(injectSlot).toHaveBeenCalledTimes(1)
    const [slotName, registerSection] = injectSlot.mock.calls[0] as [string, () => void]
    expect(slotName).toBe('settings.section')
    expect(register).not.toHaveBeenCalled()

    registerSection()

    const [definition, component] = register.mock.calls[0] as [
      {
        name: string
        id: string
        order: number
        label: () => string
        inject: () => unknown
      },
      unknown,
    ]
    expect(definition.name).toBe('settings.section')
    expect(definition.id).toBe('grok-build')
    expect(definition.order).toBe(17)
    expect(definition.label()).toBe(en.nav)
    expect(definition.inject()).toEqual({ t })
    expect(component).toBe(GrokBuildSettings)
  })

  it('mounts nothing at all where there is no document to mount into', () => {
    const body = document.body
    const disposers: Array<() => void> = []
    const context = {
      effect(callback: () => (() => void) | undefined) {
        const dispose = callback()
        if (dispose !== undefined) disposers.push(dispose)
      },
      locale: { register() {}, bind: () => t },
    } as unknown as ClientContext
    vi.stubGlobal('document', undefined)

    expect(() => {
      apply(context)
    }).not.toThrow()
    // The entry it would have mounted has nothing of its own to tear down.
    expect(disposers).toHaveLength(1)
    expect(() => {
      for (const dispose of disposers) dispose()
    }).not.toThrow()

    vi.unstubAllGlobals()
    expect(body.querySelector('[data-avn-coding-oauth]')).toBeNull()
  })
})

describe('independent settings entry', () => {
  it('opens its dialog from the corner trigger and closes it on Escape', async () => {
    stubStatusRoute()
    mounted = await mountEntry()

    const trigger = screen.getByRole('button', { name: en.nav })
    expect(trigger.getAttribute('type')).toBe('button')
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(trigger)

    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    // The dialog names itself through its own title, not the section's.
    expect(document.getElementById(dialog.getAttribute('aria-labelledby') ?? '')?.textContent).toBe(en.title)
    // Opening moves the reader into the dialog, onto the control that closes it.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: en.cancel }))

    // A key that is neither Escape nor Tab is left to the rest of the page.
    fireEvent.keyDown(document, { key: 'a' })
    expect(screen.getByRole('dialog')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('dialog')).toBeNull()
    // Closing hands focus back to the control that opened it.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: en.nav }))

    // The close control inside the dialog closes it just as Escape does.
    fireEvent.click(screen.getByRole('button', { name: en.nav }))
    fireEvent.click(screen.getByRole('button', { name: en.cancel }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('makes the page behind the dialog inert and gives it back on close', async () => {
    stubStatusRoute()
    const plain = document.createElement('div')
    const already = document.createElement('div')
    already.setAttribute('inert', 'polite')
    document.body.append(plain, already)

    mounted = await mountEntry()
    fireEvent.click(screen.getByRole('button', { name: en.nav }))

    expect(plain.getAttribute('inert')).toBe('')
    expect(already.getAttribute('inert')).toBe('')

    fireEvent.keyDown(document, { key: 'Escape' })

    // A sibling that was not inert loses the attribute again.
    expect(plain.hasAttribute('inert')).toBe(false)
    // A sibling that already carried one keeps exactly the value it had.
    expect(already.getAttribute('inert')).toBe('polite')
  })

  it('treats a dialog with no coding-oauth ancestor as having nothing to inert', async () => {
    stubStatusRoute()
    vi.spyOn(Element.prototype, 'closest').mockReturnValue(null)
    mounted = await mountEntry()
    fireEvent.click(screen.getByRole('button', { name: en.nav }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('wraps tabbing inside the dialog in both directions', async () => {
    stubStatusRoute()
    // happy-dom reports no geometry, so every control would look hidden.
    vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([
      { width: 10, height: 10 },
    ] as unknown as DOMRectList)
    mounted = await mountEntry()
    fireEvent.click(screen.getByRole('button', { name: en.nav }))
    // The controls inside the dialog belong to the accounts it loads on opening.
    await waitFor(() => {
      expect(document.getElementById('coding-oauth-login-codex')).toBeTruthy()
    })

    const dialog = screen.getByRole('dialog')
    const targets = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)]
    const first = targets[0]!
    const last = targets[targets.length - 1]!
    expect(targets.length).toBeGreaterThan(1)

    first.focus()
    expect(document.activeElement).toBe(first)
    const backwards = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
    document.dispatchEvent(backwards)
    expect(backwards.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(last)

    const forwards = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    document.dispatchEvent(forwards)
    expect(forwards.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(first)

    // Anywhere in between, Tab belongs to the browser rather than to us.
    const middle = targets[1]!
    middle.focus()
    const interior = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    document.dispatchEvent(interior)
    expect(interior.defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(middle)
  })

  it('keeps the reader on the dialog when it holds nothing to tab to', async () => {
    stubStatusRoute()
    vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([] as unknown as DOMRectList)
    mounted = await mountEntry()
    fireEvent.click(screen.getByRole('button', { name: en.nav }))

    const dialog = screen.getByRole('dialog')
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    document.dispatchEvent(tab)

    expect(tab.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(dialog)
  })

  it('leaves no focus behind on a node the page no longer holds', async () => {
    stubStatusRoute()
    mounted = await mountEntry()
    fireEvent.click(screen.getByRole('button', { name: en.nav }))
    const close = screen.getByRole('button', { name: en.cancel })
    close.focus()

    for (const dispose of mounted.disposers) dispose()
    mounted = undefined

    expect(document.querySelector('[data-avn-coding-oauth]')).toBeNull()
    expect(document.activeElement).not.toBe(close)
    expect(document.activeElement === null || document.activeElement.isConnected).toBe(true)
  })
})
