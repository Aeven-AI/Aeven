/**
 * Aeven sign-in for the desktop renderer. The renderer addresses the Aeven API
 * at a same-origin `avn-app://` path; this module forwards only the sign-in
 * routes through Electron's persistent session, which keeps the API's refresh
 * cookie that a cross-site `avn-app://` page cannot.
 *
 * Provider sign-in runs in a separate window whose landing this module
 * exchanges: the pair is spent here, where the cookie lives, so the page that
 * opened the window finds the session by reading its profile rather than by
 * loading the landing document into the application window.
 */

import { app, BrowserWindow, session } from 'electron'
import { DESKTOP_AEVEN_API_PATH, type DesktopAevenSignIn } from './host-protocol.ts'

/** Aeven API routes the sign-in screens call; no other route is forwarded. */
const SIGN_IN_ROUTES: ReadonlySet<string> = new Set([
  '/login',
  '/register',
  '/verify-email',
  '/check-oauth-token',
  '/refresh-token',
  '/get-profile',
  '/logout',
])

const FORWARDED_REQUEST_HEADERS = ['accept', 'authorization', 'content-type'] as const
const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([101, 204, 205, 304])
const OAUTH_RESULT_PATH = /^\/oauth-result\/[^/]+(?:\/[^/]+)?\/?$/u

/** Fetch function used for forwarded requests; Electron's default session in production. */
export type AevenApiFetch = (url: string, init: RequestInit) => Promise<Response>

/**
 * Resolve a renderer request to the Aeven API URL it may reach.
 * @param requestUrl - `avn-app://app` URL below {@link DESKTOP_AEVEN_API_PATH}.
 * @param apiUrl - Aeven API URL reported by the Host.
 * @returns the target URL, or undefined when the route is not a sign-in route.
 */
export function aevenApiTarget(requestUrl: string, apiUrl: string): URL | undefined {
  const { pathname, search } = new URL(requestUrl)
  if (!pathname.startsWith(`${DESKTOP_AEVEN_API_PATH}/`)) return undefined
  const route = pathname.slice(DESKTOP_AEVEN_API_PATH.length)
  if (!SIGN_IN_ROUTES.has(route)) return undefined
  return signInRouteUrl(apiUrl, route, search)
}

/**
 * Address one Aeven sign-in route on the configured API.
 *
 * The configured URL keeps whatever path prefix the deployment states, as the
 * forwarded requests do: a deployment that serves the API under a prefix serves
 * every route under it.
 * @param apiUrl - Aeven API URL reported by the Host.
 * @param route - the route, starting with `/`.
 * @param search - query string to keep, including its `?`.
 * @returns the URL to reach.
 */
function signInRouteUrl(apiUrl: string, route: string, search = ''): URL {
  const base = new URL(apiUrl)
  return new URL(`${base.pathname.replace(/\/+$/u, '')}${route}${search}`, base)
}

/**
 * Forward one renderer sign-in request with the session's Aeven cookies.
 * @param request - renderer request below {@link DESKTOP_AEVEN_API_PATH}.
 * @param signIn - endpoints reported by the running Host, or undefined without an Aeven authority.
 * @param fetcher - request sender that stores and presents session cookies.
 * @returns the API response status, content type, and body; 404 for any other route.
 */
export async function forwardAevenApiRequest(
  request: Request,
  signIn: DesktopAevenSignIn | undefined,
  fetcher: AevenApiFetch = (url, init) => session.defaultSession.fetch(url, init),
): Promise<Response> {
  const target = signIn === undefined ? undefined : aevenApiTarget(request.url, signIn.apiUrl)
  if (target === undefined) return new Response(null, { status: 404 })
  const headers = new Headers()
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name)
    if (value !== null) headers.set(name, value)
  }
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
  const response = await fetcher(target.href, {
    method: request.method,
    headers,
    ...(hasBody ? { body: await request.arrayBuffer() } : {}),
    credentials: 'include',
  })
  const contentType = response.headers.get('content-type')
  return new Response(NULL_BODY_STATUSES.has(response.status) ? null : response.body, {
    status: response.status,
    headers: contentType === null ? {} : { 'content-type': contentType },
  })
}

/**
 * Recognize the page a provider sign-in lands on.
 * @param url - navigation target inside the sign-in window.
 * @returns `/oauth-result/<session>/<challenge>` or `/oauth-result/<error>`, else undefined.
 */
export function oauthResultPath(url: string): string | undefined {
  if (!URL.canParse(url)) return undefined
  const { protocol, pathname } = new URL(url)
  if (protocol !== 'http:' && protocol !== 'https:') return undefined
  return OAUTH_RESULT_PATH.test(pathname) ? pathname : undefined
}

/**
 * Run one provider sign-in in a separate window sharing the default session.
 * The window has no preload; its landing path is handed to `land` and the
 * window closes.
 * @param parent - application window that started the sign-in.
 * @param url - provider sign-in URL reported by the Host.
 * @param land - receives the `/oauth-result/...` path for the application window.
 */
export function openAevenOAuthWindow(parent: BrowserWindow, url: string, land: (path: string) => void): void {
  const window = new BrowserWindow({
    parent,
    width: 520,
    height: 720,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
  })
  // Providers refuse sign-in from user agents that name an embedded runtime.
  window.webContents.setUserAgent(window.webContents.getUserAgent()
    .replace(/ Electron\/\S+/u, '')
    .replace(` ${app.getName()}/${app.getVersion()}`, ''))
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  const intercept = (event: Electron.Event, target: string): void => {
    const path = oauthResultPath(target)
    if (path === undefined) return
    event.preventDefault()
    window.close()
    land(path)
  }
  window.webContents.on('will-redirect', intercept)
  window.webContents.on('will-navigate', intercept)
  void window.loadURL(url)
}

/** The pair a provider landing carries in its path. */
const OAUTH_CALLBACK_PATH = /^\/oauth-result\/([^/]+)\/([^/]+)\/?$/u

/**
 * Read the session and challenge out of a provider landing path.
 * @param path - the path the provider's window landed on.
 * @returns the pair, or undefined when the path carries none.
 */
export function oauthCallbackPair(path: string): { session: string; challenge: string } | undefined {
  const match = OAUTH_CALLBACK_PATH.exec(path)
  if (match === null) return undefined
  const [, session, challenge] = match
  return session === undefined || challenge === undefined ? undefined : { session, challenge }
}

/**
 * Finish a provider sign-in on the path its window landed.
 *
 * The landing document is never loaded into the application window: the pair is
 * exchanged here, through the session that holds the API's refresh cookie, so
 * the page that opened the window picks the session up the way it picks up
 * every other sign-in — by reading its profile. A path that carries an error,
 * or an exchange the API refuses, leaves the reader where they were.
 * @param path - the `/oauth-result/...` path a provider window landed on.
 * @param signIn - endpoints reported by the running Host, or undefined without an Aeven authority.
 * @param fetcher - request sender that stores and presents session cookies.
 * @returns true when the exchange established a session.
 */
export async function completeOAuthLanding(
  path: string,
  signIn: DesktopAevenSignIn | undefined,
  fetcher: AevenApiFetch = (url, init) => session.defaultSession.fetch(url, init),
): Promise<boolean> {
  const pair = signIn === undefined ? undefined : oauthCallbackPair(path)
  if (pair === undefined || signIn === undefined) return false
  const response = await fetcher(signInRouteUrl(signIn.apiUrl, '/check-oauth-token').href, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(pair),
  })
  return response.ok
}
