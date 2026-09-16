// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps, ReactNode } from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionListState, SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  bindSnapshotSelector, makeTranslate, RemoteError, sessionSnapshot as sessionFixture,
} from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionPendingInteractionSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { ConversationRootProps } from '../src/client/skeleton/ConversationRoot.tsx'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { EMPTY_CONVERSATION_SNAPSHOT } from '../src/client/contract/snapshot.ts'
import type { ConversationSnapshot } from '../src/client/contract/snapshot.ts'
import { createConversationStore } from '../src/client/stores.ts'
import { SessionInputShell } from '../src/client/input/facade.ts'
import { en, zh } from '../src/client/locales.ts'
import { ConversationRoot } from '../src/client/skeleton/ConversationRoot.tsx'
import { ConversationSession, ConversationSessionHeader } from '../src/client/skeleton/ConversationSession.tsx'
import { conversationPhase } from '../src/client/contract/snapshot.ts'
import { HeroShell } from '../src/client/skeleton/EmptyHero.tsx'
import type { HeroShellProps } from '../src/client/skeleton/EmptyHero.tsx'
import { InputBar } from '../src/client/input/InputBar.tsx'
import type { InputBarProps } from '../src/client/input/InputBar.tsx'
import type {
  ComposerBarOwnerProps, ConversationHeaderLineageOwnerProps,
} from '../src/client/contract/slots.ts'
import type { ViewTab } from '../src/client/contract/views.ts'

// jsdom implements no Range geometry (Lexical's scroll-into-view measures the
// caret with one once the surface is genuinely contenteditable).
Range.prototype.getBoundingClientRect = () => ({
  top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}),
})

function fakeWiring() {
  const sink = vi.fn(() => Promise.resolve({ kind: 'success' as const }))
  const shell = new SessionInputShell({ actx: {} as Context, defaultSink: sink, commandImages: { serialize: () => Promise.resolve([]), release: () => {}, unsupportedNotice: (token: string) => `${token.trim()} images-unsupported` } })
  return { wiring: shell, sink, shell }
}

/** jsdom has no ResizeObserver; the root publishes its width and the composer
 * seat its height through one. Observed targets are recorded so a case can
 * fire the callback against a chosen element. */
const resizeObservers: { callback: ResizeObserverCallback; targets: Element[] }[] = []
class ResizeObserverStub {
  targets: Element[] = []
  constructor(callback: ResizeObserverCallback) {
    resizeObservers.push({ callback, targets: this.targets })
  }

  observe(target: Element): void { this.targets.push(target) }
  unobserve(): void {}
  disconnect(): void { this.targets.length = 0 }
}

/** Fires every recorded observer whose target list includes the element. */
function fireResize(el: Element): void {
  for (const entry of resizeObservers) {
    if (entry.targets.includes(el)) entry.callback([], undefined as never)
  }
}

/** ConversationRoot confirms paint on animation frames; jsdom must not fire them unless a case flushes. */
let rafSeq = 0
const rafPending = new Map<number, FrameRequestCallback>()

function stubAnimationFrames(): void {
  rafSeq = 0
  rafPending.clear()
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = ++rafSeq
    rafPending.set(id, cb)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    rafPending.delete(id)
  })
}

function flushAnimationFrames(rounds = 1): void {
  act(() => {
    for (let round = 0; round < rounds; round++) {
      const batch = [...rafPending.values()]
      rafPending.clear()
      for (const cb of batch) cb(0)
    }
  })
}

afterEach(() => {
  cleanup()
  document.getElementById('dsh-preloader')?.remove()
  vi.unstubAllGlobals()
  resizeObservers.length = 0
})
beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  stubAnimationFrames()
})

const t: ConversationRootProps['t'] = makeTranslate(zh, commonZh)

const sid = (id: string) => id as SessionId
const wid = (id: string) => id as WorkspaceId
const SID = sid('s1')

type SessionSlotProps = ComponentProps<typeof ConversationSession>

const useChat: SessionSlotProps['useChat'] = () => { throw new Error('unused') }
const useTrajectory: SessionSlotProps['useTrajectory'] = () => { throw new Error('unused') }

