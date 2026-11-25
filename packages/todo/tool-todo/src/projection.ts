/**
 * The client-visible `todos` projection unit, and the Host-plane plugin that registers it on its own.
 *
 * The projection table is process-wide, while `todo_write` is mounted per agent from a preset. A Host that only
 * holds a synced copy of a Session (Aeven Web following a conversation that runs on a desktop, or a desktop
 * following one that runs elsewhere) has no agent for it, so a key registered only by the preset row exists there
 * only while some other agent happens to be mounted. Mounting this plugin on the Host plane keeps `todos` registered
 * for every Session that Host lists or follows. Registrations of the same key share one unit, so the preset row and
 * this plugin coexist.
 *
 * @module @aeven/tool-todo/projection
 */

import type { Context } from '@deepseek-ai/cordis'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import type { ProjectionDefinition } from '@aeven/session-projection'
// Type-only: resolves the required ctx.sessionProjections service declaration.
import type {} from '@aeven/session-projection'
import type { TodoItem } from './types.ts'

export type * from './types.ts'

export const name = 'tool-todo-projection'
export const inject = ['sessionProjections']

/** Wire payload schema of the `todos` projection (whole list or pre-first-write null). */
export const todosProjectionSchema: ZodType<TodoItem[] | null> = zod.union([
  zod.array(zod.object({
    content: zod.string(),
    status: zod.union([zod.literal('pending'), zod.literal('in_progress'), zod.literal('completed')]),
  })),
  zod.null(),
])

/**
 * Standing-plan fold for the UI: the session's latest whole `todo/write` list, replaced only by the next write, and
 * null before the first write. Every other event returns the same state reference, so an unchanged plan pushes no
 * client frame.
 *
 * The plan's lifetime is the session's, not the turn's: an agent reads its own plan back from runtime context on
 * every step and has no reason to re-write a list that has not changed, so clearing the dock at a turn boundary
 * would show an empty dock while the model believes its plan is on screen.
 */
export const todosProjectionDefinition = {
  key: 'todos',
  stateSchema: todosProjectionSchema,
  init: () => null,
  apply: (state, event) => (event.type === 'todo/write' ? event.data.todos : state),
  wire: { viewSchema: todosProjectionSchema, view: state => state },
  stateVersion: 3,
} satisfies ProjectionDefinition<'todos', TodoItem[] | null>

/**
 * Register the `todos` unit on the Host plane.
 * @param ctx - context carrying the session-projection registry.
 */
export function apply(ctx: Context): void {
  ctx.sessionProjections.register(todosProjectionDefinition)
}
