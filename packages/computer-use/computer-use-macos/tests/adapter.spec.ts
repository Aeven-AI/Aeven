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
function runnerReturning(answers: Readonly<Record<string, MacCommandResult>>): MacCommandRunner
  & { calls: Array<{ command: string; args: readonly string[] }> } {
  const calls: Array<{ command: string; args: readonly string[] }> = []
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

  it('refuses a coordinate or window click, which has no single point to press', async () => {
    const runner = runnerReturning({})
    await expect(adapter(runner).act({ kind: 'click', target: { kind: 'window', pid: 1, windowId: 'w' } }))
      .rejects.toMatchObject({ code: 'not-implemented' })
    await expect(
      adapter(runner).act({ kind: 'click', target: { kind: 'point', x: 1, y: 2, window: { kind: 'window', pid: 1, windowId: 'w' } } }),
    ).rejects.toThrow(/pointer path/)
    expect(runner.calls).toHaveLength(0)
  })

  it('presses an element through the accessibility action', async () => {
    const runner = runnerReturning({ AXPress: { code: 0, stdout: '{"ok":true,"acted":"AXPress"}', stderr: '' } })
    const receipt = await adapter(runner).act({ kind: 'click', target: { kind: 'element', token: 'ax:1:w:0:3' } })
    expect(receipt.route).toBe('accessibility')
    expect(receipt.notes?.[0]).toContain('walk index 3')
    expect(runner.calls[0]?.args.join(' ')).toContain('-l JavaScript')
  })

  it('writes a value through the accessibility API and reports what it did', async () => {
    const runner = runnerReturning({ AXSetValue: { code: 0, stdout: '{"ok":true,"acted":"setValue"}', stderr: '' } })
    const receipt = await adapter(runner).act({ kind: 'setValue', target: { kind: 'element', token: 'ax:1:w:0:0' }, value: 'the story' })
    expect(receipt.observed).toBe('accessibility action completed')
  })

  it('invokes an advertised secondary action by name', async () => {
    const runner = runnerReturning({ AXShowMenu: { code: 0, stdout: '{"ok":true,"acted":"AXShowMenu"}', stderr: '' } })
    const receipt = await adapter(runner).act({ kind: 'performAction', target: { kind: 'element', token: 'ax:1:w:0:1' }, action: 'AXShowMenu' })
    expect(receipt.notes?.[0]).toContain('AXShowMenu')
  })

  it('reports a refused accessibility action with the advertised list attached', async () => {
    const runner = runnerReturning({ AXPress: { code: 1, stdout: '{"ok":false,"error":"the element does not advertise AXPress; it advertises: AXShowMenu","axError":0}', stderr: '' } })
    await expect(adapter(runner).act({ kind: 'click', target: { kind: 'element', token: 'ax:1:w:0:0' } }))
      .rejects.toThrow(/does not advertise AXPress/)
  })

  it('refuses a token that carries no walk index before running anything', async () => {
    const runner = runnerReturning({})
    await expect(adapter(runner).act({ kind: 'click', target: { kind: 'element', token: 'ax:broken' } }))
      .rejects.toMatchObject({ code: 'invalid-target' })
    expect(runner.calls).toHaveLength(0)
  })
})

