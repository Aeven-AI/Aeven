// An enclosing `[data-conversation-scroll]` owns scrolling when present;
// otherwise this view owns it. Each row subscribes to one stable node key.

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type {
  ConversationTimelineSnapshot, RenderMessageImages,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionSeq } from '@deepseek-ai/dsh-session/types'
import { Button, IconChevronDownOutline14, Modal, Spinner } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import type { ChatSnapshot } from '../contract/snapshot.ts'
import { PendingSteeringBubble, PendingSubmissionBubble } from './MessageItem.tsx'
import { ChatNodeSeat } from './ChatNodeSeat.tsx'
import { TurnNavigator } from './TurnNavigator.tsx'
import { mergeTurnRailItems, type TurnRailItem } from './turn-rail-items.ts'
import { formatRunDuration } from './message-chrome.ts'
import a11yCss from './accessibility.module.css'
import css from './ChatView.module.css'

const FOLLOW_THRESHOLD = 24
const SCROLL_SAMPLE_INTERVAL_MS = 500
/** Prefetch runway floor, for a scrollport too short to give one of its own. */
const OLDER_PREFETCH_MARGIN = 1500
/** Screens of runway ahead of the head: a fling has to outrun this much to reach it. */
const OLDER_PREFETCH_SCREENS = 4

/** Active column host when present; otherwise the view-local scroller. */
function scrollerOf(from: HTMLElement): HTMLElement {
  return (from.closest('[data-conversation-scroll]')) ?? from
}

interface ReadingAnchor {
  /** Stable node/call identity, independent of boundary-spanning group keys. */
  key: string
  /** Row top in scroll-content coordinates: scrolling never changes it, only layout above the row does. */
  offset: number
}

/** Find an already-rendered row without interpolating a selector. */
function anchorElement(list: HTMLElement, key: string): HTMLElement | null {
  for (const row of list.querySelectorAll<HTMLElement>('[data-chat-anchor-key]:not([hidden])')) {
    if (row.dataset.chatAnchorKey === key) return row
  }
  return null
}

/**
 * Turn owning the row at a scrollport line. Scroll frames are hot, so this
 * hit-tests the line first and falls back to a bisection when layout cannot
 * answer (jsdom, pre-paint, or the line landing in the gaps between rows).
 *
 * The fallback is a bisection rather than a scan because a scan costs one
 * `getBoundingClientRect` per rendered row, and each of those forces a layout
 * of the whole transcript: on a long session that is hundreds of reads per
 * call, several times a frame, and the cost grows with the history the reader
 * has loaded. Bisection makes it ~10 reads regardless of depth.
 *
 * Rows carrying `[data-chat-turn]` are interleaved with hidden ones, and a
 * hidden row reports a zeroed rect whose `y` is 0 — sorted ahead of every
 * visible row, which defeats both a plain scan and a plain bisection. Only
 * visible rows are ordered by document position, so the bisection steps over
 * zero-height rows to compare the nearest visible row instead.
 * @param list - the ChatView list element.
 * @param line - viewport y of the reading line.
 * @returns the Turn number, or null when no loaded row covers the line.
 */
function turnAtLine(list: HTMLElement, line: number): number | null {
  const content = list.getBoundingClientRect()
  if (typeof document.elementsFromPoint === 'function' && content.width > 0) {
    for (const element of document.elementsFromPoint(content.left + content.width / 2, line)) {
      const row = element instanceof HTMLElement ? element.closest<HTMLElement>('[data-chat-turn]') : null
      const turn = Number(row?.dataset.chatTurn)
      if (row !== null && list.contains(row) && Number.isSafeInteger(turn)) return turn
    }
  }
  const rows = list.querySelectorAll<HTMLElement>('[data-chat-turn]')
  const count = rows.length
  /** A hidden or empty row renders no box; only visible rows are ordered. */
  const visible = (row: HTMLElement | null): boolean =>
    row !== null && row.getBoundingClientRect().height > 0
  /** The nearest visible row index at or after `from`, or `count` when none remains. */
  const visibleAt = (from: number): number => {
    for (let index = from; index < count; index += 1) {
      if (visible(rows.item(index))) return index
    }
    return count
  }
  // Lower bound of "the nearest visible row at or after this index starts below
  // the line". Stepping to the nearest visible row keeps the predicate monotone
  // across the hidden rows interleaved in the list; when the index is past the
  // last visible row there is nothing left to compare, so it holds.
  let low = 0
  let high = count
  while (low < high) {
    const middle = (low + high) >>> 1
    const index = visibleAt(middle)
    const top = index === count ? undefined : rows.item(index).getBoundingClientRect().top
    if (top !== undefined && top <= line) low = middle + 1
    else high = middle
  }
  const index = visibleAt(0) === count ? count : low - 1
  const row = index >= 0 && index < count ? rows.item(index) : null
  const turn = Number(row?.dataset.chatTurn)
  return Number.isSafeInteger(turn) ? turn : null
}

/** Row position in scrollport coordinates (viewport-independent). */
function flowTop(row: HTMLElement, scrollport: HTMLElement): number {
  return row.getBoundingClientRect().top - scrollport.getBoundingClientRect().top
}

/**
 * Earliest rendered row of the Turn that owns `row`. Seats are direct flow
 * siblings and a Turn's seats are contiguous; hidden and empty seats render
 * no box and are skipped.
 * @param row - a rendered seat carrying `data-chat-turn`.
 * @returns the Turn's first rendered row, and whether no rendered row precedes it in the flow.
 */
function turnHead(row: HTMLElement): { readonly row: HTMLElement; readonly first: boolean } {
  let head = row
  for (let sibling = row.previousElementSibling; sibling !== null; sibling = sibling.previousElementSibling) {
    if (!(sibling instanceof HTMLElement) || sibling.hasAttribute('hidden') || sibling.firstChild === null) continue
    if (sibling.dataset.chatTurn !== row.dataset.chatTurn) return { row: head, first: false }
    head = sibling
  }
  return { row: head, first: true }
}

/** Select a visible stable node/call identity, falling back only when layout
 * has not exposed a visible box yet. */
