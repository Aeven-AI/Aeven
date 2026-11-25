/**
 * The update a launch that failed to start still offers. The page that normally shows update state is
 * served by the Host, so a launch whose Host never came up drives the release stream from the shell
 * itself: one check, a status line on the failure window, and a native question once a release is
 * downloaded.
 */

import type { DesktopUpdateState } from './ipc.ts'
import { formatDesktopMessage, type DesktopMessages } from './locale.ts'

/** The copy this flow reads. */
export type FailedStartUpdateMessages = Pick<
  DesktopMessages,
  | 'startupFailedUpdateChecking'
  | 'startupFailedUpdateDownloading'
  | 'startupFailedUpdateCurrent'
  | 'startupFailedUpdateError'
  | 'startupFailedUpdateReady'
>

/**
 * The status line for one update state on the failure window.
 * @param state - state the update coordinator published.
 * @param messages - localized copy.
 * @returns the line to show.
 */
export function failedStartUpdateStatus(state: DesktopUpdateState, messages: FailedStartUpdateMessages): string {
  switch (state.phase) {
    case 'checking': return messages.startupFailedUpdateChecking
    case 'idle': return messages.startupFailedUpdateCurrent
    case 'available':
    case 'downloading':
    case 'preparing':
      return formatDesktopMessage(messages.startupFailedUpdateDownloading, {
        version: state.version,
        percent: String(state.percent ?? 0),
      })
    case 'ready':
    case 'installing':
      return formatDesktopMessage(messages.startupFailedUpdateReady, { version: state.version })
    case 'error': return formatDesktopMessage(messages.startupFailedUpdateError, { message: state.message ?? '' })
  }
}

/** What {@link updateAfterFailedStart} drives. */
export interface FailedStartUpdateInput {
  /** The release stream: `check` resolves once a found release is downloaded and prepared. */
  readonly updates: {
    check(): Promise<DesktopUpdateState>
    install(): Promise<DesktopUpdateState>
  }
  /**
   * Ask whether to restart into a downloaded release.
   * @param version - the downloaded release.
   * @returns true when the reader chose to restart now.
   */
  confirmRestart(version: string): Promise<boolean>
}

/**
 * Check the release stream once and install a downloaded release when the reader agrees. A reader who
 * declines keeps the failure window; the release stays downloaded for the next launch's check.
 * @param input - the release stream and the restart question.
 * @returns the state the flow ended in.
 */
export async function updateAfterFailedStart(input: FailedStartUpdateInput): Promise<DesktopUpdateState> {
  const state = await input.updates.check()
  if (state.phase !== 'ready') return state
  if (!await input.confirmRestart(state.version)) return state
  return input.updates.install()
}
