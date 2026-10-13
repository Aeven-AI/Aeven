/**
 * The provider's host runners, and the readiness report they feed.
 *
 * `node:child_process` is doubled here for two reasons no real spawn can serve.
 * `execFile` fills `code`, `stdout`, and `stderr` before it rejects for every failure
 * it can produce, so the fallbacks the runners read those fields through are reached
 * only by a rejection that arrives without them — the rejection a caller sees when
 * the failure never reached the child. And every macOS readiness probe spawns a real
 * host tool: `screencapture` raises a Screen Recording consent prompt, which a test
 * must not ask the operator for.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMacCommandRunner, createOsascriptRunner, MacComputerUseProvider } from '../src/index.ts'

/** What the double answers one spawn with; an `Error` outcome rejects with it. */
type SpawnOutcome = { stdout: string; stderr: string } | Error

/** One spawn the double was asked for. */
interface SpawnCall {
  file: string
  args: readonly string[]
  options: unknown
}

const host = vi.hoisted(() => ({
  respond: (_file: string, _args: readonly string[]): SpawnOutcome => ({ stdout: '', stderr: '' }),
  calls: [] as SpawnCall[],
}))

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  const { promisify } = await import('node:util')
  // Node gives `execFile` its own promisified form: it resolves `{ stdout, stderr }`
  // and rejects with the spawn error itself, which is the form the runners use.
  const execFile = Object.assign(
    () => { throw new Error('the child-process double is reached through promisify, not called directly') },
    {
      [promisify.custom]: (file: string, args: readonly string[], options: unknown) => {
        host.calls.push({ file, args: [...args], options })
        const outcome = host.respond(file, args)
        return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome)
      },
    },
  )
  return { ...actual, execFile }
})

beforeEach(() => {
  host.calls.length = 0
  host.respond = () => ({ stdout: '', stderr: '' })
})

describe('the osascript runner answers in a status', () => {
  it('reports a rejection with no status fields as a failure of its own, naming the cause', async () => {
    host.respond = () => new Error('osascript could not be started')
    const result = await createOsascriptRunner().run('throw new Error("deliberate")')
    expect(result).toEqual({ code: 1, stdout: '', stderr: 'Error: osascript could not be started' })
  })

  it('keeps the exit status and streams a failure record does carry', async () => {
    host.respond = () => Object.assign(new Error('the application said no'), { code: 9, stdout: 'partial' })
    const result = await createOsascriptRunner().run('Application("X").save()')
    expect(result).toEqual({ code: 9, stdout: 'partial', stderr: 'Error: the application said no' })
  })

  it('runs the script through osascript with the named language, and passes its streams through', async () => {
    host.respond = () => ({ stdout: 'true\n', stderr: '' })
    const result = await createOsascriptRunner().run('JSON.stringify({ ok: true })', 'AppleScript')
    expect(result).toEqual({ code: 0, stdout: 'true\n', stderr: '' })
    expect(host.calls[0]).toEqual({
      file: 'osascript',
      args: ['-l', 'AppleScript', '-e', 'JSON.stringify({ ok: true })'],
      options: { maxBuffer: 32 * 1024 * 1024 },
    })
  })
})

describe('the mac command runner answers in a status', () => {
  it('reports a rejection with no status fields as a failed run, keeping the cause', async () => {
    host.respond = () => new Error('the command could not be spawned')
    const result = await createMacCommandRunner().run('screencapture', ['-x'])
    expect(result).toEqual({ code: 1, stdout: '', stderr: 'Error: the command could not be spawned' })
  })

  it('forwards the caller lifetime to the spawn it makes', async () => {
    const controller = new AbortController()
    await createMacCommandRunner().run('sw_vers', ['-productVersion'], controller.signal)
    expect(host.calls[0]?.options).toMatchObject({ signal: controller.signal, maxBuffer: 32 * 1024 * 1024 })
  })
})

describe('the readiness the provider exposes', () => {
  it('names each gated capability, its holder, and the remedy for the grant that is missing', async () => {
    // The spawned helper is not a trusted accessibility process, and a capture it
    // is not permitted fails with a status rather than returning an empty image.
    host.respond = file => file === 'screencapture'
      ? Object.assign(new Error('screencapture failed'), { code: 1, stdout: '', stderr: 'screen recording is not permitted' })
      : { stdout: 'false\n', stderr: '' }
    const report = await new MacComputerUseProvider().readiness()
    expect(report.platform).toBe('darwin')
    expect(report.probes.map(probe => probe.name)).toEqual(['accessibility.read', 'screenRecording.capture'])
    expect(report.blockers).toEqual(['accessibility.read', 'screenRecording.capture'])
    expect(report.recommendedNextStep).toContain('Accessibility')
    expect(report.probes[0]?.grantee).toEqual({ name: 'osascript', source: 'spawned-helper' })
    // Accessibility is probed with the process-trust API, and no Automation target
    // is probed at all, so nothing here sends an Apple Event the user did not ask for.
    expect(host.calls[0]?.file).toBe('osascript')
    expect(host.calls[0]?.args).toEqual([
      '-l',
      'JavaScript',
      '-e',
      'ObjC.import("ApplicationServices"); $.AXIsProcessTrusted()',
    ])
    expect(host.calls.map(call => call.file)).toEqual(['osascript', 'screencapture'])
  })
})
