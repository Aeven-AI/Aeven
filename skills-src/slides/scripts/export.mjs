/**
 * Exports rendered decks to PDF, PPTX and Keynote.
 *
 * Input is the HTML `render.mjs` writes: every slide is a `section.slide` of
 * 1280×720 CSS pixels. Each format comes from that one HTML file, so any
 * design system's layout carries over without per-system export code:
 *
 * - PDF: Chrome prints the deck, one 1280×720 page per slide.
 * - PPTX: every box, rule, circle and photo becomes a native PowerPoint shape or picture with
 *   its fill, border, corner radius, rotation and shadow; only what PowerPoint cannot draw
 *   (gradients, blurs, SVG art, masks, patterned backgrounds) becomes a small picture of that
 *   element. Text becomes native, editable text boxes at the position, size, weight and colour
 *   Chrome laid it out with, broken into lines where Chrome broke them so PowerPoint and Keynote
 *   cannot reflow it. Each weight is named the way Office names it ("Inter Tight ExtraBold") and
 *   embedded in the file (`pptx-fonts.mjs`); `pptx-package.mjs` fixes pptxgenjs's schema slips
 *   so PowerPoint opens the file without offering a repair.
 * - Keynote (.key): the deck's fonts are installed (`installed-fonts.mjs`) and Keynote opens the
 *   PPTX and saves it natively (macOS with Keynote installed; skipped elsewhere). It needs to run
 *   outside a workspace sandbox, which refuses both; inside one, the export writes the other
 *   formats and prints the command that adds the Keynote file.
 * - Cover (cover-<name>.jpg): the first slide as a 1280×720 JPEG.
 *
 * Static formats show each slide in its final state: CSS animations and transitions are jumped to
 * their end and videos are paused on their poster; the HTML deck plays them.
 *
 * Speaker notes (`<aside class="notes">` in a slide, written by render.mjs from a slide's
 * `notes`) become PPTX speaker notes. Before exporting, every deck is checked for text that
 * runs past its box or the slide edge; each finding is printed as a warning with the slide
 * number, and `--strict` turns findings into a failed export.
 *
 * Usage:
 *   node export.mjs <deck.html | directory of deck-*.html> [out directory] [formats]
 *   formats: comma-separated subset of pdf,pptx,key,cover (default pdf,pptx,key)
 *
 * Keynote cannot be scripted while the Mac's screen is locked. A locked run writes the other
 * formats, then starts one detached copy of this export with `--after-unlock`, which waits for the
 * Mac to be unlocked (up to a day) and adds the Keynote file to the same folder.
 *
 * Chrome: $CHROME, else a Playwright Chromium ($PLAYWRIGHT_BROWSERS_PATH), else an installed Chrome,
 * Chromium, Edge or Brave, else Chrome Headless Shell
 * downloaded once into $AVN_SLIDES_CACHE (default ~/.cache/aeven-slides).
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, statSync, rmSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { basename, dirname, join, resolve } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import puppeteer from 'puppeteer-core'
import { FontInstallRefused, installFonts } from './installed-fonts.mjs'
import { embedFonts, officeFace } from './pptx-fonts.mjs'
import { fixSchema } from './pptx-package.mjs'
import JSZip from 'jszip'
import PptxGenJS from 'pptxgenjs'
import { Browser, detectBrowserPlatform, install } from '@puppeteer/browsers'
import { PUPPETEER_REVISIONS } from 'puppeteer-core/internal/revisions.js'

const SLIDE_W_IN = 13.333
const SLIDE_H_IN = 7.5
const SCALE = 2 // background pictures at 2× for sharp text edges and hairlines

const strict = process.argv.includes('--strict')
const afterUnlock = process.argv.includes('--after-unlock')
const [, , input, outArg, formatArg = 'pdf,pptx,key'] = process.argv.filter((a) => a !== '--strict' && a !== '--after-unlock')
if (!input) {
  console.error('usage: node export.mjs <deck.html | dir> [out dir] [pdf,pptx,key,cover]')
  process.exit(2)
}
const formats = new Set(formatArg.split(',').map((f) => f.trim()).filter(Boolean))
for (const f of formats) if (!['pdf', 'pptx', 'key', 'cover'].includes(f)) throw new Error(`unknown format "${f}"`)
if (formats.has('key')) formats.add('pptx') // Keynote converts from the PPTX

const inputPath = resolve(input)
const decks = statSync(inputPath).isDirectory()
  ? readdirSync(inputPath).filter((n) => /^deck-.*\.html$/.test(n)).sort().map((n) => join(inputPath, n))
  : [inputPath]
if (decks.length === 0) throw new Error(`no deck-*.html in ${inputPath}`)
const outDir = resolve(outArg ?? (statSync(inputPath).isDirectory() ? inputPath : dirname(inputPath)))
mkdirSync(outDir, { recursive: true })

/** Installed Chrome-family browsers in their standard places, most likely first. */
function installedBrowsers() {
  const home = homedir()
  if (process.platform === 'darwin') {
    const bundles = [['Google Chrome.app', 'Google Chrome'], ['Chromium.app', 'Chromium'], ['Microsoft Edge.app', 'Microsoft Edge'], ['Brave Browser.app', 'Brave Browser']]
    return ['/Applications', join(home, 'Applications')].flatMap((root) => bundles.map(([app, bin]) => join(root, app, 'Contents', 'MacOS', bin)))
  }
  if (process.platform === 'win32') {
    const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean)
    return [
      ...roots.map((root) => join(root, 'Google', 'Chrome', 'Application', 'chrome.exe')),
      ...roots.map((root) => join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe')),
    ]
  }
  return ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium', '/usr/bin/microsoft-edge']
}

/**
 * Chromium builds a Playwright install keeps under $PLAYWRIGHT_BROWSERS_PATH, such as the
 * headless Chromium Aeven's hosted sandbox image carries for motion rendering.
 */
function playwrightBrowsers() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (!root || !existsSync(root)) return []
  return readdirSync(root).sort().reverse().flatMap((dir) => {
    if (dir.startsWith('chromium_headless_shell-')) {
      return [join(root, dir, 'chrome-headless-shell-linux64', 'chrome-headless-shell'), join(root, dir, 'chrome-headless-shell-linux-arm64', 'chrome-headless-shell'), join(root, dir, 'chrome-linux', 'headless_shell')]
    }
    if (dir.startsWith('chromium-')) return [join(root, dir, 'chrome-linux', 'chrome'), join(root, dir, 'chrome-linux64', 'chrome')]
    return []
  })
}

