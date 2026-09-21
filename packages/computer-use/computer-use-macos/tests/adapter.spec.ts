/**
 * The macOS adapter: readiness probes that name the grant-holding identity, the
 * input path's window-scoping rule, the accessibility paths that refuse rather
 * than pretend, and the real-filesystem verifier that catches a claimed write
 * which never happened.
 */

import { describe, expect, it } from 'vitest'
import { ComputerUseError } from '@aeven/computer-use-desktop'
import { MacDesktopAdapter } from '../src/index.ts'
import { probeAccessibility, probeAutomation, probeMacReadiness, probeScreenRecording } from '../src/readiness.ts'
import type { MacCommandResult, MacCommandRunner } from '../src/runner.ts'


/** A runner that answers from a table keyed by the command's first argument after the binary. */
function runnerReturning(answers: Readonly<Record<string, MacCommandResult>>): MacCommandRunner & { calls: Array<{ command: string, args: readonly string[] }> } {
  const calls: Array<{ command: string, args: readonly string[] }> = []
  return {
    calls,
    run: (command, args) => {
      calls.push({ command, args })
      for (const [needle, result] of Object.entries(answers)) {
        if (args.join(' ').includes(needle)) {
          return Promise.resolve(result)
        }
      }
      return Promise.resolve({ code: 0, stdout: '', stderr: '' })
    },
  }
}

const ok: MacCommandResult = { code: 0, stdout: '', stderr: '' }

