/**
 * Aeven sign-in for the desktop renderer. The renderer addresses the Aeven API
 * at a same-origin `avn-app://` path; this module forwards only the sign-in
 * routes and the account routes under `/api/cloud/` through Electron's
 * persistent session, which keeps the API's refresh cookie that a cross-site
 * `avn-app://` page cannot.
 *
 * Provider sign-in runs in the default browser (`oauth-browser.ts`), whose
 * landing this module exchanges: the pair is spent here, where the cookie
 * lives, so the page that started the sign-in finds the session by reading its
 * profile rather than by loading the landing document into the application window.
 */

import { session } from 'electron'
import { DESKTOP_AEVEN_API_PATH, type DesktopAevenSignIn } from './host-protocol.ts'

/** Aeven API routes the sign-in screens call. */
const SIGN_IN_ROUTES: ReadonlySet<string> = new Set([
  '/login',
  '/register',
  '/verify-email',
  '/check-oauth-token',
  '/refresh-token',
  '/get-profile',
  '/logout',
])

/** Prefix of the account routes (plans, usage, wallet, billing) the settings account section calls with the reader's bearer. */
const CLOUD_ROUTE_PREFIX = '/api/cloud/'

const FORWARDED_REQUEST_HEADERS = ['accept', 'authorization', 'content-type'] as const
const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([101, 204, 205, 304])
const OAUTH_RESULT_PATH = /^\/oauth-result\/[^/]+(?:\/[^/]+)?\/?$/u

/** Fetch function used for forwarded requests; Electron's default session in production. */
export type AevenApiFetch = (url: string, init: RequestInit) => Promise<Response>

/**
 * Resolve a renderer request to the Aeven API URL it may reach.
 * @param requestUrl - `avn-app://app` URL below {@link DESKTOP_AEVEN_API_PATH}.
 * @param apiUrl - Aeven API URL reported by the Host.
 * @returns the target URL, or undefined when the route is neither a sign-in nor an account route.
 */
export function aevenApiTarget(requestUrl: string, apiUrl: string): URL | undefined {
  const { pathname, search } = new URL(requestUrl)
  if (!pathname.startsWith(`${DESKTOP_AEVEN_API_PATH}/`)) return undefined
  const route = pathname.slice(DESKTOP_AEVEN_API_PATH.length)
  if (!SIGN_IN_ROUTES.has(route) && !route.startsWith(CLOUD_ROUTE_PREFIX)) return undefined
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
 * The `__AVN_AEVEN__` row as `identity-user-aeven` states it and the Host's
 * index renderer writes it: `<script>globalThis["__AVN_AEVEN__"] = <json></script>`.
 * The renderer escapes every `<` in the JSON, so the first `</script>` ends it.
 */
const AEVEN_CONFIG_ROW = /<script>globalThis\["__AVN_AEVEN__"\] = ([\s\S]*?)<\/script>/u

/**
 * Read the sign-in endpoints an adopted Host states in its served page.
 *
 * An adopted Host is a web deployment that does not report to this shell, so
 * its page is the one record of which provider URLs it offers. The Host writes
 * those URLs for the origin the page is fetched from, so fetching the page at
 * the address the window renders yields the URLs the page will navigate to.
 * @param pageUrl - the adopted Host's advertised URL.
 * @param fetcher - request sender for the page.
 * @returns the endpoints, or undefined when the page states no Aeven API.
 */
export async function adoptedHostSignIn(
  pageUrl: string,
  fetcher: AevenApiFetch = (url, init) => session.defaultSession.fetch(url, init),
): Promise<DesktopAevenSignIn | undefined> {
  const response = await fetcher(pageUrl, { headers: { accept: 'text/html' } })
  if (!response.ok) throw new Error(`avn desktop: adopted Host page answered ${String(response.status)}`)
  const row = AEVEN_CONFIG_ROW.exec(await response.text())?.[1]
  if (row === undefined) return undefined
  const config = JSON.parse(row) as Record<string, unknown>
  if (typeof config.apiUrl !== 'string') return undefined
  const oauthUrls = [config.xOAuthUrl, config.appleOAuthUrl, config.googleOAuthUrl]
    .filter((url): url is string => typeof url === 'string')
  return { apiUrl: config.apiUrl, oauthUrls }
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
