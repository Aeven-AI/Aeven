/**
 * Renders decks to HTML, one 1280×720 `section.slide` per slide.
 *
 * Content and look are separate: a deck (see `deck.mjs`) says what each slide holds, and a
 * design system draws it. A system is a folder `systems/<NN-id>/` with:
 *   system.json  id, name, label (the template's display name), type.fonts {text, display?, extra?: string[],
 *                italic?: string[] (families whose italics to embed)} (Google Fonts), tokens the layouts read
 *                and `palette` {paper, ink, muted, rule, accents: string[3+], onAccent} for charts and
 *                custom slides
 *   layouts.mjs  `css(system)` returning the system's stylesheet, and `slides`, an object with
 *                one function per kind in KINDS: `(data, ctx) => '<section class="slide …">…</section>'`.
 *                `chart` and `custom` may instead come from `slides.frame({title, eyebrow}, ctx, body)`:
 *                the system's titled slide with `body` placed in its content area
 *   source.json  where the look came from: {figmaUrl, title, author, license} or {original: true}
 * The renderer adds the shared rules (slide size, print pages, font faces, `--font` and
 * `--display-font`) and checks each slide's markup starts with `<section class="slide`.
 *
 * Usage:
 *   node render.mjs <deck.json | system-id | template-id | all> [out directory]
 *   node render.mjs --list        the renderable systems: id, label, motif
 * A deck.json names its system in `system` (a system id) and renders to `<name>.html` beside it in
 * the out directory (`deck.json` → `deck.html`); a template renders its sample deck in
 * `template.system`, else in the renderable systems in turn.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs'
import { basename, dirname, resolve, extname } from 'node:path'
import { fontFaceCss } from './fonts.mjs'
import { KINDS, sampleDeck, validateDeck } from './deck.mjs'
import { chartSvg } from './charts.mjs'

const [, , requested = 'all', outDir = 'out'] = process.argv
const root = new URL('..', import.meta.url)
/** The development template list (`spec/templates.json`); only template ids and `all` read it. */
const specTemplates = () => JSON.parse(readFileSync(new URL('spec/templates.json', root), 'utf8')).templates

const systems = new Map()
const parked = []
const broken = new Map()
for (const entry of readdirSync(new URL('systems/', root), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
  if (!entry.isDirectory()) continue
  const dir = new URL(`systems/${entry.name}/`, root)
  if (!existsSync(new URL('layouts.mjs', dir))) { parked.push(entry.name); continue }
  const system = JSON.parse(readFileSync(new URL('system.json', dir), 'utf8'))
  try {
    if (!system.type?.fonts?.text) throw new Error('type.fonts.text must name a Google Fonts family')
    const p = system.palette
    if (!p?.paper || !p.ink || !p.muted || !p.rule || !p.onAccent || !(p.accents?.length >= 3)) {
      throw new Error('system.json palette needs paper, ink, muted, rule, onAccent and 3+ accents')
    }
    const layouts = await import(new URL('layouts.mjs', dir).href)
    if (typeof layouts.css !== 'function') throw new Error('layouts.mjs must export css(system)')
    const framed = typeof layouts.slides?.frame === 'function'
    const missing = KINDS.filter((kind) => typeof layouts.slides?.[kind] !== 'function' && !(framed && (kind === 'chart' || kind === 'custom')))
    if (missing.length) throw new Error(`layouts.mjs has no layout for ${missing.join(', ')}${framed ? '' : ' (chart and custom can come from slides.frame)'}`)
    systems.set(system.id, { ...system, folder: entry.name, layouts })
  } catch (error) {
    broken.set(system.id, `${entry.name}: ${error.message}`)
  }
}
if (parked.length) console.warn(`not rendered (no layouts.mjs yet): ${parked.join(', ')}`)
for (const message of broken.values()) console.warn(`not renderable: ${message}`)

/** The system with this id, or a loud error naming why it cannot render. */
function systemOrThrow(id) {
  if (broken.has(id)) throw new Error(broken.get(id))
  const system = systems.get(id)
  if (!system) throw new Error(`no system "${id}" (renderable: ${[...systems.keys()].join(', ') || 'none'})`)
  return system
}
const renderable = [...systems.values()]

const esc = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const MEDIA_TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
}

