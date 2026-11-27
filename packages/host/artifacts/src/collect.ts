/**
 * Reads one Session log into its artifacts: the finished files a tool created, classified by extension.
 * The produced-file facts come from the `turnDeliverables` fold, so this list and the chat's file cards
 * name the same files.
 * @module @aeven/host-artifacts/collect
 */

import type { SessionEvent, SessionHeader, SessionLogOffset } from '@aeven/session'
import { turnDeliverablesProjectionDefinition } from '@aeven/session-turn-outline'
import type { Artifact, ArtifactId, ArtifactKind } from './types.ts'

/** File extensions that count as artifacts, by kind. Source code and configuration files are deliberately absent. */
const KIND_BY_EXTENSION: Readonly<Record<string, ArtifactKind>> = {
  md: 'document', markdown: 'document', txt: 'document', rtf: 'document', doc: 'document', docx: 'document',
  odt: 'document', pages: 'document',
  ppt: 'slides', pptx: 'slides', key: 'slides', odp: 'slides',
  pdf: 'pdf',
  html: 'page', htm: 'page',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', avif: 'image', svg: 'image',
  mp4: 'video', mov: 'video', webm: 'video', m4v: 'video',
}

/**
 * The file name at the end of a path written with either separator.
 * @param path - absolute or relative file path.
 * @returns the last path segment.
 */
export function artifactName(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
}

/**
 * Classify a path by its extension.
 * @param path - absolute or relative file path.
 * @returns the artifact kind, or undefined when the extension is not an artifact's.
 */
export function artifactKind(path: string): ArtifactKind | undefined {
  const name = artifactName(path)
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return undefined
  return KIND_BY_EXTENSION[name.slice(dot + 1).toLowerCase()]
}

/** The tool whose result shows a Motion film: a folder of HTML scenes played as one video. */
const SHOW_MOTION = 'show_motion'

/** Tools whose results hold the pictures and clips they generated as stored copies, with no file on disk. */
const GENERATORS = new Set(['generate_image', 'generate_video'])

/** Characters of a generation prompt a card's title keeps. */
const PROMPT_TITLE_CHARS = 120

/** One picture or clip a generation tool stored. */
interface GeneratedCopy {
  readonly seq: number
  readonly time: number
  readonly attachmentId: string
  readonly name: string
  readonly kind: 'image' | 'video'
  /** The prompt the call generated it from, as the card's title. */
  readonly prompt?: string | undefined
}

/** One image a reply links to by a path on disk. */
interface LinkedImage {
  readonly seq: number
  readonly time: number
  readonly path: string
  /** The link's own text, when it says something. */
  readonly label?: string | undefined
}

/** File extensions of the media types a generated copy is stored as. */
const EXTENSION_BY_TYPE: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm',
}

/**
 * The stored copies one generation result holds.
 * @param content - the result's content blocks.
 * @returns each picture and clip with the name it is shown under: its own, else its digest's first characters and
 * the extension its media type names, the name the conversation shows it under.
 */
function generatedCopies(content: readonly unknown[]): Array<Pick<GeneratedCopy, 'attachmentId' | 'name' | 'kind'>> {
  return content.flatMap((block) => {
    if (typeof block !== 'object' || block === null || !('type' in block) || !('attachment' in block)) return []
    const attachment = block.attachment
    if (typeof attachment !== 'object' || attachment === null || !('attachmentId' in attachment)) return []
    const { attachmentId } = attachment
    const mediaType = 'mediaType' in attachment && typeof attachment.mediaType === 'string' ? attachment.mediaType : ''
    if (typeof attachmentId !== 'string') return []
    const kind = block.type === 'image' ? 'image' : block.type === 'file' && mediaType.startsWith('video/') ? 'video' : undefined
    if (kind === undefined) return []
    const own = 'name' in attachment && typeof attachment.name === 'string' && attachment.name !== '' ? attachment.name : undefined
    const name = own ?? `${attachmentId.replace(/^sha256:/u, '').slice(0, 12)}.${EXTENSION_BY_TYPE[mediaType] ?? kind}`
    return [{ attachmentId, name, kind }]
  })
}

/**
 * The prompt a generation call names, as a one-line title.
 * @param raw - the call's arguments as the model sent them.
 * @returns the prompt, clipped, or undefined when the call names none.
 */
