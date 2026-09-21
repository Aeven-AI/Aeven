/**
 * The Windows adapter: PowerShell resolution order, the readiness report that
 * says UI Automation needs no grant, UIA-pattern actions that never rely on
 * focus, the synthesised-input fallback that always fronts its exact window, and
 * the envelope parsing that turns a PowerShell failure into a real error.
 */

import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ComputerUseError } from '@aeven/computer-use-desktop'
import { WindowsDesktopAdapter } from '../src/index.ts'
import { candidatePowerShellPaths, quotePowerShellLiteral, resolvePowerShellPath, type WinCommandResult, type WinCommandRunner } from '../src/runner.ts'
import { probeElevation, probeUia, probeUiaPatterns, probeWindowsReadiness } from '../src/readiness.ts'

/** A runner answering from a table, recording every call. */
function runnerReturning(
  answers: Readonly<Record<string, WinCommandResult>>,
): WinCommandRunner & { calls: Array<{ command: string, args: readonly string[] }> } {
  const calls: Array<{ command: string, args: readonly string[] }> = []
  return {
    calls,
    run: (command, args) => {
      calls.push({ command, args })
      const joined = args.join(' ')
      for (const [needle, result] of Object.entries(answers)) {
        if (joined.includes(needle)) {
          return Promise.resolve(result)
        }
      }
      return Promise.resolve({ code: 0, stdout: '{"ok":true}', stderr: '' })
    },
  }
}

const json = (value: unknown): WinCommandResult => ({ code: 0, stdout: JSON.stringify(value), stderr: '' })

/** The window list the fake desktop reports. */
const WINDOWS_PAYLOAD = {
  ok: true,
  windows: [
    { windowId: '100', pid: 42, title: 'Agent Story.pages', bounds: { x: 10, y: 20, width: 800, height: 600 } },
    { windowId: '200', pid: 43, title: 'Inbox', bounds: { x: 0, y: 0, width: 0, height: 0 } },
  ],
}

/** The tree the fake window reports. */
const TREE_PAYLOAD = {
  ok: true,
  truncated: false,
  nodes: [
    { index: 0, role: 'WindowControlIdentifiers.Window', title: 'Agent Story.pages', value: null, actions: [], editable: false, bounds: { x: 10, y: 20, width: 800, height: 600 } },
    { index: 1, role: 'EditControlIdentifiers.Edit', title: 'Body', value: 'existing text', actions: ['ValuePatternIdentifiers.Pattern'], editable: true, bounds: { x: 20, y: 40, width: 700, height: 500 } },
  ],
}

describe('PowerShell resolution', () => {
  it('tries PowerShell 7 before PATH and Windows PowerShell last', () => {
    const candidates = candidatePowerShellPaths({
      ProgramFiles: 'C:\\Program Files',
      SystemRoot: 'C:\\Windows',
      PATH: 'C:\\tools;"C:\\quoted dir"',
    } as NodeJS.ProcessEnv)
    expect(candidates[0]).toBe(join('C:\\Program Files', 'PowerShell', '7', 'pwsh.exe'))
    expect(candidates).toContain(join('C:\\tools', 'pwsh.exe'))
    expect(candidates).toContain(join('C:\\quoted dir', 'pwsh.exe'))
    expect(candidates.at(-1)).toBe(join('C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'))
  })

  it('falls back to the documented defaults when the environment omits them', () => {
    const candidates = candidatePowerShellPaths({} as NodeJS.ProcessEnv)
    expect(candidates[0]).toBe(join('C:\\Program Files', 'PowerShell', '7', 'pwsh.exe'))
    expect(candidates.at(-1)).toBe(join('C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'))
  })

  it('skips empty PATH entries rather than resolving them to a directory', () => {
    const candidates = candidatePowerShellPaths({ PATH: ';;C:\\bin;', ProgramFiles: 'P', SystemRoot: 'S' } as NodeJS.ProcessEnv)
    expect(candidates).not.toContain('pwsh.exe')
    expect(candidates).toContain(join('C:\\bin', 'pwsh.exe'))
  })

  it('names every candidate it tried when none exists, since "pwsh not found" is not actionable', () => {
    expect(() => resolvePowerShellPath({ PATH: '', ProgramFiles: 'P', SystemRoot: 'S' } as NodeJS.ProcessEnv))
      .toThrow(/tried:/)
  })

  it('doubles single quotes so a value cannot break out of its literal', () => {
    expect(quotePowerShellLiteral("it's")).toBe("it''s")
  })
})

