/**
 * The Linux adapter: session-fact derivation, the backend ladder that reports
 * which compositor answered, the input ladder, readiness that names what is
 * missing, and the refusals that keep an unreadable tree from looking like an
 * application with no UI.
 */

import { describe, expect, it } from 'vitest'
import { ComputerUseError } from '@aeven/computer-use-desktop'
import { LinuxDesktopAdapter } from '../src/index.ts'
import { WINDOW_BACKENDS } from '../src/backends.ts'
import {
  probeAtspi,
  probeInput,
  probeLinuxReadiness,
  probeSessionBus,
  probeWindowBackend,
} from '../src/readiness.ts'
import { commandAnswers, describeLinuxHost, type LinuxCommandResult, type LinuxCommandRunner } from '../src/runner.ts'

/** A runner answering from a table, recording every call. */
function runnerReturning(
  answers: Readonly<Record<string, LinuxCommandResult>>,
): LinuxCommandRunner & { calls: Array<{ command: string, args: readonly string[] }> } {
  const calls: Array<{ command: string, args: readonly string[] }> = []
  return {
    calls,
    run: (command, args) => {
      calls.push({ command, args })
      const joined = `${command} ${args.join(' ')}`
      for (const [needle, result] of Object.entries(answers)) {
        if (joined.includes(needle)) {
          return Promise.resolve(result)
        }
      }
      return Promise.resolve({ code: 1, stdout: '', stderr: 'not found' })
    },
  }
}

const found: LinuxCommandResult = { code: 0, stdout: '', stderr: '' }

/** wmctrl output with a title containing spaces. */
const WMCTRL = `0x04600003  0 1234  100 200 800 600 host Agent Story.pages
0x04600004  0 4321    0   0   0   0 host Inbox`

const HYPRCTL = JSON.stringify([
  { address: '0xabc', pid: 42, title: 'Agent Story.pages', at: [10, 20], size: [800, 600] },
])

const I3TREE = JSON.stringify({
  id: 1,
  rect: { x: 0, y: 0, width: 1920, height: 1080 },
  nodes: [
    { id: 2, window: 99, pid: 7, name: 'Agent Story.pages', rect: { x: 5, y: 6, width: 700, height: 500 }, nodes: [], floating_nodes: [] },
  ],
  floating_nodes: [],
})

describe('session facts', () => {
  it('detects X11 and Wayland from their display variables', () => {
    expect(describeLinuxHost({ DISPLAY: ':0' } as NodeJS.ProcessEnv).hasX11).toBe(true)
    expect(describeLinuxHost({ WAYLAND_DISPLAY: 'wayland-0' } as NodeJS.ProcessEnv).hasWayland).toBe(true)
  })

  it('records the desktop identifier, preferring XDG_CURRENT_DESKTOP', () => {
    expect(describeLinuxHost({ XDG_CURRENT_DESKTOP: 'GNOME', DESKTOP_SESSION: 'gnome' } as NodeJS.ProcessEnv).desktop).toBe('GNOME')
    expect(describeLinuxHost({ DESKTOP_SESSION: 'plasma' } as NodeJS.ProcessEnv).desktop).toBe('plasma')
  })

  it('omits the desktop when neither variable is set, rather than reporting an empty name', () => {
    expect(describeLinuxHost({} as NodeJS.ProcessEnv).desktop).toBeUndefined()
    expect(describeLinuxHost({ XDG_CURRENT_DESKTOP: '' } as NodeJS.ProcessEnv).desktop).toBeUndefined()
  })

  it('treats an empty display value as absent', () => {
    const host = describeLinuxHost({ DISPLAY: '', WAYLAND_DISPLAY: '' } as NodeJS.ProcessEnv)
    expect(host.hasX11).toBe(false)
    expect(host.hasWayland).toBe(false)
  })
})

