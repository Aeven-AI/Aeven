/**
 * Same-origin proxy in front of each host's expo-device-hub, the only way a
 * browser reaches a device stream.
 *
 * The hub binds loopback and is never reachable directly: serve-sim exposes a
 * shell-exec route and serve-emu's action routes are unauthenticated. Every
 * request here passes Connection's Host/Origin fence and browser
 * authentication first, and only the routes the device pane needs are
 * forwarded; the hub's dashboard, exec, and WebRTC routes answer 404.
 * Settings changes and one-shot actions never travel this way: they are typed
 * Remote calls (`device/action`).
 *
 * WebSockets are tunneled at the socket level after the upstream handshake, so
 * H.264 access units and input packets pass through unchanged.
 *
 * The device service installs these routes whenever a web server and
 * Connection are present, so a deployment without a browser surface serves
 * nothing.
 *
 * @module @aeven/device/hub-proxy
 */
import { request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@aeven/client-connection'
import type {} from '@aeven/host-webserver'

const ALLOWED_PATHS: readonly RegExp[] = [
  /^\/api\/devices$/u,
  /^\/vendor\/serve-sim\/api$/u,
  /^\/vendor\/serve-sim\/api\/screenshot$/u,
  /^\/vendor\/serve-sim\/api\/event-log(\/events)?$/u,
  /^\/vendor\/serve-sim\/helper\/[^/]+\/(stream\.mjpeg|stream\.avcc|config|health|ax|foreground)$/u,
  /^\/vendor\/serve-sim\/appstate$/u,
  /^\/vendor\/serve-emu\/api\/(devices|screenshot|stream-mode|stream-settings|accessibility)$/u,
  /^\/vendor\/serve-emu\/health$/u,
]

/** Read routes are GET-only; only these accept other methods (captures, stream tuning). */
const MUTABLE_PATHS: readonly RegExp[] = [
  /^\/vendor\/serve-sim\/api\/screenshot$/u,
  /^\/vendor\/serve-emu\/api\/(screenshot|stream-mode|stream-settings)$/u,
]

/** The hub's WebSocket routes: device-list events, iOS input, Android video and input. */
const WEBSOCKET_PATHS: readonly string[] = ['/api/devices/ws', '/vendor/serve-sim/helper/ws', '/vendor/serve-emu/ws']

/** Hop-by-hop and credential headers that must not reach the hub. */
const DROPPED_HEADERS = new Set([
  'host', 'connection', 'upgrade', 'cookie', 'authorization', 'content-length', 'accept-encoding', 'keep-alive',
  'proxy-connection', 'transfer-encoding', 'te', 'trailer',
])

/** WebSocket handshake headers a socket-level tunnel must carry through. */
const WEBSOCKET_HEADERS = ['sec-websocket-key', 'sec-websocket-version', 'sec-websocket-extensions', 'sec-websocket-protocol']

/**
 * The request headers forwarded to the hub.
 * @param headers - the browser's headers.
 * @param origin - the hub's origin; serve-emu refuses mutations whose Origin differs.
 * @returns the forwarded headers.
 */
function forwardHeaders(headers: IncomingHttpHeaders, origin: string): Record<string, string | string[]> {
  const forwarded: Record<string, string | string[]> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined || DROPPED_HEADERS.has(key) || key.startsWith('sec-websocket-')) continue
    forwarded[key] = value
  }
  forwarded.host = new URL(origin).host
  if (headers.origin !== undefined) forwarded.origin = origin
  return forwarded
}

/**
 * Split a proxied URL into the hub path and the upstream search, without the
 * `hostId` selector the proxy consumes.
 * @param url - the request URL.
 * @param mount - the proxy mount.
 * @returns the hub path, the upstream path with its search, and the host id.
 */
function upstreamTarget(url: string, mount: string): { hubPath: string; path: string; hostId: string | undefined } {
  const parsed = new URL(url, 'http://x')
  const hubPath = parsed.pathname.slice(mount.length) || '/'
  const hostId = parsed.searchParams.get('hostId') ?? undefined
  parsed.searchParams.delete('hostId')
  const search = parsed.searchParams.size > 0 ? `?${parsed.searchParams.toString()}` : ''
  return { hubPath, path: `${hubPath}${search}`, hostId }
}

function reject(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
  res.end(text)
}