describe('Windows readiness', () => {
  it('reports UI Automation ready and says no grant is involved', async () => {
    const probe = await probeUia({ runner: runnerReturning({ UIAutomation: json({ ok: true, windows: 3, cap: 1 }) }) })
    expect(probe.state).toBe('ready')
    expect(probe.reason).toContain('no permission grant')
  })

  it('reports an unreachable desktop as unknown, not as a missing permission', async () => {
    const probe = await probeUia({ runner: runnerReturning({ UIAutomation: { code: 1, stdout: '', stderr: 'no desktop' } }) })
    expect(probe.state).toBe('unknown')
    expect(probe.code).toBe('desktop-unreachable')
    expect(probe.reason).toBe('no desktop')
  })

  it('falls back to a generic reason when the desktop probe fails silently', async () => {
    const probe = await probeUia({ runner: runnerReturning({ UIAutomation: { code: 1, stdout: '', stderr: '' } }) })
    expect(probe.reason).toBe('UI Automation could not read the desktop')
  })

  it('reports pattern availability separately from the tree', async () => {
    const ready = await probeUiaPatterns({ runner: runnerReturning({ UIAutomation: json({ ok: true }) }) })
    expect(ready.state).toBe('ready')
    const unknown = await probeUiaPatterns({ runner: runnerReturning({ UIAutomation: { code: 1, stdout: '', stderr: 'nope' } }) })
    expect(unknown.state).toBe('unknown')
    expect(unknown.reason).toBe('nope')
    const silent = await probeUiaPatterns({ runner: runnerReturning({ UIAutomation: { code: 1, stdout: '', stderr: '' } }) })
    expect(silent.reason).toBe('the pattern probe could not run, so pattern availability is unknown')
  })

  it('explains both elevation outcomes, because elevation decides which windows are addressable', async () => {
    const elevated = await probeElevation({ runner: runnerReturning({ IsInRole: json({ ok: true, elevated: true }) }) })
    expect(elevated.state).toBe('ready')
    expect(elevated.reason).toContain('elevated')

    const normal = await probeElevation({ runner: runnerReturning({ IsInRole: json({ ok: true, elevated: false }) }) })
    expect(normal.reason).toContain('not elevated')
    expect(normal.reason).toContain('not driven')
  })

  it('reports an unreadable or failed elevation probe as unknown rather than guessing', async () => {
    const unreadable = await probeElevation({ runner: runnerReturning({ IsInRole: { code: 0, stdout: 'not json', stderr: '' } }) })
    expect(unreadable.state).toBe('unknown')
    expect(unreadable.code).toBe('elevation-unreadable')

    const failed = await probeElevation({ runner: runnerReturning({ IsInRole: { code: 1, stdout: '', stderr: 'denied' } }) })
    expect(failed.state).toBe('unknown')
    expect(failed.reason).toBe('denied')

    const silent = await probeElevation({ runner: runnerReturning({ IsInRole: { code: 1, stdout: '', stderr: '' } }) })
    expect(silent.reason).toBe('the elevation probe could not run')
  })

  it('composes a report with no blockers on a healthy host, since nothing is gated', async () => {
    const runner = runnerReturning({
      UIAutomation: json({ ok: true, windows: 2, cap: 1 }),
      IsInRole: json({ ok: true, elevated: true }),
    })
    const report = await probeWindowsReadiness({ runner })
    expect(report.platform).toBe('win32')
    expect(report.blockers).toEqual([])
    expect(report.probes).toHaveLength(3)
  })
})

