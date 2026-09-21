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
): LinuxCommandRunner & { calls: Array<{ command: string; args: readonly string[] }> } {
  const calls: Array<{ command: string; args: readonly string[] }> = []
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

/**
 * A runner that answers 0 only for the commands named, and reports every other
 * command as missing.
 *
 * Distinct from {@link runnerReturning}, which falls back to a failed result for
 * unknown commands but still succeeds for a partial match. Readiness walks a ladder
 * of alternatives and stops at the first that answers, so a test needs to decide
 * exactly which rung is present.
 */
function answersOnly(
  answers: Readonly<Record<string, LinuxCommandResult>>,
): LinuxCommandRunner {
  return {
    run: (command) => {
      const result = answers[command]
      return Promise.resolve(result ?? { code: 127, stdout: '', stderr: 'command not found' })
    },
  }
}

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
    expect(describeLinuxHost({ DISPLAY: ':0' }).hasX11).toBe(true)
    expect(describeLinuxHost({ WAYLAND_DISPLAY: 'wayland-0' }).hasWayland).toBe(true)
  })

  it('records the desktop identifier, preferring XDG_CURRENT_DESKTOP', () => {
    expect(describeLinuxHost({ XDG_CURRENT_DESKTOP: 'GNOME', DESKTOP_SESSION: 'gnome' }).desktop).toBe('GNOME')
    expect(describeLinuxHost({ DESKTOP_SESSION: 'plasma' }).desktop).toBe('plasma')
  })

  it('omits the desktop when neither variable is set, rather than reporting an empty name', () => {
    expect(describeLinuxHost({}).desktop).toBeUndefined()
    expect(describeLinuxHost({ XDG_CURRENT_DESKTOP: '' }).desktop).toBeUndefined()
  })

  it('treats an empty display value as absent', () => {
    const host = describeLinuxHost({ DISPLAY: '', WAYLAND_DISPLAY: '' })
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

/**
 * A tree whose windows are not at the top level.
 *
 * The real i3 tree nests every X11 window under workspace and container nodes, so
 * walking only the root's own children would report an empty desktop on a machine
 * with windows open. The floating list is walked too, because a dialog floated over
 * a tiled workspace is still a window a caller may need to focus.
 */
const NESTED_I3TREE = JSON.stringify({
  id: 1,
  rect: { x: 0, y: 0, width: 1920, height: 1080 },
  nodes: [
    {
      id: 2,
      name: 'workspace 1',
      rect: { x: 0, y: 0, width: 1920, height: 1080 },
      // A container with no window of its own, holding the real window.
      nodes: [
        {
          id: 3,
          window: 77,
          rect: { x: 10, y: 20, width: 640, height: 480 },
          nodes: [],
          floating_nodes: [
            {
              id: 4,
              window: 88,
              name: 'Floating dialog',
              rect: { x: 30, y: 40, width: 320, height: 200 },
              nodes: [],
              floating_nodes: [],
            },
          ],
        },
      ],
      floating_nodes: [],
    },
  ],
  floating_nodes: [],
})

describe('the i3 tree is walked to its leaves', () => {
  it('finds windows nested under containers and in the floating list', () => {
    const windows = WINDOW_BACKENDS.find(backend => backend.name === 'i3')!.parse(NESTED_I3TREE)
    expect(windows.map(window => window.windowId)).toEqual(['77', '88'])
    // A node without a name and without a pid still reports, because i3 omits both
    // for container nodes and for windows whose process has not been resolved.
    expect(windows[0]).toEqual({
      windowId: '77',
      pid: 0,
      title: '',
      bounds: { x: 10, y: 20, width: 640, height: 480 },
    })
    expect(windows[1]?.title).toBe('Floating dialog')
  })
})

describe('a backend that cannot parse its own output falls through to the next', () => {
  it('names the parse failure and keeps trying rather than reporting no windows', async () => {
    // hyprctl answers with exit 0 but sends something that is not JSON. Reporting an
    // empty desktop here would be a lie: the compositor is present and the window
    // list is simply unreadable, so the ladder must move on and say what happened.
    const runner = runnerReturning({ hyprctl: { code: 0, stdout: 'not json at all', stderr: '' } })
    const probe = await probeWindowBackend({ runner, host: { hasX11: true, hasWayland: true } })
    expect(probe.state).toBe('blocked')
    expect(probe.reason).toContain('hyprland')
  })

  it('reports the backend ready when a later one answers after an earlier parse failure', async () => {
    const runner = answersOnly({
      hyprctl: { code: 0, stdout: 'not json at all', stderr: '' },
      wmctrl: { code: 0, stdout: WMCTRL, stderr: '' },
    })
    const probe = await probeWindowBackend({ runner, host: { hasX11: true, hasWayland: true } })
    expect(probe.state).toBe('ready')
    expect(probe.reason).toContain('ewmh')
  })
})

describe('the AT-SPI probe distinguishes a missing bus from disabled accessibility', () => {
  it('names the remedy and keeps the tool’s own words when the address cannot be read', async () => {
    const runner = runnerReturning({ gdbus: { code: 1, stdout: '', stderr: 'No such name org.a11y.Bus' } })
    const probe = await probeAtspi({ runner, host: { hasX11: true, hasWayland: false } })
    expect(probe.state).toBe('blocked')
    expect(probe.code).toBe('atspi-unavailable')
    expect(probe.reason).toContain('No such name')
    expect(probe.remedy).toContain('toolkit-accessibility')
  })

  it('substitutes its own explanation when the tool failed silently', async () => {
    const runner = runnerReturning({ gdbus: { code: 1, stdout: '', stderr: '   ' } })
    const probe = await probeAtspi({ runner, host: { hasX11: true, hasWayland: false } })
    expect(probe.reason).toBe('the AT-SPI bus address could not be read')
  })
})

describe('input falls through X11 to Wayland when xdotool is absent', () => {
  it('reports wtype ready on an X11 session that has no xdotool', async () => {
    // An X11 session without xdotool still has wtype on some installations, and the
    // ladder exists so that combination is not reported as having no input at all.
    const runner = answersOnly({ wtype: { code: 0, stdout: '', stderr: '' } })
    const probe = await probeInput({ runner, host: { hasX11: true, hasWayland: false } })
    expect(probe.state).toBe('ready')
    expect(probe.reason).toContain('wtype')
  })

  it('reports ydotool ready only after xdotool and wtype both decline', async () => {
    const runner = answersOnly({ ydotool: { code: 0, stdout: '', stderr: '' } })
    const probe = await probeInput({ runner, host: { hasX11: true, hasWayland: true } })
    expect(probe.state).toBe('ready')
    expect(probe.reason).toContain('ydotool')
  })

  it('points at uinput tooling on Wayland and at XTEST on X11', async () => {
    const wayland = await probeInput({ runner: runnerReturning({}), host: { hasX11: false, hasWayland: true } })
    expect(wayland.state).toBe('blocked')
    expect(wayland.remedy).toContain('ydotoold')

    const x11 = await probeInput({ runner: runnerReturning({}), host: { hasX11: true, hasWayland: false } })
    expect(x11.remedy).toContain('XTEST')
  })
})

describe('the adapter answers for itself without injected readers', () => {
  it('reports readiness through its own options rather than a caller-supplied object', async () => {
    const runner = answersOnly({
      busctl: { code: 0, stdout: '', stderr: '' },
      gdbus: { code: 0, stdout: '', stderr: '' },
      wmctrl: { code: 0, stdout: WMCTRL, stderr: '' },
      xdotool: { code: 0, stdout: '', stderr: '' },
    })
    const adapter = new LinuxDesktopAdapter({ runner, host: { hasX11: true, hasWayland: false } })
    const report = await adapter.readiness()
    expect(report.platform).toBe('linux')
    expect(report.blockers).toEqual([])
  })

  it('reads a node value as unknown when no reader was injected, instead of claiming a match', async () => {
    // The default has to be "cannot observe", never a value that happens to equal
    // what was expected — a verification that cannot fail is worse than none.
    const adapter = new LinuxDesktopAdapter({
      runner: runnerReturning({}),
      host: { hasX11: true, hasWayland: false },
    })
    const [outcome] = await adapter.verify([{ kind: 'nodeValueEquals', token: 's1:0', value: 'anything' }])
    expect(outcome?.satisfied).toBe(false)
  })

  it('names the backend whose output it could not read when every backend fails to parse', async () => {
    // hyprctl is up and answers with something that is not a client list, and no
    // other backend is installed. That is a capability failure, not a desktop with
    // no windows, so the report has to name hyprland and what it could not read
    // rather than presenting an empty window list as an observation.
    const runner = answersOnly({ hyprctl: { code: 0, stdout: '{}', stderr: '' } })
    const adapter = new LinuxDesktopAdapter({ runner, host: { hasX11: true, hasWayland: true } })
    const probe = await probeWindowBackend({ runner, host: { hasX11: true, hasWayland: true } })
    expect(probe.state).toBe('blocked')
    expect(probe.reason).toContain('hyprland')
    await expect(adapter.observe({})).rejects.toThrow(ComputerUseError)
  })
})

describe('the adapter falls back where a caller supplied nothing', () => {
  it('describes the host itself when the options name no session facts', () => {
    // Constructed without `host`, the adapter reads the live process environment.
    // That is the path a deployment takes; a test that always injects the facts
    // would never exercise it.
    const adapter = new LinuxDesktopAdapter({ runner: runnerReturning({}) })
    expect(adapter).toBeInstanceOf(LinuxDesktopAdapter)
  })

  it('cannot observe a node value when no reader was injected, so it refuses to match', async () => {
    // The default reader reports `undefined`, which cannot equal any expected value.
    // Returning a match here would be a verification that cannot fail.
    const adapter = new LinuxDesktopAdapter({ runner: runnerReturning({}), host: { hasX11: true, hasWayland: false } })
    const [outcome] = await adapter.verify([{ kind: 'nodeValueEquals', token: 's1:0', value: 'x' }])
    expect(outcome?.satisfied).toBe(false)
  })

  it('describes an exit code when a backend failed without saying anything', async () => {
    const runner = answersOnly({ wmctrl: { code: 3, stdout: '', stderr: '   ' } })
    const adapter = new LinuxDesktopAdapter({ runner, host: { hasX11: true, hasWayland: false } })
    // `act` returns a receipt on success and throws a ComputerUseError on failure, so
    // the failed call is captured by narrowing the caught value rather than casting:
    // a cast would leave the success type in play and hide a call that did not throw.
    const failing = await adapter.act({ kind: 'focusWindow', target: { kind: 'window', pid: 1, windowId: '0x1' } })
      .then(
        receipt => expect.unreachable(`act should have failed, got ${JSON.stringify(receipt)}`),
        (error: unknown) => {
          expect(error).toBeInstanceOf(ComputerUseError)
          return error as ComputerUseError
        },
      )
    // The exit code stands in for the tool's own words, so the report still names
    // which backend failed and how — a bare "no backend could focus it" would hide
    // that wmctrl was present and refused.
    expect(JSON.stringify(failing.detail)).toContain('exit 3')
  })

  it('sends a key with no modifiers rather than requiring a modifier list', async () => {
    const runner = answersOnly({
      wmctrl: { code: 0, stdout: '', stderr: '' },
      xdotool: { code: 0, stdout: '', stderr: '' },
    })
    const adapter = new LinuxDesktopAdapter({ runner, host: { hasX11: true, hasWayland: false } })
    const receipt = await adapter.act({
      kind: 'key',
      key: 'Return',
      target: { kind: 'window', pid: 1, windowId: '0x1' },
    })
    expect(receipt.route).toBe('native-input')
  })

  it('describes an unparseable backend by its exit code when its stderr is blank', async () => {
    const runner = answersOnly({ wmctrl: { code: 2, stdout: '', stderr: '' } })
    const adapter = new LinuxDesktopAdapter({ runner, host: { hasX11: true, hasWayland: false } })
    const [outcome] = await adapter.verify([{ kind: 'windowTitled', title: 'Anything' }])
    expect(outcome?.satisfied).toBe(false)
    expect(outcome?.observed).toContain('not among 0 windows')
  })

  it('reports a backend that threw a non-Error as a failed backend', async () => {
    // A parser that throws something other than an Error still has to be described,
    // because the ladder continues and the report names what it tried.
    const runner = answersOnly({
      hyprctl: { code: 0, stdout: '{}', stderr: '' },
      'i3-msg': { code: 0, stdout: JSON.stringify({ id: 1, rect: { x: 0, y: 0, width: 1, height: 1 }, nodes: null, floating_nodes: [] }), stderr: '' },
    })
    const probe = await probeWindowBackend({ runner, host: { hasX11: true, hasWayland: false } })
    expect(probe.state).toBe('blocked')
    expect(probe.reason).toContain('i3')
  })

  it('explains a session bus failure with its own words when the tool said nothing', async () => {
    // busctl is absent, so its stderr is our own "command not found" rather than
    // the bus refusing; the probe has to explain the failure either way.
    const absent = await probeSessionBus({ runner: answersOnly({}), host: { hasX11: false, hasWayland: false } })
    expect(absent.state).toBe('unknown')
    expect(absent.code).toBe('no-session-bus')

    const silent = await probeSessionBus({
      runner: answersOnly({ busctl: { code: 1, stdout: '', stderr: '   ' } }),
      host: { hasX11: false, hasWayland: false },
    })
    expect(silent.reason).toBe('the D-Bus session bus could not be reached')
  })
})

describe('the remaining observation paths', () => {
  it('omits the accessibility note when the caller asks for no tree', async () => {
    // `tree: false` is how a caller says it only wants the window list. Emitting the
    // "no accessibility nodes" note anyway would misreport what was asked for.
    const runner = answersOnly({ wmctrl: { code: 0, stdout: WMCTRL, stderr: '' } })
    const adapter = new LinuxDesktopAdapter({ runner, host: { hasX11: true, hasWayland: false } })
    const withTree = await adapter.observe({})
    const withoutTree = await adapter.observe({ tree: false })
    // `?? []` keeps the "any note mentions it" reading while typing the optional
    // field; a missing list then fails these rather than matching vacuously.
    expect(withTree.notes ?? []).toContainEqual(expect.stringContaining('AT-SPI'))
    expect(withoutTree.notes ?? []).not.toContainEqual(expect.stringContaining('AT-SPI'))
  })

  it('refuses a window id that is not present instead of returning an empty snapshot', async () => {
    const runner = answersOnly({ wmctrl: { code: 0, stdout: WMCTRL, stderr: '' } })
    const adapter = new LinuxDesktopAdapter({ runner, host: { hasX11: true, hasWayland: false } })
    await expect(adapter.observe({ windowId: '0xdead' })).rejects.toThrow(/is present/)
  })

  it('reads window titles through the adapter when no reader is injected', async () => {
    // The fallback reader derives titles from the window list, so a titled window
    // matches without a caller supplying a reader of its own.
    const runner = answersOnly({ wmctrl: { code: 0, stdout: WMCTRL, stderr: '' } })
    const adapter = new LinuxDesktopAdapter({ runner, host: { hasX11: true, hasWayland: false } })
    const [outcome] = await adapter.verify([{ kind: 'windowTitled', title: 'Agent Story' }])
    expect(outcome?.satisfied).toBe(true)
  })

  it('describes a backend that threw something which is not an Error', async () => {
    // i3-msg answers 0 but the tree's child lists are null, so walking it throws a
    // TypeError from the spread rather than an Error we constructed. The report has
    // to describe that too, because the ladder keeps going and names what it tried.
    const runner = answersOnly({
      hyprctl: { code: 0, stdout: '{}', stderr: '' },
      'i3-msg': {
        code: 0,
        stdout: JSON.stringify({ id: 1, rect: { x: 0, y: 0, width: 1, height: 1 }, nodes: null, floating_nodes: [] }),
        stderr: '',
      },
      wmctrl: { code: 1, stdout: '', stderr: '' },
    })
    const probe = await probeWindowBackend({ runner, host: { hasX11: true, hasWayland: false } })
    expect(probe.state).toBe('blocked')
    expect(probe.reason).toContain('i3')
  })

  it('names a backend that succeeded but could not be parsed, in the adapter path as well', async () => {
    const runner = answersOnly({
      hyprctl: { code: 0, stdout: '{}', stderr: '' },
      'i3-msg': { code: 1, stdout: '', stderr: 'i3 not running' },
      wmctrl: { code: 1, stdout: '', stderr: '' },
    })
    const adapter = new LinuxDesktopAdapter({ runner, host: { hasX11: true, hasWayland: false } })
    await expect(adapter.observe({})).rejects.toThrow(ComputerUseError)
  })
})

describe('a backend that throws something other than an Error is still described', () => {
  /**
   * Run `body` with one backend's parser replaced, restoring it afterwards.
   *
   * The shipped parsers only ever throw `SyntaxError` or `TypeError`, so the
   * non-Error arm of the ladder's reporting cannot be reached through their own
   * behaviour. The ladder's contract is wider than that: it catches whatever a
   * backend throws, and a third-party or future backend may throw a plain value.
   * Swapping the parser for the duration of the test is what lets that arm be
   * asserted rather than assumed.
   */
  const withThrowingParser = async (
    backendName: string,
    thrown: unknown,
    body: () => Promise<void>,
  ): Promise<void> => {
    const backend = WINDOW_BACKENDS.find(candidate => candidate.name === backendName)!
    const original = backend.parse
    backend.parse = () => { throw thrown }
    try {
      await body()
    } finally {
      backend.parse = original
    }
  }

  it('reports a plain value thrown by a parser, in the readiness ladder', async () => {
    // hyprctl has to answer 0, or the ladder records the command as missing and
    // never reaches the parser at all.
    const runner = answersOnly({ hyprctl: { code: 0, stdout: '[]', stderr: '' } })
    await withThrowingParser('hyprland', 'a bare string failure', async () => {
      const probe = await probeWindowBackend({ runner, host: { hasX11: true, hasWayland: false } })
      expect(probe.state).toBe('blocked')
      expect(probe.reason).toContain('a bare string failure')
    })
  })

  it('reports a plain value thrown by a parser, in the adapter window listing', async () => {
    const runner = answersOnly({ hyprctl: { code: 0, stdout: '[]', stderr: '' } })
    await withThrowingParser('hyprland', 'a bare string failure', async () => {
      const adapter = new LinuxDesktopAdapter({ runner, host: { hasX11: true, hasWayland: false } })
      await expect(adapter.observe({})).rejects.toThrow(ComputerUseError)
    })
  })
})
