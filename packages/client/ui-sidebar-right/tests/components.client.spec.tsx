// @vitest-environment jsdom
/**
 * The right sidebar's two presentation components, mounted from plain props.
 *
 * Both are pure props consumers (packages/client/AGENTS.md: components never
 * see ctx), so the specs feed them the whole standard kit the slot framework
 * composes: the global selector hooks, the session kit its session-scoped
 * column requires, a locale stub, and — for the root — a recording
 * `renderSlot` beside the column owner's `collapsed` and `width`. Nothing here
 * is a live store; each hook answers from one fixed snapshot.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { WorkspaceSnapshot } from '@aeven/api-workspace-controller/client'
import type { SessionListState } from '@aeven/api-session-controller/client'
import type { SessionId } from '@aeven/session/types'
import type { SnapshotSelectorHook } from '@aeven/client-store'
import type {
  SidebarRightRootComponentProps,
  ToggleButtonComponentProps,
} from '../src/client/contract/slots.ts'
import { SidebarRightRoot } from '../src/client/SidebarRightRoot.tsx'
import { ToggleButton } from '../src/client/ToggleButton.tsx'
import { en } from '../src/client/locales.ts'
import { en as commonEn } from '@aeven/client-locale/src/locales/en.ts'

/** English-dictionary translate stub: rendered copy is what the queries match. */
const t: ToggleButtonComponentProps['t'] = key =>
  (en as Record<string, string>)[key] ?? (commonEn as Record<string, string>)[key] ?? key

/** A selector hook that answers every selection from one fixed snapshot. */
function selectorHook<Snapshot>(snapshot: Snapshot): SnapshotSelectorHook<Snapshot> {
  return <S,>(sel: (s: Snapshot) => S): S => sel(snapshot)
}

/** A hook a pure component must never read: reading it is the defect under test. */
function unreadHook(label: string): () => never {
  return () => { throw new Error(`the element must not read ${label}`) }
}

/** The global seat every slot component receives, with nothing pending. */
const globalProps: Pick<
  ToggleButtonComponentProps,
  'useSessionPendingInteraction' | 'useWorkspaces'
> = {
  useSessionPendingInteraction: selectorHook(new Map()),
  useWorkspaces: selectorHook<WorkspaceSnapshot>({
    items: [],
    archivedSessionIds: [],
    state: 'idle',
    phase: 'ready',
    error: null,
  }),
}

/** One session address for the fixtures below; the brand is not observable here. */
const SESSION = 'sidebar-right-test' as SessionId

/**
 * The session kit of the session-scoped column, plus one session list holding
 * `current`. The shell renders chrome and its occupant's seat only, so every
 * hook here answers without a store — the ones it must not read throw.
 */
function sessionProps(current?: SessionId) {
  const list: SessionListState = {
    ids: [],
    byId: {},
    current,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  }
  return {
    ...globalProps,
    useSessions: selectorHook(list),
    // The seat exists for the framework to pass; this shell renders content
    // through `renderSlot` and never reads it.
    SessionProvider: unreadHook('the session provider seat') as unknown as SidebarRightRootComponentProps['SessionProvider'],
    sessionId: SESSION,
    useSession: unreadHook('the session snapshot'),
    useProjection: unreadHook('session projections'),
    useConversation: unreadHook('the conversation snapshot'),
    useInput: unreadHook('the input snapshot'),
    useChat: unreadHook('the chat snapshot'),
    useTrajectory: unreadHook('the trajectory snapshot') as SidebarRightRootComponentProps['useTrajectory'],
    inputActions: {
      setDraft: vi.fn(),
      addImages: vi.fn(() => true),
      removeImage: vi.fn(),
      pruneImages: vi.fn(),
      submit: vi.fn(),
    },
  }
}

afterEach(() => {
  cleanup()
})

/** Mount the corner toggle against a session list holding `current`. */
function mountToggle(current?: string, { rightbarCollapsed = true }: { rightbarCollapsed?: boolean } = {}) {
  const toggleRightbar = vi.fn()
  const useSessions = sessionProps(current as SessionId | undefined).useSessions
  const view = render(
    <ToggleButton
      {...globalProps}
      useSessions={useSessions}
      rightbarCollapsed={rightbarCollapsed}
      toggleRightbar={toggleRightbar}
      t={t}
    />,
  )
  return { toggleRightbar, view }
}

/** Mount the panel shell in a given collapsed state. */
function mountShell({ collapsed = false }: { collapsed?: boolean } = {}) {
  const renderSlot = vi.fn(() => null)
  const view = render(
    <SidebarRightRoot
      {...sessionProps(SESSION)}
      collapsed={collapsed}
      width={collapsed ? 0 : 320}
      t={t}
      renderSlot={renderSlot as unknown as SidebarRightRootComponentProps['renderSlot']}
    />,
  )
  return { renderSlot, view }
}

describe('ToggleButton', () => {
  it('renders no control when the session list holds no current session', () => {
    // Without a session there is no panel to open, so the seat stays empty
    // rather than offering a control that cannot act.
    mountToggle(undefined)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('opens the panel of the session the list reports as current', () => {
    const b = mountToggle('session-7')
    fireEvent.click(screen.getByRole('button', { name: 'Open sidebar' }))
    // The panel is per session, so the toggle carries the id it read.
    expect(b.toggleRightbar).toHaveBeenCalledWith('session-7')
  })

  it('names the direction it moves the panel', () => {
    // One control serves both directions from the frame's corner, so its copy
    // and state follow the column rather than naming only the way in.
    mountToggle('session-7', { rightbarCollapsed: false })
    const button = screen.getByRole('button', { name: 'Close sidebar' })
    expect(button.getAttribute('aria-expanded')).toBe('true')
  })
})

describe('SidebarRightRoot', () => {
  it('draws the occupant seat whether or not the column is folded', () => {
    // The occupant's seat is drawn either way, so the panel is usable before
    // any content plugin registers.
    expect(mountShell({ collapsed: true }).renderSlot).toHaveBeenCalledWith('sidebar.right.body', {})
    cleanup()
    expect(mountShell({ collapsed: false }).renderSlot).toHaveBeenCalledWith('sidebar.right.body', {})
  })

  it('carries no control of its own', () => {
    // The way out of the panel is the frame's corner toggle. A second control
    // inside the column would be the same affordance in the same corner, and
    // the column has no width to hold one while folded.
    mountShell({ collapsed: false })
    expect(screen.queryByRole('button')).toBeNull()
  })
})
