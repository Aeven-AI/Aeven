/**
 * Exports rendered CVs to PDF, DOCX and Pages.
 *
 * Input is the HTML `render.mjs` writes. Chrome opens it and paginates it; then:
 * - PDF: Chrome prints it, one A4 page per `section.page`, backgrounds included.
 * - DOCX (`docx.mjs`): every page as a picture of the page without its text, behind editable text
 *   boxes, one per line, placed where Chrome laid them out in the template's fonts, which are
 *   embedded so Word shows them on machines without them.
 * - Pages (.pages): the CV's fonts are installed (`installed-fonts.mjs`) and Pages opens the DOCX
 *   and saves it natively (macOS with Pages installed; skipped elsewhere). A workspace sandbox
 *   refuses both; inside one, the export writes the other formats and prints the command that
 *   adds the Pages file.
 *
 * Before exporting, the exporter prints a page report (`layout-report.mjs`): each page's sections
 * and how full it is, then a warning naming the cv.json change for an entry taller than a page, a
 * CV of more than four pages, or a last page left almost empty; with none it prints `layout ok`.
 * `--strict` turns warnings into a failed export. It then writes a small picture of every page to a
 * fresh directory under the system temp directory (or `$AVN_EXPORT_PREVIEW_DIR`) and prints their paths after `previews:`.
 *
 * Usage:
 *   node export.mjs <cv.html> [out directory] [formats]
 *   formats: comma-separated subset of pdf,docx,pages (default pdf,docx,pages)
 *
 * Chrome: $CHROME, else a Playwright Chromium ($PLAYWRIGHT_BROWSERS_PATH), else an installed Chrome,
 * Chromium, Edge or Brave, else Chrome Headless Shell downloaded once into $AVN_CV_CACHE
 * (default ~/.cache/aeven-cv).
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { basename, dirname, join, resolve } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import puppeteer from 'puppeteer-core'
import * as docx from 'docx'
import JSZip from 'jszip'
import { Browser, detectBrowserPlatform, install } from '@puppeteer/browsers'
import { PUPPETEER_REVISIONS } from 'puppeteer-core/internal/revisions.js'
import { FontInstallRefused, installFonts } from './installed-fonts.mjs'
import { officeFace } from './office-fonts.mjs'
import { ttfFaces } from './font-files.mjs'
import { documentOptions, extractAndHideText, fillTextBoxes } from './docx.mjs'
import { layoutReport, measureLayout } from './layout-report.mjs'

const MAX_PAGES = 4
/** Preview pictures at this share of the page's device pixels: about 635 px wide, enough to read the layout. */
const PREVIEW_SCALE = 0.4

const strict = process.argv.includes('--strict')
const [, , input, outArg, formatArg = 'pdf,docx,pages'] = process.argv.filter((a) => a !== '--strict')
if (!input) {
  console.error('usage: node export.mjs <cv.html> [out dir] [pdf,docx,pages]')
  process.exit(2)
}
const formats = new Set(formatArg.split(',').map((f) => f.trim()).filter(Boolean))
for (const f of formats) if (!['pdf', 'docx', 'pages'].includes(f)) throw new Error(`unknown format "${f}" (pdf, docx, pages)`)
if (formats.has('pages')) formats.add('docx') // Pages converts from the DOCX
const htmlPath = resolve(input)
const outDir = resolve(outArg ?? dirname(htmlPath))
const name = basename(htmlPath, '.html')
mkdirSync(outDir, { recursive: true })

/** Installed Chrome-family browsers in their standard places, most likely first. */
function installedBrowsers() {
  const home = homedir()
  if (process.platform === 'darwin') {
    const bundles = [['Google Chrome.app', 'Google Chrome'], ['Chromium.app', 'Chromium'], ['Microsoft Edge.app', 'Microsoft Edge'], ['Brave Browser.app', 'Brave Browser']]
    return ['/Applications', join(home, 'Applications')].flatMap((dir) => bundles.map(([app, bin]) => join(dir, app, 'Contents', 'MacOS', bin)))
  }
  if (process.platform === 'win32') {
    const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean)
    return [...roots.map((r) => join(r, 'Google', 'Chrome', 'Application', 'chrome.exe')), ...roots.map((r) => join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))]
  }
  return ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium', '/usr/bin/microsoft-edge']
}

