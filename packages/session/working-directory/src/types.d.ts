/**
 * Pure types of the working-directory domain: the `session/cwd` event the
 * session log records, and the `workingDirectory` projection that replays it.
 *
 * @module @aeven/working-directory/types
 */
declare module '@aeven/session/types' {
    interface SessionEventMap {
        /**
         * The absolute directory every later tool resolves paths against, from
         * this point on: log-only, non-surface, whole-value replace. The last
         * `session/cwd` wins; a log with none keeps the session header's `cwd`.
         * An event carrying `root` also moves the session's workspace — the
         * directory `workspace-write` confines writes to — and the last `root`
         * wins independently of later `cwd`-only events.
         * @param cwd - absolute directory that must exist when the event is appended.
         * @param root - absolute workspace root the session moved into, e.g. a git worktree checkout.
         */
        'session/cwd': {
            cwd: string;
            root?: string;
        };
    }
}
/**
 * The `workingDirectory` projection's wire value.
 *
 * `cwd` and `root` are the directory and workspace root in force after the
 * folded log, or `null` while the session header's `cwd` is in force for
 * them. Capability absence (this package not composed) is the key's absence,
 * never a value.
 */
export interface WorkingDirectoryProjection {
    cwd: string | null;
    root: string | null;
}
/** Host state used to derive {@link WorkingDirectoryProjection}. */
export interface WorkingDirectoryUnitState {
    /** The last logged directory, or null while the header's `cwd` is in force. */
    cwd: string | null;
    /** The last logged workspace root, or null while the header's `cwd` is the workspace. */
    root: string | null;
}
declare module '@aeven/session-projection/types' {
    interface SessionProjectionStateMap {
        /** Host working-directory fold state. */
        workingDirectory: WorkingDirectoryUnitState;
    }
    interface SessionProjectionMap {
        /** Working directory and workspace root folded from `session/cwd` events. */
        workingDirectory: WorkingDirectoryProjection;
    }
}
//# sourceMappingURL=types.d.ts.map