/**
 * The Linux readiness report.
 *
 * Readiness matters more here than on the other platforms, because Linux has no
 * single answer. Wayland fragments window control across compositors, and input
 * across the RemoteDesktop portal, `wtype`, and `ydotool`; X11 offers XTEST. So
 * the report probes each layer and names what is missing, which is what turns
 * "the window list was empty" into "no window backend is available on this
 * desktop".
 *
 * @module @aeven/computer-use-linux/readiness
 */

import {
  composeReadinessReport,
  type ReadinessProbe,
  type ReadinessReport,
} from '@aeven/computer-use-desktop'
import { WINDOW_BACKENDS } from './backends.ts'
import type { LinuxCommandRunner, LinuxHost } from './runner.ts'

/** Inputs to a readiness probe run. */
export interface LinuxReadinessOptions {
  runner: LinuxCommandRunner
  /** Facts about the session. */
  host: LinuxHost
}

/**
 * Probe whether a session bus is reachable.
 *
 * AT-SPI lives on the session bus, so this decides whether the accessibility rung
 * can exist at all. It is probed separately from AT-SPI itself so a missing bus
 * and a bus without the accessibility bridge are distinguishable.
 * @param options - the runner and session facts.
 * @returns the probe for `sessionBus.reach`.
 */
export async function probeSessionBus(options: LinuxReadinessOptions): Promise<ReadinessProbe> {
  const result = await options.runner.run('busctl', ['--user', 'list', '--no-pager'], options.host.signal)
  if (result.code === 0) {
    return { name: 'sessionBus.reach', state: 'ready' }
  }
  return {
    name: 'sessionBus.reach',
    state: 'unknown',
    code: 'no-session-bus',
    reason: result.stderr.trim() || 'the D-Bus session bus could not be reached',
  }
}

/**
 * Probe whether the AT-SPI accessibility registry is present.
 *
 * A registry on the bus is not the same as applications publishing trees into it:
 * toolkits only do so when accessibility is enabled, which is a per-desktop
 * setting the operator controls. This probe therefore reports the registry's
 * presence and says so, rather than claiming trees will be readable.
 * @param options - the runner and session facts.
 * @returns the probe for `atspi.tree`.
 */
export async function probeAtspi(options: LinuxReadinessOptions): Promise<ReadinessProbe> {
  const result = await options.runner.run(
    'gdbus',
    ['call', '--session', '--dest', 'org.a11y.Bus', '--object-path', '/org/a11y/bus', '--method', 'org.a11y.Bus.GetAddress'],
    options.host.signal,
  )
  if (result.code === 0) {
    return { name: 'atspi.tree', state: 'ready' }
  }
  return {
    name: 'atspi.tree',
    state: 'blocked',
    code: 'atspi-unavailable',
    reason: result.stderr.trim() || 'the AT-SPI bus address could not be read',
    remedy: 'Enable toolkit accessibility for this desktop (for GNOME: set org.gnome.desktop.interface toolkit-accessibility to true), then restart the applications to be driven',
  }
}

/**
 * Probe which window backend answers, trying each in order.
 *
 * The winning backend is reported by name, and the failure case names every
 * backend that was tried — because "no windows" and "no backend" look identical
 * to a caller otherwise.
 * @param options - the runner and session facts.
 * @returns the probe for `windowing.backend`.
 */
export async function probeWindowBackend(options: LinuxReadinessOptions): Promise<ReadinessProbe> {
  const tried: string[] = []
  for (const backend of WINDOW_BACKENDS) {
    const result = await options.runner.run(backend.command, backend.listArgs, options.host.signal)
    if (result.code !== 0) {
      tried.push(`${backend.name} (${result.stderr.trim() || `exit ${String(result.code)}`})`)
      continue
    }
    try {
      backend.parse(result.stdout)
      return { name: 'windowing.backend', state: 'ready', reason: `the ${backend.name} backend answered` }
    } catch (error) {
      tried.push(`${backend.name} (${error instanceof Error ? error.message : String(error)})`)
    }
  }
  return {
    name: 'windowing.backend',
    state: 'blocked',
    code: 'no-window-backend',
    reason: `no window backend answered; tried: ${tried.join('; ')}`,
    remedy: 'Install the tool for this desktop (hyprctl, i3-msg, or wmctrl) so windows can be listed and focused',
  }
}

/**
 * Probe the input ladder.
 *
 * On X11 `xdotool` through XTEST is the reliable path. On Wayland literal text
 * needs `wtype` or `ydotool`, and neither is universally installed, so this
 * reports which rung answered instead of assuming one exists.
 * @param options - the runner and session facts.
 * @returns the probe for `input.synthesis`.
 */
export async function probeInput(options: LinuxReadinessOptions): Promise<ReadinessProbe> {
  if (options.host.hasX11) {
    const xdotool = await options.runner.run('xdotool', ['--version'], options.host.signal)
    if (xdotool.code === 0) {
      return { name: 'input.synthesis', state: 'ready', reason: 'xdotool answers, so XTEST input is available' }
    }
  }
  const wtype = await options.runner.run('wtype', ['--help'], options.host.signal)
  if (wtype.code === 0) {
    return { name: 'input.synthesis', state: 'ready', reason: 'wtype answers, so Wayland text input is available' }
  }
  const ydotool = await options.runner.run('ydotool', ['--help'], options.host.signal)
  if (ydotool.code === 0) {
    return { name: 'input.synthesis', state: 'ready', reason: 'ydotool answers, so uinput input is available' }
  }
  return {
    name: 'input.synthesis',
    state: 'blocked',
    code: 'no-input-backend',
    reason: 'none of xdotool, wtype, or ydotool answered',
    remedy: options.host.hasWayland
      ? 'Install wtype (wlroots-based compositors) or ydotool with ydotoold running, so text and keys can be sent on Wayland'
      : 'Install xdotool so keys and pointer input can be sent through XTEST',
  }
}

/**
 * Probe every Linux capability this adapter relies on.
 * @param options - the runner and session facts.
 * @returns the composed readiness report for Linux.
 */
export async function probeLinuxReadiness(options: LinuxReadinessOptions): Promise<ReadinessReport> {
  const probes: ReadinessProbe[] = []
  probes.push(await probeSessionBus(options))
  probes.push(await probeAtspi(options))
  probes.push(await probeWindowBackend(options))
  probes.push(await probeInput(options))
  return composeReadinessReport('linux', probes)
}
