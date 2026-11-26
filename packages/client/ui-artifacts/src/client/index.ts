/**
 * Artifacts: the sidebar row under Bots and the `/artifacts` start page, a grid of cards for the finished
 * files Æven created across the account's conversations, read from the `artifacts` Host Remote.
 * @module @aeven/client-ui-artifacts/client
 */
import type { Context } from '@deepseek-ai/cordis'
import type { UiWorkspace } from '@aeven/client-ui-workspace/client'
import type {} from '@aeven/client-locale/client'
import type {} from '@aeven/client-ui-sidebar/client'
import type {} from '@aeven/client-ui-sidebar-files/client'
import type {} from '@aeven/client-ui-renderer/client'
import type {} from '@aeven/client-ui-conversation/client'
import type {} from '@aeven/api-session-controller/client'
import type {} from '@aeven/api-remotes/client'
import type { Artifact } from '@aeven/host-artifacts/types'
import { ArtifactsPage, type ArtifactsPageInjected } from './ArtifactsPage.tsx'
import { ArtifactsRow, type ArtifactsRowInjected } from './ArtifactsRow.tsx'
import { artifactHref, linkedArtifact } from './links.ts'
import { isTextArtifact } from './TextPreview.tsx'
import { en, es, zh, type ArtifactsKey } from './locales.ts'

declare module '@aeven/client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Artifacts row and page copy. */
    artifacts: ArtifactsKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'artifacts'

/** Start address of the Artifacts page. */
export const ARTIFACTS_PATH = '/artifacts'

/**
 * The URL of a stored copy a Session's log cites.
 * @param artifact - an artifact whose tool result stored a copy.
 * @param attachmentId - that copy's attachment id.
 * @returns the absolute `/api/attachment-file` URL on this app's origin.
 */
function attachmentUrl(artifact: Artifact, attachmentId: string): string {
  const url = new URL('api/attachment-file', document.baseURI)
  url.searchParams.set('sessionId', artifact.sessionId)
  url.searchParams.set('id', attachmentId)
  return url.href
}

/**
 * The Host's cached card picture of one artifact, or the opening of a text file.
 * @param artifact - the artifact.
 * @param opening - whether to ask for a text file's opening instead of a picture.
 * @returns the absolute `/api/artifact-preview` URL on this app's origin.
 */
function previewUrl(artifact: Artifact, opening = false): string {
  const url = new URL('api/artifact-preview', document.baseURI)
  url.searchParams.set('sessionId', artifact.sessionId)
  url.searchParams.set('path', artifact.path)
  if (opening) url.searchParams.set('opening', '1')
  // The version names this file's current bytes, so the browser keeps the answer and a returning page asks for nothing.
  if (artifact.version !== undefined) url.searchParams.set('v', artifact.version)
  return url.href
}

/**
 * Call the Host under the page's own credential, the way attachment uploads do.
 * @param input - Host route URL.
 * @param signal - aborts the request.
 * @returns the Host's response.
 */
function hostFetch(input: URL, signal: AbortSignal): Promise<Response> {
  const transport = (window as Window & {
    __AVN_TRANSPORT__?: { fetch(input: URL, init: RequestInit): Promise<Response> }
  }).__AVN_TRANSPORT__
  return transport === undefined ? globalThis.fetch(input, { signal }) : transport.fetch(input, { signal })
}

/** Text openings already fetched this page visit, by artifact id. */
const openings = new Map<string, Promise<string | undefined>>()

/** Films already fetched this page visit, by artifact id. */
const films = new Map<string, Promise<string | undefined>>()

/**
 * A Motion film's document, from the first source that serves it: the film its call stored, which never changes
 * and so stays in the browser's cache, then the folder's current files bundled by this Host, then the composition
 * the Host rebuilds from the conversation's log.
 * @param artifact - a `motion` artifact.
 * @param signal - aborts the fetch.
 * @returns the film's HTML, or undefined when no source serves it.
 */
async function fetchFilm(artifact: Artifact, signal: AbortSignal): Promise<string | undefined> {
  const sources: URL[] = []
  if (artifact.attachmentId !== undefined) sources.push(new URL(attachmentUrl(artifact, artifact.attachmentId)))
  // A folder not on this device has no live bundle; the log's rebuild stands in.
  if (artifact.missing !== true) {
    const preview = new URL('api/motion/preview', document.baseURI)
    preview.searchParams.set('dir', artifact.path.slice(0, artifact.path.lastIndexOf('/')))
    sources.push(preview)
  }
  if (artifact.callId !== undefined) {
    const replay = new URL('api/motion/replay', document.baseURI)
    replay.searchParams.set('sessionId', artifact.sessionId)
    replay.searchParams.set('callId', artifact.callId)
    sources.push(replay)
  }
  for (const source of sources) {
    const response = await hostFetch(source, signal)
    // The preview route answers 204 on a Host that serves no folders.
    if (response.status === 200) return await response.text()
  }
  return undefined
}

/** Services that own the Remote, navigation, and slot composition. */
export const inject = ['slots', 'locale', 'uiWorkspace', 'sessions', 'remote', 'remote.artifacts']

