/**
 * Google Fonts for the design systems, stored in `fonts/` so builds need no network.
 *
 * A system names its families in `type.fonts` (`{ "text": "Inter", "display": "Space Grotesk" }`,
 * `display` optional). The first request for a family downloads it from Google Fonts into
 * `fonts/<slug>/`: WOFF2 files (Latin and Latin Extended subsets) that decks embed, and one
 * TTF per style for installing the font or embedding it in Office files. Later builds read
 * the stored files only.
 *
 * Library: `fontFaceCss(families)` returns @font-face rules with the WOFF2 files inlined as
 * data URLs, so a deck HTML renders the same anywhere without fetching anything.
 *
 * CLI: `node scripts/fonts.mjs "Inter" "Space Grotesk"` stores those families now.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const FONTS_DIR = new URL('../fonts/', import.meta.url)
const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900]
const SUBSETS = new Set(['latin', 'latin-ext'])
// Google Fonts answers a modern browser with WOFF2 split by subset, and a client
// without a browser User-Agent with one TTF per style.
const WOFF2_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

export const slug = (family) => family.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/** The stylesheet for one family, asking only for weights the family has. */
export async function css2(family, agent) {
  const base = 'https://fonts.googleapis.com/css2?display=swap&family='
  const name = family.replace(/ /g, '+')
  const all = await fetch(`${base}${name}:ital,wght@${[0, 1].flatMap((i) => WEIGHTS.map((w) => `${i},${w}`)).join(';')}`, { headers: agent ? { 'User-Agent': agent } : {} })
  if (all.ok) return all.text()
  // A family missing any requested style answers 400; ask style by style instead.
  const parts = []
  for (const italic of [0, 1]) {
    for (const weight of WEIGHTS) {
      const one = await fetch(`${base}${name}:ital,wght@${italic},${weight}`, { headers: agent ? { 'User-Agent': agent } : {} })
      if (one.ok) parts.push(await one.text())
    }
  }
  if (!parts.length) throw new Error(`Google Fonts has no family "${family}"`)
  return parts.join('\n')
}

/** Parses @font-face blocks: style, weight, subset comment, and source URL. */
export function faces(css) {
  const out = []
  const re = /(?:\/\*\s*([\w-]+)\s*\*\/\s*)?@font-face\s*{([^}]*)}/g
  for (const [, subset, body] of css.matchAll(re)) {
    const prop = (key) => body.match(new RegExp(`${key}:\\s*([^;]+);`))?.[1].trim()
    out.push({
      subset: subset ?? 'all',
      style: prop('font-style') ?? 'normal',
      weight: Number(prop('font-weight') ?? 400),
      url: body.match(/url\(([^)]+)\)/)?.[1],
      range: prop('unicode-range'),
    })
  }
  return out
}

/** Stores a family under fonts/<slug>/ unless it is already there; returns its manifest. */
export async function ensureFamily(family) {
  const dir = new URL(`${slug(family)}/`, FONTS_DIR)
  const manifestUrl = new URL('manifest.json', dir)
  if (existsSync(manifestUrl)) return JSON.parse(readFileSync(manifestUrl, 'utf8'))
  mkdirSync(dir, { recursive: true })
  const download = async (url, file) => {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`${family}: ${res.status} for ${url}`)
    writeFileSync(new URL(file, dir), Buffer.from(await res.arrayBuffer()))
    return file
  }
  // A variable family answers every weight with the same file; keep it once with
  // the weight range it covers.
  const byUrl = new Map()
  for (const face of faces(await css2(family, WOFF2_AGENT))) {
    if (!SUBSETS.has(face.subset) || !face.url) continue
    const seen = byUrl.get(face.url)
    if (seen) { seen.weights.push(face.weight); continue }
    byUrl.set(face.url, { ...face, weights: [face.weight] })
  }
  const web = []
  for (const face of byUrl.values()) {
    const min = Math.min(...face.weights)
    const max = Math.max(...face.weights)
    const weight = min === max ? `${min}` : `${min} ${max}`
    const file = `${weight.replace(' ', '-')}${face.style === 'italic' ? 'i' : ''}-${face.subset}.woff2`
    web.push({ style: face.style, weight, subset: face.subset, range: face.range, file: await download(face.url, file) })
  }
  const ttf = []
  for (const face of faces(await css2(family))) {
    if (!face.url) continue
    const file = `${face.weight}${face.style === 'italic' ? 'i' : ''}.ttf`
    ttf.push({ style: face.style, weight: face.weight, file: await download(face.url, file) })
  }
  const manifest = { family, source: 'https://fonts.google.com/specimen/' + family.replace(/ /g, '+'), web, ttf }
  writeFileSync(manifestUrl, JSON.stringify(manifest, null, 2) + '\n')
  return manifest
}

/**
 * @font-face rules for the given families with their WOFF2 files inlined.
 * @param {string[]} families - Google Fonts family names.
 * @param {{ italic?: boolean | string[] }} [options] - italic styles to embed too: `true` for every
 *   family, or the families that need them.
 * @returns {Promise<string>} CSS text.
 */
export async function fontFaceCss(families, { italic = false } = {}) {
  const rules = []
  for (const family of [...new Set(families.filter(Boolean))]) {
    const manifest = await ensureFamily(family)
    const dir = new URL(`${slug(family)}/`, FONTS_DIR)
    for (const face of manifest.web) {
      if (face.style === 'italic' && !(italic === true || (Array.isArray(italic) && italic.includes(family)))) continue
      const data = readFileSync(new URL(face.file, dir)).toString('base64')
      rules.push(`@font-face{font-family:"${family}";font-style:${face.style};font-weight:${face.weight};font-display:block;src:url(data:font/woff2;base64,${data}) format("woff2");${face.range ? `unicode-range:${face.range};` : ''}}`)
    }
  }
  return rules.join('\n')
}

/** Families already stored under fonts/. */
export function storedFamilies() {
  if (!existsSync(FONTS_DIR)) return []
  return readdirSync(FONTS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(new URL(`${e.name}/manifest.json`, FONTS_DIR)))
    .map((e) => JSON.parse(readFileSync(new URL(`${e.name}/manifest.json`, FONTS_DIR), 'utf8')).family)
}

// Bundled into the exporter, import.meta.url names the bundle, which is then the entry script too.
if (import.meta.url.endsWith('/fonts.mjs') && process.argv[1] === fileURLToPath(import.meta.url)) {
  const families = process.argv.slice(2)
  if (!families.length) {
    console.log(storedFamilies().join('\n') || 'no families stored yet')
  } else {
    for (const family of families) {
      const m = await ensureFamily(family)
      console.log(`${family}: ${m.web.length} web files, ${m.ttf.length} TTF styles`)
    }
  }
}
