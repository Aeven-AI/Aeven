/**
 * Animation-frame control for specs that render the conversation shell.
 *
 * The content cover withholds the Session body until the spinner has been
 * presented, and confirms that presentation on animation frames. jsdom would
 * otherwise run those frames on its own timing, so a spec asserting on
 * transcript content would race the cover. Stubbing makes frames explicit:
 * nothing advances until a case flushes.
 * @module
 */
import { act } from '@testing-library/react'
import { vi } from 'vitest'

let sequence = 0
const pending = new Map<number, FrameRequestCallback>()

/**
 * Replace `requestAnimationFrame`/`cancelAnimationFrame` with a queue this
 * module drains. Call from `beforeEach`; `vi.unstubAllGlobals()` restores it.
 */
export function stubAnimationFrames(): void {
  sequence = 0
  pending.clear()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = ++sequence
    pending.set(id, callback)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    pending.delete(id)
  })
}

/**
 * Run the queued frames inside `act`, one round per frame. A callback that
 * requests another frame is served by the next round, not the current one —
 * which is how a two-frame wait is reached with `rounds` of 2.
 * @param rounds - how many frames to advance.
 */
export function flushAnimationFrames(rounds = 1): void {
  act(() => {
    for (let round = 0; round < rounds; round++) {
      const batch = [...pending.values()]
      pending.clear()
      for (const callback of batch) callback(0)
    }
  })
}

/**
 * Advance past the content cover so the Session body is mounted and painted.
 * The cover waits one two-frame round to mount the body and another to mark it
 * painted.
 */
export function flushContentCover(): void {
  flushAnimationFrames(2)
  flushAnimationFrames(2)
}
