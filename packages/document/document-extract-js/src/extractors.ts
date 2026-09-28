/**
 * Format readers executed inside the extraction worker thread.
 * @module @aeven/document-extract-js/extractors
 */

import type { ExtractedDocument } from '@aeven/document-extract'
import { STRUCTURED_EXTENSIONS, TEXT_EXTENSIONS } from './formats.ts'

const TEXT = new Set(TEXT_EXTENSIONS)
const STRUCTURED = new Set(STRUCTURED_EXTENSIONS)

/**
 * Read one document with the reader its extension selects.
 * @param data - document bytes.
 * @param extension - lowercase extension without the dot.
 * @returns extracted text and page count when the format has pages.
 */
export async function extractDocument(data: Uint8Array, extension: string): Promise<ExtractedDocument> {
  if (!STRUCTURED.has(extension)) {
    if (TEXT.has(extension)) return { text: decodeText(data), method: 'native' }
    throw new Error(`unsupported extension: ${extension}`)
  }
  switch (extension) {
    case 'pdf':
      return extractPdf(data)
    case 'docx':
    case 'docm':
    case 'dotx':
      return extractDocx(data)
    case 'xlsx':
    case 'xlsm':
    case 'xlsb':
    case 'xls':
    case 'ods':
    case 'numbers':
      return extractSpreadsheet(data)
    case 'pptx':
    case 'pptm':
    case 'potx':
      return extractPptx(data)
    case 'odp':
    case 'otp':
    case 'odt':
    case 'ott':
      return extractOpenDocument(data)
    case 'rtf':
      return { text: rtfToText(decodeLatin1(data)), method: 'native' }
    case 'epub':
      return extractEpub(data)
    case 'html':
    case 'htm':
    case 'xhtml':
      return { text: htmlToText(decodeText(data)), method: 'native' }
    default:
      throw new Error(`unsupported extension: ${extension}`)
  }
}

/** Decode UTF-8 or BOM-marked UTF-16 text and normalize line endings. */
function decodeText(data: Uint8Array): string {
  let encoding = 'utf-8'
  if (data[0] === 0xff && data[1] === 0xfe) encoding = 'utf-16le'
  else if (data[0] === 0xfe && data[1] === 0xff) encoding = 'utf-16be'
  return new TextDecoder(encoding).decode(data).replace(/\r\n?/g, '\n')
}

function decodeLatin1(data: Uint8Array): string {
  return new TextDecoder('latin1').decode(data)
}

async function extractPdf(data: Uint8Array): Promise<ExtractedDocument> {
  const { extractText, getDocumentProxy } = await import('unpdf')
  // The worker is terminated after this reply, which releases the document.
  const pdf = await getDocumentProxy(data)
  const { totalPages, text } = await extractText(pdf, { mergePages: false })
  const pages = text.map((page, index) => `--- Page ${index + 1} ---\n${page.trim()}`)
  const hasText = text.some(page => page.trim() !== '')
  return { text: hasText ? pages.join('\n\n') : '', method: 'native', pages: totalPages }
}

async function extractDocx(data: Uint8Array): Promise<ExtractedDocument> {
  const { default: mammoth } = await import('mammoth')
  const result = await mammoth.extractRawText({ buffer: Buffer.from(data) })
  return { text: result.value.replace(/\n{3,}/g, '\n\n').trim(), method: 'native' }
}

async function extractSpreadsheet(data: Uint8Array): Promise<ExtractedDocument> {
  const XLSX = await import('xlsx')
  const workbook = XLSX.read(data, { type: 'array', dense: true })
  const sections: string[] = []
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name]
    if (sheet === undefined) continue
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false }).trim()
    if (csv !== '') sections.push(`# Sheet: ${name}\n${csv}`)
  }
  return { text: sections.join('\n\n'), method: 'native', pages: workbook.SheetNames.length }
}

type Zip = import('jszip')

async function loadZip(data: Uint8Array): Promise<Zip> {
  const { default: JSZip } = await import('jszip')
  return JSZip.loadAsync(data)
}

async function readZipText(zip: Zip, path: string): Promise<string | undefined> {
  return zip.file(path)?.async('string')
}

