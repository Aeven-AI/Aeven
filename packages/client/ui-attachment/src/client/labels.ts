import type { TranslateNS } from '@aeven/client-ui-slots'
import type { UploadTrayLabels } from '../UploadTray.tsx'
import type { DropOverlayLabels } from '../DropOverlay.tsx'
import type { ImageLightboxLabels } from '@aeven/client-ui-primitives'
import type { MessageImageLabels } from '../MessageImage.tsx'

/**
 * Resolve original-image lightbox strings from the conversation namespace.
 * @param t - conversation namespace translator.
 * @returns translated lightbox labels.
 */
export function lightboxLabels(t: TranslateNS<'conversation'>): ImageLightboxLabels {
  return { dialog: t('image.preview'), close: t('image.closePreview') }
}

/**
 * Resolve historical message-image strings from the conversation namespace.
 * @param t - conversation namespace translator.
 * @returns translated message-image labels.
 */
export function messageImageLabels(t: TranslateNS<'conversation'>): MessageImageLabels {
  return {
    image: t('image.label'),
    open: t('image.openOriginal'),
    openNamed: label => t('image.openOriginalLabel', { label }),
    loading: t('image.loading'),
    loadFailed: t('image.loadFailed'),
    lightbox: lightboxLabels(t),
  }
}

/**
 * Resolve the document-level drop invitation and its optional limits line.
 * @param t - conversation namespace translator.
 * @param accepting - whether the composer can accept dropped files.
 * @param limits - optional translated count and size values.
 * @returns translated drop-overlay labels.
 */
export function dropOverlayLabels(
  t: TranslateNS<'conversation'>,
  accepting: boolean,
  limits?: { readonly count: number; readonly size: string },
): DropOverlayLabels {
  if (!accepting) return { title: t('file.busy') }
  return {
    title: t('file.dropTitle'),
    desc: limits === undefined ? undefined : t('file.dropDesc', limits),
  }
}

/**
 * Resolve upload-tray strings from the conversation namespace.
 * @param t - conversation namespace translator.
 * @param group - which tray the group label names.
 * @returns translated upload-tray labels.
 */
export function uploadTrayLabels(t: TranslateNS<'conversation'>, group: 'draft' | 'message'): UploadTrayLabels {
  return {
    group: group === 'draft' ? t('file.pending') : t('file.attached'),
    remove: t('file.remove'),
    error: t('file.error'),
  }
}