describe('command presence is determined by running the tool', () => {
  it('reports true only when the command answered', async () => {
    expect(await commandAnswers(runnerReturning({ xdotool: found }), 'xdotool', ['--version'], { hasX11: true, hasWayland: false })).toBe(true)
    expect(await commandAnswers(runnerReturning({}), 'xdotool', ['--version'], { hasX11: true, hasWayland: false })).toBe(false)
  })
})

describe('window backends declare their own formats', () => {
  it('parses Hyprland clients, taking position and size from their tuples', () => {
    const windows = WINDOW_BACKENDS[0]?.parse(HYPRCTL)
    expect(windows?.[0]).toEqual({
      windowId: '0xabc',
      pid: 42,
      title: 'Agent Story.pages',
      bounds: { x: 10, y: 20, width: 800, height: 600 },
    })
  })

  it('flattens an i3 tree and keeps only nodes carrying a window id', () => {
    const windows = WINDOW_BACKENDS[1]?.parse(I3TREE)
    expect(windows).toHaveLength(1)
    expect(windows?.[0]?.windowId).toBe('99')
  })

  it('parses wmctrl columns and keeps a title that contains spaces', () => {
    const windows = WINDOW_BACKENDS[2]!.parse(WMCTRL)
    expect(windows).toHaveLength(2)
    expect(windows[0]?.title).toBe('Agent Story.pages')
    expect(windows[0]?.bounds).toEqual({ x: 100, y: 200, width: 800, height: 600 })
  })

  it('skips a truncated wmctrl line instead of reading fields that are not there', () => {
    expect(WINDOW_BACKENDS[2]?.parse('0x1 0 1 2 3')).toEqual([])
  })

  it('sends each backend its own focus syntax', () => {
    expect(WINDOW_BACKENDS[0]?.focusArgs('0xabc')).toEqual(['dispatch', 'focuswindow', 'address:0xabc'])
    expect(WINDOW_BACKENDS[1]?.focusArgs('99')).toEqual(['[id=99]', 'focus'])
    expect(WINDOW_BACKENDS[2]?.focusArgs('0x1')).toEqual(['-i', '-a', '0x1'])
  })
})

