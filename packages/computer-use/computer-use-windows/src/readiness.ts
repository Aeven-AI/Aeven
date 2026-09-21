/**
 * The Windows readiness report.
 *
 * Windows is the least gated platform for this work, and the report says so
 * plainly rather than listing permissions that do not exist: **UI Automation
 * needs no grant**, so a probe failure means the desktop is unreachable — a
 * headless or session-0 context — not that the user has something to approve.
 *
 * The one genuinely ungated gap is **elevation**: an unelevated process cannot
 * read or drive the UI of an elevated application. That is reported as a distinct
 * capability so a caller can tell "no permission" apart from "different integrity
 * level", which need different answers.
 *
 * @module @aeven/computer-use-windows/readiness
 */

import {
  composeReadinessReport,
  type ReadinessProbe,
  type ReadinessReport,
} from '@aeven/computer-use-desktop'
import { probeUiaScript } from './scripts.ts'
import type { WinCommandRunner } from './runner.ts'

/** Inputs to a readiness probe run. */
export interface WinReadinessOptions {
  runner: WinCommandRunner
  /** Caller lifetime. */
  signal?: AbortSignal
}

/** How many windows the availability probe needs to see to count as reachable. */
const PROBE_NODE_CAP = 1

/**
 * Probe whether UI Automation can read the desktop.
 *
 * No grant is involved: this reports `ready` as soon as the assemblies load and
 * the desktop root answers. A failure is reported as `unknown` rather than
 * `blocked`, because the cause is an unreachable desktop rather than a missing
 * permission the operator could grant.
 * @param options - the runner and caller lifetime.
 * @returns the probe for `uia.tree`.
 */
export async function probeUia(options: WinReadinessOptions): Promise<ReadinessProbe> {
  const result = await options.runner.run(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-Command', probeUiaScript(String(PROBE_NODE_CAP))],
    options.signal,
  )
  if (result.code !== 0) {
    return {
      name: 'uia.tree',
      state: 'unknown',
      code: 'desktop-unreachable',
      reason: result.stderr.trim() || 'UI Automation could not read the desktop',
    }
  }
  return { name: 'uia.tree', state: 'ready', reason: 'UI Automation needs no permission grant on Windows' }
}

/**
 * Probe whether the semantic input patterns are available.
 *
 * `ValuePattern` lets this adapter write into a control without focus and without
 * synthesised keystrokes, which is what keeps an action from landing in the wrong
 * window. Its availability is what decides whether the accessibility route is
 * usable, so it is probed separately from the tree.
 * @param options - the runner and caller lifetime.
 * @returns the probe for `uia.patterns`.
 */
export async function probeUiaPatterns(options: WinReadinessOptions): Promise<ReadinessProbe> {
  const result = await options.runner.run(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-Command', probeUiaScript(String(PROBE_NODE_CAP))],
    options.signal,
  )
  if (result.code !== 0) {
    return {
      name: 'uia.patterns',
      state: 'unknown',
      code: 'patterns-unprobed',
      reason: result.stderr.trim() || 'the pattern probe could not run, so pattern availability is unknown',
    }
  }
  return { name: 'uia.patterns', state: 'ready' }
}

/**
 * Report whether the process is elevated.
 *
 * Elevation is not a permission the user grants, but it does decide which windows
 * are addressable. Reporting it makes "the app's tree came back empty" explain
 * itself when the target runs elevated and this process does not.
 * @param options - the runner and caller lifetime.
 * @returns the probe for `integrity.elevation`.
 */
export async function probeElevation(options: WinReadinessOptions): Promise<ReadinessProbe> {
  const script = 'Write-Output (@{ ok = $true; elevated = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) } | ConvertTo-Json -Compress)'
  const result = await options.runner.run('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], options.signal)
  if (result.code !== 0) {
    return {
      name: 'integrity.elevation',
      state: 'unknown',
      code: 'elevation-unprobed',
      reason: result.stderr.trim() || 'the elevation probe could not run',
    }
  }
  let elevated = false
  try {
    elevated = (JSON.parse(result.stdout.trim()) as { elevated?: boolean }).elevated === true
  } catch {
    return {
      name: 'integrity.elevation',
      state: 'unknown',
      code: 'elevation-unreadable',
      reason: 'the elevation probe returned output that could not be read',
    }
  }
  if (elevated) {
    return { name: 'integrity.elevation', state: 'ready', reason: 'the process is elevated, so elevated windows are addressable' }
  }
  return {
    name: 'integrity.elevation',
    state: 'ready',
    reason: 'the process is not elevated, so an elevated application window can be listed but not driven; run Æven elevated to drive one',
  }
}

/**
 * Probe every Windows capability this adapter relies on.
 * @param options - the runner and caller lifetime.
 * @returns the composed readiness report for Windows.
 */
export async function probeWindowsReadiness(options: WinReadinessOptions): Promise<ReadinessReport> {
  const probes: ReadinessProbe[] = []
  probes.push(await probeUia(options))
  probes.push(await probeUiaPatterns(options))
  probes.push(await probeElevation(options))
  return composeReadinessReport('win32', probes)
}
