/**
 * The two host runners the provider builds.
 *
 * The command runner runs *a program* — the adapter's UI Automation scripts — while
 * the script runner has program text to run. Both report a non-zero exit as a
 * resolved result, because the adapter branches on PowerShell's status.
 */

import { describe, expect, it, vi } from 'vitest'
import type { WinCommandRunner } from '@aeven/computer-use-windows'
import { createPowerShellScriptRunner, createWindowsCommandRunner } from '../src/index.ts'

describe('the command runner reports a status rather than throwing', () => {
  const runner = createWindowsCommandRunner()

  it('captures both streams of a command that succeeds', async () => {
    const result = await runner.run(process.execPath, ['-e', 'process.stdout.write("observed")'])
    expect(result).toEqual({ code: 0, stdout: 'observed', stderr: '' })
  })

  it('carries the caller lifetime without treating it as a failure', async () => {
    const result = await runner.run(
      process.execPath,
      ['-e', 'process.stdout.write("observed")'],
      new AbortController().signal,
    )
    expect(result).toEqual({ code: 0, stdout: 'observed', stderr: '' })
  })

  it('resolves a non-zero exit with its status and message, because the adapter branches on the code', async () => {
    const result = await runner.run(process.execPath, ['-e', 'process.stderr.write("boom"); process.exit(7)'])
    expect(result).toEqual({ code: 7, stdout: '', stderr: 'boom' })
  })

  it('reports a cancelled command as a failure, since cancellation is an answer the caller needs', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await runner.run(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], controller.signal)
    expect(result.code).toBe(1)
    expect(result.stdout).toBe('')
  })

  it('reports a command that does not exist as a failure rather than rejecting', async () => {
    // The adapter branches on the code, so a spawn failure has to arrive as a
    // status like any other non-zero exit.
    const result = await runner.run('aeven-no-such-executable', [])
    expect(result.code).toBe(1)
    expect(typeof result.stderr).toBe('string')
  })
})

describe('the script runner presents the command runner as PowerShell', () => {
  const recording = () => {
    const calls: { command: string; args: readonly string[]; signal: AbortSignal | undefined }[] = []
    const runner: WinCommandRunner = {
      run: (command, args, signal) => {
        calls.push({ command, args, signal })
        return Promise.resolve({ code: 0, stdout: '{}', stderr: '' })
      },
    }
    return { runner, calls }
  }

  it('defaults to the PowerShell that ships with Windows, as the adapter does', async () => {
    const { runner, calls } = recording()
    await createPowerShellScriptRunner(runner).run('Get-Date')
    expect(calls[0]?.command).toBe('powershell')
    expect(calls[0]?.args).toEqual(['-NoProfile', '-NonInteractive', '-Command', 'Get-Date'])
  })

  it('invokes the PowerShell a deployment configured', async () => {
    const { runner, calls } = recording()
    await createPowerShellScriptRunner(runner, 'C:\\Program Files\\PowerShell\\7\\pwsh.exe').run('Get-Date')
    expect(calls[0]?.command).toBe('C:\\Program Files\\PowerShell\\7\\pwsh.exe')
  })

  it('forwards the calling batch lifetime so a cancelled task terminates the process', async () => {
    const { runner, calls } = recording()
    const controller = new AbortController()
    await createPowerShellScriptRunner(runner).run('Get-Date', controller.signal)
    expect(calls[0]?.signal).toBe(controller.signal)
  })

  it('leaves the caller lifetime out when the caller supplied none', async () => {
    const run = vi.fn(() => Promise.resolve({ code: 0, stdout: '', stderr: '' }))
    await createPowerShellScriptRunner({ run }).run('Get-Date')
    expect(run).toHaveBeenCalledWith('powershell', expect.anything(), undefined)
  })
})
