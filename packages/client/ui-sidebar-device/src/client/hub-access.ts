/**
 * Where the device pane's media requests go: the Host's hub proxy on the
 * app's own origin. `<img>`, `EventSource`, and `WebSocket` cannot set
 * headers, so they authenticate with the browser session cookie, which a
 * same-origin request carries.
 */

/** Base URLs and query for one host's hub. */
export interface DeviceHubAccess {
  /** Absolute URL of the proxy mount, e.g. `http://127.0.0.1:3080/device-hub`. */
  readonly httpBase: string
  /** Same base with the `ws(s)` scheme. */
  readonly wsBase: string
  /** Appended to every request; selects the host. */
  readonly query: Readonly<Record<string, string>>
}

/**
 * Hub access for one host.
 * @param hubBasePath - origin-relative proxy mount from the device state.
 * @param hostId - the device's host.
 * @returns the base URLs and query.
 */
export function deviceHubAccess(hubBasePath: string, hostId: string): DeviceHubAccess {
  const httpBase = new URL(hubBasePath, window.location.href).href.replace(/\/$/u, '')
  return { httpBase, wsBase: httpBase.replace(/^http/u, 'ws'), query: { hostId } }
}

/**
 * Append the access query to a hub URL.
 * @param url - absolute hub URL, with or without a query.
 * @param access - the host's access.
 * @returns the URL with the access query.
 */
export function withDeviceHubQuery(url: string, access: DeviceHubAccess): string {
  const entries = Object.entries(access.query)
  if (entries.length === 0) return url
  return `${url}${url.includes('?') ? '&' : '?'}${new URLSearchParams(entries).toString()}`
}
