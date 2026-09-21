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
    byId: {} as SessionListState['byId'],
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

/** Mount the header toggle against a session list holding `current`. */
function mountToggle(current?: string) {
  const toggleRightbar = vi.fn()
  const useSessions = sessionProps(current as SessionId | undefined).useSessions
  const view = render(
    <ToggleButton
      {...globalProps}
      useSessions={useSessions}
      toggleRightbar={toggleRightbar}
      t={t}
    />,
  )
  return { toggleRightbar, view }
}

/** Mount the panel shell in a given collapsed state. */
function mountShell({ collapsed = false }: { collapsed?: boolean } = {}) {
  const toggleRightbar = vi.fn()
  const renderSlot = vi.fn(() => null)
  const view = render(
    <SidebarRightRoot
      {...sessionProps(SESSION)}
      collapsed={collapsed}
      width={collapsed ? 0 : 320}
      toggleRightbar={toggleRightbar}
      t={t}
      renderSlot={renderSlot as unknown as SidebarRightRootComponentProps['renderSlot']}
    />,
  )
  return { toggleRightbar, renderSlot, view }
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
    fireEvent.click(screen.getByRole('button', { name: 'Open right sidebar' }))
    // The panel is per session, so the toggle carries the id it read.
    expect(b.toggleRightbar).toHaveBeenCalledWith('session-7')
  })
})

describe('SidebarRightRoot', () => {
  it('folds the column and takes its own control out of the tab order', () => {
    const b = mountShell({ collapsed: true })
    const button = screen.getByRole('button', { name: 'Collapse right sidebar' })
    // A folded column cannot be reached by keyboard, so neither can its control.
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(button.getAttribute('tabindex')).toBe('-1')
    fireEvent.click(button)
    expect(b.toggleRightbar).toHaveBeenCalledOnce()
    // The occupant's seat is drawn either way, so the panel is usable before
    // any content plugin registers.
    expect(b.renderSlot).toHaveBeenCalledWith('sidebar.right.body', {})
  })

  it('leaves the control reachable while the column is open', () => {
    const b = mountShell({ collapsed: false })
    const button = screen.getByRole('button', { name: 'Collapse right sidebar' })
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(button.hasAttribute('tabindex')).toBe(false)
    fireEvent.click(button)
    expect(b.toggleRightbar).toHaveBeenCalledOnce()
  })
})
