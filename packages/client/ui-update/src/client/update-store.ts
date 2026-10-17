/** The update popup's own state: the shell's last release-stream state, and whether the popup shows. */

import { createSnapshotStore } from '@aeven/client-store'
import type { DesktopUpdateStatus } from './update-carrier.ts'

/**
 * What the popup renders: the state the shell published and the reader's open
 * request. Both belong to this page — the release stream itself stays in the
 * shell — so the entry's store is their only home.
 */
export interface UpdateSurfaceState {
  /** Whether the reader is looking at the popup. */
  readonly open: boolean
  /** Last state the shell published. */
  readonly status: DesktopUpdateStatus
}

/**
 * Create the popup's store.
 * @returns the bare observable the renderer binds as the component's hook, with the writes its plugin makes.
 */
export function createUpdateStore() {
  const state = createSnapshotStore<UpdateSurfaceState>({ open: false, status: { phase: 'idle' } })
  return {
    /** Bare observable; `update` is its snapshot type. */
    state,
    /** Show the popup. */
    show: (): void => { state.set({ ...state.getSnapshot(), open: true }) },
    /** Dismiss the popup without answering the restart question. */
    hide: (): void => { state.set({ ...state.getSnapshot(), open: false }) },
    /**
     * Record one state the shell published.
     * @param status - the state the shell reported.
     */
    publish: (status: DesktopUpdateStatus): void => { state.set({ ...state.getSnapshot(), status }) },
  }
}