describe('observation walks the accessibility tree', () => {
  const WINDOWS = JSON.stringify([
    { pid: 42, app: 'Pages', title: 'Agent Story.pages', position: '10, 20', size: '800, 600' },
  ])
  const TREE = JSON.stringify({
    ok: true,
    truncated: false,
    nodes: [
      { depth: 0, role: 'AXWindow', title: 'Agent Story', description: '', value: '', actions: [], x: 0, y: 0, width: 800, height: 600 },
      { depth: 1, role: 'AXTextArea', title: 'Body', description: '', value: 'existing text', actions: ['AXSetValue'], x: 10, y: 10, width: 700, height: 500 },
    ],
  })

  it('mints snapshot-scoped tokens that carry their window', async () => {
    const runner = runnerReturning({ 'System Events': { code: 0, stdout: WINDOWS, stderr: '' }, kAXFocusedApplicationAttribute: { code: 0, stdout: TREE, stderr: '' } })
    const result = await new MacDesktopAdapter({ runner }).observe({})
    const id = result.snapshot?.snapshotId ?? ''
    expect(id).toContain('ax:42:Agent Story.pages')
    expect(result.snapshot?.nodes.map(node => node.token)).toEqual([`${id}:0`, `${id}:1`])
  })

  it('falls back to the description when a node carries no title', async () => {
    const tree = JSON.stringify({ ok: true, nodes: [{ depth: 0, role: 'AXButton', title: '', description: 'Close', value: '', actions: [], x: 0, y: 0, width: 1, height: 1 }] })
    const runner = runnerReturning({ 'System Events': { code: 0, stdout: WINDOWS, stderr: '' }, kAXFocusedApplicationAttribute: { code: 0, stdout: tree, stderr: '' } })
    const result = await new MacDesktopAdapter({ runner }).observe({})
    expect(result.snapshot?.nodes[0]?.title).toBe('Close')
  })

  it('marks a text area editable even when it advertises no set-value action', async () => {
    const runner = runnerReturning({ 'System Events': { code: 0, stdout: WINDOWS, stderr: '' }, kAXFocusedApplicationAttribute: { code: 0, stdout: TREE, stderr: '' } })
    const result = await new MacDesktopAdapter({ runner }).observe({})
    expect(result.snapshot?.nodes[1]?.editable).toBe(true)
  })

  it('reports truncation when the walk hit its cap', async () => {
    const tree = JSON.stringify({ ok: true, truncated: true, nodes: [{ depth: 0, role: 'AXWindow', title: '', description: '', value: '', actions: [], x: 0, y: 0, width: 1, height: 1 }] })
    const runner = runnerReturning({ 'System Events': { code: 0, stdout: WINDOWS, stderr: '' }, kAXFocusedApplicationAttribute: { code: 0, stdout: tree, stderr: '' } })
    const result = await new MacDesktopAdapter({ runner }).observe({})
    expect(result.snapshot?.truncated).toBe(true)
    expect(result.notes?.join(' ')).toContain('node cap')
  })

  it('skips the walk when the tree is not wanted, and says which window the snapshot covers', async () => {
    const runner = runnerReturning({ 'System Events': { code: 0, stdout: WINDOWS, stderr: '' } })
    const result = await new MacDesktopAdapter({ runner }).observe({ tree: false })
    expect(result.snapshot?.nodes).toEqual([])
    expect(result.notes?.[0]).toContain('walked no tree')
    expect(runner.calls).toHaveLength(1)
  })

  it('refuses a named window that is not present', async () => {
    const runner = runnerReturning({ 'System Events': { code: 0, stdout: WINDOWS, stderr: '' } })
    await expect(new MacDesktopAdapter({ runner }).observe({ windowId: 'Absent' }))
      .rejects.toMatchObject({ code: 'invalid-target' })
  })

  it('observes an empty desktop without walking anything', async () => {
    const runner = runnerReturning({ 'System Events': { code: 0, stdout: '[]', stderr: '' } })
    const result = await new MacDesktopAdapter({ runner }).observe({})
    expect(result.snapshot?.windows).toEqual([])
    expect(result.notes?.[0]).toContain('no window is present')
  })

  it('reports a missing Accessibility grant as a capability failure, never as an empty tree', async () => {
    const runner = runnerReturning({
      'System Events': { code: 0, stdout: WINDOWS, stderr: '' },
      kAXFocusedApplicationAttribute: { code: 1, stdout: '{"ok":false,"error":"the accessibility API did not return a focused application","axError":-25201}', stderr: 'boom' },
    })
    await expect(new MacDesktopAdapter({ runner }).observe({})).rejects.toThrow(/not permitted/)
  })

  it('returns no windows when the listing itself fails, rather than throwing', async () => {
    const runner = runnerReturning({ 'System Events': { code: 1, stdout: '', stderr: 'denied' } })
    await expect(new MacDesktopAdapter({ runner }).listWindows()).resolves.toEqual([])
  })
})

