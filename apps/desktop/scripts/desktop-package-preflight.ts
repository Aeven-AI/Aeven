/**
 * Check a Desktop packaging run before it builds anything.
 *
 * A packaging run spends minutes on native builds and package preparation before electron-builder first reads
 * the signing and update configuration, so a missing setting or tool used to surface only at the end. This
 * check reads the same configuration electron-builder will, and runs each external tool the run calls, up front.
 */

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { cmakeCommand, goCommand } from '../../../scripts/build-tools.ts'
import { createElectronBuilderConfig } from './electron-builder-config.mjs'

const APP_ROOT = resolve(import.meta.dirname, '..')
const REPOSITORY_ROOT = resolve(APP_ROOT, '..', '..')

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function manifestVersion(path: string): unknown {
  return (JSON.parse(readFileSync(path, 'utf8')) as { version?: unknown }).version
}

/**
 * Run one tool's version query.
 * @param label - Name the report uses for the tool.
 * @param command - Executable, or a function that locates it and throws when it cannot.
 * @param args - Arguments that only print a version.
 * @returns A problem description, or undefined when the tool ran.
 */
function probe(label: string, command: string | (() => string), args: readonly string[]): string | undefined {
  let executable: string
  try {
    executable = typeof command === 'string' ? command : command()
  } catch (error) {
    return `${label}: ${errorMessage(error)}`
  }
  // npm is a .cmd shim on Windows, which Node only spawns through a shell.
  const shell = process.platform === 'win32' && executable.endsWith('.cmd')
  const options = { stdio: 'ignore', windowsHide: true } as const
  // A shell takes one command line; the arguments here are fixed version flags, never input.
  const result = shell
    ? spawnSync(`${executable} ${args.join(' ')}`, { ...options, shell: true })
    : spawnSync(executable, args, options)
  if (result.error !== undefined) return `${label}: ${executable} could not run (${result.error.message})`
  if (result.status !== 0) return `${label}: ${executable} ${args.join(' ')} exited with ${String(result.status ?? result.signal)}`
  return undefined
}

/**
 * Check a packaging run's configuration and external tools.
 * @param environment - The environment electron-builder will receive, with the target and unsigned selectors set.
 * @returns Every problem found; empty when the run can start.
 */
export function desktopPackageProblems(environment: NodeJS.ProcessEnv): readonly string[] {
  const problems: string[] = []
  const desktopVersion = manifestVersion(join(APP_ROOT, 'package.json'))
  const avnVersion = manifestVersion(join(REPOSITORY_ROOT, 'package.json'))
  if (desktopVersion !== avnVersion) {
    problems.push(`versions: desktop package ${String(desktopVersion)} does not match avn ${String(avnVersion)}`)
  }
  // The application ID, signing identity, notarization credentials, Windows certificate, SignTool and token
  // fields, and the update origin are all validated while the configuration is built.
  try {
    createElectronBuilderConfig(environment)
  } catch (error) {
    problems.push(`configuration: ${errorMessage(error)}`)
  }
  const tools: ReadonlyArray<readonly [string, string | (() => string), readonly string[]]> = [
    ['tar', 'tar', ['--version']],
    ['npm', process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--version']],
    ['go (WhatsApp connector)', goCommand, ['version']],
    ['cmake (Whisper worker)', cmakeCommand, ['--version']],
  ]
  for (const [label, command, args] of tools) {
    const problem = probe(label, command, args)
    if (problem !== undefined) problems.push(problem)
  }
  return problems
}