function promptTitle(raw: string): string | undefined {
  let args: unknown
  try {
    args = JSON.parse(raw)
  } catch {
    // Unreadable arguments name no prompt; the card falls back to the conversation's title.
    return undefined
  }
  if (typeof args !== 'object' || args === null || !('prompt' in args) || typeof args.prompt !== 'string') return undefined
  const line = args.prompt.replace(/\s+/gu, ' ').trim()
  if (line === '') return undefined
  return line.length > PROMPT_TITLE_CHARS ? `${line.slice(0, PROMPT_TITLE_CHARS - 1).trimEnd()}\u2026` : line
}

/** The source file a skill keeps in the folder of each thing it makes, naming what that folder's files are. */
export const SOURCE_FAMILY: Readonly<Record<string, Family>> = { 'cv.json': 'resume', 'deck.json': 'deck' }

/** What a set of exports is: a résumé or a slide deck. */
type Family = NonNullable<Artifact['family']>

/** Kinds an exporter writes beside the page it exports, whose page of the same name is the version to publish. */
const EXPORT_KINDS: ReadonlySet<ArtifactKind> = new Set(['document', 'slides', 'pdf'])

/**
 * A path without its extension, so the exports of one source match.
 * @param path - a path in either separator spelling.
 * @returns the path up to its last dot after the last separator.
 */
function stemOf(path: string): string {
  const dot = path.lastIndexOf('.')
  return dot > Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) ? path.slice(0, dot) : path
}

/**
 * The folder of a comparable path.
 * @param path - comparable path.
 * @returns the path up to its last slash.
 */
function folderOf(path: string): string {
  return path.slice(0, path.lastIndexOf('/'))
}

/**
 * Whether a path names a scratch file: a hidden file, or one whose name or folder starts with `_`, the names Aeven
 * gives the throwaway pages, probes and review copies it makes while working. Such a file is not an artifact.
 * @param path - a path in either separator spelling.
 * @returns true for a scratch file.
 */
function scratch(path: string): boolean {
  const parts = path.split(/[\\/]/u)
  const name = parts.at(-1) ?? ''
  return name.startsWith('.') || name.startsWith('_') || (parts.at(-2) ?? '').startsWith('_')
}

/** Tools whose successful results can add an artifact on their own, beside any result that declares output files. */
export const ARTIFACT_TOOLS: ReadonlySet<string> = new Set(['write', 'edit', 'str_replace_editor', SHOW_MOTION, ...GENERATORS])

/**
 * Whether a reply's text links to an image on disk, which lists that image.
 * @param text - the reply's text.
 * @returns true when the text holds such a link.
 */
export function linksImage(text: string): boolean {
  return text.includes('](') && linkedImages(text).length > 0
}

/** A Markdown image or link: its text, then its target up to the first space or closing parenthesis. */
const MARKDOWN_LINK = /(!?)\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/gu

/**
 * The images on disk a reply links to, written as Markdown images or links.
 * @param text - the reply's text.
 * @returns each image's path as written and the link's text; web addresses and inline data are not files.
 */
