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
import { z } from 'zod';
import type { WorkingDirectoryProjection, WorkingDirectoryUnitState } from './types.ts';
/** The `workingDirectory` unit registered on `ctx.sessionProjections`. */
export declare const workingDirectoryProjectionDefinition: {
    key: "workingDirectory";
    stateVersion: number;
    stateSchema: z.ZodType<WorkingDirectoryUnitState, unknown, z.core.$ZodTypeInternals<WorkingDirectoryUnitState, unknown>>;
    init: () => {
        cwd: null;
        root: null;
    };
    apply: (state: NoInfer<WorkingDirectoryUnitState>, event: import("@aeven/session").SessionEvent) => WorkingDirectoryUnitState;
    wire: {
        viewSchema: z.ZodType<WorkingDirectoryProjection, unknown, z.core.$ZodTypeInternals<WorkingDirectoryProjection, unknown>>;
        view: (state: WorkingDirectoryUnitState) => {
            cwd: string | null;
            root: string | null;
        };
    };
};
//# sourceMappingURL=projection.d.ts.map