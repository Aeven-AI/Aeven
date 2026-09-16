/**
 * Hardened read of an on-disk OAuth credential document. Only an owner-only
 * regular file is read: symlinks, directories, group- or other-readable files,
 * files whose identity changes while open, and documents over 64 KiB are
 * refused. POSIX fails closed when `O_NOFOLLOW` or the process uid is
 * unavailable; Windows skips the uid and mode checks but keeps the symlink,
 * identity, and size checks. The path is never written or chmod()ed.
 * @module @aeven/experimental-subscription-auth/credential-file
 */

import { constants, type Stats } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import { resolve } from 'node:path'

/** Hard ceiling for one credential document, in bytes. */
export const CREDENTIAL_FILE_MAX_BYTES = 64 * 1024

/** Why a read was refused: the path is absent, unsafe to trust, or over {@link CREDENTIAL_FILE_MAX_BYTES}. */
export type CredentialFileErrorCode = 'not_found' | 'unsafe_file' | 'too_large'

/** Secret-free refusal from {@link readCredentialFile}; the message never carries file contents. */
export class CredentialFileError extends Error {
  /** Stable reason callers branch on. */
  readonly code: CredentialFileErrorCode

  constructor(code: CredentialFileErrorCode, message: string) {
    super(message)
    this.name = 'CredentialFileError'
    this.code = code
  }
}

/**
 * Read one credential document under the checks in this module's contract.
 * @param filename - path to the document; resolved against the working directory.
 * @returns the document's UTF-8 text.
 * @throws CredentialFileError when the path is missing, unsafe, or too large.
 */
export async function readCredentialFile(filename: string): Promise<string> {
  const path = resolve(filename)
  let listed: Stats
  try {
    listed = await lstat(path)
  } catch (error) {
    throw mapReadError(error)
  }
  assertSafeStats(listed, true)

  const flags = openFlags()
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(path, flags)
    const opened = await handle.stat()
    assertSafeStats(opened, false)
    assertSameIdentity(listed, opened)
    const buffer = await handle.readFile()
    if (buffer.byteLength > CREDENTIAL_FILE_MAX_BYTES) {
      throw new CredentialFileError('too_large', 'credential file: exceeds the 64KiB limit')
    }
    const after = await handle.stat()
    assertSafeStats(after, false)
    assertSameIdentity(opened, after)
    if (after.size !== buffer.byteLength) {
      throw new CredentialFileError('unsafe_file', 'credential file: changed while it was being read')
    }
    return buffer.toString('utf8')
  } catch (error) {
    if (error instanceof CredentialFileError) throw error
    throw mapReadError(error)
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

function assertSafeStats(stats: Stats, fromLstat: boolean): void {
  if (fromLstat && stats.isSymbolicLink()) {
    throw new CredentialFileError('unsafe_file', 'credential file: refusing to follow a symlink')
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new CredentialFileError('unsafe_file', 'credential file: path is not a regular file')
  }
  if (stats.size > CREDENTIAL_FILE_MAX_BYTES) {
    throw new CredentialFileError('too_large', 'credential file: exceeds the 64KiB limit')
  }
  if (process.platform === 'win32') {
    // Windows has no POSIX owner/mode model. Symlink and identity checks still apply.
    return
  }
  const uid = typeof process.getuid === 'function' ? process.getuid() : undefined
  if (uid === undefined) {
    throw new CredentialFileError('unsafe_file', 'credential file: process uid is required to verify ownership')
  }
  if (stats.uid !== uid) {
    throw new CredentialFileError('unsafe_file', 'credential file: not owned by the current user')
  }
  if ((stats.mode & 0o077) !== 0) {
    throw new CredentialFileError('unsafe_file', 'credential file: readable beyond its owner')
  }
}

function openFlags(): number {
  if (process.platform === 'win32') {
    // Windows has no POSIX O_NOFOLLOW. lstat plus identity checks still refuse symlinks.
    return constants.O_RDONLY
  }
  if (typeof constants.O_NOFOLLOW !== 'number') {
    throw new CredentialFileError('unsafe_file', 'credential file: O_NOFOLLOW is required to open it safely')
  }
  return constants.O_RDONLY | constants.O_NOFOLLOW
}

function assertSameIdentity(left: Stats, right: Stats): void {
  if (
    left.dev !== right.dev
    || left.ino !== right.ino
    || left.uid !== right.uid
    || (left.mode & 0o777) !== (right.mode & 0o777)
    || left.size !== right.size
  ) {
    throw new CredentialFileError('unsafe_file', 'credential file: identity changed during open')
  }
}

function mapReadError(error: unknown): CredentialFileError {
  const code = (error as NodeJS.ErrnoException | null)?.code
  if (code === 'ENOENT') return new CredentialFileError('not_found', 'credential file: not found')
  if (code === 'ELOOP' || code === 'EMLINK') {
    return new CredentialFileError('unsafe_file', 'credential file: refusing to follow a symlink')
  }
  if (code === 'EISDIR' || code === 'ENOTDIR') {
    return new CredentialFileError('unsafe_file', 'credential file: path is not a regular file')
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return new CredentialFileError('unsafe_file', 'credential file: not readable by the current user')
  }
  return new CredentialFileError('unsafe_file', 'credential file: could not be opened safely')
}
