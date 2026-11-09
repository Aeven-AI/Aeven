/**
 * A motion film shown live at its `show_motion` call: the composition plays in the HyperFrames player under the
 * product's own clip chrome, and the save menu exports it to an MP4 the browser downloads. A later call for the
 * same folder takes over only once its own film is ready, and the earlier card then folds into one line that
 * opens the film as that call stored it. @module
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
// Side-effect import: registers the `hyperframes-player` custom element. Client modules load as one bundle each,
// so the player ships inside this module rather than as a lazily loaded chunk.
import '@hyperframes/player'
import {
  IconLucideChevronDown, IconLucideChevronRight, MediaPlayer, Spinner, saveClip, videoPlayerLabels, type ClipMedia,
} from '@aeven/client-ui-primitives'
import type { ToolCallViewProps } from '@aeven/client-ui-tool/client'
import type { PropsLocale } from '@aeven/client-ui-slots'
// Type-only: pulls the session-scoped standard props (`sessionId`).
import type {} from '@aeven/client-ui-session/client'
import type {} from './locales.ts'
import { ErrorDetailControl } from './ErrorDetailControl.tsx'
import css from './ImageToolView.module.css'

/** The HyperFrames player element, driven through the same members as a video element. */
type PlayerElement = HTMLElement & ClipMedia

/** The frame a film takes before its composition reports its own size. */
const DEFAULT_RATIO = 16 / 9

/**
 * Call the Host under the page's own credential, the way attachment uploads do.
 * @param input - Host route URL.
 * @param init - request options.
 * @returns the Host's response.
 */
function hostFetch(input: URL, init: RequestInit = {}): Promise<Response> {
  const transport = (window as Window & {
    __AVN_TRANSPORT__?: { fetch(input: URL, init: RequestInit): Promise<Response> }
  }).__AVN_TRANSPORT__
  return transport === undefined ? globalThis.fetch(input, init) : transport.fetch(input, init)
}

/**
 * The composition folder the settled call reported for the card.
 * @param meta - the result's presentation metadata.
 * @returns the absolute folder, or undefined when the call carried none.
 */
function compositionDir(meta: unknown): string | undefined {
  if (typeof meta !== 'object' || meta === null || !('compositionDir' in meta)) return undefined
  return typeof meta.compositionDir === 'string' ? meta.compositionDir : undefined
}

/**
 * The stored film the settled call reported: the composition bundled into one document, which plays on a Host
 * that lacks the folder.
 * @param meta - the result's presentation metadata.
 * @returns the film's attachment id and name, or undefined when the call stored none.
 */
function storedFilm(meta: unknown): { id: string; name: string } | undefined {
  if (typeof meta !== 'object' || meta === null || !('film' in meta)) return undefined
  const film = meta.film
  if (typeof film !== 'object' || film === null || !('attachmentId' in film) || typeof film.attachmentId !== 'string') return undefined
  return { id: film.attachmentId, name: 'name' in film && typeof film.name === 'string' ? film.name : 'film.html' }
}

/**
 * The film length the settled call reported.
 * @param meta - the result's presentation metadata.
 * @returns the length in seconds, or undefined for a call that reported none.
 */
function filmLength(meta: unknown): number | undefined {
  if (typeof meta !== 'object' || meta === null || !('durationSeconds' in meta)) return undefined
  return typeof meta.durationSeconds === 'number' ? meta.durationSeconds : undefined
}

/**
 * Read a Host failure's message from a JSON `message` field or a plain-text body.
 * @param response - the failed response.
 * @returns the message; empty when the body carries none, which the error dialog shows as its own no-detail line.
 */
async function failureText(response: Response): Promise<string> {
  const text = await response.text()
  try {
    const body = JSON.parse(text) as { message?: unknown }
    if (typeof body.message === 'string') return body.message
  } catch {
    // A plain-text body is the message itself.
  }
  return text
}

/**
 * The folder a call names, read from its own `composition` argument so the running and settled forms of one call
 * agree from the call's first frame. Relative folders are anchored at the Session's workspace root.
 * @param argsRaw - the call's arguments as the model sent them.
 * @param cwd - the Session's workspace root, when known.
 * @returns a normalized folder key, or undefined when the arguments name none.
 */