/**
 * The browser that prints and photographs the deck: $CHROME, a Playwright Chromium under
 * $PLAYWRIGHT_BROWSERS_PATH, an installed Chrome, Chromium, Edge or Brave, else Chrome Headless Shell downloaded once into the cache directory
 * ($AVN_SLIDES_CACHE, default ~/.cache/aeven-slides) and reused afterwards.
 */
async function resolveChrome() {
  if (process.env.CHROME) {
    if (!existsSync(process.env.CHROME)) throw new Error(`CHROME=${process.env.CHROME} does not exist`)
    return process.env.CHROME
  }
  const installed = [...playwrightBrowsers(), ...installedBrowsers()].find((path) => existsSync(path))
  if (installed) return installed
  const platform = detectBrowserPlatform()
  if (!platform) throw new Error('no Chrome found and this platform has no Chrome Headless Shell build; set CHROME')
  const cacheDir = process.env.AVN_SLIDES_CACHE ?? join(homedir(), '.cache', 'aeven-slides')
  const buildId = PUPPETEER_REVISIONS['chrome-headless-shell']
  console.warn(`no Chrome found; downloading Chrome Headless Shell ${buildId} into ${cacheDir} (once)`)
  const browser = await install({ browser: Browser.CHROMEHEADLESSSHELL, buildId, cacheDir, platform })
  return browser.executablePath
}

/**
 * Runs in the page: reads every text block of every slide, then hides the text
 * so the background picture carries only shapes, colour and imagery.
 */