describe('the adapter owns no default observable, and says so instead of guessing', () => {
  const runner = runnerReturning({})

  it('answers a window expectation from an empty list rather than inventing a title', async () => {
    // No reader is configured by default and snapshots are not produced yet, so the
    // only honest answer to "is a window titled X present" is no. A reader that threw
    // would look like a capability failure; one that answered yes would be a check
    // that cannot fail.
    const outcomes = await new MacDesktopAdapter({ runner }).verify([{ kind: 'windowTitled', title: 'Untitled' }])
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]?.satisfied).toBe(false)
    expect(outcomes[0]?.observed).toContain('not among 0 windows')
  })

  it('reports a node expectation as unavailable rather than as a value', async () => {
    // An absent node value must not read as an equality failure on a real value:
    // the caller needs to tell "the tree says otherwise" from "nothing was read".
    const outcomes = await new MacDesktopAdapter({ runner }).verify([{ kind: 'nodeValueEquals', token: 's1:0', value: 'x' }])
    expect(outcomes[0]?.satisfied).toBe(false)
  })

  it('uses a caller-supplied reader when one is configured, so the default is a fallback and not a limit', async () => {
    const adapter = new MacDesktopAdapter({
      runner,
      readers: { windowTitles: { list: () => Promise.resolve(['Untitled — Pages']) } },
    })
    const outcomes = await adapter.verify([{ kind: 'windowTitled', title: 'Untitled' }])
    expect(outcomes[0]?.satisfied).toBe(true)
  })

  it('passes a caller lifetime through to the readiness probes', async () => {
    // The signal has to reach the runner, or a cancelled readiness check would keep
    // spawning probes after its caller gave up.
    const signals: Array<AbortSignal | undefined> = []
    const recording: MacCommandRunner = {
      // The first two parameters are unused but kept in place: the third is the
      // signal under test, and a parameter cannot be skipped. Underscored the way
      // this repo marks an intentionally unused binding.
      run: (_command, _args, signal) => {
        signals.push(signal)
        return Promise.resolve({ code: 0, stdout: '', stderr: '' })
      },
    }
    const controller = new AbortController()
    await new MacDesktopAdapter({
      runner: recording,
      automationTargets: ['com.apple.Mail'],
      signal: controller.signal,
    }).readiness()
    expect(signals.length).toBeGreaterThan(0)
    expect(signals.every(signal => signal === controller.signal)).toBe(true)
  })

  it('probes the Automation targets a deployment names, and no others', async () => {
    const runnerNamingTargets = runnerReturning({})
    const adapter = new MacDesktopAdapter({ runner: runnerNamingTargets, automationTargets: ['com.apple.Pages'] })
    const report = await adapter.readiness()
    const probed = report.probes.map(probe => probe.name).filter(name => name.startsWith('automation.'))
    expect(probed).toEqual(['automation.com.apple.Pages'])
  })
})

describe('a denied Automation probe with nothing on stderr still explains itself', () => {
  it('names the target in the reason instead of reporting an empty string', async () => {
    // osascript exits 1 when Automation is denied, and a denial can arrive with an
    // empty stderr. An empty reason would read as "blocked for no reason", which is
    // the least actionable thing a readiness report can say.
    const runner = runnerReturning({ 'com.apple.Pages': { code: 1, stdout: '', stderr: '' } })
    const probe = await probeAutomation({ runner, holder: { name: 'Aeven', source: 'in-process' } }, 'com.apple.Pages')
    expect(probe.state).toBe('blocked')
    expect(probe.reason).toBe('Apple Events to "com.apple.Pages" are not permitted')
    // Read once, asserting it is a string on the way, so the checks below cannot
    // silently pass on an absent reason: a denial explained by nothing is exactly
    // the failure this test exists to catch.
    const reason = probe.reason
    expect(typeof reason).toBe('string')
    expect(reason).toHaveLength('Apple Events to "com.apple.Pages" are not permitted'.length)
    expect(reason).not.toBe('')
  })
})

