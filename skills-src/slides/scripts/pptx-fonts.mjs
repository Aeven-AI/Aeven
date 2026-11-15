/**
 * Office font faces for a deck's text, and the fonts embedded in its PPTX.
 *
 * Office names a font by its legacy family (name ID 1) and reaches only four styles of it with
 * the bold and italic flags: Regular, Bold, Italic, Bold Italic. Every other weight of a Google
 * Fonts family is a family of its own, named "<family> <weight name>" ("Inter Tight ExtraBold"),
 * which is the name ID 1 of that weight's static TTF. `officeFace` maps a CSS family and weight
 * to that name and flag, so PowerPoint draws the weight Chrome drew instead of the nearest of
 * 400 and 700.
 *
 * `embedFonts` writes those faces into the PPTX the way PowerPoint saves "Embed fonts": each face
 * an uncompressed Embedded OpenType (EOT 2.1) file at `ppt/fonts/fontN.fntdata`, listed in
 * `<p:embeddedFontLst>` of `ppt/presentation.xml`. PowerPoint for Windows and Mac then show the
 * deck in its own fonts on machines without them installed. Keynote ignores embedded fonts and
 * uses the installed ones (`installed-fonts.mjs`).
 */
import { readFileSync } from 'node:fs'
import { ttfFaces, ttfWeights } from './font-files.mjs'

const WEIGHT_NAMES = { 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 500: 'Medium', 600: 'SemiBold', 800: 'ExtraBold', 900: 'Black' }

/**
 * The Office face for a run.
 * @param {string} family - the CSS font family.
 * @param {number} weight - the CSS font weight.
 * @param {boolean} italic - whether the run is italic.
 * @returns {{ typeface: string, bold: boolean, italic: boolean, family: string, weight: number | null }}
 *   `weight` is the static TTF weight to embed, or null for a family without stored TTF styles
 *   (system fonts), which keeps the plain bold flag.
 */
export function officeFace(family, weight, italic) {
  const styles = ttfWeights(family)
  if (!styles) return { typeface: family, bold: weight >= 600, italic, family, weight: null }
  const style = italic ? 'italic' : 'normal'
  const pool = styles.filter((s) => s.style === style).map((s) => s.weight)
  const weights = pool.length ? pool : styles.map((s) => s.weight)
  const nearest = weights.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best), weights[0])
  const named = WEIGHT_NAMES[nearest]
  return {
    typeface: named ? `${family} ${named}` : family,
    bold: nearest === 700,
    italic: italic && pool.length > 0,
    family,
    weight: nearest,
  }
}

/** Reads the TTF tables an EOT header copies. */
function ttfInfo(ttf) {
  const tables = new Map()
  const count = ttf.readUInt16BE(4)
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16
    tables.set(ttf.toString('latin1', at, at + 4), ttf.readUInt32BE(at + 8))
  }
  const os2 = tables.get('OS/2'), head = tables.get('head'), name = tables.get('name')
  if (os2 == null || head == null || name == null) throw new Error('TTF without OS/2, head or name table')
  const names = {}
  const records = ttf.readUInt16BE(name + 2), strings = name + ttf.readUInt16BE(name + 4)
  for (let i = 0; i < records; i++) {
    const at = name + 6 + i * 12
    const [platform, encoding, language, id, length, offset] = [0, 2, 4, 6, 8, 10].map((o) => ttf.readUInt16BE(at + o))
    if (platform !== 3 || encoding !== 1 || language !== 0x409 || names[id] != null) continue
    // Windows names are UTF-16BE; EOT stores them UTF-16LE.
    names[id] = Buffer.from(ttf.subarray(strings + offset, strings + offset + length)).swap16()
  }
  return {
    panose: ttf.subarray(os2 + 32, os2 + 42),
    weight: ttf.readUInt16BE(os2 + 4),
    fsType: ttf.readUInt16BE(os2 + 8),
    italic: (ttf.readUInt16BE(os2 + 62) & 1) === 1,
    unicodeRange: [42, 46, 50, 54].map((o) => ttf.readUInt32BE(os2 + o)),
    codePageRange: [78, 82].map((o) => ttf.readUInt32BE(os2 + o)),
    checkSumAdjustment: ttf.readUInt32BE(head + 8),
    family: names[1] ?? Buffer.alloc(0),
    style: names[2] ?? Buffer.alloc(0),
    version: names[5] ?? Buffer.alloc(0),
    full: names[4] ?? Buffer.alloc(0),
  }
}