function extractAndHideText() {
  const SYSTEM_FONTS = new Set(['-apple-system', 'blinkmacsystemfont', 'system-ui', 'ui-sans-serif', 'sans-serif', 'serif', 'monospace', 'ui-serif', 'ui-monospace'])
  const PORTABLE = { 'sans-serif': 'Arial', serif: 'Georgia', monospace: 'Courier New' }

  /** The PowerPoint font for a CSS stack: the first named family, or a portable stand-in for a system stack. */
  const fontFace = (stack) => {
    const families = stack.split(',').map((f) => f.trim().replace(/^["']|["']$/g, ''))
    const first = families[0].toLowerCase()
    if (!SYSTEM_FONTS.has(first)) return families[0]
    if (first === 'serif' || first === 'ui-serif') return PORTABLE.serif
    if (first === 'monospace' || first === 'ui-monospace') return PORTABLE.monospace
    return PORTABLE['sans-serif']
  }
  const rgba = (css) => {
    const m = css.match(/rgba?\(([^)]+)\)/)
    if (!m) return { hex: '000000', alpha: 1 }
    const [r, g, b, a = '1'] = m[1].split(/[ ,/]+/).filter(Boolean)
    const hex = [r, g, b].map((v) => Math.round(Number(v)).toString(16).padStart(2, '0')).join('').toUpperCase()
    return { hex, alpha: Number(a) }
  }
  const effectiveOpacity = (el) => {
    let o = 1
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) o *= Number(getComputedStyle(e).opacity)
    return o
  }
  const transform = (text, mode) =>
    mode === 'uppercase' ? text.toUpperCase()
      : mode === 'lowercase' ? text.toLowerCase()
        : mode === 'capitalize' ? text.replace(/\b\p{L}/gu, (c) => c.toUpperCase())
          : text
  const blockOf = (el) => {
    for (let e = el; e; e = e.parentElement) {
      const d = getComputedStyle(e).display
      if (d !== 'inline' && d !== 'contents') return e
    }
    return el
  }

  const slides = [...document.querySelectorAll('section.slide')]
  const hide = []
  const out = slides.map((slide) => {
    const sr = slide.getBoundingClientRect()
    const blocks = new Map()
    const walker = document.createTreeWalker(slide, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeType === 1) {
        if (node.tagName === 'BR') {
          const block = blockOf(node.parentElement)
          blocks.get(block)?.items.push({ br: true })
        } else if (/^inline-/.test(getComputedStyle(node).display) && node.textContent.trim()) {
          // An inline-block chip in a sentence is its own text box; the sentence keeps the gap.
          blocks.get(blockOf(node.parentElement))?.items.push({ gap: true })
        }
        continue
      }
      const parent = node.parentElement
      if (!parent || parent.closest('svg')) continue
      if (!node.data.trim()) {
        // Spaces between inline elements ("<span>One</span> <span>sentence</span>") separate words.
        if (node.data) blocks.get(blockOf(parent))?.items.push({ space: true })
        continue
      }
      const style = getComputedStyle(parent)
      if (style.visibility === 'hidden' || style.display === 'none') continue
      const opacity = effectiveOpacity(parent)
      if (opacity < 0.02) continue
      const block = blockOf(parent)
      if (!blocks.has(block)) blocks.set(block, { items: [] })
      blocks.get(block).items.push({ node, style, opacity })
    }

    const texts = []
    for (const [block, { items }] of blocks) {
      const bs = getComputedStyle(block)
      const vertical = bs.writingMode.startsWith('vertical') || bs.writingMode.startsWith('sideways')
      // Each run is one same-styled piece of one browser line, with that piece's box. Lines break
      // where Chrome broke them, so PowerPoint and Keynote cannot reflow a paragraph differently.
      const runs = []
      let lastTop = null, lineHeightPx = 0, gap = false, firstLine = 0, space = false, runLineHeight = 0
      const range = document.createRange()
      const endLine = () => { const last = runs[runs.length - 1]; if (last) { last.text = last.text.replace(/ $/, ''); last.breakLine = true } }
      for (const item of items) {
        if (item.br) { endLine(); lastTop = null; continue }
        if (item.gap) { gap = true; if (runs.length) runs[runs.length - 1].gapAfter = true; continue }
        if (item.space) { space = true; continue }
        const s = item.style
        const color = rgba(s.color)
        const spacing = parseFloat(s.letterSpacing)
        // A line is as tall as the tallest inline box on it: a big span in a small-text block sets it.
        const ownLineHeight = parseFloat(s.lineHeight)
        runLineHeight = Math.max(runLineHeight, Number.isFinite(ownLineHeight) ? ownLineHeight : parseFloat(s.fontSize) * 1.2)
        const style = {
          font: fontFace(s.fontFamily),
          size: parseFloat(s.fontSize),
          weight: Number(s.fontWeight),
          italic: s.fontStyle === 'italic',
          underline: s.textDecorationLine.includes('underline'),
          strike: s.textDecorationLine.includes('line-through'),
          color: color.hex,
          alpha: color.alpha * item.opacity,
          letterSpacing: Number.isFinite(spacing) ? spacing : 0,
        }
        const data = item.node.data
        let piece = null
        const flush = () => { if (piece) { piece.text = transform(piece.text, s.textTransform); runs.push(piece); piece = null } }
        const words = /\S+/g
        for (let m = words.exec(data); m; m = words.exec(data)) {
          range.setStart(item.node, m.index)
          range.setEnd(item.node, m.index + m[0].length)
          const r = [...range.getClientRects()].find((x) => x.width > 0)
          if (!r) continue
          if (!firstLine) firstLine = r.height
          if (!lineHeightPx) lineHeightPx = r.height
          const newLine = !vertical && lastTop !== null && r.top > lastTop + lineHeightPx * 0.5
          if (newLine) { flush(); endLine() }
          if (lastTop === null || newLine) lastTop = r.top
          if (!piece) {
            // A piece keeps the space before its first word unless it opens a line.
            const lead = !newLine && ((m.index > 0 && /\s/.test(data[m.index - 1])) || (m.index === 0 && space && runs.length && !/ $/.test(runs[runs.length - 1].text))) ? ' ' : ''
            piece = { ...style, text: lead, left: r.left, top: r.top, right: r.right, bottom: r.bottom }
          }
          piece.text += (piece.text.trim() ? data.slice(piece.end, m.index).replace(/\s+/g, ' ') : '') + m[0]
          piece.end = m.index + m[0].length
          piece.left = Math.min(piece.left, r.left); piece.right = Math.max(piece.right, r.right)
          piece.top = Math.min(piece.top, r.top); piece.bottom = Math.max(piece.bottom, r.bottom)
        }
        if (piece && /\s$/.test(data)) piece.text += ' '
        space = false
        flush()
        hide.push(item.node)
      }
      if (!runs.length) continue
      for (const r of runs) delete r.end

      const br = block.getBoundingClientRect()
      // A rotated block (a slanted title) is placed by its own unrotated size around the centre of
      // its on-screen box, and turned by the summed rotation of it and its ancestors.
      let rotation = 0
      for (let e = block; e && e !== slide; e = e.parentElement) {
        const st = getComputedStyle(e)
        const m = st.transform.match(/^matrix\(([^)]+)\)/)
        if (m) { const [a, b] = m[1].split(',').map(Number); rotation += Math.atan2(b, a) * 180 / Math.PI }
        if (st.rotate && st.rotate !== 'none') rotation += parseFloat(st.rotate)
      }
      // Vertical writing runs the line down the page: a text box turned a quarter, with its
      // width and height swapped.
      if (vertical) rotation += bs.writingMode === 'sideways-lr' ? -90 : 90
      const innerW = block.clientWidth - parseFloat(bs.paddingLeft) - parseFloat(bs.paddingRight)
      const innerH = block.clientHeight - parseFloat(bs.paddingTop) - parseFloat(bs.paddingBottom)
      const turned = Math.abs(((rotation % 360) + 360) % 360) > 0.5 ? {
        rotation,
        cx: (br.left + br.right) / 2 - sr.left, cy: (br.top + br.bottom) / 2 - sr.top,
        cw: vertical ? innerH : innerW,
        ch: vertical ? innerW : innerH,
      } : null
      const lh = parseFloat(bs.lineHeight)
      const align = ['center', 'right', 'end'].includes(bs.textAlign) ? (bs.textAlign === 'end' ? 'right' : bs.textAlign) : 'left'
      const lineHeight = Math.max(Number.isFinite(lh) ? lh : parseFloat(bs.fontSize) * 1.2, runLineHeight)
      const contentLeft = br.left + parseFloat(bs.paddingLeft) + parseFloat(bs.borderLeftWidth)
      const contentRight = br.right - parseFloat(bs.paddingRight) - parseFloat(bs.borderRightWidth)
      const entry = (group, groupAlign) => {
        group[0].text = group[0].text.replace(/^ /, '')
        group[group.length - 1].text = group[group.length - 1].text.replace(/ $/, '')
        const left = Math.min(...group.map((r) => r.left)), right = Math.max(...group.map((r) => r.right))
        const top = Math.min(...group.map((r) => r.top)), bottom = Math.max(...group.map((r) => r.bottom))
        const lines = 1 + group.slice(0, -1).filter((r) => r.breakLine).length
        group[group.length - 1].breakLine = false
        return {
          runs: group.map(({ left: _l, top: _t, right: _r, bottom: _b, gapAfter: _g, ...run }) => run),
          x: left - sr.left, y: top - sr.top, w: right - left, h: bottom - top,
          contentX: contentLeft - sr.left, contentW: contentRight - contentLeft,
          lines, explicitLines: !vertical, contentHeight: firstLine, align: groupAlign, lineHeight,
        }
      }
      if (gap && !turned) {
        // Each stretch of words between chips and line ends is its own left-aligned text box.
        let group = []
        for (const r of runs) {
          group.push(r)
          if (r.breakLine || r.gapAfter) { texts.push(entry(group, 'left')); group = [] }
        }
        if (group.length) texts.push(entry(group, 'left'))
      } else {
        texts.push({ ...entry(runs, align), turned })
      }
    }
    const notes = slide.querySelector('aside.notes')?.textContent.trim() ?? ''
    return { width: sr.width, height: sr.height, texts, notes }
  })

  for (const node of hide) {
    const span = document.createElement('span')
    span.style.cssText = 'color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;text-decoration-color:transparent!important'
    node.parentNode.insertBefore(span, node)
    span.appendChild(node)
  }
  return out
}

/**
 * Runs in the page: text that leaves its slide (beyond a quarter of its type size vertically, the
 * room above and below the letters in a line box), or a clipping box (overflow other than visible)
 * whose content is taller or wider than the box. Returns {slide, what} findings.
 */
