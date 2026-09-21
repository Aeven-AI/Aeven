/**
 * Derive `CURSOR_NUDGE` from the sprite, and verify it.
 *
 * The nudge is a property of the artwork plus the resting rotation, so it can be
 * calibrated once rather than guessed. Two earlier attempts to nudge the live
 * overlay and re-measure failed for a reason worth recording: the overlay rewrites
 * its transform every animation frame, so a forced value is overwritten before it
 * can be observed, and each attempt changed the sprite offset and the measured
 * error at the same time.
 *
 * This measures a static replica of the same three layers with the same declared
 * styles, making the tip's screen position a pure function of
 * (nudge, rotation, anchor). One run with a zero nudge yields the sprite's tip in
 * box coordinates; the nudge that cancels it is the answer, and a second run
 * verifies it.
 *
 * Run: node packages/experimental/browser-overlay/demo/solve-nudge.mjs
 * @module
 */

import { createServer } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = resolve(here, '..')
const ANCHOR = { x: 400, y: 300 }
/** The rotation the cursor holds at rest, from the motion model. */
const ROTATION = -44
/** The cursor box size, in CSS pixels. */
const BOX = 24

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
const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 })
await page.addInitScript({ content: source })
await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' })

// Lift the sprite out of the live overlay and remove the overlay, so nothing
// rewrites the transforms this script is about to set.
await page.evaluate(() => {
  const img = document.querySelector('.aeven-browser-overlay-cursor-sprite img')
  if (img === null) throw new Error('no sprite in the overlay')
  window.__calAsset = img.src
  window.__aevenOverlay.destroy()
})

/**
 * Render the three sprite layers with the given nudge and locate the arrow's apex.
 * @returns the apex in viewport coordinates, or null when nothing dark rendered.
 */
async function measureTip(nudge, rotation, anchor) {
  await page.evaluate(({ nudge, rotation, anchor, box }) => {
    document.querySelectorAll('.aeven-browser-overlay').forEach(node => node.remove())
    const root = document.createElement('div')
    root.className = 'aeven-browser-overlay'
    root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647'
    const cursor = document.createElement('div')
    cursor.style.cssText = `position:absolute;left:0;top:0;width:${box}px;height:${box}px;`
      + `transform:translate3d(${anchor.x - box / 2}px, ${anchor.y - box / 2}px, 0)`
    const sprite = document.createElement('div')
    sprite.style.cssText = `position:absolute;left:0;top:0;transform:translate3d(${nudge.x}px, ${nudge.y}px, 0)`
    const img = document.createElement('img')
    img.src = window.__calAsset
    img.style.cssText = `display:block;width:23px;height:24px;transform:rotate(${rotation}deg);transform-origin:0 0`
    sprite.append(img)
    cursor.append(sprite)
    root.append(cursor)
    document.documentElement.append(root)
  }, { nudge, rotation, anchor, box: BOX })
  await page.waitForTimeout(80)
  const shot = await page.screenshot()
  return page.evaluate(async (dataUrl) => {
    const image = new Image()
    await new Promise((done, fail) => {
      image.onload = done
      image.onerror = () => fail(new Error('decode failed'))
      image.src = dataUrl
    })
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const ctx = canvas.getContext('2d')
    ctx.drawImage(image, 0, 0)
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    // The apex is the topmost dark run, averaged across its width: an antialiased
    // tip would otherwise report one arbitrary pixel.
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
    return topY < 0 ? null : { x: (minX + maxX) / 2, y: topY }
  }, `data:image/png;base64,${shot.toString('base64')}`)
}

const baseline = await measureTip({ x: 0, y: 0 }, ROTATION, ANCHOR)
if (baseline === null) {
  console.error('solve-nudge: no arrow pixels rendered with a zero nudge')
  process.exitCode = 1
} else {
  // With no nudge the measured apex is the sprite's tip in box coordinates, so the
  // nudge that cancels it is the one placing the tip on the box centre.
  const tipInBox = { x: baseline.x - (ANCHOR.x - BOX / 2), y: baseline.y - (ANCHOR.y - BOX / 2) }
  const corrected = { x: BOX / 2 - tipInBox.x, y: BOX / 2 - tipInBox.y }
  console.log(`rotation sampled    ${ROTATION}deg`)
  console.log(`tip with no nudge   (${tipInBox.x.toFixed(2)}, ${tipInBox.y.toFixed(2)}) in box coordinates`)
  console.log(`CURSOR_NUDGE        { x: ${corrected.x.toFixed(2)}, y: ${corrected.y.toFixed(2)} }`)

  const verify = await measureTip(corrected, ROTATION, ANCHOR)
  if (verify === null) {
    console.error('solve-nudge: no arrow pixels rendered with the corrected nudge')
    process.exitCode = 1
  } else {
    const off = { x: verify.x - ANCHOR.x, y: verify.y - ANCHOR.y }
    const distance = Math.hypot(off.x, off.y)
    console.log(`verified tip        (${verify.x.toFixed(2)}, ${verify.y.toFixed(2)}) against (${ANCHOR.x}, ${ANCHOR.y})`)
    console.log(`verified offset     (${off.x.toFixed(2)}, ${off.y.toFixed(2)})  distance ${distance.toFixed(2)}px`)
    if (distance > 2) {
      console.error('\nsolve-nudge: the corrected nudge does not put the tip on the target')
      process.exitCode = 1
    } else {
      console.log('\nnudge confirmed: the arrow tip lands on the requested coordinate')
    }
  }
}

await browser.close()
server.close()
