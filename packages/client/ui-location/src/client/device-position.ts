/** Device position reads and permission state through the browser's Geolocation API. */
import type { LocationAnswer } from '@aeven/tool-location/types'

/**
 * The Geolocation API's request options: the platform's best source, a reading
 * up to five minutes old, and ten seconds to produce one once permitted.
 */
const POSITION_OPTIONS: PositionOptions = { enableHighAccuracy: true, maximumAge: 300_000, timeout: 10_000 }

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
 * Read the device position once. The browser shows its own permission prompt
 * when the site has none yet.
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
        if (error.code === error.PERMISSION_DENIED) {
          resolve({ kind: 'blocked' })
          return
        }
        resolve({
          kind: 'unavailable',
          reason: error.code === error.TIMEOUT
            ? 'the device did not report a position in time'
            : 'the device could not determine a position',
        })
      },
      POSITION_OPTIONS,
    )
  })
}
