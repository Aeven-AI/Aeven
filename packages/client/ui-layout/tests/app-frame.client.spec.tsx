// @vitest-environment jsdom
/**
 * AppFrame interaction spec under the four-share props form: real layout
 * store instance (createLayoutStore().create() — the test-sanctioned engine
 * path), a recording renderSlot stub, and a SessionProvider component stub
 * (the real one is framework-wired to the renderer host; its own behavior is
 * ui-renderer's spec territory). Details drag sequences (pointer capture + rAF
 * flush), narrow-breakpoint collapse, and details staying mounted at zero width
 * are the preserved behavior assertions. The frame observes no element: it
 * reads the breakpoint from matchMedia, which jsdom does not implement, so
 * `resizeTo` moves the viewport and notifies the stubbed listeners.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { AppFrame } from '@deepseek-ai/dsh-client-ui-layout/src/client/AppFrame.tsx'
import type { AppFrameProps } from '@deepseek-ai/dsh-client-ui-layout/src/client/AppFrame.tsx'
import { SIDEBAR_AUTO_COLLAPSE, SIDEBAR_COLLAPSED } from '@deepseek-ai/dsh-client-ui-layout/src/client/columns.ts'
import { createLayoutStore } from '@deepseek-ai/dsh-client-ui-layout/src/client/stores.ts'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

// Session selection controls for the SessionProvider and useSessions stubs.
const selectedSession = { current: 's-test' as SessionId | undefined }
const selectedSessionBlank = { current: false }
const selectedSessionTitle = { current: undefined as string | undefined }
const workspacesReady = { current: true }
type AttentionSnapshot = Parameters<Parameters<AppFrameProps['useSessionPendingInteraction']>[0]>[0]
const noAttention: AttentionSnapshot = new Map()
const useSessionPendingInteraction: AppFrameProps['useSessionPendingInteraction'] = selector => selector(noAttention)

// Provider contract stub fed through the standard seat prop (the renderer
// injects the real one in production): session mode renders children and
// empty mode runs the empty branch.
const SessionProviderStub: AppFrameProps['SessionProvider'] = ({ children, empty }) =>
  selectedSession.current === undefined ? <>{empty?.() ?? null}</> : <>{children}</>


/** Breakpoint listeners handed to the matchMedia stub, newest last. */
let mediaListeners: (() => void)[] = []

let frameWidth = 1920

/**
 * Move the viewport and notify the frame's breakpoint listeners. The frame
 * observes no element — it reads the narrow breakpoint from matchMedia alone —
 * so a media-query change is the only resize signal it can see.
 * @param width - the new viewport width in pixels.
 */
function resizeTo(width: number): void {
  frameWidth = width
  window.innerWidth = width
  for (const listener of [...mediaListeners]) listener()
}

/** Test-local selector hook over a framework-neutral store instance. */
function hookOf<T>(inst: { subscribe: (fn: () => void) => () => void; getSnapshot: () => T }) {
  return function useSelector<S>(sel: (s: T) => S): S { return sel(useSyncExternalStore(inst.subscribe, inst.getSnapshot)) }
}

