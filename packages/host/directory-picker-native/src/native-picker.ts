/** Cross-platform native single-directory chooser behind the native backend's capability. */

import { existsSync } from 'node:fs'
import { runNativeCommand, type NativeCommandRunner } from '@aeven/native-command'
import type { DirectoryPickerPickOptions } from '@aeven/host-directory-picker'
import { pickWin32Directory } from './win32-dialog.ts'

/** Testable command boundary; native implementations never invoke a shell. */
export type DirectoryPickerRunner = NativeCommandRunner

/** Injectable platform facts for deterministic adapter tests. */
export interface DirectoryPickerInternals {
  platform?: NodeJS.Platform
  run?: DirectoryPickerRunner
  /** Replaces the in-process Win32 dialog (`pickWin32Directory`) for deterministic tests. */
  pickWin32Dialog?: (signal: AbortSignal, directory?: string) => Promise<string | null>
}

/** One opening: the caller's starting-directory hint plus the test hooks. */
export interface PickNativeDirectoryOptions extends DirectoryPickerInternals, DirectoryPickerPickOptions {}

/**
 * Quote one string as an AppleScript literal.
 * @param text - the raw text.
 * @returns the literal, with backslashes and quotes escaped.
 */
function appleScriptLiteral(text: string): string {
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * The `default location` clause that makes the macOS chooser open at `directory`.
 * @param directory - absolute directory the caller wants to start from.
 * @returns the clause, or an empty string when the directory is gone: a stale
 * record must leave the platform default rather than break the chooser.
 */
function macDefaultLocation(directory: string | undefined): string {
  if (directory === undefined || !existsSync(directory)) return ''
  return ` default location (POSIX file ${appleScriptLiteral(directory)})`
}

function outputPath(stdout: string): string | null {
  const path = stdout.replace(/[\r\n]+$/, '')
  return path === '' ? null : path
}

function errorCode(error: unknown): string | number | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' || typeof code === 'number' ? code : undefined
}

function errorStderr(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('stderr' in error)) return ''
  const stderr = (error as { stderr?: unknown }).stderr
  return typeof stderr === 'string' ? stderr : ''
}

function isMissingCommand(error: unknown): boolean {
  return errorCode(error) === 'ENOENT'
}

function rethrowIfAborted(signal: AbortSignal, error: unknown): void {
  if (signal.aborted) throw error
}

/**
 * Open the platform directory picker.
 * @param signal - caller/connection lifetime; abort terminates the native command.
 * @param options - starting-directory hint plus platform/runner hooks for deterministic tests.
 * @returns the selected path, or null when the user cancels.
 */
export async function pickNativeDirectory(
  signal: AbortSignal,
  options: PickNativeDirectoryOptions = {},
): Promise<string | null> {
  const platform = options.platform ?? process.platform
  const run = options.run ?? runNativeCommand

  if (platform === 'darwin') {
    try {
      const result = await run('osascript', [
        '-e', `set selectedFolder to choose folder with prompt "Select Workspace Directory"${macDefaultLocation(options.directory)}`,
        '-e', 'POSIX path of selectedFolder',
      ], signal)
      return outputPath(result.stdout)
    } catch (error: unknown) {
      if (!signal.aborted && errorCode(error) === 1
        && /(?:User canceled|-128)/i.test(errorStderr(error))) return null
      throw error
    }
  }

  if (platform === 'win32') {
    // The koffi-backed IFileOpenDialog child process — the modern picker with
    // per-monitor-v2 DPI and abort support. koffi is a packaged dependency
    // whose availability the install guarantees, so there is no fallback
    // tier: any failure surfaces as-is (no PowerShell fallback tier; see
    // .agents/notes/implemented/simplification/2026-08-04-drop-windows-powershell-picker-fallback.md).
    const pickDialog = options.pickWin32Dialog ?? pickWin32Directory
    return await pickDialog(signal, options.directory)
  }

  if (platform === 'linux') {
    try {
      const result = await run('zenity', [
        '--file-selection', '--directory', '--title=Select Workspace Directory',
        ...options.directory === undefined ? [] : [`--filename=${options.directory}/`],
      ], signal)
      return outputPath(result.stdout)
    } catch (error: unknown) {
      rethrowIfAborted(signal, error)
      if (errorCode(error) === 1) return null
      if (!isMissingCommand(error)) throw error
    }

    try {
      const result = await run('kdialog', [
        '--getexistingdirectory', options.directory ?? '.', '--title', 'Select Workspace Directory',
      ], signal)
      return outputPath(result.stdout)
    } catch (error: unknown) {
      rethrowIfAborted(signal, error)
      if (errorCode(error) === 1) return null
      if (isMissingCommand(error)) {
        throw new Error('no supported native directory picker found (install zenity or kdialog)')
      }
      throw error
    }
  }

  throw new Error(`native directory picker is unsupported on ${platform}`)
}
