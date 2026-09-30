/**
 * Pages and Keynote text reader for the iWork 2013+ package format: a zip of
 * `Index/*.iwa` object streams (Snappy-compressed protobuf archives), read
 * without Apple software or LibreOffice. Paragraph text lives in
 * `TSWP.StorageArchive` objects and table cell strings in `TST.TableDataList`
 * objects; Keynote slide order comes from the show's slide tree. Files from
 * iWork '09 carry an XML index instead, and every format falls back to the
 * package's QuickLook PDF when present.
 * @module @aeven/document-extract-js/iwork
 */

import { gunzipSync } from 'node:zlib'
import type JSZip from 'jszip'

/** iWork object type ids (TSPRegistry) this reader interprets. */
const KEYNOTE_SHOW = 2
const TEXT_STORAGES = new Set([2001, 2005])
const TABLE_DATA_LIST = 6005
/** `TST.TableInfoArchive` and `TST.TableModelArchive`, the hops from a drawable to its data lists. */
const TABLE_ARCHIVES = new Set([6000, 6001])
/** `TST.TableDataList.ListType.STRING`. */
const STRING_LIST = 1

/** iWork document kinds by file extension. */
export type IworkKind = 'pages' | 'key' | 'numbers'

const IWORK_APPS: Record<IworkKind, string> = { pages: 'Pages', key: 'Keynote', numbers: 'Numbers' }

/** One archived object of an `.iwa` stream. */
interface IwaObject {
  readonly type: number
  readonly payload: Uint8Array
  /** Zip path of the stream holding the object. */
  readonly file: string
}

/** One protobuf field: varints decode to bigint, length-delimited fields keep their bytes. */
type Field =
  | { readonly field: number; readonly wire: 0; readonly value: bigint }
  | { readonly field: number; readonly wire: 2; readonly bytes: Uint8Array }

/**
 * Decode one raw Snappy block (no framing): a varint length preamble, then
 * literal and back-reference elements.
 * @param src - compressed block.
 * @returns the decompressed bytes.
 */
export function snappyDecompress(src: Uint8Array): Uint8Array {
  let pos = 0
  let length = 0
  for (let shift = 0; ; shift += 7) {
    const byte = byteAt(src, pos++)
    length += (byte & 0x7f) * 2 ** shift
    if (byte < 0x80) break
  }
  const out = new Uint8Array(length)
  let o = 0
  while (pos < src.length) {
    const tag = byteAt(src, pos++)
    const kind = tag & 3
    if (kind === 0) {
      let n = tag >> 2
      if (n >= 60) {
        const bytes = n - 59
        n = 0
        for (let i = 0; i < bytes; i++) n += byteAt(src, pos++) * 2 ** (8 * i)
      }
      n += 1
      if (pos + n > src.length || o + n > out.length) throw new Error('snappy literal overruns its block')
      out.set(src.subarray(pos, pos + n), o)
      pos += n
      o += n
      continue
    }
    let n: number
    let offset: number
    if (kind === 1) {
      n = ((tag >> 2) & 7) + 4
      offset = ((tag >> 5) << 8) | byteAt(src, pos++)
    } else if (kind === 2) {
      n = (tag >> 2) + 1
      offset = byteAt(src, pos) | (byteAt(src, pos + 1) << 8)
      pos += 2
    } else {
      n = (tag >> 2) + 1
      offset = (byteAt(src, pos) | (byteAt(src, pos + 1) << 8) | (byteAt(src, pos + 2) << 16) | (byteAt(src, pos + 3) << 24)) >>> 0
      pos += 4
    }
    if (offset === 0 || offset > o || o + n > out.length) throw new Error('snappy copy is out of range')
    for (let i = 0; i < n; i++, o++) out[o] = out[o - offset] as number
  }
  if (o !== out.length) throw new Error('snappy block is shorter than its declared length')
  return out
}

function byteAt(bytes: Uint8Array, index: number): number {
  const byte = bytes[index]
  if (byte === undefined) throw new Error('truncated iWork data')
  return byte
}

/**
 * Concatenate the decompressed chunks of one `.iwa` stream. Each chunk is a
 * zero byte, a 24-bit little-endian length, and one Snappy block.
 * @param data - stream bytes.
 * @returns the archive stream.
 */