describe('observation', () => {
  const adapter = (runner: WinCommandRunner) => new WindowsDesktopAdapter({ runner, powershell: 'powershell' })

  it('lists windows with app identity and on-screen state derived from bounds', async () => {
    const windows = await adapter(runnerReturning({ RootElement: json(WINDOWS_PAYLOAD) })).listWindows()
    expect(windows).toHaveLength(2)
    expect(windows[0]?.title).toBe('Agent Story.pages')
    expect(windows[0]?.onScreen).toBe(true)
    expect(windows[1]?.onScreen).toBe(false)
  })

  it('mints tokens that carry their window, so a token can be validated before use', async () => {
    const runner = runnerReturning({ RootElement: json(WINDOWS_PAYLOAD), FindAll: json(TREE_PAYLOAD) })
    const result = await adapter(runner).observe({ windowId: '100' })
    expect(result.snapshot?.nodes.map(node => node.token)).toEqual(['100:0', '100:1'])
    expect(result.snapshot?.platform).toBe('win32')
  })

  it('omits empty titles and values instead of carrying empty strings', async () => {
    const runner = runnerReturning({
      RootElement: json(WINDOWS_PAYLOAD),
      FindAll: json({
        ok: true,
        nodes: [{ index: 0, role: 'Pane', title: '', value: '', actions: [], editable: false, bounds: { x: 0, y: 0, width: 1, height: 1 } }],
      }),
    })
    const result = await adapter(runner).observe({ windowId: '100' })
    expect(result.snapshot?.nodes[0]?.title).toBeUndefined()
    expect(result.snapshot?.nodes[0]?.value).toBeUndefined()
  })

  it('reports truncation so a cut tree is never mistaken for a complete one', async () => {
    const runner = runnerReturning({
      RootElement: json(WINDOWS_PAYLOAD),
      FindAll: json({ ok: true, truncated: true, nodes: TREE_PAYLOAD.nodes }),
    })
    const result = await adapter(runner).observe({ windowId: '100', maxNodes: 2 })
    expect(result.snapshot?.truncated).toBe(true)
    expect(result.notes?.[0]).toContain('stopped at 2 nodes')
  })

  it('refuses a window that is not present rather than observing the whole desktop', async () => {
    const runner = runnerReturning({ RootElement: json(WINDOWS_PAYLOAD) })
    await expect(adapter(runner).observe({ windowId: '999' })).rejects.toMatchObject({ code: 'invalid-target' })
  })

  it('notes a pid-scoped observation and skips the tree when it is disabled', async () => {
    const runner = runnerReturning({ RootElement: json(WINDOWS_PAYLOAD) })
    const result = await adapter(runner).observe({ pid: 42, tree: false })
    expect(result.notes?.[0]).toContain('pid 42')
    expect(result.snapshot?.nodes).toEqual([])
  })

  it('returns no notes when nothing needed explaining', async () => {
    const runner = runnerReturning({ RootElement: json(WINDOWS_PAYLOAD) })
    const result = await adapter(runner).observe({ tree: false })
    expect(result.notes).toBeUndefined()
  })

  it('observes an empty desktop without inventing a tree', async () => {
    const runner = runnerReturning({ RootElement: json({ ok: true, windows: [] }) })
    const result = await adapter(runner).observe({})
    expect(result.snapshot?.windows).toEqual([])
    expect(result.snapshot?.nodes).toEqual([])
  })
})