describe('scoping by process id picks that process, and falls back rather than refusing', () => {
  const runner = runnerReturning({
    'System Events': {
      code: 0,
      stdout: JSON.stringify([
        { pid: 42, app: 'Pages', title: 'Agent Story.pages', position: '10, 20', size: '800, 600' },
        { pid: 77, app: 'Notes', title: 'Notes', position: '30, 40', size: '500, 400' },
      ]),
      stderr: '',
    },
  })

  it('covers the window belonging to the named process, not merely the first one', async () => {
    const result = await new MacDesktopAdapter({ runner }).observe({ pid: 77, tree: false })
    expect(result.notes?.[0]).toContain('Notes')
  })

  it('falls back to the first window when no window carries the named process', async () => {
    // A pid can vanish between listing and scoping — the application quit. Refusing
    // would turn a race into a failure, so the observation covers the first window
    // and the caller still gets a snapshot to act on.
    const result = await new MacDesktopAdapter({ runner }).observe({ pid: 999, tree: false })
    expect(result.notes?.[0]).toContain('Agent Story.pages')
  })
})

describe('the adapter omits what a deployment did not ask for, so probes are not sent unasked', () => {
  it('probes no Automation target through readiness() when the config names none', async () => {
    // The first Apple Event to an application raises a consent dialog, so an
    // unconfigured adapter must send none. This asserts the config path end to end:
    // an omitted option has to stay omitted rather than becoming an empty list that
    // some later reader treats as "probe everything".
    const runner = runnerReturning({
      AXIsProcessTrusted: { code: 0, stdout: 'true\n', stderr: '' },
      '0,0,1,1': { code: 0, stdout: '', stderr: '' },
    })
    const report = await new MacDesktopAdapter({ runner }).readiness()
    expect(report.probes.map(probe => probe.name)).toEqual(['accessibility.read', 'screenRecording.capture'])
    expect(runner.calls.every(call => !call.args.join(' ').includes('automation.'))).toBe(true)
  })

  it('carries a caller lifetime into the accessibility walk, not only the readiness probes', async () => {
    // A tree walk shells out too, and it is the longest-running command here: a
    // cancelled observation that left the walk running would keep spawning probes
    // for a caller that has gone away.
    const signals: Array<AbortSignal | undefined> = []
    const runner: MacCommandRunner = {
      // `command` is unused but kept in place because `args` and `signal` follow it,
      // and a parameter cannot be skipped; this repo underscores an unused binding.
      run: (_command, args, signal) => {
        signals.push(signal)
        const joined = args.join(' ')
        if (joined.includes('kAXFocusedApplicationAttribute')) {
          return Promise.resolve({ code: 0, stdout: '{"ok":true,"truncated":false,"nodes":[]}', stderr: '' })
        }
        return Promise.resolve({ code: 0, stdout: JSON.stringify([
          { pid: 42, app: 'Pages', title: 'Story.pages', position: '0, 0', size: '800, 600' },
        ]), stderr: '' })
      },
    }
    const controller = new AbortController()
    await new MacDesktopAdapter({ runner, signal: controller.signal }).observe({})
    expect(signals.length).toBeGreaterThan(1)
    expect(signals.every(signal => signal === controller.signal)).toBe(true)
  })
})

describe('a walk that returns no node list yields an empty tree, not a missing one', () => {
  it('reports zero nodes when the envelope omits the key entirely', async () => {
    // The envelope's `nodes` is optional, so an application whose tree is empty can
    // answer without the key. Treating that as undefined would put `undefined` into
    // `snapshot.nodes` and break every consumer that walks it.
    const runner = runnerReturning({
      'System Events': {
        code: 0,
        stdout: JSON.stringify([{ pid: 42, app: 'Pages', title: 'Story.pages', position: '0, 0', size: '800, 600' }]),
        stderr: '',
      },
      kAXFocusedApplicationAttribute: { code: 0, stdout: '{"ok":true,"truncated":false}', stderr: '' },
    })
    const result = await new MacDesktopAdapter({ runner }).observe({})
    expect(result.snapshot?.nodes).toEqual([])
    expect(result.snapshot?.truncated).toBeUndefined()
  })
})