/** Zip entries matching one numbered pattern, in numeric order. */
function numberedEntries(zip: Zip, pattern: RegExp): string[] {
  const indexed: Array<{ path: string; index: number }> = []
  zip.forEach((path) => {
    const match = pattern.exec(path)
    if (match?.[1] !== undefined) indexed.push({ path, index: Number(match[1]) })
  })
  return indexed.sort((a, b) => a.index - b.index).map(entry => entry.path)
}

/** Text runs of DrawingML (`<a:t>`), one line per paragraph. */
function drawingText(xml: string): string {
  return xml
    .split(/<\/a:p>/)
    .map(paragraph => [...paragraph.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map(run => decodeXml(run[1] ?? '')).join(''))
    .map(line => line.trim())
    .filter(line => line !== '')
    .join('\n')
}

async function extractPptx(data: Uint8Array): Promise<ExtractedDocument> {
  const zip = await loadZip(data)
  const slides = numberedEntries(zip, /^ppt\/slides\/slide(\d+)\.xml$/i)
  const notes = new Map(numberedEntries(zip, /^ppt\/notesSlides\/notesSlide(\d+)\.xml$/i)
    .map(path => [Number(/(\d+)\.xml$/i.exec(path)?.[1]), path] as const))
  const sections: string[] = []
  for (const [position, path] of slides.entries()) {
    const number = Number(/(\d+)\.xml$/i.exec(path)?.[1] ?? position + 1)
    const body = drawingText(await readZipText(zip, path) ?? '')
    const notesPath = notes.get(number)
    const notesText = notesPath === undefined ? '' : drawingText(await readZipText(zip, notesPath) ?? '')
    const parts = [`--- Slide ${position + 1} ---`, body]
    if (notesText !== '') parts.push(`Notes:\n${notesText}`)
    sections.push(parts.filter(part => part !== '').join('\n'))
  }
  return { text: sections.join('\n\n'), method: 'native', pages: slides.length }
}

async function extractOpenDocument(data: Uint8Array): Promise<ExtractedDocument> {
  const zip = await loadZip(data)
  const content = await readZipText(zip, 'content.xml')
  if (content === undefined) throw new Error('OpenDocument package has no content.xml')
  const text = content
    .replace(/<text:tab\/>/g, '\t')
    .replace(/<text:line-break\/>/g, '\n')
    .replace(/<text:s(?:\s+text:c="(\d+)")?\/>/g, (_all, count: string | undefined) => ' '.repeat(Number(count ?? 1)))
    .replace(/<\/(?:text:p|text:h|draw:page)>/g, '\n')
    .replace(/<[^>]+>/g, '')
  return { text: collapseBlankLines(decodeXml(text)), method: 'native' }
}

async function extractEpub(data: Uint8Array): Promise<ExtractedDocument> {
  const zip = await loadZip(data)
  const container = await readZipText(zip, 'META-INF/container.xml') ?? ''
  const opfPath = /full-path="([^"]+)"/.exec(container)?.[1]
  let chapters: string[] = []
  if (opfPath !== undefined) {
    const opf = await readZipText(zip, opfPath) ?? ''
    const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : ''
    const manifest = new Map<string, string>()
    for (const item of opf.matchAll(/<item\b[^>]*>/g)) {
      const id = /\bid="([^"]+)"/.exec(item[0])?.[1]
      const href = /\bhref="([^"]+)"/.exec(item[0])?.[1]
      if (id !== undefined && href !== undefined) manifest.set(id, base + decodeURIComponent(href))
    }
    chapters = [...opf.matchAll(/<itemref\b[^>]*\bidref="([^"]+)"/g)]
      .map(ref => manifest.get(ref[1] ?? ''))
      .filter((path): path is string => path !== undefined)
  }
  if (chapters.length === 0) {
    zip.forEach((path) => { if (/\.x?html?$/i.test(path)) chapters.push(path) })
    chapters.sort()
  }
  const sections: string[] = []
  for (const path of chapters) {
    const text = htmlToText(await readZipText(zip, path) ?? '')
    if (text !== '') sections.push(text)
  }
  return { text: sections.join('\n\n'), method: 'native', pages: chapters.length }
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  copy: '©', reg: '®', trade: '™', euro: '€', bull: '•',
}

