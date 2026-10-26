/**
 * The `workingDirectory` projection unit: the session's effective working
 * directory as the log recorded it, last `session/cwd` winning.
 *
 * The unit folds only the log; the session header's `cwd` is the base a
 * consumer resolves against, so a projection with `cwd: null` means "the
 * header's directory is in force" rather than "no directory".
 *
 * @module @aeven/working-directory/projection
 */
import { z } from 'zod';
const unitStateSchema = z.object({
    cwd: z.string().min(1).nullable(),
});
const projectionSchema = z.object({
    cwd: z.string().min(1).nullable(),
});
/** The `workingDirectory` unit registered on `ctx.sessionProjections`. */
export const workingDirectoryProjectionDefinition = {
    key: 'workingDirectory',
    stateVersion: 1,
    stateSchema: unitStateSchema,
    init: () => ({ cwd: null }),
    apply: (state, event) => {
        if (event.type !== 'session/cwd')
            return state;
        const { cwd } = event.data;
        return cwd === state.cwd ? state : { cwd };
    },
    wire: {
        viewSchema: projectionSchema,
        view: (state) => ({ cwd: state.cwd }),
    },
};
//# sourceMappingURL=projection.js.map