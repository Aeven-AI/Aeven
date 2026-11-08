/**
 * Handoffs: the agent tells the reader that a step in the browser is theirs to
 * do, such as signing in. The pane shows it as a modal until the reader
 * acknowledges it; one is pending per session, and a newer one replaces the older.
 */

/** Why the agent hands the browser over, as the `preview_handoff` tool names it. */
export type HandoffReason = 'authentication' | 'captcha' | 'confirmation' | 'user_requested' | 'other'

/** One pending handoff, shown by the session's pane until the reader acknowledges it. */
export interface Handoff {
  /** Increases per handoff. */
  readonly id: number
  readonly reason: HandoffReason
  /** What the reader should do, in the agent's words. */
  readonly message: string
}

const REASONS: readonly HandoffReason[] = ['authentication', 'captcha', 'confirmation', 'user_requested', 'other']

/** Pending handoffs by session, observable from React. */
class HandoffStore {
  #pending = new Map<string, { handoff: Handoff; settle: (accepted: boolean) => void }>()
  #listeners = new Set<() => void>()
  #nextId = 1

  /**
   * Observe changes.
   * @param listener - called after any handoff opens or settles.
   * @returns disposer.
   */
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  /**
   * The handoff a session's pane shows now.
   * @param sessionId - the session.
   * @returns the pending handoff, or undefined.
   */
  get(sessionId: string): Handoff | undefined {
    return this.#pending.get(sessionId)?.handoff
  }

  /**
   * Show a handoff and wait until the reader acknowledges it.
   * @param sessionId - the session whose pane shows it.
   * @param reason - why the reader takes over; an unknown value counts as `other`.
   * @param message - what the reader should do.
   * @param signal - the agent's wait; aborting it withdraws the modal.
   * @returns true when the reader pressed OK; false when they declined, closed it, or it was withdrawn.
   */
  open(sessionId: string, reason: unknown, message: string, signal: AbortSignal | undefined): Promise<boolean> {
    this.settle(sessionId, false)
    return new Promise((resolve) => {
      const handoff: Handoff = {
        id: this.#nextId++,
        reason: REASONS.includes(reason as HandoffReason) ? reason as HandoffReason : 'other',
        message,
      }
      const withdraw = (): void => { this.settle(sessionId, false) }
      this.#pending.set(sessionId, {
        handoff,
        settle: (accepted) => {
          signal?.removeEventListener('abort', withdraw)
          resolve(accepted)
        },
      })
      if (signal?.aborted === true) {
        withdraw()
        return
      }
      signal?.addEventListener('abort', withdraw, { once: true })
      this.#emit()
    })
  }

  /**
   * Close a session's handoff.
   * @param sessionId - the session.
   * @param accepted - whether the reader pressed OK.
   */
  settle(sessionId: string, accepted: boolean): void {
    const entry = this.#pending.get(sessionId)
    if (entry === undefined) return
    this.#pending.delete(sessionId)
    entry.settle(accepted)
    this.#emit()
  }

  #emit(): void {
    for (const listener of this.#listeners) listener()
  }
}

/** The process's handoffs, shared by the automation listener and the panes. */
export const handoffs = new HandoffStore()