describe('readiness names what is missing', () => {
  const host = { hasX11: true, hasWayland: false }

  it('reports the session bus ready when busctl answers', async () => {
    const probe = await probeSessionBus({ runner: runnerReturning({ busctl: found }), host })
    expect(probe.state).toBe('ready')
  })

  it('reports a missing session bus as unknown, since it is a session fact rather than a grant', async () => {
    const probe = await probeSessionBus({ runner: runnerReturning({}), host })
    expect(probe.state).toBe('unknown')
    expect(probe.code).toBe('no-session-bus')
  })

  it('reports AT-SPI blocked with the remedy that enables it', async () => {
    const probe = await probeAtspi({ runner: runnerReturning({}), host })
    expect(probe.state).toBe('blocked')
    expect(probe.remedy).toContain('toolkit-accessibility')
  })

  it('reports the backend that answered, by name', async () => {
    const probe = await probeWindowBackend({ runner: runnerReturning({ hyprctl: { code: 0, stdout: HYPRCTL, stderr: '' } }), host })
    expect(probe.state).toBe('ready')
    expect(probe.reason).toContain('hyprland')
  })

  it('falls through to EWMH when the compositor-specific backends are absent', async () => {
    const probe = await probeWindowBackend({ runner: runnerReturning({ wmctrl: { code: 0, stdout: WMCTRL, stderr: '' } }), host })
    expect(probe.reason).toContain('ewmh')
  })

  it('names every backend it tried when none answers, because "no windows" is not a diagnosis', async () => {
    const probe = await probeWindowBackend({ runner: runnerReturning({}), host })
    expect(probe.state).toBe('blocked')
    expect(probe.code).toBe('no-window-backend')
    expect(probe.reason).toContain('hyprland')
    expect(probe.reason).toContain('i3')
    expect(probe.reason).toContain('ewmh')
    expect(probe.remedy).toContain('wmctrl')
  })

  it('treats unparseable backend output as a failed backend rather than as zero windows', async () => {
    const probe = await probeWindowBackend({
      runner: runnerReturning({ hyprctl: { code: 0, stdout: 'not json', stderr: '' }, wmctrl: { code: 0, stdout: WMCTRL, stderr: '' } }),
      host,
    })
    expect(probe.reason).toContain('ewmh')
  })

  it('prefers xdotool on X11 and says so', async () => {
    const probe = await probeInput({ runner: runnerReturning({ xdotool: found }), host })
    expect(probe.state).toBe('ready')
    expect(probe.reason).toContain('XTEST')
  })

  it('falls back to wtype and then ydotool on Wayland', async () => {
    const wayland = { hasX11: false, hasWayland: true }
    expect((await probeInput({ runner: runnerReturning({ wtype: found }), host: wayland })).reason).toContain('wtype')
    expect((await probeInput({ runner: runnerReturning({ ydotool: found }), host: wayland })).reason).toContain('uinput')
  })

  it('gives a Wayland-specific remedy when no input tool answers', async () => {
    const probe = await probeInput({ runner: runnerReturning({}), host: { hasX11: false, hasWayland: true } })
    expect(probe.state).toBe('blocked')
    expect(probe.remedy).toContain('ydotoold')
    expect(probe.remedy).toContain('wtype')
  })

  it('gives an X11-specific remedy when no input tool answers there', async () => {
    const probe = await probeInput({ runner: runnerReturning({}), host })
    expect(probe.remedy).toContain('xdotool')
  })

  it('composes a report whose blockers match the probes and whose next step comes from the first blocker', async () => {
    const report = await probeLinuxReadiness({ runner: runnerReturning({ busctl: found }), host })
    expect(report.platform).toBe('linux')
    expect(report.blockers).toEqual(['atspi.tree', 'windowing.backend', 'input.synthesis'])
    expect(report.recommendedNextStep).toContain('toolkit-accessibility')
  })
})

describe('observation reports which backend answered', () => {
  it('lists windows and names the backend in a note', async () => {
    const runner = runnerReturning({ wmctrl: { code: 0, stdout: WMCTRL, stderr: '' } })
    const adapter = new LinuxDesktopAdapter({ runner, host: { hasX11: true, hasWayland: false } })
    const result = await adapter.observe({})
    expect(result.snapshot?.windows).toHaveLength(2)
    expect(result.notes?.[0]).toContain('ewmh')
    expect(result.snapshot?.platform).toBe('linux')
  })

  it('says plainly that no accessibility nodes are returned yet', async () => {
    const runner = runnerReturning({ wmctrl: { code: 0, stdout: WMCTRL, stderr: '' } })
    const adapter = new LinuxDesktopAdapter({ runner, host: { hasX11: true, hasWayland: false } })
    const result = await adapter.observe({})
    expect(result.notes?.[1]).toContain('AT-SPI tree is not implemented')
    expect(result.snapshot?.nodes).toEqual([])
  })

  it('marks a zero-sized window as off screen', async () => {
    const runner = runnerReturning({ wmctrl: { code: 0, stdout: WMCTRL, stderr: '' } })
    const adapter = new LinuxDesktopAdapter({ runner, host: { hasX11: true, hasWayland: false } })
    const result = await adapter.observe({})
    expect(result.snapshot?.windows[1]?.onScreen).toBe(false)
  })

  it('scopes to one window and refuses an absent one', async () => {
    const runner = runnerReturning({ wmctrl: { code: 0, stdout: WMCTRL, stderr: '' } })
    const adapter = new LinuxDesktopAdapter({ runner, host: { hasX11: true, hasWayland: false } })
    const scoped = await adapter.observe({ windowId: '0x04600003' })
    expect(scoped.snapshot?.windows).toHaveLength(1)
    await expect(adapter.observe({ windowId: '0xdeadbeef' })).rejects.toMatchObject({ code: 'invalid-target' })
  })

  it('refuses to observe when no backend answers, rather than reporting an empty desktop', async () => {
    const adapter = new LinuxDesktopAdapter({ runner: runnerReturning({}), host: { hasX11: true, hasWayland: false } })
    await expect(adapter.observe({})).rejects.toMatchObject({ code: 'capability-unavailable' })
  })

  it('lists nothing rather than throwing when asked only for a window list', async () => {
    const adapter = new LinuxDesktopAdapter({ runner: runnerReturning({}), host: { hasX11: true, hasWayland: false } })
    await expect(adapter.listWindows()).resolves.toEqual([])
  })
})