function compositionArg(argsRaw: string, cwd: string | undefined): string | undefined {
  let composition: unknown
  try {
    composition = (JSON.parse(argsRaw) as { composition?: unknown }).composition
  } catch {
    // Unreadable arguments name no folder; the card then keys on the settled result's folder.
    return undefined
  }
  if (typeof composition !== 'string' || composition.trim() === '') return undefined
  const path = composition.trim().replaceAll('\\', '/')
  const absolute = path.startsWith('/') || /^[A-Za-z]:\//.test(path)
  const joined = absolute || cwd === undefined ? path : `${cwd.replaceAll('\\', '/')}/${path}`
  const parts: string[] = []
  for (const part of joined.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return `${joined.startsWith('/') ? '/' : ''}${parts.join('/')}`
}

/**
 * Every mounted `show_motion` card's claim on its session and composition folder, by its position in the
 * conversation. Every card plays the folder's current files, so only the newest claim stays a live player. A
 * card already settled when it mounts claims at once; one that runs while on screen claims only once its film is
 * ready, so the film it replaces keeps playing through the render, and a call that fails never replaces it. A
 * card releases its claim when it unmounts, which also keeps the map to the cards on screen.
 */
const claims = new Map<string, Map<string, number>>()
const newestListeners = new Set<() => void>()

/** Notify every card that the newest claim of some folder may have changed. */
function publishNewest(): void {
  for (const listener of newestListeners) listener()
}

/**
 * Record a card's claim on a folder.
 * @param key - session and folder.
 * @param callId - the call.
 * @param seq - the call's position in the conversation.
 * @returns the disposer releasing the claim.
 */
function claim(key: string, callId: string, seq: number): () => void {
  let folder = claims.get(key)
  if (folder === undefined) {
    folder = new Map()
    claims.set(key, folder)
  }
  folder.set(callId, seq)
  publishNewest()
  return () => {
    const current = claims.get(key)
    if (current?.get(callId) !== seq) return
    current.delete(callId)
    if (current.size === 0) claims.delete(key)
    publishNewest()
  }
}

/**
 * The newest claim on a folder.
 * @param key - session and folder.
 * @returns the call id holding the highest position, or undefined when nothing claims the folder.
 */
function newestClaim(key: string): string | undefined {
  let newest: string | undefined
  let top = -1
  for (const [callId, seq] of claims.get(key) ?? []) {
    if (seq > top) {
      top = seq
      newest = callId
    }
  }
  return newest
}

/**
 * Subscribe a card to newest-call changes.
 * @param listener - re-render trigger.
 * @returns unsubscribe.
 */
function subscribeNewest(listener: () => void): () => void {
  newestListeners.add(listener)
  return () => { newestListeners.delete(listener) }
}

/**
 * Render a compact loading row while the call runs or its film loads, then the live film with its playback and
 * export chrome, or the call's failure. Once a later call for the same folder has its film ready, this card folds
 * into an "Earlier version" line that opens this call's stored film.
 * @param props - atomic call, workspace root, and Imagine translator.
 * @returns the film card retained at this call's transcript position.
 */
export function MotionToolView({ block, cwd, sessionId, t }: ToolCallViewProps & PropsLocale<'imagine'>) {
  const settled = 'kind' in block
  const failed = settled && block.isError
  const folder = settled && !failed ? compositionDir(block.meta) : undefined
  const film = settled && !failed ? storedFilm(block.meta) : undefined
  const callError = failed ? block.content.find(content => content.type === 'text') : undefined
  const argsRaw = settled ? block.call?.argsRaw : block.argsRaw
  const named = (argsRaw === undefined ? undefined : compositionArg(argsRaw, cwd)) ?? folder
  // A failed call shows its failure and leaves the previous film live.
  const key = named === undefined || failed ? undefined : `${String(sessionId)}\u0000${named}`
  // Whether this card watched its own call run, rather than mounting on a settled one from history.
  const [mountedRunning] = useState(!settled)
  // The film frame takes its size only once the player has a composition to show.
  const [ready, setReady] = useState(false)
  const [wasReady, setWasReady] = useState(false)
  useEffect(() => { if (ready) setWasReady(true) }, [ready])
  const claiming = key !== undefined && settled && (!mountedRunning || wasReady)
  const resultSeq = settled ? block.seq : 0
  useEffect(
    () => (claiming ? claim(key, block.callId, resultSeq) : undefined),
    [claiming, key, block.callId, resultSeq],
  )
  const newest = useSyncExternalStore(subscribeNewest, () => (key === undefined ? undefined : newestClaim(key)))
  const superseded = claiming && newest !== undefined && newest !== block.callId
  // Another card already shows a film from this folder while this one renders or loads.
  const replacing = !claiming && newest !== undefined
  const [earlierOpen, setEarlierOpen] = useState(false)
  // A live card plays the folder's current files; an opened earlier version plays the film its call stored.
  const source = superseded ? (earlierOpen ? 'stored' : undefined) : folder === undefined ? undefined : 'folder'
  const dir = source === 'folder' ? folder : undefined

  const stage = useRef<HTMLDivElement>(null)
  const [html, setHtml] = useState<string | undefined>(undefined)
  const [media, setMedia] = useState<PlayerElement | null>(null)
  const [ratio, setRatio] = useState(DEFAULT_RATIO)
  const [loadError, setLoadError] = useState<string | undefined>(undefined)
  // The stored film's URL once it plays instead of the folder; the MP4 export then goes through the call.
  const [storedUrl, setStoredUrl] = useState<string | undefined>(undefined)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | undefined>(undefined)

  // The folder's current files, bundled by the Host into one document. Where this Host lacks the folder or the
  // preview route, the film the call stored, else the composition the Host rebuilds from this conversation's log.
  const filmId = film?.id
  const callId = block.callId
  useEffect(() => {
    if (source === undefined) return
    setHtml(undefined)
    setStoredUrl(undefined)
    setLoadError(undefined)
    const controller = new AbortController()
    const url = new URL('api/motion/preview', document.baseURI)
    if (dir !== undefined) url.searchParams.set('dir', dir)
    const elsewhere = async (preview: string): Promise<string> => {
      const sources: URL[] = []
      if (filmId !== undefined) {
        const fileUrl = new URL('api/attachment-file', document.baseURI)
        fileUrl.searchParams.set('sessionId', String(sessionId))
        fileUrl.searchParams.set('id', filmId)
        sources.push(fileUrl)
      }
      const replayUrl = new URL('api/motion/replay', document.baseURI)
      replayUrl.searchParams.set('sessionId', String(sessionId))
      replayUrl.searchParams.set('callId', callId)
      sources.push(replayUrl)
      let message = preview
      for (const source of sources) {
        const response = await hostFetch(source, { signal: controller.signal })
        if (response.ok) {
          setStoredUrl(source.href)
          return await response.text()
        }
        message = await failureText(response)
      }
      throw new Error(message)
    }
    const loaded = source === 'stored' || dir === undefined
      ? elsewhere('')
      : hostFetch(url, { signal: controller.signal })
        // 204: this Host serves no folders, so the film comes from elsewhere without a failure to report.
        .then(async response => response.status === 200 ? await response.text() : await elsewhere(await failureText(response)))
    loaded
      .then((text) => { setHtml(text) })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : String(error))
      })
    return () => { controller.abort() }
  }, [source, dir, filmId, sessionId, callId])

  // The player is created here rather than in JSX, which has no type for the custom element. Its frame drops
  // `allow-same-origin`, so the composition's scripts run in an opaque origin, apart from the app.
  useEffect(() => {
    const container = stage.current
    if (html === undefined || container === null) return
    const player = document.createElement('hyperframes-player') as PlayerElement
    player.setAttribute('sandbox-origin', 'opaque')
    player.setAttribute('srcdoc', html)
    player.addEventListener('ready', (event) => {
      const detail = (event as CustomEvent<{ compositionWidth?: number; compositionHeight?: number }>).detail
      const width = detail.compositionWidth ?? 0
      const height = detail.compositionHeight ?? 0
      if (width > 0 && height > 0) setRatio(width / height)
      setReady(true)
    })
    // The player reports a failed load as a CustomEvent named `error`, not a DOM ErrorEvent.
    player.addEventListener('error', (event: Event) => {
      setLoadError((event as CustomEvent<{ message?: string } | null>).detail?.message ?? '')
    })
    container.append(player)
    setMedia(player)
    return () => {
      player.remove()
      setMedia(null)
      setReady(false)
    }
  }, [html])

  const exportFilm = async (): Promise<void> => {
    if (dir === undefined) return
    setExporting(true)
    setExportError(undefined)
    try {
      const response = await hostFetch(new URL('api/motion/export', document.baseURI), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dir }),
      })
      if (!response.ok) throw new Error(await failureText(response))
      const film = await response.json() as { path: string }
      const url = new URL('api/motion/film', document.baseURI)
      url.searchParams.set('path', film.path)
      saveClip(url.href, film.path.split(/[\\/]/).pop() ?? 'film.mp4')
    } catch (error) {
      setExportError(error instanceof Error ? error.message : String(error))
    } finally {
      setExporting(false)
    }
  }

  // Where this Host lacks the folder, the Host renders the film the conversation names in the caller's own
  // workspace and returns the MP4; a Host where the folder is absent too leaves the stored page to save.
  const exportCall = async (): Promise<void> => {
    setExporting(true)
    setExportError(undefined)
    try {
      const ask = (): Promise<Response> => hostFetch(new URL('api/motion/export-call', document.baseURI), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: String(sessionId), callId: block.callId }),
      })
      // 202 means the render is still running; asking again joins it.
      let response = await ask()
      while (response.status === 202) response = await ask()
      if (response.status === 404 && storedUrl !== undefined) {
        saveClip(`${storedUrl}&download=1`, film?.name ?? 'film.html')
        return
      }
      if (!response.ok) throw new Error(await failureText(response))
      const name = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') ?? '')?.[1] ?? 'film.mp4'
      const url = URL.createObjectURL(await response.blob())
      saveClip(url, name)
      // The browser reads the object URL when the download starts.
      setTimeout(() => { URL.revokeObjectURL(url) }, 60_000)
    } catch (error) {
      setExportError(error instanceof Error ? error.message : String(error))
    } finally {
      setExporting(false)
    }
  }

  const showError = failed || loadError !== undefined
  // Until the player is ready the card is one compact row: a running call, or a film still on its way from the
  // folder, the stored copy, or the replay, never reserves a player-sized frame.
  const loading = !showError && (!settled || (source !== undefined && !ready))
  const earlier = superseded && 'kind' in block ? earlierLine(block.time, filmLength(block.meta), t) : undefined
  const earlierToggle = earlier === undefined ? null : (
    <button
      type="button"
      className={css.motionEarlier}
      aria-expanded={earlierOpen}
      onClick={() => { setEarlierOpen(open => !open) }}
    >
      {earlierOpen ? <IconLucideChevronDown /> : <IconLucideChevronRight />}
      <span>{earlier}</span>
    </button>
  )
  // The newest card for the same folder below shows the current film; an earlier one keeps one line to reopen it.
  if (superseded && !earlierOpen) {
    return <figure className={css.root} data-motion-call={block.callId} data-state="earlier">{earlierToggle}</figure>
  }
  return (
    <figure className={css.root} data-motion-call={block.callId} data-state={showError ? 'error' : loading ? 'running' : 'settled'}>
      {earlierToggle}
      {loading && (
        <span className={css.motionPending} role="status">
          <Spinner />
          <span>{replacing ? t('motion.updating') : t('motion.pending')}</span>
        </span>
      )}
      <div className={css.frames} data-frames={1} data-pending={loading ? '' : undefined}>
        <div
          className={css.frame}
          data-generated-video-frame=""
          data-failed={showError ? '' : undefined}
          data-orientation={ratio < 1 ? 'portrait' : 'landscape'}
          style={{ aspectRatio: String(ratio) }}
        >
          {showError ? (
            <ErrorDetailControl
              title={t('motion.failed')}
              message={loadError ?? (callError?.type === 'text' ? callError.text : '')}
              t={t}
            />
          ) : source !== undefined ? (
            <MediaPlayer
              media={media}
              onDownload={() => { void (storedUrl === undefined ? exportFilm() : exportCall()) }}
              busy={exporting}
              labels={{ ...videoPlayerLabels(t), download: t('motion.export') }}
            >
              <div ref={stage} className={css.motionStage} role="img" aria-label={t('motion.label')} />
            </MediaPlayer>
          ) : null}
          {exportError !== undefined && !showError && (
            <ErrorDetailControl title={t('motion.exportFailed')} message={exportError} t={t} />
          )}
        </div>
      </div>
    </figure>
  )
}

/**
 * The line an earlier version folds into: when its call settled and, when known, how long its film runs.
 * @param time - Unix epoch ms the call settled at.
 * @param length - film length in seconds.
 * @param t - Imagine translator.
 * @returns the line's text.
 */
function earlierLine(time: number, length: number | undefined, t: PropsLocale<'imagine'>['t']): string {
  const clock = new Date(time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  if (length === undefined) return t('motion.earlier', { time: clock })
  return t('motion.earlierLength', { time: clock, length: String(Math.round(length)) })
}