/** A local file as a data URL so the deck HTML stays self-contained; URLs and data URLs pass through. */
function mediaSrc(src, baseDir) {
  if (/^(https?:|data:|#)/.test(src)) return src
  const path = resolve(baseDir, src)
  const type = MEDIA_TYPES[extname(path).toLowerCase()]
  if (!type) throw new Error(`media ${src}: use ${Object.keys(MEDIA_TYPES).join(', ')}`)
  return `data:${type};base64,${readFileSync(path).toString('base64')}`
}

/** A user image for an image slot; undefined means draw the placeholder. */
const imageSrc = (image, baseDir) => (image?.src ? mediaSrc(image.src, baseDir) : undefined)

/** A custom slide's HTML with every local src/poster file embedded. */
const embedMedia = (html, baseDir) => html.replace(/\b(src|poster)="([^"]+)"/g, (_, attr, src) => `${attr}="${mediaSrc(src, baseDir)}"`)

const BASE_CSS = `
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #6b6b6b; -webkit-font-smoothing: antialiased; text-rendering: geometricPrecision; }
.slide { position: relative; width: 1280px; height: 720px; overflow: hidden; margin: 0 auto 24px; font-family: var(--font); }
h1, h2, h3 { font-family: var(--display-font); text-wrap: balance; font-weight: inherit; }
p { text-wrap: pretty; }
img { display: block; }
.avn-body { position: relative; display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; min-width: 0; overflow: hidden; }
.avn-chart { flex: 1 1 auto; min-height: 0; }
.avn-chart svg { display: block; }
.avn-caption { flex: none; margin-top: 12px; font-size: 15px; color: var(--avn-muted); }
@page { size: 1280px 720px; margin: 0; }
@media print {
  body { background: #fff; }
  .slide { margin: 0; break-after: page; page-break-after: always; }
  .slide:last-child { break-after: auto; page-break-after: auto; }
}`

/** A system's layout for a kind: its own, or chart and custom drawn inside its frame. */
function layoutFor(system, kind) {
  const own = system.layouts.slides[kind]
  if (own) return own
  const frame = system.layouts.slides.frame
  if (kind === 'chart') {
    return (d, ctx) => frame({ title: d.title, eyebrow: d.eyebrow }, ctx,
      `<div class="avn-body"><div class="avn-chart">${ctx.chart(d.chart)}</div>${d.caption ? `<p class="avn-caption">${esc(d.caption)}</p>` : ''}</div>`)
  }
  return (d, ctx, baseDir) => frame({ title: d.title, eyebrow: d.eyebrow }, ctx, `<div class="avn-body">${embedMedia(d.html, baseDir)}</div>`)
}

/** The deck HTML for one deck in one system. */
async function renderDeck(deck, system, baseDir) {
  validateDeck(deck)
  const fonts = system.type.fonts
  const total = deck.slides.length
  const sections = deck.slides.map((slide, i) => {
    const ctx = { esc, index: i + 1, total, deck, system, image: (image) => imageSrc(image, baseDir), chart: (chart) => chartSvg(chart, system.palette) }
    const html = layoutFor(system, slide.kind)(slide, ctx, baseDir).trim()
    if (!html.startsWith('<section class="slide')) throw new Error(`${system.folder} ${slide.kind}: markup must start with <section class="slide`)
    const notes = slide.notes ? `<aside class="notes" hidden>${esc(slide.notes)}</aside>` : ''
    return html.replace(/<\/section>$/, `${notes}</section>`)
  })
  const fontCss = await fontFaceCss([fonts.text, fonts.display, ...(fonts.extra ?? [])], { italic: fonts.italic ?? [] })
  return `<!doctype html>
<html lang="${esc(deck.lang ?? 'en')}">
<head><meta charset="utf-8"><title>${esc(deck.title)}</title>
<style>${fontCss}
:root { --font: "${fonts.text}", Arial, sans-serif; --display-font: "${fonts.display ?? fonts.text}", Arial, sans-serif;
  --avn-paper: ${system.palette.paper}; --avn-ink: ${system.palette.ink}; --avn-muted: ${system.palette.muted};
  --avn-rule: ${system.palette.rule}; --avn-on-accent: ${system.palette.onAccent};
  ${system.palette.accents.map((c, i) => `--avn-accent-${i + 1}: ${c};`).join(' ')} }
${BASE_CSS}
${system.layouts.css(system)}</style></head>
<body>
${sections.join('\n')}
</body></html>
`
}

if (requested === '--list') {
  // The templates a deck can name: id, display name and one-line look, one per line.
  for (const system of systems.values()) console.log(`${system.id}\t${system.label ?? system.name}\t${system.motif ?? ''}`)
  process.exit(0)
}

mkdirSync(outDir, { recursive: true })
if (requested.endsWith('.json')) {
  const path = resolve(requested)
  const deck = JSON.parse(readFileSync(path, 'utf8'))
  const system = systemOrThrow(deck.system)
  const name = basename(path, '.json')
  writeFileSync(`${outDir}/${name}.html`, await renderDeck(deck, system, dirname(path)))
  console.log(`rendered ${name} in ${system.id} into ${outDir}`)
} else if (systems.has(requested) || broken.has(requested)) {
  // A system id renders its gallery deck: the template guidance, named after the system.
  const system = systemOrThrow(requested)
  writeFileSync(`${outDir}/deck-${requested}.html`, await renderDeck(sampleDeck(system.label ?? system.name), system, process.cwd()))
  console.log(`rendered ${requested} into ${outDir}`)
} else {
  if (systems.size === 0) throw new Error('no renderable system')
  const templates = specTemplates()
  const targets = requested === 'all' ? templates : templates.filter((t) => t.id === requested)
  if (targets.length === 0) throw new Error(`unknown template or system "${requested}"`)
  for (const template of targets) {
    const system = systems.get(template.system) ?? renderable[templates.indexOf(template) % renderable.length]
    writeFileSync(`${outDir}/deck-${template.id}.html`, await renderDeck(sampleDeck(template.name), system, process.cwd()))
  }
  console.log(`rendered ${targets.length} deck(s) into ${outDir}`)
}
