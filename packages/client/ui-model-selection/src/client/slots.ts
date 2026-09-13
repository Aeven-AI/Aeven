/**
 * ModelSelect's injected face. The target 'conversation.input.model' seat is
 * declared (children table) and typed by ui-conversation's composer-bar
 * entry; this package only contributes the single occupant, so no SlotMap
 * merge lives here.
 *
 * The seat owns the Model/Effort chooser: the Model row hands over to the
 * shared popupSelect shell, and the Effort row is the seat's own pane — so this
 * face carries the opener for the first and the submit verb for the second.
 */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ModelDirectoryState } from './directory.ts'

/** Injected business face of the composer model seat. */
export interface ModelSelectInjected {
  /** Whether this session supports Agent-bound model inspection and selection. */
  available: boolean
  /** The session's shared directory store (same instance the /model popup reads) — the chooser's label source. */
  directory: SnapshotStore<ModelDirectoryState>
  /** Refresh the shared directory so the chooser's values are current when it opens. */
  load: () => void
  /**
   * Open this session's model list in the shared popupSelect shell: the same
   * controller, spec, rows, and search the `/model` command opens. Nothing in
   * the draft is consumed when a selection settles. No-op when the seat is
   * unavailable.
   * @param anchor - the trigger the card should line up with (the shell's card
   * is otherwise anchored to the composer card's own edge).
   */
  openModel: (anchor: Element | null) => void
  /**
   * Submit one of the current model's advertised effort levels, keeping the
   * route: the level is resolved against the live snapshot, so a level the
   * adapter no longer serves is refused instead of submitted stale.
   * @param levelId - the picked level's row key (`effort.ts` owns the set).
   * @returns whether the host accepted the selection; the refusal's text is on
   * the shared directory store, and the seat surfaces it.
   */
  selectEffort: (levelId: string) => Promise<boolean>
}