function readIwa(data: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = []
  let pos = 0
  while (pos < data.length) {
    if (byteAt(data, pos) !== 0) throw new Error('not an iWork archive stream')
    const length = byteAt(data, pos + 1) | (byteAt(data, pos + 2) << 8) | (byteAt(data, pos + 3) << 16)
    chunks.push(snappyDecompress(data.subarray(pos + 4, pos + 4 + length)))
    pos += 4 + length
  }
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
  let o = 0
  for (const chunk of chunks) {
    out.set(chunk, o)
    o += chunk.length
  }
  return out
}

/**
 * Walk the top-level fields of one protobuf message; fixed-width fields are skipped.
 * @param buf - message bytes.
 * @returns varint and length-delimited fields in wire order.
 */
function fields(buf: Uint8Array): Field[] {
  const out: Field[] = []
  let pos = 0
  const varint = (): bigint => {
    let value = 0n
    for (let shift = 0n; ; shift += 7n) {
      const byte = byteAt(buf, pos++)
      value |= BigInt(byte & 0x7f) << shift
      if (byte < 0x80) return value
    }
  }
  while (pos < buf.length) {
    const key = Number(varint())
    const field = key >>> 3
    const wire = key & 7
    if (wire === 0) out.push({ field, wire, value: varint() })
    else if (wire === 2) {
      const length = Number(varint())
      if (pos + length > buf.length) throw new Error('truncated iWork message')
      out.push({ field, wire, bytes: buf.subarray(pos, pos + length) })
      pos += length
    } else if (wire === 1) pos += 8
    else if (wire === 5) pos += 4
    else throw new Error(`unsupported protobuf wire type ${wire}`)
  }
  return out
}

function varintField(buf: Uint8Array, field: number): bigint | undefined {
  for (const f of fields(buf)) if (f.field === field && f.wire === 0) return f.value
  return undefined
}

function bytesFields(buf: Uint8Array, field: number): Uint8Array[] {
  const out: Uint8Array[] = []
  for (const f of fields(buf)) if (f.field === field && f.wire === 2) out.push(f.bytes)
  return out
}

/** Object ids of the `TSP.Reference` messages in one repeated field. */
function references(buf: Uint8Array, field: number): bigint[] {
  return bytesFields(buf, field).flatMap((ref) => {
    const id = varintField(ref, 1)
    return id === undefined ? [] : [id]
  })
}

/**
 * Split one archive stream into objects. The stream repeats a varint-prefixed
 * `ArchiveInfo` (object id plus one `MessageInfo` per message) followed by
 * the message payloads it declares.
 */
function readObjects(stream: Uint8Array, file: string, into: Map<bigint, IwaObject>): void {
  let pos = 0
  while (pos < stream.length) {
    let length = 0
    for (let shift = 0; ; shift += 7) {
      const byte = byteAt(stream, pos++)
      length += (byte & 0x7f) * 2 ** shift
      if (byte < 0x80) break
    }
    const info = stream.subarray(pos, pos + length)
    pos += length
    const id = varintField(info, 1) ?? 0n
    for (const message of bytesFields(info, 2)) {
      const type = Number(varintField(message, 1) ?? 0n)
      const size = Number(varintField(message, 3) ?? 0n)
      // The first message of an object carries its content; later ones are diffs.
      if (!into.has(id)) into.set(id, { type, payload: stream.subarray(pos, pos + size), file })
      pos += size
    }
  }
}

