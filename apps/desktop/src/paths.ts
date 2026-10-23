/** Filesystem ownership for the Electron-managed desktop installation. */

import { join } from 'node:path'
import { resolveAvnHome } from '@aeven/home-paths'

/** Stable desktop installation paths under the shared Aeven home. */
export interface DesktopPaths {
  readonly root: string
  readonly profile: string
  readonly staging: string
  /** Profile a downloaded release installed ahead of its restart, which that release's first launch adopts. */
  readonly prepared: string
  readonly rollback: string
  readonly pending: string
  readonly lock: string
  readonly pnpm: {
    readonly root: string
    readonly store: string
    readonly cache: string
    readonly state: string
    readonly config: string
    readonly home: string
  }
}

/**
 * Resolve every Electron-owned path without changing the shared data roots.
 * @param avnHome - Aeven home shared with npm-installed avn.
 * @returns immutable desktop path set.
 */
export function resolveDesktopPaths(avnHome: string = resolveAvnHome()): DesktopPaths {
  const root = join(avnHome, 'desktop')
  const pnpm = join(root, 'pnpm')
  return {
    root,
    profile: join(avnHome, 'profiles', 'desktop'),
    staging: join(root, 'staging'),
    prepared: join(root, 'prepared', 'profile'),
    rollback: join(root, 'rollback', 'profile'),
    pending: join(root, 'pending.json'),
    lock: join(root, 'lock'),
    pnpm: {
      root: pnpm,
      store: join(pnpm, 'store'),
      cache: join(pnpm, 'cache'),
      state: join(pnpm, 'state'),
      config: join(pnpm, 'config'),
      home: join(pnpm, 'home'),
    },
  }
}
