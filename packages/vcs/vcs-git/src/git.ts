/**
 * Git process invocation for the provider: one bounded, cancelable spawn per
 * command, with the collected output kept as data instead of being parsed from a
 * terminal stream.
 *
 * Read-only commands run with repository hooks and fsmonitor disabled, so a
 * repository-configured program cannot change what a status or diff reports.
 * Commands that record history or move the checkout run unmodified, because
 * there the user's hooks are the repository's own policy.
 * @module @aeven/vcs-git/git
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@aeven/subprocess'
import { VcsError } from '@aeven/vcs'

/** Bounds every git call in this provider runs under. */
export interface GitLimits {
  /** Grace a git child gets between termination signals. */
  readonly graceMs: number
  /** Largest stdout tail retained for one command. */
  readonly stdoutMaxBytes: number
  /** Largest stderr tail retained for one command. */
  readonly stderrMaxBytes: number
}

/** The facts one finished git call leaves behind. */
export interface GitRunResult {
  /** Exit code, or null when a signal ended the process. */
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
  /** Stderr then stdout, trimmed, for one message. */
  readonly output: string
  /** True when the stdout tail lost its head at the configured bound. */
  readonly stdoutTruncated: boolean
}

/** Global options that keep a read-only command from running repository-configured programs. */
const READ_ONLY_FLAGS = ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false'] as const

/** Characters of command output kept in a failure message. */
const FAILURE_DETAIL_CHARS = 1200

/**
 * Run one git command.
 * @param ctx - the plugin context supplying `subprocess`.
 * @param args - arguments after `git`, such as `['status', '-z']`.
 * @param cwd - directory the command runs in.
 * @param signal - cancels the command.
 * @param limits - grace and output bounds.
 * @param readOnly - disable hooks and fsmonitor for a command that changes nothing.
 * @returns the collected result; a non-zero exit is data, not an error.
 */
export async function runGit(
  ctx: Context,
  args: readonly string[],
  cwd: string,
  signal: AbortSignal | undefined,
  limits: GitLimits,
  readOnly: boolean,
): Promise<GitRunResult> {
  const argv = readOnly ? ['git', ...READ_ONLY_FLAGS, ...args] : ['git', ...args]
  const child = ctx.subprocess.spawn({
    argv,
    cwd,
    ...(signal === undefined ? {} : { signal }),
    graceMs: limits.graceMs,
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: limits.stdoutMaxBytes },
      stderr: { maxBytes: limits.stderrMaxBytes },
    },
  })
  const outcome = await child.done
  const stdout = child.collected.stdout?.readFrom(0).text ?? ''
  const stderr = child.collected.stderr?.readFrom(0).text ?? ''
  return {
    exitCode: outcome.signal === null ? outcome.exitCode : null,
    stdout,
    stderr,
    output: `${stderr}${stdout}`.trim().slice(-FAILURE_DETAIL_CHARS),
    stdoutTruncated: child.collected.stdout?.readFrom(0).lossy === true,
  }
}

/**
 * Describe a failed command as a provider failure.
 * @param operation - the provider operation that failed.
 * @param args - the git arguments, for the message.
 * @param result - the finished call.
 * @returns the error to throw.
 */
export function commandFailure(operation: string, args: readonly string[], result: GitRunResult): VcsError {
  const status = result.exitCode === null ? 'was terminated' : `exited ${String(result.exitCode)}`
  return new VcsError(
    `git ${args.join(' ')} ${status} during ${operation}: ${result.output}`,
    'VCS_COMMAND_FAILED',
  )
}
