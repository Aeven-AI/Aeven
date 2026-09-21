/**
 * Runs the overlay against the demo page in a real browser and writes screenshots.
 *
 * This exists because the overlay is pure visual behavior: typechecking proves it
 * compiles, and nothing else can prove the pointer lands where it claims to. Each
 * step drives one overlay call through the same `window.__aevenOverlay` surface a
 * CDP host would use, then captures what a person would see.
 *
 * Run: node packages/experimental/browser-overlay/demo/run.mjs
 * @module
 */

import { mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = resolve(here, '..')
const outDir = join(pkgRoot, 'demo', 'out')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
}

/** Bundle the overlay as a self-installing IIFE, the shape a CDP host injects. */
async function bundle() {
  const result = await build({
    entryPoints: [join(pkgRoot, 'src', 'index.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    write: false,
    legalComments: 'none',
  })
  return result.outputFiles[0].text
}

/** Serve the demo page and the bundle over loopback. */
async function serve(bundleSource) {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname === '/overlay.js') {
      response.writeHead(200, { 'content-type': MIME['.js'] })
      response.end(bundleSource)
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
  return { server, port: server.address().port }
}

const source = await bundle()
const { server, port } = await serve(source)
mkdirSync(outDir, { recursive: true })

const failures = []
const steps = []
/**
 * Measure a hover box against the element it claims to cover.
 * @returns the misalignment in CSS pixels, or an error describing a missing node.
 */
async function boxAlignment(selector) {
  return page.evaluate((sel) => {
    const box = document.querySelector('.aeven-browser-overlay-box')
    const target = document.querySelector(sel)
    if (box === null) return { error: 'no hover box in the document', dx: 0, dy: 0 }
    if (target === null) return { error: `missing ${sel}`, dx: 0, dy: 0 }
    const b = box.getBoundingClientRect()
    const t = target.getBoundingClientRect()
    return { dx: b.x - t.x, dy: b.y - t.y, dw: b.width - t.width, dh: b.height - t.height }
  }, selector)
}

/**
 * Assert the pointer is on screen, visible, and inside the viewport right now.
 *
 * Run at the end of each step rather than once at the end: the overlay is
 * destroyed by a later step, and a step whose target scrolled away would
 * otherwise capture a screenshot that merely looks empty.
 */
async function expectPointerVisible(after) {
  const state = await page.evaluate(() => {
    const cursor = document.querySelector('.aeven-browser-overlay-cursor')
    if (cursor === null) return { missing: true }
    const matrix = new DOMMatrix(getComputedStyle(cursor).transform)
    const anchor = { x: matrix.m41 + 12, y: matrix.m42 + 12 }
    return {
      x: Math.round(anchor.x), y: Math.round(anchor.y),
      visible: cursor.dataset.visible,
      mode: cursor.dataset.mode,
      inViewport: anchor.x > 0 && anchor.y > 0 && anchor.x < innerWidth && anchor.y < innerHeight,
    }
  })
  if (state.missing) failures.push(`no pointer after ${after}`)
  else if (state.visible !== 'true' || !state.inViewport) {
    failures.push(`pointer not visible after ${after}: ${JSON.stringify(state)}`)
  }
  return state
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1100, height: 820 }, deviceScaleFactor: 2 })

// The overlay must survive navigation and be present before the first paint, so it
// is installed exactly the way a host would: as a document-start script.
page.on('pageerror', (e) => failures.push(`page error: ${e.message}`))
await page.addInitScript({ content: source })
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' })

/**
 * Assert the pointer is the copied sprite, at its authored size and rotation.
 *
 * A missing or blocked image would otherwise show up only as an empty gap in a
 * screenshot, which is the one failure a screenshot cannot distinguish from
 * "the pointer is somewhere else".
 */
async function checkSprite() {
  const state = await page.evaluate(() => {
    const img = document.querySelector('.aeven-browser-overlay-cursor-sprite img')
    if (img === null) return { error: 'no cursor sprite in the document' }
    if (!img.complete || img.naturalWidth === 0) return { error: 'cursor sprite failed to load' }
    const style = getComputedStyle(img)
    return {
      natural: `${img.naturalWidth}x${img.naturalHeight}`,
      box: `${style.width}x${style.height}`,
      transform: style.transform,
      filter: style.filter.includes('drop-shadow') ? 'drop-shadow' : style.filter,
      isDataUri: img.src.startsWith('data:image/'),
    }
  })
  if (state.error !== undefined) { failures.push(state.error); return }
  if (state.natural !== '46x48') failures.push(`sprite natural size ${state.natural}, expected 46x48`)
  if (state.box !== '23pxx24px') failures.push(`sprite computed size ${state.box}, expected 23pxx24px`)
  if (!state.isDataUri) failures.push('sprite is not a data URI; a page CSP could block it')
  if (state.filter !== 'drop-shadow') failures.push(`sprite glow missing: ${state.filter}`)
  return state
}

await checkSprite()