/**
 * Register the Artifacts page at its start address and the sidebar row that opens it.
 * @param ctx - browser composition context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { en, zh, es }), 'ui-artifacts: dictionaries')
  const t = ctx.locale.bind(NS)
  const workspace = ctx.get('uiWorkspace') as UiWorkspace
  ctx.effect(() => workspace.registerStartAddress(ARTIFACTS_PATH, {
    composerPlaceholder: () => t('composerPlaceholder'),
    // What the reader asks for here is a chat of its own, never work in the project folder that happened to be open.
    builtInWorkspace: true,
  }), 'ui-artifacts: /artifacts start address')

  /**
   * Where a card's picture comes from, in the order to try them. Every kind but a video asks the Host's cached
   * card picture first, drawn once per file version; a picture then falls back to its stored copy, because this
   * Host may not hold the file itself, and to the file. A video plays its stored copy or file.
   */
  const previewUrls = (artifact: Artifact): readonly string[] => {
    if (artifact.kind === 'motion' || isTextArtifact(artifact)) return []
    const files = ctx.get('sidebarFiles')
    // The stored copy stands for the file; the file itself is asked for only when no copy was kept and it is here.
    const original = artifact.attachmentId !== undefined
      ? [attachmentUrl(artifact, artifact.attachmentId)]
      : artifact.missing === true || files === undefined ? [] : [files.fileUrl(artifact.sessionId, artifact.path)]
    const originals = artifact.kind === 'image' || artifact.kind === 'video' ? original : []
    return artifact.kind === 'video' || artifact.missing === true ? originals : [previewUrl(artifact), ...originals]
  }
  // The last complete list, for as long as the app stays open.
  let kept: readonly Artifact[] | undefined
  const page: ArtifactsPageInjected = {
    list: async (cursor) => {
      const result = await ctx.remote.artifacts.list(cursor === undefined ? {} : { cursor })
      return result.ok ? result.value : null
    },
    hrefOf: artifactHref,
    open: (artifact) => {
      ctx.sessions.open(artifact.sessionId)
      const copy = artifact.attachmentId === undefined ? undefined : attachmentUrl(artifact, artifact.attachmentId)
      void ctx.get('sidebarFiles')?.open(artifact.sessionId, artifact.path, copy)
    },
    previewUrls,
    lastList: { read: () => kept, keep: (items) => { kept = items } },
    loadText: (artifact, signal) => {
      const cached = openings.get(artifact.id)
      if (cached !== undefined) return cached
      // Only the opening, from the Host's preview route, which the browser keeps per file version.
      const pending = (async () => {
        const response = await hostFetch(new URL(previewUrl(artifact, true)), signal)
        return response.status === 200 ? await response.text() : undefined
      })()
      openings.set(artifact.id, pending)
      pending.then((text) => { if (text === undefined) openings.delete(artifact.id) }, () => { openings.delete(artifact.id) })
      return pending
    },
    loadMotion: (artifact, signal) => {
      const cached = films.get(artifact.id)
      if (cached !== undefined) return cached
      const pending = fetchFilm(artifact, signal)
      films.set(artifact.id, pending)
      // A failed or aborted fetch is tried again the next time the card loads.
      pending.then((html) => { if (html === undefined) films.delete(artifact.id) }, () => { films.delete(artifact.id) })
      return pending
    },
  }
  // An artifact link opened on its own, such as in a new tab, or entered while its conversation is already on screen,
  // which changes only the fragment: the conversation loads from the address, and the file it names opens in the right
  // sidebar once the Files pane is there. The fragment is cleared so a reload or a later visit to the conversation does
  // not open the file again.
  if (typeof location !== 'undefined') {
    let linked: ReturnType<typeof linkedArtifact>
    let files: Context['sidebarFiles'] | undefined
    const openLinked = (): void => {
      if (linked === undefined || files === undefined) return
      const copy = linked.attachmentId === undefined
        ? undefined
        : attachmentUrl({ sessionId: linked.sessionId } as Artifact, linked.attachmentId)
      void files.open(linked.sessionId, linked.path, copy)
      linked = undefined
    }
    const takeLink = (): void => {
      const found = linkedArtifact(location.pathname, location.hash)
      if (found === undefined) return
      history.replaceState(history.state, '', `${location.pathname}${location.search}`)
      linked = found
      openLinked()
    }
    takeLink()
    ctx.effect(() => {
      addEventListener('hashchange', takeLink)
      return () => { removeEventListener('hashchange', takeLink) }
    }, 'ui-artifacts: artifact links')
    ctx.inject(['sidebarFiles'], (scoped) => {
      // Files is provided again after a reconnect; a link opens its file once.
      files = scoped.sidebarFiles
      openLinked()
      scoped.effect(() => () => { if (files === scoped.sidebarFiles) files = undefined }, 'ui-artifacts: files opener')
    })
  }

  const row: ArtifactsRowInjected = { href: ARTIFACTS_PATH, open: () => { workspace.openStartAddress(ARTIFACTS_PATH) } }
  // Directly under Bots (order 0) and above Inspiration (order 2).
  ctx.slots.inject('sidebar.nav', () => ctx.slots.register(
    { name: 'sidebar.nav', id: 'artifacts', order: 1, locale: NS, inject: () => row }, ArtifactsRow,
  ))
  ctx.slots.inject('conversation.start', () => ctx.slots.register(
    { name: 'conversation.start', key: ARTIFACTS_PATH, locale: NS, inject: () => page }, ArtifactsPage,
  ))
}
