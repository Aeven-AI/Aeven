/**
 * Shared filesystem path helpers for Aeven user data.
 *
 * @module @aeven/home-paths
 */

import { createHash } from 'node:crypto'
import { opendir, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

/** Directory name for the default Aeven home under the OS home. */
export const AVN_HOME_DIR_NAME = '.aeven'

/** Stable user-facing display form for the default Aeven home. */
export const DEFAULT_AVN_HOME_DISPLAY = `~/${AVN_HOME_DIR_NAME}`

/** Environment variable that overrides the default Aeven home. */
export const AVN_HOME_ENV = 'AVN_HOME'

/**
 * Give a native filesystem watcher one canonical spelling of a path, even
 * when its final components do not exist yet. The deepest existing ancestor
 * is resolved through {@link realpath}; when a suffix is missing, that
 * ancestor is also proved to be an enumerable directory before the suffix is
 * restored. This prevents Windows from treating a regular-file ancestor as
 * ordinary absence, and prevents short-name aliases from being mixed with
 * long paths emitted by the native watcher backend.
 * @param path - Watch target or root, resolved against the current directory.
 * @returns the target with its existing ancestor canonicalized.
 * @throws when ancestor traversal encounters an error other than absence, or
 * the existing ancestor of a missing suffix is not an enumerable directory.
 */
export async function canonicalizeWatchPath(path: string): Promise<string> {
  let current = resolve(path)
  const missing: string[] = []
  while (true) {
    try {
      const canonical = await realpath(current)
      if (missing.length > 0) {
        // A Windows file-as-parent probe reports ENOENT. Opening the resolved
        // ancestor preserves the cross-platform directory requirement.
        const directory = await opendir(canonical)
        await directory.close()
      }
      return join(canonical, ...missing.reverse())
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const parent = dirname(current)
      /* v8 ignore next -- a filesystem root exists, so traversal resolves before this guard */
      if (parent === current) throw error
      missing.push(basename(current))
      current = parent
    }
  }
}

/**
 * Resolve the default Aeven home using Node's platform path rules.
 * @returns the absolute default harness home path.
 */
export function defaultAvnHome(): string {
  return join(homedir(), AVN_HOME_DIR_NAME)
}

/**
 * Expand supported tilde prefixes against the operating-system home.
 * @param path - configured path that may begin with `~`, `~/`, or `~\`.
 * @returns the expanded path, or the original value when no supported prefix is present.
 */
export function expandHomePath(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

/**
 * Resolve the single-root Aeven home.
 *
 * Precedence, highest first: an explicit configured path, `$AVN_HOME`, then
 * `~/.aeven`. The harness keeps all user data under one root. An empty or
 * whitespace-only `$AVN_HOME` is treated as unset, so a blank override never
 * resolves the home to the current working directory.
 * @param configured - explicit harness-home override, which has highest precedence.
 * @param env - environment mapping used to read `AVN_HOME`.
 * @returns the normalized absolute harness home path.
 */
export function resolveAvnHome(configured?: string, env: Record<string, string | undefined> = process.env): string {
  const fromEnv = env[AVN_HOME_ENV]
  const selected = configured ?? (fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : defaultAvnHome())
  return resolve(expandHomePath(selected))
}

/**
 * Join path segments onto the resolved Aeven home.
 * @param segments - path segments appended to the Aeven home; an empty list returns the home itself.
 * @returns the normalized absolute joined path.
 */
export function avnHomePath(...segments: string[]): string {
  return join(resolveAvnHome(), ...segments)
}

/** Home-relative directory holding one subtree per signed-in account. */
export const ACCOUNTS_DIR_NAME = 'accounts'

/**
 * Directory name of one account's subtree under {@link ACCOUNTS_DIR_NAME}: the hex SHA-256 of the account
 * id, so the name is filesystem-safe for any id and does not spell the id out.
 * @param owner - account id of the signed-in user.
 * @returns the account's directory name.
 */
export function accountDirectoryName(owner: string): string {
  return createHash('sha256').update(owner).digest('hex')
}

/**
 * Join path segments onto one account's subtree of the resolved Aeven home.
 * @param owner - account id of the signed-in user.
 * @param segments - path segments inside the account's subtree.
 * @returns the normalized absolute path.
 */
export function accountHomePath(owner: string, ...segments: string[]): string {
  return avnHomePath(ACCOUNTS_DIR_NAME, accountDirectoryName(owner), ...segments)
}

/**
 * Describe a resolved harness home symbolically for user-facing display.
 *
 * It never returns an absolute machine path: the default home is labelled
 * `~/.aeven`, and any configured home is labelled `$AVN_HOME`.
 * @param resolvedHome - the absolute path returned by {@link resolveAvnHome}.
 * @returns `~/.aeven` for the default home, otherwise `$AVN_HOME`.
 */
export function avnHomeDisplay(resolvedHome: string): string {
  return resolvedHome === resolve(defaultAvnHome()) ? DEFAULT_AVN_HOME_DISPLAY : `$${AVN_HOME_ENV}`
}

export * from './host-lease.ts'
export * from './file-lock.ts'