/** Assert the overlay is the only thing it claims to be: present, and non-interactive. */
async function checkNonInteractive() {
  const interactive = await page.evaluate(() => {
    const root = document.querySelector('.aeven-browser-overlay')
    if (root === null) return 'overlay root missing'
    if (getComputedStyle(root).pointerEvents !== 'none') return 'root accepts pointer events'
    for (const node of root.querySelectorAll('*')) {
      if (node.classList.contains('aeven-browser-overlay-cursor-layer')) continue
      if (getComputedStyle(node).pointerEvents === 'auto') return `child accepts pointer events: ${node.className}`
    }
    return null
  })
  if (interactive !== null) failures.push(interactive)
}

/** Assert nothing in the host page moved because the overlay was injected. */
async function checkLayoutUntouched(before) {
  const after = await page.evaluate(() => ({
    bodyHeight: document.body.getBoundingClientRect().height,
    scrollHeight: document.documentElement.scrollHeight,
  }))
  if (Math.abs(after.bodyHeight - before.bodyHeight) > 0.5) {
    failures.push(`body height changed: ${before.bodyHeight} -> ${after.bodyHeight}`)
  }
  if (after.scrollHeight !== before.scrollHeight) {
    failures.push(`document scrollHeight changed: ${before.scrollHeight} -> ${after.scrollHeight}`)
  }
}

const baseline = await page.evaluate(() => ({
  bodyHeight: document.body.getBoundingClientRect().height,
  scrollHeight: document.documentElement.scrollHeight,
}))

/** Where an element's center is, in viewport coordinates. */
async function centerOf(selector) {
  return page.evaluate((sel) => {
    const node = document.querySelector(sel)
    if (node === null) throw new Error(`missing ${sel}`)
    const rect = node.getBoundingClientRect()
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }
  }, selector)
}

// 1. The pointer arrives and anchors on a button, with the action named.
{
  const target = await centerOf('#save')
  await page.evaluate((point) => {
    window.__aevenOverlay.moveTo(point, { mode: 'comment', label: 'click Save changes' })
  }, { x: target.x, y: target.y })
  await page.waitForTimeout(600)
  // The hotspot must land on the target, not the sprite's top-left corner.
  const anchored = await page.evaluate((point) => {
    // The cursor box is rotated, so its bounding rect is the rotated bounding box
    // and its top-left is not the anchor. The applied translate is the anchor, and
    // the box is 24px, so the translate must be the point minus half the box.
    const cursor = document.querySelector('.aeven-browser-overlay-cursor')
    const matrix = new DOMMatrix(getComputedStyle(cursor).transform)
    const anchor = { x: matrix.m41 + 12, y: matrix.m42 + 12 }
    return { dx: Math.abs(anchor.x - point.x), dy: Math.abs(anchor.y - point.y) }
  }, { x: target.x, y: target.y })
  if (anchored.dx > 1.5 || anchored.dy > 1.5) {
    failures.push(`pointer tail missed the target by (${anchored.dx.toFixed(2)}, ${anchored.dy.toFixed(2)})px`)
  }
  await page.screenshot({ path: join(outDir, '01-pointer-on-button.png') })
  await expectPointerVisible('01-pointer-on-button')
  steps.push('01-pointer-on-button.png')
}

// 2. A hover highlight tracks its element across a scroll.
//
// This is the regression that matters most: a rectangle captured once drifts off
// its target the moment the page moves, and a drifting highlight is worse than no
// highlight because it points at the wrong content with full confidence.
{
  await page.evaluate(() => { window.__aevenOverlay.hover(document.querySelector('#card-b'), { kind: 'hover' }) })
  await page.waitForTimeout(120)
  const before = await boxAlignment('#card-b')
  if (before.error !== undefined) failures.push(`hover box: ${before.error}`)

  // Move the page, then let the capture settle: the box must follow its element.
  await page.evaluate(() => { window.scrollTo({ top: 240 }) })
  await page.waitForTimeout(160)
  const after = await boxAlignment('#card-b')
  if (after.error !== undefined) failures.push(`hover box after scroll: ${after.error}`)
  if (Math.abs(after.dx) > 0.5 || Math.abs(after.dy) > 0.5) {
    failures.push(`hover box drifted off its element by (${after.dx.toFixed(2)}, ${after.dy.toFixed(2)})px after a scroll`)
  }
  await page.evaluate(() => { window.scrollTo({ top: 0 }) })
  await page.waitForTimeout(160)
  await page.screenshot({ path: join(outDir, '02-hover-highlight.png') })
  await expectPointerVisible('02-hover-highlight')
  steps.push('02-hover-highlight.png')
}

