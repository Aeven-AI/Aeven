/**
 * The Windows command seam and PowerShell resolution.
 *
 * Resolution deliberately mirrors `@aeven/pwsh-local`'s candidate order rather
 * than importing it: that package is a Cordis shell executor with five peer
 * dependencies, and this adapter stays framework-free so its tests need no
 * runtime. The order is the same — PowerShell 7, then PATH, then Windows
 * PowerShell 5.1 — so a host that has one is never told it has none.
 *
 * @module @aeven/computer-use-windows/runner
 */

import { accessSync, constants } from 'node:fs'
import { join } from 'node:path'

/** One completed command. */
export interface WinCommandResult {
  /** Process exit code; `null` when killed by a signal. */
  code: number | null
  stdout: string
  stderr: string
}

/** The command runner the adapter depends on. */
export interface WinCommandRunner {
  /**
   * Run one command and capture its streams.
   * @param command - executable name or absolute path.
   * @param args - arguments, passed without shell interpretation.
   * @param signal - caller lifetime; aborting terminates the process.
   * @returns the captured result. A non-zero exit resolves rather than rejects,
   * so a caller can branch on the PowerShell exit code.
   */
  run(command: string, args: readonly string[], signal?: AbortSignal): Promise<WinCommandResult>
}

/**
 * Candidate PowerShell executables, newest first.
 *
 * Parameters come from the environment rather than the constants so resolution
 * is a pure function of its inputs and therefore testable off Windows.
 * @param env - environment to probe; defaults to the process environment.
 * @returns candidate executable paths, in resolution order.
 */
export function candidatePowerShellPaths(env: NodeJS.ProcessEnv = process.env): string[] {
  const programFiles = env.ProgramFiles ?? 'C:\\Program Files'
  const systemRoot = env.SystemRoot ?? 'C:\\Windows'
  const candidates = [join(programFiles, 'PowerShell', '7', 'pwsh.exe')]
  for (const entry of (env.PATH ?? '').split(';')) {
    const trimmed = entry.trim().replace(/^"|"$/g, '')
    if (trimmed.length > 0) {
      candidates.push(join(trimmed, 'pwsh.exe'))
    }
  }
  candidates.push(join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'))
  return candidates
}

/**
 * Whether a candidate executable exists.
 * @param path - absolute path to probe.
 * @returns true when the path is executable.
 */
function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Resolve the PowerShell to use.
 *
 * Windows PowerShell 5.1 is a legitimate last resort: it ships with Windows and
 * carries the same .NET UI Automation assemblies this adapter needs.
 * @param env - environment to probe; defaults to the process environment.
 * @returns the first executable candidate.
 * @throws {Error} when no candidate exists, naming every path that was tried —
 * a bare "pwsh not found" is not actionable on a host with a custom install.
 */
export function resolvePowerShellPath(env: NodeJS.ProcessEnv = process.env): string {
  const candidates = candidatePowerShellPaths(env)
  const found = candidates.find(isExecutable)
  if (found === undefined) {
    throw new Error(`no PowerShell executable found; tried:\n${candidates.join('\n')}`)
  }
  return found
}

/**
 * Quote one value for the PowerShell single-quoted literal form.
 * @param value - the raw string.
 * @returns the escaped literal contents.
 */
export function quotePowerShellLiteral(value: string): string {
  return value.replace(/'/g, "''")
}
