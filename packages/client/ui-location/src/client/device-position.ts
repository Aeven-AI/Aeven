/** Device position reads and permission state through the browser's Geolocation API. */
import type { LocationAnswer } from '@aeven/tool-location/types'

/**
 * The first read's options: the platform's best source, a reading up to five
 * minutes old, and ten seconds to produce one once permitted.
 */
const PRECISE_OPTIONS: PositionOptions = { enableHighAccuracy: true, maximumAge: 300_000, timeout: 10_000 }

/**
 * The fallback read's options, used when the precise read timed out or found no
 * position: the network-based source a phone indoors or a laptop without GPS
 * answers from, a reading up to ten minutes old, and twenty seconds.
 */
const COARSE_OPTIONS: PositionOptions = { enableHighAccuracy: false, maximumAge: 600_000, timeout: 20_000 }

/** One read: a position, or why there is none. */
export type DeviceRead =
  | Extract<LocationAnswer, { kind: 'device' }>
  /** The browser refused: the reader dismissed its prompt, or the site is blocked. */
  | { readonly kind: 'blocked' }
  | Extract<LocationAnswer, { kind: 'unavailable' }>

/**
 * Whether the browser already lets this site read the location.
 * @returns `granted` when a read will not prompt; anything else when it may.
 */
export async function geolocationPermission(): Promise<PermissionState | 'unsupported'> {
  if (!('permissions' in navigator)) return 'unsupported'
  try {
    return (await navigator.permissions.query({ name: 'geolocation' })).state
  } catch {
    // A browser without the geolocation permission name answers by rejecting;
    // the read then decides, prompting if it must.
    return 'unsupported'
  }
}

/**
 * Read the device position. The browser shows its own permission prompt when
 * the site has none yet. A precise read that times out or finds nothing is
 * followed by one coarse read, which a phone indoors or a laptop without GPS
 * usually answers.
 * @returns a device reading, `blocked` when the browser refuses, or
 * `unavailable` with a reason the reader and the model can act on.
 */
export function readDevicePosition(): Promise<DeviceRead> {
  // Browsers expose geolocation only to secure contexts: https, or a loopback
  // address such as 127.0.0.1. A page opened on a LAN address over http has none.
  if (!window.isSecureContext) {
    return Promise.resolve({
      kind: 'unavailable',
      reason: 'this page is not served over https or a local address, so the browser offers no location',
    })
  }
  if (!('geolocation' in navigator)) {
    return Promise.resolve({ kind: 'unavailable', reason: 'this browser has no location service' })
  }
  return readWithFallback()
}

/**
 * Read precisely, then once more from the coarse source when the precise one produced no position.
 * @returns a device reading, `blocked`, or `unavailable` with the reason the last source gave.
 */
async function readWithFallback(): Promise<DeviceRead> {
  const precise = await readOnce(PRECISE_OPTIONS)
  if (precise.kind !== 'retry') return precise
  const coarse = await readOnce(COARSE_OPTIONS)
  if (coarse.kind !== 'retry') return coarse
  const reason = coarse.timedOut
    ? 'the device did not report a position in time'
    : 'the device could not determine a position; location may be turned off for the device or the browser'
  return { kind: 'unavailable', reason }
}

/**
 * One Geolocation read.
 * @param options - the read's accuracy, age, and time limit.
 * @returns a device reading, `blocked` when the browser refuses, or `retry`
 * when this source produced no position, saying whether it ran out of time.
 */
function readOnce(options: PositionOptions): Promise<DeviceRead | { readonly kind: 'retry'; readonly timedOut: boolean }> {
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          kind: 'device',
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
          timestamp: position.timestamp,
        })
      },
      (error) => {
        resolve(error.code === error.PERMISSION_DENIED ? { kind: 'blocked' } : { kind: 'retry', timedOut: error.code === error.TIMEOUT })
      },
      options,
    )
  })
}
