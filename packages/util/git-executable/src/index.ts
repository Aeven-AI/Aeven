/**
 * This device's Git executable: the one on `PATH`, except the macOS command-line stub, or the first of each
 * platform's standard install locations, which a GUI app's short `PATH` and a just-finished install both miss.
 * @module @aeven/git-executable
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** The macOS command-line stub that opens Apple's install dialog when the developer tools are absent. */
const MACOS_GIT_STUB = '/usr/bin/git'

/**
 * Find this device's Git.
 * @param onPath - resolves `git` on `PATH`, or undefined when it is not there.
 * @returns the executable path, or undefined when this device has no Git.
 */
export async function findGit(onPath: () => Promise<string | undefined>): Promise<string | undefined> {
  const found = await onPath()
  // The stub on `PATH` opens an install dialog instead of running Git when the developer tools are absent.
  if (found !== undefined && (process.platform !== 'darwin' || found !== MACOS_GIT_STUB)) return found
  return gitStandardLocations().find(path => existsSync(path))
}

/**
 * Where each platform's Git installers put the executable.
 * @returns the candidate paths in the order they are tried.
 */
export function gitStandardLocations(): string[] {
  if (process.platform === 'darwin') {
    return [
      '/opt/homebrew/bin/git',
      '/usr/local/bin/git',
      '/Library/Developer/CommandLineTools/usr/bin/git',
      '/Applications/Xcode.app/Contents/Developer/usr/bin/git',
    ]
  }
  if (process.platform === 'win32') {
    return [process.env.ProgramW6432, process.env.ProgramFiles, process.env['ProgramFiles(x86)']]
      .filter(base => base !== undefined)
      .map(base => join(base, 'Git', 'cmd', 'git.exe'))
      .concat(process.env.LOCALAPPDATA === undefined ? [] : [join(process.env.LOCALAPPDATA, 'Programs', 'Git', 'cmd', 'git.exe')])
  }
  return ['/usr/bin/git', '/usr/local/bin/git']
}
