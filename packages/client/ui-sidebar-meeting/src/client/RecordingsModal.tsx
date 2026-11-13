/**
 * The saved-recordings modal, laid out like the Settings detail pages: a header row of black 28px
 * discs on the card's 24px inset (back on the left of a recording, close on the right), then the
 * content on the same inset. The list shows each recording's title on one line; a recording shows
 * its date and length, its audio, its transcript, and round actions to delete it, copy it, or add it
 * to the chat. A deletion asks first in the standard Aeven confirmation dialog.
 */
import type { ReactNode } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  AudioPlayer, Button, IconChevronLeftOutline14, IconCloseOutline16, IconLucideCheck, IconLucideCopy, IconLucideTrash, Modal, Spinner,
  Tooltip,
} from '@aeven/client-ui-primitives'
import type { RecordingId, RecordingSummary, SavedRecording } from '@aeven/api-speech-to-text/types'
import { formatDate, formatDuration, groupTurns, speakerLabel, transcriptText, type MeetingTranslate } from './format.ts'
import { MessageSquarePlus } from './icons.tsx'
import type { RecordingLibrary } from './library.ts'
import css from './RecordingsModal.module.css'

/** What the modal shows. */
type View = { readonly kind: 'list' } | { readonly kind: 'recording'; readonly id: RecordingId } | { readonly kind: 'delete'; readonly recording: SavedRecording }

/** Props of the saved-recordings modal. */
export interface RecordingsModalProps {
  readonly t: MeetingTranslate
  readonly library: RecordingLibrary
  readonly open: boolean
  readonly onClose: () => void
  /** Append text to the pane's session composer. */
  readonly addToChat: (text: string) => void
}

/** Scroll-edge slack below which a pixel of overflow is not worth a fade. */
const EDGE_TOLERANCE = 1

/**
 * Render the saved-recordings modal.
 * @param props - dictionary, library, and open state.
 * @returns the modal, or null while closed.
 */
export function RecordingsModal({ t, library, open, onClose, addToChat }: RecordingsModalProps): ReactNode {
  const [view, setView] = useState<View>({ kind: 'list' })
  useEffect(() => { if (open) setView({ kind: 'list' }) }, [open])

  if (view.kind === 'delete') {
    return (
      <Modal open={open} onClose={onClose} title={t('recordings.deleteTitle')} closeLabel={t('recordings.close')}
        description={t('recordings.deleteBody', { title: formatDate(view.recording.startedAt) })}
        footer={<DeleteActions t={t} onCancel={() => { setView({ kind: 'recording', id: view.recording.id }) }}
          onConfirm={async () => { await library.remove(view.recording.id); setView({ kind: 'list' }) }} />} />
    )
  }
  return (
    <Modal open={open} onClose={onClose} headless title={t('recordings.title')} width="min(560px, calc(100vw - 32px))">
      <div className={css.card}>
        <header className={css.header}>
          {view.kind === 'list'
            ? <h2 className={css.heading}>{t('recordings.title')}</h2>
            : (
              <button type="button" className={css.disc} aria-label={t('recordings.back')} title={t('recordings.back')}
                onClick={() => { setView({ kind: 'list' }) }}>
                <IconChevronLeftOutline14 />
              </button>
            )}
          <button type="button" className={css.disc} aria-label={t('recordings.close')} title={t('recordings.close')} onClick={onClose}>
            <IconCloseOutline16 size={14} />
          </button>
        </header>
        {view.kind === 'list'
          ? <List t={t} library={library} onOpen={(id) => { setView({ kind: 'recording', id }) }} />
          : <Detail t={t} library={library} id={view.id}
            onDelete={(recording) => { setView({ kind: 'delete', recording }) }}
            addToChat={(text) => { addToChat(text); onClose() }} />}
      </div>
    </Modal>
  )
}

/** The account's recordings, newest first, one title per line. */
function List({ t, library, onOpen }: { t: MeetingTranslate; library: RecordingLibrary; onOpen: (id: RecordingId) => void }): ReactNode {
  const [items, setItems] = useState<readonly RecordingSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    library.list().then(
      (list) => { if (live) setItems(list) },
      (failure: unknown) => { if (live) setError(failure instanceof Error ? failure.message : String(failure)) },
    )
    return () => { live = false }
  }, [library])

  if (error !== null) return <div className={css.body}><p className={css.error}>{t('recordings.failed', { message: error })}</p></div>
  if (items === null) return <div className={css.body}><div className={css.loading}><Spinner /></div></div>
  if (items.length === 0) return <div className={css.body}><p className={css.empty}>{t('recordings.empty')}</p></div>
  return (
    <div className={css.body}>
      <ScrollFade className={css.list}>
        {items.map(item => (
          <button key={item.id} type="button" className={css.row} title={item.title} onClick={() => { onOpen(item.id) }}>{item.title}</button>
        ))}
      </ScrollFade>
    </div>
  )
}

