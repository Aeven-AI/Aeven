/**
 * The macOS command seam. The adapter never reaches for `node:child_process`
 * directly: it calls a runner, so a test can drive every branch without a Mac
 * and so the permission story stays visible — every command runs as a **spawned
 * helper**, which on macOS means it carries its own grants rather than Æven's.
 *
 * @module @aeven/computer-use-macos/runner
 */

/** One completed command. */
export interface MacCommandResult {
  /** Process exit code; `null` when the process was killed by a signal. */
  code: number | null
  stdout: string
  stderr: string
}

/** The command runner the adapter depends on. */
export interface MacCommandRunner {
  /**
   * Run one command and capture its streams.
   * @param command - executable name or absolute path.
   * @param args - arguments, passed without shell interpretation.
   * @param signal - caller lifetime; aborting terminates the process.
   * @returns the captured result. A non-zero exit resolves rather than rejects,
   * because callers must branch on exit codes such as `osascript`'s error codes.
   */
  run(command: string, args: readonly string[], signal?: AbortSignal): Promise<MacCommandResult>
}