function linkedImages(text: string): Array<{ path: string; label?: string }> {
  const found: Array<{ path: string; label?: string }> = []
  for (const match of text.matchAll(MARKDOWN_LINK)) {
    let target = match[3] ?? ''
    try {
      target = decodeURI(target)
    } catch {
      // A malformed escape stays as written.
    }
    target = target.replace(/^file:\/\//u, '')
    if (/^[a-z][a-z\d+.-]*:/iu.test(target) && !/^[a-z]:[\\/]/iu.test(target)) continue
    if (target.startsWith('#') || artifactKind(target) !== 'image') continue
    const label = (match[2] ?? '').trim()
    found.push({ path: target, ...label === '' || label === '...' ? {} : { label } })
  }
  return found
}

/** One Motion film as its latest `show_motion` result recorded it. */
interface MotionFilm {
  readonly seq: number
  readonly time: number
  /** The `show_motion` call that showed it. */
  readonly callId: string
  /** Absolute composition folder, with forward slashes and no trailing slash. */
  readonly dir: string
  /** Attachment id of the film bundled into one document, absent when the call stored none. */
  readonly attachmentId?: string | undefined
}

/**
 * A path with forward slashes, made absolute against the Session's working directory when it is relative.
 * @param path - absolute or relative path in the writing device's spelling.
 * @param cwd - the Session's working directory, when recorded.
 * @returns the comparable path.
 */
function comparable(path: string, cwd: string | undefined): string {
  const forward = path.replaceAll('\\', '/')
  const absolute = forward.startsWith('/') || /^[A-Za-z]:\//u.test(forward)
  const joined = absolute || cwd === undefined ? forward : `${cwd.replaceAll('\\', '/').replace(/\/+$/u, '')}/${forward}`
  return joined.replace(/\/+$/u, '')
}

/**
 * Read a `show_motion` result's presentation metadata.
 * @param meta - the result's metadata as logged.
 * @returns the composition folder and the stored film's attachment id, or undefined when it names no folder.
 */
function motionOf(meta: unknown): { dir: string; attachmentId?: string } | undefined {
  if (typeof meta !== 'object' || meta === null || !('compositionDir' in meta) || typeof meta.compositionDir !== 'string') return undefined
  const film = 'film' in meta ? meta.film : undefined
  const attachmentId = typeof film === 'object' && film !== null && 'attachmentId' in film && typeof film.attachmentId === 'string'
    ? film.attachmentId
    : undefined
  return { dir: comparable(meta.compositionDir, undefined), ...attachmentId === undefined ? {} : { attachmentId } }
}

/** File names, without their extension, that say nothing about what the file is. */
const GENERIC_STEMS = new Set(['index', 'main', 'home', 'default', 'output', 'out', 'untitled', 'document', 'file', 'page', 'final'])

/** Folder names that say nothing about what the files inside them are. */
const GENERIC_FOLDERS = new Set([
  'src', 'dist', 'build', 'public', 'out', 'output', 'site', 'www', 'web', 'app', 'docs', 'assets', 'static',
  'tmp', 'temp', 'chats', 'aeven', 'documents', 'desktop', 'downloads', 'compositions', 'pages', 'html',
])

/** Characters an HTML title escapes, by entity name. */
const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '\u2014', ndash: '\u2013', hellip: '\u2026',
  middot: '\u00b7', laquo: '\u00ab', raquo: '\u00bb', rsquo: '\u2019', lsquo: '\u2018', rdquo: '\u201d', ldquo: '\u201c',
}

/**
 * The text of an HTML document's `<title>`, with entities decoded and whitespace collapsed.
 * @param html - the document's text.
 * @returns the title, or undefined when the document has no non-empty title.
 */
