/** One Electron release stream for the version-bound shell and avn seed. */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import electronUpdater, { type AppUpdater } from 'electron-updater'

const { autoUpdater } = electronUpdater

/** Desktop release update state, carried to whatever asks the shell to act. */
export interface DesktopUpdateState {
  readonly phase: 'idle' | 'checking' | 'available' | 'installing' | 'ready' | 'error'
  readonly version?: string
  readonly message?: string
}

/**
 * Checks, downloads, and installs one complete Desktop release.
 *
 * A found release downloads while the reader keeps working, and a downloaded
 * release installs when the application quits. The shell asks before it
 * restarts, so the install itself never interrupts a running turn.
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
   * @param updater - Electron artifact updater; replaceable for tests.
   * @param enabled - whether this packaged process carries updater configuration.
   */
  constructor(
    private readonly publish: (state: DesktopUpdateState) => DesktopUpdateState,
    private readonly beforeRestart: () => Promise<void> = async () => {},
    private readonly updater: AppUpdater = autoUpdater,
    private readonly enabled: () => boolean = () => (
      app.isPackaged && existsSync(join(process.resourcesPath, 'app-update.yml'))
    ),
  ) {
    // The download starts as soon as a check finds a release, and a downloaded
    // release installs on quit; `checkForUpdates` starts that download itself
    // and reports it as `downloadPromise`.
    this.updater.autoDownload = true
    this.updater.autoInstallOnAppQuit = true
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
      this.availableVersion = version
      if (version === undefined) return this.publish({ phase: 'idle' })
      const available = this.publish({ phase: 'available', version })
      const download = result?.downloadPromise
      if (download === undefined || download === null) return available
      this.downloadOperation = download
      await download
      // A newer check owns the stream now; its own download reports the state.
      if (this.availableVersion !== version) return available
      this.downloadedVersion = version
      return this.publish({ phase: 'ready', version })
    } catch (error) {
      this.availableVersion = undefined
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
}