/** Chromium builds a Playwright install keeps under $PLAYWRIGHT_BROWSERS_PATH (the hosted sandbox image). */
function playwrightBrowsers() {
  const dir = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (!dir || !existsSync(dir)) return []
  return readdirSync(dir).sort().reverse().flatMap((d) => {
    if (d.startsWith('chromium_headless_shell-')) return [join(dir, d, 'chrome-headless-shell-linux64', 'chrome-headless-shell'), join(dir, d, 'chrome-headless-shell-linux-arm64', 'chrome-headless-shell'), join(dir, d, 'chrome-linux', 'headless_shell')]
    if (d.startsWith('chromium-')) return [join(dir, d, 'chrome-linux', 'chrome'), join(dir, d, 'chrome-linux64', 'chrome')]
    return []
  })
}

/**
 * The folder preview pictures go under: `$AVN_EXPORT_PREVIEW_DIR`, relative to the home folder
 * unless absolute, where a sandbox keeps the system temp folder from the tools that read images;
 * the system temp folder otherwise.
 */
function previewRoot() {
  const configured = process.env.AVN_EXPORT_PREVIEW_DIR
  if (!configured) return tmpdir()
  const dir = resolve(homedir(), configured)
  mkdirSync(dir, { recursive: true })
  return dir
}

