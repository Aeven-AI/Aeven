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
         * @param cwd - absolute directory that must exist when the event is appended.
         */
    'session/cwd': {
      cwd: string
    }
  }
}
/**
 * The `workingDirectory` projection's wire value.
 *
 * `cwd` is the directory in force after the folded log, or `null` when the
 * session header carries none and no event overrides it. Capability absence
 * (this package not composed) is the key's absence, never a value.
 */
export interface WorkingDirectoryProjection {
  cwd: string | null
}
/** Host state used to derive {@link WorkingDirectoryProjection}. */
export interface WorkingDirectoryUnitState {
  /** The last logged override, or null while the header's `cwd` is in force. */
  cwd: string | null
}
declare module '@aeven/session-projection/types' {
  interface SessionProjectionStateMap {
    /** Host working-directory fold state. */
    workingDirectory: WorkingDirectoryUnitState
  }
  interface SessionProjectionMap {
    /** Working directory folded from `session/cwd` events. */
    workingDirectory: WorkingDirectoryProjection
  }
}
//# sourceMappingURL=types.d.ts.map
