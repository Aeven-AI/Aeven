// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import type {
  SidebarFooterActionOwnerProps, SidebarRootComponentProps, SidebarSectionOwnerProps,
  SidebarSettingsOwnerProps,
} from '../src/client/contract/slots.ts'
import type { SessionId } from '@aeven/session/types'
import { SidebarRoot } from '../src/client/SidebarRoot.tsx'
import { en } from '../src/client/locales.ts'
import { en as commonEn } from '@aeven/client-locale/src/locales/en.ts'

// English-dictionary translate stub: the shell renders the same copy the
// assertions below query by accessible name.
const t: SidebarRootComponentProps['t'] = key =>
  (en as Record<string, string>)[key] ?? (commonEn as Record<string, string>)[key] ?? key

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

// The shell never reads the global hooks itself, but they ride the standard
// props share; stub them as never-called functions.
const neverHook = (() => { throw new Error('shell must not read global hooks') }) as never
type AttentionSnapshot = Parameters<Parameters<SidebarRootComponentProps['useSessionPendingInteraction']>[0]>[0]
const noAttention: AttentionSnapshot = new Map()
const useSessionPendingInteraction: SidebarRootComponentProps['useSessionPendingInteraction'] = selector => selector(noAttention)

function mountShell({ collapsed = false, width = 300 }: { collapsed?: boolean; width?: number } = {}) {
  const startSession = vi.fn()
  const toggleSidebar = vi.fn()
  // Pinned so the New Session link's address is assertable rather than random.
  // The counter keeps each address distinct, as production's does.
  let mintedIds = 0
  const newSessionHref = (): { href: string; sessionId: SessionId } => {
    const sessionId = `session-test-${++mintedIds}` as SessionId
    return { href: `/c/test-${mintedIds}`, sessionId }
  }
  let regionOwner: SidebarSectionOwnerProps | undefined
  let settingsOwner: SidebarSettingsOwnerProps | undefined
  let footerActionOwner: SidebarFooterActionOwnerProps | undefined
  const brandMark = <span data-testid="custom-brand-mark">M</span>
  const brandName = <span data-testid="custom-brand-name">Custom Brand</span>
  let current = { collapsed, width }
  const root = () => (
    <SidebarRoot
      collapsed={current.collapsed} width={current.width}
      useSessions={neverHook} useSessionPendingInteraction={useSessionPendingInteraction} useWorkspaces={neverHook}
      startSession={startSession} newSessionHref={newSessionHref} toggleSidebar={toggleSidebar} t={t}
      renderSlot={((
        key: string,
        owner: SidebarFooterActionOwnerProps | SidebarSectionOwnerProps | SidebarSettingsOwnerProps,
      ) => {
        if (key === 'sidebar.brand.mark') return brandMark
        if (key === 'sidebar.brand.name') return brandName
        if (key === 'sidebar.settings') {
          settingsOwner = owner
          return <div data-testid="settings-seat" data-wide={owner.wide} />
        }
        if (key === 'sidebar.footer.action') {
          footerActionOwner = owner
          return <div data-testid="footer-action-seat" data-wide={owner.wide} />
        }
        regionOwner = owner as SidebarSectionOwnerProps
        return <div data-testid="region" data-wide={owner.wide} />
      }) as SidebarRootComponentProps['renderSlot']}
    />
  )
  const view = render(root())
  return {
    startSession,
    toggleSidebar,
    regionOwner: () => {
      if (regionOwner === undefined) throw new Error('region owner not rendered')
      return regionOwner
    },
    settingsOwner: () => {
      if (settingsOwner === undefined) throw new Error('settings owner not rendered')
      return settingsOwner
    },
    footerActionOwner: () => {
      if (footerActionOwner === undefined) throw new Error('footer action owner not rendered')
      return footerActionOwner
    },
    rerender(next: Partial<typeof current>) {
      current = { ...current, ...next }
      view.rerender(root())
    },
  }
}

