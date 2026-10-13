/**
 * Which session's surface column is full screen. The column draws the full
 * screen presentation and the frame's corner holds the toggle, so both read
 * one instance; switching sessions leaves full screen.
 */
import { useSyncExternalStore } from 'react'

/** The full screen session, shared by the column and its corner toggle. */
export class SurfaceFullscreen {
  private session: string | null = null
  private readonly listeners = new Set<() => void>()

  /**
   * The session whose column is full screen.
   * @returns its id, or null when no column is full screen.
   */
  get(): string | null {
    return this.session
  }

  /**
   * Put one session's column in full screen, or leave full screen.
   * @param sessionId - the session to show full screen, or null to leave it.
   */
  set(sessionId: string | null): void {
    if (this.session === sessionId) return
    this.session = sessionId
    for (const listener of this.listeners) listener()
  }

  /**
   * Follow changes.
   * @param listener - called after every change.
   * @returns the unsubscribe callback.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
}

/**
 * Whether one session's column is full screen, re-rendering on change.
 * @param store - the shared full screen state.
 * @param sessionId - the session asked about.
 * @returns true while that session's column is full screen.
 */
export function useFullscreen(store: SurfaceFullscreen, sessionId: string | undefined): boolean {
  return useSyncExternalStore(
    listener => store.subscribe(listener),
    () => sessionId !== undefined && store.get() === sessionId,
  )
}
