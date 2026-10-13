/** Kernel-owned per-session writer locks; process exit releases ownership. */
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tryAcquireFileLock } from '@aeven/home-paths'
import type { SessionId } from '@aeven/session'
import { SessionPersistenceBusyError } from '@aeven/session-persistence'

/**
 * Claim one session's writer independently of other sessions and readers.
 * Lock files remain in place so contenders always address the same inode.
 * @param root - canonical storage root shared by the Hosts.
 * @param id - session whose recovery and writes require exclusive ownership.
 * @returns synchronous release after the final write drains.
 */
export async function acquireSessionWriter(root: string, id: SessionId): Promise<() => void> {
  const release = await tryAcquireFileLock(join(root, '.writers', createHash('sha256').update(id).digest('hex')))
  if (release === undefined) throw new SessionPersistenceBusyError(id)
  return release
}
