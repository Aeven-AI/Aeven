/** One Electron release stream for the version-bound shell and avn seed. */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import electronUpdater, { type AppUpdater } from 'electron-updater'
import { lt, valid } from 'semver'
import type { DesktopUpdateState } from './ipc.ts'

const { autoUpdater } = electronUpdater

/**
 * Checks, downloads, and installs one complete Desktop release.
 *
 * A found release downloads while the reader keeps working, then `prepare`
 * readies it in the background — on macOS, Squirrel stages the new bundle and
 * the shell installs that bundle's profile — so the restart the reader answers
 * swaps applications instead of starting that work. The shell never restarts
 * on the reader's behalf.
 */
export class DesktopUpdateCoordinator {
  private availableVersion: string | undefined
  /** Version whose download finished, so an install needs no download of its own. */
  private downloadedVersion: string | undefined
  private checkOperation: Promise<DesktopUpdateState> | undefined
  private installOperation: Promise<DesktopUpdateState> | undefined
  private downloadOperation: Promise<unknown> | undefined

  /**
   * @param publish - state sink for the shell's own update surface.
   * @param beforeRestart - stop application-owned processes before replacement.
   * @param prepare - ready a downloaded release for its restart; a rejection
   * reports the update as failed.
   * @param updater - Electron artifact updater; replaceable for tests.
   * @param enabled - whether this packaged process carries updater configuration.
   */
  constructor(
    private readonly publish: (state: DesktopUpdateState) => DesktopUpdateState,
    private readonly beforeRestart: () => Promise<void> = async () => {},
    private readonly prepare: (version: string) => Promise<void> = async () => {},
    private readonly updater: AppUpdater = autoUpdater,
    private readonly enabled: () => boolean = () => (
      app.isPackaged && existsSync(join(process.resourcesPath, 'app-update.yml'))
    ),
  ) {
    // A found release downloads at once, so the offer is about installing what
    // is already on disk. The updater's own quit handler stays off: a restart is
    // the reader's decision. On macOS the bundle `prepare` has Squirrel stage
    // still installs when the application quits, which is Squirrel's behaviour.
    this.updater.autoDownload = true
    this.updater.autoInstallOnAppQuit = false
    // The download belongs to the updater, so its progress arrives as events
    // rather than from the promise a check awaits.
    this.updater.on('download-progress', (progress) => {
      const version = this.availableVersion
      if (version === undefined) return
      this.publish({ phase: 'downloading', version, percent: Math.round(progress.percent) })
    })
  }

  /**
   * Check the configured Desktop release stream, then wait for the release it
   * finds to download.
   * @returns `ready` once the release is downloaded and installable, `available`
   * while it downloads, `idle` when this process runs the newest release, and
   * `error` when the check or the download failed.
   */
  async check(): Promise<DesktopUpdateState> {
    if (this.installOperation !== undefined) return this.installOperation
    if (this.checkOperation !== undefined) return this.checkOperation
    this.checkOperation = this.doCheck().finally(() => { this.checkOperation = undefined })
    return this.checkOperation
  }

  /** Wait for an in-flight check, then install the release it retained. */
  async install(): Promise<DesktopUpdateState> {
    if (this.installOperation !== undefined) return this.installOperation
    this.installOperation = (async () => {
      await this.checkOperation
      return this.doInstall()
    })().finally(() => { this.installOperation = undefined })
    return this.installOperation
  }

  private async doCheck(): Promise<DesktopUpdateState> {
    this.publish({ phase: 'checking' })
    this.downloadedVersion = undefined
    try {
      if (!this.enabled()) {
        this.availableVersion = undefined
        return this.publish({ phase: 'idle' })
      }
      const result = await this.updater.checkForUpdates()
      const version = result?.isUpdateAvailable === true ? result.updateInfo.version : undefined
      // A release the running application already carries is not an update, so
      // a staged artefact for this version is never offered again.
      this.availableVersion = version !== undefined && this.isNewer(version) ? version : undefined
      if (this.availableVersion === undefined) return this.publish({ phase: 'idle' })
      const available = this.publish({ phase: 'available', version: this.availableVersion })
      const download = result?.downloadPromise
      if (download === undefined || download === null) return available
      this.downloadOperation = download
      await download
      // A newer check owns the stream now; its own download reports the state.
      if (this.availableVersion !== version) return available
      this.publish({ phase: 'preparing', version })
      await this.prepare(version)
      if (this.availableVersion !== version) return available
      this.downloadedVersion = version
      return this.publish({ phase: 'ready', version })
    } catch (error) {
      this.availableVersion = undefined
      // A release tag is pushed before its build uploads the update feed, so the newest
      // release can name a version whose feed file does not exist yet: nothing is installable.
      if (isUnpublishedRelease(error)) return this.publish({ phase: 'idle' })
      return this.publish({
        phase: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private async doInstall(): Promise<DesktopUpdateState> {
    const version = this.availableVersion
    if (version === undefined) {
      throw new Error('desktop update: no verified update is available')
    }
    this.publish({ phase: 'installing', version })
    try {
      if (this.downloadedVersion !== version) {
        await (this.downloadOperation ?? this.updater.downloadUpdate())
        await this.prepare(version)
        this.downloadedVersion = version
      }
      this.availableVersion = undefined
      const ready = this.publish({ phase: 'ready', version })
      await this.beforeRestart()
      this.updater.quitAndInstall(false, true)
      return ready
    } catch (error) {
      return this.publish({
        phase: 'error',
        version,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * Whether a release is newer than the application this process runs.
   * @param version - release version the update feed named.
   * @returns false for a version at or below the running one; true when the
   * updater exposes no running version to compare against.
   */
  private isNewer(version: string): boolean {
    const running = this.updater.currentVersion
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- assigned at the updater's first check
    if (running === undefined || running === null) return true
    return valid(version) !== null && lt(running, version)
  }
}

/**
 * Whether a check failed only because the newest release carries no update feed file yet.
 * @param error - what the updater's check threw.
 * @returns true for electron-updater's missing channel file error.
 */
function isUnpublishedRelease(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND'
}
