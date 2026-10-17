/**
 * Whether one Desktop update state calls for the shell's update popup.
 *
 * The reader-facing surface is the page's own popup, which renders whatever
 * state the shell publishes. An automatic check stays silent until a release is
 * downloaded, so a background download never interrupts work; a check the
 * reader asked for from the application menu always opens the popup.
 * @module @aeven/desktop/update-prompt
 */

import type { DesktopUpdateState } from './ipc.ts'

/** The surface one update state calls for, or nothing at all. */
export type DesktopUpdatePrompt = 'silent' | 'error' | 'current' | 'downloading' | 'ready'

/** What the shell knows when it decides to open the popup. */
export interface DesktopUpdatePromptOptions {
  /** Whether the reader asked through the application menu, which always opens the popup. */
  readonly manual: boolean
  /** Version already offered, so one release is never offered twice unasked. */
  readonly promptedVersion: string | undefined
}

/**
 * Decide what to show for one update state.
 * @param state - the coordinator's state for the last check or install.
 * @param options - whether the reader asked, and which version was already offered.
 * @returns the surface to show; `silent` for a state the reader did not ask about.
 */
export function desktopUpdatePrompt(
  state: DesktopUpdateState,
  options: DesktopUpdatePromptOptions,
): DesktopUpdatePrompt {
  switch (state.phase) {
    case 'error':
      return options.manual ? 'error' : 'silent'
    case 'idle':
      // Nothing to install: only a check the reader asked for reports this.
      return options.manual ? 'current' : 'silent'
    case 'available':
      return options.manual ? 'downloading' : 'silent'
    case 'downloading':
      // The popup a reader opened follows the download through its own states.
      return 'silent'
    case 'ready':
      // A downloaded release installs on quit, so offering it once is enough.
      return options.manual || options.promptedVersion !== state.version ? 'ready' : 'silent'
    case 'checking':
    case 'installing':
      return 'silent'
  }
}
