/** The agent pointer acting on a sidebar terminal: pressing its pill, pointing into it, or closing it. */
import type { SessionId } from '@aeven/session/types'
import type { WebTerminalId } from '@aeven/api-terminal-controller/types'
import { acquireColumnPointer } from '@aeven/experimental-browser-overlay/src/column-pointer.ts'

/** Idle fade of the column pointer when a terminal pane creates it, in ms; the browser pane uses the same. */
export const POINTER_IDLE_HIDE_MS = 30_000

/** How long the pointer waits for a pill's pane or button to be placed, in ms. */
const PLACE_WAIT_MS = 1500

/**
 * An element once it is placed on screen, or null after {@link PLACE_WAIT_MS}.
 * @param find - finds the element; polled each frame.
 * @param signal - abandons the wait.
 * @returns the element, or null.
 */
async function placed(find: () => HTMLElement | null, signal: AbortSignal | undefined): Promise<HTMLElement | null> {
  const deadline = performance.now() + PLACE_WAIT_MS
  for (;;) {
    const element = find()
    if (element !== null) {
      const box = element.getBoundingClientRect()
      if (box.width > 0 && box.height > 0) return element
    }
    if (performance.now() > deadline) return null
    await new Promise<void>((resolve) => { requestAnimationFrame(() => { resolve() }) })
    signal?.throwIfAborted()
  }
}

/**
 * Draw the agent acting on one terminal of the session this window shows: the
 * pointer presses the terminal's pill when another one is in front, then points at
 * the terminal's text cursor for `send`, or presses the pill's close button for
 * `close`. The terminal is not clicked, so the reader's keyboard focus stays put.
 * @param sessionId - the session whose column is shown.
 * @param terminalId - the Host terminal acted on.
 * @param action - what the agent does.
 * @param terminalOf - the Host terminal a pill's content names.
 * @param signal - abandons the gesture.
 * @returns true once drawn, false when this window shows no pill for the terminal.
 */
export async function presentTerminal(
  sessionId: SessionId,
  terminalId: WebTerminalId,
  action: 'send' | 'close',
  terminalOf: (sessionId: SessionId, contentId: string) => WebTerminalId | undefined,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  const pill = [...document.querySelectorAll<HTMLElement>('[data-sidebar-right-pill="terminal"]')]
    .find(candidate => terminalOf(sessionId, candidate.getAttribute('data-sidebar-right-surface') ?? '') === terminalId)
  const column = pill?.closest<HTMLElement>('[data-sidebar-right-surfaces]')
  if (pill === undefined || column === null || column === undefined) return false
  const pointer = acquireColumnPointer(column, POINTER_IDLE_HIDE_MS)
  try {
    if (action === 'close') {
      const close = pill.querySelector<HTMLElement>('button[aria-label]')
      if (close !== null) await pointer.press(close, signal)
      return true
    }
    if (pill.getAttribute('data-active') === null) {
      const tab = pill.querySelector<HTMLElement>('[role="tab"]')
      if (tab !== null) await pointer.press(tab, signal)
    }
    const pane = column.querySelector<HTMLElement>('[data-sidebar-right-pane="terminal"]:not([hidden]) [data-sidebar-terminal]')
    const target = await placed(() => pane?.querySelector<HTMLElement>('.xterm-cursor') ?? pane ?? null, signal)
    if (target !== null) {
      pointer.overlay.type(pointer.aim(target))
      await pointer.overlay.arrived(signal)
    }
    return true
  } finally {
    pointer.release()
  }
}