function mountFrame() {
  window.innerWidth = frameWidth // first-render viewport source before the observer fires
  const instance = createLayoutStore().create()
  const slotCalls: { key: string; props: unknown }[] = []
  const renderSlot = ((key: string, owner: object) => {
    slotCalls.push({ key, props: owner })
    if (key === 'sidebar') {
      const sidebar = owner as { width: number }
      return <div data-testid="sidebar-content" data-width={sidebar.width} />
    }
    if (key === 'conversation') return <div data-testid="center-content" />
    if (key === 'details') return <div data-testid="details-content" />
    if (key === 'conversation.empty') return <div data-testid="empty-content" />
    return <div data-testid="other-content" />
  }) as AppFrameProps['renderSlot']
  const useSessions = ((sel: (s: SessionListState) => unknown) => {
    const current = selectedSession.current
    const sessionState = {
      ids: current === undefined ? [] : [current],
      byId: current === undefined
        ? {}
        : {
          [current]: {
            id: current,
            displayTitle: 'Test',
            running: false,
            blank: selectedSessionBlank.current,
            updatedAt: 1,
            ...(selectedSessionTitle.current === undefined ? {} : { title: selectedSessionTitle.current }),
          },
        },
      current,
      phase: 'ready',
    } as SessionListState
    return sel(sessionState)
  }) as never
  const workspaceState: WorkspaceSnapshot = {
    items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
    ...(workspacesReady.current ? {} : { state: 'loading' as const, phase: 'pending' as const }),
  }
  const element = () => (
    <AppFrame
      useStore={hookOf(instance)}
      actions={instance.actions}
      renderSlot={renderSlot}
      useSessions={useSessions}
      useSessionPendingInteraction={useSessionPendingInteraction}
      useWorkspaces={((sel: (s: WorkspaceSnapshot) => unknown) => sel(workspaceState)) as never}
      SessionProvider={SessionProviderStub}
      t={key => key === 'brand.localBuild' ? 'DSH Local Build' : key}
    />
  )
  const utils = render(element())
  const frame = utils.container.firstElementChild as HTMLElement
  return { instance, frame, slotCalls, rerenderFrame: () => { utils.rerender(element()) }, ...utils }
}

function tracks(frame: HTMLElement): number[] {
  const sidebar = frame.querySelector<HTMLElement>('[data-testid="sidebar-content"]')
  const details = frame.querySelector<HTMLElement>('[class*="detailsCol"]')
  if (sidebar === null || details === null) throw new Error('missing flex column')
  // The details column takes its width from the frame's custom property, not
  // an inline width on the column itself.
  return [Number(sidebar.dataset.width), Number.parseFloat(frame.style.getPropertyValue('--dsh-frame-details-width'))]
}

function drag(handle: Element, fromX: number, toX: number): void {
  const down = new PointerEvent('pointerdown', { pointerId: 1, clientX: fromX, bubbles: true })
  const move = new PointerEvent('pointermove', { pointerId: 1, clientX: toX, bubbles: true })
  const up = new PointerEvent('pointerup', { pointerId: 1, clientX: toX, bubbles: true })
  act(() => { handle.dispatchEvent(down) })
  act(() => { handle.dispatchEvent(move); vi.advanceTimersByTime(20) })
  act(() => { handle.dispatchEvent(up) })
}

beforeEach(() => {
  // Each case is its own page load: the layout store persists the sidebar
  // width, so a previous case's collapse must not seed the next mount.
  localStorage.clear()
  frameWidth = 1920
  selectedSession.current = 's-test' as SessionId
  selectedSessionBlank.current = false
  selectedSessionTitle.current = undefined
  workspacesReady.current = true
  vi.useFakeTimers()
  // jsdom implements no matchMedia; the frame reads the narrow breakpoint from
  // it. `matches` is a getter so a frameWidth change is visible to the next
  // listener run, and NARROW_QUERY's max-width is inclusive.
  mediaListeners = []
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() { return frameWidth <= SIDEBAR_AUTO_COLLAPSE },
    media: query,
    addEventListener: (_: string, fn: () => void) => { mediaListeners.push(fn) },
    removeEventListener: (_: string, fn: () => void) => {
      mediaListeners = mediaListeners.filter(listener => listener !== fn)
    },
  }))
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => { cb(0) }, 16) as unknown as number)
  vi.stubGlobal('cancelAnimationFrame', (h: number) => { clearTimeout(h) })
  window.innerWidth = frameWidth
  Element.prototype.getBoundingClientRect = function () {
    return { width: frameWidth, height: 1080, top: 0, left: 0, right: frameWidth, bottom: 1080, x: 0, y: 0, toJSON: () => ({}) }
  }
  // jsdom lacks pointer capture: emulate per-element so hasPointerCapture gates pass.
  const captured = new WeakSet<Element>()
  Element.prototype.setPointerCapture = function () { captured.add(this) }
  Element.prototype.releasePointerCapture = function () { captured.delete(this) }
  Element.prototype.hasPointerCapture = function () { return captured.has(this) }
})

