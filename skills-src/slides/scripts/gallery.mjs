/**
 * Builds the Slides gallery assets the Aeven app shows on its Inspiration page.
 *
 * For each design system it renders the sample deck and writes, under `<out>/<system-id>/`:
 *   slide-01.webp … slide-NN.webp   every slide at 960×540: the first is the gallery card's cover,
 *                                   all of them page through in the template popup
 * and `<out>/manifest.json`: `[{ id, name, slides, source }]` in system order.
 *
 * Usage: node scripts/gallery.mjs [out directory, default out/gallery] [system-id …]
 * Copy the output into the app's `apps/web/public/slide-templates/`.
 */
import { mkdirSync, readFileSync, readdirSync, existsSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import puppeteer from 'puppeteer-core'

const root = resolve(new URL('..', import.meta.url).pathname)
const [, , outArg = 'out/gallery', ...only] = process.argv
const out = resolve(outArg)

const systems = readdirSync(join(root, 'systems'), { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(join(root, 'systems', e.name, 'layouts.mjs')))
  .map((e) => ({ folder: e.name, ...JSON.parse(readFileSync(join(root, 'systems', e.name, 'system.json'), 'utf8')) }))
  .filter((s) => only.length === 0 || only.includes(s.id))
  .sort((a, b) => a.folder.localeCompare(b.folder))
if (systems.length === 0) throw new Error('no renderable system matches')

const chrome = process.env.CHROME ?? [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].find((p) => existsSync(p))
if (!chrome) throw new Error('no Chrome found; set CHROME')

const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-first-run'] })
const manifest = []
try {
  for (const system of systems) {
    const dir = join(out, system.id)
    mkdirSync(dir, { recursive: true })
    execFileSync('node', [join(root, 'scripts/render.mjs'), system.id, dir], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] })
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 0.75 })
    await page.goto(pathToFileURL(join(dir, `deck-${system.id}.html`)).href, { waitUntil: 'networkidle0' })
    await page.evaluate(() => document.fonts.ready)
    // Static formats show every slide in its final state: animations and transitions jump to
    // their end, and videos stay on their poster.
    await page.addStyleTag({ content: '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;animation-iteration-count:1!important;transition-duration:0s!important;transition-delay:0s!important}' })
    await page.evaluate(() => { for (const v of document.querySelectorAll('video')) { v.pause(); v.currentTime = 0 } })
    const slides = await page.$$('section.slide')
    for (let i = 0; i < slides.length; i++) {
      await slides[i].screenshot({ path: join(dir, `slide-${String(i + 1).padStart(2, '0')}.webp`), type: 'webp', quality: 82 })
    }
    await page.close()
    rmSync(join(dir, `deck-${system.id}.html`))

    const source = existsSync(join(root, 'systems', system.folder, 'source.json'))
      ? JSON.parse(readFileSync(join(root, 'systems', system.folder, 'source.json'), 'utf8'))
      : {}
    manifest.push({ id: system.id, name: system.name, slides: slides.length, source })
    console.log(`${system.id}: ${slides.length} slides`)
  }
} finally {
  await browser.close()
}
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