function findOverflow() {
  const findings = []
  document.querySelectorAll('section.slide').forEach((slide, i) => {
    const sr = slide.getBoundingClientRect()
    const walker = document.createTreeWalker(slide, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.data.trim() || node.parentElement.closest('aside.notes')) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      const r = range.getBoundingClientRect()
      if (r.width === 0) continue
      // A line box runs from the font's ascent to its descent, past the drawn letters; display type
      // set tight to an edge is fine as long as the box stays within a quarter of the type size.
      const slack = Math.max(1, parseFloat(getComputedStyle(node.parentElement).fontSize) * 0.25)
      if (r.left < sr.left - 1 || r.right > sr.right + 1 || r.top < sr.top - slack || r.bottom > sr.bottom + slack) {
        findings.push({ slide: i + 1, what: `text "${node.data.trim().slice(0, 40)}" runs past the slide edge` })
      }
    }
    for (const el of slide.querySelectorAll('*')) {
      const s = getComputedStyle(el)
      if (s.overflow === 'visible' || el.tagName === 'IMG' || !el.textContent.trim()) continue
      if (el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2) {
        findings.push({ slide: i + 1, what: `<${el.tagName.toLowerCase()} class="${el.className}"> clips its content ("${el.textContent.trim().slice(0, 40)}")` })
      }
    }
  })
  return findings
}

/**
 * Runs in the page: every slide's visuals as native PowerPoint material, in paint order.
 * - `shape`: a box with a solid fill and/or a uniform border becomes a rectangle, rounded
 *   rectangle or ellipse; a box with borders on only some sides becomes one line per side.
 * - `image`: an `<img>` PowerPoint can place as it is (no rounding, cover/contain/fill).
 * - `raster`: anything PowerPoint cannot draw (SVG, gradients and background images, filters,
 *   masks, clip paths, blend modes, shadows, skew, pseudo-element art, content clipped by its
 *   box) becomes a picture of that element. Where only the element's own background needs a
 *   picture (`own`), its children stay native; otherwise its whole subtree is in the picture.
 * Rasters are marked with `data-avn-raster` for the screenshot pass. The slide's own solid
 * background becomes the slide background.
 */