afterEach(() => {
  cleanup()
  document.title = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('AppFrame', () => {
  it('localizes the product title when the build does not supply one', () => {
    mountFrame()
    expect(document.title).toBe('DSH Local Build')
  })

  it('projects the selected durable Session title', () => {
    vi.stubEnv('AVN_CLIENT_TITLE', 'Product')
    selectedSessionTitle.current = 'First'
    const { rerenderFrame } = mountFrame()
    expect(document.title).toBe('First — Product')

    selectedSessionTitle.current = 'Revised'
    act(() => { rerenderFrame() })
    expect(document.title).toBe('Revised — Product')

    selectedSession.current = undefined
    act(() => { rerenderFrame() })
    expect(document.title).toBe('Product')
  })

  it('renders three flex columns from store state', () => {
    const { frame } = mountFrame()
    expect(tracks(frame)).toEqual([280, 0])
  })

  it('renders the session pair with empty owner shares (sessionId is framework-standard)', () => {
    const { slotCalls, getByTestId } = mountFrame()
    expect(getByTestId('center-content')).toBeTruthy()
    expect(getByTestId('details-content')).toBeTruthy()
    const keys = slotCalls.map(c => c.key)
    expect(keys).toContain('conversation')
    expect(keys).toContain('details')
    expect(keys).not.toContain('conversation.empty')
    expect(slotCalls.find(c => c.key === 'conversation')!.props).toEqual({})
    expect(slotCalls.find(c => c.key === 'details')!.props).toEqual({})
  })

  it('keeps the conversation slot mounted while no session is current', () => {
    // No current session: the session-maybe conversation shell owns the New
    // Session view itself — the center column renders it unconditionally.
    selectedSession.current = undefined
    const { slotCalls, getByTestId, queryByTestId } = mountFrame()
    expect(getByTestId('center-content')).toBeTruthy()
    expect(slotCalls.map(c => c.key)).toContain('conversation')
    expect(queryByTestId('details-content')).toBeNull()
    expect(slotCalls.map(c => c.key)).toContain('details')
  })

  it('renders both column occupants before baselines settle (no loading gate)', () => {
    // No loading gate: a bare loading status reads worse than the shell's own
    // pending rendering — both occupants mount from first paint.
    workspacesReady.current = false
    const { slotCalls } = mountFrame()
    expect(slotCalls.map(c => c.key)).toContain('conversation')
    expect(slotCalls.map(c => c.key)).toContain('details')
  })

  it('ignores unselected states and closes only when the Session id changes', () => {
    const { frame, instance, rerenderFrame } = mountFrame()
    expect(tracks(frame)).toEqual([280, 0])

    act(() => { instance.actions.openDetails() })
    expect(tracks(frame)).toEqual([280, 360])

    selectedSession.current = 's-next' as SessionId
    act(() => { rerenderFrame() })
    expect(tracks(frame)).toEqual([280, 0])

    act(() => { instance.actions.openDetails() })
    selectedSession.current = 's-blank' as SessionId
    selectedSessionBlank.current = true
    act(() => { rerenderFrame() })
    expect(tracks(frame)).toEqual([280, 0])
    expect(instance.getSnapshot().details).toBe(360)

    selectedSession.current = 's-next' as SessionId
    selectedSessionBlank.current = false
    act(() => { rerenderFrame() })
    expect(tracks(frame)).toEqual([280, 360])

    selectedSession.current = undefined
    act(() => { rerenderFrame() })
    expect(tracks(frame)).toEqual([280, 0])
    selectedSession.current = 's-test' as SessionId
    act(() => { rerenderFrame() })
    expect(tracks(frame)).toEqual([280, 0])
  })

  it('keeps details closed when the first Session materializes', () => {
    selectedSession.current = undefined
    const { frame, instance, rerenderFrame } = mountFrame()
    expect(tracks(frame)).toEqual([280, 0])
    expect(instance.getSnapshot().details).toBe(0)

    selectedSession.current = 's-first' as SessionId
    act(() => { rerenderFrame() })
    expect(tracks(frame)).toEqual([280, 0])
  })

  it('sidebar slot receives live concession output as owner props', () => {
    const { slotCalls } = mountFrame()
    expect(slotCalls.find(c => c.key === 'sidebar')!.props).toEqual({ collapsed: false, width: 280 })
  })

  it('details drag widens leftward (negative dx grows the panel)', () => {
    const { frame, instance } = mountFrame()
    act(() => { instance.actions.openDetails() })
    const handles = frame.querySelectorAll('[class*="handle"]')
    drag(handles[0]!, 1560, 1500)
    expect(tracks(frame)[1]).toBe(420)
  })

  it('drag base is the rendered width', () => {
    frameWidth = 1250
    const { frame, instance } = mountFrame()
    act(() => { instance.actions.openDetails() })
    expect(tracks(frame)).toEqual([280, 360])
    const handles = frame.querySelectorAll('[class*="handle"]')
    drag(handles[0]!, 890, 900) // shrink by 10 from the rendered width
    expect(instance.getSnapshot().details).toBe(350)
  })

  it('details column stays mounted at zero width', () => {
    const { frame, getByTestId } = mountFrame()
    expect(tracks(frame)).toEqual([280, 0])
    expect(getByTestId('details-content')).toBeTruthy()
    expect(frame.hasAttribute('data-details-collapsed')).toBe(true)
  })

  it('closed sidebar keeps mounted slot content at zero width with collapsed owner props', () => {
    const { frame, instance, slotCalls, getByTestId } = mountFrame()
    act(() => { instance.actions.toggleSidebar() })
    expect(tracks(frame)).toEqual([SIDEBAR_COLLAPSED, 0])
    expect(getByTestId('sidebar-content')).toBeTruthy()
    expect(frame.hasAttribute('data-sidebar-collapsed')).toBe(true)
    const lastSidebarCall = slotCalls.filter(c => c.key === 'sidebar').at(-1)!
    expect(lastSidebarCall.props).toEqual({ collapsed: true, width: SIDEBAR_COLLAPSED })
  })

  it('keeps the details width across a viewport change above the breakpoint', () => {
    // The centre column is `flex: 1` with `min-width: 0`, so it absorbs the
    // squeeze in CSS; the frame runs no column solver of its own.
    const { frame, instance } = mountFrame()
    act(() => { instance.actions.openDetails() })
    act(() => { resizeTo(1250) })
    expect(tracks(frame)).toEqual([280, 360])
    act(() => { resizeTo(1920) })
    expect(tracks(frame)).toEqual([280, 360])
  })

  it('the details handle appears only while that column is open', () => {
    const { frame, instance } = mountFrame()
    expect(frame.querySelectorAll('[class*="handle"]')).toHaveLength(0)
    act(() => { instance.actions.openDetails() })
    expect(frame.querySelectorAll('[class*="handle"]')).toHaveLength(1)
    act(() => { instance.actions.closeDetails() })
    expect(frame.querySelectorAll('[class*="handle"]')).toHaveLength(0)
  })
})

describe('AppFrame — narrow-viewport auto-collapse', () => {
  it('mounts collapsed below the breakpoint with no sidebar handle', () => {
    frameWidth = 980
    const { frame, slotCalls } = mountFrame()
    expect(tracks(frame)).toEqual([SIDEBAR_COLLAPSED, 0])
    expect(frame.hasAttribute('data-sidebar-collapsed')).toBe(true)
    expect(slotCalls.filter(c => c.key === 'sidebar').at(-1)!.props).toEqual({ collapsed: true, width: SIDEBAR_COLLAPSED })
    expect(frame.querySelectorAll('[class*="handle"]')).toHaveLength(0)
  })

  it('mounts wide where the runtime implements no matchMedia', () => {
    // The assembled web lane boots this tree in jsdom, which has no
    // matchMedia; reading the breakpoint unguarded crashed the 'root' slot.
    vi.stubGlobal('matchMedia', undefined)
    const { frame } = mountFrame()
    expect(tracks(frame)).toEqual([280, 0])
    expect(frame.hasAttribute('data-sidebar-collapsed')).toBe(false)
  })

  it('narrow toggle re-expands over the squeezed center and back', () => {
    frameWidth = 980
    const { frame, instance } = mountFrame()
    act(() => { instance.actions.toggleSidebar() })
    expect(tracks(frame)).toEqual([280, 0])
    expect(frame.hasAttribute('data-sidebar-collapsed')).toBe(false)
    expect(frame.querySelectorAll('[class*="handle"]')).toHaveLength(0)
    act(() => { instance.actions.toggleSidebar() })
    expect(tracks(frame)).toEqual([SIDEBAR_COLLAPSED, 0])
  })

  it('a wide-closed preference re-expands at the contract default while narrow', () => {
    frameWidth = 1920
    const { frame, instance } = mountFrame()
    act(() => { instance.actions.toggleSidebar() }) // close while wide: preference 0
    act(() => { resizeTo(980) })
    act(() => { instance.actions.toggleSidebar() })
    expect(tracks(frame)).toEqual([280, 0])
    expect(instance.getSnapshot().sidebar).toBe(0) // preference untouched
  })

  it('shrinking across the breakpoint auto-collapses; re-widening restores the drag width', () => {
    const { frame, instance } = mountFrame()
    act(() => { instance.actions.setSidebar(400) })
    act(() => { resizeTo(980) })
    expect(tracks(frame)).toEqual([SIDEBAR_COLLAPSED, 0])
    act(() => { resizeTo(1920) })
    expect(tracks(frame)).toEqual([400, 0])
  })
})

describe('AppFrame — guard branches', () => {
  it('pointer moves without capture are ignored (no width write)', () => {
    const { frame, instance } = mountFrame()
    act(() => { instance.actions.openDetails() })
    const handle = frame.querySelectorAll('[class*="handle"]')[0]!
    const before = instance.getSnapshot().details
    // Move + up without a preceding pointerdown: hasPointerCapture is false.
    act(() => {
      handle.dispatchEvent(new PointerEvent('pointermove', { pointerId: 9, clientX: 500, bubbles: true }))
      vi.advanceTimersByTime(20)
      handle.dispatchEvent(new PointerEvent('pointerup', { pointerId: 9, clientX: 500, bubbles: true }))
    })
    expect(instance.getSnapshot().details).toBe(before)
  })

  it('two moves inside one frame coalesce through the pending rAF', () => {
    const { frame, instance } = mountFrame()
    act(() => { instance.actions.openDetails() })
    const handle = frame.querySelectorAll('[class*="handle"]')[0]!
    act(() => { handle.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 1560, bubbles: true })) })
    act(() => {
      // Two moves before the frame flushes: the second must ride the pending
      // rAF (frame.current ??= guard), and the flush sees the latest x.
      handle.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 1520, bubbles: true }))
      handle.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 1500, bubbles: true }))
      vi.advanceTimersByTime(20)
    })
    act(() => { handle.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 1500, bubbles: true })) })
    expect(instance.getSnapshot().details).toBe(420)
  })

  it('pointerup with a pending rAF cancels it and commits the final position', () => {
    const { frame, instance } = mountFrame()
    act(() => { instance.actions.openDetails() })
    const handle = frame.querySelectorAll('[class*="handle"]')[0]!
    act(() => { handle.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 1560, bubbles: true })) })
    act(() => {
      handle.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 1500, bubbles: true }))
      // No timer advance: the rAF is still pending when pointerup arrives.
      handle.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 1500, bubbles: true }))
    })
    expect(instance.getSnapshot().details).toBe(420)
  })
})

describe('AppFrame — unmount with an in-flight drag frame', () => {
  it('cancels the pending rAF on unmount (no post-unmount setState)', () => {
    const { frame, instance, unmount } = mountFrame()
    act(() => { instance.actions.openDetails() })
    const handle = frame.querySelectorAll('[class*="handle"]')[0]!
    act(() => { handle.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 1560, bubbles: true })) })
    act(() => { handle.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 1500, bubbles: true })) })
    unmount() // rAF scheduled, NOT flushed
    // Flushing after unmount must be a no-op (the frame was cancelled).
    expect(() => { vi.advanceTimersByTime(20) }).not.toThrow()
  })
})
