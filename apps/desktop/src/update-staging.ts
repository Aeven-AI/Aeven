/**
 * Readies a downloaded macOS release while the running release keeps serving.
 *
 * electron-updater hands its download to Squirrel.Mac only when asked to
 * install, so without this step the restart the reader answers first waits for
 * Squirrel to fetch, verify, and unpack the whole bundle, behind a window whose
 * backend has already stopped. Staging it here moves that work into the
 * download, and the staged bundle carries the seed and runtime the shell
 * installs the next profile from. Squirrel installs a staged bundle when the
 * application quits, whether or not the reader chose the restart.
 * @module @aeven/desktop/update-staging
 */

import { execFile } from 'node:child_process'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { autoUpdater as nativeUpdater } from 'electron'

const execFileAsync = promisify(execFile)

/** Prefix of the directories Squirrel.Mac unpacks a staged bundle into. */
const STAGED_DIR_PREFIX = 'update.'

/**
 * Have Squirrel.Mac fetch the release electron-updater downloaded from that
 * updater's local feed, verify its code signature, and unpack it.
 * @returns once Squirrel reports the bundle staged.
 */
export async function stageNativeUpdate(): Promise<void> {
  const staged = Promise.withResolvers<void>()
  const onStaged = (): void => { staged.resolve() }
  const onNothing = (): void => { staged.reject(new Error('desktop update: Squirrel found no release to stage')) }
  const onError = (error: Error): void => { staged.reject(error) }
  nativeUpdater.once('update-downloaded', onStaged)
  nativeUpdater.once('update-not-available', onNothing)
  nativeUpdater.once('error', onError)
  try {
    nativeUpdater.checkForUpdates()
    await staged.promise
  } finally {
    nativeUpdater.removeListener('update-downloaded', onStaged)
    nativeUpdater.removeListener('update-not-available', onNothing)
    nativeUpdater.removeListener('error', onError)
  }
}

/** The packaged resources a staged bundle carries for installing its profile. */
export interface StagedReleaseResources {
  /** The release's packaged seed. */
  readonly seed: string
  /** The release's bundled Node.js. */
  readonly node: string
  /** The release's bundled pnpm entry. */
  readonly pnpm: string
}

/**
 * Locate the bundle Squirrel staged for one release.
 * @param shipItDir - Squirrel's cache directory for this application.
 * @param version - the release version the bundle must declare.
 * @returns the newest staged bundle's resources for that version.
 */
export async function stagedReleaseResources(shipItDir: string, version: string): Promise<StagedReleaseResources> {
  const candidates: { readonly resources: string; readonly modified: number }[] = []
  for (const entry of await readdir(shipItDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith(STAGED_DIR_PREFIX)) continue
    const stagedDir = join(shipItDir, entry.name)
    for (const bundle of await readdir(stagedDir, { withFileTypes: true })) {
      if (!bundle.isDirectory() || !bundle.name.endsWith('.app')) continue
      const contents = join(stagedDir, bundle.name, 'Contents')
      if (await bundleVersion(join(contents, 'Info.plist')) !== version) continue
      candidates.push({ resources: join(contents, 'Resources'), modified: (await stat(stagedDir)).mtimeMs })
    }
  }
  const newest = candidates.sort((left, right) => right.modified - left.modified)[0]
  if (newest === undefined) throw new Error(`desktop update: Squirrel staged no bundle for ${version}`)
  return {
    seed: join(newest.resources, 'seed'),
    node: join(newest.resources, 'runtime', 'node', 'node'),
    pnpm: join(newest.resources, 'runtime', 'pnpm', 'bin', 'pnpm.mjs'),
  }
}

/**
 * The version a bundle's `Info.plist` declares, read through `plutil`, which
 * reads both the XML and the binary plist format.
 */
async function bundleVersion(infoPlist: string): Promise<string> {
  const { stdout } = await execFileAsync('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', infoPlist])
  return stdout.trim()
}
