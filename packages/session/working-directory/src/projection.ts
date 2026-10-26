/**
 * The `workingDirectory` projection unit: the session's effective working
 * directory and workspace root as the log recorded them, last `session/cwd`
 * winning for the directory and last `session/cwd` carrying `root` winning for
 * the workspace.
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

const unitStateSchema: ZodType<WorkingDirectoryUnitState> = z.object({
  cwd: z.string().min(1).nullable(),
  root: z.string().min(1).nullable(),
})

const projectionSchema: ZodType<WorkingDirectoryProjection> = z.object({
  cwd: z.string().min(1).nullable(),
  root: z.string().min(1).nullable(),
})

/** The `workingDirectory` unit registered on `ctx.sessionProjections`. */
export const workingDirectoryProjectionDefinition = {
  key: 'workingDirectory',
  stateVersion: 2,
  stateSchema: unitStateSchema,
  init: () => ({ cwd: null, root: null }),
  apply: (state, event) => {
    if (event.type !== 'session/cwd') return state
    const { cwd, root = state.root } = event.data
    return cwd === state.cwd && root === state.root ? state : { cwd, root }
  },
  wire: {
    viewSchema: projectionSchema,
    view: (state: WorkingDirectoryUnitState) => ({ cwd: state.cwd, root: state.root }),
  },
} satisfies ProjectionDefinition<'workingDirectory', WorkingDirectoryUnitState>
