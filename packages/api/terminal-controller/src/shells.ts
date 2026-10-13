/** Shell selection and executable verification use the target execution provider. */
import type { SubprocessRuntime } from '@aeven/subprocess'
import type { TerminalShell } from './types.ts'

/**
 * Resolve the configured shell, or the first installed default candidate.
 * @param subprocess - target execution provider.
 * @param configured - optional profile overriding the default candidates.
 * @param signal - resolution cancellation.
 * @returns one verified shell; a configured shell that cannot resolve rejects.
 */
export async function resolveShell(
  subprocess: SubprocessRuntime, configured: TerminalShell | undefined, signal: AbortSignal,
): Promise<TerminalShell> {
  if (configured !== undefined) {
    return { ...configured, path: await subprocess.resolveExecutable(configured.path, undefined, signal) }
  }
  for (const candidate of defaultCandidates()) {
    const shell = await installed(subprocess, profile(candidate), signal)
    if (shell !== undefined) return shell
  }
  throw new Error('No shell is available in this execution environment')
}

/**
 * The default-shell candidates, most preferred first: the serving user's
 * `$SHELL`, then the common POSIX shells, or the Windows shells.
 * @returns executable paths or PATH names.
 */
function defaultCandidates(): string[] {
  if (process.platform === 'win32') return ['cmd.exe', 'powershell.exe', 'pwsh.exe']
  const login = process.env.SHELL
  return [...login === undefined || login === '' ? [] : [login], '/bin/zsh', '/bin/bash', '/bin/sh']
}

/**
 * Resolve one shell profile's executable.
 * @param subprocess - target execution provider.
 * @param shell - profile to verify.
 * @param signal - resolution cancellation; an abort rejects instead of reporting a miss.
 * @returns the verified profile, or undefined when the executable is not installed.
 */
async function installed(
  subprocess: SubprocessRuntime, shell: TerminalShell, signal: AbortSignal,
): Promise<TerminalShell | undefined> {
  try {
    return { ...shell, path: await subprocess.resolveExecutable(shell.path, undefined, signal) }
  } catch (_notInstalled) {
    // Providers report a missing executable as a plain error; only an abort propagates.
    signal.throwIfAborted()
    return undefined
  }
}

function profile(path: string): TerminalShell {
  const file = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  // A shell is labelled by its name; the `.exe` suffix is a Windows filename
  // detail, not part of what a person chooses between.
  const name = file.replace(/\.exe$/iu, '')
  const kind = name.toLowerCase()
  return { path, name, args: kind === 'cmd' ? [] : kind === 'pwsh' || kind === 'powershell' ? ['-NoLogo'] : ['-i'] }
}

/**
 * List verified candidates after the configured or environment-default shell.
 * @param subprocess - target execution provider.
 * @param configured - optional default profile.
 * @param candidates - executable names or paths permitted for shell selection.
 * @param signal - discovery cancellation.
 * @returns unique installed shells, with the default first; transport failures reject.
 */
export async function discoverShells(
  subprocess: SubprocessRuntime, configured: TerminalShell | undefined,
  candidates: readonly string[], signal: AbortSignal,
): Promise<TerminalShell[]> {
  const preferred = await resolveShell(subprocess, configured, signal)
  const found = await Promise.all(candidates.map(candidate => installed(subprocess, profile(candidate), signal)))
  const shells = new Map<string, TerminalShell>()
  for (const shell of [preferred, ...found]) {
    if (shell === undefined) continue
    const key = shell.path.includes('\\') ? shell.path.toLowerCase() : shell.path
    if (!shells.has(key)) shells.set(key, shell)
  }
  return [...shells.values()]
}
