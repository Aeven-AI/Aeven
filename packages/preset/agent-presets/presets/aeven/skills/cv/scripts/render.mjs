/**
 * Renders CVs to self-contained HTML: A4 portrait pages (`section.page`, 210×297 mm), the
 * system's fonts embedded, the photo embedded.
 *
 * Content and look are separate: a CV (see `cv.mjs`) says what it holds, and a design system
 * draws it. A system is a folder `systems/<NN-id>/` with:
 *   system.json  id, name, label, motif, type.fonts {text, display?} (Google Fonts) and `palette`,
 *                colours the layouts read as `--c-<name>` (camelCase names become kebab-case)
 *   layouts.mjs  `css(system)` returning the stylesheet, and `pages(cv, ctx)` returning
 *                `{ first, continuation }`: the opening pages with every block, and an empty page.
 *                A page has `[data-col] > .flow` columns (a cover has none); their children carrying
 *                `data-block` are what pagination moves, `data-keep` keeps a block with the next
 *                one; a column's flow takes its last block's `data-band` as `data-tail`
 *   source.json  where the look came from
 *
 * Pagination runs in the page once its fonts are ready: while a column overflows, its last
 * blocks move to the same column of the next page, cloned from `continuation` when needed. It
 * then sets `data-paginated` on <html>; anything that still overflows (a
 * single block taller than a page) is listed in `data-overflow`. The HTML also carries the CV,
 * its palette and fonts as JSON (`script#cv-data`).
 *
 * Usage:
 *   node render.mjs <cv.json | system-id | all> [out directory]
 *   node render.mjs --list        the renderable systems: id, label, motif
 * A cv.json renders to `<name>.html` beside it in the out directory (`cv.json` → `cv.html`);
 * a system id renders the sample CV to `cv-<system-id>.html`.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs'
import { basename, dirname, resolve, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fontFaceCss } from './fonts.mjs'
import { DEFAULT_LABELS, SAMPLES_DIR, sampleFor, timelineIcons, validateCv } from './cv.mjs'
import { icon } from './icons.mjs'

const root = new URL('..', import.meta.url)

/** Every system with a layouts.mjs, by id. */
export async function loadSystems() {
  const systems = new Map()
  for (const entry of readdirSync(new URL('systems/', root), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const dir = new URL(`systems/${entry.name}/`, root)
    if (!entry.isDirectory() || !existsSync(new URL('layouts.mjs', dir))) continue
    const system = JSON.parse(readFileSync(new URL('system.json', dir), 'utf8'))
    if (!system.type?.fonts?.text) throw new Error(`${entry.name}: type.fonts.text must name a Google Fonts family`)
    const layouts = await import(new URL('layouts.mjs', dir).href)
    if (typeof layouts.css !== 'function' || typeof layouts.pages !== 'function') throw new Error(`${entry.name}: layouts.mjs must export css(system) and pages(cv, ctx)`)
    systems.set(system.id, { ...system, folder: entry.name, layouts })
  }
  return systems
}

const esc = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const kebab = (name) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)

const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }

/** A local picture as a data URL so the HTML stays self-contained; URLs and data URLs pass through. */
function imageSrc(src, baseDir) {
  if (/^(https?:|data:)/.test(src)) return src
  const path = resolve(baseDir, src)
  const type = IMAGE_TYPES[extname(path).toLowerCase()]
  if (!type) throw new Error(`photo ${src}: use ${Object.keys(IMAGE_TYPES).join(', ')}`)
  return `data:${type};base64,${readFileSync(path).toString('base64')}`
}

/** Runs in the page: moves overflowing blocks onto following pages. */
function paginate() {
  const template = document.getElementById('cv-continuation')
  const overflows = (flow) => flow !== null && flow.scrollHeight > flow.clientHeight + 1
  const flowOf = (page, col) => page.querySelector(`[data-col="${col}"] > .flow`)
  for (const col of ['side', 'main']) {
    let page = [...document.querySelectorAll('section.page')].find((p) => flowOf(p, col))
    while (page) {
      const flow = flowOf(page, col)
      const moved = []
      while (overflows(flow) && flow.querySelectorAll(':scope > [data-block]').length > 1) {
        const blocks = flow.querySelectorAll(':scope > [data-block]')
        moved.unshift(blocks[blocks.length - 1])
        blocks[blocks.length - 1].remove()
      }
      // A heading never ends a column: it follows its first entry onto the next page.
      let last = flow.querySelector(':scope > [data-block]:last-child')
      while (moved.length && last?.hasAttribute('data-keep') && flow.querySelectorAll(':scope > [data-block]').length > 1) {
        moved.unshift(last)
        last.remove()
        last = flow.querySelector(':scope > [data-block]:last-child')
      }
      if (!moved.length) break
      let next = page.nextElementSibling
      if (!next?.matches('section.page')) {
        next = template.content.firstElementChild.cloneNode(true)
        page.after(next)
      }
      flowOf(next, col).prepend(...moved)
      page = next
    }
  }
  const pages = [...document.querySelectorAll('section.page')]
  // The space under a column's last block takes that block's band.
  for (const flow of document.querySelectorAll('[data-col] > .flow')) {
    const last = flow.querySelector(':scope > [data-block]:last-child')
    if (last?.dataset.band) flow.dataset.tail = last.dataset.band
  }
  const overflow = []
  pages.forEach((page, i) => {
    for (const col of ['side', 'main']) if (overflows(flowOf(page, col))) overflow.push(`page ${i + 1} ${col}`)
  })
  document.documentElement.dataset.pages = String(pages.length)
  if (overflow.length) document.documentElement.dataset.overflow = overflow.join(', ')
  document.documentElement.dataset.paginated = 'true'
}

