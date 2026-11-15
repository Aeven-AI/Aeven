/**
 * TTF files for Google Fonts families, for installing a CV's fonts and embedding them in DOCX.
 *
 * Decks embed WOFF2 web subsets; installed and Office fonts need whole TTF files, one per style.
 * `ttfFaces(family)` takes them from `fonts/<slug>/` when the templates repository stores them,
 * and otherwise downloads them from Google Fonts once into `~/.cache/aeven-cv/fonts/<slug>/`
 * (the temp folder where a sandbox refuses the home cache).
 * `ttfWeights(family)` reads the styles a family has from its stored manifest without touching
 * the network, so text can be mapped to real weights before any file is needed.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { css2, faces, slug } from './fonts.mjs'

const STORED = fileURLToPath(new URL('../fonts/', import.meta.url))
// A sandbox that refuses the home cache still lets the temp folder be written.
const CACHES = [join(homedir(), '.cache', 'aeven-cv', 'fonts'), join(tmpdir(), 'aeven-cv', 'fonts')]

const manifestOf = (family) => {
  const path = join(STORED, slug(family), 'manifest.json')
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
}

/**
 * The TTF styles a stored family has.
 * @param {string} family - Google Fonts family name.
 * @returns {{ weight: number, style: string }[] | null} null for a family that is not stored.
 */
export function ttfWeights(family) {
  return manifestOf(family)?.ttf.map((t) => ({ weight: Number(t.weight), style: t.style })) ?? null
}

/**
 * Every TTF style of a family as local files.
 * @param {string} family - Google Fonts family name.
 * @returns {Promise<{ weight: number, style: string, file: string }[]>}
 */
export async function ttfFaces(family) {
  const manifest = manifestOf(family)
  if (manifest?.ttf.length) {
    const stored = manifest.ttf.map((t) => ({ weight: Number(t.weight), style: t.style, file: join(STORED, slug(family), t.file) }))
    if (stored.every((t) => existsSync(t.file))) return stored
  }
  let dir
  for (const cache of CACHES) {
    try {
      mkdirSync(join(cache, slug(family)), { recursive: true })
      dir = join(cache, slug(family))
      break
    } catch (error) {
      if (error.code !== 'EPERM' && error.code !== 'EACCES') throw error
    }
  }
  if (!dir) throw new Error(`${family}: no writable font cache`)
  const out = []
  for (const face of faces(await css2(family))) {
    if (!face.url) continue
    const file = join(dir, `${face.weight}${face.style === 'italic' ? 'i' : ''}.ttf`)
    if (!existsSync(file)) {
      const res = await fetch(face.url)
      if (!res.ok) throw new Error(`${family}: ${res.status} for ${face.url}`)
      writeFileSync(file, Buffer.from(await res.arrayBuffer()))
    }
    out.push({ weight: face.weight, style: face.style, file })
  }
  if (!out.length) throw new Error(`Google Fonts has no TTF files for "${family}"`)
  return out
}