/** The browser that paginates, prints and photographs the CV. */
async function resolveChrome() {
  if (process.env.CHROME) {
    if (!existsSync(process.env.CHROME)) throw new Error(`CHROME=${process.env.CHROME} does not exist`)
    return process.env.CHROME
  }
  const found = [...playwrightBrowsers(), ...installedBrowsers()].find((p) => existsSync(p))
  if (found) return found
  const platform = detectBrowserPlatform()
  if (!platform) throw new Error('no Chrome found and this platform has no Chrome Headless Shell build; set CHROME')
  const cacheDir = process.env.AVN_CV_CACHE ?? join(homedir(), '.cache', 'aeven-cv')
  const buildId = PUPPETEER_REVISIONS['chrome-headless-shell']
  console.warn(`no Chrome found; downloading Chrome Headless Shell ${buildId} into ${cacheDir} (once)`)
  return (await install({ browser: Browser.CHROMEHEADLESSSHELL, buildId, cacheDir, platform })).executablePath
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const osascript = (script) => execFileSync('osascript', ['-e', script], { encoding: 'utf8', timeout: 180_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const pagesRunning = () => {
  try {
    execFileSync('pgrep', ['-xq', 'Pages'])
    return true
  } catch {
    // pgrep exits 1 when no process matches.
    return false
  }
}
const pagesDocuments = () => {
  const names = osascript(`tell application id "com.apple.Pages" to set names to name of every document
    set AppleScript's text item delimiters to linefeed
    return names as text`)
  return names ? names.split('\n') : []
}

/**
 * Pages opens the DOCX and saves it as .pages; false where Pages is unavailable, `{ refused }`
 * where a sandbox refuses installing fonts or sending Apple Events. A copy of the DOCX under a
 * name of its own is opened by script, which hands back the document to save and close; the
 * screen may be locked, which hides Pages's document list from scripts but not a document a
 * script opened. The name is new each run, so a document an earlier, interrupted export left
 * open in Pages, or one of the person's own, is never taken for it.
 */
async function toPages(docxPath, pagesPath, families) {
  if (process.platform !== 'darwin') return false
  if (!execFileSync('mdfind', ['kMDItemCFBundleIdentifier == "com.apple.Pages"'], { encoding: 'utf8' }).trim()) return false
  let added
  try {
    added = await installFonts(families)
  } catch (error) {
    if (!(error instanceof FontInstallRefused)) throw error
    return { refused: error.message }
  }
  if (added.length) console.log(`installed for Pages: ${added.join(', ')}`)
  if (added.length && pagesRunning()) {
    try {
      if (pagesDocuments().length === 0) {
        osascript('tell application id "com.apple.Pages" to quit')
        for (let i = 0; i < 150 && pagesRunning(); i++) await sleep(100)
      }
    } catch {
      // A locked screen hides the document list; Pages keeps running and shows substitutes for the new fonts.
    }
  }
  const launched = !pagesRunning()
  const docName = `${basename(docxPath, '.docx')}-${randomBytes(4).toString('hex')}`
  rmSync(pagesPath, { recursive: true, force: true })
  const staging = mkdtempSync(join(tmpdir(), 'aeven-cv-pages-'))
  try {
    const staged = join(staging, `${docName}.docx`)
    copyFileSync(docxPath, staged)
    const quoted = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    try {
      osascript(`
        with timeout of 170 seconds
          tell application id "com.apple.Pages"
            set d to open (POSIX file "${quoted(staged)}")
            save d in (POSIX file "${quoted(pagesPath)}")
            close d saving no
          end tell
        end timeout`)
    } catch (error) {
      const detail = String(error.stderr ?? error.message).trim()
      if (/-10004|-1743/.test(detail)) return { refused: 'sending Apple Events to Pages was refused' }
      throw new Error(`Pages could not convert ${docxPath}: ${detail}`)
    }
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
  if (launched) {
    try {
      osascript('tell application id "com.apple.Pages" to quit')
    } catch {
      // Pages refused to quit; it stays open with nothing of this export in it.
    }
  }
  return true
}

const browser = await puppeteer.launch({
  executablePath: await resolveChrome(),
  headless: true,
  // Inside the agent's workspace sandbox Chrome's own sandbox cannot initialise; the outer
  // sandbox still confines the browser.
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--font-render-hinting=none'],
})
let failed = false
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 900, height: 1200, deviceScaleFactor: 2 })
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle0' })
  await page.waitForSelector('html[data-paginated]', { timeout: 30_000 })
  const cvData = JSON.parse(await page.$eval('#cv-data', (el) => el.textContent))
  const { lines, warnings } = layoutReport(await page.evaluate(measureLayout), cvData.cv, { name, maxPages: MAX_PAGES })
  for (const line of lines) console.log(line)
  for (const w of warnings) console.warn(`${name}: ${w}`)
  if (!warnings.length) console.log(`${name}: layout ok`)
  if (strict && warnings.length) throw new Error(`${warnings.length} warning(s) with --strict`)

  // Previews before the DOCX step hides the text: small pictures of every page, outside the CV's folder.
  const previewDir = mkdtempSync(join(previewRoot(), `aeven-cv-${name}-`))
  const pageBoxes = await page.$$eval('section.page', (els) => els.map((el) => { const r = el.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height } }))
  const previews = []
  for (const [i, box] of pageBoxes.entries()) {
    const file = join(previewDir, `page-${i + 1}.png`)
    await page.screenshot({ path: file, clip: { ...box, scale: PREVIEW_SCALE }, captureBeyondViewport: true })
    previews.push(file)
  }
  console.log(`previews: ${previews.join(' ')}`)

  if (formats.has('pdf')) {
    await page.pdf({ path: join(outDir, `${name}.pdf`), preferCSSPageSize: true, printBackground: true })
    console.log(`${name}.pdf`)
  }

  if (formats.has('docx')) {
    const pages = await page.evaluate(extractAndHideText)
    const handles = await page.$$('section.page')
    for (let i = 0; i < pages.length; i++) pages[i].background = await handles[i].screenshot({ type: 'jpeg', quality: 88 })
    const used = new Map()
    const face = (family, weight, italic) => {
      const f = officeFace(family, weight, italic)
      used.set(`${f.typeface}|${f.bold}|${f.italic}`, f)
      return { font: f.typeface, bold: f.bold, italic: f.italic }
    }
    for (const p of pages) for (const line of p.lines) for (const r of line.runs) face(r.font, r.weight, r.italic)
    const fonts = []
    for (const f of used.values()) {
      if (f.weight === null || f.bold || f.italic || fonts.some((x) => x.name === f.typeface)) continue
      const files = await ttfFaces(f.family)
      const file = files.find((t) => t.weight === f.weight && t.style === 'normal') ?? files[0]
      fonts.push({ name: f.typeface, data: readFileSync(file.file), characterSet: docx.CharacterSet.ANSI })
    }
    const options = documentOptions(pages, docx, { title: `${cvData.cv.name} — CV`, creator: cvData.cv.name })
    const zip = await JSZip.loadAsync(await docx.Packer.toBuffer(new docx.Document({ ...options, fonts })))
    zip.file('word/document.xml', fillTextBoxes(await zip.file('word/document.xml').async('string'), pages, face))
    writeFileSync(join(outDir, `${name}.docx`), await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
    console.log(`${name}.docx`)

    if (formats.has('pages')) {
      const families = [...new Set([...used.values()].map((f) => f.family))]
      const result = await toPages(join(outDir, `${name}.docx`), join(outDir, `${name}.pages`), families)
      if (result === true) console.log(`${name}.pages`)
      else if (result) console.warn(`${name}: .pages skipped: ${result.refused}. Pages conversion installs the CV's fonts and scripts Pages, which a sandbox refuses; run this export again outside the sandbox for the Pages file: node ${JSON.stringify(process.argv[1])} ${JSON.stringify(htmlPath)} ${JSON.stringify(outDir)} pages`)
      else console.warn(`${name}: Pages file not made: Pages runs only on a Mac with Pages installed`)
    }
  }
} catch (error) {
  failed = true
  console.error(error.message)
} finally {
  await browser.close()
}
if (failed) process.exit(1)
