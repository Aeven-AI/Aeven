/**
 * The named-event bus the ported screens use.
 *
 * Aeven mixes this into its services from a utility; the screens use three
 * members of it, keyed by the caller's own id so a component removes exactly
 * its own listener on unmount.
 * @module
 */

type Listener = (detail: unknown) => void

const listeners = new Map<string, Map<string, Listener>>()

/**
 * Listen for one event.
 * @param event - the event name.
 * @param key - the caller's id, so it can remove this listener later.
 * @param listener - invoked with the dispatched detail.
 */
export function on(event: string, key: string, listener: Listener): void {
  const forEvent = listeners.get(event) ?? new Map<string, Listener>()
  forEvent.set(key, listener)
  listeners.set(event, forEvent)
}

/**
 * Stop listening.
 * @param event - the event name.
 * @param key - the id the listener was registered under.
 */
export function off(event: string, key: string): void {
  const forEvent = listeners.get(event)
  if (forEvent === undefined) return
  forEvent.delete(key)
  if (forEvent.size === 0) listeners.delete(event)
}

/**
 * Dispatch to every listener of one event.
 * @param event - the event name.
 * @param detail - passed to each listener.
 */
export function dispatchObjectEvent(event: string, detail: unknown): void {
  const forEvent = listeners.get(event)
  if (forEvent === undefined) return
  // A copy, so a listener that removes itself while dispatching does not
  // disturb the iteration.
  for (const listener of [...forEvent.values()]) listener(detail)
}
