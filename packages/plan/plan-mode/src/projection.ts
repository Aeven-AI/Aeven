/**
 * The client-visible `plan` projection unit, and the Host-plane plugin that registers it on its own.
 *
 * The projection table is process-wide, while plan mode is mounted per agent from a preset. A Host that only holds a
 * synced copy of a Session (Aeven Web following a conversation that runs on a desktop, or a desktop following one that
 * runs elsewhere) has no agent for it, so a key registered only by the preset row exists there only while some other
 * agent happens to be mounted. Mounting this plugin on the Host plane keeps `plan` registered for every Session that
 * Host lists or follows. Registrations of the same key share one unit, so the preset row and this plugin coexist.
 *
 * @module @aeven/plan-mode/projection
 */

import type { Context } from '@deepseek-ai/cordis'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import type { CommandId } from '@aeven/commands/brand'
// Type-only: the `command/run` and `command/done` event declarations the fold reads.
import type {} from '@aeven/commands'
// Type-only: resolves the required ctx.sessionProjections service declaration.
import type {} from '@aeven/session-projection'
import type { ProjectionDefinition } from '@aeven/session-projection'
import type { PlanProjection, PlanUnitState } from './types.ts'

export type * from './types.ts'

declare module '@aeven/session/types' {
  interface SessionEventMap {
    /**
     * Whether plan mode is in force from this point on: log-only, non-surface,
     * whole-value replace. The last `plan/mode` wins; a log with none folds to
     * inactive through the projection unit's fold.
     */
    'plan/mode': { active: boolean }
  }
}

export const name = 'plan-mode-projection'
export const inject = ['sessionProjections']

const planUnitStateSchema: ZodType<PlanUnitState> = zod.object({
  active: zod.boolean(),
  wanted: zod.boolean().nullable(),
  running: zod.object({
    commandId: zod.string() as unknown as ZodType<CommandId>,
    wanted: zod.boolean(),
  }).strict().nullable(),
  activeAtLastHeader: zod.boolean().nullable(),
}).strict()

/** Wire payload schema of the `plan` projection. */
const planProjectionSchema: ZodType<PlanProjection> = zod.object({
  active: zod.boolean(),
  pending: zod.boolean(),
})

/** Projection of logged plan selections and committed mode. */
export const planProjectionDefinition = {
  key: 'plan',
  stateVersion: 3,
  stateSchema: planUnitStateSchema,
  init: () => ({ active: false, wanted: null, running: null, activeAtLastHeader: null }),
  apply: (state, event) => {
    if (event.type === 'command/run' && event.data.name === 'plan') {
      if (event.data.args === undefined) return state
      const wanted = event.data.args.trim() !== 'off'
      return { ...state, running: { commandId: event.data.commandId, wanted } }
    }
    if (event.type === 'command/done' && event.data.commandId === state.running?.commandId) {
      const wanted = event.data.kind === 'success' && state.running.wanted !== state.active
        ? state.running.wanted
        : null
      return { ...state, wanted, running: null }
    }
    if (event.type === 'plan/mode') {
      return { ...state, active: event.data.active, wanted: null }
    }
    if (event.type === 'request/header') {
      return { ...state, activeAtLastHeader: state.active }
    }
    return state
  },
  wire: {
    viewSchema: planProjectionSchema,
    view: (state) => {
      const wanted = state.running?.wanted ?? state.wanted
      return { active: state.active, pending: wanted !== null && wanted !== state.active }
    },
  },
} satisfies ProjectionDefinition<'plan', PlanUnitState>

/**
 * Register the `plan` unit on the Host plane.
 * @param ctx - context carrying the session-projection registry.
 */
export function apply(ctx: Context): void {
  ctx.sessionProjections.register(planProjectionDefinition)
}