function extractShapes() {
  const SKIP = new Set(['SCRIPT', 'STYLE', 'ASIDE', 'BR', 'TEMPLATE', 'NOSCRIPT'])
  const color = (css) => {
    const m = css && css.match(/rgba?\(([^)]+)\)/)
    if (!m) return null
    const [r, g, b, a = '1'] = m[1].split(/[ ,/]+/).filter(Boolean)
    const alpha = Number(a)
    if (alpha <= 0.01) return null
    return { hex: [r, g, b].map((v) => Math.round(Number(v)).toString(16).padStart(2, '0')).join('').toUpperCase(), alpha }
  }
  const rotationOf = (el, slide) => {
    let rotation = 0
    for (let e = el; e && e !== slide.parentElement; e = e.parentElement) {
      const st = getComputedStyle(e)
      const m = st.transform.match(/^matrix\(([^)]+)\)/)
      if (m) { const [a, b] = m[1].split(',').map(Number); rotation += Math.atan2(b, a) * 180 / Math.PI }
      if (st.rotate && st.rotate !== 'none') rotation += parseFloat(st.rotate)
    }
    return Math.abs(rotation) > 0.5 ? rotation : 0
  }
  /** Whether a transform is more than a rotation and translation (scale or skew), which shapes cannot follow. */
  const distorted = (st) => {
    const m = st.transform.match(/^matrix\(([^)]+)\)/)
    if (st.transform.startsWith('matrix3d')) return true
    if (!m) return st.scale && st.scale !== 'none'
    const [a, b, c, d] = m[1].split(',').map(Number)
    const sx = Math.hypot(a, b), sy = Math.hypot(c, d)
    return Math.abs(sx - 1) > 0.01 || Math.abs(sy - 1) > 0.01 || Math.abs(a * c + b * d) > 0.01
  }
  const pseudoArt = (el) => ['::before', '::after'].some((p) => {
    const ps = getComputedStyle(el, p)
    if (!ps.content || ps.content === 'none' || ps.content === 'normal' || ps.display === 'none') return false
    return true
  })
  /** The first outer box-shadow as {x, y, blur, color}, or null when there is none or it is inset or spread. */
  const parseShadow = (css) => {
    if (!css || css === 'none' || css.includes('inset')) return null
    const first = css.split(/,(?![^(]*\))/)[0]
    const c = color(first)
    const lengths = (first.replace(/rgba?\([^)]*\)/, '').match(/-?[\d.]+px/g) ?? []).map(parseFloat)
    if (!c || lengths.length < 2 || (lengths[3] ?? 0) !== 0) return null
    return { x: lengths[0], y: lengths[1], blur: lengths[2] ?? 0, color: c }
  }
  const clipsChildren = (el, st, r) => {
    if (st.overflow === 'visible' && st.overflowX === 'visible' && st.overflowY === 'visible') return false
    for (const child of el.querySelectorAll('*')) {
      const cr = child.getBoundingClientRect()
      if (cr.width === 0 && cr.height === 0) continue
      if (cr.left < r.left - 1 || cr.top < r.top - 1 || cr.right > r.right + 1 || cr.bottom > r.bottom + 1) return true
    }
    return false
  }
  const effectiveOpacity = (el, slide) => {
    let o = 1
    for (let e = el; e && e !== slide.parentElement; e = e.parentElement) o *= Number(getComputedStyle(e).opacity)
    return o
  }

  let rasterId = 0
  return [...document.querySelectorAll('section.slide')].map((slide) => {
    const sr = slide.getBoundingClientRect()
    const items = []
    let background = null
    const box = (el, r) => ({ x: r.left - sr.left, y: r.top - sr.top, w: r.width, h: r.height })
    const turnedBox = (el, r, rotation) => {
      // A rotated element is placed by its own unrotated size around the centre of its screen box.
      const cx = (r.left + r.right) / 2 - sr.left, cy = (r.top + r.bottom) / 2 - sr.top
      return { x: cx - el.offsetWidth / 2, y: cy - el.offsetHeight / 2, w: el.offsetWidth, h: el.offsetHeight }
    }
    // A picture covers the part of the element on the slide (an element can hang past the slide
    // edge); `clip` is that part in page coordinates, for the screenshot.
    const raster = (el, r, own) => {
      const left = Math.max(r.left, sr.left), top = Math.max(r.top, sr.top)
      const right = Math.min(r.right, sr.right), bottom = Math.min(r.bottom, sr.bottom)
      if (right - left < 1 || bottom - top < 1) return
      const id = String(++rasterId)
      el.setAttribute('data-avn-raster', id)
      items.push({
        type: 'raster', id, own,
        x: left - sr.left, y: top - sr.top, w: right - left, h: bottom - top,
        clip: { x: left + scrollX, y: top + scrollY, width: right - left, height: bottom - top },
      })
    }

    const walk = (el) => {
      if (SKIP.has(el.tagName)) return
      const st = getComputedStyle(el)
      if (st.display === 'none' || st.visibility === 'hidden') return
      const r = el.getBoundingClientRect()
      if (r.width < 0.5 || r.height < 0.5) {
        for (const child of el.children) walk(child)
        return
      }
      const opacity = effectiveOpacity(el, slide)
      if (opacity < 0.02) return
      const whole = el instanceof SVGElement || ['CANVAS', 'VIDEO', 'IFRAME', 'OBJECT', 'EMBED', 'PICTURE'].includes(el.tagName)
        || st.filter !== 'none' || (st.backdropFilter && st.backdropFilter !== 'none')
        || st.clipPath !== 'none' || (st.maskImage && st.maskImage !== 'none') || (st.webkitMaskImage && st.webkitMaskImage !== 'none')
        || st.mixBlendMode !== 'normal' || distorted(st) || (el !== slide && clipsChildren(el, st, r))
      if (whole) { raster(el, r, false); return }

      if (el.tagName === 'IMG') {
        const radius = parseFloat(st.borderTopLeftRadius) || 0
        const fit = st.objectFit
        if (radius === 0 && ['cover', 'contain', 'fill'].includes(fit) && (st.objectPosition === '50% 50%' || fit === 'fill') && el.currentSrc) {
          items.push({ type: 'image', src: el.currentSrc, fit, natural: [el.naturalWidth, el.naturalHeight], rotation: rotationOf(el, slide), transparency: Math.round((1 - opacity) * 100), ...box(el, r) })
        } else raster(el, r, false)
        return
      }

      const shadow = parseShadow(st.boxShadow)
      const ownArt = st.backgroundImage !== 'none' || (st.boxShadow !== 'none' && !shadow) || pseudoArt(el)
      if (ownArt) {
        raster(el, r, true)
      } else {
        const fill = color(st.backgroundColor)
        const sides = ['Top', 'Right', 'Bottom', 'Left'].map((s) => ({
          width: parseFloat(st[`border${s}Width`]) || 0, color: color(st[`border${s}Color`]), style: st[`border${s}Style`],
        })).map((s) => (s.style === 'none' || s.style === 'hidden' || !s.color ? { ...s, width: 0 } : s))
        const uniform = sides.every((s) => s.width === sides[0].width && s.color?.hex === sides[0].color?.hex && s.style === sides[0].style)
        // A percentage radius is relative to the box: 50% or more makes an ellipse whatever the box's shape.
        const radiusCss = ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map((c) => st[`border${c}Radius`])
        const oval = radiusCss.every((v) => v.trim().endsWith('%') && parseFloat(v) >= 50)
        const radii = radiusCss.map((v) => (v.trim().endsWith('%') ? (parseFloat(v) / 100) * Math.min(r.width, r.height) : parseFloat(v) || 0))
        const sameRadius = radii.every((v) => Math.abs(v - radii[0]) < 0.5)
        if (el === slide && fill && !sides.some((s) => s.width)) {
          background = fill
        } else if ((fill || sides.some((s) => s.width)) && !sameRadius) {
          raster(el, r, true)
        } else if (fill || (uniform && sides[0].width)) {
          const rotation = rotationOf(el, slide)
          const geo = rotation ? turnedBox(el, r, rotation) : box(el, r)
          const radius = radii[0]
          const full = radius >= Math.min(geo.w, geo.h) / 2 - 0.5
          if (shadow && shadow.blur < 0.5) {
            // A hard offset shadow is the same shape again, behind and shifted.
            items.push({ type: 'shape', shape: oval ? 'ellipse' : radius <= 0.5 ? 'rect' : full && Math.abs(geo.w - geo.h) < 1 ? 'ellipse' : 'roundRect',
              radius: Math.min(radius, Math.min(geo.w, geo.h) / 2), fill: { ...shadow.color, alpha: shadow.color.alpha * opacity }, line: null,
              rotation, ...geo, x: geo.x + shadow.x, y: geo.y + shadow.y })
          }
          items.push({
            type: 'shape',
            shadow: shadow && shadow.blur >= 0.5 ? { ...shadow, alpha: shadow.color.alpha * opacity } : null,
            shape: oval ? 'ellipse' : radius <= 0.5 ? 'rect' : full && Math.abs(geo.w - geo.h) < 1 ? 'ellipse' : 'roundRect',
            radius: Math.min(radius, Math.min(geo.w, geo.h) / 2),
            fill: fill && { ...fill, alpha: fill.alpha * opacity },
            line: uniform && sides[0].width ? { ...sides[0].color, alpha: sides[0].color.alpha * opacity, width: sides[0].width, dash: sides[0].style } : null,
            rotation, ...geo,
          })
          if (!uniform) {
            // Borders on only some sides (rules, underlines) over a filled box: one line per side.
            pushSides(el, r, sides, opacity)
          }
        } else if (sides.some((s) => s.width)) {
          if (sameRadius && radii[0] > 0.5) raster(el, r, true)
          else pushSides(el, r, sides, opacity)
        }
      }
      for (const child of el.children) walk(child)
    }
    const pushSides = (el, r, sides, opacity) => {
      const b = box(el, r)
      const [top, right, bottom, left] = sides
      const line = (s, x1, y1, x2, y2) => s.width && items.push({
        type: 'line', x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1),
        line: { ...s.color, alpha: s.color.alpha * opacity, width: s.width, dash: s.style },
      })
      line(top, b.x, b.y + top.width / 2, b.x + b.w, b.y + top.width / 2)
      line(bottom, b.x, b.y + b.h - bottom.width / 2, b.x + b.w, b.y + b.h - bottom.width / 2)
      line(left, b.x + left.width / 2, b.y, b.x + left.width / 2, b.y + b.h)
      line(right, b.x + b.w - right.width / 2, b.y, b.x + b.w - right.width / 2, b.y + b.h)
    }
    walk(slide)
    return { width: sr.width, height: sr.height, background, items }
  })
}

/** PowerPoint dash type for a CSS border style. */
const DASH = { dashed: 'dash', dotted: 'sysDot' }

