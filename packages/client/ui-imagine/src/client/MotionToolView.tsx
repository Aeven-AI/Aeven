/**
 * A motion film shown live at its `show_motion` call: the composition plays in the HyperFrames player under the
 * product's own clip chrome, and the save menu exports it to an MP4 the browser downloads. @module
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
// Side-effect import: registers the `hyperframes-player` custom element. Client modules load as one bundle each,
// so the player ships inside this module rather than as a lazily loaded chunk.
import '@hyperframes/player'
import { MediaPlayer, Spinner, saveClip, videoPlayerLabels, type ClipMedia } from '@aeven/client-ui-primitives'
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
 * The newest `show_motion` call per session and composition folder, by its position in the conversation. Every
 * card plays the folder's current files, so only the newest call stays a live player; earlier calls for the same
 * folder would show the same film.
 */
const newestCalls = new Map<string, { callId: string; seq: number }>()
const newestListeners = new Set<() => void>()

/**
 * Record a settled call as the newest for its folder when nothing later is recorded.
 * @param key - session and folder.
 * @param callId - the call.
 * @param seq - the call's position in the conversation.
 */
function claimNewest(key: string, callId: string, seq: number): void {
  const current = newestCalls.get(key)
  if (current !== undefined && current.seq >= seq) return
  newestCalls.set(key, { callId, seq })
  for (const listener of newestListeners) listener()
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
 * Render a running call's loader, the live film with its playback and export chrome, or the call's failure.
 * @param props - atomic call and Imagine translator.
 * @returns the film frame retained at this call's transcript position.
 */
export function MotionToolView({ block, sessionId, t }: ToolCallViewProps & PropsLocale<'imagine'>) {
  const settled = 'kind' in block
  const failed = settled && block.isError
  const folder = settled && !failed ? compositionDir(block.meta) : undefined
  const film = settled && !failed ? storedFilm(block.meta) : undefined
  const callError = failed ? block.content.find(content => content.type === 'text') : undefined
  const key = folder === undefined ? undefined : `${String(sessionId)}\u0000${folder}`
  const seq = settled ? block.seq : -1
  useEffect(() => {
    if (key !== undefined) claimNewest(key, block.callId, seq)
  }, [key, block.callId, seq])
  const newest = useSyncExternalStore(subscribeNewest, () => (key === undefined ? undefined : newestCalls.get(key)?.callId))
  const superseded = key !== undefined && newest !== undefined && newest !== block.callId
  // A superseded card neither fetches nor plays; the newest card below it shows the folder's current film.
  const dir = superseded ? undefined : folder

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
    if (dir === undefined) return
    const controller = new AbortController()
    const url = new URL('api/motion/preview', document.baseURI)
    url.searchParams.set('dir', dir)
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
    hostFetch(url, { signal: controller.signal })
      .then(async response => response.ok ? await response.text() : await elsewhere(await failureText(response)))
      .then((text) => { setHtml(text) })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : String(error))
      })
    return () => { controller.abort() }
  }, [dir, filmId, sessionId, callId])

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
  const loading = !settled || (dir !== undefined && media === null && !showError)
  if (superseded) {
    return (
      <figure className={css.root} data-motion-call={block.callId} data-state="superseded">
        <p className={css.motionSuperseded}>{t('motion.superseded')}</p>
      </figure>
    )
  }
  return (
    <figure className={css.root} data-motion-call={block.callId} data-state={showError ? 'error' : settled ? 'settled' : 'running'}>
      <div className={css.frames} data-frames={1}>
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
          ) : dir !== undefined ? (
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
          {loading && (
            <span className={css.loader} role="status" aria-label={t('motion.label')}>
              <Spinner />
            </span>
          )}
        </div>
      </div>
    </figure>
  )
}
