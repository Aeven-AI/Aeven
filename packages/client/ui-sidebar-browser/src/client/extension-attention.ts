/**
 * Tells the Aeven extension when a step in the tab the agent works in waits for
 * the person, and when the agent's turn ended there. The extension shows each in
 * the tab (status tag, tab icon, tab group mark) and as a notification.
 *
 * A session counts only for the turn in which its agent acted in an extension
 * tab, and only that tab is told. A turn that ends while a hand-off waits sends
 * no "finished", so the waiting notice stays until the agent acts again.
 */

/** What the extension is told about a tab. */
export interface AttentionNotice {
  /** `input` while a step waits for the person; `done` when the turn ended. */
  readonly state: 'input' | 'done'
  /** What the person should do, as the agent wrote it; empty for `done`. */
  readonly message: string
}

/** Sends a notice to one extension tab; a failure is the extension's to ignore, so the promise never rejects. */
export type AttentionSender = (targetId: string, notice: AttentionNotice) => Promise<void>

/** What a session's running turn did in an extension tab. */
interface TurnRecord {
  readonly targetId: string
  readonly send: AttentionSender
  waiting: boolean
}

/** The sessions whose agent acted in an extension tab during the running turn. */
export class ExtensionAttention {
  readonly #turns = new Map<string, TurnRecord>()

  /**
   * Record that a session's agent acted in an extension tab.
   * @param sessionId - the session.
   * @param targetId - the extension tab.
   * @param send - how to reach that tab's extension.
   */
  acted(sessionId: string, targetId: string, send: AttentionSender): void {
    this.#turns.set(sessionId, { targetId, send, waiting: false })
  }

  /**
   * Tell the session's extension tab that a step waits for the person.
   * @param sessionId - the session handing a step over.
   * @param message - what the person should do.
   */
  input(sessionId: string, message: string): void {
    const turn = this.#turns.get(sessionId)
    if (turn === undefined) return
    turn.waiting = true
    void turn.send(turn.targetId, { state: 'input', message })
  }

  /**
   * End the session's turn: its extension tab hears that the agent finished, unless a step waits for the person.
   * @param sessionId - the session whose turn ended.
   */
  turnEnded(sessionId: string): void {
    const turn = this.#turns.get(sessionId)
    if (turn === undefined) return
    this.#turns.delete(sessionId)
    if (!turn.waiting) void turn.send(turn.targetId, { state: 'done', message: '' })
  }
}