function pagingAnchor(list: HTMLElement, scrollport: HTMLElement): HTMLElement | null {
  const viewport = scrollport.getBoundingClientRect()
  // The composer seat is chrome beside the scrollport, not inside it, so the
  // scrollport's own floor is the last line a reader can see.
  const visibleBottom = viewport.bottom
  // The leading edge preserves nested call identity when it hits a row.
  // Chrome/gap misses use logarithmic layout reads over the ordered flex rows.
  if (typeof document.elementsFromPoint === 'function' && visibleBottom > viewport.top) {
    const content = list.getBoundingClientRect()
    const left = Math.max(viewport.left, content.left)
    const right = Math.min(viewport.right, content.right)
    const x = left + Math.max(0, right - left) / 2
    for (const element of document.elementsFromPoint(x, viewport.top + 1)) {
      const row = element instanceof HTMLElement
        ? element.closest<HTMLElement>('[data-chat-anchor-key]')
        : null
      if (row !== null && list.contains(row)) return row
    }
  }
  const rows = list.querySelectorAll<HTMLElement>(
    '[data-chat-flow] > [data-chat-flow-key]:not(:empty):not([hidden])',
  )
  let low = 0
  let high = rows.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (rows.item(middle).getBoundingClientRect().bottom > viewport.top) high = middle
    else low = middle + 1
  }
  const row = rows[low]
  return row !== undefined && row.getBoundingClientRect().top < visibleBottom ? row : rows[0] ?? null
}

/**
 * Capture the row at the scrollport's top edge in scroll-content coordinates.
 * @param list - the ChatView list element.
 * @param scrollport - the element that owns scrolling.
 * @returns the anchor, or null when no visible row carries a stable key.
 */
function readingAnchor(list: HTMLElement, scrollport: HTMLElement): ReadingAnchor | null {
  const row = pagingAnchor(list, scrollport)
  if (row === null || row.dataset.chatAnchorKey === undefined) return null
  return { key: row.dataset.chatAnchorKey, offset: flowTop(row, scrollport) + scrollport.scrollTop }
}

type ChatScrollPosition = NonNullable<ReturnType<ChatViewSlotProps['chatScroll']['read']>>

/** Capture a reflow-resistant reader position from the current rendered window. */
function scrollPosition(list: HTMLElement, scrollport: HTMLElement): ChatScrollPosition | null {
  const row = pagingAnchor(list, scrollport)
  const anchorKey = row?.dataset.chatAnchorKey
  if (row === null || anchorKey === undefined) return null
  return {
    anchorKey,
    anchorTop: flowTop(row, scrollport),
    scrollTop: scrollport.scrollTop,
  }
}

/** Host/OS refusal text for the file-open dialog; empty throws keep a locale fallback. */
function openFailureMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error)
  return message === '' ? fallback : message
}

/** ProducedFiles opens the session workspace as `.`. */
function isFolderOpenPath(path: string): boolean {
  return path === '.'
}

/**
 * Prompt-RPC identities already rendered by durable material: user/steering
 * node sources plus queue occurrences. A submission echo whose identity
 * appears here is hidden in the same render, so the echo→durable swap is
 * atomic — no duplicate, no gap — regardless of when the echo leaves the
 * session snapshot.
 */
function observedRpcIds(
  order: readonly string[],
  nodes: ChatSnapshot['nodes'],
  queue: readonly { readonly rpcId?: string }[],
): ReadonlySet<string> {
  const observed = new Set<string>()
  for (const key of order) {
    const node = nodes.get(key)
    if (node === undefined || (node.kind !== 'user' && node.kind !== 'steering')) continue
    const source = (node.data as { readonly source?: unknown }).source as
      | { readonly kind?: unknown; readonly rpcId?: unknown }
      | undefined
    if (source?.kind === 'user' && typeof source.rpcId === 'string') observed.add(source.rpcId)
  }
  for (const item of queue) {
    if (item.rpcId !== undefined) observed.add(item.rpcId)
  }
  return observed
}

function runningTurnStartTime(timeline: ConversationTimelineSnapshot): number | null {
  let latest: number | null = null
  for (const turn of timeline.turns.values()) {
    if (turn.status === 'open') latest = turn.start?.time ?? null
  }
  return latest
}

