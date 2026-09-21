/**
 * Verify the cursor's geometry in a real rendering.
 *
 * Two properties matter, and neither is visible in a screenshot:
 *
 *   1. **The sprite is centred in the cursor box.** A plausible-looking arrow
 *      carries no information about whether its box is centred on it.
 *   2. **The sprite is unrotated at rest.** The artwork is authored in the
 *      orientation it should be seen in, so any resting angle is a bug — and one a
 *      screenshot cannot distinguish from the artwork itself being tilted.
 *
 * It also reports the arrow tip for information. The tip is the sprite's
 * top-left corner, so centring the sprite necessarily leaves the tip up and to the
 * left of the coordinate. That is a consequence of centring, not a misalignment,
 * so it is reported rather than asserted.
 *
 * Run: node packages/experimental/browser-overlay/demo/measure-tip.mjs
 * @module
 */

import { writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = resolve(here, '..')
const ANCHOR = { x: 400, y: 300 }
/** Centring tolerance in CSS pixels: sub-pixel layout rounding is expected. */
const CENTRING_TOLERANCE_PX = 0.01
/** Resting-rotation tolerance in degrees: the spring lands exactly on zero. */
const ROTATION_TOLERANCE_DEG = 0.05

const result = await build({
  entryPoints: [join(pkgRoot, 'src', 'index.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  write: false,
  legalComments: 'none',
})
const source = result.outputFiles[0].text

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  if (url.pathname === '/overlay.js') {
    response.writeHead(200, { 'content-type': 'text/javascript' })
    response.end(source)
    return
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  response.end('<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#fff}</style>')
})
await new Promise(done => server.listen(0, '127.0.0.1', done))

const browser = await chromium.launch()
// Device scale 1, so screenshot pixels are CSS pixels and coordinates compare directly.
const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 })
await page.addInitScript({ content: source })
await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' })

// The idle wobble rotates the sprite by design, so it must be off before any angle
// is measured; otherwise consecutive frames answer differently.
await page.evaluate((point) => {
  window.__aevenOverlay.setThinkEnabled(false)
  window.__aevenOverlay.moveTo(point)
}, ANCHOR)
await page.waitForTimeout(900)

const shot = await page.screenshot()
await writeFile(join(here, 'out', 'measure-tip.png'), shot)

const measured = await page.evaluate(async (dataUrl) => {
  const cursor = document.querySelector('.aeven-browser-overlay-cursor')
  const sprite = document.querySelector('.aeven-browser-overlay-cursor-sprite')
  const img = sprite.querySelector('img')
  const cursorRect = cursor.getBoundingClientRect()
  const spriteRect = img.getBoundingClientRect()
  const matrix = new DOMMatrix(getComputedStyle(cursor).transform)

  const image = new Image()
  await new Promise((done, fail) => {
    image.onload = done
    image.onerror = () => fail(new Error('screenshot did not decode'))
    image.src = dataUrl
  })
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, 0, 0)
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  // The arrow's apex: the topmost dark run, averaged across its width so an
  // antialiased tip does not report one arbitrary pixel.
  let topY = -1
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4
      if (data[i] < 60 && data[i + 1] < 60 && data[i + 2] < 60) {
        if (topY < 0) topY = y
        if (y === topY) { if (x < minX) minX = x; if (x > maxX) maxX = x }
      }
    }
    if (topY >= 0 && y > topY) break
  }

  return {
    cursorCentre: { x: cursorRect.x + cursorRect.width / 2, y: cursorRect.y + cursorRect.height / 2 },
    cursorSize: { width: cursorRect.width, height: cursorRect.height },
    spriteCentre: { x: spriteRect.x + spriteRect.width / 2, y: spriteRect.y + spriteRect.height / 2 },
    spriteSize: { width: spriteRect.width, height: spriteRect.height },
    spriteTransform: getComputedStyle(img).transform,
    rotationDeg: Math.atan2(matrix.b, matrix.a) * 180 / Math.PI,
    tip: topY < 0 ? null : { x: (minX + maxX) / 2, y: topY },
  }
}, `data:image/png;base64,${shot.toString('base64')}`)

await browser.close()
server.close()

const failures = []
const offset = {
  x: measured.spriteCentre.x - measured.cursorCentre.x,
  y: measured.spriteCentre.y - measured.cursorCentre.y,
}
const rotation = ((measured.rotationDeg % 360) + 360) % 360
const restError = Math.min(rotation, 360 - rotation)

if (Math.abs(offset.x) > CENTRING_TOLERANCE_PX || Math.abs(offset.y) > CENTRING_TOLERANCE_PX) {
  failures.push(`sprite centre is (${offset.x.toFixed(3)}, ${offset.y.toFixed(3)})px from the cursor box centre`)
}
if (measured.spriteTransform !== 'none') {
  failures.push(`sprite layer carries its own transform: ${measured.spriteTransform}`)
}
if (restError > ROTATION_TOLERANCE_DEG) {
  failures.push(`resting rotation is ${measured.rotationDeg.toFixed(2)}deg, expected 0`)
}
if (measured.tip === null) failures.push('no arrow pixels rendered')

console.log(`cursor box        ${measured.cursorSize.width}x${measured.cursorSize.height} centred at (${measured.cursorCentre.x}, ${measured.cursorCentre.y})`)
console.log(`sprite            ${measured.spriteSize.width}x${measured.spriteSize.height} centred at (${measured.spriteCentre.x}, ${measured.spriteCentre.y})`)
console.log(`centre offset     (${offset.x.toFixed(3)}, ${offset.y.toFixed(3)})px`)
console.log(`sprite transform  ${measured.spriteTransform}`)
console.log(`resting rotation  ${measured.rotationDeg.toFixed(2)}deg`)
if (measured.tip !== null) {
  const distance = Math.hypot(measured.tip.x - ANCHOR.x, measured.tip.y - ANCHOR.y)
  console.log(`arrow tip         (${measured.tip.x}, ${measured.tip.y}) — the sprite's top-left corner, ${distance.toFixed(1)}px up-left of the coordinate`)
}

if (failures.length > 0) {
  console.error(`\n${failures.length} geometry check(s) failed:`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exitCode = 1
} else {
  console.log('\nsprite is centred in the cursor box and unrotated at rest')
}