export function htmlTitle(html: string): string | undefined {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/iu.exec(html)
  if (match === null) return undefined
  const text = (match[1] ?? '')
    .replace(/&#x([0-9a-f]+);/giu, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/gu, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/giu, (entity, name: string) => ENTITIES[name.toLowerCase()] ?? entity)
    .replace(/\s+/gu, ' ')
    .trim()
  return text === '' ? undefined : text
}

/**
 * A folder or file name as words: separators become spaces and the first letter is capitalised.
 * @param name - a folder name or file stem, such as `vase-reassembly`.
 * @returns the readable name, such as `Vase reassembly`.
 */
export function readableName(name: string): string {
  const words = name.replace(/[-_.]+/gu, ' ').replace(/\s+/gu, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * The name of the folder holding a path, when it says something about the file.
 * @param path - comparable path.
 * @returns the folder's name, or undefined when it is generic or absent.
 */
function telling(path: string): string | undefined {
  const parts = path.split('/').filter(part => part !== '')
  const folder = parts.at(-2)
  if (folder === undefined || GENERIC_FOLDERS.has(folder.toLowerCase())) return undefined
  return folder
}

/**
 * What to call one artifact.
 * @param path - comparable path of the file, or of a Motion film's `index.html`.
 * @param written - the page's own title, when the content Aeven wrote declared one.
 * @param conversation - the conversation's title, when it has one.
 * @returns the title the card shows.
 */
function titleOf(path: string, written: string | undefined, conversation: string | undefined): string {
  if (written !== undefined) return written
  const name = artifactName(path)
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  if (!GENERIC_STEMS.has(stem.toLowerCase())) return name
  const folder = telling(path)
  if (folder !== undefined) return readableName(folder)
  return conversation ?? name
}

/**
 * The whole page a write call puts on disk: `write` with its content, or `str_replace_editor` creating a file.
 * @param name - the tool's name.
 * @param raw - the call's arguments as the model sent them.
 * @returns the path as the call named it and the content, or undefined for any other call or a non-HTML file.
 */
function writtenPage(name: string, raw: string): { path: string; content: string } | undefined {
  if (name !== 'write' && name !== 'str_replace_editor') return undefined
  let args: unknown
  try {
    args = JSON.parse(raw)
  } catch {
    // Unreadable arguments wrote nothing the turn's files list either.
    return undefined
  }
  if (typeof args !== 'object' || args === null) return undefined
  const record = args as Record<string, unknown>
  const path = name === 'write' ? record.file_path : record.command === 'create' ? record.path : undefined
  const content = name === 'write' ? record.content : record.file_text
  if (typeof path !== 'string' || typeof content !== 'string' || artifactKind(path) !== 'page') return undefined
  return { path, content }
}

/**
 * The artifacts one Session log records, newest first. A file counts when a tool created it or a command
 * declared it as an output; a later change to a file the Session did not create does not. A path created
 * more than once is listed once, at its latest creation. Events inherited from a fork parent are skipped,
 * because the parent Session lists them.
 *
 * A Motion film is one artifact, its composition folder, and the scene pages inside that folder are left out. A
 * page beside an export of the same name, such as `deck.html` next to `deck.pdf`, is listed beside it, because
 * the page is the version that can be published.
 * @param header - the Session's immutable metadata.
 * @param inheritedEventCount - length of the fork-inherited event prefix.
 * @param events - the Session's whole logical log.
 * @returns the Session's artifacts.
 */
export function collectArtifacts(
  header: SessionHeader,
  inheritedEventCount: SessionLogOffset,
  events: readonly SessionEvent[],
): Artifact[] {
  const definition = turnDeliverablesProjectionDefinition
  let state = definition.init()
  const times = new Map<number, number>()
  const motionCalls = new Set<string>()
  let films = new Map<string, MotionFilm>()
  const generations = new Map<string, string | undefined>()
  let generated: GeneratedCopy[] = []
  let linked: LinkedImage[] = []
  // The `<title>` of each page as Aeven last wrote it whole, by the path the call named.
  const written = new Map<string, string>()
  let conversation: string | undefined
  for (const event of events) {
    state = definition.apply(state, event)
    if (event.type === 'tool/call') {
      if (event.data.name === SHOW_MOTION) motionCalls.add(String(event.data.callId))
      if (GENERATORS.has(event.data.name)) generations.set(String(event.data.callId), promptTitle(event.data.arguments))
      const page = writtenPage(event.data.name, event.data.arguments)
      if (page !== undefined) {
        const title = htmlTitle(page.content)
        if (title === undefined) written.delete(page.path)
        else written.set(page.path, title)
      }
    } else if ((event.type as string) === 'session/title') {
      const data: unknown = event.data
      const title = typeof data === 'object' && data !== null && 'title' in data && typeof data.title === 'string' ? data.title.trim() : ''
      if (title !== '') conversation = title
    } else if (event.type === 'tool/result') {
      times.set(event.seq, event.time)
      const result = event.data.message.content[0]
      const callId = String(event.data.message.source.callId)
      if (motionCalls.delete(callId) && result.isError !== true) {
        const motion = motionOf(event.data.meta)
        if (motion !== undefined) films.set(motion.dir, { seq: event.seq, time: event.time, callId, ...motion })
      }
      if (generations.has(callId)) {
        const prompt = generations.get(callId)
        generations.delete(callId)
        if (result.isError !== true) {
          for (const copy of generatedCopies(result.content)) generated.push({ seq: event.seq, time: event.time, prompt, ...copy })
        }
      }
    } else if (event.type === 'assistant/message') {
      for (const block of event.data.message.content) {
        if (block.type !== 'text') continue
        for (const link of linkedImages(block.text)) linked.push({ seq: event.seq, time: event.time, ...link })
      }
    } else if (event.type === 'session/rewind') {
      const target = event.data.seq
      films = new Map([...films].filter(([, film]) => film.seq < target))
      generated = generated.filter(copy => copy.seq < target)
      linked = linked.filter(link => link.seq < target)
    }
  }
  const ownFrom = events[inheritedEventCount]?.seq ?? Number.POSITIVE_INFINITY
  const byPath = new Map<string, Artifact>()
  const linkedOnly = new Set<string>()
  // Folders the Session keeps a skill's source in, and the family their files belong to.
  const families = new Map<string, Family>()
  // The page an exporter wrote beside the exports a command declared, which the command did not declare itself.
  const pages = new Map<string, { readonly seq: number }>()
  for (const turn of state.turns) {
    for (const file of turn.produced) {
      const family = SOURCE_FAMILY[artifactName(file.path)]
      if (family !== undefined) families.set(folderOf(comparable(file.path, header.cwd)), family)
      if (file.seq < ownFrom || !(file.created || file.declared === true)) continue
      const kind = artifactKind(file.path)
      if (kind === undefined || scratch(file.path)) continue
      if (file.declared === true && EXPORT_KINDS.has(kind)) pages.set(`${stemOf(file.path)}.html`, { seq: file.seq })
      byPath.set(file.path, {
        id: `${header.id}:${file.path}` as ArtifactId,
        sessionId: header.id,
        path: file.path,
        name: artifactName(file.path),
        title: titleOf(comparable(file.path, header.cwd), written.get(file.path), conversation),
        kind,
        createdAt: times.get(file.seq) ?? header.createdAt,
        ...file.attachmentId === undefined ? {} : { attachmentId: file.attachmentId },
      })
    }
  }
  // Listed while it is on disk; the presence check leaves out one the exporter did not write.
  for (const [path, page] of pages) {
    if (byPath.has(path)) continue
    byPath.set(path, {
      id: `${header.id}:${path}` as ArtifactId,
      sessionId: header.id,
      path,
      name: artifactName(path),
      title: titleOf(comparable(path, header.cwd), written.get(path), conversation),
      kind: 'page',
      createdAt: times.get(page.seq) ?? header.createdAt,
    })
  }
  // An image a reply links to is listed when no tool's record of the file already lists it, at its latest link.
  for (const link of linked) {
    if (link.seq < ownFrom || scratch(link.path) || byPath.get(link.path)?.kind === 'image' && !linkedOnly.has(link.path)) continue
    linkedOnly.add(link.path)
    const path = comparable(link.path, header.cwd)
    byPath.set(link.path, {
      id: `${header.id}:${link.path}` as ArtifactId,
      sessionId: header.id,
      path: link.path,
      name: artifactName(link.path),
      title: link.label ?? titleOf(path, undefined, conversation),
      kind: 'image',
      createdAt: link.time,
    })
  }
  const files = [...byPath.values()]
  const dirs = [...films.keys()]
  // A file beside a deck's own slides file, such as `deck.pdf` next to `deck.pptx`, is one of its exports.
  const decks = new Set(files.filter(item => item.kind === 'slides').map(item => stemOf(comparable(item.path, header.cwd))))
  const listed = files.flatMap((item) => {
    const path = comparable(item.path, header.cwd)
    if (dirs.some(dir => path.startsWith(`${dir}/`))) return []
    if (item.kind === 'image' || item.kind === 'video') return [item]
    const family = families.get(folderOf(path)) ?? (decks.has(stemOf(path)) ? 'deck' : undefined)
    return [family === undefined ? item : { ...item, family }]
  })
  for (const film of films.values()) {
    if (film.seq < ownFrom || scratch(`${film.dir}/index.html`)) continue
    listed.push({
      id: `${header.id}:${film.dir}` as ArtifactId,
      sessionId: header.id,
      path: `${film.dir}/index.html`,
      name: artifactName(film.dir),
      title: titleOf(`${film.dir}/index.html`, undefined, conversation),
      kind: 'motion',
      createdAt: film.time,
      callId: film.callId,
      ...film.attachmentId === undefined ? {} : { attachmentId: film.attachmentId },
    })
  }
  const copies = new Set<string>()
  for (const copy of generated) {
    if (copy.seq < ownFrom || copies.has(copy.attachmentId)) continue
    copies.add(copy.attachmentId)
    listed.push({
      id: `${header.id}:${copy.attachmentId}` as ArtifactId,
      sessionId: header.id,
      path: copy.name,
      name: copy.name,
      title: copy.prompt ?? conversation ?? copy.name,
      kind: copy.kind,
      createdAt: copy.time,
      attachmentId: copy.attachmentId,
      stored: true,
    })
  }
  return listed.sort((a, b) => b.createdAt - a.createdAt)
}
