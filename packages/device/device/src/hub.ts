/**
 * The expo-device-hub JSON routes the device service calls on a host's hub.
 *
 * Discovery and boot go through the hub rather than simctl and adb directly:
 * the hub normalizes both platforms into one device record and is the process
 * that must know a device booted before it can stream it. Responses cross a
 * process boundary, so each is validated before use.
 *
 * @module @aeven/device/hub
 */
import { RemoteError } from '@aeven/typert-protocol'
import type { DevicePlatform } from './types.ts'

/** One device as the hub lists it. */
export interface HubDevice {
  readonly id: string
  readonly name: string
  readonly version: string
  readonly platform: DevicePlatform
  readonly booted: boolean
  readonly physical: boolean
}

/** The hub's device list: simulators, emulators, and discovery errors. */
export interface HubDeviceList {
  readonly devices: readonly HubDevice[]
  /** Discovery problems the hub reported, joined for the pane. */
  readonly detail: string | undefined
}

/** The hub's reply to boot, shutdown, and stream-start requests. */
export interface HubActionResult {
  readonly ok: boolean
  readonly id?: string
  readonly serial?: string
  readonly error?: string
}

/** serve-sim for iOS, serve-emu for Android, both vendored by the hub. */
export function vendorPrefix(platform: DevicePlatform): string {
  return platform === 'ios' ? '/vendor/serve-sim' : '/vendor/serve-emu'
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

function parseDevice(value: unknown): HubDevice | undefined {
  if (!isRecord(value)) return undefined
  const { id, name, version, platform, booted, physical } = value
  if (typeof id !== 'string' || id === '' || typeof name !== 'string' || (platform !== 'ios' && platform !== 'android')) return undefined
  return {
    id,
    name: name === '' ? id : name,
    version: typeof version === 'string' ? version : '',
    platform,
    booted: booted === true,
    physical: physical === true,
  }
}

/**
 * Request one hub route and decode its JSON body.
 * @param url - absolute hub URL.
 * @param operation - names the request in failures.
 * @param timeoutMs - request deadline.
 * @param body - JSON body; its presence makes the request a POST.
 * @returns the decoded body.
 */
async function hubJson(url: string, operation: string, timeoutMs: number, body?: object): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url, {
      method: body === undefined ? 'GET' : 'POST',
      signal: AbortSignal.timeout(timeoutMs),
      ...body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    })
  } catch (cause) {
    throw new RemoteError('device/operation-failed', `Device ${operation} failed: could not reach device support. Try refreshing devices.`, { operation }, { cause })
  }
  const text = await response.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    // A non-JSON body (an HTML error page, an empty reply) carries no result.
    parsed = undefined
  }
  if (!response.ok && !isRecord(parsed)) {
    throw new RemoteError('device/operation-failed', `Device ${operation} failed: the device hub answered ${String(response.status)}.`, { operation })
  }
  return parsed
}

/**
 * List the host's simulators and running emulators.
 * @param origin - the hub's loopback origin.
 * @param timeoutMs - request deadline.
 * @returns the devices and any discovery errors.
 */
export async function hubListDevices(origin: string, timeoutMs: number): Promise<HubDeviceList> {
  const body = await hubJson(`${origin}/api/devices`, 'list', timeoutMs)
  if (!isRecord(body)) throw new RemoteError('device/operation-failed', 'Device list failed: the device hub returned no list.', { operation: 'list' })
  const entries = [
    ...Array.isArray(body.simulators) ? body.simulators : [],
    ...Array.isArray(body.emulators) ? body.emulators : [],
  ]
  const errors = Array.isArray(body.errors)
    ? body.errors.flatMap(error => isRecord(error) && typeof error.message === 'string' ? [error.message] : [])
    : []
  return {
    devices: entries.flatMap(entry => parseDevice(entry) ?? []),
    detail: errors.length === 0 ? undefined : errors.join('\n'),
  }
}

/**
 * POST one action route.
 * @param origin - the hub's loopback origin.
 * @param path - hub route.
 * @param body - the request.
 * @param operation - names the request in failures.
 * @param timeoutMs - request deadline.
 * @returns the hub's result, `ok: false` with its error when it refused.
 */
export async function hubAction(origin: string, path: string, body: object, operation: string, timeoutMs: number): Promise<HubActionResult> {
  const reply = await hubJson(`${origin}${path}`, operation, timeoutMs, body)
  if (!isRecord(reply)) return { ok: false, error: `The device hub returned no result for ${operation}.` }
  return {
    ok: reply.ok === true,
    ...typeof reply.id === 'string' ? { id: reply.id } : {},
    ...typeof reply.serial === 'string' ? { serial: reply.serial } : {},
    ...typeof reply.error === 'string' ? { error: reply.error } : {},
  }
}

/**
 * Capture one device's screen.
 * @param origin - the hub's loopback origin.
 * @param platform - the device's platform.
 * @param deviceId - simulator udid or adb serial.
 * @param timeoutMs - request deadline.
 * @returns the PNG bytes.
 */
export async function hubScreenshot(origin: string, platform: DevicePlatform, deviceId: string, timeoutMs: number): Promise<Uint8Array> {
  const url = `${origin}${vendorPrefix(platform)}/api/screenshot?device=${encodeURIComponent(deviceId)}`
  let response: Response
  try {
    response = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(timeoutMs) })
  } catch (cause) {
    throw new RemoteError('device/operation-failed', 'Device screenshot failed: could not reach device support.', { operation: 'screenshot' }, { cause })
  }
  if (!response.ok) {
    throw new RemoteError('device/operation-failed', `Device screenshot failed: the device hub answered ${String(response.status)}.`, { operation: 'screenshot' })
  }
  return new Uint8Array(await response.arrayBuffer())
}

/**
 * Classify a hub boot error for the pane.
 * @param error - the hub's error text.
 * @returns the boot failure reason.
 */
export function bootFailureReason(error: string): 'disk_space' | 'timeout' | 'launch_failed' {
  if (/insufficient.*(?:disk|space)|not enough.*(?:disk|space)|no space left/iu.test(error)) return 'disk_space'
  if (/timed? out|timeout/iu.test(error)) return 'timeout'
  return 'launch_failed'
}
