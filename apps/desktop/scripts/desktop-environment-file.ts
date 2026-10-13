/** Load Desktop packaging settings from the repository `.env` without importing its other entries. */

import { existsSync, readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'

/** Packaging settings that the repository `.env` may supply and the Linux container forwards. */
export const DESKTOP_PACKAGING_ENV_NAMES = ['AVN_DESKTOP_APP_ID'] as const

/**
 * Copy Desktop packaging settings from an env file into an environment that does not already set them.
 * @param path - Env file path; an absent file supplies nothing.
 * @param environment - Environment to fill; a value it already holds is kept.
 * @returns Names copied from the file.
 */
export function loadDesktopPackagingEnvironment(
  path: string,
  environment: NodeJS.ProcessEnv = process.env,
): readonly string[] {
  if (!existsSync(path)) return []
  const values = parseEnv(readFileSync(path, 'utf8'))
  const loaded: string[] = []
  for (const name of DESKTOP_PACKAGING_ENV_NAMES) {
    const value = values[name]
    if (value === undefined || environment[name] !== undefined) continue
    environment[name] = value
    loaded.push(name)
  }
  return loaded
}
