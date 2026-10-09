/** Draft and message attachment tray: image thumbnails and file tiles in wrapping rows. */

import { useState } from 'react'
import clsx from 'clsx'
import { Tooltip } from '@aeven/client-ui-primitives'
import { FileTypeIcon, UploadErrorIcon, UploadRemoveIcon, UploadSpinnerIcon, fileIconKind } from './FileIcons.tsx'
import css from './UploadTray.module.css'

/** One image tile; strings arrive resolved (zero-cordis atom). */
export interface UploadTrayImageItem {
  kind: 'image'
  /** Stable identity for the React key. */
  id: string
  /** Object, data, or cached URL rendered as the thumbnail; null while a durable image resolves. */
  previewUrl: string | null
  /** Whether resolving the thumbnail URL failed; the tile then shows the error state and opening it retries. */
  failed?: boolean
  alt: string
  /** Accessible label of the tile's remove control. */
  removeLabel: string
}

/** One file tile; strings arrive resolved. */
export interface UploadTrayFileItem {
  kind: 'file'
  id: string
  /** Display name including its extension. */
  name: string
  mediaType: string
  status: 'uploading' | 'ready' | 'error'
  /** Accessible label of the tile's open action. */
  openLabel: string
  /** Accessible label of the tile's remove control. */
  removeLabel: string
}

/** One tray tile. */
export type UploadTrayItem = UploadTrayImageItem | UploadTrayFileItem

/** Tray-level strings the owner resolves from its own locale namespace. */
export interface UploadTrayLabels {
  /** Accessible name of the tray group. */
  group: string
  /** Tooltip of every remove control. */
  remove: string
  /** Label shown on a failed tile. */
  error: string
}

/** Display title: the name without its final extension. */
function titleOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

/**
 * Wrapping attachment tray. Images come first, then files, each group in
 * owner order. An uploading tile shows a spinner; a failed tile shows a
 * warning and "Error"; a ready file shows its type icon and name; an image
 * fades in over its spinner once the thumbnail loads.
 *
 * @param props.items - tiles in owner order.
 * @param props.labels - resolved tray strings.
 * @param props.onOpen - open one ready tile.
 * @param props.onRemove - remove one tile; absent renders a read-only tray.
 * @param props.align - horizontal tile placement.
 * @param props.variant - composer tray or sent-message tray.
 * @returns the tray group.
 */
export function UploadTray<T extends UploadTrayItem>({ items, labels, onOpen, onRemove, align = 'start', variant = 'composer' }: {
  items: readonly T[]
  labels: UploadTrayLabels
  onOpen: (item: T) => void
  onRemove?: ((item: T) => void) | undefined
  align?: 'start' | 'end'
  /** Composer tray above the editor, or the tray of a sent message. */
  variant?: 'composer' | 'message'
}) {
  const ordered = [...items.filter(item => item.kind === 'image'), ...items.filter(item => item.kind === 'file')]
  return (
    <div
      className={clsx(css.tray, variant === 'message' && css.message, align === 'end' && css.end)}
      role="group"
      aria-label={labels.group}
    >
      {ordered.map(item => (
        <div
          key={item.id}
          className={clsx(css.tile, item.kind === 'image' ? css.image : css[item.status])}
        >
          {item.kind === 'image'
            ? <ImageTile item={item} labels={labels} onOpen={() => { onOpen(item) }} />
            : <FileTile item={item} labels={labels} onOpen={() => { onOpen(item) }} />}
          {onRemove !== undefined && (
            <Tooltip label={labels.remove} side="top">
              <button
                type="button"
                className={css.remove}
                aria-label={item.removeLabel}
                onClick={(event) => {
                  event.stopPropagation()
                  onRemove(item)
                }}
              >
                <span className={css.removeCircle}>
                  <span className={css.removeIcon}><UploadRemoveIcon /></span>
                </span>
              </button>
            </Tooltip>
          )}
        </div>
      ))}
    </div>
  )
}

function ImageTile({ item, labels, onOpen }: {
  item: UploadTrayImageItem
  labels: UploadTrayLabels
  onOpen: () => void
}) {
  const [previewUrl, setPreviewUrl] = useState(item.previewUrl)
  const [loaded, setLoaded] = useState(false)
  if (item.previewUrl !== null && item.previewUrl !== previewUrl) setPreviewUrl(item.previewUrl)
  if (item.failed === true) {
    return (
      <button type="button" className={css.open} aria-label={`${item.alt}: ${labels.error}`} onClick={onOpen}>
        <span className={css.fileIcon}><UploadErrorIcon /></span>
        <span className={clsx(css.label, css.labelError)}>{labels.error}</span>
      </button>
    )
  }
  const shown = previewUrl !== null && loaded
  return (
    <button type="button" className={clsx(css.open, css.openImage)} aria-label={item.alt} onClick={onOpen}>
      {!shown && (
        <span className={css.spinnerBox}>
          <span className={css.spinner}><UploadSpinnerIcon /></span>
        </span>
      )}
      {previewUrl !== null && (
        <span className={clsx(css.imageBox, shown && css.imageLoaded)}>
          <img className={css.thumb} src={previewUrl} alt="" onLoad={() => { setLoaded(true) }} />
        </span>
      )}
    </button>
  )
}

function FileTile({ item, labels, onOpen }: {
  item: UploadTrayFileItem
  labels: UploadTrayLabels
  onOpen: () => void
}) {
  if (item.status === 'uploading') {
    return (
      <div className={css.open} role="status" aria-label={item.openLabel}>
        <span className={css.spinnerBox}>
          <span className={css.spinner}><UploadSpinnerIcon /></span>
        </span>
      </div>
    )
  }
  if (item.status === 'error') {
    return (
      <div className={css.open} role="status" aria-label={`${item.name}: ${labels.error}`}>
        <span className={css.fileIcon}><UploadErrorIcon /></span>
        <span className={clsx(css.label, css.labelError)}>{labels.error}</span>
      </div>
    )
  }
  return (
    <button type="button" className={css.open} aria-label={item.openLabel} title={item.name} onClick={onOpen}>
      <span className={css.fileIcon}><FileTypeIcon kind={fileIconKind(item.name, item.mediaType)} /></span>
      <span className={css.label}><span className={css.name}>{titleOf(item.name)}</span></span>
    </button>
  )
}