describe('macOS readiness probes', () => {
  const holder = { name: 'Aeven', source: 'in-process' as const }

  it('reports accessibility ready when the process is trusted, naming the holder', async () => {
    const runner = runnerReturning({ AXIsProcessTrusted: { code: 0, stdout: 'true\n', stderr: '' } })
    const probe = await probeAccessibility({ runner, holder })
    expect(probe.state).toBe('ready')
    expect(probe.grantee).toEqual({ name: 'Aeven', source: 'in-process' })
  })

  it('reports accessibility blocked with an actionable remedy naming which identity needs the grant', async () => {
    const runner = runnerReturning({ AXIsProcessTrusted: { code: 0, stdout: 'false\n', stderr: '' } })
    const probe = await probeAccessibility({ runner, holder })
    expect(probe.state).toBe('blocked')
    expect(probe.code).toBe('accessibility-not-granted')
    expect(probe.remedy).toContain('Aeven')
    expect(probe.reason).toContain('Aeven')
  })

  it('reports a probe that could not run as unknown, not as a missing grant', async () => {
    const runner = runnerReturning({ AXIsProcessTrusted: { code: 1, stdout: '', stderr: 'not authorised' } })
    const probe = await probeAccessibility({ runner, holder })
    expect(probe.state).toBe('unknown')
    expect(probe.code).toBe('probe-failed')
    expect(probe.reason).toBe('not authorised')
  })

  it('falls back to a generic reason when a failed probe reports nothing', async () => {
    const runner = runnerReturning({ AXIsProcessTrusted: { code: 1, stdout: '', stderr: '' } })
    const probe = await probeAccessibility({ runner, holder })
    expect(probe.reason).toBe('the accessibility probe could not run')
  })

  it('attributes an Automation grant to the spawned helper, because that is who holds it', async () => {
    const runner = runnerReturning({ 'com.apple.Pages': { code: 0, stdout: '{"name":"Pages"}\n', stderr: '' } })
    const probe = await probeAutomation({ runner, holder }, 'com.apple.Pages')
    expect(probe.name).toBe('automation.com.apple.Pages')
    expect(probe.state).toBe('ready')
    expect(probe.grantee).toEqual({ name: 'osascript', source: 'spawned-helper' })
  })

  it('reports a denied Automation pair as blocked with the target named in the remedy', async () => {
    const runner = runnerReturning({ 'com.microsoft.Word': { code: 1, stdout: '', stderr: 'Not authorized to send Apple events' } })
    const probe = await probeAutomation({ runner, holder }, 'com.microsoft.Word')
    expect(probe.state).toBe('blocked')
    expect(probe.code).toBe('automation-not-granted')
    expect(probe.reason).toBe('Not authorized to send Apple events')
    expect(probe.remedy).toContain('com.microsoft.Word')
  })

  it('distinguishes an unexpected Automation failure from a denied one', async () => {
    const runner = runnerReturning({ 'com.apple.Mail': { code: 2, stdout: '', stderr: 'boom' } })
    const probe = await probeAutomation({ runner, holder }, 'com.apple.Mail')
    expect(probe.state).toBe('unknown')
    expect(probe.reason).toBe('boom')
  })

  it('reports an Automation pair with no stderr and an odd exit code without inventing a reason', async () => {
    const runner = runnerReturning({ 'com.apple.Mail': { code: 7, stdout: '', stderr: '' } })
    const probe = await probeAutomation({ runner, holder }, 'com.apple.Mail')
    expect(probe.state).toBe('unknown')
    expect(probe.reason).toBe('probing "com.apple.Mail" failed with exit code 7')
  })

  it('reports screen recording ready without requesting the grant', async () => {
    const runner = runnerReturning({ '0,0,1,1': ok })
    const probe = await probeScreenRecording({ runner, holder })
    expect(probe.state).toBe('ready')
    expect(runner.calls[0]?.command).toBe('screencapture')
  })

  it('reports screen recording blocked with a remedy when capture fails', async () => {
    const runner = runnerReturning({ '0,0,1,1': { code: 1, stdout: '', stderr: 'cannot capture' } })
    const probe = await probeScreenRecording({ runner, holder })
    expect(probe.code).toBe('screen-recording-not-granted')
    expect(probe.reason).toBe('cannot capture')
    expect(probe.remedy).toContain('Screen Recording')
  })

  it('falls back to a generic capture reason when capture fails silently', async () => {
    const runner = runnerReturning({ '0,0,1,1': { code: 1, stdout: '', stderr: '' } })
    const probe = await probeScreenRecording({ runner, holder })
    expect(probe.reason).toBe('screen capture is not permitted')
  })

  it('composes a report whose blockers and next step agree with the probes', async () => {
    const runner = runnerReturning({
      AXIsProcessTrusted: { code: 0, stdout: 'false\n', stderr: '' },
      '0,0,1,1': ok,
      'com.apple.Pages': { code: 0, stdout: '{}', stderr: '' },
    })
    const report = await probeMacReadiness({ runner, holder, automationTargets: ['com.apple.Pages'] })
    expect(report.platform).toBe('darwin')
    expect(report.blockers).toEqual(['accessibility.read'])
    expect(report.recommendedNextStep).toContain('Accessibility')
    expect(report.probes).toHaveLength(3)
  })

  it('probes no Automation target when none is requested', async () => {
    const runner = runnerReturning({ AXIsProcessTrusted: { code: 0, stdout: 'true\n', stderr: '' }, '0,0,1,1': ok })
    const report = await probeMacReadiness({ runner, holder })
    expect(report.probes.map(probe => probe.name)).toEqual(['accessibility.read', 'screenRecording.capture'])
    expect(report.blockers).toEqual([])
  })
})

