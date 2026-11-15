/**
 * Builds the CV gallery assets the Aeven app shows on its Inspiration page (Resumes).
 *
 * For each design system it renders the sample CV and writes, under `<out>/<system-id>/`:
 *   page-01.webp … page-NN.webp   every A4 page at 794×1123: the first is the gallery card's
 *                                 cover, all of them page through in the template popup
 * and `<out>/manifest.json`: `[{ id, name, pages, source }]` in system order.
 *
 * Usage: node scripts/gallery.mjs [out directory, default out/gallery] [system-id …]
 * Copy the output into the app's `apps/web/public/cv-templates/`.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import puppeteer from 'puppeteer-core'
import { SAMPLES_DIR, sampleFor } from './cv.mjs'
import { loadSystems, renderCv } from './render.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const [, , outArg = 'out/gallery', ...only] = process.argv
const out = resolve(outArg)

const systems = [...(await loadSystems()).values()].filter((s) => only.length === 0 || only.includes(s.id))
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
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    const html = join(dir, 'cv.html')
    writeFileSync(html, await renderCv(sampleFor(system), system, fileURLToPath(SAMPLES_DIR)))
    const page = await browser.newPage()
    await page.setViewport({ width: 900, height: 1200, deviceScaleFactor: 1 })
    await page.goto(pathToFileURL(html).href, { waitUntil: 'networkidle0' })
    await page.waitForSelector('html[data-paginated]')
    const overflow = await page.evaluate(() => document.documentElement.dataset.overflow)
    if (overflow) console.warn(`${system.id}: sample CV overflows (${overflow})`)
    const pages = await page.$$('section.page')
    for (let i = 0; i < pages.length; i++) {
      await pages[i].screenshot({ path: join(dir, `page-${String(i + 1).padStart(2, '0')}.webp`), type: 'webp', quality: 84 })
    }
    await page.close()
    rmSync(html)
    const sourcePath = join(root, 'systems', system.folder, 'source.json')
    const source = existsSync(sourcePath) ? JSON.parse(readFileSync(sourcePath, 'utf8')) : {}
    manifest.push({ id: system.id, name: system.name, pages: pages.length, source })
    console.log(`${system.id}: ${pages.length} pages`)
  }
} finally {
  await browser.close()
}
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
