/** The agent pointer showing the explorer row of a path the agent opened beside the chat. */
import { acquireColumnPointer } from '@aeven/experimental-browser-overlay/src/column-pointer.ts'

/** Idle fade of the column pointer when this pane creates it, in ms; the browser pane uses the same. */
const POINTER_IDLE_HIDE_MS = 30_000

/** How long the pointer waits for the explorer to show the row, in ms. */
const ROW_WAIT_MS = 2000

/**
 * Glide the column's agent pointer onto the explorer row of a path and show the
 * press, once the shown Files pane lists it. The explorer has already opened the
 * path; the pointer draws that action and clicks nothing.
 * @param path - the workspace path shown.
 * @returns once the pointer arrived, or when no shown explorer lists the path in time.
 */
export async function pointAtPath(path: string): Promise<void> {
  const selector = `[data-sidebar-right-pane="files"]:not([hidden]) [data-path="${CSS.escape(path)}"]`
  const deadline = performance.now() + ROW_WAIT_MS
  let row: HTMLElement | null = null
  while (row === null && performance.now() < deadline) {
    const candidate = document.querySelector<HTMLElement>(selector)
    if (candidate !== null && candidate.getBoundingClientRect().height > 0) row = candidate
    else await new Promise<void>((resolve) => { requestAnimationFrame(() => { resolve() }) })
  }
  const column = row?.closest<HTMLElement>('[data-sidebar-right-surfaces]')
  if (row === null || column === null || column === undefined) return
  const pointer = acquireColumnPointer(column, POINTER_IDLE_HIDE_MS)
  try {
    pointer.overlay.click(pointer.aim(row))
    await pointer.overlay.arrived()
  } finally {
    pointer.release()
  }
}