describe('semantic actions prefer UIA patterns over synthesised input', () => {
  const adapter = (runner: WinCommandRunner) => new WindowsDesktopAdapter({ runner, powershell: 'powershell' })

  it('writes through ValuePattern and reports how much it wrote', async () => {
    const runner = runnerReturning({ ValuePattern: json({ ok: true, wrote: 5 }) })
    const receipt = await adapter(runner).act({ kind: 'setValue', target: { kind: 'element', token: '100:1' }, value: 'hello' })
    expect(receipt.route).toBe('accessibility')
    expect(receipt.notes?.[0]).toContain('wrote 5 characters')
  })

  it('invokes an advertised pattern and names it', async () => {
    const runner = runnerReturning({ InvokePattern: json({ ok: true, invoked: 'InvokePatternIdentifiers.Pattern' }) })
    const receipt = await adapter(runner).act({
      kind: 'performAction',
      target: { kind: 'element', token: '100:1' },
      action: 'InvokePatternIdentifiers.Pattern',
    })
    expect(receipt.notes?.[0]).toContain('invoked InvokePatternIdentifiers.Pattern')
  })

  it('reports a failed fragment as the real error, not a generic failure', async () => {
    const runner = runnerReturning({ ValuePattern: json({ ok: false, error: 'the element does not support ValuePattern' }) })
    await expect(adapter(runner).act({ kind: 'setValue', target: { kind: 'element', token: '100:1' }, value: 'x' }))
      .rejects.toThrow(/does not support ValuePattern/)
  })

  it('reports an unreadable fragment as a capability failure with the output attached', async () => {
    const runner = runnerReturning({ ValuePattern: { code: 0, stdout: 'not json at all', stderr: '' } })
    await expect(adapter(runner).act({ kind: 'setValue', target: { kind: 'element', token: '100:1' }, value: 'x' }))
      .rejects.toMatchObject({ code: 'capability-unavailable' })
  })

  it('reports a fragment that produced nothing as a capability failure', async () => {
    const runner = runnerReturning({ ValuePattern: { code: 0, stdout: '   ', stderr: '' } })
    await expect(adapter(runner).act({ kind: 'setValue', target: { kind: 'element', token: '100:1' }, value: 'x' }))
      .rejects.toThrow(/produced no output/)
  })

  it('reports a failure with no reason reported rather than an empty message', async () => {
    const runner = runnerReturning({ ValuePattern: json({ ok: false }) })
    await expect(adapter(runner).act({ kind: 'setValue', target: { kind: 'element', token: '100:1' }, value: 'x' }))
      .rejects.toThrow(/without a reported reason/)
  })

  it('refuses a token that is not in window:ordinal form', async () => {
    const runner = runnerReturning({})
    await expect(adapter(runner).act({ kind: 'setValue', target: { kind: 'element', token: 'garbage' }, value: 'x' }))
      .rejects.toMatchObject({ code: 'invalid-target' })
    await expect(adapter(runner).act({ kind: 'setValue', target: { kind: 'element', token: ':3' }, value: 'x' }))
      .rejects.toMatchObject({ code: 'invalid-target' })
  })

  it('refuses a token whose ordinal is not a non-negative integer', async () => {
    const runner = runnerReturning({})
    for (const token of ['100:x', '100:-1']) {
      await expect(adapter(runner).act({ kind: 'setValue', target: { kind: 'element', token }, value: 'x' }))
        .rejects.toMatchObject({ code: 'invalid-target' })
    }
    expect(runner.calls).toHaveLength(0)
  })

  it('refuses an element-less target for a semantic action', async () => {
    const runner = runnerReturning({})
    await expect(
      adapter(runner).act({ kind: 'setValue', target: { kind: 'element', token: '100:1' }, value: 'x' }),
    ).resolves.toBeDefined()
    await expect(
      adapter(runner).act({ kind: 'performAction', target: { kind: 'window', pid: 1, windowId: 'w' }, action: 'press' } as never),
    ).rejects.toBeDefined()
  })
})

describe('focus is best-effort and says what actually happened', () => {
  it('reports the fronting result rather than assuming it worked', async () => {
    const runner = runnerReturning({ SetForegroundWindow: json({ ok: true, requested: false, foregrounded: false }) })
    const receipt = await new WindowsDesktopAdapter({ runner, powershell: 'powershell' })
      .act({ kind: 'focusWindow', target: { kind: 'window', pid: 1, windowId: '100' } })
    expect(receipt.route).toBe('accessibility')
    expect(runner.calls[0]?.args.join(' ')).toContain('SetForegroundWindow')
  })
})

