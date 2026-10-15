/**
 * The PATH the user's tools are on. An application started from the macOS
 * Finder or Dock, or a Linux desktop launcher, inherits the session's minimal
 * PATH (`/usr/bin:/bin:/usr/sbin:/sbin` on macOS) rather than the one the
 * user's login shell builds, so the Host could not find `npm`, Homebrew, or
 * anything else the user installed: MCP servers started through `npm exec`
 * never came up, and every shell command lacked the user's tools.
 * @module @aeven/desktop/login-shell-path
 */

import { execFile } from 'node:child_process'

const MARKER = '__AVN_LOGIN_PATH__'

/**
 * Ask the user's login shell for its PATH.
 * @param env - environment the shell starts from; `SHELL` selects it.
 * @param timeoutMs - longest wait for the shell's startup files.
 * @returns the login shell's PATH, or undefined on Windows or when the shell fails or times out.
 */
export function loginShellPath(env: NodeJS.ProcessEnv, timeoutMs = 10_000): Promise<string | undefined> {
  if (process.platform === 'win32') return Promise.resolve(undefined)
  const shell = env.SHELL !== undefined && env.SHELL !== '' ? env.SHELL : process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh'
  return new Promise((resolve) => {
    // Interactive and login, so both profile and rc files run, as in the user's terminal. Startup
    // files may print; the markers delimit the value.
    execFile(shell, ['-ilc', `printf '%s%s%s' '${MARKER}' "$PATH" '${MARKER}'`], {
      env: { ...env, TERM: 'dumb' },
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
    }, (error, stdout) => {
      const match = new RegExp(`${MARKER}(.*?)${MARKER}`, 'su').exec(stdout)
      resolve(error === null && match?.[1] !== undefined && match[1] !== '' ? match[1] : undefined)
    })
  })
}

/**
 * Put the login shell's entries first and keep every inherited entry it lacks.
 * @param loginPath - PATH reported by the login shell.
 * @param inherited - PATH this process started with.
 * @param delimiter - platform PATH separator.
 * @returns the merged PATH without duplicate entries.
 */
export function mergePath(loginPath: string, inherited: string | undefined, delimiter: string): string {
  const entries = [...loginPath.split(delimiter), ...(inherited ?? '').split(delimiter)].filter(entry => entry !== '')
  return [...new Set(entries)].join(delimiter)
}
