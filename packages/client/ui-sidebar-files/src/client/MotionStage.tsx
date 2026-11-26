/**
 * A Motion film in the Files pane: the composition a folder holds, played in the HyperFrames player under the
 * product's own clip chrome, as the chat's film card plays it, with Export MP4 in its save action. The film comes
 * from this Host's bundle of the folder, or from the film's stored copy where this Host lacks the folder; a
 * stored copy saves as its page, because only a Host holding the folder renders the MP4.
 */
import { useEffect, useRef, useState } from 'react'
// Side-effect import: registers the `hyperframes-player` custom element.
import '@hyperframes/player'
import clsx from 'clsx'
import { MediaPlayer, saveClip, videoPlayerLabels, type ClipMedia } from '@aeven/client-ui-primitives'
import type { TranslateNS } from '@aeven/client-ui-slots'
import css from './FilesPane.module.css'

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

/** Where the film on show came from: the folder this Host bundled, or the stored copy at its URL. */
type FilmSource = { readonly kind: 'folder' } | { readonly kind: 'stored'; readonly url: string }

/**
 * Play the composition in `folder`.
 * @param props - the composition folder, the film's stored copy when known, the stage class, the film's name and the translator.
 * @returns the film with its playback chrome, centred in the preview area.
 */
export function MotionStage({ folder, copy, className, title, t }: {
  folder: string
  copy: string | undefined
  className: string | undefined
  title: string
  t: TranslateNS<'sidebarFiles'>
}) {
  const stage = useRef<HTMLDivElement>(null)
  const [film, setFilm] = useState<{ html: string; source: FilmSource } | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  const [media, setMedia] = useState<PlayerElement | null>(null)
  const [ratio, setRatio] = useState(DEFAULT_RATIO)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | undefined>(undefined)

  useEffect(() => {
    setFilm(undefined)
    setFailed(false)
    const controller = new AbortController()
    void (async () => {
      const preview = new URL('api/motion/preview', document.baseURI)
      preview.searchParams.set('dir', folder)
      // The preview route answers 204 on a Host that serves no folders.
      const bundled = await hostFetch(preview, { signal: controller.signal })
      if (bundled.status === 200) return { html: await bundled.text(), source: { kind: 'folder' } as const }
      if (copy === undefined) return undefined
      const stored = await hostFetch(new URL(copy, document.baseURI), { signal: controller.signal })
      return stored.ok ? { html: await stored.text(), source: { kind: 'stored', url: copy } as const } : undefined
    })().then((loaded) => {
      if (controller.signal.aborted) return
      if (loaded === undefined) setFailed(true)
      else setFilm(loaded)
    }, () => { if (!controller.signal.aborted) setFailed(true) })
    return () => { controller.abort() }
  }, [folder, copy])

  // Created here rather than in JSX, which has no type for the custom element. Its frame drops
  // `allow-same-origin`, so the composition's scripts run in an opaque origin, apart from the app.
  const html = film?.html
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
    container.append(player)
    setMedia(player)
    return () => {
      player.remove()
      setMedia(null)
    }
  }, [html])

  /** Render the folder to an MP4 on this Host and save it; a stored copy saves as its page. */
  const exportFilm = async (): Promise<void> => {
    if (film === undefined) return
    if (film.source.kind === 'stored') {
      const url = new URL(film.source.url, document.baseURI)
      url.searchParams.set('download', '1')
      saveClip(url.href, title)
      return
    }
    setExporting(true)
    setExportError(undefined)
    try {
      const ask = (): Promise<Response> => hostFetch(new URL('api/motion/export', document.baseURI), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dir: folder }),
      })
      // 202 means the render is still running; asking again joins it.
      let response = await ask()
      while (response.status === 202) response = await ask()
      if (!response.ok) throw new Error((await response.text()) || String(response.status))
      const rendered = await response.json() as { path: string }
      const url = new URL('api/motion/film', document.baseURI)
      url.searchParams.set('path', rendered.path)
      saveClip(url.href, rendered.path.split(/[\\/]/).pop() ?? 'film.mp4')
    } catch (error) {
      setExportError(error instanceof Error ? error.message : String(error))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className={clsx(className, css.motionArea)} aria-busy={film === undefined && !failed}>
      {failed
        ? <div className={css.note}>{t('motion.unavailable')}</div>
        : (
          <div className={css.motionFrame} style={{ aspectRatio: String(ratio) }}>
            <MediaPlayer
              media={media}
              onDownload={() => { void exportFilm() }}
              busy={exporting}
              labels={{ ...videoPlayerLabels(t), download: t('motion.export') }}
            >
              <div ref={stage} className={css.motionStage} role="img" aria-label={title} />
            </MediaPlayer>
          </div>
        )}
      {exportError !== undefined && <div className={css.note}>{t('motion.exportFailed', { message: exportError })}</div>}
    </div>
  )
}
