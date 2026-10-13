/**
 * Locate the external build tools the native packages compile with.
 *
 * A shell started before a tool joined PATH (an editor's integrated terminal) still builds: on Windows each lookup
 * falls back to the tool's standard install location. The native build scripts and the Desktop packaging preflight
 * share these lookups, so the preflight probes exactly the executable the build will run.
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** Go on PATH, else (Windows) the standard install. */
export function goCommand(): string {
  if (process.platform !== 'win32' || spawnSync('go', ['version'], { stdio: 'ignore' }).error === undefined) return 'go'
  const installed = join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Go', 'bin', 'go.exe')
  if (!existsSync(installed)) throw new Error(`build: go is not on PATH and was not found at ${installed}`)
  return installed
}

/** CMake on PATH, else (Windows) the standalone install or the copy Visual Studio bundles. */
export function cmakeCommand(): string {
  if (process.platform !== 'win32' || spawnSync('cmake', ['--version'], { stdio: 'ignore' }).error === undefined) return 'cmake'
  const programFiles = process.env['ProgramFiles'] ?? 'C:\\Program Files'
  const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
  const vswhere = spawnSync(join(programFilesX86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe'),
    ['-all', '-products', '*', '-property', 'installationPath'], { encoding: 'utf8' })
  const studios = vswhere.error === undefined ? vswhere.stdout.split(/\r?\n/).filter(line => line.trim() !== '') : []
  const candidates = [
    join(programFiles, 'CMake', 'bin', 'cmake.exe'),
    ...studios.map(studio => join(studio.trim(), 'Common7', 'IDE', 'CommonExtensions', 'Microsoft', 'CMake', 'CMake', 'bin', 'cmake.exe')),
  ]
  const found = candidates.find(path => existsSync(path))
  if (found === undefined) throw new Error(`build: cmake is not on PATH and was not found at ${candidates.join(', ')}`)
  return found
}
