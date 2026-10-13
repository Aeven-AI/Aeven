/**
 * The macOS readiness report.
 *
 * macOS grants attach to a **process**, not to a user or an app family, and the
 * grant that matters is the one held by whoever makes the call. Measured
 * behaviour: `cua-driver` held Accessibility and could read the AX tree, while a
 * spawned `osascript` making the identical AX call received
 * `-25201 kAXErrorAPIDisabled`. So a report that says only "Accessibility:
 * denied" is not actionable — it must name the identity that needs the grant.
 *
 * @module @aeven/computer-use-macos/readiness
 */

import {
  composeReadinessReport,
  type GrantIdentity,
  type ReadinessProbe,
  type ReadinessReport,
} from '@aeven/computer-use-desktop'
import type { MacCommandRunner } from './runner.ts'

/** The process that will make the gated calls, and therefore needs the grants. */
export interface GrantHolder {
  /** Human-meaningful name of the holder, surfaced verbatim to the operator. */
  name: string
  /**
   * How the holder relates to Æven. An in-process holder needs one grant for the
   * whole session; a spawned helper needs its own, per gated API.
   */
  source: 'in-process' | 'spawned-helper' | 'driver-daemon'
}

/** Inputs to a readiness probe run. */
export interface ReadinessOptions {
  runner: MacCommandRunner
  /** The identity that needs the grants. */
  holder: GrantHolder
  /** Bundle ids whose Automation permission should be probed. */
  automationTargets?: readonly string[]
  /** Caller lifetime. */
  signal?: AbortSignal
}

/**
 * `osascript` exit status for a denied Apple Event, which explains in its stderr
 * that the application is not allowed assistive access or automation.
 */
const OSASCRIPT_ERROR = 1

/**
 * Probe Accessibility for the given holder by asking whether the AX API answers.
 *
 * The probe calls the system-wide AX API, so `kAXErrorAPIDisabled` (`-25201`)
 * means the API is reachable but **this** holder is not permitted — a materially
 * different finding from "the app has no UI", and the distinction the operator
 * needs.
 * @param options - the runner and the holder under test.
 * @returns the probe for `accessibility.read`.
 */
export async function probeAccessibility(options: ReadinessOptions): Promise<ReadinessProbe> {
  const script = 'ObjC.import("ApplicationServices"); $.AXIsProcessTrusted()'
  const result = await options.runner.run('osascript', ['-l', 'JavaScript', '-e', script], options.signal)
  if (result.code !== 0) {
    return {
      name: 'accessibility.read',
      state: 'unknown',
      code: 'probe-failed',
      reason: result.stderr.trim() || 'the accessibility probe could not run',
      grantee: { name: options.holder.name, source: options.holder.source },
    }
  }
  const trusted = result.stdout.trim() === 'true'
  if (trusted) {
    return {
      name: 'accessibility.read',
      state: 'ready',
      grantee: { name: options.holder.name, source: options.holder.source },
    }
  }
  return {
    name: 'accessibility.read',
    state: 'blocked',
    code: 'accessibility-not-granted',
    reason: `the accessibility API is not permitted for "${options.holder.name}"`,
    grantee: { name: options.holder.name, source: options.holder.source },
    remedy: `Grant Accessibility to "${options.holder.name}" in System Settings > Privacy & Security > Accessibility`,
  }
}

/**
 * Probe whether Apple Events to one target app are permitted.
 *
 * Automation is granted **per (controller, target app) pair**, so this is probed
 * per target rather than once. The probe asks the target for its own name, which
 * is the cheapest event that still requires the grant.
 * @param options - the runner and the holder under test.
 * @param bundleId - the target app's bundle identifier.
 * @returns the probe for `automation.<bundleId>`.
 */
export async function probeAutomation(options: ReadinessOptions, bundleId: string): Promise<ReadinessProbe> {
  const script = `JSON.stringify({ name: Application(${JSON.stringify(bundleId)}).name() })`
  const result = await options.runner.run('osascript', ['-l', 'JavaScript', '-e', script], options.signal)
  if (result.code === 0) {
    return {
      name: `automation.${bundleId}`,
      state: 'ready',
      grantee: { name: 'osascript', source: 'spawned-helper' },
    }
  }
  if (result.code === OSASCRIPT_ERROR) {
    return {
      name: `automation.${bundleId}`,
      state: 'blocked',
      code: 'automation-not-granted',
      reason: result.stderr.trim() || `Apple Events to "${bundleId}" are not permitted`,
      grantee: { name: 'osascript', source: 'spawned-helper' },
      remedy: `Grant Automation for the app "${bundleId}" when it is first used, in System Settings > Privacy & Security > Automation`,
    }
  }
  return {
    name: `automation.${bundleId}`,
    state: 'unknown',
    code: 'probe-failed',
    reason: result.stderr.trim() || `probing "${bundleId}" failed with exit code ${String(result.code)}`,
    grantee: { name: 'osascript', source: 'spawned-helper' },
  }
}

/**
 * Probe whether screen capture is permitted.
 *
 * Capture is neither universally required nor free: it triggers its own consent
 * prompt, so callers that can work from the accessibility tree should not pay for
 * it. The probe therefore reports the state without requesting the grant.
 * @param options - the runner and the holder under test.
 * @returns the probe for `screenRecording.capture`.
 */
export async function probeScreenRecording(options: ReadinessOptions): Promise<ReadinessProbe> {
  // A one-pixel capture fails with a permission error when the grant is missing.
  const result = await options.runner.run(
    'screencapture',
    ['-x', '-t', 'png', '-R', '0,0,1,1', '/dev/null'],
    options.signal,
  )
  if (result.code === 0) {
    return {
      name: 'screenRecording.capture',
      state: 'ready',
      grantee: { name: options.holder.name, source: options.holder.source },
    }
  }
  return {
    name: 'screenRecording.capture',
    state: 'blocked',
    code: 'screen-recording-not-granted',
    reason: result.stderr.trim() || 'screen capture is not permitted',
    grantee: { name: options.holder.name, source: options.holder.source },
    remedy: `Grant Screen Recording to "${options.holder.name}" in System Settings > Privacy & Security > Screen Recording`,
  }
}

/**
 * Probe every macOS capability this adapter relies on.
 *
 * The returned report derives its blockers from the probes, so it cannot
 * contradict itself, and it names the holding identity for each gated capability
 * so the remedy is actionable.
 * @param options - the runner, the holder, and which targets to probe.
 * @returns the composed readiness report for macOS.
 */
export async function probeMacReadiness(options: ReadinessOptions): Promise<ReadinessReport> {
  const probes: ReadinessProbe[] = []
  probes.push(await probeAccessibility(options))
  probes.push(await probeScreenRecording(options))
  for (const bundleId of options.automationTargets ?? []) {
    probes.push(await probeAutomation(options, bundleId))
  }
  return composeReadinessReport('darwin', probes)
}

/** Re-exported so adapters can label a grant holder without importing the contract. */
export type { GrantIdentity }