describe('synthesised input is the fallback and always names its window', () => {
  const adapter = (runner: WinCommandRunner) => new WindowsDesktopAdapter({ runner, powershell: 'powershell' })

  it('fronts the exact window before typing and refuses if fronting did not happen', async () => {
    const runner = runnerReturning({})
    await adapter(runner).act({ kind: 'type', target: { kind: 'window', pid: 1, windowId: '100' }, text: 'hello' })
    const script = runner.calls[0]?.args.join(' ') ?? ''
    expect(script).toContain('Assert-Fronted')
    expect(script).toContain('did not come to the foreground')
    expect(script).toContain("SendWait('hello')")
  })

  it('escapes SendKeys metacharacters so typed text cannot become a chord', async () => {
    const runner = runnerReturning({})
    await adapter(runner).act({ kind: 'type', target: { kind: 'window', pid: 1, windowId: '100' }, text: 'a+b^c%d~e(f)g' })
    const script = runner.calls[0]?.args.join(' ') ?? ''
    expect(script).toContain('a{+}b{^}c{%}d{~}e{(}f{)}g')
  })

  it('translates named keys and modifiers into SendKeys notation', async () => {
    const runner = runnerReturning({})
    await adapter(runner).act({ kind: 'key', target: { kind: 'window', pid: 1, windowId: '100' }, key: 'return', modifiers: ['ctrl', 'shift'] })
    expect(runner.calls[0]?.args.join(' ')).toContain("SendWait('^+{ENTER}')")
  })

  it('accepts every documented modifier synonym', async () => {
    const runner = runnerReturning({})
    // 'cmd'/'command' and 'control'/'ctrl' are the same modifier, as are
    // 'alt'/'option', so each alias pair is checked on its own.
    await adapter(runner).act({ kind: 'key', target: { kind: 'window', pid: 1, windowId: '100' }, key: 'a', modifiers: ['command', 'option'] })
    expect(runner.calls[0]?.args.join(' ')).toContain("SendWait('^%a')")

    await adapter(runner).act({ kind: 'key', target: { kind: 'window', pid: 1, windowId: '100' }, key: 'a', modifiers: ['control', 'alt'] })
    expect(runner.calls[1]?.args.join(' ')).toContain("SendWait('^%a')")

    await adapter(runner).act({ kind: 'key', target: { kind: 'window', pid: 1, windowId: '100' }, key: 'a', modifiers: ['ctrl'] })
    expect(runner.calls[2]?.args.join(' ')).toContain("SendWait('^a')")
  })

  it('sends an unmapped key as its literal character', async () => {
    const runner = runnerReturning({})
    await adapter(runner).act({ kind: 'key', target: { kind: 'window', pid: 1, windowId: '100' }, key: 'F5' })
    expect(runner.calls[0]?.args.join(' ')).toContain("SendWait('F5')")
  })

  it('refuses an unrecognised modifier rather than silently dropping the chord', async () => {
    const runner = runnerReturning({})
    await expect(
      adapter(runner).act({ kind: 'key', target: { kind: 'window', pid: 1, windowId: '100' }, key: 'a', modifiers: ['hyper'] }),
    ).rejects.toMatchObject({ code: 'invalid-target' })
    expect(runner.calls).toHaveLength(0)
  })

  it('clicks at scoped coordinates only after fronting the window', async () => {
    const runner = runnerReturning({})
    await adapter(runner).act({
      kind: 'click',
      target: { kind: 'point', x: 10.4, y: 20.6, window: { kind: 'window', pid: 1, windowId: '100' } },
    })
    const script = runner.calls[0]?.args.join(' ') ?? ''
    expect(script).toContain('SetCursorPos(10, 21)')
    expect(script).toContain('mouse_event(0x0002, 0x0004')
  })

  it('uses the right-button flags for a right click and honours the click count', async () => {
    const runner = runnerReturning({})
    await adapter(runner).act({
      kind: 'click',
      target: { kind: 'point', x: 1, y: 2, window: { kind: 'window', pid: 1, windowId: '100' } },
      button: 'right',
      count: 2,
    })
    const script = runner.calls[0]?.args.join(' ') ?? ''
    expect(script).toContain('mouse_event(0x0008, 0x0010')
    expect(script).toContain('1..2')
  })

  it('refuses unscoped coordinates, which is how input reaches the wrong window', async () => {
    const runner = runnerReturning({})
    await expect(adapter(runner).act({ kind: 'click', target: { kind: 'point', x: 1, y: 2 } }))
      .rejects.toMatchObject({ code: 'invalid-target' })
    expect(runner.calls).toHaveLength(0)
  })

  it('refuses a click that names a window but no coordinates', async () => {
    const runner = runnerReturning({})
    await expect(
      adapter(runner).act({ kind: 'click', target: { kind: 'window', pid: 1, windowId: '100' } }),
    ).rejects.toMatchObject({ code: 'invalid-target' })
  })

  it('refuses element-addressed input and points at the pattern actions instead', async () => {
    const runner = runnerReturning({})
    await expect(adapter(runner).act({ kind: 'type', target: { kind: 'element', token: '100:1' }, text: 'x' }))
      .rejects.toThrow(/setValue or performAction/)
    expect(runner.calls).toHaveLength(0)
  })
})