/** Turn-level model activity label retained across first-token, tool, and streaming phases. */
function TurnStatus({ startTime, t }: {
  /** The running turn's logged `turn/start` time; null falls back to mount
   *  time when that boundary is outside the window. */
  startTime: number | null
  /** The owning view's locale seat. */
  t: ChatViewSlotProps['t']
}) {
  const [mountedAt] = useState(() => Date.now())
  // Anchored to turn/start so a mid-turn reload keeps the real
  // elapsed time and the final footer's Ran-for label matches this clock.
  const anchor = startTime ?? mountedAt
  const [elapsedMs, setElapsedMs] = useState(() => Math.max(0, Date.now() - anchor))
  useEffect(() => {
    const tick = (): void => {
      setElapsedMs(Math.max(0, Date.now() - anchor))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => { clearInterval(id) }
  }, [anchor])
  // Short turns keep the plain label; the clock only appears once the turn
  // has clearly been running for a while.
  const showClock = elapsedMs >= 15_000
  return (
    <div className={css.turnStatus} role="status" aria-live="polite">
      {t('chat.deepDiving')}
      {showClock && (
        <span className={css.turnStatusClock} aria-hidden>
          {formatRunDuration(elapsedMs, t)}
        </span>
      )}
    </div>
  )
}

type ChatNodeListProps = Omit<ComponentProps<typeof ChatNodeSeat>, 'nodeKey'> & {
  readonly order: readonly string[]
}

const ChatNodeList = memo(function ChatNodeList({ order, ...seatProps }: ChatNodeListProps) {
  return order.map(nodeKey => (
    <ChatNodeSeat key={nodeKey} nodeKey={nodeKey} {...seatProps} />
  ))
})

/**
 * The chat view slot entry: pure component over the composed props; each
 * ordered business Node crosses the keyed renderer seat.
 */
export function ChatView({
  useSession, useChat, useChatNode, useChatNodeProcess, useSessions, useStore, actions, renderSlot,
  sessionId, openFile, loadOlder, loadThrough, completeEventNavigation, loadImage, openView,
  chatScroll, forkAt, fileMentions, useTranscriptView, useEventNavigation, useProjection, t,
}: ChatViewSlotProps) {
  const order = useChat(s => s.order)
  const nodeStore = useChat(s => s.nodes)
  // The rail's items are accumulated in the Chat snapshot, so this selector is
  // both the data and its change signal: the array identity moves only when a
  // Turn enters, leaves, or changes its preview.
  const turnNavigationItems = useChat(s => s.navigation.items())
  // Host-computed whole-log outline; the merge is view-layer only (the
  // conversation snapshot never carries projection values).
  const turnOutline = useProjection('turnOutline')
  const railItems = useMemo(
    () => mergeTurnRailItems(turnNavigationItems, turnOutline),
    [turnNavigationItems, turnOutline],
  )
  const timeline = useChat(s => s.timeline)
  const inbox = useSession(s => s.queue)
  // Workspace root off the session list row: path summaries display relative to it.
  const cwd = useSessions(s => s.byId[sessionId]?.cwd)
  const running = useSession(s => s.running)
  const openState = useSession(s => s.openState)
  const openError = useSession(s => s.openError)
  const hasMore = useSession(s => s.hasMore)
  const loadingOlder = useSession(s => s.loadingOlder)
  const selectedCallId = useStore(s => s.selection?.callId)
  const compactTranscript = useTranscriptView(mode => mode === 'compact')
  const eventNavigation = useEventNavigation(request => request)
  const inspectCall = useCallback((callId: string) => {
    openView('trajectory', callId)
  }, [openView])
  const [fileOpenError, setFileOpenError] = useState<{ path: string; message: string } | null>(null)
  const [fileOpenBusy, setFileOpenBusy] = useState(false)
  // Close/retry must ignore a settlement that started before the latest
  // gesture; otherwise a cancelled in-flight refusal reopens the dialog.
  const fileOpenRequest = useRef(0)

  const requestOpenFile = useCallback((path: string) => {
    const id = ++fileOpenRequest.current
    setFileOpenBusy(true)
    void openFile(path).then(
      () => {
        if (id !== fileOpenRequest.current) return
        setFileOpenError(null)
        setFileOpenBusy(false)
      },
      (error: unknown) => {
        if (id !== fileOpenRequest.current) return
        setFileOpenError({
          path,
          message: openFailureMessage(
            error,
            t(isFolderOpenPath(path) ? 'fileOpen.folderUnknown' : 'fileOpen.unknown'),
          ),
        })
        setFileOpenBusy(false)
      },
    )
  }, [openFile, t])

  const closeFileOpenError = useCallback(() => {
    fileOpenRequest.current += 1
    setFileOpenError(null)
    setFileOpenBusy(false)
  }, [])

  const pendingSteering = useMemo(
    () => inbox.filter(item => item.placement === 'steering'),
    [inbox],
  )
  const pendingSubmissions = useSession(s => s.pendingSubmissions)
  // Submission echoes still awaiting their durable counterpart. `order` is the
  // recompute trigger: durable user material always arrives as an append, and
  // every append replaces the order array.
  const visibleSubmissions = useMemo(() => {
    if (pendingSubmissions.length === 0) return pendingSubmissions
    const observed = observedRpcIds(order, nodeStore, inbox)
    return pendingSubmissions.filter(submission => (
      submission.placement !== 'queued' && !observed.has(submission.requestId)
    ))
  }, [pendingSubmissions, order, nodeStore, inbox])
  const renderMessageImages = useCallback<RenderMessageImages>(
    owner => renderSlot('conversation.message.images', { ...owner, loadImage }),
    [loadImage, renderSlot],
  )
  const runningTurnStart = useMemo(() => runningTurnStartTime(timeline), [timeline])

  const listRef = useRef<HTMLDivElement | null>(null)
  const columnRef = useRef<HTMLDivElement | null>(null)
  // A saved position starts disarmed; the first layout effect synchronously
  // restores it and normalizes a floor-clamped position back to following.
  const [atBottom, setAtBottom] = useState(() => chatScroll.read() === null)
  const atBottomRef = useRef(atBottom)
  const scrollSamplePendingRef = useRef(false)
  const [, setScrollSampleTick] = useState(0)
  const [activeTurn, setActiveTurn] = useState<number | null>(
    () => turnNavigationItems.at(-1)?.turn ?? null,
  )
  /** Last position delivered or written on the main thread. */
  const observedTopRef = useRef(0)
  /**
   * The row at the top edge, re-captured after every compensation and scroll
   * frame. Prepends and reflow move it in content coordinates; shifting
   * `scrollTop` by that movement alone keeps the reader's row still without
   * ever restoring a position recorded before the reader's latest input.
   */
  const anchorRef = useRef<ReadingAnchor | null>(null)
  /** Unloaded-turn jump in flight: target turn plus its load-through seq. */
  const pendingJumpRef = useRef<{ turn: number; seq: SessionSeq } | null>(null)
  /** Anchor key captured when the in-flight jump landed mid-paging; settle only corrects an untouched landing. */
  const jumpLandedKeyRef = useRef<string | null>(null)
  const [busyJumpTurn, setBusyJumpTurn] = useState<number | null>(null)
  /** Bumped when a loadThrough completion settles, after its last page's commit. */
  const [jumpSettleTick, setJumpSettleTick] = useState(0)
  const [eventNavigationSettleTick, setEventNavigationSettleTick] = useState(0)
  const eventNavigationLoadRef = useRef<{ requestId: number; settled: boolean } | null>(null)
  const completedEventNavigationRef = useRef(0)
  const [highlightedNodeKey, setHighlightedNodeKey] = useState<string | null>(null)
  /** Window head at the last settle-time repage; an unmoved head falls back instead of repaging forever. */
  const jumpRepageHeadRef = useRef<number | null>(null)
  /** Window head captured when a page pull started; null while no pull is outstanding. */
  const autoPageHeadRef = useRef<{ readonly head: number | null } | null>(null)
  /** Previous busy state: only a true-to-false edge is a settled pull, never the first run. */
  const loadingOlderRef = useRef(loadingOlder)
  /** Latest automatic-paging test; assigned below, called from scroll, commit, and resize paths. */
  const maybeLoadOlderRef = useRef<() => void>(() => {})
  /** Automatic paging latched off after a pull that moved no history; the manual control is the retry. */
  const [autoPageStalled, setAutoPageStalled] = useState(false)
  /** Host chrome layer for floating controls; null when this view owns its own scrolling. */
  const [chromeLayer, setChromeLayer] = useState<HTMLElement | null>(null)
  const firstSeqRef = useRef<number | null>(null)
  const openedRef = useRef(false)
  /** Ordinary activation needs one post-commit tail correction after the resident shell settles. */
  const activationTailPendingRef = useRef(false)
  const activationTailFrameRef = useRef<number | null>(null)
  const lastKeyRef = useRef<string | null>(null)
  const lastSteeringIdRef = useRef<string | null>(null)
  const lastSubmissionIdRef = useRef<string | null>(null)
  /** Flow tip signature — follow-scroll only when this moves, never on a
   *  scroll-driven at-bottom chrome re-render (which would snap inertial
   *  scrolls the rest of the way to the floor). */
  const followSigRef = useRef<string | null>(null)

  const firstKey = order[0]
  const firstSeq = firstKey === undefined ? null : nodeStore.get(firstKey)?.anchorSeq ?? null
  const lastKey = order.at(-1) ?? null
  const lastNode = lastKey === null ? undefined : nodeStore.get(lastKey)
  const lastSteeringId = pendingSteering[pendingSteering.length - 1]?.id ?? null
  const lastSubmissionId = visibleSubmissions[visibleSubmissions.length - 1]?.requestId ?? null
  const followSig = `${openState}:${firstSeq}:${lastKey}:${order.length}:${running ? 1 : 0}:${lastSteeringId ?? ''}:${lastSubmissionId ?? ''}`

  const syncActiveTurn = useCallback((): void => {
    const local = listRef.current
    const first = turnNavigationItems[0]
    if (local === null || first === undefined) {
      setActiveTurn(null)
      return
    }
    const el = scrollerOf(local)
    const floorReached = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_THRESHOLD + 1
    // Back-to-bottom is chrome, not bookkeeping: it follows the geometry this
    // frame already measured. Leaving it to the throttled sample made it
    // appear and disappear up to a sample interval after the reader moved.
    // Follow OWNERSHIP still belongs to that sample (atBottomRef), which
    // distinguishes a reader's scroll from a delivered one.
    setAtBottom(current => current === floorReached ? current : floorReached)
    if (floorReached) {
      const latest = turnNavigationItems.at(-1)?.turn ?? first.turn
      setActiveTurn(current => current === latest ? current : latest)
      return
    }
    const readingLine = el.getBoundingClientRect().top + Math.min(96, el.clientHeight * 0.2)
    const reading = turnAtLine(local, readingLine)
    // No row reaches the line yet: the flow head still owns the mark. Otherwise
    // the row's Turn may be one the rail does not offer (all its nodes hidden),
    // so the newest offered Turn at or above it owns the mark.
    let next = first.turn
    if (reading !== null) {
      for (const item of turnNavigationItems) {
        if (item.turn > reading) break
        next = item.turn
      }
    }
    setActiveTurn(current => current === next ? current : next)
  }, [turnNavigationItems])

  const activeTurnRef = useRef<(() => void) | null>(null)
  const activeFrameRef = useRef<number | null>(null)
  const scheduleActiveTurn = useCallback((): void => {
    if (activeFrameRef.current !== null) return
    if (typeof requestAnimationFrame === 'undefined') {
      syncActiveTurn()
      return
    }
    activeFrameRef.current = requestAnimationFrame(() => {
      activeFrameRef.current = null
      holdAnchorRef.current()
      syncActiveTurn()
    })
  }, [syncActiveTurn])

  useEffect(() => () => {
    if (activeFrameRef.current !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(activeFrameRef.current)
    }
  }, [])

  activeTurnRef.current = scheduleActiveTurn

  useLayoutEffect(() => {
    scheduleActiveTurn()
  }, [scheduleActiveTurn])

  // Floating controls must not live inside the scrollport: elastic overscroll
  // translates its contents, carrying a sticky control with the rubber-band.
  // The host publishes a non-scrolling layer for them; without one (this view
  // owning its own scrolling) they stay in place.
  useLayoutEffect(() => {
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: React attaches the ref before layout effects run. */
    if (local === null) return
    const scrollport = scrollerOf(local)
    setChromeLayer(scrollport.parentElement?.querySelector<HTMLElement>('[data-conversation-chrome]') ?? null)
  }, [])

  /**
   * Keep the anchored row still through any layout change since the last
   * capture, then re-capture the row now at the top edge. Scrolling never moves
   * a row in content coordinates, so a reader's input during a page request or
   * a reflow is preserved exactly; only layout above the row shifts `scrollTop`.
   * The ledger moves by the applied shift alone, so reader input since the last
   * sample still reads as reader input.
   */
  const holdAnchorRef = useRef<() => void>(() => {})
  holdAnchorRef.current = () => {
    const local = listRef.current
    if (local === null) return
    // A pinned reader is followed to the floor instead, so streaming commits
    // read no layout here; a scroll still being sampled may be leaving the
    // floor, so it keeps the row.
    if (atBottomRef.current && !scrollSamplePendingRef.current) {
      anchorRef.current = null
      return
    }
    const el = scrollerOf(local)
    const anchor = anchorRef.current
    const row = anchor === null ? null : anchorElement(local, anchor.key)
    if (anchor === null || row === null) {
      anchorRef.current = readingAnchor(local, el)
      return
    }
    const viewportTop = el.getBoundingClientRect().top
    let rect = row.getBoundingClientRect()
    const shift = rect.top - viewportTop + el.scrollTop - anchor.offset
    if (Math.abs(shift) > 0.5) {
      const before = el.scrollTop
      el.scrollTop = before + shift
      observedTopRef.current += el.scrollTop - before
      rect = row.getBoundingClientRect()
    }
    // Re-select only once the row no longer covers the top edge: most frames
    // cost two rect reads instead of a hit test.
    anchorRef.current = rect.top <= viewportTop + 1 && rect.bottom > viewportTop + 1
      ? { key: anchor.key, offset: rect.top - viewportTop + el.scrollTop }
      : readingAnchor(local, el)
  }

  const toBottom = (el: HTMLElement): void => {
    anchorRef.current = null
    // Returning to the live tail supersedes a jump still landing.
    pendingJumpRef.current = null
    setBusyJumpTurn(current => current === null ? current : null)
    el.scrollTop = el.scrollHeight
    observedTopRef.current = el.scrollTop
    atBottomRef.current = true
    setAtBottom(true)
    chatScroll.save(null)
    setActiveTurn(turnNavigationItems.at(-1)?.turn ?? null)
  }

  // Land a row at the reading line, or the view at the scroll origin, and
  // republish scroll-derived state. A latest-ref, so navigateToTurn's identity
  // stays stable for the memoized rail.
  const landOnRowRef = useRef<
    (local: HTMLElement, el: HTMLElement, row: HTMLElement, turn: number, origin: boolean) => void
  >(() => {})
  landOnRowRef.current = (local, el, row, turn, origin) => {
    el.scrollTop = origin ? 0 : el.scrollTop + flowTop(row, el) - 24
    observedTopRef.current = el.scrollTop
    // The landing is the new reading position: later pages and reflow hold it.
    anchorRef.current = readingAnchor(local, el)
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_THRESHOLD + 1
    atBottomRef.current = isAtBottom
    setAtBottom(isAtBottom)
    setActiveTurn(turn)
    const position = isAtBottom ? null : scrollPosition(local, el)
    if (isAtBottom) chatScroll.save(null)
    else if (position !== null) chatScroll.save(position)
  }

  // Rail jumps land a Turn's earliest rendered row, not its anchor, so rows
  // placed before the anchor (a request's system prompt) stay in view. The
  // conversation's first row lands at the scroll origin once history is
  // complete, showing the flow's leading space above it.
  const landOnTurnRef = useRef<(local: HTMLElement, el: HTMLElement, row: HTMLElement, turn: number) => void>(
    () => {},
  )
  landOnTurnRef.current = (local, el, row, turn) => {
    const head = turnHead(row)
    landOnRowRef.current(local, el, head.row, turn, head.first && !hasMore)
  }

  /**
   * Land the pending jump once its Turn has a rendered anchor row; false
   * while it must keep waiting. Mid-jump landings (`settle` false) keep the
   * jump armed with the target row as the paging anchor, so later chunks and
   * the load-earlier button's unmount re-land on the same row; the settling
   * call clears the jump.
   */
  const realizePendingJump = (local: HTMLElement, el: HTMLElement, settle: boolean): boolean => {
    const pending = pendingJumpRef.current
    if (pending === null) return true
    const item = railItems.find(candidate => candidate.turn === pending.turn)
    if (item === undefined || item.anchor.kind !== 'loaded') return false
    const row = anchorElement(local, item.anchor.key)
    if (row === null) return false
    if (settle) {
      pendingJumpRef.current = null
      setBusyJumpTurn(null)
      const landedKey = jumpLandedKeyRef.current
      jumpLandedKeyRef.current = null
      // A reader who moved off an already-landed target mid-jump keeps their
      // place; a first landing, or an untouched one, takes the correction.
      if (landedKey === null || anchorRef.current?.key === landedKey) {
        landOnTurnRef.current(local, el, row, pending.turn)
      }
      return true
    }
    landOnTurnRef.current(local, el, row, pending.turn)
    jumpLandedKeyRef.current = anchorRef.current?.key ?? null
    return true
  }

  useLayoutEffect(() => {
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: React attaches the ref before layout effects run. */
    if (local === null) return
    const el = scrollerOf(local)
    // Every commit first holds the reader's row against the layout it changed,
    // including a page that lands while a reader scroll is still being sampled.
    if (openedRef.current) holdAnchorRef.current()
    if (scrollSamplePendingRef.current) return
    // Open completed: jump to the bottom once — unless a scroll position
    // survives from a previous mount (view-tab switch away and back), which
    // is restored instead of snapping the reader back to the floor.
    if (openState === 'open' && !openedRef.current) {
      openedRef.current = true
      const saved = chatScroll.read()
      if (saved === null) {
        toBottom(el)
        activationTailPendingRef.current = eventNavigation === null
      } else {
        el.scrollTop = saved.scrollTop
        const row = anchorElement(local, saved.anchorKey)
        if (row !== null) el.scrollTop += flowTop(row, el) - saved.anchorTop
        observedTopRef.current = el.scrollTop
        const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_THRESHOLD + 1
        atBottomRef.current = isAtBottom
        setAtBottom(isAtBottom)
        anchorRef.current = readingAnchor(local, el)
        const normalized = isAtBottom ? null : scrollPosition(local, el)
        if (isAtBottom) chatScroll.save(null)
        else if (normalized !== null) chatScroll.save(normalized)
      }
      firstSeqRef.current = firstSeq
      lastKeyRef.current = lastKey
      lastSteeringIdRef.current = lastSteeringId
      lastSubmissionIdRef.current = lastSubmissionId
      followSigRef.current = followSig
      // A tail page shorter than the scrollport leaves nothing to scroll:
      // fill it here so history is reachable without a reader gesture.
      maybeLoadOlderRef.current()
      return
    }
    // Prepend (head seq decreased) away from the floor: the hold above kept
    // the reader's row; a pending jump lands once its target rows exist.
    if (!atBottomRef.current && firstSeq !== null && firstSeqRef.current !== null && firstSeq < firstSeqRef.current) {
      realizePendingJump(local, el, false)
      firstSeqRef.current = firstSeq
      lastKeyRef.current = lastKey
      lastSteeringIdRef.current = lastSteeringId
      lastSubmissionIdRef.current = lastSubmissionId
      followSigRef.current = followSig
      return
    }
    firstSeqRef.current = firstSeq
    // Own words must be visible: a new trailing user node force-scrolls
    // (send lives in the composer, so arrival is detected here, not armed there).
    const appendedUser = lastKey !== lastKeyRef.current && lastNode?.kind === 'user'
    const appendedSteering = lastSteeringId !== null && lastSteeringId !== lastSteeringIdRef.current
    const appendedSubmission = lastSubmissionId !== null && lastSubmissionId !== lastSubmissionIdRef.current
    const tipMoved = followSigRef.current !== followSig
    lastKeyRef.current = lastKey
    lastSteeringIdRef.current = lastSteeringId
    lastSubmissionIdRef.current = lastSubmissionId
    followSigRef.current = followSig
    // Follow new flow content while pinned; do NOT re-pin on every render
    // merely because atBottomRef is true (scroll threshold → setState → snap).
    if (appendedUser || appendedSteering || appendedSubmission || (tipMoved && atBottomRef.current)) {
      toBottom(el)
      return
    }
    // A jump whose target committed outside the anchored-prepend path (for
    // example after a mid-jump toBottom dropped the held anchor) lands here.
    if (pendingJumpRef.current !== null) realizePendingJump(local, el, false)
  })

  const onScrollRef = useRef(() => {})
  onScrollRef.current = () => {
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: the handler only fires while mounted. */
    if (local === null) return
    const el = scrollerOf(local)
    // Only reader input may make raw scroll geometry change follow ownership:
    // a delivered position that deviates from the observed-top ledger (every
    // programmatic write records itself there synchronously). This covers
    // wheel, touch, scrollbar, and keyboard alike without naming devices.
    // Browser shrink-clamps land exactly on the floor min and delayed
    // programmatic deliveries land on the ledger itself, so both preserve
    // the current ownership state.
    const floor = Math.max(0, el.scrollHeight - el.clientHeight)
    const movedByReader = Math.abs(el.scrollTop - Math.min(observedTopRef.current, floor)) > 0.5
    const isAtBottom = movedByReader
      ? floor - el.scrollTop <= FOLLOW_THRESHOLD + 1
      : atBottomRef.current
    if (!movedByReader && isAtBottom) {
      toBottom(el)
      return
    }
    atBottomRef.current = isAtBottom
    setAtBottom(isAtBottom)
    const position = isAtBottom ? null : scrollPosition(local, el)
    // Continuous save (unmount happens after ref detach, so saving there is
    // too late); pinned-to-bottom clears so a remount keeps following.
    if (isAtBottom) chatScroll.save(null)
    else if (position !== null) chatScroll.save(position)
    observedTopRef.current = el.scrollTop
  }

  // Raw scroll events schedule the reading-line hit test for the next frame,
  // so the rail tracks compositor scrolling without waiting for persistence.
  // Follow ownership, restoration anchors, and storage remain sampled at most
  // once per interval, with scrollend providing the final sample for a burst.
  useEffect(() => {
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: effect runs after the list node commits. */
    if (local === null) return
    const el = scrollerOf(local)
    let sampleTimer: number | undefined
    const sample = (): void => {
      if (!scrollSamplePendingRef.current) return
      scrollSamplePendingRef.current = false
      if (sampleTimer !== undefined) window.clearTimeout(sampleTimer)
      sampleTimer = undefined
      onScrollRef.current()
      setScrollSampleTick(tick => tick + 1)
    }
    const onScroll = (): void => {
      scrollSamplePendingRef.current = true
      activeTurnRef.current?.()
      maybeLoadOlderRef.current()
      sampleTimer ??= window.setTimeout(sample, SCROLL_SAMPLE_INTERVAL_MS)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    el.addEventListener('scrollend', sample, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('scrollend', sample)
      if (sampleTimer !== undefined) window.clearTimeout(sampleTimer)
      scrollSamplePendingRef.current = false
    }
  }, [])

  // The ref starts null and is assigned every render, so the placeholder
  // initializer a function initial value would need never exists.
  const followRef = useRef<(() => void) | null>(null)
  followRef.current = () => {
    if (scrollSamplePendingRef.current) return
    const local = listRef.current
    if (local !== null && atBottomRef.current) {
      const el = scrollerOf(local)
      el.scrollTop = el.scrollHeight
      observedTopRef.current = el.scrollTop
      chatScroll.save(null)
    }
  }
  // Streaming, tool disclosures, and other flow changes resize the column;
  // the composer resizes beside it. This observer owns ChatView's
  // dynamic-height follow decisions and writes only while the reader is pinned.
  useEffect(() => {
    const column = columnRef.current
    const local = listRef.current
    if (column === null || local === null || typeof ResizeObserver === 'undefined') return
    const scrollport = scrollerOf(local)
    // The seat is a sibling of the scrollport now, not a descendant. Observe
    // it there: never the scrollport itself, whose own resize notifications
    // would let this callback write scrollTop during an elastic overscroll
    // and flatten the bounce.
    const composer = scrollport.parentElement?.querySelector<HTMLElement>('[data-composer-seat]') ?? null
    // Flow-height changes (image loads, tool disclosures) move rows across the
    // reading line without a scroll event, so the active mark resyncs here too.
    //
    // HEIGHT ONLY. Both callbacks read scroll geometry — `scrollHeight` and a
    // binary search over row rects — which forces a synchronous layout of the
    // whole transcript. Width also changes on both observed boxes for every
    // frame the sidebar track animates, and answering those would pay that
    // layout ~25 times per collapse; on a session carrying thousand-line code
    // blocks that is tens of thousands of elements per frame and the slide
    // drops to roughly 17fps. Width carries nothing either callback needs: the
    // reading column is a fixed measure, so a wider or narrower scrollport
    // moves no row relative to the reading line. Anything that does move rows
    // — rewrapping included — changes the observed height and still arrives.
    const observedHeights = new Map<Element, number>()
    const observer = new ResizeObserver((entries) => {
      let heightChanged = false
      for (const entry of entries) {
        const previous = observedHeights.get(entry.target)
        const height = entry.contentRect.height
        if (previous === undefined || Math.abs(previous - height) > 0.5) heightChanged = true
        observedHeights.set(entry.target, height)
      }
      if (!heightChanged) return
      holdAnchorRef.current()
      followRef.current?.()
      activeTurnRef.current?.()
      maybeLoadOlderRef.current()
    })
    observer.observe(column)
    if (composer !== null) observer.observe(composer)
    return () => { observer.disconnect() }
  }, [])

  // A failed/empty page leaves the head unchanged. Once the request leaves
  // its busy state there is no future prepend for the saved anchor to own.
  //
  // The same edge settles automatic paging. `loadOlder` reports failure by
  // swallowing it and leaving `hasMore` set, so a pull that moved no history
  // is the only failure signal there is; latching off stops a dead pull from
  // restarting on every scroll frame and surfaces the manual control instead.
  // A pull that did move the head chains, because the reader can still be
  // within the prefetch margin of the new one. Values are read at settle time
  // — the prepend commits before the busy flag clears — so the flag alone is
  // the trigger.
  useEffect(() => {
    const settled = loadingOlderRef.current && !loadingOlder
    loadingOlderRef.current = loadingOlder
    if (loadingOlder) return
    // Mount runs this effect with no pull behind it: consuming the record
    // here would judge a request that has not come back yet.
    if (!settled) return
    const pulled = autoPageHeadRef.current
    if (pulled === null) return
    autoPageHeadRef.current = null
    const progressed = firstSeq !== null && (pulled.head === null || firstSeq < pulled.head)
    if (hasMore && !progressed) {
      setAutoPageStalled(true)
      return
    }
    maybeLoadOlderRef.current()
  }, [loadingOlder])

  // A latched stall belongs to the session that failed, not to the next one.
  useEffect(() => {
    setAutoPageStalled(false)
  }, [sessionId])

  // Jump settlement: every loadThrough completion bumps the tick after its
  // last page's commit, and a plain pull's loadingOlder flip re-settles a
  // jump it made wait. A still-pending jump is realized now, held while a
  // plain load-earlier pull owns the pager (its completion retries below),
  // repaged once per head movement, or landed on the nearest rendered Turn
  // at or after the target (failure, exhausted history, or a Turn with no
  // visible row).
  useEffect(() => {
    const pending = pendingJumpRef.current
    const local = listRef.current
    if (pending === null || local === null) return
    const el = scrollerOf(local)
    // The settling landing runs after the load-earlier button's unmount
    // commit, so the target row cannot drift once the jump clears.
    if (realizePendingJump(local, el, true)) return
    const uncovered = firstSeq === null || firstSeq > pending.seq
    if (uncovered && hasMore) {
      // A plain pull owns the pager right now: hold the jump (busy stays)
      // instead of degrading to a wrong landing.
      if (loadingOlder) return
      if (jumpRepageHeadRef.current !== firstSeq) {
        jumpRepageHeadRef.current = firstSeq
        void loadThrough(pending.seq).finally(() => { setJumpSettleTick(tick => tick + 1) })
        return
      }
    }
    for (const row of local.querySelectorAll<HTMLElement>('[data-chat-turn]:not([hidden])')) {
      const turn = Number(row.dataset.chatTurn)
      if (!Number.isSafeInteger(turn) || turn < pending.turn) continue
      landOnTurnRef.current(local, el, row, turn)
      break
    }
    pendingJumpRef.current = null
    setBusyJumpTurn(null)
    // Snapshot values are read at settle time; the completion tick is the trigger.
  }, [jumpSettleTick])

  // A jump held while a plain pull owned the pager waits in the effect
  // above; the pull's completion is its retry signal.
  useEffect(() => {
    if (!loadingOlder && pendingJumpRef.current !== null) setJumpSettleTick(tick => tick + 1)
  }, [loadingOlder])

  // Sidebar content-search results address durable message events rather than
  // whole Turns. Page to the event when necessary, land its exact Chat row,
  // and acknowledge only after the row has committed.
  useLayoutEffect(() => {
    if (eventNavigation === null
      || eventNavigation.requestId <= completedEventNavigationRef.current
      || openState !== 'open') return
    const local = listRef.current
    if (local === null) return
    const el = scrollerOf(local)
    const exactKey = order.find(key => nodeStore.get(key)?.anchorSeq === eventNavigation.seq)
    const exactRow = exactKey === undefined ? null : anchorElement(local, exactKey)
    if (exactKey !== undefined && exactRow !== null) {
      const turn = Number(exactRow.dataset.chatTurn)
      if (Number.isSafeInteger(turn)) {
        pendingJumpRef.current = null
        setBusyJumpTurn(null)
        landOnRowRef.current(local, el, exactRow, turn, false)
        setHighlightedNodeKey(exactKey)
        completedEventNavigationRef.current = eventNavigation.requestId
        eventNavigationLoadRef.current = null
        completeEventNavigation(eventNavigation.requestId)
        return
      }
    }

    const uncovered = firstSeq === null || firstSeq > eventNavigation.seq
    const loading = eventNavigationLoadRef.current
    if (uncovered && hasMore && loading?.requestId !== eventNavigation.requestId) {
      atBottomRef.current = false
      setAtBottom(false)
      const request = { requestId: eventNavigation.requestId, settled: false }
      eventNavigationLoadRef.current = request
      void loadThrough(eventNavigation.seq).finally(() => {
        request.settled = true
        setEventNavigationSettleTick(tick => tick + 1)
      })
      return
    }
    if (loading?.requestId === eventNavigation.requestId && !loading.settled) return

    // The indexed event should map one-to-one to a user or assistant row. If
    // a changed projection omits it, land the closest visible durable row so
    // navigation still leaves the reader near the indexed match.
    let fallback: { key: string; distance: number } | null = null
    for (const key of order) {
      const seq = nodeStore.get(key)?.anchorSeq
      const row = anchorElement(local, key)
      if (seq === undefined || row === null) continue
      const distance = Math.abs(seq - eventNavigation.seq)
      if (fallback === null || distance < fallback.distance) fallback = { key, distance }
    }
    if (fallback !== null) {
      const row = anchorElement(local, fallback.key)
      const turn = Number(row?.dataset.chatTurn)
      if (row !== null && Number.isSafeInteger(turn)) {
        landOnRowRef.current(local, el, row, turn, false)
        setHighlightedNodeKey(fallback.key)
      }
    }
    completedEventNavigationRef.current = eventNavigation.requestId
    eventNavigationLoadRef.current = null
    completeEventNavigation(eventNavigation.requestId)
  }, [
    completeEventNavigation, eventNavigation, eventNavigationSettleTick, firstSeq,
    hasMore, loadThrough, nodeStore, openState, order,
  ])

  /**
   * Start one older-page pull. The recorded head is what the settle effect
   * below compares against to decide whether the pull made progress.
   */
  const pullOlder = (): void => {
    autoPageHeadRef.current = { head: firstSeq }
    loadOlder()
  }

  /**
   * Automatic history paging: pull the next older page as the reader
   * approaches the window head, and fill a window too short to scroll at all
   * (a short first page otherwise leaves the reader nothing to pull with).
   * A rail jump or a search navigation runs its own paging loop, so neither
   * shares the pager with this one.
   */
  maybeLoadOlderRef.current = () => {
    if (openState !== 'open' || !hasMore || loadingOlder || autoPageStalled) return
    if (eventNavigation !== null) return
    if (pendingJumpRef.current !== null || eventNavigationLoadRef.current !== null) return
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: every caller runs while the list is mounted. */
    if (local === null) return
    const el = scrollerOf(local)
    // The runway scales with the scrollport: a fixed distance is a shrinking
    // fraction of a taller window, and a fast fling then reaches the head
    // before the page it needs has arrived.
    const margin = Math.max(OLDER_PREFETCH_MARGIN, el.clientHeight * OLDER_PREFETCH_SCREENS)
    // Ordered so a reader far from the head never pays for `scrollHeight`,
    // which forces layout of the whole transcript.
    if (el.scrollTop > margin && el.scrollHeight > el.clientHeight) return
    pullOlder()
  }

  // ChatView commits inside a resident shell whose sticky composer and cover
  // settle after child layout effects. Correct an ordinary activation once
  // after that commit; content-search navigation owns its exact target row.
  useEffect(() => {
    if (!activationTailPendingRef.current) return
    activationTailPendingRef.current = false
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: the effect belongs to the mounted list. */
    if (local === null) return
    const el = scrollerOf(local)
    // The view-local fallback has no resident shell settling around it.
    if (el === local) return
    if (el.scrollHeight <= el.clientHeight || typeof requestAnimationFrame !== 'function') {
      toBottom(el)
      return
    }
    activationTailFrameRef.current = requestAnimationFrame(() => {
      activationTailFrameRef.current = null
      const mounted = listRef.current
      if (mounted === null) return
      const scrollport = scrollerOf(mounted)
      const floor = Math.max(0, scrollport.scrollHeight - scrollport.clientHeight)
      const readerMoved = Math.abs(
        scrollport.scrollTop - Math.min(observedTopRef.current, floor),
      ) > 0.5
      // Reader input supersedes the activation correction both before and
      // after the sampled ownership update catches up.
      if (atBottomRef.current && !readerMoved) toBottom(scrollport)
    })
    return () => {
      if (activationTailFrameRef.current !== null && typeof cancelAnimationFrame !== 'undefined') {
        cancelAnimationFrame(activationTailFrameRef.current)
        activationTailFrameRef.current = null
      }
    }
  }, [])

  // Manual recovery after automatic paging latched off: the reader's click is
  // the retry, and re-arms automatic paging for the pages after it.
  const loadOlderAnchored = (): void => {
    setAutoPageStalled(false)
    pullOlder()
  }

  // Identity feeds the memoized rail; a fresh closure per render would defeat it.
  const navigateToTurn = useCallback((item: TurnRailItem): void => {
    const local = listRef.current
    if (local === null) return
    const el = scrollerOf(local)
    if (item.anchor.kind === 'unloaded') {
      // Jumping into history is leaving the live tail: release bottom
      // ownership on the click itself, or the pinned-scroll snap (a
      // non-reader scroll delivery during the first prepend's compensation)
      // would call toBottom and cancel the jump.
      atBottomRef.current = false
      setAtBottom(false)
      // The layout effect lands on the target once its rows commit.
      pendingJumpRef.current = { turn: item.turn, seq: item.anchor.seq }
      jumpRepageHeadRef.current = null
      jumpLandedKeyRef.current = null
      setBusyJumpTurn(item.turn)
      // Paged unbounded, from the window head back to the target. A lower bound
      // on the first page was tried and starved the page — the window came back
      // without the target and the jump had nothing to land on — so a jump is
      // slower for a far target and always correct.
      void loadThrough(item.anchor.seq).finally(() => { setJumpSettleTick(tick => tick + 1) })
      return
    }
    const row = anchorElement(local, item.anchor.key)
    if (row === null) return
    // A loaded-mark click supersedes any jump still landing.
    pendingJumpRef.current = null
    setBusyJumpTurn(current => current === null ? current : null)
    landOnTurnRef.current(local, el, row, item.turn)
  }, [loadThrough])

  // Everything that floats over the transcript: the rail, the head boundary,
  // and back-to-bottom. Rendered into the host's non-scrolling chrome layer
  // when there is one, so no scroll gesture can move them.
  const floatingChrome: ReactNode = (
    <>
      <TurnNavigator
        items={railItems}
        activeTurn={activeTurn}
        busyTurn={busyJumpTurn}
        onNavigate={navigateToTurn}
        t={t}
      />
      {/* Head boundary, overlaid rather than in flow: automatic paging owns
          it, so it reports progress instead of asking for a click, and only a
          latched stall puts the manual control back. Overlaying keeps every
          appearance and disappearance off the transcript's geometry. */}
      {hasMore && (
        <div
          className={css.olderSlot}
          data-earlier-history={autoPageStalled ? 'stalled' : loadingOlder ? 'loading' : 'idle'}
        >
          {/* Empty while idle. The slot marks that history remains — it is the
              boundary the browser contract reads — but a spinner belongs to a
              request in flight, not to the mere existence of older pages: this
              floats over the scrollport now, so anything drawn here is on
              screen the whole time rather than only at the head. */}
          {autoPageStalled
            ? (
              <button type="button" className={css.olderRetry} onClick={loadOlderAnchored}>
                {t('chat.loadOlder')}
              </button>
            )
            : loadingOlder
              ? (
                <span className={css.olderProgress} role="status" aria-live="polite">
                  <Spinner />
                  <span className={a11yCss.visuallyHidden}>{t('chat.loadingOlder')}</span>
                </span>
              )
              : null}
        </div>
      )}
      {!atBottom && (
        <div className={css.toBottomSlot}>
          <button
            type="button"
            className={css.toBottom}
            aria-label={t('chat.toBottom')}
            onClick={() => {
              const local = listRef.current
              /* v8 ignore next -- ref-null guard: the button only renders alongside the mounted list. */
              if (local !== null) toBottom(scrollerOf(local))
            }}
          >
            <IconChevronDownOutline14 />
          </button>
        </div>
      )}
    </>
  )

  return (
    <div className={css.root}>
      <div ref={listRef} className={css.scroll}>
        <div ref={columnRef} className={css.column} data-chat-flow="">
          {openState === 'error' && openError !== null && (
            <div className={css.openError}>
              {t('chat.loadError', { message: openError.message, code: openError.code })}
            </div>
          )}
          <ChatNodeList
            order={order}
            highlightedNodeKey={highlightedNodeKey}
            useChatNode={useChatNode}
            useChatNodeProcess={useChatNodeProcess}
            historyIncomplete={hasMore}
            compactTranscript={compactTranscript}
            useStore={useStore}
            actions={actions}
            selectedCallId={selectedCallId}
            cwd={cwd}
            openFile={requestOpenFile}
            inspectCall={inspectCall}
            forkAt={forkAt}
            renderMessageImages={renderMessageImages}
            fileMentions={fileMentions}
            renderSlot={renderSlot}
            t={t}
          />
          {/* No pending placeholders: questions (ui-user-questions) and approvals
              (ApprovalPanel) both take over the composer, so a flow card would
              double-render the same wait. */}
          {/* Turn-level loading signal: rides the whole running turn (first-token
              wait, tool execution, streaming) so it never flickers per step. */}
          {running && <TurnStatus startTime={runningTurnStart} t={t} />}
          {pendingSteering.map(item => (
            <PendingSteeringBubble
              key={item.id}
              content={item.content}
              renderMessageImages={renderMessageImages}
              t={t}
            />
          ))}
          {visibleSubmissions.map(submission => (
            <PendingSubmissionBubble
              key={submission.requestId}
              submission={submission}
              renderMessageImages={renderMessageImages}
              t={t}
            />
          ))}
        </div>
      </div>
      {chromeLayer === null ? floatingChrome : createPortal(floatingChrome, chromeLayer)}
      {fileOpenError !== null && (
        <FileOpenErrorDialog
          path={fileOpenError.path}
          message={fileOpenError.message}
          busy={fileOpenBusy}
          onClose={closeFileOpenError}
          onRetry={() => { requestOpenFile(fileOpenError.path) }}
          t={t}
        />
      )}
    </div>
  )
}

/** In-page Host open-path refusal: the wire reason plus a retry of the same path. */
function FileOpenErrorDialog({
  path, message, busy, onClose, onRetry, t,
}: {
  path: string
  message: string
  busy: boolean
  onClose: () => void
  onRetry: () => void
  t: ChatViewSlotProps['t']
}) {
  return (
    <Modal
      open
      onClose={onClose}
      closeLabel={t('close')}
      title={t(isFolderOpenPath(path) ? 'fileOpen.folderTitle' : 'fileOpen.title')}
      description={message}
      footer={(
        <>
          <Button variant="outline" className={css.modalAction} onClick={onClose}>{t('cancel')}</Button>
          <Button variant="primary" className={css.modalAction} disabled={busy} onClick={onRetry}>{t('retry')}</Button>
        </>
      )}
    />
  )
}