// React's own node-to-props pointer, which is what the event system reads a
// listener from. A dispatched `keydown` cannot reach the activation arm of the
// New Session link: React builds a SyntheticKeyboardEvent from the `keydown`
// interface list, that list carries no `button`, and the link's guard rejects
// every event without one. Calling the captured prop is the only route to the
// arm with the event the guard describes.
function keyDownHandler(node: Element): (event: ReactKeyboardEvent) => void {
  const key = Object.keys(node).find(name => name.startsWith('__reactProps$'))
  const props = key === undefined ? undefined : (node as unknown as Record<string, { onKeyDown?: unknown }>)[key]
  const handler = props?.onKeyDown
  if (typeof handler !== 'function') throw new Error('the New Session link has no keydown handler')
  return handler as (event: ReactKeyboardEvent) => void
}

// An activation event of the shape the link's guard accepts: Enter, the primary
// pointer button, no modifier. `preventDefault` is the recorder the handler is
// expected to call when it claims the activation for the shell.
function enterActivation(
  preventDefault: () => void,
  overrides: Record<string, unknown> = {},
): ReactKeyboardEvent {
  return {
    key: 'Enter', button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
    preventDefault,
    ...overrides,
  } as unknown as ReactKeyboardEvent
}

describe('SidebarRoot shell', () => {
  it('routes New Session (capsule + wordmark) and the column toggle', () => {
    const b = mountShell()
    expect(screen.getByTestId('custom-brand-mark')).toBeTruthy()
    expect(screen.getByTestId('custom-brand-name')).toBeTruthy()
    // Expanded, both the wordmark and the capsule start a session. The
    // capsule is an anchor now (so the browser can open it in a new window),
    // which is why the two are reached by different roles.
    const link = screen.getByRole('link', { name: 'Chat' })
    expect(link.getAttribute('href')).toBe('/c/test-1')
    fireEvent.click(screen.getByRole('button', { name: 'Chat' }))
    fireEvent.click(link)
    expect(b.startSession).toHaveBeenCalledTimes(2)
    // The link's own id is the one created, so the address the reader opened
    // and the Session that appears are the same chat...
    expect(b.startSession).toHaveBeenLastCalledWith(undefined, 'session-test-1')
    // ...and the next render names a fresh one, because that id is now live.
    expect(screen.getByRole('link', { name: 'Chat' }).getAttribute('href')).toBe('/c/test-2')
    fireEvent.click(screen.getByRole('button', { name: 'Close sidebar' }))
    expect(b.toggleSidebar).toHaveBeenCalledOnce()

    // Below the med breakpoint the column overlays the conversation, and the
    // dimmed area it covers closes it — the same gesture as tapping outside.
    const blocker = document.querySelector('[role="presentation"]')
    expect(blocker).not.toBeNull()
    fireEvent.click(blocker!)
    expect(b.toggleSidebar).toHaveBeenCalledTimes(2)
  })

  it('renders the brand mark alone when no package fills the brand slots', () => {
    // The brand name has no fallback: unoccupied, the wordmark and the build
    // badge are simply absent, and only a registered occupant puts text here.
    vi.stubEnv('AVN_CLIENT_COMMIT_HASH', '0123456')
    vi.stubEnv('AVN_CLIENT_GIT_DIRTY', 'true')
    vi.stubEnv('AVN_CLIENT_VERSION', '1.2.3-rc.4')
    const newSessionHref = (): { href: string; sessionId: SessionId } => (
      { href: '/c/brand-test', sessionId: 'session-brand-test' as SessionId }
    )
    const { container } = render(<SidebarRoot
      collapsed={false} width={300}
      useSessions={neverHook} useSessionPendingInteraction={useSessionPendingInteraction} useWorkspaces={neverHook}
      startSession={vi.fn()} newSessionHref={newSessionHref} toggleSidebar={vi.fn()} t={t}
      renderSlot={((_key: string, _owner: unknown, options?: { fallback?: ReactNode }) =>
        options?.fallback ?? null) as SidebarRootComponentProps['renderSlot']}
    />)

    expect(screen.queryByText('Æven')).toBeNull()
    expect(screen.queryByText('1.2.3-rc.4-0123456-dirty')).toBeNull()
    // The mark keeps its own fallback, so the brand still renders something.
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('hands the region its wide flag and clamps expandSidebar to the collapsed state', () => {
    const b = mountShell()
    expect(b.regionOwner().wide).toBe(true)
    // The settings seat rides the same wide flag (ui-settings renders the row).
    expect(b.settingsOwner().wide).toBe(true)
    expect(b.footerActionOwner().wide).toBe(true)
    // Expanded: the request is a no-op (no accidental collapse).
    b.regionOwner().expandSidebar()
    expect(b.toggleSidebar).not.toHaveBeenCalled()
  })

  it('keeps the region mounted through collapse and expands on its request', () => {
    const b = mountShell()
    b.rerender({ collapsed: true })
    expect(b.regionOwner().wide).toBe(true)
    expect(b.footerActionOwner().wide).toBe(true)
    expect(screen.getByTestId('region')).toBeTruthy()
    b.regionOwner().expandSidebar()
    expect(b.toggleSidebar).toHaveBeenCalledOnce()
  })

  it('renders statically collapsed on a cold start (no crossfade classes)', () => {
    const b = mountShell({ collapsed: true })
    expect(b.regionOwner().wide).toBe(true)
    expect(screen.getByRole('button', { name: 'Open sidebar' })).toBeTruthy()
  })
})

describe('SidebarRoot New Session activation', () => {
  it('claims the navigation only for an unmodified primary click', () => {
    const b = mountShell()
    const link = screen.getByRole('link', { name: 'Chat' })
    // Middle click, "Open link in new window", and every modified click mean
    // "somewhere else": the guard hands all of them to the browser, so the
    // default is never prevented and no Session is created.
    for (const init of [
      { button: 1 }, { button: 2 }, { metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true },
    ]) {
      expect(fireEvent.click(link, init)).toBe(true)
      expect(b.startSession).not.toHaveBeenCalled()
    }

    // A plain primary click is the shell's: the browser's own navigation is
    // cancelled and the Session the address names is created in its place.
    expect(fireEvent.click(link)).toBe(false)
    expect(b.startSession).toHaveBeenCalledWith(undefined, 'session-test-1')
  })

  it('applies the same guard to Enter on the link', () => {
    const b = mountShell()
    const link = screen.getByRole('link', { name: 'Chat' })
    const handler = keyDownHandler(link)

    // Shift+Enter is a modified activation, so it stays with the browser
    // exactly as a modified click does.
    const modified = vi.fn()
    act(() => { handler(enterActivation(modified, { shiftKey: true })) })
    expect(modified).not.toHaveBeenCalled()
    expect(b.startSession).not.toHaveBeenCalled()

    // Plain Enter is intercepted: the shell creates the named Session and the
    // link then names the fresh one.
    const intercepted = vi.fn()
    act(() => { handler(enterActivation(intercepted)) })
    expect(intercepted).toHaveBeenCalledOnce()
    expect(b.startSession).toHaveBeenCalledWith(undefined, 'session-test-1')
    expect(screen.getByRole('link', { name: 'Chat' }).getAttribute('href')).toBe('/c/test-2')
  })

  it('leaves a dispatched Enter keydown unintercepted', () => {
    const b = mountShell()
    const link = screen.getByRole('link', { name: 'Chat' })
    // React's SyntheticKeyboardEvent reports no `button`, so the guard rejects
    // the event and the handler never prevents the navigation or activates.
    expect(fireEvent.keyDown(link, { key: 'Enter' })).toBe(true)
    expect(b.startSession).not.toHaveBeenCalled()
  })
})