/**
 * Add one extracted visual to a PPTX slide, in inches on the 13.333×7.5 slide.
 * @param {object} pptx - the presentation, for its shape type names.
 * @param {object} slide - the PPTX slide.
 * @param {object} item - one item from extractShapes (rasters carry their picture as `data`).
 * @param {number} sx - inches per CSS pixel horizontally.
 * @param {number} sy - inches per CSS pixel vertically.
 */
function addVisual(pptx, slide, item, sx, sy) {
  const pos = { x: item.x * sx, y: item.y * sy, w: Math.max(item.w * sx, 0.001), h: Math.max(item.h * sy, 0.001) }
  const pt = (px) => Math.round(px * 0.75 * 100) / 100
  const transparency = (alpha) => Math.round((1 - Math.min(1, alpha)) * 100)
  if (item.type === 'raster') {
    slide.addImage({ data: item.data, ...pos })
  } else if (item.type === 'image') {
    const sizing = item.fit === 'fill' ? undefined : { type: item.fit, w: pos.w, h: pos.h }
    slide.addImage({ path: item.src.startsWith('data:') ? undefined : item.src, data: item.src.startsWith('data:') ? item.src : undefined, ...pos, sizing, rotate: item.rotation || undefined, transparency: item.transparency || undefined })
  } else if (item.type === 'line') {
    slide.addShape(pptx.ShapeType.line, {
      ...pos, h: item.h * sy, w: item.w * sx,
      line: { color: item.line.hex, width: pt(item.line.width), transparency: transparency(item.line.alpha), dashType: DASH[item.line.dash] },
    })
  } else {
    slide.addShape(pptx.ShapeType[item.shape], {
      ...pos,
      fill: item.fill ? { color: item.fill.hex, transparency: transparency(item.fill.alpha) } : { type: 'none' },
      line: item.line ? { color: item.line.hex, width: pt(item.line.width), transparency: transparency(item.line.alpha), dashType: DASH[item.line.dash] } : { type: 'none' },
      // pptxgenjs takes the corner radius in inches and writes it as PowerPoint's share of the shorter side.
      rectRadius: item.shape === 'roundRect' ? item.radius * Math.min(sx, sy) : undefined,
      rotate: item.rotation || undefined,
      shadow: item.shadow ? {
        type: 'outer', color: item.shadow.color.hex, opacity: Math.min(1, item.shadow.alpha),
        blur: pt(item.shadow.blur), offset: pt(Math.hypot(item.shadow.x, item.shadow.y)),
        angle: Math.round(((Math.atan2(item.shadow.y, item.shadow.x) * 180 / Math.PI) + 360) % 360),
      } : undefined,
    })
  }
}

