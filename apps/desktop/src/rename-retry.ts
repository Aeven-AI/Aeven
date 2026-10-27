/** Rename that outlasts the handles Windows antivirus and indexers hold on freshly written files. */

import { rename } from 'node:fs/promises'

/**
 * Errors a Windows rename reports while another process still holds a handle on the path or inside its tree:
 * antivirus or the search indexer scanning freshly written files, or a just-stopped Host releasing its files.
 */
const WINDOWS_TRANSIENT_RENAME_ERRORS: ReadonlySet<string> = new Set(['EACCES', 'EBUSY', 'EPERM'])
const WINDOWS_RENAME_RETRY_INITIAL_MS = 50
const WINDOWS_RENAME_RETRY_MAX_MS = 1_000
const WINDOWS_RENAME_RETRY_DEADLINE_MS = 60_000

/**
 * Rename a file or directory, retrying for a bounded interval while Windows reports a handle held on it.
 * @param from - existing file or directory.
 * @param to - destination on the same volume; an existing file there is replaced, a directory must be absent.
 */
export async function renameRetryingWindowsLocks(from: string, to: string): Promise<void> {
  const deadline = Date.now() + WINDOWS_RENAME_RETRY_DEADLINE_MS
  let delay = WINDOWS_RENAME_RETRY_INITIAL_MS
  for (;;) {
    try {
      await rename(from, to)
      return
    } catch (error) {
      if (process.platform !== 'win32'
        || !WINDOWS_TRANSIENT_RENAME_ERRORS.has((error as NodeJS.ErrnoException).code ?? '')
        || Date.now() + delay > deadline) throw error
    }
    await new Promise(resolve => setTimeout(resolve, delay))
    delay = Math.min(delay * 2, WINDOWS_RENAME_RETRY_MAX_MS)
  }
}