/** Drop object-replacement and control characters; map line separators to newlines. */
function cleanText(text: string): string {
  return text
    .replace(/\u2028|\u2029/g, '\n')
    // iWork marks attachments, breaks, and fields with control characters.
    .replace(/[\uFFFC\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const decoder = new TextDecoder()

/** Paragraph text of one `TSWP.StorageArchive`. */
function storageText(object: IwaObject): string {
  return cleanText(bytesFields(object.payload, 3).map(bytes => decoder.decode(bytes)).join(''))
}

/** Cell strings of one `TST.TableDataList`, `|`-joined; empty for non-string lists. */
function tableText(object: IwaObject): string {
  if (varintField(object.payload, 1) !== BigInt(STRING_LIST)) return ''
  return bytesFields(object.payload, 3)
    .flatMap(entry => bytesFields(entry, 3).map(bytes => cleanText(decoder.decode(bytes))))
    .filter(cell => cell !== '')
    .join(' | ')
}

/**
 * Object ids referenced anywhere inside one message: every nested submessage
 * that consists of a single varint field 1 has the `TSP.Reference` layout.
 * Bytes that do not parse as a message (strings, packed data) are skipped.
 */
function nestedReferences(buf: Uint8Array, depth = 0): bigint[] {
  let parsed: Field[]
  try {
    parsed = fields(buf)
  } catch {
    // Opaque bytes such as strings or packed numbers are not submessages.
    return []
  }
  const only = parsed[0]
  if (depth > 0 && parsed.length === 1 && only?.field === 1 && only.wire === 0) return [only.value]
  if (depth >= 6) return []
  return parsed.flatMap(f => f.wire === 2 ? nestedReferences(f.bytes, depth + 1) : [])
}

/**
 * Table string lists reachable from some objects: a drawable references its
 * `TST.TableInfoArchive`, which references the table model, which references
 * its data lists. The walk follows at most three references from the start.
 */
function reachableTables(start: readonly IwaObject[], objects: ReadonlyMap<bigint, IwaObject>): IwaObject[] {
  const found: IwaObject[] = []
  const seen = new Set<bigint>()
  let frontier = start.flatMap(object => nestedReferences(object.payload))
  for (let hop = 0; hop < 3 && frontier.length > 0; hop++) {
    const next: bigint[] = []
    for (const id of frontier) {
      const object = objects.get(id)
      if (object === undefined || seen.has(id)) continue
      seen.add(id)
      if (object.type === TABLE_DATA_LIST) found.push(object)
      else if (TABLE_ARCHIVES.has(object.type)) next.push(...nestedReferences(object.payload))
    }
    frontier = next
  }
  return found
}

/** Storage text of some objects in stream order, then the text of the tables they reach. */
function sectionText(scope: readonly IwaObject[], objects: ReadonlyMap<bigint, IwaObject>, claimed: Set<IwaObject>): string {
  const blocks = scope.filter(object => TEXT_STORAGES.has(object.type)).map(storageText)
  for (const table of reachableTables(scope, objects)) {
    if (claimed.has(table)) continue
    claimed.add(table)
    blocks.push(tableText(table))
  }
  return blocks.filter(block => block !== '').join('\n\n')
}

/** Zip path of the `.iwa` stream for a Keynote template or master slide. */
function isTemplateStream(path: string): boolean {
  return /(^|\/)(MasterSlide|TemplateSlide)[^/]*\.iwa$/.test(path)
}

/**
 * Keynote slide streams in presentation order: the show's slide tree lists
 * top-level slide nodes (older files keep one root node instead), and each
 * node precedes its nested child nodes.
 */
function slideOrder(objects: ReadonlyMap<bigint, IwaObject>): string[] {
  const show = [...objects.values()].find(object => object.type === KEYNOTE_SHOW)
  const tree = show === undefined ? undefined : bytesFields(show.payload, 3)[0]
  if (tree === undefined) return []
  const files: string[] = []
  const seen = new Set<bigint>()
  const visit = (id: bigint): void => {
    const node = objects.get(id)
    if (node === undefined || seen.has(id)) return
    seen.add(id)
    const slide = references(node.payload, 2)[0]
    const file = slide === undefined ? undefined : objects.get(slide)?.file
    if (file !== undefined && !files.includes(file)) files.push(file)
    for (const child of references(node.payload, 1)) visit(child)
  }
  const top = references(tree, 2)
  for (const id of top.length > 0 ? top : references(tree, 1)) visit(id)
  return files
}

/** Numeric suffix of a component stream name, used when a deck has no readable slide tree. */
function streamNumber(path: string): number {
  return Number(/-(\d+)\.iwa$/.exec(path)?.[1] ?? 0)
}

/** Readers of a package's `.iwa` streams by zip path, `Index/` included. */
type IwaStreams = ReadonlyMap<string, () => Promise<Uint8Array>>

/**
 * Collect the `.iwa` streams of one package. Packages from some iWork
 * versions nest their streams in `Index.zip` instead of an `Index/` folder.
 */
async function iwaStreams(zip: JSZip, loadZip: (data: Uint8Array) => Promise<JSZip>): Promise<IwaStreams> {
  const streams = new Map<string, () => Promise<Uint8Array>>()
  const collect = (source: JSZip, prefix: string): void => {
    source.forEach((path, entry) => {
      const full = `${prefix}${path}`
      if (/^Index\/.+\.iwa$/.test(full)) streams.set(full, () => entry.async('uint8array'))
    })
  }
  collect(zip, '')
  const nested = zip.file('Index.zip')
  if (nested !== null) {
    const inner = await loadZip(await nested.async('uint8array'))
    collect(inner, inner.file(/^Index\//).length > 0 ? '' : 'Index/')
  }
  return streams
}

async function readIwaPackage(streams: IwaStreams, kind: IworkKind): Promise<{ text: string; pages?: number } | undefined> {
  const paths = [...streams.keys()].sort()
  if (paths.length === 0) return undefined
  const objects = new Map<bigint, IwaObject>()
  for (const path of paths) {
    const read = streams.get(path)
    if (read !== undefined) readObjects(readIwa(await read()), path, objects)
  }
  const byFile = new Map<string, IwaObject[]>()
  for (const object of objects.values()) {
    const list = byFile.get(object.file) ?? []
    list.push(object)
    byFile.set(object.file, list)
  }
  const claimed = new Set<IwaObject>()
  const leftoverTables = (): string => [...objects.values()]
    .filter(object => object.type === TABLE_DATA_LIST && !claimed.has(object))
    .map(tableText)
    .filter(text => text !== '')
    .join('\n\n')
  if (kind !== 'key') {
    const body = paths
      .filter(path => !isTemplateStream(path) && !path.startsWith('Index/Tables/'))
      .sort((x, y) => Number(y === 'Index/Document.iwa') - Number(x === 'Index/Document.iwa'))
      .map(path => sectionText(byFile.get(path) ?? [], objects, claimed))
    return { text: [...body, leftoverTables()].filter(text => text !== '').join('\n\n') }
  }
  let slides = slideOrder(objects)
  if (slides.length === 0) {
    slides = paths.filter(path => /^Index\/Slide[^/]*\.iwa$/.test(path)).sort((x, y) => streamNumber(x) - streamNumber(y))
  }
  const sections = slides
    .filter(path => !isTemplateStream(path))
    .map((path, index) => `--- Slide ${index + 1} ---\n${sectionText(byFile.get(path) ?? [], objects, claimed)}`.trim())
  const rest = leftoverTables()
  return { text: [...sections, ...rest === '' ? [] : [`--- Tables ---\n${rest}`]].join('\n\n'), pages: sections.length }
}

/** iWork '09 index: gzip-compressed or plain XML whose `sf:p` elements are paragraphs. */
async function readXmlIndex(zip: JSZip, decodeXml: (text: string) => string): Promise<string | undefined> {
  for (const name of ['index.xml.gz', 'index.apxl.gz', 'index.xml', 'index.apxl']) {
    const entry = zip.file(name)
    if (entry === null) continue
    const raw = await entry.async('uint8array')
    const xml = decoder.decode(name.endsWith('.gz') ? gunzipSync(raw) : raw)
    const body = xml.replace(/<sf:(?:stylesheet|styles|anon-styles|metadata)\b[\s\S]*?<\/sf:(?:stylesheet|styles|anon-styles|metadata)>/g, '')
    const text = body
      .replace(/<\/sf:p>|<sf:br\s*\/>|<sf:lnbr\s*\/>/g, '\n')
      .replace(/<sf:tab\s*\/>/g, '\t')
      .replace(/<[^>]+>/g, '')
    return cleanText(decodeXml(text))
  }
  return undefined
}

/**
 * Read one Pages or Keynote document.
 * @param data - document bytes (the single-file zip package).
 * @param kind - `pages` for word processing, `key` for presentations.
 * @param helpers - the worker's zip loader, XML entity decoder, and PDF reader.
 * @returns the document text; Keynote text is sectioned per slide with the slide count as pages.
 */
export async function extractIwork(
  data: Uint8Array,
  kind: IworkKind,
  helpers: {
    readonly loadZip: (data: Uint8Array) => Promise<JSZip>
    readonly decodeXml: (text: string) => string
    readonly readPdf: (data: Uint8Array) => Promise<{ text: string; pages?: number }>
  },
): Promise<{ text: string; pages?: number }> {
  const zip = await helpers.loadZip(data)
  // Password-protected packages mark themselves with these entries and encrypt their streams.
  if (zip.file('.iwpv2') !== null || zip.file('.iwph') !== null) {
    throw new Error(`the ${IWORK_APPS[kind]} document is password-protected; remove the password in ${IWORK_APPS[kind]} and attach it again`)
  }
  const modern = await readIwaPackage(await iwaStreams(zip, helpers.loadZip), kind)
  if (modern !== undefined && modern.text.replace(/--- Slide \d+ ---/g, '').trim() !== '') return modern
  const legacy = await readXmlIndex(zip, helpers.decodeXml)
  if (legacy !== undefined && legacy !== '') return { text: legacy }
  const preview = zip.file('QuickLook/Preview.pdf')
  if (preview !== null) return helpers.readPdf(await preview.async('uint8array'))
  if (modern !== undefined) return modern
  throw new Error(`not a readable ${IWORK_APPS[kind]} document`)
}