function workspace(id = 'w1'): WorkspaceView {
  return {
    workspaceId: wid(id), path: `/projects/${id}`, title: id, sessionIds: [],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

const workspaceState = (items: readonly WorkspaceView[]): WorkspaceSnapshot => ({
  items, archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
})

function sessionSnapshotOf(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return { ...sessionFixture(SID), ...overrides }
}

function mount(
  snapshot: SessionSnapshot,
  workspaceRows: WorkspaceView[] = [{ ...workspace('one'), sessionIds: [SID] }],
  retargetWorkspace = vi.fn(async (_workspaceId: WorkspaceId) => {}),
  options: {
    /** When true, mimic overlay:true chain siblings (hidden fallback + takeover). */
    overlayTakeover?: boolean
    /** The session list summary's `blank` flag — independent of the snapshot's. */
    summaryBlank?: boolean
    /** Drop the session's summary row entirely (a session the list has not caught up with). */
    omitSummaryRow?: boolean
    /** Classify the selected child as a subagent instead of an ordinary fork. */
    summaryOrigin?: 'subagent'
    /** Insert a first-level subagent between the root and selected child. */
    nestedSubagent?: boolean
    /** A composer block another plugin raised for this session. */
    composerBlock?: { reason: string }
    /** The View the shell has selected, driving composer placement. */
    selectedView?: ViewTab
    /** Mutable view ledger used by registration-order regressions. */
    viewTabs?: ViewTab[]
    /** Boot posture: the list has not completed its first pull yet. */
    sessionListPending?: boolean
    /** No session selected — cold start, or the list has yet to restore one. */
    noSelection?: boolean
    /** Override the selected Session identity. */
    sessionId?: SessionId
  } = {},
) {
  const root = sid('root')
  const parent = sid('parent')
  const rootRow = { id: root, displayTitle: 'Root', running: false, blank: false, updatedAt: 1 }
  const parentRow = {
    id: parent, displayTitle: 'Parent', parentId: root, origin: 'subagent' as const,
    running: false, blank: false, updatedAt: 2,
  }
  const childRow = {
    id: SID, displayTitle: 'Child', parentId: options.nestedSubagent === true ? parent : root,
    cwd: '/projects/one', running: false, blank: options.summaryBlank ?? false, updatedAt: 3,
    ...(options.summaryOrigin === undefined ? {} : { origin: options.summaryOrigin }),
  }
  const listed = options.omitSummaryRow !== true
  const sessions = createSnapshotStore<SessionListState>({
    ids: listed
      ? [root, ...options.nestedSubagent === true ? [parent] : [], SID]
      : [root],
    byId: {
      [root]: rootRow,
      ...listed && options.nestedSubagent === true && { [parent]: parentRow },
      ...listed && { [SID]: childRow },
    },
    current: options.noSelection === true ? undefined : SID,
    phase: options.sessionListPending === true ? 'pending' : 'ready',
    subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  })
  const workspaces = createSnapshotStore<WorkspaceSnapshot>(workspaceState(workspaceRows))
  const session = createSnapshotStore<SessionSnapshot>(snapshot)
  const useSession = bindSnapshotSelector(session)
  const conversation = createSnapshotStore<ConversationSnapshot>(EMPTY_CONVERSATION_SNAPSHOT)
  const useConversation = bindSnapshotSelector(conversation)
  const useSessionPendingInteraction = bindSnapshotSelector(
    createSnapshotStore<SessionPendingInteractionSnapshot>(new Map()),
  )
  const store = createConversationStore().create()
  store.actions.setDraft('ordinary draft')
  const { wiring, sink } = fakeWiring()
  const useInput = bindSnapshotSelector(wiring.state)
  const inputActions = wiring.actions
  const stop = vi.fn()
  const open = vi.fn()
  const slotCalls: string[] = []
  const lineageOwners: ConversationHeaderLineageOwnerProps[] = []
  const viewTabs = options.viewTabs ?? [
    { id: 'chat', label: 'Chat' },
    { id: 'trajectory', label: 'Trajectory' },
  ]
  const useConversationViews: SessionSlotProps['useConversationViews'] = selector => selector(viewTabs)
  /** Owner share handed to the two composer tool-row seats, per render. */
  const seatOwners: { key: string; owner: unknown }[] = []
  let pickerOwner: unknown
  const renderSlot = ((key: string, owner: object, opts?: { only?: string; fallback?: ReactNode }) => {
    slotCalls.push(key)
    if (key === 'conversation.input.model' || key === 'conversation.input.plan') {
      seatOwners.push({ key, owner })
    }
    if (key === 'conversation.hero.workspace') { pickerOwner = owner; return null }
    if (key === 'conversation.session.header.lineage') {
      lineageOwners.push(owner as ConversationHeaderLineageOwnerProps)
      return opts?.fallback ?? null
    }
    if (key === 'conversation.session.header') {
      return (
        <ConversationSessionHeader
          sessionId={SID}
          SessionProvider={({ children }) => children}
          useSession={useSession}
          useConversation={useConversation}
          useConversationViews={useConversationViews}
          useChat={useChat}
          useTrajectory={useTrajectory}
          useSessions={props.useSessions}
          useSessionPendingInteraction={useSessionPendingInteraction}
          useWorkspaces={props.useWorkspaces}
          useProjection={(() => undefined)}
          useInput={useInput}
          inputActions={inputActions}
          useStore={bindSnapshotSelector(store)}
          actions={store.actions}
          renderSlot={renderSlot as never}
          open={open}
          selectView={(view) => { store.actions.setView(view) }}
          t={t}
        />
      )
    }
    if (key === 'conversation.session') {
      return (
        <ConversationSession
          sessionId={SID}
          SessionProvider={({ children }) => children}
          useSession={useSession}
          useConversation={useConversation}
          useConversationViews={useConversationViews}
          useChat={useChat}
          useTrajectory={useTrajectory}
          useSessions={props.useSessions}
          useSessionPendingInteraction={useSessionPendingInteraction}
          useWorkspaces={props.useWorkspaces}
          useProjection={(() => undefined)}
          useInput={useInput}
          inputActions={inputActions}
          useStore={bindSnapshotSelector(store)}
          actions={store.actions}
          renderSlot={renderSlot as never}
          bindDraftMirror={write => wiring.bindMirror(write)}
          openView={(view, focus) => { store.actions.openView(view, focus) }}
        />
      )
    }
    if (key === 'conversation.composer.bar') {
      // The real entry, mounted the way the outlet composes it: standard kit
      // (shared with the root's props below) + this entry's inject + owner.
      const bar = owner as ComposerBarOwnerProps
      return (
        <InputBar
          sessionId={SID}
          SessionProvider={({ children }) => children}
          useSession={useSession}
          useConversation={useConversation}
          useSessions={props.useSessions}
          useSessionPendingInteraction={useSessionPendingInteraction}
          useWorkspaces={props.useWorkspaces}
          useProjection={(() => undefined)}
          useInput={useInput}
          inputActions={inputActions}
          keyboard={wiring}
          addImages={() => null}
          removeImage={() => {}}
          draftImages={() => []}
          resolveSubmitMode={() => 'queue'}
          toggleCommandMenu={vi.fn()}
          useNotices={bindSnapshotSelector(wiring.notices)}
          useLexicon={bindSnapshotSelector(wiring.lexicon)}
          useMenuLauncher={bindSnapshotSelector(createSnapshotStore<string | null>(null))}
          stop={stop}
          command={() => Promise.resolve(true)}
          t={t}
          renderSlot={((key: string, seatOwner: object) => {
            // The bar's own seats: recorded so a case can assert what share
            // each tool-row control received.
            seatOwners.push({ key, owner: seatOwner })
            return null
          }) as InputBarProps['renderSlot']}
          {...bar}
        />
      )
    }
    return <div data-testid={`view-${opts?.only ?? key}`} />
  }) as ConversationRootProps['renderSlot']
  const renderSlotChain = ((_key, _owner, opts) => (
    options.overlayTakeover === true
      ? (
        <>
          <div data-chain-overlay-fallback="conversation.composer" style={{ display: 'none' }}>
            {opts?.fallback ?? null}
          </div>
          <div data-testid="composer-takeover">TAKEOVER</div>
        </>
      )
      : (opts?.fallback ?? null)
  )) as ConversationRootProps['renderSlotChain']
  const props: ConversationRootProps = {
    sessionId: options.noSelection === true ? undefined : (options.sessionId ?? SID),
    SessionProvider: ({ children }) => children,
    useSession,
    useConversation,
    useSessions: bindSnapshotSelector(sessions),
    useSessionPendingInteraction,
    useWorkspaces: bindSnapshotSelector(workspaces),
    useProjection: (() => undefined),
    useComposerBlock: select => select(options.composerBlock),
    useSelectedView: select => select(options.selectedView),
    useInput,
    inputActions,
    renderSlot,
    renderSlotChain,
    selectWorkspace: retargetWorkspace,
    t,
  }
  const view = render(<ConversationRoot {...props} />)
  flushAnimationFrames(2)
  return {
    view, store, wiring, sink, retargetWorkspace, session, conversation, slotCalls, lineageOwners, seatOwners, open,
    pickerOwner: () => pickerOwner,
    rerender: (patch?: Partial<Pick<ConversationRootProps, 'sessionId'>>) => {
      Object.assign(props, patch)
      view.rerender(<ConversationRoot {...props} />)
    },
  }
}

describe('Hero chrome', () => {
  it('renders the English preview badge through the hero locale seat', () => {
    const renderSlot = vi.fn<HeroShellProps['renderSlot']>(() => null)
    const view = render(<HeroShell t={makeTranslate(en, commonEn)} renderSlot={renderSlot} />)
    expect(view.getByText('Into the Unknown')).toBeTruthy()
    expect(view.getByText('Preview')).toBeTruthy()
    expect(renderSlot).toHaveBeenCalledOnce()
    expect(renderSlot.mock.calls[0]?.[0]).toBe('conversation.hero.brand.mark')
    const brandMarkOwner = renderSlot.mock.calls[0]?.[1]
    if (brandMarkOwner === undefined || !('size' in brandMarkOwner) || !('className' in brandMarkOwner)) {
      throw new Error('hero brand-mark owner must provide size and className')
    }
    expect(brandMarkOwner.size).toBe(34)
    expect(brandMarkOwner.className).toBeTypeOf('string')
    expect(renderSlot.mock.calls[0]?.[2]?.fallback).toBeTruthy()
  })
})

describe('ConversationRoot resident composer', () => {
  it('does not redispatch composer child slots for an unrelated Session publication', () => {
    const b = mount(sessionSnapshotOf())
    const childKeys = new Set([
      'conversation.input.overlay',
      'conversation.input.left',
      'conversation.input.right',
      'conversation.composer.dock',
    ])
    const dispatchCount = () => b.slotCalls.filter(key => childKeys.has(key)).length
    const before = dispatchCount()

    act(() => {
      const current = b.session.getSnapshot()
      b.session.set({ ...current, hasMore: !current.hasMore })
    })

    expect(dispatchCount()).toBe(before)
  })

  it('renders the composer inert with the blocker\u2019s own reason', () => {
    const b = mount(sessionSnapshotOf(), undefined, undefined, {
      composerBlock: { reason: 'select a model first' },
    })
    const box = b.view.getByRole('textbox')
    // One disabled composer with the blocker's placeholder, never a second
    // tree: the DOM survives the block being raised and cleared.
    expect(box.getAttribute('aria-disabled')).toBe('true')
    expect(box.getAttribute('data-placeholder')).toBe('select a model first')
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(b.sink).not.toHaveBeenCalled()

    // The model seat stays live. Locking it too would leave the composer
    // asking for the one thing it prevents — every block this contract has is
    // cleared by choosing a model.
    const seat = (key: string) => b.seatOwners.filter(call => call.key === key).at(-1)?.owner
    expect(seat('conversation.input.model')).toEqual({ locked: false })
    expect(seat('conversation.input.plan')).toEqual({ locked: true })
  })

  it('lets the no-workspace posture win over a block', () => {
    // Picking a workspace is the earlier prerequisite; naming a model first
    // would send the user somewhere they cannot act yet.
    const b = mount(sessionSnapshotOf({ blank: true }), [], undefined, {
      summaryBlank: true,
      composerBlock: { reason: 'select a model first' },
    })
    const box = b.view.getByRole('textbox')
    expect(box.getAttribute('aria-disabled')).not.toBe('true')
    expect(box.getAttribute('contenteditable')).not.toBe('true')
    expect(box.getAttribute('aria-haspopup')).toBe('menu')
    expect(box.getAttribute('data-placeholder')).not.toBe('select a model first')
    const modelSeat = b.seatOwners.filter(call => call.key === 'conversation.input.model').at(-1)?.owner
    expect(modelSeat).toEqual({ locked: true })
  })

  it('keeps composer text in the machine, mirrors to the Conversation store, and submits through the sink', () => {
    const b = mount(sessionSnapshotOf())
    const box = b.view.getByRole('textbox')
    expect(b.wiring.snapshot.draft).toBe('ordinary draft')
    act(() => { b.wiring.setDraft('ordinary revised') })
    expect(b.store.store.getSnapshot().draft).toBe('ordinary revised')
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(b.sink).toHaveBeenCalledWith('ordinary revised', [], 'queue', expect.any(AbortSignal))
    expect((b.view.getByRole('button', { name: 'Child' }) as HTMLButtonElement).disabled).toBe(true)
    expect(b.view.queryByText('Root')).toBeNull()
  })

  it('shows hierarchy only for subagents and opens their ordinary owner', () => {
    const b = mount(sessionSnapshotOf(), undefined, undefined, { summaryOrigin: 'subagent' })
    const root = b.view.getByRole('button', { name: 'Root' })
    expect((b.view.getByRole('button', { name: 'Child' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(root)
    expect(b.open).toHaveBeenCalledWith(sid('root'))
  })

  it('keeps intermediate subagent breadcrumbs at the compact title size', () => {
    const b = mount(sessionSnapshotOf(), undefined, undefined, {
      summaryOrigin: 'subagent',
      nestedSubagent: true,
    })
    expect(b.view.getByRole('button', { name: 'Root' }).className).not.toContain('crumbSubagent')
    expect(b.view.getByRole('button', { name: 'Parent' }).className).toContain('crumbSubagent')
    expect(b.view.getByRole('button', { name: 'Child' }).className).toContain('crumbSubagent')
    expect(b.lineageOwners.slice(-2).map(owner => owner.lineageSessionId)).toEqual([
      sid('parent'),
      SID,
    ])
    expect(b.lineageOwners.at(-2)?.openTitle).toEqual(expect.any(Function))
    expect(b.lineageOwners.at(-1)?.openTitle).toBeUndefined()
  })

  it('active phase: one scroller holds the header, the transcript, and the composer seat', () => {
    const b = mount(sessionSnapshotOf())
    const host = b.view.container.querySelector('[data-conversation-scroll]')
    const seat = b.view.container.querySelector('[data-composer-seat]')
    const header = b.view.container.querySelector('header')
    const textarea = b.view.container.querySelector<HTMLDivElement>('[data-composer-input]')
    expect(host).not.toBeNull()
    expect(seat).not.toBeNull()
    expect(header).not.toBeNull()
    // The column is one scrollport: the header sticks at its top, the transcript
    // is in flow, and the seat sticks at its floor, so all three are laid out in
    // one content box and a scrollbar shortens them identically. The two chrome
    // layers stay outside it — a layer among the scrolled children is placed by
    // its own spot in the flow, travels with it, and extends the scroll range.
    expect(host?.contains(header)).toBe(true)
    expect(host?.contains(seat)).toBe(true)
    expect(seat?.contains(textarea)).toBe(true)
    expect(host?.contains(b.view.container.querySelector('[data-conversation-chrome]'))).toBe(false)
    expect(host?.contains(b.view.container.querySelector('[data-conversation-chrome-top]'))).toBe(false)
    expect(b.slotCalls).toContain('conversation.session.header.lineage')
    expect(b.slotCalls).toContain('conversation.session.header.actions')
    expect(b.slotCalls).toContain('conversation.session.header.utilities')
  })

  it('sticky composer seat wraps the whole overlay chain, not only the fallback stack', () => {
    const b = mount(sessionSnapshotOf(), undefined, undefined, { overlayTakeover: true })
    const seat = b.view.container.querySelector('[data-composer-seat]')
    const takeover = b.view.getByTestId('composer-takeover')
    const fallback = b.view.container.querySelector('[data-chain-overlay-fallback="conversation.composer"]')
    expect(seat?.contains(takeover)).toBe(true)
    expect(seat?.contains(fallback)).toBe(true)
  })

  it('hero phase: same textarea, hero chrome, visible Session header, picker switches the workspace', () => {
    const b = mount(
      sessionSnapshotOf({ blank: true }),
      [
        { ...workspace('one'), sessionIds: [SID] },
        { ...workspace('second'), title: 'Selected Folder' },
      ],
      undefined,
      { summaryBlank: true },
    )
    // Hero chrome is present and the selected View slot remains absent.
    const host = b.view.container.querySelector('[data-conversation-scroll]')
    const header = b.view.container.querySelector('header')
    expect(host).not.toBeNull()
    expect(header?.getAttribute('aria-hidden')).toBeNull()
    expect(b.view.getByRole('button', { name: 'Child' })).toBeTruthy()
    expect(b.slotCalls).toContain('conversation.session.header.actions')
    expect(b.slotCalls).toContain('conversation.session.header.utilities')
    expect(b.view.getByText('探索未至之境')).toBeTruthy()
    expect(b.view.getByText('预览版')).toBeTruthy()
    expect(b.view.queryByTestId('view-chat')).toBeNull()
    expect(b.view.container.querySelector('[data-transcript-hold]')).toBeNull()
    // The same machine-backed textarea is live in the hero, and the
    // persistence mirror stays bound (ConversationSession mounts chrome-hidden
    // for blank sessions): hero typing reaches the Conversation store. The hero
    // composer centres inside the column's one scroller, so the box is a
    // scrollport descendant there too.
    const box = b.view.getByRole('textbox')
    expect(host?.contains(box)).toBe(true)
    expect(b.view.container.querySelector('[data-composer-seat]')?.contains(box)).toBe(true)
    act(() => { b.wiring.setDraft('draft in hero') })
    expect(b.store.store.getSnapshot().draft).toBe('draft in hero')
    // Picker: open through the chip; a pick switches to the other
    // workspace's blank session (draft carry is apply-layer wiring).
    fireEvent.click(b.view.getByRole('button', { name: '选择工作区' }))
    const owner = b.pickerOwner() as { open: boolean; onPick(id: WorkspaceId): void }
    expect(owner.open).toBe(true)
    act(() => { owner.onPick(wid('second')) })
    expect(b.retargetWorkspace).toHaveBeenCalledWith(wid('second'))
    expect(b.view.getByText('Selected Folder')).toBeTruthy()
  })

  it('keeps a rejected first prompt engaging instead of returning to the Hero', () => {
    const failed = sessionSnapshotOf({
      blank: true,
      promptAttempted: true,
      awaitingFirstTurn: true,
      promptError: {
        op: 'send',
        error: new RemoteError('session/agent-busy', 'busy', { reason: 'busy' }),
      },
    })

    expect(conversationPhase(failed, EMPTY_CONVERSATION_SNAPSHOT)).toBe('engaging')
    const b = mount(failed, undefined, undefined, { summaryBlank: true })
    expect(b.view.container.querySelector('[data-phase]')?.getAttribute('data-phase')).toBe('active')
    expect(b.view.queryByText('探索未至之境')).toBeNull()
  })

  it('active phase: a list-proven non-blank session keeps the docked composer while history opens', () => {
    const b = mount(sessionSnapshotOf({ openState: 'loading' }))
    const root = b.view.container.querySelector('[data-phase]')
    expect(root?.getAttribute('data-phase')).toBe('active')
    expect(b.view.getByRole('textbox')).toBeTruthy()
  })

  it('keeps the docked composer when the list proves history even if the Session snapshot is still blank', () => {
    const b = mount(sessionSnapshotOf({ blank: true, openState: 'open' }))
    const root = b.view.container.querySelector('[data-phase]')
    expect(root?.getAttribute('data-phase')).toBe('active')
    expect(b.view.queryByTestId('hero-headline')).toBeNull()
    expect(b.view.getByRole('textbox')).toBeTruthy()
  })

  it('keeps the docked composer when the list has no row yet', () => {
    const b = mount(
      sessionSnapshotOf({ blank: true, openState: 'loading' }),
      undefined,
      undefined,
      { omitSummaryRow: true },
    )
    const root = b.view.container.querySelector('[data-phase]')
    expect(root?.getAttribute('data-phase')).toBe('active')
    expect(b.view.getByRole('textbox')).toBeTruthy()
  })

  it('settling phase: a pending session list hides the composer instead of flashing the cold-start hero', () => {
    // A restored session with history has not been selected yet at this point;
    // rendering the hero here shows an empty-session composer that the docked
    // bar then replaces.
    const b = mount(
      sessionSnapshotOf({ blank: true, openState: 'cold' }),
      undefined,
      undefined,
      { noSelection: true, sessionListPending: true },
    )
    const root = b.view.container.querySelector('[data-phase]')
    expect(root?.getAttribute('data-phase')).toBe('settling')
    expect(b.view.queryByTestId('hero-headline')).toBeNull()
  })

  it('hero phase: a ready list with nothing selected is the genuine cold start', () => {
    const b = mount(
      sessionSnapshotOf({ blank: true, openState: 'cold' }),
      undefined,
      undefined,
      { noSelection: true },
    )
    const root = b.view.container.querySelector('[data-phase]')
    expect(root?.getAttribute('data-phase')).toBe('hero')
  })

  it('covers the content column with a loader while history is opening', () => {
    const b = mount(sessionSnapshotOf({ openState: 'loading' }))
    const loader = b.view.container.querySelector('[data-content-loader]')
    expect(loader).not.toBeNull()
    expect(loader?.getAttribute('aria-label')).toBe('正在载入内容')
    expect(loader?.getAttribute('data-hiding')).toBeNull()
  })

  it('shows the content loader immediately when a selected Session is still cold', () => {
    const b = mount(sessionSnapshotOf({ openState: 'cold' }))
    expect(b.view.container.querySelector('[data-content-loader]')).not.toBeNull()
  })

  it('does not cover a summary-proven blank hero with the content loader', () => {
    const b = mount(
      sessionSnapshotOf({ blank: true, openState: 'loading' }),
      undefined,
      undefined,
      { summaryBlank: true },
    )
    expect(b.view.container.querySelector('[data-content-loader]')).toBeNull()
  })

  it('fades the content loader away once history is open and painted', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const b = mount(sessionSnapshotOf({ openState: 'loading' }))
      expect(b.view.container.querySelector('[data-content-loader]')).not.toBeNull()
      act(() => { b.session.set(sessionSnapshotOf({ openState: 'open' })) })
      expect(b.view.container.querySelector('[data-content-loader]')?.getAttribute('data-hiding')).toBeNull()
      flushAnimationFrames(2)
      const hiding = b.view.container.querySelector('[data-content-loader]')
      expect(hiding?.getAttribute('data-hiding')).toBe('true')
      act(() => { vi.advanceTimersByTime(400) })
      expect(b.view.container.querySelector('[data-content-loader]')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the header and composer DOM across a Session switch', () => {
    const b = mount(sessionSnapshotOf())
    const header = b.view.container.querySelector('header')
    const box = b.view.getByRole('textbox')
    const seat = b.view.container.querySelector('[data-composer-seat]')
    expect(header).not.toBeNull()
    expect(b.view.container.querySelector('[data-phase]')?.getAttribute('data-phase')).toBe('active')
    b.rerender({ sessionId: sid('s2') })
    expect(b.view.container.querySelector('header')).toBe(header)
    expect(b.view.getByRole('textbox')).toBe(box)
    expect(b.view.container.querySelector('[data-composer-seat]')).toBe(seat)
    expect(b.view.container.querySelector('[data-phase]')?.getAttribute('data-phase')).toBe('active')
  })

  it('covers an already-open Session switch and remounts the body after the overlay is presented', () => {
    const b = mount(sessionSnapshotOf())
    flushAnimationFrames(2)
    expect(b.view.container.querySelector('[data-content-loader]')?.getAttribute('data-hiding')).toBe('true')
    expect(b.view.getByTestId('view-chat')).toBeTruthy()
    b.rerender({ sessionId: sid('s2') })
    expect(b.view.container.querySelector('[data-content-loader]')?.getAttribute('data-hiding')).toBeNull()
    expect(b.view.queryByTestId('view-chat')).toBeNull()
    const host = b.view.container.querySelector('[data-conversation-scroll]')
    const hold = host?.querySelector('[data-transcript-hold]')
    const seat = host?.querySelector('[data-composer-seat]')
    expect(hold).not.toBeNull()
    expect(hold?.nextElementSibling).toBe(seat)
    flushAnimationFrames(1)
    expect(b.view.queryByTestId('view-chat')).toBeNull()
    expect(host?.querySelector('[data-transcript-hold]')).not.toBeNull()
    flushAnimationFrames(1)
    expect(b.view.getByTestId('view-chat')).toBeTruthy()
    expect(host?.querySelector('[data-transcript-hold]')).toBeNull()
    expect(b.view.container.querySelector('[data-content-loader]')?.getAttribute('data-hiding')).toBeNull()
    flushAnimationFrames(2)
    expect(b.view.container.querySelector('[data-content-loader]')?.getAttribute('data-hiding')).toBe('true')
  })

  it('keeps the content loader out of the session header and composer', () => {
    const b = mount(sessionSnapshotOf({ openState: 'loading' }))
    const loader = b.view.container.querySelector('[data-content-loader]')
    const header = b.view.container.querySelector('header')
    const seat = b.view.container.querySelector('[data-composer-seat]')
    const host = b.view.container.querySelector('[data-conversation-scroll]')
    const root = b.view.container.querySelector('[data-phase]')
    expect(loader).not.toBeNull()
    expect(header).not.toBeNull()
    expect(seat).not.toBeNull()
    expect(root?.contains(loader)).toBe(true)
    expect(header?.contains(loader)).toBe(false)
    expect(seat?.contains(loader)).toBe(false)
    expect(loader?.contains(header)).toBe(false)
    expect(loader?.contains(seat)).toBe(false)
    expect(host?.contains(loader)).toBe(false)
  })

  it('does not show the content loader while the page preloader is still on screen', () => {
    const el = document.createElement('div')
    el.id = 'dsh-preloader'
    el.className = 'hide animate'
    document.body.append(el)
    const b = mount(sessionSnapshotOf({ openState: 'loading' }))
    expect(b.view.container.querySelector('[data-content-loader]')).toBeNull()
    expect(b.view.getByTestId('view-chat')).toBeTruthy()
  })

  it('shows the content loader once the page preloader is screen-hidden', async () => {
    const el = document.createElement('div')
    el.id = 'dsh-preloader'
    document.body.append(el)
    const b = mount(sessionSnapshotOf({ openState: 'loading' }))
    expect(b.view.container.querySelector('[data-content-loader]')).toBeNull()
    await act(async () => {
      el.classList.add('screen-hidden')
      await Promise.resolve()
    })
    expect(b.view.container.querySelector('[data-content-loader]')).not.toBeNull()
    expect(b.view.container.querySelector('[data-content-loader]')?.getAttribute('data-hiding')).toBeNull()
  })

  it('startup auto-selection: a summary-proven blank session opens straight into the hero', () => {
    const b = mount(
      sessionSnapshotOf({ blank: true, openState: 'loading' }),
      undefined,
      undefined,
      { summaryBlank: true },
    )
    // The summary already proves the outcome, so the settling hide would only
    // blank the column for the history round-trip.
    const root = b.view.container.querySelector('[data-phase]')
    expect(root?.getAttribute('data-phase')).toBe('hero')
    expect(b.view.getByText('探索未至之境')).toBeTruthy()
    expect(b.view.getByRole('textbox')).toBeTruthy()
  })

  it('same textarea DOM node survives the hero → active flip', () => {
    const b = mount(sessionSnapshotOf({ blank: true }), undefined, undefined, { summaryBlank: true })
    const before = b.view.getByRole('textbox')
    const seat = b.view.container.querySelector('[data-composer-seat]')
    act(() => { b.wiring.setDraft('kept across flip') })
    // First message landed: content exists, phase leaves blank. The composer
    // seat is resident chrome in both phases, so the seat element, the textarea
    // node, and the InputHub draft all survive. The seat is a child of the
    // column's one scroller in both phases, so the flip moves nothing between
    // boxes either.
    b.session.set(sessionSnapshotOf({ blank: false }))
    b.rerender()
    const after = b.view.getByRole('textbox')
    expect(after).toBe(before)
    expect(b.wiring.snapshot.draft).toBe('kept across flip')
    expect(b.store.store.getSnapshot().draft).toBe('kept across flip')
    expect(b.view.container.querySelector('[data-composer-seat]')).toBe(seat)
    expect(b.view.container.querySelector('[data-conversation-scroll]')?.contains(after)).toBe(true)
    expect(b.view.container.querySelector('[data-composer-seat]')?.contains(after)).toBe(true)
    expect(b.view.queryByTestId('hero-headline')).toBeNull()
    expect(b.view.getByTestId('view-chat')).toBeTruthy()
  })

  it('keeps the Chat fallback selected by id when a view is inserted before it', () => {
    const viewTabs: ViewTab[] = [
      { id: 'chat', label: 'Chat' },
      { id: 'trajectory', label: 'Trajectory' },
    ]
    const b = mount(sessionSnapshotOf(), undefined, undefined, { viewTabs })
    // A removed dynamic view leaves its persisted id behind. The visible
    // fallback is Chat and must stay Chat when another lower-order view lands.
    act(() => { b.store.actions.setView('removed-view') })
    expect(b.view.getByTestId('view-chat')).toBeTruthy()

    viewTabs.unshift({ id: 'new-view', label: 'New view' })
    b.rerender()

    expect(b.view.getByTestId('view-chat')).toBeTruthy()
    expect(b.view.queryByTestId('view-new-view')).toBeNull()
    expect(b.view.getByRole('tab', { name: 'Chat' }).getAttribute('aria-selected')).toBe('true')
    expect(b.view.getByRole('tab', { name: 'New view' }).getAttribute('aria-selected')).toBe('false')
  })

  it('rolls the pending workspace label back when switching fails', async () => {
    const selectWorkspace = vi.fn(async () => { throw new Error('connect failed') })
    const b = mount(
      sessionSnapshotOf({ blank: true }),
      [
        { ...workspace('one'), sessionIds: [SID] },
        { ...workspace('second'), title: 'Selected Folder' },
      ],
      selectWorkspace,
      { summaryBlank: true },
    )
    fireEvent.click(b.view.getByRole('button', { name: '选择工作区' }))
    const owner = b.pickerOwner() as { onPick(id: WorkspaceId): void }
    await act(async () => { owner.onPick(wid('second')); await Promise.resolve() })
    expect(selectWorkspace).toHaveBeenCalledWith(wid('second'))
    expect(b.view.queryByText('Selected Folder')).toBeNull()
    expect(b.view.getByText('one')).toBeTruthy()
  })

  it('blank session keeps the interactive picker chip (workspace switchable until the first message)', () => {
    const b = mount(sessionSnapshotOf({ blank: true }), undefined, undefined, { summaryBlank: true })
    const chip = b.view.getByRole('button', { name: '选择工作区' })
    expect((chip as HTMLButtonElement).disabled).toBe(false)
    expect(b.slotCalls).toContain('conversation.hero.workspace')
    // The agent-preset chip sits in the same row, for the same reason: both
    // choices are only open before the first message.
    expect(b.slotCalls).toContain('conversation.hero.agentPreset')
  })

  it('prompt failure renders the promptError strip (ordinary failure, no transaction UI)', () => {
    const b = mount(sessionSnapshotOf({
      promptError: { op: 'send', error: { code: 'offline', message: 'Message send failed' } as never },
    }))
    expect(b.view.getByRole('alert').textContent).toContain('Message send failed (offline)')
    expect(b.view.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('leaves the width axis to CSS: no column width is published from script', () => {
    const b = mount(sessionSnapshotOf())
    const root = b.view.container.querySelector('[data-phase]') as HTMLElement
    Object.defineProperty(root, 'offsetWidth', { value: 1200, configurable: true })
    act(() => { fireResize(root) })
    // The column width reaches CSS as the centre column's 100cqi. Publishing it
    // from a resize observer wrote an inherited custom property on an ancestor
    // of the whole transcript once per animation frame, which invalidated style
    // for every element below it and stalled the sidebar's slide.
    expect(root.style.getPropertyValue('--dsh-conversation-column-width')).toBe('')
    // No dragged preference: the attribute-selected clamp stays off, so the
    // baseline term applies.
    expect(root.getAttribute('data-chat-user-width')).toBeNull()
    expect(root.style.getPropertyValue('--dsh-chat-user-width')).toBe('')
  })

  it('drag → persist → window clamp round-trip on a width handle', () => {
    const b = mount(sessionSnapshotOf())
    const root = b.view.container.querySelector('[data-phase]') as HTMLElement
    Object.defineProperty(root, 'offsetWidth', { value: 1600, configurable: true })
    act(() => { fireResize(root) })
    const handle = b.view.container.querySelector('[data-width-handle="right"]') as HTMLElement
    expect(handle).not.toBeNull()
    // jsdom lacks pointer capture: emulate per-element so hasPointerCapture
    // gates pass; the finally block restores the original descriptors so the
    // stubs cannot leak into later tests.
    const names = ['setPointerCapture', 'releasePointerCapture', 'hasPointerCapture'] as const
    const originals = names.map(name =>
      [name, Object.getOwnPropertyDescriptor(Element.prototype, name)] as const)
    const captured = new Set<Element>()
    Element.prototype.setPointerCapture = function () { captured.add(this) }
    Element.prototype.releasePointerCapture = function () { captured.delete(this) }
    Element.prototype.hasPointerCapture = function () { return captured.has(this) }
    try {
      // Base resolves from the Aeven reading cap: min(1600 − 48, 1024) = 1024.
      // Dragging the right handle outward by 25px widens by 2×25 = 50 → 1074,
      // inside both bounds (max = 1600 − 176 = 1424 keeps the handles on-column).
      fireEvent.pointerDown(handle, { pointerId: 1, clientX: 800, clientY: 300 })
      fireEvent.pointerUp(handle, { pointerId: 1, clientX: 825, clientY: 300 })
      expect(root.style.getPropertyValue('--dsh-chat-user-width')).toBe('1074px')
      expect(localStorage.getItem('dsh.conversation.contentWidth')).toBe('1074')
      expect(root.getAttribute('data-chat-user-width')).toBe('')
      // Window shrinks: script publishes nothing. The preference rides the DOM
      // unchanged and CSS clamps what is displayed against the live column
      // (clamp(640px, pref, max(640px, 100cqi - 176px))), so a narrower window
      // never rewrites the stored width.
      Object.defineProperty(root, 'offsetWidth', { value: 900, configurable: true })
      act(() => { fireResize(root) })
      expect(root.style.getPropertyValue('--dsh-chat-user-width')).toBe('1074px')
      expect(localStorage.getItem('dsh.conversation.contentWidth')).toBe('1074')
      // A press without travel (a real double-click delivers two such
      // press/release rounds) must not commit the clamped display value over
      // the stored preference.
      fireEvent.pointerDown(handle, { pointerId: 1, clientX: 800, clientY: 300 })
      fireEvent.pointerUp(handle, { pointerId: 1, clientX: 800, clientY: 300 })
      expect(localStorage.getItem('dsh.conversation.contentWidth')).toBe('1074')
      expect(root.style.getPropertyValue('--dsh-chat-user-width')).toBe('1074px')
      // No reset affordance on the handle: double-click leaves the preference alone.
      fireEvent.doubleClick(handle)
      expect(localStorage.getItem('dsh.conversation.contentWidth')).toBe('1074')
    } finally {
      for (const [name, descriptor] of originals) {
        if (descriptor === undefined) Reflect.deleteProperty(Element.prototype, name)
        else Object.defineProperty(Element.prototype, name, descriptor)
      }
    }
  })

  it('hero phase renders no width handles (no transcript to size)', () => {
    const b = mount(sessionSnapshotOf({ blank: true }), undefined, undefined, { summaryBlank: true })
    expect(b.view.container.querySelector('[data-width-handle]')).toBeNull()
  })
})
