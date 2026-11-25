/**
 * Function plugin registering the `turnOutline` and `turnDeliverables`
 * projection units: the whole-log turn outline (turn number, `turn/start`
 * seq, bounded prompt preview) and every turn's produced files, served through the session-projection seam — registry snapshot,
 * change feed, and every projection carrier — so a client can offer every
 * turn of a session and target history paging at exact seqs without holding
 * the events. The plugin owns only the fold; delivery is the seam's.
 *
 * @module @aeven/session-turn-outline
 */

import type { Context } from '@deepseek-ai/cordis'
import { turnDeliverablesProjectionDefinition } from './deliverables-projection.ts'
import { turnOutlineProjectionDefinition } from './projection.ts'

export type * from './types.ts'

/** Cordis plugin name. */
export const name = 'session-turn-outline'
/** The projection registry is the plugin's whole purpose; without it the fiber stays pending. */
export const inject = ['sessionProjections']

/**
 * Register the `turnOutline` and `turnDeliverables` units; each registration is an effect on this
 * plugin's fiber, so unloading removes both keys.
 * @param ctx - registrant context carrying the projection registry.
 */
export function apply(ctx: Context): void {
  ctx.sessionProjections.register(turnOutlineProjectionDefinition)
  ctx.sessionProjections.register(turnDeliverablesProjectionDefinition)
}
