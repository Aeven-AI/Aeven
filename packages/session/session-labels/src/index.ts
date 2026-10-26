/**
 * Function plugin registering the `sessionLabels` projection unit: the
 * bookmarks a user set on a session's log, served through the
 * session-projection seam so a client can list them and jump to their points
 * without paging the whole log. The plugin owns only the fold; delivery is the
 * seam's.
 * @module @aeven/session-labels
 */

import type { Context } from '@deepseek-ai/cordis'
import { sessionLabelsProjectionDefinition } from './projection.ts'

export type * from './types.ts'
export { sessionLabelsProjectionDefinition } from './projection.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'session-labels'
/** The projection registry is the plugin's whole purpose; without it the fiber stays pending. */
export const inject = ['sessionProjections']

declare module '@aeven/session/types' {
  interface SessionEventMap {
    /**
     * A bookmark on one logged point of this session: sets the label at `at`, or
     * removes it when `label` is empty. The event points at an earlier `seq` and
     * changes nothing model-visible, so a warm, a review, or a transcript sees
     * the same conversation with or without it.
     */
    'session/label': import('./types.ts').SessionLabelEventData
  }
}

/**
 * Register the `sessionLabels` unit; the registration is an effect on this
 * plugin's fiber, so unloading removes the key.
 * @param ctx - registrant context carrying the projection registry.
 */
export function apply(ctx: Context): void {
  ctx.sessionProjections.register(sessionLabelsProjectionDefinition)
}
