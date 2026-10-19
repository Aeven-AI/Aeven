/**
 * Provider sign-in in the reader's default browser.
 *
 * Providers refuse sign-in inside an embedded window (Google answers "This
 * browser or app may not be secure"), so the shell opens the provider in the
 * system browser and receives the landing on a loopback port, as a code
 * editor's sign-in does. The Aeven API returns a finished sign-in to the origin
 * named by the `Referer` of the request that started it and accepts any
 * loopback origin, so the browser first loads this listener's own start page,
 * which forwards it to the provider with the listener as the referrer.
 *
 * The start page is the brand page in its waiting state, and the landing page is
 * the same page reporting: one design for the whole round trip, with the face
 * inlined so the wordmark never paints in a fallback first.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { brandPageHtml } from '@aeven/brand-page'
import { oauthResultPath } from './aeven-sign-in.ts'

/** How long an unfinished sign-in keeps its port before the listener closes. */
const SIGN_IN_TIMEOUT_MS = 10 * 60 * 1000

/** Copy of the pages the reader's browser shows during the round trip. */
export interface BrowserSignInLabels {
  /** Start page, shown for the moment before the provider loads. */
  readonly continuing: string
  /** Landing page after a completed sign-in. */
  readonly signedIn: string
  /** Landing page after a refused or cancelled sign-in. */
  readonly failed: string
}

/** The one sign-in in flight; a newer one replaces it. */
let closeActive: (() => void) | undefined

/**
 * The moment before the provider loads: the brand page in its waiting state,
 * which forwards to the provider as soon as it has painted. The refresh sits
 * after the markup so the first paint is this page, not a grey flash.
 * @param label - line under the wordmark.
 * @param redirect - the provider route to negotiate to.
 * @returns the start page.
 */
function preloaderPage(label: string, redirect: string): string {
  return brandPageHtml({ state: 'waiting', note: label, title: 'Signing in — Æven', redirect })
}

/**
 * A finished sign-in, refused or completed: the brand page in its result state.
 * @param body - line under the wordmark, in the reader's language.
 * @returns the landing page.
 */
function donePage(body: string): string {
  return brandPageHtml({ note: body, hint: 'You can close this window.', title: 'Æven' })
}

/**
 * Run one provider sign-in in the default browser.
 * @param options.providerUrl - the provider route the Host reported.
 * @param options.labels - copy of the browser pages.
 * @param options.openExternal - opens a URL in the reader's default browser.
 * @param options.land - receives the `/oauth-result/...` path the provider returned, then the listener closes.
 * @returns resolves once the browser has been asked to open the start page.
 */
export async function startBrowserSignIn(options: {
  readonly providerUrl: string
  readonly labels: BrowserSignInLabels
  readonly openExternal: (url: string) => Promise<void>
  readonly land: (path: string) => void
}): Promise<void> {
  closeActive?.()
  let done = false
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
    const path = oauthResultPath(`http://127.0.0.1${request.url ?? '/'}`)
    if (path !== undefined) {
      const failed = path.split('/').filter(Boolean)[1] === 'error'
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(donePage(failed ? options.labels.failed : options.labels.signedIn))
      close()
      options.land(path)
      return
    }
    if (requestUrl.pathname === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(preloaderPage(options.labels.continuing, options.providerUrl))
      return
    }
    response.writeHead(404).end()
  })
  const timer = setTimeout(() => { close() }, SIGN_IN_TIMEOUT_MS)
  const close = (): void => {
    if (done) return
    done = true
    clearTimeout(timer)
    server.close()
    if (closeActive === close) closeActive = undefined
  }
  closeActive = close
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { resolve() })
  })
  const { port } = server.address() as AddressInfo
  await options.openExternal(`http://127.0.0.1:${String(port)}/`)
}
