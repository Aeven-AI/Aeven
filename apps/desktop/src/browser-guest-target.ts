/**
 * The sidebar browser's guests as engine targets, and what the engine may do on
 * this computer. A guest's pointer is drawn by the app window over it: each step
 * goes to that window over IPC, and the engine waits for the window to report the
 * pointer arrived (`acknowledgeBrowserCursor`).
 */

import { app, clipboard, type WebContents } from 'electron'
import { access, realpath, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type { BrowserTarget, CursorStep, EngineHost } from '@aeven/browser-engine'
import { DESKTOP_IPC, type DesktopBrowserCursor } from './ipc.ts'

/** Number of the next pointer step. */
let nextCursorSequence = 1
/** Arrival waiters belong to the guest and app renderer that announced the move. */
const cursorArrivals = new Map<number, { guest: WebContents; finish: () => void }>()
/** One target per guest, so the engine's per-target state follows the guest. */
const targets = new WeakMap<WebContents, BrowserTarget>()

/**
 * Acknowledge an owned cursor step from its app renderer.
 * @param sender - renderer reporting arrival.
 * @param guestId - guest receiving the action.
 * @param sequence - step that settled or became invisible.
 */
export function acknowledgeBrowserCursor(sender: WebContents, guestId: number, sequence: number): void {
  const pending = cursorArrivals.get(sequence)
  if (pending?.guest.id === guestId && pending.guest.hostWebContents === sender) pending.finish()
}

/**
 * Send a pointer step to the window that shows a guest, waiting for its arrival when asked.
 * @param guest - the guest acted on.
 * @param cursor - the step.
 * @param wait - whether to wait for the window to report arrival.
 * @param timeoutMs - the most the wait takes.
 * @param signal - cancels the wait and withdraws the pointer.
 */
function presentCursor(guest: WebContents, cursor: CursorStep, wait: boolean, timeoutMs: number, signal: AbortSignal): Promise<void> {
  const sequence = nextCursorSequence++
  const host = guest.hostWebContents
  if (host == null || host.isDestroyed()) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const finish = (): void => {
      clearTimeout(timer)
      cursorArrivals.delete(sequence)
      signal.removeEventListener('abort', abort)
      resolve()
    }
    const abort = (): void => {
      if (!host.isDestroyed()) host.send(DESKTOP_IPC.browserCursor, { webContentsId: guest.id, sequence, action: 'cancel', x: 0, y: 0 } satisfies DesktopBrowserCursor)
      // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- the aborting caller's own reason is propagated intact.
      reject(signal.reason)
      finish()
    }
    const timer = setTimeout(finish, timeoutMs)
    if (wait) {
      cursorArrivals.set(sequence, { guest, finish })
      signal.addEventListener('abort', abort, { once: true })
    }
    host.send(DESKTOP_IPC.browserCursor, { webContentsId: guest.id, sequence, ...cursor } satisfies DesktopBrowserCursor)
    if (!wait) finish()
  })
}

/**
 * A sidebar guest as an engine target.
 * @param guest - the guest's web contents.
 * @returns the same target for the same guest.
 */
export function guestTarget(guest: WebContents): BrowserTarget {
  let target = targets.get(guest)
  if (target === undefined) {
    target = {
      id: guest.id,
      debugger: guest.debugger as unknown as BrowserTarget['debugger'],
      getURL: () => guest.getURL(),
      getTitle: () => guest.getTitle(),
      insertText: text => guest.insertText(text),
      sendInputEvent: (event) => { guest.sendInputEvent(event) },
      session: { fetch: (input, init) => guest.session.fetch(input, init) },
      emit: event => guest.emit(event as never),
      presentCursor: (cursor, wait, timeoutMs, signal) => presentCursor(guest, cursor, wait, timeoutMs, signal),
    }
    targets.set(guest, target)
  }
  return target
}

/**
 * A path in the user's Downloads folder that no file holds yet.
 * @param name - the preferred file name.
 * @returns the absolute path.
 */
async function freeDownloadPath(name: string): Promise<string> {
  const folder = app.getPath('downloads')
  const extension = extname(name)
  const stem = name.slice(0, name.length - extension.length)
  for (let attempt = 0; ; attempt++) {
    const candidate = join(folder, attempt === 0 ? name : `${stem} (${String(attempt)})${extension}`)
    try {
      await access(candidate)
    } catch {
      // No file at this path, so the export takes it.
      return candidate
    }
  }
}

/** What the engine may do on this computer: attach local files, save to Downloads, and use the clipboard. */
export const DESKTOP_ENGINE_HOST: EngineHost = {
  async resolveFiles(paths) {
    return await Promise.all(paths.map(async (path) => {
      const canonical = await realpath(path)
      if (!(await stat(canonical)).isFile()) throw new Error(`not a regular file: ${basename(canonical)}`)
      return canonical
    }))
  },
  async saveDownload(name, bytes) {
    const path = await freeDownloadPath(name)
    await writeFile(path, bytes)
    return path
  },
  clipboard: {
    readText: () => clipboard.readText(),
    writeText: (text) => { clipboard.writeText(text) },
  },
}