// 3. A click lands: ripple plus pointer.
//
// Captured twice on purpose. The ring appears the instant the click is reported
// while the arrow is still gliding (420ms), so a single mid-flight frame shows a
// settled ring beside an in-transit arrow and reads as a misaligned pointer. The
// first frame documents that transient; the second is the settled truth, and it is
// the one a reviewer should judge the alignment from.
{
  const target = await centerOf('#danger')
  await page.evaluate((point) => { window.__aevenOverlay.click(point, { label: 'click Delete' }) }, { x: target.x, y: target.y })

  // Settled frame: the glide has finished, so the arrow's tip is at the target.
  await page.waitForTimeout(700)
  const settled = await page.evaluate((point) => {
    const cursor = document.querySelector('.aeven-browser-overlay-cursor')
    const matrix = new DOMMatrix(getComputedStyle(cursor).transform)
    return { dx: Math.abs(matrix.m41 + 12 - point.x), dy: Math.abs(matrix.m42 + 12 - point.y) }
  }, { x: target.x, y: target.y })
  if (settled.dx > 1.5 || settled.dy > 1.5) {
    failures.push(`after the click settled, the pointer was (${settled.dx.toFixed(2)}, ${settled.dy.toFixed(2)})px off its target`)
  }
  await page.screenshot({ path: join(outDir, '03a-click-arrow-settled.png') })
  steps.push('03a-click-arrow-settled.png')
  await expectPointerVisible('03a-click-arrow-settled')

  // Transient frame: ring already placed, arrow still gliding.
  await page.evaluate((point) => { window.__aevenOverlay.click(point, { label: 'click Delete' }) }, { x: target.x, y: target.y })
  await page.waitForTimeout(200)
  await page.screenshot({ path: join(outDir, '03b-click-arrow-in-transit.png') })
  steps.push('03b-click-arrow-in-transit.png')
}

// 4. Typing shows a caret at the field, distinguishable from a click.
{
  const field = await centerOf('#email')
  await page.evaluate((point) => { window.__aevenOverlay.type(point, { label: 'type into Email address' }) }, { x: field.x - 40, y: field.y })
  await page.waitForTimeout(220)
  await page.screenshot({ path: join(outDir, '04-typing-caret.png') })
  await expectPointerVisible('04-typing-caret')
  steps.push('04-typing-caret.png')
}

// 5. The same arrow over a dark surface, where the white outline has to carry it.
{
  await page.evaluate(() => { document.querySelector('#dark-button').scrollIntoView({ block: 'center' }) })
  await page.waitForTimeout(120)
  const target = await centerOf('#dark-button')
  await page.evaluate((point) => { window.__aevenOverlay.moveTo(point, { mode: 'add', label: 'choosing target' }) }, { x: target.x, y: target.y })
  await page.waitForTimeout(560)
  await page.screenshot({ path: join(outDir, '05-add-mode-dark-surface.png') })
  await expectPointerVisible('05-add-mode-dark-surface')
  steps.push('05-add-mode-dark-surface.png')
}

// 6. Scroll nudge.
{
  const scroller = await centerOf('#scroller')
  await page.evaluate((point) => { window.__aevenOverlay.scroll(point, { deltaY: 240, label: 'scroll down' }) }, { x: scroller.x, y: scroller.y })
  await page.waitForTimeout(180)
  await page.screenshot({ path: join(outDir, '06-scroll-nudge.png') })
  await expectPointerVisible('06-scroll-nudge')
  steps.push('06-scroll-nudge.png')
}

await checkNonInteractive()

// 7. Teardown must leave nothing behind.
{
  const before = await page.evaluate(() => ({
    nodes: document.querySelectorAll('.aeven-browser-overlay').length,
    styles: document.querySelectorAll('style').length,
  }))
  if (before.nodes !== 1) failures.push(`expected exactly one overlay root, found ${before.nodes}`)
  await page.evaluate(() => { window.__aevenOverlay.destroy(); delete window.__aevenOverlay })
  const after = await page.evaluate(() => ({
    nodes: document.querySelectorAll('.aeven-browser-overlay').length,
    styles: document.querySelectorAll('style').length,
  }))
  if (after.nodes !== 0) failures.push(`destroy left ${after.nodes} overlay root(s)`)
  if (after.styles !== before.styles - 1) {
    failures.push(`destroy left a stylesheet behind: ${before.styles} -> ${after.styles}`)
  }
  await page.screenshot({ path: join(outDir, '07-after-destroy.png') })
  steps.push('07-after-destroy.png')
}

// 8. Re-attach after teardown must work, and stay a single overlay.
{
  const result = await page.evaluate(() => {
    const mod = window.__aevenOverlayModule
    if (mod === undefined) return { reason: 'module global missing' }
    const overlay = mod.installOverlay()
    overlay.attach()
    overlay.attach()
    return { roots: document.querySelectorAll('.aeven-browser-overlay').length }
  })
  if (result.reason !== undefined) failures.push(`re-attach failed: ${result.reason}`)
  else if (result.roots !== 1) failures.push(`re-attach produced ${result.roots} overlay roots`)
  else {
    await page.evaluate(() => { window.__aevenOverlay.moveTo({ x: 300, y: 260 }, { label: 're-attached' }) })
    await page.waitForTimeout(520)
    await expectPointerVisible('08-reattach')
    await page.screenshot({ path: join(outDir, '08-reattached.png') })
    steps.push('08-reattached.png')
  }
}

await checkLayoutUntouched(baseline)

await browser.close()
server.close()

console.log(`screenshots -> ${outDir}`)
for (const name of steps) console.log(`  ${name}`)
if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exitCode = 1
} else {
  console.log('\nall overlay checks passed')
}