function rejectSocket(socket: Duplex, status: number, text: string): void {
  socket.end(`HTTP/1.1 ${String(status)} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
}

/** What the proxy needs from the device service. */
export interface HubProxySource {
  /** Origin-relative mount, no trailing slash. */
  readonly hubMount: string
  /**
   * A host's running hub, without starting anything.
   * @param hostId - the host; the local host when omitted.
   * @returns the hub's loopback origin, or undefined while it is not running.
   */
  hubOrigin(hostId?: string): string | undefined
}

/**
 * Register the authenticated hub routes.
 * @param ctx - context carrying webServer and connection.
 * @param devices - the mount and each host's hub origin.
 */
export function installHubProxy(ctx: Context, devices: HubProxySource): void {
  const mount = devices.hubMount

  const proxyHttp = (req: IncomingMessage, res: ServerResponse): void => {
    const rejection = ctx.connection.requestRejection(req)
    if (rejection !== undefined) return reject(res, rejection, 'Unauthorized')
    /* v8 ignore next -- node:http always sets url on server requests */
    const target = upstreamTarget(req.url ?? '/', mount)
    if (!ALLOWED_PATHS.some(pattern => pattern.test(target.hubPath))) return reject(res, 404, 'Not Found')
    const readOnly = req.method === 'GET' || req.method === 'HEAD'
    if (!readOnly && !MUTABLE_PATHS.some(pattern => pattern.test(target.hubPath))) return reject(res, 405, 'Method Not Allowed')
    const origin = devices.hubOrigin(target.hostId)
    if (origin === undefined) return reject(res, 503, 'Device hub is not running')
    const upstream = httpRequest(`${origin}${target.path}`, {
      method: req.method, headers: forwardHeaders(req.headers, origin),
    }, (response) => {
      const headers: Record<string, string | string[]> = {}
      for (const [key, value] of Object.entries(response.headers)) {
        if (value === undefined || key === 'content-encoding' || key === 'transfer-encoding' || key === 'connection') continue
        headers[key] = value
      }
      // Long-lived MJPEG and AVCC bodies must not be buffered by compression.
      headers['cache-control'] = 'no-store, no-transform'
      res.writeHead(response.statusCode ?? 502, headers)
      response.pipe(res)
    })
    upstream.on('error', () => {
      if (!res.headersSent) reject(res, 502, 'Device hub unavailable')
      else res.destroy()
    })
    // A closed viewer ends its stream upstream, so the hub stops encoding for it.
    res.on('close', () => { upstream.destroy() })
    if (readOnly) upstream.end()
    else req.pipe(upstream)
  }

  const proxyUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    const rejection = ctx.connection.requestRejection(req)
    if (rejection !== undefined) return rejectSocket(socket, rejection, 'Unauthorized')
    /* v8 ignore next -- node:http always sets url on server requests */
    const target = upstreamTarget(req.url ?? '/', mount)
    const origin = devices.hubOrigin(target.hostId)
    if (origin === undefined) return rejectSocket(socket, 503, 'Service Unavailable')
    const headers = forwardHeaders(req.headers, origin)
    for (const key of WEBSOCKET_HEADERS) {
      const value = req.headers[key]
      if (value !== undefined) headers[key] = value
    }
    headers.connection = 'Upgrade'
    headers.upgrade = 'websocket'
    const upstream = httpRequest(`${origin}${target.path}`, { method: 'GET', headers })
    upstream.on('upgrade', (response, upstreamSocket, upstreamHead) => {
      const lines = [`HTTP/1.1 101 ${response.statusMessage ?? 'Switching Protocols'}`]
      for (let index = 0; index < response.rawHeaders.length; index += 2) {
        lines.push(`${response.rawHeaders[index] as string}: ${response.rawHeaders[index + 1] as string}`)
      }
      socket.write(`${lines.join('\r\n')}\r\n\r\n`)
      if (upstreamHead.length > 0) socket.write(upstreamHead)
      if (head.length > 0) upstreamSocket.write(head)
      upstreamSocket.pipe(socket)
      socket.pipe(upstreamSocket)
      // Whichever side closes first ends the other.
      const end = (): void => {
        upstreamSocket.destroy()
        socket.destroy()
      }
      upstreamSocket.on('close', end)
      upstreamSocket.on('error', end)
      socket.on('close', end)
    })
    upstream.on('response', (response) => {
      rejectSocket(socket, response.statusCode ?? 502, response.statusMessage ?? 'Bad Gateway')
      response.resume()
    })
    upstream.on('error', () => { rejectSocket(socket, 502, 'Bad Gateway') })
    socket.on('close', () => { upstream.destroy() })
    upstream.end()
  }

  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: mount, handler: proxyHttp }), `device-hub-proxy: ${mount} route`)
  for (const path of WEBSOCKET_PATHS) {
    ctx.effect(() => ctx.webServer.registerUpgrade({ path: `${mount}${path}`, handler: proxyUpgrade }),
      `device-hub-proxy: ${mount}${path} upgrade`)
  }
}