const BASE_CSS = `
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #6b6b6b; -webkit-font-smoothing: antialiased; text-rendering: geometricPrecision; }
.page { position: relative; width: 210mm; height: 297mm; overflow: hidden; margin: 0 auto 24px; font-family: var(--font); }
h1, h2, h3 { font-family: var(--display-font); font-weight: inherit; text-wrap: balance; }
p { text-wrap: pretty; }
img { display: block; }
@page { size: 210mm 297mm; margin: 0; }
@media print {
  body { background: none; }
  .page { margin: 0; break-after: page; }
  .page:last-child { break-after: auto; }
}`

/**
 * The HTML for one CV in one system.
 * @param {object} cv - parsed cv.json.
 * @param {object} system - a system from {@link loadSystems}.
 * @param {string} baseDir - directory photo paths are relative to.
 * @returns {Promise<string>} the document.
 */
export async function renderCv(cv, system, baseDir) {
  validateCv(cv)
  const fonts = system.type.fonts
  const photo = cv.photo?.src ? imageSrc(cv.photo.src, baseDir) : undefined
  const backdrop = cv.backdrop?.src ? imageSrc(cv.backdrop.src, baseDir) : photo
  const labels = { ...DEFAULT_LABELS, ...(cv.labels ?? {}) }
  const { first, continuation } = system.layouts.pages(cv, { esc, photo, backdrop, icon, labels, timelineIcons })
  const fontCss = await fontFaceCss([fonts.text, fonts.display], { italic: fonts.italic ?? [] })
  const data = { cv: { ...cv, labels, photo: photo ? { ...cv.photo, src: photo } : undefined, backdrop: backdrop ? { src: backdrop } : undefined }, system: { id: system.id, palette: system.palette, fonts } }
  const vars = Object.entries(system.palette).map(([k, v]) => `--c-${kebab(k)}: ${v};`).join(' ')
  return `<!doctype html>
<html lang="${esc(cv.lang ?? 'en')}">
<head><meta charset="utf-8"><title>${esc(cv.name)}</title>
<style>${fontCss}
:root { --font: "${fonts.text}", Arial, sans-serif; --display-font: "${fonts.display ?? fonts.text}", Arial, sans-serif; ${vars} }
${BASE_CSS}
${system.layouts.css(system)}</style></head>
<body>
${first}
<template id="cv-continuation">${continuation}</template>
<script type="application/json" id="cv-data">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>
<script>${paginate.toString()}
document.fonts.ready.then(() => requestAnimationFrame(paginate))</script>
</body></html>
`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [, , requested = 'all', outDir = 'out'] = process.argv
  const systems = await loadSystems()
  if (requested === '--list') {
    for (const s of systems.values()) console.log(`${s.id}\t${s.label ?? s.name}\t${s.motif ?? ''}`)
    process.exit(0)
  }
  mkdirSync(outDir, { recursive: true })
  if (requested.endsWith('.json')) {
    const path = resolve(requested)
    const cv = JSON.parse(readFileSync(path, 'utf8'))
    const system = systems.get(cv.system)
    if (!system) throw new Error(`no system "${cv.system}" (renderable: ${[...systems.keys()].join(', ')})`)
    const name = basename(path, '.json')
    writeFileSync(`${outDir}/${name}.html`, await renderCv(cv, system, dirname(path)))
    console.log(`rendered ${name} in ${system.id} into ${outDir}`)
  } else {
    const targets = requested === 'all' ? [...systems.values()] : [systems.get(requested)]
    if (!targets[0]) throw new Error(`no system "${requested}" (renderable: ${[...systems.keys()].join(', ')})`)
    for (const system of targets) writeFileSync(`${outDir}/cv-${system.id}.html`, await renderCv(sampleFor(system), system, fileURLToPath(SAMPLES_DIR)))
    console.log(`rendered ${targets.length} sample CV(s) into ${outDir}`)
  }
}
