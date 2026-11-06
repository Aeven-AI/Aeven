/**
 * Reads that act on the resolved file and nothing else. A target is resolved
 * to its real path before a read, but a confined process sharing the
 * directory can replace a path component with a symlink in between, so a
 * plain open would follow it out of the workspace. The verified read opens
 * the path without following a final symlink, checks through `/proc/self/fd`
 * that the opened file is the resolved one, and reads through that open
 * descriptor. Linux only.
 *
 * @module @aeven/fs-sandbox/verified-read
 */

import { constants } from 'node:fs'
import { open, readlink } from 'node:fs/promises'
import { FsError, FsTargetKey } from '@aeven/fs'
import type { FsTarget } from '@aeven/fs'

/**
 * Open a resolved target and hand a read the open descriptor's path.
 * @param target - the target as resolved, whose key is its real path.
 * @param read - reads the file named by the descriptor path; it runs while the descriptor is open.
 * @returns what `read` returns.
 * @throws {FsError} `FS_PERMISSION_DENIED` when the opened file is not the resolved one.
 */
export async function readVerified<T>(target: FsTarget, read: (opened: FsTarget) => Promise<T>): Promise<T> {
  const handle = await openVerified(target)
  try {
    return await read({ displayPath: target.displayPath, targetKey: FsTargetKey(`/proc/self/fd/${String(handle.fd)}`) })
  } finally {
    await handle.close()
  }
}

/**
 * Stream a resolved target through its open descriptor; the descriptor closes when the stream ends.
 * @param target - the target as resolved.
 * @param stream - streams the file named by the descriptor path.
 * @returns the stream's chunks.
 */
export async function* streamVerified<T>(target: FsTarget, stream: (opened: FsTarget) => Promise<AsyncIterable<T>>): AsyncIterable<T> {
  const handle = await openVerified(target)
  try {
    yield* await stream({ displayPath: target.displayPath, targetKey: FsTargetKey(`/proc/self/fd/${String(handle.fd)}`) })
  } finally {
    await handle.close()
  }
}

async function openVerified(target: FsTarget) {
  // O_NONBLOCK keeps a FIFO from blocking the open; the inner read refuses non-regular files.
  const handle = await open(target.targetKey, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new FsError(`cannot read "${target.displayPath}": not found`, 'FS_NOT_FOUND')
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') throw changed(target)
    throw error
  })
  let actual: string
  try {
    actual = await readlink(`/proc/self/fd/${String(handle.fd)}`)
  } catch (error) {
    await handle.close()
    throw error
  }
  if (actual !== String(target.targetKey)) {
    await handle.close()
    throw changed(target)
  }
  return handle
}

function changed(target: FsTarget): FsError {
  return new FsError(`cannot read "${target.displayPath}": the file changed while it was being opened`, 'FS_PERMISSION_DENIED')
}
