// An enclosing `[data-conversation-scroll]` owns scrolling when present;
// otherwise this view owns it. Each row subscribes to one stable node key.

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type {
  ConversationTimelineSnapshot, RenderMessageImages,
} from '@aeven/client-ui-conversation/client'
import { Button, IconChevronDownOutline14, Modal, Spinner } from '@aeven/client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import type { ChatSnapshot } from '../contract/snapshot.ts'
import { PendingSteeringBubble, PendingSubmissionBubble } from './MessageItem.tsx'
import { ChatNodeSeat } from './ChatNodeSeat.tsx'
import { formatRunDuration } from './message-chrome.ts'
import { TurnRail } from './TurnRail.tsx'
import { turnRailMarks, type TurnRailMark } from './turn-rail-marks.ts'
import a11yCss from './accessibility.module.css'
import css from './ChatView.module.css'

const FOLLOW_THRESHOLD = 24
const SCROLL_SAMPLE_INTERVAL_MS = 500
/** Prefetch runway floor, for a scrollport too short to give one of its own. */
const OLDER_PREFETCH_MARGIN = 1500
/**
 * Screens of runway ahead of the head: a fling has to outrun this much to reach it.
 *
 * Paging is serialized — one pull is in flight at a time, and the next is
 * tested only once that one commits — so the runway, not the page size, is what
 * keeps a fast scroll fed: it decides how early the request leaves, and the
 * reader has that many screens left to travel while it is out.
 */
const OLDER_PREFETCH_SCREENS = 8

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

/** Row position in scrollport coordinates (viewport-independent). */
function flowTop(row: HTMLElement, scrollport: HTMLElement): number {
  return row.getBoundingClientRect().top - scrollport.getBoundingClientRect().top
}

