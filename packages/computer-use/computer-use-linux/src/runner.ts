/**
 * The Linux command seam.
 *
 * Linux needs no bundled helper and no daemon of Æven's own: it already has the
 * compositor's control socket, the X11 tools, and the Wayland input tools. So the
 * adapter is a runner over those, with the same injected-runner shape the other
 * platforms use — which is what lets every branch and every failure mode be
 * covered without a Linux desktop.
 *
 * @module @aeven/computer-use-linux/runner
 */

/** One completed command. */
export interface LinuxCommandResult {
  /** Process exit code; `null` when killed by a signal. */
  code: number | null
  stdout: string
  stderr: string
}

/** The command runner the adapter depends on. */
export interface LinuxCommandRunner {
  /**
   * Run one command and capture its streams.
   * @param command - executable name or absolute path.
   * @param args - arguments, passed without shell interpretation.
   * @param signal - caller lifetime; aborting terminates the process.
   * @returns the captured result. A non-zero exit resolves rather than rejects,
   * because most of these tools report absence through their exit status.
   */
  run(command: string, args: readonly string[], signal?: AbortSignal): Promise<LinuxCommandResult>
}

/**
 * Whether a command exists on this host.
 *
 * Presence is probed by running it rather than by scanning `PATH`: the interesting
 * failure is not "not installed" but "installed and not usable here", and only
 * running it distinguishes those.
 * @param runner - the runner to probe with.
 * @param command - executable to look for.
 * @param versionArgs - arguments that make it print a version.
 * @param host - environment describing the session.
 * @returns true when the command answered.
 */
export async function commandAnswers(
  runner: LinuxCommandRunner,
  command: string,
  versionArgs: readonly string[],
  host: LinuxHost,
): Promise<boolean> {
  const result = await runner.run(command, versionArgs, host.signal)
  return result.code === 0
}

/** Facts about the session that decide which backends can work. */
export interface LinuxHost {
  /** Whether an X11 display is reachable (`DISPLAY` is set). */
  hasX11: boolean
  /** Whether a Wayland session is in use (`WAYLAND_DISPLAY` is set). */
  hasWayland: boolean
  /** The current desktop's identifier, e.g. `GNOME`, `KDE`, `Hyprland`. */
  desktop?: string
  /** Caller lifetime. */
  signal?: AbortSignal
}

/**
 * Derive the session facts from an environment.
 * @param env - environment to read; defaults to the process environment.
 * @returns the facts that decide backend selection.
 */
export function describeLinuxHost(env: NodeJS.ProcessEnv = process.env): LinuxHost {
  const desktop = env.XDG_CURRENT_DESKTOP ?? env.DESKTOP_SESSION
  const host: LinuxHost = {
    hasX11: (env.DISPLAY ?? '').length > 0,
    hasWayland: (env.WAYLAND_DISPLAY ?? '').length > 0,
  }
  if (desktop !== undefined && desktop.length > 0) {
    host.desktop = desktop
  }
  return host
}