describe('input goes through the ladder and always names its window', () => {
  const host = { hasX11: true, hasWayland: false }
  const adapter = (runner: LinuxCommandRunner) => new LinuxDesktopAdapter({ runner, host })

  it('focuses through a backend and then types through xdotool', async () => {
    const runner = runnerReturning({ wmctrl: found, xdotool: found })
    const receipt = await adapter(runner).act({ kind: 'type', target: { kind: 'window', pid: 1, windowId: '0x1' }, text: 'hello' })
    expect(receipt.route).toBe('native-input')
    expect(receipt.notes?.[0]).toContain('xdotool')
  })

  it('falls back to wtype when xdotool refuses', async () => {
    const runner = runnerReturning({ wmctrl: found, wtype: found })
    const receipt = await adapter(runner).act({ kind: 'type', target: { kind: 'window', pid: 1, windowId: '0x1' }, text: 'hello' })
    expect(receipt.notes?.[0]).toContain('wtype')
  })

  it('falls back to ydotool when neither xdotool nor wtype answers', async () => {
    const runner = runnerReturning({ wmctrl: found, ydotool: found })
    const receipt = await adapter(runner).act({ kind: 'type', target: { kind: 'window', pid: 1, windowId: '0x1' }, text: 'hello' })
    expect(receipt.notes?.[0]).toContain('ydotool')
  })

  it('reports a capability failure when no input tool accepts the text', async () => {
    const runner = runnerReturning({ wmctrl: found })
    await expect(adapter(runner).act({ kind: 'type', target: { kind: 'window', pid: 1, windowId: '0x1' }, text: 'x' }))
      .rejects.toThrow(/no input tool accepted the text/)
  })

  it('translates modifiers into the chord form the tools expect', async () => {
    const runner = runnerReturning({ wmctrl: found, xdotool: found })
    await adapter(runner).act({ kind: 'key', target: { kind: 'window', pid: 1, windowId: '0x1' }, key: 's', modifiers: ['cmd', 'shift'] })
    expect(runner.calls.at(-1)?.args.join(' ')).toContain('super+shift+s')
  })

  it('accepts every documented modifier synonym', async () => {
    const runner = runnerReturning({ wmctrl: found, xdotool: found })
    for (const [modifiers, expected] of [
      [['command', 'ctrl'], 'super+ctrl'],
      [['control', 'alt'], 'ctrl+alt'],
      [['option'], 'alt'],
    ] as const) {
      await adapter(runner).act({ kind: 'key', target: { kind: 'window', pid: 1, windowId: '0x1' }, key: 'a', modifiers: [...modifiers] })
      expect(runner.calls.at(-1)?.args.join(' ')).toContain(`${expected}+a`)
    }
  })

  it('refuses an unrecognised modifier rather than silently dropping it', async () => {
    const runner = runnerReturning({ wmctrl: found })
    await expect(
      adapter(runner).act({ kind: 'key', target: { kind: 'window', pid: 1, windowId: '0x1' }, key: 'a', modifiers: ['hyper'] }),
    ).rejects.toMatchObject({ code: 'invalid-target' })
  })

  it('refuses unscoped input, which is how keystrokes reach the wrong window', async () => {
    const runner = runnerReturning({})
    await expect(adapter(runner).act({ kind: 'type', target: { kind: 'point', x: 1, y: 2 }, text: 'x' }))
      .rejects.toMatchObject({ code: 'invalid-target' })
    expect(runner.calls).toHaveLength(0)
  })

  it('accepts point-scoped input once it names its window', async () => {
    const runner = runnerReturning({ wmctrl: found, xdotool: found })
    const receipt = await adapter(runner).act({
      kind: 'type',
      target: { kind: 'point', x: 1, y: 2, window: { kind: 'window', pid: 1, windowId: '0x1' } },
      text: 'x',
    })
    expect(receipt.route).toBe('native-input')
  })

  it('refuses element-addressed input rather than acting on the wrong element', async () => {
    const runner = runnerReturning({})
    await expect(adapter(runner).act({ kind: 'type', target: { kind: 'element', token: 'x:0' }, text: 'x' }))
      .rejects.toMatchObject({ code: 'not-implemented' })
    expect(runner.calls).toHaveLength(0)
  })
})

