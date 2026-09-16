/** Observable contiguous Session event window consumed by domain assemblers. */
import { notifySubscribers, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { ChunkRowEvent } from '../../types.ts'

/** Standard Session event or compact historical Assistant run. */
export type SessionEventLike = SessionEvent | ChunkRowEvent

/** Client history entry retaining its coarse transport discriminator. */
export type SessionEventLikeEntry =
  | { readonly type: 'event'; readonly event: SessionEvent }
  | { readonly type: 'chunks'; readonly event: ChunkRowEvent }

/** Scalar live entry accepted by append-only Client paths. */
export type SessionLiveEventEntry = Extract<SessionEventLikeEntry, { readonly type: 'event' }>

interface EventWindowLeaf {
  readonly kind: 'leaf'
  readonly entries: readonly SessionEventLikeEntry[]
  readonly length: number
}

interface EventWindowConcat {
  readonly kind: 'concat'
  readonly left: EventWindowNode
  readonly right: EventWindowNode
  readonly length: number
}

type EventWindowNode = EventWindowLeaf | EventWindowConcat

function leaf(entries: readonly SessionEventLikeEntry[]): EventWindowLeaf {
  return { kind: 'leaf', entries, length: entries.length }
}

function concat(left: EventWindowNode, right: EventWindowNode): EventWindowConcat {
  return { kind: 'concat', left, right, length: left.length + right.length }
}

function materialize(node: EventWindowNode): readonly SessionEventLikeEntry[] {
  if (node.kind === 'leaf') return node.entries
  const entries = new Array<SessionEventLikeEntry>(node.length)
  const pending: EventWindowNode[] = [node]
  let index = 0
  while (pending.length > 0) {
    const current = pending.pop() as EventWindowNode
    if (current.kind === 'concat') {
      pending.push(current.right, current.left)
      continue
    }
    for (const entry of current.entries) {
      entries[index] = entry
      index += 1
    }
  }
  return entries
}

function windowSnapshot(
  node: EventWindowNode,
  edges: SessionWindowEdges,
  revision: number,
  change: SessionEventChange,
): SessionEventWindow {
  let entries: readonly SessionEventLikeEntry[] | undefined
  return {
    get entries() {
      entries ??= materialize(node)
      return entries
    },
    hasMore: edges.hasOlder,
    hasOlder: edges.hasOlder,
    hasNewer: edges.hasNewer,
    revision,
    change,
  }
}

/** Exact delta that produced the latest event-window revision. */
export type SessionEventChange =
  | { readonly kind: 'replace'; readonly entries: readonly SessionEventLikeEntry[] }
  | { readonly kind: 'prepend'; readonly entries: readonly SessionEventLikeEntry[] }
  | { readonly kind: 'append'; readonly entries: readonly SessionLiveEventEntry[] }

/**
 * Which directions of the log lie outside the window.
 *
 * A window anchored at the live tail has `hasNewer: false`; one installed
 * around an older seq by a jump has `hasNewer: true` until paging forward
 * reaches the tail again.
 */
export interface SessionWindowEdges {
  readonly hasOlder: boolean
  readonly hasNewer: boolean
}

/** Current contiguous event window and its latest synchronous delta. */
export interface SessionEventWindow {
  readonly entries: readonly SessionEventLikeEntry[]
  /** Older history remains. Retained name for existing consumers; equals {@link hasOlder}. */
  readonly hasMore: boolean
  /** Older history remains outside the window's start. */
  readonly hasOlder: boolean
  /**
   * Newer history remains outside the window's end, so the window is detached
   * from the live tail and live events do not belong to it.
   */
  readonly hasNewer: boolean
  readonly revision: number
  readonly change: SessionEventChange
}

/** Normalize the legacy boolean `hasMore` argument to a full edge pair. */
function windowEdges(edges: SessionWindowEdges | boolean): SessionWindowEdges {
  return typeof edges === 'boolean' ? { hasOlder: edges, hasNewer: false } : edges
}

/** Conversation-facing event source exposed by one Session binding. */
export type SessionEventSource = ObservableSnapshot<SessionEventWindow>

/** Session-owned event feed; every accepted window mutation publishes synchronously. */
export class MutableSessionEventSource implements SessionEventSource {
  private readonly listeners = new Set<() => void>()
  private window: EventWindowNode = leaf([])
  private edges: SessionWindowEdges = { hasOlder: false, hasNewer: false }
  private snapshot: SessionEventWindow = windowSnapshot(
    this.window,
    this.edges,
    0,
    { kind: 'replace', entries: [] },
  )

  /** @returns the cached event-window snapshot. */
  getSnapshot(): SessionEventWindow { return this.snapshot }

  /**
   * Subscribe to synchronous window publication.
   * @param listener - invalidation callback.
   * @returns unsubscribe function.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Replace the complete contiguous window.
   * @param entries - complete window.
   * @param edges - which directions still hold history outside it; a bare
   *   boolean is read as `hasOlder` with the window attached to the live tail.
   */
  replace(entries: readonly SessionEventLikeEntry[], edges: SessionWindowEdges | boolean): void {
    this.window = leaf(entries)
    this.publish(windowEdges(edges), { kind: 'replace', entries })
  }

  /**
   * Prepend one older contiguous page.
   * @param entries - newly loaded older entries.
   * @param hasOlder - whether still older history remains.
   */
  prepend(entries: readonly SessionEventLikeEntry[], hasOlder: boolean): void {
    this.window = concat(leaf(entries), this.window)
    this.publish({ hasOlder, hasNewer: this.edges.hasNewer }, { kind: 'prepend', entries })
  }

  /**
   * Append one contiguous newer page loaded by forward paging.
   *
   * Published as a `replace` of the grown window rather than an `append`:
   * `append` carries live entries a consumer folds in one at a time, while
   * this delivers a whole page at the window's end. A consumer that
   * reassembles from `entries` therefore sees the page without needing a
   * fourth change kind.
   * @param entries - newly loaded newer entries.
   * @param hasNewer - whether still newer history remains outside the window.
   */
  appendPage(entries: readonly SessionEventLikeEntry[], hasNewer: boolean): void {
    this.window = concat(this.window, leaf(entries))
    const grown = materialize(this.window)
    this.publish({ hasOlder: this.edges.hasOlder, hasNewer }, { kind: 'replace', entries: grown })
  }

  /**
   * Append one contiguous live entry.
   *
   * Only the Session appends, and only while the window reaches the live tail:
   * a detached window's caller buffers instead, so this never splices a live
   * event onto history it does not adjoin.
   * @param entry - live tail entry.
   */
  append(entry: SessionLiveEventEntry): void {
    const entries = [entry]
    this.window = concat(this.window, leaf(entries))
    this.publish(this.edges, {
      kind: 'append',
      entries,
    })
  }

  private publish(
    edges: SessionWindowEdges,
    change: SessionEventChange,
  ): void {
    this.edges = edges
    this.snapshot = windowSnapshot(this.window, edges, this.snapshot.revision + 1, change)
    notifySubscribers(this.listeners, '[session-controller] event feed')
  }
}