/**
 * Earliest rendered row of the Turn that owns `row`. Seats are direct flow
 * siblings and a Turn's seats are contiguous; hidden and empty seats render no
 * box and are skipped.
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
  sessionId, openFile, loadOlder, loadNewer, returnToLive, loadThrough, navigateToEvent, completeEventNavigation, loadImage, openView,
  chatScroll, forkAt, fileMentions, onFullscreenChange, useTranscriptView, useEventNavigation, useProjection, t,
}: ChatViewSlotProps) {
  const order = useChat(s => s.order)
  const nodeStore = useChat(s => s.nodes)
  const timeline = useChat(s => s.timeline)
  const inbox = useSession(s => s.queue)
  // Workspace root off the session list row: path summaries display relative to it.
  const cwd = useSessions(s => s.byId[sessionId]?.cwd)
  const running = useSession(s => s.running)
  const openState = useSession(s => s.openState)
  const openError = useSession(s => s.openError)
  const hasMore = useSession(s => s.hasMore)
  const detached = useSession(s => s.detached)
  const pendingLive = useSession(s => s.pendingLive)
  const loadingOlder = useSession(s => s.loadingOlder)
  // Host-computed whole-log outline: every turn of the session, including the
  // ones outside the loaded window. The merge below is view-layer only — the
  // conversation snapshot never carries projection values.
  const turnOutline = useProjection('turnOutline')
  const [activeTurn, setActiveTurn] = useState<number | null>(null)
  const turnNavigationRef = useRef<TurnRailMark | null>(null)
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
  const atBottomRef = useRef(chatScroll.read() === null)
  const scrollSamplePendingRef = useRef(false)
  const [, setScrollSampleTick] = useState(0)
  /**
   * Back-to-bottom visibility, observed rather than measured: a zero-height
   * sentinel at the end of the flow is either intersecting the scrollport or
   * not, which the browser computes off the main thread and reports only when
   * it changes. The scroll handler therefore stays free of this control
   * entirely — no `scrollHeight`, no per-frame layout, nothing on the path
   * that would interfere with the reader's own scrolling.
   *
   * Chrome only: follow OWNERSHIP remains `atBottomRef`, which the throttled
   * sample owns and which distinguishes reader input from a delivered scroll.
   */
  const [showToBottom, setShowToBottom] = useState(false)
  const floorSentinelRef = useRef<HTMLDivElement | null>(null)
  /** Last position delivered or written on the main thread. */
  const observedTopRef = useRef(0)
  /**
   * The row at the top edge, re-captured after every compensation and scroll
   * frame. Prepends and reflow move it in content coordinates; shifting
   * `scrollTop` by that movement alone keeps the reader's row still without
   * ever restoring a position recorded before the reader's latest input.
   */
  const anchorRef = useRef<ReadingAnchor | null>(null)
  const [eventNavigationSettleTick, setEventNavigationSettleTick] = useState(0)
  const eventNavigationLoadRef = useRef<{ requestId: number; settled: boolean } | null>(null)
  const completedEventNavigationRef = useRef(0)
  const [highlightedNodeKey, setHighlightedNodeKey] = useState<string | null>(null)
  /** Latest automatic-paging test; assigned below, called from scroll, commit, and resize paths.
   *  Runs both directions: forward paging is live only while the window is detached. */
  const maybeLoadOlderRef = useRef<() => void>(() => {})
  /** Reader input enables forward paging; a jump alone preserves its history window. */
  const forwardPagingArmedRef = useRef(false)
  /** Host chrome layer for floating controls; null when this view owns its own scrolling. */
  const [chromeLayer, setChromeLayer] = useState<HTMLElement | null>(null)
  /**
   * Seat-level host chrome layer. A control that must paint over the composer
   * seat and its fade goes here instead of `chromeLayer`, which is bounded by
   * a stacking context below the seat.
   */
  const [seatChromeLayer, setSeatChromeLayer] = useState<HTMLElement | null>(null)
  const firstSeqRef = useRef<number | null>(null)
  const openedRef = useRef(false)
  /** Ordinary activation needs one post-commit tail correction after the resident shell settles. */
  const activationTailPendingRef = useRef(false)
  const activationTailFrameRef = useRef<number | null>(null)
  const lastKeyRef = useRef<string | null>(null)
  const lastSteeringIdRef = useRef<string | null>(null)
  const lastSubmissionIdRef = useRef<string | null>(null)
  /** Flow tip signature — follow-scroll only when this moves. */
  const followSigRef = useRef<string | null>(null)

  const firstKey = order[0]
  const firstSeq = firstKey === undefined ? null : nodeStore.get(firstKey)?.anchorSeq ?? null
  const lastKey = order.at(-1) ?? null
  const lastNode = lastKey === null ? undefined : nodeStore.get(lastKey)
  const lastSteeringId = pendingSteering[pendingSteering.length - 1]?.id ?? null
  const lastSubmissionId = visibleSubmissions[visibleSubmissions.length - 1]?.requestId ?? null
  const followSig = `${openState}:${firstSeq}:${lastKey}:${order.length}:${running ? 1 : 0}:${lastSteeringId ?? ''}:${lastSubmissionId ?? ''}`

  // The host publishes two layers for floating controls; without them (this
  // view owning its own scrolling) the controls stay in place. Each layer is
  // found by name from the scrollport outwards rather than at a fixed depth:
  // the host's box nesting is its own business, and a lookup that counts
  // `parentElement` hops breaks silently whenever that nesting changes.
  useLayoutEffect(() => {
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: React attaches the ref before layout effects run. */
    if (local === null) return
    const scrollport = scrollerOf(local)
    const host = scrollport.closest('[data-conversation-root]') ?? scrollport
    setChromeLayer(host.querySelector<HTMLElement>('[data-conversation-chrome]'))
    setSeatChromeLayer(host.querySelector<HTMLElement>('[data-conversation-chrome-top]'))
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
    // read no row layout here.
    if (atBottomRef.current) {
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
    el.scrollTop = el.scrollHeight
    observedTopRef.current = el.scrollTop
    atBottomRef.current = true
    chatScroll.save(null)
  }

  // Land a row at the reading line — or the view at the scroll origin for a
  // Turn whose earliest row starts the flow — and republish scroll-derived state.
  const landOnRowRef = useRef<
    (local: HTMLElement, el: HTMLElement, row: HTMLElement, origin: boolean) => void
  >(() => {})
  landOnRowRef.current = (local, el, row, origin) => {
    el.scrollTop = origin ? 0 : el.scrollTop + flowTop(row, el) - 24
    observedTopRef.current = el.scrollTop
    anchorRef.current = readingAnchor(local, el)
    const isAtBottom = !detached && el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_THRESHOLD + 1
    atBottomRef.current = isAtBottom
    const position = isAtBottom ? null : scrollPosition(local, el)
    if (isAtBottom) chatScroll.save(null)
    else if (position !== null) chatScroll.save(position)
  }

  /**
   * Land a Turn destination: its earliest rendered row, so rows placed before
   * the Turn's anchor (a request's System prompt) stay in view, and the flow's
   * own first row at the scroll origin once history is complete — the reader
   * asked for the conversation's start, not for a reading line inside it.
   *
   * A latest-ref, so `navigateToTurn`'s identity stays stable for the memoized
   * rail while this reads the current `hasMore`.
   */
  const landOnTurnRef = useRef<(local: HTMLElement, el: HTMLElement, row: HTMLElement) => void>(() => {})
  landOnTurnRef.current = (local, el, row) => {
    const head = turnHead(row)
    landOnRowRef.current(local, el, head.row, head.first && !hasMore)
  }

  useLayoutEffect(() => {
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: React attaches the ref before layout effects run. */
    if (local === null) return
    const el = scrollerOf(local)
    // Every commit first holds the reader's row against the layout it changed,
    // including a page that lands while a reader scroll is still being sampled.
    if (detached) atBottomRef.current = false
    if (openedRef.current) holdAnchorRef.current()
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
        const isAtBottom = !detached && el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_THRESHOLD + 1
        atBottomRef.current = isAtBottom
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
    // Prepend (head seq decreased) away from the floor: the hold above keeps
    // the reader's row still.
    if (!atBottomRef.current && firstSeq !== null && firstSeqRef.current !== null && firstSeq < firstSeqRef.current) {
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
    const appendedUser = !detached && !loadingOlder
      && lastKey !== lastKeyRef.current && lastNode?.kind === 'user'
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
  })

  const saveScrollRef = useRef(() => {})
  saveScrollRef.current = () => {
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: the handler only fires while mounted. */
    if (local === null) return
    const el = scrollerOf(local)
    const position = atBottomRef.current ? null : scrollPosition(local, el)
    // Continuous save (unmount happens after ref detach, so saving there is
    // too late); pinned-to-bottom clears so a remount keeps following.
    if (atBottomRef.current) chatScroll.save(null)
    else if (position !== null) chatScroll.save(position)
  }

  // Follow ownership, restoration anchors, and storage are sampled at most
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
      saveScrollRef.current()
      maybeLoadOlderRef.current()
      setScrollSampleTick(tick => tick + 1)
    }
    // Paging rides the same sample as follow ownership: its test reads
    // `scrollHeight` near the head, which lays out the whole transcript, and a
    // fling cannot outrun OLDER_PREFETCH_SCREENS of runway within one interval.
    const onScroll = (): void => {
      const floor = Math.max(0, el.scrollHeight - el.clientHeight)
      const deliveredTop = Math.min(observedTopRef.current, floor)
      const top = el.scrollTop
      const movedByReader = Math.abs(top - deliveredTop) > 0.5
      if (movedByReader) {
        // Any upward reader movement leaves the live tail immediately. Moving
        // back down re-arms following only once the reader reaches its margin.
        atBottomRef.current = !detached && top > deliveredTop
          && floor - top <= FOLLOW_THRESHOLD + 1
        if (top > deliveredTop) forwardPagingArmedRef.current = true
      }
      observedTopRef.current = top
      scrollSamplePendingRef.current = true
      sampleTimer ??= window.setTimeout(sample, SCROLL_SAMPLE_INTERVAL_MS)
    }
    const onWheel = (event: WheelEvent): void => {
      if (event.deltaY <= 0) return
      if (detached) atBottomRef.current = false
      forwardPagingArmedRef.current = true
      maybeLoadOlderRef.current()
    }
    el.addEventListener('wheel', onWheel, { passive: true })
    el.addEventListener('scroll', onScroll, { passive: true })
    el.addEventListener('scrollend', sample, { passive: true })
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('scrollend', sample)
      if (sampleTimer !== undefined) window.clearTimeout(sampleTimer)
      scrollSamplePendingRef.current = false
    }
  }, [detached])

  // The ref starts null and is assigned every render, so the placeholder
  // initializer a function initial value would need never exists.
  const followRef = useRef<(() => void) | null>(null)
  followRef.current = () => {
    const local = listRef.current
    if (local !== null && !detached && atBottomRef.current) {
      const el = scrollerOf(local)
      el.scrollTop = el.scrollHeight
      observedTopRef.current = el.scrollTop
      chatScroll.save(null)
    }
  }
  const scrollDown = useCallback(() => { followRef.current?.() }, [])

  // Back-to-bottom visibility. `rootMargin` extends the scrollport's floor by
  // the follow threshold, so the control disappears on exactly the margin that
  // re-arms following. Browsers without IntersectionObserver keep the control
  // hidden: the transcript follows its tail there as it always has, and a
  // missing affordance beats one that never clears.
  useEffect(() => {
    const sentinel = floorSentinelRef.current
    const local = listRef.current
    if (sentinel === null || local === null || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry !== undefined) setShowToBottom(!entry.isIntersecting)
      },
      { root: scrollerOf(local), rootMargin: `0px 0px ${String(FOLLOW_THRESHOLD)}px 0px` },
    )
    observer.observe(sentinel)
    return () => { observer.disconnect() }
  }, [])
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
    // HEIGHT ONLY. The callbacks read scroll geometry, which forces layout of
    // the transcript. Width carries nothing either callback needs; any reflow
    // that moves rows also changes an observed height.
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
      maybeLoadOlderRef.current()
    })
    observer.observe(column)
    if (composer !== null) observer.observe(composer)
    return () => { observer.disconnect() }
  }, [])

  /** The mounting commit's paging test belongs to the opening branch above. */
  const mountedPagingRef = useRef(false)
  // A committed page is the only success signal paging needs: `order` grows,
  // this effect runs, and the next pull is tested against the new head. A page
  // that leaves `hasMore` set but adds nothing simply stops chaining here,
  // because the reader is no longer within the prefetch margin of a head that
  // did not move — no latch, and no state to reset per Session.
  useEffect(() => {
    // An attaching view — a first mount, or a tab returning to an open Session
    // — tests the window it installs once, in the layout effect that installs
    // it. Testing the same geometry again here would read it twice on the
    // frame the reader first sees.
    if (!mountedPagingRef.current) {
      mountedPagingRef.current = true
      return
    }
    if (loadingOlder) return
    maybeLoadOlderRef.current()
  }, [loadingOlder, order])

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
    const targetTurn = turnNavigationRef.current?.seq === eventNavigation.seq
      ? turnNavigationRef.current.turn : null
    const turnRow = targetTurn === null ? null
      : local.querySelector<HTMLElement>(`[data-chat-turn="${String(targetTurn)}"]:not([hidden])`)
    const exactKey = targetTurn === null
      ? order.find(key => nodeStore.get(key)?.anchorSeq === eventNavigation.seq)
      : turnRow?.dataset.chatAnchorKey
    const exactRow = targetTurn === null
      ? exactKey === undefined ? null : anchorElement(local, exactKey)
      : turnRow
    if (exactKey !== undefined && exactRow !== null) {
      const turn = Number(exactRow.dataset.chatTurn)
      if (Number.isSafeInteger(turn)) {
        // A Turn destination lands like the rail's own click: its earliest row,
        // or the scroll origin for the flow's first Turn. An exact event
        // destination lands the row it named.
        if (targetTurn === null) landOnRowRef.current(local, el, exactRow, false)
        else landOnTurnRef.current(local, el, exactRow)
        setActiveTurn(turn)
        turnNavigationRef.current = null
        setHighlightedNodeKey(eventNavigation.highlight ? exactKey : null)
        completedEventNavigationRef.current = eventNavigation.requestId
        eventNavigationLoadRef.current = null
        completeEventNavigation(eventNavigation.requestId)
        return
      }
    }

    if (loadingOlder && eventNavigationLoadRef.current === null) return
    const uncovered = firstSeq === null || firstSeq > eventNavigation.seq || detached
    const loading = eventNavigationLoadRef.current
    if (uncovered && (hasMore || detached) && loading?.requestId !== eventNavigation.requestId) {
      atBottomRef.current = false
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
    // a changed projection or a page that never arrived omits it, the reader
    // lands on the closest durable row the window holds: a mark naming a Turn
    // the flow cannot show would be a mark for nothing.
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
        landOnRowRef.current(local, el, row, false)
        // The mark follows what landed: a projection that dropped the requested
        // event leaves the reader on the nearest row, and the rail says so
        // rather than naming a Turn the flow cannot show.
        setActiveTurn(turn)
        setHighlightedNodeKey(eventNavigation.highlight ? fallback.key : null)
      }
    }
    turnNavigationRef.current = null
    completedEventNavigationRef.current = eventNavigation.requestId
    eventNavigationLoadRef.current = null
    completeEventNavigation(eventNavigation.requestId)
  }, [
    completeEventNavigation, eventNavigation, eventNavigationSettleTick, firstSeq,
    detached, hasMore, loadingOlder, loadThrough, nodeStore, openState, order,
  ])

  // The rail's marks: the host outline joined with the turns the window holds.
  // `timeline.turnOrder` is reference-stable and moves only when a turn enters
  // or leaves, so this recomputes on real membership changes rather than on
  // every streaming delta.
  const railMarks = useMemo(
    () => turnRailMarks(turnOutline, new Set(timeline.turnOrder)),
    [turnOutline, timeline.turnOrder],
  )

  // Active mark tracking. An IntersectionObserver over the turn rows reports
  // crossings off the main thread and costs no layout read; the reading-line
  // hit test it replaces ran a bisection over every row on every scroll frame,
  // forcing a full-transcript layout each time.
  useEffect(() => {
    const local = listRef.current
    if (local === null || typeof IntersectionObserver === 'undefined') return
    const scroller = scrollerOf(local)
    const visible = new Map<HTMLElement, number>()
    /**
     * Highest turn number present in the flow. Read from the rows rather than
     * the outline because the mark must name a row the reader can see.
     */
    let lastTurn: number | null = null
    /**
     * Publish the mark, resolving the floor case the reading band cannot serve.
     *
     * The band sits near the top of the viewport, so at the end of a transcript
     * it covers older turns while the tail occupies the bottom: the last turn is
     * the one turn that can never be inside it, and the newest intersecting turn
     * is therefore always an earlier one. A reader pinned to the floor is reading
     * the last turn, so that is the turn marked.
     * @param bandTurn - the newest turn the band reported, or null when nothing crossed.
     */
    const publishMark = (bandTurn: number | null): void => {
      const next = atBottomRef.current ? lastTurn : bandTurn
      if (next !== null) setActiveTurn(current => current === next ? current : next)
    }
    const noteTurn = (turn: number): void => {
      if (Number.isSafeInteger(turn) && (lastTurn === null || turn > lastTurn)) lastTurn = turn
    }
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const row = entry.target as HTMLElement
        const turn = Number(row.dataset.chatTurn)
        if (!Number.isSafeInteger(turn)) continue
        noteTurn(turn)
        if (entry.isIntersecting) visible.set(row, turn)
        else visible.delete(row)
      }
      // Several turns can cross the band at once; the newest one owns the mark,
      // matching a reader travelling down the transcript.
      let next: number | null = null
      for (const [row, turn] of visible) {
        if (!local.contains(row)) {
          visible.delete(row)
          observer.unobserve(row)
          continue
        }
        if (next === null || turn > next) next = turn
      }
      publishMark(next)
    }, {
      root: scroller === local ? null : scroller,
      // Collapse the scrollport to a band near its top: the reading line.
      rootMargin: '-10% 0px -85% 0px',
    })
    // Seats attach `data-chat-turn` from their own per-node subscriptions, so
    // rows can appear after this effect first runs. A MutationObserver picks
    // those up instead of re-running the whole effect per commit; the rows
    // already standing at mount are noted here, because they are what a
    // first-paint mark resolves against.
    const observeRows = (root: ParentNode): void => {
      for (const row of root.querySelectorAll<HTMLElement>('[data-chat-turn]')) {
        noteTurn(Number(row.dataset.chatTurn))
        observer.observe(row)
      }
    }
    observeRows(local)
    const rows = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof HTMLElement)) continue
          if (node.dataset.chatTurn !== undefined) {
            noteTurn(Number(node.dataset.chatTurn))
            observer.observe(node)
          } else {
            for (const row of node.querySelectorAll<HTMLElement>('[data-chat-turn]')) {
              noteTurn(Number(row.dataset.chatTurn))
            }
            observeRows(node)
          }
        }
        if (record.type === 'attributes' && record.target instanceof HTMLElement) {
          noteTurn(Number(record.target.dataset.chatTurn))
          observer.observe(record.target)
        }
      }
      // A turn that appeared at the floor is the one being read, and the band
      // reports nothing for it: the mark is resolved here instead.
      publishMark(null)
    })
    rows.observe(local, {
      childList: true,
      subtree: true,
      attributeFilter: ['data-chat-turn'],
    })
    // The band stays silent while nothing crosses it, so a reader who reaches the
    // floor is still inside the crossing they arrived with and nothing would
    // correct the mark. Resolving on every commit covers that, a turn appended at
    // the floor, and a transcript's first rows. State is written only on a change.
    publishMark(null)
    return () => {
      rows.disconnect()
      observer.disconnect()
    }
  }, [])

  /** Rail jump: a loaded turn scrolls now, an unloaded one anchors a window first. */
  const navigateToTurn = useCallback((mark: TurnRailMark): void => {
    setActiveTurn(mark.turn)
    // A Turn destination marks no row, and supersedes a search match that was
    // still lit from an earlier navigation.
    setHighlightedNodeKey(null)
    forwardPagingArmedRef.current = false
    const local = listRef.current
    if (local === null) return
    const row = local.querySelector<HTMLElement>(`[data-chat-turn="${String(mark.turn)}"]:not([hidden])`)
    if (mark.loaded && row !== null) {
      atBottomRef.current = false
      landOnTurnRef.current(local, scrollerOf(local), row)
      return
    }
    // Not in the window: the existing event-navigation path pages history to
    // the seq and lands the row, reporting progress through the head spinner.
    turnNavigationRef.current = mark
    atBottomRef.current = false
    // No highlight: the reader chose a Turn, not a row inside it.
    navigateToEvent(mark.seq, { highlight: false })
  }, [navigateToEvent])

  /**
   * Automatic history paging: pull the next older page as the reader
   * approaches the window head, and fill a window too short to scroll at all
   * (a short first page otherwise leaves the reader nothing to pull with).
   * A rail jump or a search navigation runs its own paging loop, so neither
   * shares the pager with this one.
   *
   * A window a jump detached also has a foot short of the live tail, so the
   * same test runs mirrored below it. Only one direction can pull at a time —
   * both read the one `loadingOlder` busy flag. Reader-driven forward paging
   * takes priority when the window is short enough to reach both margins.
   */
  maybeLoadOlderRef.current = () => {
    if (openState !== 'open' || loadingOlder) return
    if (eventNavigation !== null) return
    if (eventNavigationLoadRef.current !== null) return
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: every caller runs while the list is mounted. */
    if (local === null) return
    const el = scrollerOf(local)
    // The runway scales with the scrollport: a fixed distance is a shrinking
    // fraction of a taller window, and a fast fling then reaches the head
    // before the page it needs has arrived.
    const margin = Math.max(OLDER_PREFETCH_MARGIN, el.clientHeight * OLDER_PREFETCH_SCREENS)
    const scrollable = el.scrollHeight > el.clientHeight
    if (detached && forwardPagingArmedRef.current
      && (!scrollable || el.scrollHeight - el.scrollTop - el.clientHeight <= margin)) {
      loadNewer()
      return
    }
    if (hasMore && !(el.scrollTop > margin && scrollable)) loadOlder()
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
    // `order` so a window installed after mount — a return-to-live reattach —
    // takes the same correction an activation does. The latch above is what
    // limits this to the commits that asked for it.
  }, [order])

  // Paging status floats in the host's non-scrolling chrome layer when one is
  // available, so elastic overscroll cannot move it.
  const floatingChrome: ReactNode = hasMore
    ? (
      <div
        className={css.olderSlot}
        data-earlier-history={loadingOlder ? 'loading' : 'idle'}
      >
        {/* Empty while idle. The slot marks that history remains — it is the
            boundary the browser contract reads — but a spinner belongs to a
            request in flight, not to the mere existence of older pages: this
            floats over the scrollport now, so anything drawn here is on
            screen the whole time rather than only at the head. */}
        {loadingOlder
          ? (
            <span className={css.olderProgress} role="status" aria-live="polite">
              <Spinner />
              <span className={a11yCss.visuallyHidden}>{t('chat.loadingOlder')}</span>
            </span>
          )
          : null}
      </div>
    )
    : null

  // Portals to the seat-level layer: this control paints over the composer and
  // the fade above it, which the scrollport-bounded layer cannot reach.
  //
  // Mounted unconditionally so the fade has something to transition: a control
  // that unmounts vanishes in one frame, and there is no CSS state left to
  // animate out. Visibility is the class below, and the button is inert while
  // it is faded so the pointer passes through to the transcript underneath.
  const seatChrome: ReactNode = (
    <div className={css.toBottomSlot}>
      <button
        type="button"
        className={showToBottom || detached ? `${css.toBottom} ${css.toBottomVisible}` : css.toBottom}
        aria-label={detached ? t('chat.toLive') : t('chat.toBottom')}
        data-pending-live={detached && pendingLive > 0 ? pendingLive : undefined}
        onClick={() => {
          // A detached window has no live tail to scroll to: its floor is the
          // jump's page boundary, so writing scrollTop would strand the reader
          // mid-history. Reattaching is what reaches the newest events, and the
          // reinstalled window has to be pinned to its floor once it commits —
          // the same correction an activation takes.
          if (detached) {
            atBottomRef.current = true
            anchorRef.current = null
            chatScroll.save(null)
            activationTailPendingRef.current = true
            returnToLive()
            return
          }
          const local = listRef.current
          /* v8 ignore next -- ref-null guard: the button only renders alongside the mounted list. */
          if (local === null) return
          const el = scrollerOf(local)
          // Ledger takes the destination, so the animation's frames read as
          // ours. Computed, not written-and-read-back: writing would land
          // instantly and leave the animation nothing to travel.
          const floor = Math.max(0, el.scrollHeight - el.clientHeight)
          anchorRef.current = null
          observedTopRef.current = floor
          atBottomRef.current = true
          chatScroll.save(null)
          el.scrollTo({ top: floor, behavior: 'smooth' })
        }}
      >
        <IconChevronDownOutline14 />
      </button>
    </div>
  )

  return (
    <div className={css.root}>
      <div ref={listRef} className={css.scroll}>
        {/* Inside the scroller, before the flow: the rail is sticky and
            zero-height, so it holds its line while the transcript travels
            under it and adds nothing to the scrollable range. */}
        <TurnRail
          marks={railMarks}
          activeTurn={activeTurn}
          onNavigate={navigateToTurn}
          t={t}
        />
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
            scrollDown={scrollDown}
            onFullscreenChange={onFullscreenChange}
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
          {/* Floor sentinel: zero-height, last in the flow, so intersecting the
              scrollport means the tail is on screen. It carries no margin of
              its own — the observer's rootMargin owns the threshold — and adds
              nothing to scrollHeight, so no anchoring or paging math moves. */}
          <div ref={floorSentinelRef} className={css.floorSentinel} aria-hidden />
        </div>
      </div>
      {chromeLayer === null ? floatingChrome : createPortal(floatingChrome, chromeLayer)}
      {seatChromeLayer === null ? seatChrome : createPortal(seatChrome, seatChromeLayer)}
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
