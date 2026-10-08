/** In-place generated video backed by the existing atomic tool-call node. @module */
import { useState } from 'react'
import { Spinner } from '@aeven/client-ui-primitives'
import type { ToolCallViewProps } from '@aeven/client-ui-tool/client'
import type { PropsLocale } from '@aeven/client-ui-slots'
// Type-only: pulls the session-scoped standard props (`sessionId`).
import type {} from '@aeven/client-ui-session/client'
import type {} from './locales.ts'
import { ImagePromptControl } from './ImageToolView.tsx'
import { VideoPlayer } from './VideoPlayer.tsx'
import css from './ImageToolView.module.css'

/** Aspect ratios a call may name, as `width / height`; `adaptive` follows the first frame and is drawn landscape. */
const RATIOS: Readonly<Record<string, number>> = {
  '16:9': 16 / 9,
  '4:3': 4 / 3,
  '1:1': 1,
  '3:4': 3 / 4,
  '9:16': 9 / 16,
  '21:9': 21 / 9,
}

/**
 * The name a saved clip takes: the attachment's own, else the first bytes of
 * its content digest plus the extension its media type names.
 * @param attachment - the stored clip's durable reference.
 * @returns the file name the clip is saved under.
 */
function clipFileName(attachment: { attachmentId: string; mediaType: string; name?: string | undefined }): string {
  if (attachment.name !== undefined && attachment.name !== '') return attachment.name
  const digest = attachment.attachmentId.replace(/^sha256:/, '').slice(0, 12)
  return `${digest}.${attachment.mediaType.split('/')[1] ?? 'mp4'}`
}

/**
 * Render a generation placeholder, the finished clip with its playback
 * controls, or the call's failure.
 * @param props - atomic call, current session, and Imagine translator.
 * @returns the video frame retained at this call's transcript position.
 */
export function VideoToolView({ block, sessionId, t }: ToolCallViewProps & PropsLocale<'imagine'>) {
  const settled = 'kind' in block
  const argsRaw = settled ? block.call?.argsRaw : block.argsRaw
  let prompt = ''
  let requested = RATIOS['16:9']!
  try {
    const args: unknown = JSON.parse(argsRaw ?? '{}')
    if (typeof args === 'object' && args !== null) {
      if ('prompt' in args && typeof args.prompt === 'string') prompt = args.prompt
      if ('aspect_ratio' in args && typeof args.aspect_ratio === 'string') requested = RATIOS[args.aspect_ratio] ?? requested
    }
  } catch {
    // Invalid tool arguments have no generation prompt; the failure remains visible.
  }
  // The frame holds the requested shape while the clip renders, then the
  // shape the clip actually has once its metadata loads.
  const [loaded, setLoaded] = useState<number | undefined>(undefined)
  const ratio = loaded ?? requested
  const failed = settled && block.isError
  const file = settled && !failed
    ? block.content.flatMap(content => content.type === 'file' ? [content.attachment] : [])[0]
    : undefined
  const error = failed ? block.content.find(content => content.type === 'text') : undefined
  let src: string | undefined
  if (file !== undefined) {
    const url = new URL('api/attachment-file', document.baseURI)
    url.searchParams.set('sessionId', String(sessionId))
    url.searchParams.set('id', String(file.attachmentId))
    src = url.href
  }
  return (
    <figure className={css.root} data-generated-video-call={block.callId} data-state={failed ? 'error' : settled ? 'settled' : 'running'}>
      <div className={css.frames} data-frames={1}>
        <div
          className={css.frame}
          data-generated-video-frame=""
          data-orientation={ratio < 1 ? 'portrait' : 'landscape'}
          style={{ aspectRatio: String(ratio) }}
        >
          {failed ? (
            <div className={css.error} role="alert">
              <span>{t('video.failed')}</span>
              {error?.type === 'text' && <span>{error.text}</span>}
            </div>
          ) : src !== undefined ? (
            <VideoPlayer
              src={src}
              label={t('video.label')}
              saveName={file === undefined ? 'video.mp4' : clipFileName(file)}
              t={t}
              onRatio={ratio => { setLoaded(ratio) }}
            />
          ) : settled ? (
            <span className={css.status}>{t('video.unavailable')}</span>
          ) : null}
          {prompt !== '' && <ImagePromptControl prompt={prompt} t={t} />}
          {!settled && (
            <span className={css.loader} role="status" aria-label={t('video.generating')}>
              <Spinner />
            </span>
          )}
        </div>
      </div>
    </figure>
  )
}
