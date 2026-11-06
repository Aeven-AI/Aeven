/**
 * A motion film shown live at its `show_motion` call: the composition plays in the HyperFrames player under the
 * product's own clip chrome, and the save menu exports it to an MP4 the browser downloads. @module
 */
import { useEffect, useRef, useState } from 'react'
// Side-effect import: registers the `hyperframes-player` custom element. Client modules load as one bundle each,
// so the player ships inside this module rather than as a lazily loaded chunk.
import '@hyperframes/player'
import { MediaPlayer, Spinner, saveClip, videoPlayerLabels, type ClipMedia } from '@aeven/client-ui-primitives'
import type { ToolCallViewProps } from '@aeven/client-ui-tool/client'
import type { PropsLocale } from '@aeven/client-ui-slots'
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
 * Render a running call's loader, the live film with its playback and export chrome, or the call's failure.
 * @param props - atomic call and Imagine translator.
 * @returns the film frame retained at this call's transcript position.
 */
export function MotionToolView({ block, t }: ToolCallViewProps & PropsLocale<'imagine'>) {
  const settled = 'kind' in block
  const failed = settled && block.isError
  const dir = settled && !failed ? compositionDir(block.meta) : undefined
  const callError = failed ? block.content.find(content => content.type === 'text') : undefined

  const stage = useRef<HTMLDivElement>(null)
  const [html, setHtml] = useState<string | undefined>(undefined)
  const [media, setMedia] = useState<PlayerElement | null>(null)
  const [ratio, setRatio] = useState(DEFAULT_RATIO)
  const [loadError, setLoadError] = useState<string | undefined>(undefined)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | undefined>(undefined)

  // The folder's current files, bundled by the Host into one document.
  useEffect(() => {
    if (dir === undefined) return
    const controller = new AbortController()
    const url = new URL('api/motion/preview', document.baseURI)
    url.searchParams.set('dir', dir)
    hostFetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(await failureText(response))
        setHtml(await response.text())
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : String(error))
      })
    return () => { controller.abort() }
  }, [dir])

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

  const showError = failed || loadError !== undefined
  const loading = !settled || (dir !== undefined && media === null && !showError)
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
              onDownload={() => { void exportFilm() }}
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
