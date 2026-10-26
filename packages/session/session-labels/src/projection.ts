/**
 * The `sessionLabels` projection unit: the session's bookmarks as the log
 * recorded them, oldest first. A later `session/label` at the same `seq`
 * replaces the earlier one, and an empty label removes it, so replay order
 * alone decides the result and no cross-event state is kept.
 * @module @aeven/session-labels/src/projection
 */

import { z } from 'zod'
import type { ZodType } from 'zod'
import { SessionSeq } from '@aeven/session'
import type { ProjectionDefinition } from '@aeven/session-projection'
import type { SessionLabel, SessionLabelRow, SessionLabelsState } from './types.ts'

const labelRowSchema = z.object({
  at: z.number().int().nonnegative().transform(SessionSeq),
  label: z.string().min(1),
}).strict()

const sessionLabelsStateSchema: ZodType<SessionLabelsState> = z.object({
  labels: z.array(labelRowSchema),
})

const sessionLabelsViewSchema: ZodType<readonly SessionLabel[]> = z.array(labelRowSchema)

/** Insert one bookmark row, keeping the rows ordered by `seq`. */
function withLabel(rows: readonly SessionLabelRow[], row: SessionLabelRow): readonly SessionLabelRow[] {
  const kept = rows.filter(existing => existing.at !== row.at)
  const at = kept.findIndex(existing => existing.at > row.at)
  return at === -1 ? [...kept, row] : [...kept.slice(0, at), row, ...kept.slice(at)]
}

/** The `sessionLabels` unit registered on `ctx.sessionProjections` (exported for the unit spec). */
export const sessionLabelsProjectionDefinition = {
  key: 'sessionLabels',
  stateVersion: 1,
  stateSchema: sessionLabelsStateSchema,
  init: () => ({ labels: [] }),
  apply: (state, event) => {
    if (event.type !== 'session/label') return state
    const { at, label } = event.data
    if (label === '') {
      const remaining = state.labels.filter(existing => existing.at !== at)
      return remaining.length === state.labels.length ? state : { labels: remaining }
    }
    return { labels: withLabel(state.labels, { at, label }) }
  },
  wire: { viewSchema: sessionLabelsViewSchema, view: (state: SessionLabelsState) => state.labels },
} satisfies ProjectionDefinition<'sessionLabels', SessionLabelsState>