/** One PPTX text box from an extracted block, in inches on the 13.333×7.5 slide. */
function addTextBlock(slide, block, sx, sy, faces) {
  const px = 0.75 // CSS px → pt
  // Lines break where the browser broke them, so a box never wraps on its own: it gets room to
  // grow so a wider substitute font does not wrap. Vertical text keeps its CSS container width.
  const single = block.lines <= 1 || block.explicitLines
  let x = single ? block.x : Math.min(block.x, block.contentX)
  let w = single ? block.w : Math.max(block.w, block.contentW)
  const slideW = SLIDE_W_IN / sx
  const slideH = SLIDE_H_IN / sy
  if (single) {
    // The room stays on the slide, so an edited box never hangs past the slide edge.
    const roomLeft = Math.max(0, x), roomRight = Math.max(0, slideW - x - w)
    const want = block.w * 0.25 + 8
    if (block.align === 'center') {
      const half = Math.min(want / 2, roomLeft, roomRight)
      x -= half
      w += half * 2
    } else if (block.align === 'right') {
      const grow = Math.min(want, roomLeft)
      x -= grow
      w += grow
    } else {
      w += Math.min(want, roomRight)
    }
  }
  const runs = block.runs.map((r) => {
    const face = officeFace(r.font, r.weight, r.italic)
    faces.push(face)
    return {
    text: r.text,
    options: {
      fontFace: face.typeface,
      fontSize: Math.round(r.size * px * 10) / 10,
      bold: face.bold,
      italic: face.italic,
      underline: r.underline ? { style: 'sng' } : undefined,
      strike: r.strike ? 'sngStrike' : undefined,
      color: r.color,
      transparency: Math.round((1 - Math.min(1, r.alpha)) * 100),
      charSpacing: r.letterSpacing ? Math.round(r.letterSpacing * px * 100) / 100 : undefined,
      breakLine: r.breakLine,
    },
  }
  })
  // Chrome reports each line's font box (ascent + descent), and puts the baseline
  // about 81% of the way down it for Arial/Helvetica-class fonts. PowerPoint and
  // Keynote put the first baseline of an exact-spaced paragraph about 80% of the
  // line spacing below the box top, so the box moves by the difference.
  const shift = block.contentHeight * 0.81 - block.lineHeight * 0.8
  if (block.turned) {
    const { rotation, cx, cy, cw, ch } = block.turned
    const tw = cw * 1.04 + 4
    slide.addText(runs, {
      x: (cx - tw / 2) * sx, y: (cy - ch / 2 + shift) * sy, w: tw * sx, h: (ch + block.lineHeight * 0.3) * sy,
      rotate: Math.round(rotation * 10) / 10,
      margin: 0, valign: 'top', align: block.align, wrap: true, fit: 'none',
      lineSpacing: Math.round(block.lineHeight * px * 10) / 10, paraSpaceBefore: 0, paraSpaceAfter: 0,
    })
    return
  }
  slide.addText(runs, {
    x: x * sx, y: (block.y + shift) * sy, w: w * sx,
    // Text never clips in these boxes (no autofit, top anchor), so the box ends at the slide edge
    // even where a giant numeral's font box reaches below it.
    h: Math.max(Math.min(block.h, block.lineHeight), Math.min(block.h + block.lineHeight * 0.3, slideH - block.y - shift)) * sy,
    margin: 0,
    valign: 'top',
    align: block.align,
    wrap: !single,
    fit: 'none',
    lineSpacing: Math.round(block.lineHeight * px * 10) / 10,
    paraSpaceBefore: 0,
    paraSpaceAfter: 0,
  })
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const osascript = (script) => execFileSync('osascript', ['-e', script], { encoding: 'utf8', timeout: 180_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const keynoteRunning = () => {
  try {
    execFileSync('pgrep', ['-xq', 'Keynote'])
    return true
  } catch {
    // pgrep exits 1 when no process matches.
    return false
  }
}
/**
 * Whether the Mac's screen is locked. While it is, macOS hides every app's documents and windows from
 * scripts, so a conversion could open the file but never find it to save.
 */
const screenLocked = () => {
  try {
    return /"CGSSessionScreenIsLocked"\s*=\s*Yes/.test(execFileSync('ioreg', ['-n', 'Root', '-d1'], { encoding: 'utf8' }))
  } catch {
    // Without ioreg the lock state is unknown; the conversion then reports its own failure.
    return false
  }
}
const keynoteDocuments = () => {
  const names = osascript(`tell application id "com.apple.Keynote" to set names to name of every document
    set AppleScript's text item delimiters to linefeed
    return names as text`)
  return names ? names.split('\n') : []
}
/** Whether this export launched Keynote, so it quits Keynote again when it is done. */
let launchedKeynote = false

async function quitKeynote() {
  osascript('tell application id "com.apple.Keynote" to quit')
  for (let i = 0; i < 150 && keynoteRunning(); i++) await sleep(100)
}

/**
 * Keynote opens the PPTX and saves it as .key; returns false where Keynote is unavailable,
 * `{ locked: true }` while the screen is locked, and `{ refused }` where a workspace sandbox refuses installing the deck's fonts or sending Apple
 * Events to Keynote.
 *
 * Keynote draws only installed fonts and reads the font list once, when it opens its first
 * document, so the deck's fonts are installed first and a Keynote without open documents is
 * restarted to see fonts installed after it started. A Keynote with the person's documents open
 * is left running; the deck then shows substitutes for the new fonts until Keynote restarts.
 *
 * The PPTX reaches Keynote through Launch Services, as a double-click would: an Apple Event
 * `open` sent while a freshly launched Keynote shows its Open panel answers with a placeholder
 * that cannot be saved. Keynote opens a copy of the PPTX under a name of its own, new each run,
 * and the document is found by that name and saved and closed by script, so a document an earlier,
 * interrupted export left open, or one of the person's own, is never taken for it.
 */
async function toKeynote(pptxPath, keyPath, families) {
  if (process.platform !== 'darwin') return false
  const installed = execFileSync('mdfind', ['kMDItemCFBundleIdentifier == "com.apple.Keynote"'], { encoding: 'utf8' }).trim()
  if (!installed) return false
  let added
  try {
    added = await installFonts(families)
  } catch (error) {
    if (!(error instanceof FontInstallRefused)) throw error
    return { refused: error.message }
  }
  if (added.length) console.log(`installed for Keynote: ${added.join(', ')}`)
  if (added.length && keynoteRunning()) {
    try {
      if (keynoteDocuments().length === 0) await quitKeynote()
      else console.warn(`Keynote has documents open: ${added.join(', ')} show as substitutes until Keynote restarts`)
    } catch {
      // A locked screen hides the document list; Keynote keeps running and shows substitutes for the new fonts.
    }
  }
  if (!keynoteRunning()) launchedKeynote = true
  const name = `${basename(pptxPath, '.pptx')}-${randomBytes(4).toString('hex')}`
  const quote = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const refused = { refused: 'sending Apple Events to Keynote was refused' }
  rmSync(keyPath, { recursive: true, force: true })
  const staging = mkdtempSync(join(tmpdir(), 'aeven-deck-keynote-'))
  try {
    const staged = join(staging, `${name}.pptx`)
    copyFileSync(pptxPath, staged)
    try {
      osascript(`
        with timeout of 170 seconds
          tell application id "com.apple.Keynote"
            set d to open (POSIX file "${quote(staged)}")
            save d in (POSIX file "${quote(keyPath)}")
            close d saving no
          end tell
        end timeout`)
      return true
    } catch (error) {
      const detail = String(error.stderr ?? error.message).trim()
      if (/-10004|-1743/.test(detail)) return refused
      // A Keynote started while the screen is locked answers a scripted open with a placeholder it
      // cannot save, and hides its documents from scripts; the conversion waits for an unlocked Mac.
      if (screenLocked()) {
        if (launchedKeynote) {
          try {
            osascript('tell application id "com.apple.Keynote" to quit saving no')
          } catch {
            // Keynote refused to quit; it stays open with the copy this export opened.
          }
          launchedKeynote = false
        }
        return { locked: true }
      }
    }
    // Unlocked, a freshly started Keynote can still answer the scripted open with a placeholder while its
    // Open panel shows: the copy then reaches Keynote through Launch Services, as a double-click would,
    // and the document is found by its name.
    const count = () => {
      try {
        return keynoteDocuments().filter((n) => n === name).length
      } catch (error) {
        if (/-10004/.test(error.stderr ?? '')) return 'refused'
        return -1 // Keynote is still starting and refuses Apple Events until it is ready.
      }
    }
    execFileSync('open', ['-gb', 'com.apple.Keynote', staged])
    let opened = false
    for (let i = 0; i < 600 && !opened; i++) {
      const now = count()
      if (now === 'refused') return refused
      opened = now > 0
      if (!opened) await sleep(100)
    }
    if (!opened) throw new Error(`Keynote did not open ${pptxPath}`)
    osascript(`
      with timeout of 170 seconds
        tell application id "com.apple.Keynote"
          set d to last document whose name is "${quote(name)}"
          save d in (POSIX file "${quote(keyPath)}")
          close d saving no
        end tell
      end timeout`)
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
  return true
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

/**
 * Start one detached copy of this export that adds the Keynote file once the Mac is unlocked.
 * @param deckPath - the deck HTML to convert.
 */
function keynoteAfterUnlock(deckPath) {
  spawn(process.execPath, [process.argv[1], deckPath, outDir, 'key', '--after-unlock'], { detached: true, stdio: 'ignore' }).unref()
}

if (afterUnlock) {
  // Checked every 5 seconds for a day; a Mac still locked by then gets no Keynote file from this run.
  for (let i = 0; i < 17_280 && screenLocked(); i++) await sleep(5_000)
  if (screenLocked()) process.exit(0)
}

const browser = await puppeteer.launch({
  executablePath: await resolveChrome(),
  headless: true,
  // The exporter runs inside the agent's workspace sandbox, where Chrome's own sandbox cannot
  // initialise ("sandbox initialization failed"); the outer sandbox still confines the browser,
  // which only renders the local deck.
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--font-render-hinting=none'],
})
try {
  for (const deckPath of decks) {
    const name = basename(deckPath, '.html').replace(/^deck-/, '')
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: SCALE })
    await page.goto(pathToFileURL(deckPath).href, { waitUntil: 'networkidle0' })
    await page.evaluate(() => document.fonts.ready)
    // Static formats show every slide in its final state: animations and transitions jump to
    // their end, and videos stay on their poster.
    await page.addStyleTag({ content: '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;animation-iteration-count:1!important;transition-duration:0s!important;transition-delay:0s!important}' })
    await page.evaluate(() => { for (const v of document.querySelectorAll('video')) { v.pause(); v.currentTime = 0 } })
    const count = await page.$$eval('section.slide', (s) => s.length)
    if (count === 0) throw new Error(`${deckPath}: no section.slide elements`)
    const done = []

    const overflow = await page.evaluate(findOverflow)
    for (const finding of overflow) console.warn(`${name}: slide ${finding.slide}: ${finding.what}`)
    if (strict && overflow.length) throw new Error(`${name}: ${overflow.length} overflow finding(s)`)

    if (!afterUnlock) {
      // Small pictures of every slide, about 640 px wide, for looking at the deck before handing it over.
      const previewDir = mkdtempSync(join(previewRoot(), `aeven-deck-${name}-`))
      const slideHandles = await page.$$('section.slide')
      const previews = []
      for (const [i, handle] of slideHandles.entries()) {
        const file = join(previewDir, `slide-${i + 1}.png`)
        const box = await handle.boundingBox()
        await page.screenshot({ path: file, clip: { ...box, scale: 0.25 }, captureBeyondViewport: true })
        previews.push(file)
      }
      console.log(`previews: ${previews.join(' ')}`)
    }

    if (formats.has('pdf')) {
      const pdfPath = join(outDir, `${name}.pdf`)
      await page.pdf({ path: pdfPath, width: '1280px', height: '720px', printBackground: true, pageRanges: '' })
      done.push('pdf')
    }

    if (formats.has('cover')) {
      const first = await page.$('section.slide')
      await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 })
      await first.screenshot({ path: join(outDir, `cover-${name}.jpg`), type: 'jpeg', quality: 85 })
      await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: SCALE })
      done.push('cover')
    }

    if (formats.has('pptx')) {
      const extracted = await page.evaluate(extractAndHideText)
      const visuals = await page.evaluate(extractShapes)
      // Pictures only for what PowerPoint cannot draw. An `own` raster shows the element's own
      // background and pseudo-element art: its descendants are hidden for the capture and stay native.
      await page.addStyleTag({ content: '[data-avn-own] *{visibility:hidden!important}' })
      for (const slideVisuals of visuals) {
        for (const item of slideVisuals.items) {
          if (item.type !== 'raster') continue
          const handle = await page.$(`[data-avn-raster="${item.id}"]`)
          if (item.own) await handle.evaluate((el) => el.setAttribute('data-avn-own', ''))
          const type = item.w * item.h > 120_000 ? 'jpeg' : 'png'
          // An element screenshot clamps a box that starts off the page and captures a shifted
          // region, so the page is captured at the element's on-slide part instead.
          const shot = await page.screenshot({ clip: item.clip, captureBeyondViewport: true, type, quality: type === 'jpeg' ? 88 : undefined, encoding: 'base64' })
          if (item.own) await handle.evaluate((el) => el.removeAttribute('data-avn-own'))
          item.data = `data:image/${type};base64,${shot}`
        }
      }
      const pptx = new PptxGenJS()
      pptx.layout = 'LAYOUT_WIDE'
      pptx.title = name
      const faces = []
      for (let i = 0; i < extracted.length; i++) {
        const { width, height, texts } = extracted[i]
        const slide = pptx.addSlide()
        const sx = SLIDE_W_IN / width
        const sy = SLIDE_H_IN / height
        if (visuals[i].background) slide.background = { color: visuals[i].background.hex }
        for (const item of visuals[i].items) addVisual(pptx, slide, item, sx, sy)
        for (const block of texts) addTextBlock(slide, block, sx, sy, faces)
        if (extracted[i].notes) slide.addNotes(extracted[i].notes)
      }
      const pptxPath = join(outDir, `${name}.pptx`)
      const zip = await JSZip.loadAsync(await pptx.write({ outputType: 'nodebuffer' }))
      await fixSchema(zip)
      const { missing } = await embedFonts(zip, faces)
      if (missing.length) console.warn(`${name}: fonts not embedded (no TTF files): ${missing.join(', ')}`)
      writeFileSync(pptxPath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } }))
      done.push('pptx')

      if (formats.has('key')) {
        const families = extracted.flatMap((x) => x.texts.flatMap((t) => t.runs.map((r) => r.font)))
        const key = await toKeynote(pptxPath, join(outDir, `${name}.key`), families)
        const again = `node ${JSON.stringify(process.argv[1])} ${JSON.stringify(deckPath)} ${JSON.stringify(outDir)} key`
        if (key === true) done.push('key')
        else if (key?.locked && !afterUnlock) {
          keynoteAfterUnlock(deckPath)
          console.warn(`${name}: .key follows once the Mac is unlocked: Keynote cannot convert while the screen is locked, so a waiting copy of this export adds ${name}.key to ${outDir} after the unlock`)
        } else if (key?.locked) console.warn(`${name}: .key not made: the Mac locked again before Keynote could convert; run outside the sandbox: ${again}`)
        else if (key) console.warn(`${name}: .key skipped: ${key.refused}. Keynote conversion installs the deck's fonts and scripts Keynote, which a sandbox refuses; run this export again outside the sandbox for the Keynote file: node ${JSON.stringify(process.argv[1])} ${JSON.stringify(deckPath)} ${JSON.stringify(outDir)} key`)
        else console.warn(`${name}: Keynote file not made: Keynote runs only on a Mac with Keynote installed`)
      }
    }
    await page.close()
    console.log(`${name}: ${count} slides → ${done.join(', ')}`)
  }
} finally {
  await browser.close()
  if (launchedKeynote && keynoteRunning()) {
    try {
      if (keynoteDocuments().length === 0) await quitKeynote()
    } catch {
      // Apple Events refused (sandbox): Keynote stays open with what it opened.
    }
  }
}
