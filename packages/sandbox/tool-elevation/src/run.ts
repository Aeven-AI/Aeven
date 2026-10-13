/**
 * Run one command as administrator on Windows.
 *
 * Windows gives a process no way to raise its own token, so the command runs in
 * a NEW process started through the user-account-control prompt. An ordinary
 * PowerShell does `Start-Process -Verb RunAs -Wait -PassThru` and exits with the
 * elevated process's exit code, so that code reaches this side through
 * `ctx.subprocess` like any other. The elevated process owns its own console,
 * so its output is the one thing that travels through a file.
 *
 * @module @aeven/tool-elevation/run
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HarnessError } from '@aeven/llm'
import type { SubprocessRuntime } from '@aeven/subprocess'

/** The interpreter the elevated process runs the command with. */
export type ElevatedShell = 'powershell' | 'cmd'

/** One elevated run. */
export interface ElevatedRun {
  readonly shell: ElevatedShell
  /** The exact command text, written to a job file so no layer re-quotes it. */
  readonly command: string
  readonly timeoutMs: number
  /** Retained tail of the captured output, in characters. */
  readonly maxOutputChars: number
  readonly signal?: AbortSignal | undefined
}

/** What one elevated run produced. */
export interface ElevatedResult {
  readonly exitCode: number
  readonly output: string
}

/** Written to the launcher's stderr when the consent prompt is dismissed. */
const DECLINED = 'AVN_ELEVATION_DECLINED'

/**
 * A PowerShell single-quoted literal.
 * @param text - literal text, such as a path.
 * @returns the text quoted, with embedded quotes doubled.
 */
export function psLiteral(text: string): string {
  return `'${text.replaceAll('\'', '\'\'')}'`
}

/**
 * Encode a script for `powershell -EncodedCommand`, which takes UTF-16LE base64.
 * @param script - PowerShell source.
 * @returns the encoded argument.
 */
export function encodeCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

/**
 * The script the ordinary PowerShell runs: raise the prompt, wait, and exit with
 * the elevated process's code. A dismissed prompt makes `Start-Process` throw.
 * @param jobPath - the command file (`.ps1` or `.cmd`).
 * @param outputPath - where the elevated process writes its captured output.
 * @param shell - the job's interpreter.
 * @returns PowerShell source.
 */
export function launcherScript(jobPath: string, outputPath: string, shell: ElevatedShell): string {
  const job = shell === 'cmd' ? `cmd.exe /d /c ${psLiteral(jobPath)}` : `& ${psLiteral(jobPath)}`
  const elevated = `try { ${job} *>&1 | Out-File -LiteralPath ${psLiteral(outputPath)} -Encoding utf8; exit $LASTEXITCODE }`
    + ` catch { $_ | Out-File -LiteralPath ${psLiteral(outputPath)} -Append -Encoding utf8; exit 1 }`
  return `try {
  $p = Start-Process -FilePath powershell.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', '${encodeCommand(elevated)}')
} catch {
  [Console]::Error.WriteLine('${DECLINED}: ' + $_.Exception.Message)
  exit 1
}
exit $p.ExitCode
`
}

/**
 * Run one command elevated and wait for it.
 * @param subprocess - the subprocess seam the launcher spawns through.
 * @param run - command, interpreter, deadline, and cancellation.
 * @returns the elevated process's exit code and output tail.
 * @throws HarnessError `ELEVATION_DENIED` when the prompt is dismissed, `ELEVATION_TIMEOUT` past the deadline.
 */
export async function runElevated(subprocess: SubprocessRuntime, run: ElevatedRun): Promise<ElevatedResult> {
  const dir = await mkdtemp(join(tmpdir(), 'avn-elevated-'))
  try {
    const jobPath = join(dir, run.shell === 'cmd' ? 'job.cmd' : 'job.ps1')
    const outputPath = join(dir, 'output.txt')
    // No byte-order mark: cmd.exe reads one as part of its first command word.
    await writeFile(jobPath, run.command, 'utf8')

    const timeout = AbortSignal.timeout(run.timeoutMs)
    const handle = subprocess.spawn({
      argv: ['powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodeCommand(launcherScript(jobPath, outputPath, run.shell))],
      cwd: dir,
      stdio: { stdin: 'ignore', stdout: { maxBytes: 4096 }, stderr: { maxBytes: 4096 } },
      graceMs: 1000,
      signal: run.signal === undefined ? timeout : AbortSignal.any([run.signal, timeout]),
    })
    const outcome = await handle.done
    // A timeout stops the wait, not a command already running elevated: that
    // process is not this one's child.
    if (timeout.aborted) throw new HarnessError(`the elevated command did not finish within ${String(run.timeoutMs)} ms`, 'ELEVATION_TIMEOUT')
    run.signal?.throwIfAborted()
    const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
    if (stderr.includes(DECLINED)) {
      throw new HarnessError('the administrator prompt was dismissed, so the command never ran', 'ELEVATION_DENIED')
    }

    const raw = await readFile(outputPath, 'utf8').catch(() => '')
    const text = raw.replace(/^﻿/, '')
    const output = text.length > run.maxOutputChars ? `[…truncated]\n${text.slice(-run.maxOutputChars)}` : text
    return { exitCode: outcome.exitCode ?? 1, output }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}