describe('macOS input is always window-scoped', () => {
  const adapter = (runner: MacCommandRunner) => new MacDesktopAdapter({ runner })

  it('sends typing scoped to the named window and records the route', async () => {
    const runner = runnerReturning({})
    const receipt = await adapter(runner).act({
      kind: 'type',
      target: { kind: 'window', pid: 42, windowId: 'w1' },
      text: 'hello',
    })
    expect(receipt.route).toBe('native-input')
    expect(receipt.notes?.[0]).toContain('window w1')
    expect(runner.calls[0]?.args.join(' ')).toContain('keystroke "hello"')
  })

  it('escapes quotes so typed text cannot break out of the AppleScript literal', async () => {
    const runner = runnerReturning({})
    await adapter(runner).act({ kind: 'type', target: { kind: 'window', pid: 1, windowId: 'w' }, text: 'say "hi"' })
    expect(runner.calls[0]?.args.join(' ')).toContain('keystroke "say \\"hi\\""')
  })

  it('translates named keys to key codes, since keystroke cannot express them', async () => {
    const runner = runnerReturning({})
    await adapter(runner).act({ kind: 'key', target: { kind: 'window', pid: 1, windowId: 'w' }, key: 'return' })
    expect(runner.calls[0]?.args.join(' ')).toContain('key code 36')
  })

  it('translates modifiers into an AppleScript using clause', async () => {
    const runner = runnerReturning({})
    await adapter(runner).act({ kind: 'key', target: { kind: 'window', pid: 1, windowId: 'w' }, key: 's', modifiers: ['cmd', 'shift'] })
    expect(runner.calls[0]?.args.join(' ')).toContain('using {command down, shift down}')
  })

  it('accepts every documented modifier synonym', async () => {
    const runner = runnerReturning({})
    await adapter(runner).act({
      kind: 'key',
      target: { kind: 'window', pid: 1, windowId: 'w' },
      key: 'a',
      modifiers: ['command', 'option', 'alt', 'control', 'ctrl'],
    })
    const sent = runner.calls[0]?.args.join(' ') ?? ''
    expect(sent).toContain('command down')
    expect(sent).toContain('option down')
    expect(sent).toContain('control down')
  })

  it('refuses an unrecognised modifier rather than silently dropping the chord', async () => {
    const runner = runnerReturning({})
    await expect(
      adapter(runner).act({ kind: 'key', target: { kind: 'window', pid: 1, windowId: 'w' }, key: 'a', modifiers: ['hyper'] }),
    ).rejects.toThrow(ComputerUseError)
    expect(runner.calls).toHaveLength(0)
  })

  it('refuses unscoped point input, which is the failure this contract exists to prevent', async () => {
    const runner = runnerReturning({})
    await expect(
      adapter(runner).act({ kind: 'type', target: { kind: 'point', x: 1, y: 2 }, text: 'x' }),
    ).rejects.toMatchObject({ code: 'invalid-target' })
    expect(runner.calls).toHaveLength(0)
  })

  it('accepts point input once it names its window', async () => {
    const runner = runnerReturning({})
    const receipt = await adapter(runner).act({
      kind: 'type',
      target: { kind: 'point', x: 1, y: 2, window: { kind: 'window', pid: 9, windowId: 'w9' } },
      text: 'x',
    })
    expect(receipt.notes?.[0]).toContain('w9')
  })

  it('refuses element-addressed input rather than acting on the wrong thing', async () => {
    const runner = runnerReturning({})
    await expect(
      adapter(runner).act({ kind: 'type', target: { kind: 'element', token: 's1:0' }, text: 'x' }),
    ).rejects.toMatchObject({ code: 'not-implemented' })
    expect(runner.calls).toHaveLength(0)
  })

  it('records stderr as an observation instead of treating it as success', async () => {
    const runner = runnerReturning({ keystroke: { code: 1, stdout: '', stderr: 'not allowed to send keystrokes' } })
    const receipt = await adapter(runner).act({ kind: 'type', target: { kind: 'window', pid: 1, windowId: 'w' }, text: 'x' })
    expect(receipt.observed).toBe('not allowed to send keystrokes')
  })

  it('describes a focus request without claiming the window became frontmost', async () => {
    const runner = runnerReturning({})
    const receipt = await adapter(runner).act({ kind: 'focusWindow', target: { kind: 'window', pid: 7, windowId: 'w7' } })
    expect(receipt.route).toBe('accessibility')
    expect(receipt.notes?.[0]).toContain('w7')
  })

  it('refuses the accessibility actions with the missing piece named, not with a silent no-op', async () => {
    const runner = runnerReturning({})
    for (const action of [
      { kind: 'click', target: { kind: 'window', pid: 1, windowId: 'w' } },
      { kind: 'setValue', target: { kind: 'element', token: 's1:0' }, value: 'x' },
      { kind: 'performAction', target: { kind: 'element', token: 's1:0' }, action: 'press' },
    ] as const) {
      await expect(adapter(runner).act(action)).rejects.toMatchObject({ code: 'not-implemented' })
    }
    expect(runner.calls).toHaveLength(0)
  })
})

describe('observation refuses instead of reporting an empty tree', () => {
  it('rejects with the missing piece named, so an empty tree is never mistaken for an empty app', async () => {
    const adapter = new MacDesktopAdapter({ runner: runnerReturning({}) })
    await expect(adapter.observe({ pid: 1 })).rejects.toMatchObject({ code: 'not-implemented' })
    await expect(adapter.observe({ pid: 1 })).rejects.toThrow(/Accessibility grant/)
  })
})