describe('focus and unimplemented actions', () => {
  const host = { hasX11: true, hasWayland: false }

  it('focuses through the first backend that accepts the id and names it', async () => {
    const runner = runnerReturning({ wmctrl: found })
    const receipt = await new LinuxDesktopAdapter({ runner, host }).act({ kind: 'focusWindow', target: { kind: 'window', pid: 1, windowId: '0x1' } })
    expect(receipt.notes?.[0]).toContain('ewmh')
  })

  it('reports which backends were tried when none can focus the window', async () => {
    const runner = runnerReturning({})
    await expect(
      new LinuxDesktopAdapter({ runner, host }).act({ kind: 'focusWindow', target: { kind: 'window', pid: 1, windowId: '0x1' } }),
    ).rejects.toMatchObject({ code: 'capability-unavailable' })
  })

  it('refuses click, setValue and performAction with the missing piece named', async () => {
    const runner = runnerReturning({})
    const adapter = new LinuxDesktopAdapter({ runner, host })
    for (const action of [
      { kind: 'click', target: { kind: 'point', x: 1, y: 2, window: { kind: 'window', pid: 1, windowId: 'w' } } },
      { kind: 'setValue', target: { kind: 'element', token: 'x:0' }, value: 'v' },
      { kind: 'performAction', target: { kind: 'element', token: 'x:0' }, action: 'press' },
    ] as const) {
      await expect(adapter.act(action)).rejects.toBeInstanceOf(ComputerUseError)
    }
    expect(runner.calls).toHaveLength(0)
  })
})

describe('verification on Linux', () => {
  it('reads window titles through the adapter when no reader is supplied', async () => {
    const runner = runnerReturning({ wmctrl: { code: 0, stdout: WMCTRL, stderr: '' } })
    const adapter = new LinuxDesktopAdapter({ runner, host: { hasX11: true, hasWayland: false } })
    const [match] = await adapter.verify([{ kind: 'windowTitled', title: 'Agent Story' }])
    expect(match?.satisfied).toBe(true)
  })

  it('reports no windows rather than throwing when the backend is missing', async () => {
    const adapter = new LinuxDesktopAdapter({ runner: runnerReturning({}), host: { hasX11: true, hasWayland: false } })
    const [outcome] = await adapter.verify([{ kind: 'windowTitled', title: 'Anything' }])
    expect(outcome?.satisfied).toBe(false)
    expect(outcome?.observed).toContain('not among 0 windows')
  })

  it('reads the real filesystem, which is the strongest portable evidence', async () => {
    const adapter = new LinuxDesktopAdapter({ runner: runnerReturning({}), host: { hasX11: true, hasWayland: false } })
    const [outcome] = await adapter.verify([{ kind: 'fileExists', path: import.meta.filename }])
    expect(outcome?.satisfied).toBe(true)
  })
})