/** One recording: date and length, audio, transcript, and actions. */
function Detail({ t, library, id, onDelete, addToChat }: {
  t: MeetingTranslate
  library: RecordingLibrary
  id: RecordingId
  onDelete: (recording: SavedRecording) => void
  addToChat: (text: string) => void
}): ReactNode {
  const [recording, setRecording] = useState<SavedRecording | null>(null)
  const [audio, setAudio] = useState<{ url: string | undefined } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const unmounted = new AbortController()
    // Read through a function: the state changes across the awaits below.
    const gone = (): boolean => unmounted.signal.aborted
    let url: string | undefined
    setRecording(null)
    setAudio(null)
    library.get(id).then(async (loaded) => {
      if (gone()) return
      setRecording(loaded)
      url = await library.audioUrl(loaded)
      if (!gone()) setAudio({ url })
      else if (url !== undefined) URL.revokeObjectURL(url)
    }).catch((failure: unknown) => {
      if (!gone()) setError(failure instanceof Error ? failure.message : String(failure))
    })
    return () => {
      unmounted.abort()
      if (url !== undefined) URL.revokeObjectURL(url)
    }
  }, [library, id])

  useEffect(() => {
    if (!copied) return undefined
    const timer = setTimeout(() => { setCopied(false) }, 1500)
    return () => { clearTimeout(timer) }
  }, [copied])

  if (error !== null) return <div className={css.body}><p className={css.error}>{t('recordings.failed', { message: error })}</p></div>
  if (recording === null) return <div className={css.body}><div className={css.loading}><Spinner /></div></div>

  const text = (): string => transcriptText(t, recording.startedAt, recording.durationMs, recording.segments)
  const labels = { play: t('audio.play'), pause: t('audio.pause'), mute: t('audio.mute'), unmute: t('audio.unmute'), seek: t('audio.seek') }

  return (
    <div className={css.body}>
      <div className={css.titleRow}>
        <h2 className={css.heading}>{formatDate(recording.startedAt)}</h2>
        <span className={css.duration}>{formatDuration(recording.durationMs)}</span>
      </div>
      {recording.audio !== undefined
        ? audio !== null && audio.url === undefined
          ? <p className={css.note}>{t('recordings.audioAway')}</p>
          : (
            <div className={css.player}>
              <AudioPlayer src={audio?.url ?? null} label={formatDate(recording.startedAt)} labels={labels} />
            </div>
          )
        : <p className={css.note}>{t('recordings.audioNone')}</p>}
      <ScrollFade className={css.transcript}>
        {groupTurns(recording.segments).map(turn => (
          <article key={turn.key} className={css.turn} data-speaker={turn.speaker}>
            <div className={css.turnHead}>
              <span className={css.speaker}>{speakerLabel(t, turn.speaker, turn.voice)}</span>
              <span className={css.offset}>{formatDuration(turn.offsetMs)}</span>
            </div>
            <p className={css.turnText}>{turn.text}</p>
          </article>
        ))}
      </ScrollFade>
      <div className={css.actions}>
        <Tooltip label={t('recordings.delete')} side="top">
          <button type="button" className={css.iconButton} aria-label={t('recordings.delete')} onClick={() => { onDelete(recording) }}>
            <IconLucideTrash />
          </button>
        </Tooltip>
        <Tooltip label={t(copied ? 'copied' : 'copy')} side="top">
          <button type="button" className={css.iconButton} aria-label={t(copied ? 'copied' : 'copy')}
            onClick={() => { void navigator.clipboard.writeText(text()).then(() => { setCopied(true) }, () => undefined) }}>
            {copied ? <IconLucideCheck /> : <IconLucideCopy />}
          </button>
        </Tooltip>
        <Tooltip label={t('addToChat')} side="top">
          <button type="button" className={css.iconButton} aria-label={t('addToChat')} onClick={() => { addToChat(text()) }}>
            <MessageSquarePlus />
          </button>
        </Tooltip>
      </div>
    </div>
  )
}

/**
 * A scrolling region without a scrollbar whose top and bottom edges fade only while more of its
 * content lies beyond them.
 */
function ScrollFade({ className, children }: { className: string | undefined; children: ReactNode }): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const [fade, setFade] = useState({ top: false, bottom: false })
  const measure = (): void => {
    const box = ref.current
    if (box === null) return
    const top = box.scrollTop > EDGE_TOLERANCE
    const bottom = box.scrollTop + box.clientHeight < box.scrollHeight - EDGE_TOLERANCE
    setFade(current => current.top === top && current.bottom === bottom ? current : { top, bottom })
  }
  useLayoutEffect(measure)
  useEffect(() => {
    const box = ref.current
    if (box === null) return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(box)
    return () => { observer.disconnect() }
  }, [])
  return (
    <div ref={ref} className={className} onScroll={measure}
      data-fade-top={fade.top || undefined} data-fade-bottom={fade.bottom || undefined}>
      {children}
    </div>
  )
}

/** Cancel and confirm for a deletion; confirm stays busy until the deletion settled. */
function DeleteActions({ t, onCancel, onConfirm }: {
  t: MeetingTranslate
  onCancel: () => void
  onConfirm: () => Promise<void>
}): ReactNode {
  const [busy, setBusy] = useState(false)
  return (
    <>
      <Button variant="ghost" onClick={onCancel} disabled={busy}>{t('recordings.cancel')}</Button>
      <Button variant="primary" disabled={busy} onClick={() => {
        setBusy(true)
        void onConfirm().finally(() => { setBusy(false) })
      }}>{t('recordings.confirmDelete')}</Button>
    </>
  )
}
