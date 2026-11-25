/**
 * The `workingDirectory` projection unit: the session's effective working
 * directory and workspace root as the log recorded them, last `session/cwd`
 * winning for the directory and last `session/cwd` carrying `root` winning for
 * the workspace, plus every root the log recorded.
 *
 * The unit folds only the log; the session header's `cwd` is the base a
 * consumer resolves against, so a projection with `cwd: null` means "the
 * header's directory is in force" rather than "no directory".
 *
 * @module @aeven/working-directory/projection
 */

import { z } from 'zod'
import type { ZodType } from 'zod'
import type { ProjectionDefinition } from '@aeven/session-projection'
import type {
  WorkingDirectoryProjection,
  WorkingDirectoryUnitState,
} from './types.ts'

// The state carries exactly the wire fields, so one schema validates both.
const unitStateSchema: ZodType<WorkingDirectoryUnitState & WorkingDirectoryProjection> = z.object({
  cwd: z.string().min(1).nullable(),
  root: z.string().min(1).nullable(),
  roots: z.array(z.string().min(1)).readonly(),
})

/** The `workingDirectory` unit registered on `ctx.sessionProjections`. */
export const workingDirectoryProjectionDefinition = {
  key: 'workingDirectory',
  stateVersion: 3,
  stateSchema: unitStateSchema,
  init: () => ({ cwd: null, root: null, roots: [] }),
  apply: (state, event) => {
    if (event.type !== 'session/cwd') return state
    const { cwd, root = state.root } = event.data
    const roots = root === null || state.roots.includes(root) ? state.roots : [...state.roots, root]
    return cwd === state.cwd && root === state.root && roots === state.roots ? state : { cwd, root, roots }
  },
  wire: {
    viewSchema: unitStateSchema,
    // The state carries exactly the wire fields, so it is its own view and an unchanged state publishes nothing.
    view: (state: WorkingDirectoryUnitState) => state,
  },
} satisfies ProjectionDefinition<'workingDirectory', WorkingDirectoryUnitState>
