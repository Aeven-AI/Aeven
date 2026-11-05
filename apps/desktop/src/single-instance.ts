/** Electron single-instance ownership before any Desktop profile lifecycle begins. */

/** Minimal Electron application operations needed for instance ownership. */
export interface DesktopSingleInstanceApplication {
  requestSingleInstanceLock(): boolean
  quit(): void
  on(event: 'second-instance', listener: (event: unknown, argv: string[]) => void): unknown
}

/**
 * Claim the process-lifetime Desktop lock and route later launches to the owner.
 * @param application - Electron application singleton.
 * @param focusOwner - focus or recreate the primary window after a later launch.
 * @returns true only in the process that may access the Desktop profile.
 */
export function claimDesktopSingleInstance(
  application: DesktopSingleInstanceApplication,
  focusOwner: (argv: readonly string[]) => void,
): boolean {
  if (!application.requestSingleInstanceLock()) {
    application.quit()
    return false
  }
  application.on('second-instance', (_event, argv) => { focusOwner(argv) })
  return true
}