function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) return safeCodePoint(Number.parseInt(body.slice(2), 16), entity)
    if (body.startsWith('#')) return safeCodePoint(Number.parseInt(body.slice(1), 10), entity)
    return NAMED_ENTITIES[body.toLowerCase()] ?? entity
  })
}

function safeCodePoint(value: number, fallback: string): string {
  return Number.isInteger(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : fallback
}

function collapseBlankLines(text: string): string {
  return text.split('\n').map(line => line.replace(/[ \t]+$/, '')).join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Convert HTML to readable text: scripts and styles are dropped and block elements end lines.
 * @param html - markup.
 * @returns plain text.
 */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|head|noscript|template)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|h[1-6]|li|tr|table|section|article|header|footer|blockquote|pre|ul|ol)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '\t')
    .replace(/<[^>]+>/g, '')
  return collapseBlankLines(decodeXml(text).replace(/ /g, ' '))
}

/** RTF destinations whose content is metadata, not document text. */
const SKIPPED_DESTINATIONS = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'header', 'footer', 'headerl', 'headerr',
  'footerl', 'footerr', 'listtable', 'listoverridetable', 'rsidtbl', 'generator', 'xmlnstbl', 'themedata',
  'colorschememapping', 'latentstyles', 'datastore', 'filetbl', 'revtbl',
])

/**
 * Convert RTF to plain text: control words are interpreted for line breaks,
 * escapes, and Unicode; metadata destinations are skipped.
 * @param rtf - RTF source decoded as Latin-1.
 * @returns plain text.
 */
export function rtfToText(rtf: string): string {
  const out: string[] = []
  // Each group records whether its content is skipped and how many ANSI
  // fallback characters follow a \u escape.
  const stack: Array<{ skip: boolean; uc: number }> = []
  let skip = false
  let uc = 1
  let pendingFallback = 0
  let index = 0
  const emit = (text: string): void => {
    if (skip) return
    if (pendingFallback > 0) {
      pendingFallback -= 1
      return
    }
    out.push(text)
  }
  while (index < rtf.length) {
    const char = rtf[index] as string
    if (char === '{') {
      stack.push({ skip, uc })
      index += 1
      continue
    }
    if (char === '}') {
      const outer = stack.pop()
      if (outer !== undefined) {
        skip = outer.skip
        uc = outer.uc
      }
      index += 1
      continue
    }
    if (char === '\r' || char === '\n') {
      index += 1
      continue
    }
    if (char !== '\\') {
      emit(char)
      index += 1
      continue
    }
    const next = rtf[index + 1]
    if (next === undefined) break
    if (next === '\\' || next === '{' || next === '}') {
      emit(next)
      index += 2
      continue
    }
    if (next === '\'') {
      const hex = rtf.slice(index + 2, index + 4)
      emit(String.fromCharCode(Number.parseInt(hex, 16)))
      index += 4
      continue
    }
    if (next === '*') {
      skip = true
      index += 2
      continue
    }
    if (next === '~') {
      emit(' ')
      index += 2
      continue
    }
    if (next === '-' || next === '_') {
      index += 2
      continue
    }
    const word = /^([a-zA-Z]+)(-?\d+)? ?/.exec(rtf.slice(index + 1, index + 40))
    if (word === null) {
      index += 2
      continue
    }
    index += 1 + word[0].length
    const name = word[1] as string
    const param = word[2] === undefined ? undefined : Number(word[2])
    if (SKIPPED_DESTINATIONS.has(name)) {
      skip = true
      continue
    }
    switch (name) {
      case 'par':
      case 'line':
      case 'sect':
      case 'page':
        emit('\n')
        break
      case 'tab':
      case 'cell':
        emit('\t')
        break
      case 'row':
        emit('\n')
        break
      case 'uc':
        uc = param ?? 1
        break
      case 'u':
        if (param !== undefined) {
          emit(String.fromCharCode(param < 0 ? param + 65536 : param))
          pendingFallback = uc
        }
        break
      default:
        break
    }
  }
  return collapseBlankLines(out.join(''))
}