/** An uncompressed EOT 2.1 file around a TTF. */
export function ttfToEot(ttf) {
  const info = ttfInfo(ttf)
  const fixed = Buffer.alloc(82)
  fixed.writeUInt32LE(0x00020001, 8) // version 2.1
  fixed.writeUInt32LE(0, 12) // flags: no subsetting, compression or XOR
  info.panose.copy(fixed, 16)
  fixed.writeUInt8(1, 26) // DEFAULT_CHARSET
  fixed.writeUInt8(info.italic ? 1 : 0, 27)
  fixed.writeUInt32LE(info.weight, 28)
  fixed.writeUInt16LE(info.fsType, 32)
  fixed.writeUInt16LE(0x504c, 34) // magic number
  info.unicodeRange.forEach((v, i) => fixed.writeUInt32LE(v, 36 + i * 4))
  info.codePageRange.forEach((v, i) => fixed.writeUInt32LE(v, 52 + i * 4))
  fixed.writeUInt32LE(info.checkSumAdjustment, 60)
  // 64..79 reserved, 80..81 padding: zero.
  const field = (bytes, pad = true) => {
    const b = Buffer.alloc((pad ? 2 : 0) + 2 + bytes.length)
    b.writeUInt16LE(bytes.length, pad ? 2 : 0)
    bytes.copy(b, pad ? 4 : 2)
    return b
  }
  const names = Buffer.concat([
    field(info.family, false), field(info.style), field(info.version), field(info.full),
    Buffer.alloc(4), // padding and an empty RootString
  ])
  const total = fixed.length + names.length + ttf.length
  fixed.writeUInt32LE(total, 0)
  fixed.writeUInt32LE(ttf.length, 4)
  return Buffer.concat([fixed, names, ttf])
}

const SLOT = (bold, italic) => (bold ? (italic ? 'boldItalic' : 'bold') : italic ? 'italic' : 'regular')
const SLOT_ORDER = ['regular', 'bold', 'italic', 'boldItalic']

/**
 * Embeds the faces a deck uses into its PPTX package, in place.
 * @param {import('jszip')} zip - the opened PPTX package.
 * @param {ReturnType<typeof officeFace>[]} used - the Office face of every run.
 * @returns {Promise<{ embedded: string[], missing: string[] }>} the typefaces embedded, and the
 *   families whose files could not be found or fetched.
 */
export async function embedFonts(zip, used) {
  const byTypeface = new Map()
  for (const face of used) {
    if (face.weight == null) continue
    const slots = byTypeface.get(face.typeface) ?? new Map()
    slots.set(SLOT(face.bold, face.italic), face)
    byTypeface.set(face.typeface, slots)
  }
  if (!byTypeface.size) return { embedded: [], missing: [] }

  const files = new Map()
  const missing = new Set()
  for (const family of new Set([...byTypeface.values()].flatMap((s) => [...s.values()].map((f) => f.family)))) {
    try {
      files.set(family, await ttfFaces(family))
    } catch {
      // The family stays a font name only; PowerPoint substitutes it where it is not installed.
      missing.add(family)
    }
  }

  const relsPath = 'ppt/_rels/presentation.xml.rels'
  let rels = await zip.file(relsPath).async('string')
  let presentation = await zip.file('ppt/presentation.xml').async('string')
  let types = await zip.file('[Content_Types].xml').async('string')
  const entries = []
  const embedded = []
  let n = 0
  for (const [typeface, slots] of byTypeface) {
    const refs = []
    for (const slot of SLOT_ORDER) {
      const face = slots.get(slot)
      if (!face) continue
      const style = face.italic ? 'italic' : 'normal'
      const file = files.get(face.family)?.find((f) => f.weight === face.weight && f.style === style)
      if (!file) continue
      n++
      const id = `rIdAvnFont${n}`
      zip.file(`ppt/fonts/font${n}.fntdata`, ttfToEot(readFileSync(file.file)))
      rels = rels.replace('</Relationships>', `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="fonts/font${n}.fntdata"/></Relationships>`)
      refs.push(`<p:${slot} r:id="${id}"/>`)
    }
    if (!refs.length) continue
    const safe = typeface.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
    entries.push(`<p:embeddedFont><p:font typeface="${safe}" charset="0"/>${refs.join('')}</p:embeddedFont>`)
    embedded.push(typeface)
  }
  if (!entries.length) return { embedded, missing: [...missing] }

  if (!types.includes('Extension="fntdata"')) {
    types = types.replace(/<Types([^>]*)>/, '<Types$1><Default Extension="fntdata" ContentType="application/x-fontdata"/>')
  }
  // embeddedFontLst follows notesSz (and any smartTags) in the presentation element's sequence.
  presentation = presentation.replace(/(<p:notesSz[^>]*\/>(?:<p:smartTags[^>]*\/>)?)/, `$1<p:embeddedFontLst>${entries.join('')}</p:embeddedFontLst>`)
  presentation = presentation.replace(/<p:presentation\b/, '<p:presentation embedTrueTypeFonts="1"')
  zip.file(relsPath, rels)
  zip.file('ppt/presentation.xml', presentation)
  zip.file('[Content_Types].xml', types)
  return { embedded, missing: [...missing] }
}
