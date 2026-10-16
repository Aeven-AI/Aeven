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
 * The start page is the client preloader: the mark and the spinner, nothing
 * else, on white. The landing page matches the billing return: a large Æven
 * wordmark and the message, with Google Sans Flex preloaded so the word does
 * not paint in a fallback face first.
 */

import { existsSync, readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { brandDocumentHead, escapeHtml, loadingFace, loadingFaceStyles } from './brand-page.ts'
import { oauthResultPath } from './aeven-sign-in.ts'

/** How long an unfinished sign-in keeps its port before the listener closes. */
const SIGN_IN_TIMEOUT_MS = 10 * 60 * 1000

/** Same-origin path of the UI face. The preload href and this route are the same string. */
const BRAND_FONT_PATH = '/fonts/google-sans-flex-latin-wght-normal.woff2'

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

/** Font bytes, read once. `null` means the file was looked up and was not there. */
let brandFont: Buffer | null | undefined

/**
 * The face ships in `renderer/fonts`. Tests load this module from `src`, the
 * bundle loads it from `lib/main.js`, and a packaged app loads it from inside
 * the asar, so the file is the first `renderer/fonts` hit walking up from here.
 */
function brandFontBytes(): Buffer | null {
  if (brandFont !== undefined) return brandFont
  const fileName = join('renderer', 'fonts', 'google-sans-flex-latin-wght-normal.woff2')
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let hop = 0; hop < 20; hop += 1) {
    const candidate = join(dir, fileName)
    if (existsSync(candidate)) {
      brandFont = readFileSync(candidate)
      return brandFont
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  console.error('avn desktop: sign-in font is missing')
  brandFont = null
  return brandFont
}

/**
 * The moment before the provider loads. Same stack as the client preloader:
 * the mark at 50px, the loading mark 4px under it. No sentence, because the tab
 * leaves immediately. The refresh sits after that markup so the first paint is
 * this page, not a gray flash.
 */
function preloaderPage(label: string, redirect: string): string {
  const redirectMarkup = `<meta http-equiv="refresh" content="0; url=${escapeHtml(redirect)}">`
    + `<script>location.replace(${JSON.stringify(redirect)})</script>`
  return brandDocumentHead('light')
    + '<style>'
    + 'html,body{margin:0;height:100%;background:#fff}'
    + 'body{display:flex;align-items:center;justify-content:center}'
    + loadingFaceStyles()
    + '.logo,.spinner{color:rgb(10,10,10)}'
    + '</style></head><body>'
    + loadingFace(label)
    + redirectMarkup
    + '</body></html>'
}

/** Finished sign-in. The wordmark is the chat header's Æven: 80px, weight 600. */
function donePage(body: string): string {
  return brandDocumentHead(
    'light',
    `<link rel="preload" href="${BRAND_FONT_PATH}" as="font" type="font/woff2" crossorigin>`,
  ).replace('<html>', '<html class="fonts-pending">')
    + '<style>'
    + '@font-face{font-family:"Google Sans Flex";'
    + `src:url("${BRAND_FONT_PATH}") format("woff2");`
    + 'font-weight:1 1000;font-style:normal;font-display:block}'
    + 'html,body{margin:0;height:100%;background:#fff;color:rgb(10,10,10)}'
    + 'body{display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:48px 28px 72px;'
    + 'font-family:"Google Sans Flex","Helvetica Neue",Helvetica,sans-serif;font-weight:450;font-size:16px;line-height:1.5;'
    + '-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-rendering:optimizeLegibility}'
    + 'main{display:flex;flex-direction:column;align-items:center;width:100%;max-width:440px;text-align:center}'
    + '.word{margin:0 0 28px;font-size:80px;font-weight:600;letter-spacing:0;line-height:1}'
    + '.lede{margin:0;max-width:34em;color:rgb(90,90,90);font-size:15px;font-weight:450;line-height:1.55;text-wrap:balance}'
    + 'html.fonts-pending .copy{visibility:hidden}'
    + '</style><noscript><style>html.fonts-pending .copy{visibility:visible}</style></noscript><script>'
    + '(function(){function reveal(){document.documentElement.classList.remove("fonts-pending")}'
    + 'var jobs=[];if(document.fonts&&document.fonts.load){jobs.push(document.fonts.load(\'600 80px "Google Sans Flex"\'));'
    + 'jobs.push(document.fonts.load(\'450 15px "Google Sans Flex"\'))}'
    + 'if(document.fonts&&document.fonts.ready)jobs.push(document.fonts.ready);'
    + 'if(!jobs.length){reveal();return}Promise.all(jobs).then(reveal,reveal)})();'
    + '</script></head><body><main>'
    + '<p class="word copy">Æven</p>'
    + `<p class="lede copy">${escapeHtml(body)}</p>`
    + '</main></body></html>'
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
    if (requestUrl.pathname === BRAND_FONT_PATH) {
      const bytes = brandFontBytes()
      if (bytes === null) {
        response.writeHead(404).end()
        return
      }
      response.writeHead(200, {
        'content-type': 'font/woff2',
        'content-length': String(bytes.length),
        'cache-control': 'public, max-age=31536000',
      })
      response.end(bytes)
      return
    }
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
