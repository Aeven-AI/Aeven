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

const LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 671 581" aria-hidden="true">'
  + '<g fill="currentColor" fill-rule="evenodd">'
  + '<path d="m225.301 0 305.5 529.142-43.301 25L182 25z"/>'
  + '<path d="M140 529.141 445.5 0l43.302 25-305.5 529.141z"/>'
  + '<path d="M167.901 530.059h335v50h-335z"/>'
  + '<path d="m43.302 264.5 167.5 290.119-43.302 25L0 289.5zM503.302 0l167.5 290.119-43.302 25L460 25z"/>'
  + '<path d="M460 554.618 627.5 264.5l43.301 25-167.5 290.118zM0 290.118 167.5 0 210.8 25l-167.5 290.118z"/>'
  + '<path d="M167.5 0h57.8v50h-57.8zM445.5 0h57.8v50h-57.8zM72.5 405.3 306.5 0l43.302 25-234 405.3z"/>'
  + '<path d="m364.301 0 234 405.3-43.3 25L321 25z"/>'
  + '<path d="M306.5 0h57.8v50h-57.8z"/>'
  + '</g></svg>'

const SPINNER_SVG = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
  + '<path d="M16 16L19 19M18 12H22M8 8L5 5M16 8L19 5M8 16L5 19M2 12H6M12 2V6M12 18V22" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
  + '</svg>'

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/gu, character => `&#${String(character.charCodeAt(0))};`)
}

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

/** Shared head for both pages. The redirect is appended after the body is parsed. */
function documentHead(extra = ''): string {
  return '<!doctype html><html><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<meta name="color-scheme" content="light"><title>Æven</title>'
    + extra
}

/**
 * The moment before the provider loads. Same stack as the client preloader:
 * the mark at 50px, the spinner 4px under it. No sentence, because the tab leaves immediately.
 * The refresh sits after that markup so the first paint is this page, not a gray flash.
 */
function preloaderPage(label: string, redirect: string): string {
  const redirectMarkup = `<meta http-equiv="refresh" content="0; url=${escapeHtml(redirect)}">`
    + `<script>location.replace(${JSON.stringify(redirect)})</script>`
  return documentHead()
    + '<style>'
    + 'html,body{margin:0;height:100%;background:#fff}'
    + 'body{display:flex;align-items:center;justify-content:center}'
    + 'main{display:flex;flex-direction:column;align-items:center}'
    + '.logo{width:50px;height:50px;margin:0 0 4px;color:rgb(10,10,10)}'
    + '.logo svg{display:block;width:50px;height:50px}'
    + '.spinner{width:16px;height:16px;color:rgb(10,10,10);animation:loader-spin 900ms linear infinite}'
    + '.spinner svg{display:block;width:16px;height:16px}'
    + '@keyframes loader-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}'
    + '@media (prefers-reduced-motion:reduce){.spinner{animation:none}}'
    + '</style></head><body>'
    + `<main aria-label="${escapeHtml(label)}">`
    + `<div class="logo" aria-hidden="true">${LOGO_SVG}</div>`
    + `<div class="spinner" aria-hidden="true">${SPINNER_SVG}</div>`
    + `</main>${redirectMarkup}</body></html>`
}

/** Finished sign-in. The wordmark is the chat header's Æven: 80px, weight 600. */
function donePage(body: string): string {
  return documentHead(
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