describe('verification on Windows', () => {
  it('reads window titles through the adapter when no reader is supplied', async () => {
    const runner = runnerReturning({ RootElement: json(WINDOWS_PAYLOAD) })
    const adapter = new WindowsDesktopAdapter({ runner, powershell: 'powershell' })
    const [match] = await adapter.verify([{ kind: 'windowTitled', title: 'Agent Story' }])
    expect(match?.satisfied).toBe(true)
    const [mismatch] = await adapter.verify([{ kind: 'windowTitled', title: 'Absent' }])
    expect(mismatch?.satisfied).toBe(false)
  })

  it('fails an element check when no node reader is configured', async () => {
    const runner = runnerReturning({})
    const adapter = new WindowsDesktopAdapter({ runner, powershell: 'powershell' })
    const [outcome] = await adapter.verify([{ kind: 'nodeValueEquals', token: '100:1', value: 'x' }])
    expect(outcome?.satisfied).toBe(false)
    expect(outcome?.observed).toBe('node not found')
  })

  it('reads the real filesystem, which is the strongest portable evidence', async () => {
    const adapter = new WindowsDesktopAdapter({ runner: runnerReturning({}), powershell: 'powershell' })
    const [outcome] = await adapter.verify([{ kind: 'fileExists', path: import.meta.filename }])
    expect(outcome?.satisfied).toBe(true)
  })
})

describe('token resolution', () => {
  it('resolves a token to the element it currently names', async () => {
    const runner = runnerReturning({ FindAll: json({ ok: true, role: 'EditControlIdentifiers.Edit', name: 'Body' }) })
    const resolved = await new WindowsDesktopAdapter({ runner, powershell: 'powershell' }).resolveToken('100:1')
    expect(resolved).toEqual({ role: 'EditControlIdentifiers.Edit', name: 'Body' })
  })

  it('surfaces a resolution failure rather than returning an identity it did not read', async () => {
    const runner = runnerReturning({ FindAll: json({ ok: false, error: 'no element at index 9' }) })
    await expect(new WindowsDesktopAdapter({ runner, powershell: 'powershell' }).resolveToken('100:9'))
      .rejects.toThrow(/no element at index 9/)
  })

  it('refuses a token without a window before running anything', async () => {
    const runner = runnerReturning({})
    await expect(new WindowsDesktopAdapter({ runner, powershell: 'powershell' }).resolveToken('nope'))
      .rejects.toBeInstanceOf(ComputerUseError)
  })
})
