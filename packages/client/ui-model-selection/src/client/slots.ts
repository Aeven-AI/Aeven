/**
 * ModelSelect's injected face. The target 'conversation.input.model' seat is
 * declared (children table) and typed by ui-conversation's composer-bar
 * entry; this package only contributes the single occupant, so no SlotMap
 * merge lives here.
 *
 * The seat owns the Model/Effort chooser and nothing below it: each row hands
 * over to the shared popupSelect shell, so no list, filtering, or failure
 * surface belongs to this face.
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
   */
  openModel: () => void
  /**
   * Open this session's reasoning-effort list in that same shell — the current
   * model's adapter-advertised levels. No-op when the seat is unavailable.
   */
  openEffort: () => void
}
