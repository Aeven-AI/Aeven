/** What the hand-off dialog shows: whether it is open, why, and for which conversation. */
import { createSnapshotStore, type SnapshotStore } from '@aeven/client-store'

/**
 * Why the reader needs the desktop app: a sidebar pane, a conversation whose folder is on their computer, or a request
 * the model offered the desktop app for (`computer`, `models`, and the panes' own reasons).
 */
export type HandoffReason = 'files' | 'browser' | 'terminal' | 'device' | 'folder' | 'computer' | 'models'

/** The dialog's state. */
export interface HandoffState {
  readonly open: boolean
  readonly reason: HandoffReason
  /** The conversation to continue in the desktop app, when one is current. */
  readonly sessionId?: string
}

/** The dialog's state and its two transitions. */
export interface HandoffStore {
  readonly state: SnapshotStore<HandoffState>
  show: (reason: HandoffReason, sessionId?: string) => void
  hide: () => void
}

/**
 * Create the dialog's store, closed until a surface asks for it.
 * @returns a closed dialog store.
 */
export function createHandoffStore(): HandoffStore {
  const state = createSnapshotStore<HandoffState>({ open: false, reason: 'files' })
  return {
    state,
    show: (reason, sessionId) => { state.set({ open: true, reason, ...sessionId === undefined ? {} : { sessionId } }) },
    hide: () => { state.set({ ...state.getSnapshot(), open: false }) },
  }
}
