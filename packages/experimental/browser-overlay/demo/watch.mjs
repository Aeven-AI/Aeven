/**
 * Open the overlay in a real browser window and drive it by hand.
 *
 * The screenshot suite proves the overlay's behaviour; this is for looking at it.
 * It opens a visible Chromium on the demo page with the overlay already installed,
 * and drives each action from whatever element you click on the page, so the
 * pointer follows your own input rather than a scripted path.
 *
 * In the page console, `window.__aevenOverlay` is the live instance:
 *
 *     __aevenOverlay.click({ x: 300, y: 200 }, { label: 'click' })
 *     __aevenOverlay.moveTo({ x: 700, y: 400 })
 *     __aevenOverlay.setThinkEnabled(false)   // stop the idle wobble
 *     __aevenOverlay.hover(document.querySelector('#card-b'))
 *     __aevenOverlay.type({ x: 120, y: 420 }, { label: 'type' })
 *     __aevenOverlay.scroll({ x: 300, y: 600 }, { deltaY: 240 })
 *     __aevenOverlay.destroy()
 *
 * The window stays open until you close it. Ctrl-C in the terminal stops the
 * server as well.
 *
 * Run: node packages/experimental/browser-overlay/demo/watch.mjs
 * @module
 */

import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = resolve(here, '..')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
}

const result = await build({
  entryPoints: [join(pkgRoot, 'src', 'index.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  write: false,
  legalComments: 'none',
})
const bundle = result.outputFiles[0].text

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  if (url.pathname === '/overlay.js') {
    response.writeHead(200, { 'content-type': MIME['.js'] })
    response.end(bundle)
    return
  }
  const file = url.pathname === '/' ? join(here, 'page.html') : join(here, url.pathname.slice(1))
  try {
    const body = await readFile(file)
    response.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
    response.end(body)
  } catch {
    response.writeHead(404)
    response.end('not found')
  }
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const url = `http://127.0.0.1:${server.address().port}/`

const browser = await chromium.launch({ headless: false })
const page = await browser.newPage({ viewport: { width: 1100, height: 820 } })
await page.addInitScript({ content: bundle })
await page.goto(url, { waitUntil: 'load' })

// Wire the page's own controls to the overlay, so the pointer follows clicks in
// the window rather than a scripted sequence.
await page.evaluate(() => {
  const overlay = window.__aevenOverlay
  const centreOf = (element) => {
    const rect = element.getBoundingClientRect()
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  }
  document.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const button = target.closest('button')
    const field = target.closest('input')
    if (button !== null) {
      overlay.click(centreOf(button), { label: `click ${button.textContent?.trim() ?? 'button'}` })
      return
    }
    if (field !== null) {
      overlay.type(centreOf(field), { label: `type into ${field.id || 'field'}` })
      return
    }
    const card = target.closest('.card, section')
    if (card !== null) {
      overlay.hover(card, { kind: 'hover' })
      const label = card.querySelector('strong, h2')
      if (label !== null) overlay.moveTo(centreOf(label), { label: `hover ${label.textContent?.trim() ?? ''}` })
      return
    }
    overlay.click({ x: event.clientX, y: event.clientY }, { label: 'click' })
  }, true)
})

console.log(`overlay demo open at ${url}`)
console.log('click around the page; the pointer follows your clicks')
console.log('drive it directly from the page console as window.__aevenOverlay')
console.log('press Ctrl-C here to stop')

await page.waitForEvent('close', { timeout: 0 }).catch(() => {})
await browser.close()
server.close()
