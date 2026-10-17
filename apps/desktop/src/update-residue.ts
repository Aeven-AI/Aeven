/**
 * The state an install that already completed leaves in the updater's caches.
 *
 * electron-updater stages the release it downloads under `pending/` and keeps
 * the previous release's archive as the next download's differential baseline;
 * Squirrel keeps `ShipItState.plist` for an install it has staged. Once the
 * release one of them staged is the release that runs, that state describes
 * finished work: a pending install nobody can perform, and up to twice the
 * release's size on disk.
 * @module @aeven/desktop/update-residue
 */

import { existsSync, readFileSync } from 'node:fs'
import { readdir, readFile, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Squirrel's record of the install it staged, beside the bundle that record names. */
const SHIP_IT_STATE = 'ShipItState.plist'
/** The directory electron-updater stages a downloaded release in. */
const STAGED_DIR = 'pending'
/** The staged release's descriptor; its `fileName` is the artifact name. */
const STAGED_INFO = 'update-info.json'
/** The previous release's archive, kept as the next download's differential baseline. */
const DIFFERENTIAL_BASELINE = 'update.zip'

/** Where one application's update downloads live, and for how long they matter. */
export interface UpdateResidueOptions {
  /** electron-updater's cache directory for this application. */
  readonly cacheDir: string
  /** Squirrel's cache directory, which holds its staged install; macOS only. */
  readonly shipItDir?: string | undefined
  /** Version this process runs, which decides whose staged state is finished. */
  readonly installedVersion: string
}

/**
 * Remove the updater state a completed install left behind.
 *
 * The staged download is always residue: only this session can install what a
 * check of this session downloaded. The differential baseline and Squirrel's
 * record of a staged bundle are residue only once the release they describe is
 * the one running, so an install still queued for a newer release keeps them.
 * @param options - the caches to clear and the version that decides ownership.
 * @returns the paths removed, for one startup log line.
 */
export async function clearUpdateResidue(options: UpdateResidueOptions): Promise<string[]> {
  const removed: string[] = []
  const stagedDir = join(options.cacheDir, STAGED_DIR)
  const staged = await stagedArtifactName(join(stagedDir, STAGED_INFO))
  if (existsSync(stagedDir)) {
    await rm(stagedDir, { recursive: true, force: true })
    removed.push(stagedDir)
  }
  const baseline = join(options.cacheDir, DIFFERENTIAL_BASELINE)
  if (staged !== undefined && stagedVersion(staged) === options.installedVersion && existsSync(baseline)) {
    await rm(baseline, { force: true })
    removed.push(baseline)
  }
  const shipItDir = options.shipItDir
  if (shipItDir !== undefined && await clearShipItState(shipItDir)) {
    removed.push(join(shipItDir, SHIP_IT_STATE))
  }
  return removed
}

/**
 * The release version an update artifact carries, such as `0.3.6-alpha` in
 * `aeven-0.3.6-alpha-mac-arm64.zip` or `aeven-0.3.6-alpha-win-x64.exe`.
 * @param fileName - the artifact's file name.
 * @returns the version, or undefined when the name is not an update artifact's.
 */
export function stagedVersion(fileName: string): string | undefined {
  return /^.+?-(\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?)-(?:mac|win|linux)-[A-Za-z0-9_]+(?:-unsigned)?\.[A-Za-z0-9]+$/u
    .exec(fileName)?.[1]
}

/**
 * The cache root electron-updater derives on this platform, which is where its
 * per-application download directory lives.
 * @param platform - host platform.
 * @param env - process environment, which names the Windows and Linux roots.
 * @returns that cache root.
 */
export function updateCacheRoot(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string {
  if (platform === 'win32') return env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local')
  if (platform === 'darwin') return join(homedir(), 'Library', 'Caches')
  return env['XDG_CACHE_HOME'] ?? join(homedir(), '.cache')
}

/**
 * The directory electron-updater keeps downloads in, named by the packaged
 * `app-update.yml` the shell already requires before it checks the stream.
 * @param resourcesPath - the packaged application's resources directory.
 * @param cacheRoot - the platform's cache root, Electron's `cache` path.
 * @returns that directory, or undefined when no packaged updater configuration names one.
 */
export function updaterCacheDir(resourcesPath: string, cacheRoot: string): string | undefined {
  let config: string
  try {
    config = readFileSync(join(resourcesPath, 'app-update.yml'), 'utf8')
  } catch {
    // No packaged updater configuration: this application never downloaded a release.
    return undefined
  }
  const name = /^updaterCacheDirName:\s*(.+?)\s*$/mu.exec(config)?.[1]?.replace(/^['"]|['"]$/gu, '')
  return name === undefined || name === '' ? undefined : join(cacheRoot, name)
}

/**
 * The bundle identifier a macOS `Info.plist` declares, which names Squirrel's
 * cache directory (`<identifier>.ShipIt`).
 * @param plist - the plist document's text.
 * @returns the identifier, or undefined when this plist declares none.
 */
export function bundleIdentifier(plist: string): string | undefined {
  return /<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/u.exec(plist)?.[1]
}

/** The staged descriptor's artifact name, when the updater left one. */
async function stagedArtifactName(infoPath: string): Promise<string | undefined> {
  let descriptor: unknown
  try {
    descriptor = JSON.parse(await readFile(infoPath, 'utf8'))
  } catch {
    // No readable descriptor: a first install, or a directory the updater already cleaned.
    return undefined
  }
  const fileName = (descriptor as { fileName?: unknown } | null)?.fileName
  return typeof fileName === 'string' ? fileName : undefined
}

/**
 * Remove Squirrel's state when the staged bundle it names is gone. A completed
 * install deletes that bundle and leaves the state behind; a state naming
 * nothing has no install left to resume.
 * @param shipItDir - Squirrel's cache directory for this application.
 * @returns whether the state file was removed.
 */
async function clearShipItState(shipItDir: string): Promise<boolean> {
  const state = join(shipItDir, SHIP_IT_STATE)
  if (!existsSync(state)) return false
  let staged: string[]
  try {
    staged = await readdir(shipItDir)
  } catch {
    // The directory left between the check above and this read. An install in
    // progress keeps its `update.*` directory, so there is nothing to clear.
    return false
  }
  if (staged.some(entry => entry.startsWith('update.'))) return false
  await rm(state, { force: true })
  return true
}
