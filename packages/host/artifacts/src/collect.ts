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
 * A path split into its folder and its name without the extension, for matching a source page to its export.
 * @param path - comparable path.
 * @returns the folder and the stem joined, so two files match when both agree.
 */
function stemKey(path: string): string {
  const dot = path.lastIndexOf('.')
  return dot > path.lastIndexOf('/') ? path.slice(0, dot) : path
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
 * A page that is only the source of something else is not listed. A Motion film is one artifact, its
 * composition folder, and the scene pages inside that folder are left out. A page beside an export of the
 * same name, such as `deck.html` next to `deck.pdf`, is left out in favour of the export.
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
  // The `<title>` of each page as Aeven last wrote it whole, by the path the call named.
  const written = new Map<string, string>()
  let conversation: string | undefined
  for (const event of events) {
    state = definition.apply(state, event)
    if (event.type === 'tool/call') {
      if (event.data.name === SHOW_MOTION) motionCalls.add(String(event.data.callId))
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
    } else if (event.type === 'session/rewind') {
      const target = event.data.seq
      films = new Map([...films].filter(([, film]) => film.seq < target))
    }
  }
  const ownFrom = events[inheritedEventCount]?.seq ?? Number.POSITIVE_INFINITY
  const byPath = new Map<string, Artifact>()
  for (const turn of state.turns) {
    for (const file of turn.produced) {
      if (file.seq < ownFrom || !(file.created || file.declared === true)) continue
      const kind = artifactKind(file.path)
      if (kind === undefined) continue
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
  const files = [...byPath.values()]
  const exported = new Set(files.filter(item => item.kind !== 'page').map(item => stemKey(comparable(item.path, header.cwd))))
  const dirs = [...films.keys()]
  const listed = files.filter((item) => {
    const path = comparable(item.path, header.cwd)
    if (dirs.some(dir => path.startsWith(`${dir}/`))) return false
    return item.kind !== 'page' || !exported.has(stemKey(path))
  })
  for (const film of films.values()) {
    if (film.seq < ownFrom) continue
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
  return listed.sort((a, b) => b.createdAt - a.createdAt)
}
