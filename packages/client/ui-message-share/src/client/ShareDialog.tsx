/**
 * The share dialog: what publishing does, a thumbnail of the response, the
 * link once it exists, and the Create link and Manage actions.
 * @module @aeven/client-ui-message-share/client/ShareDialog
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Input, IconLinkOutline16, IconLucideLink, Modal, Spinner, writeClipboard } from '@aeven/client-ui-primitives'
import type { MessageId } from '@aeven/api-remotes/client'
import type { MessageShareFailureCode, MessageShareLink } from '@aeven/host-message-share/types'
import type { MessageShareActionProps, MessageShareInjected } from './slots.ts'
import { ShareThumb } from './ShareThumb.tsx'
import css from './ShareAction.module.css'

/** How long the button reads "Copied" after a copy. */
const COPIED_MS = 1500

/** Props of {@link ShareDialog}. */
export interface ShareDialogProps {
  readonly open: boolean
  readonly messageId: MessageId
  readonly share: MessageShareInjected['share']
  /** Draws the card the link will unfurl with, for the thumbnail. */
  readonly preview: MessageShareInjected['preview']
  readonly onClose: () => void
  readonly onManage: () => void
  readonly t: MessageShareActionProps['t']
}

/**
 * Hand a link to the reader: the system share sheet on a touch device that has
 * one, the clipboard elsewhere.
 * @param link - the link to hand over.
 * @returns whether the link was copied to the clipboard.
 */
async function deliver(link: MessageShareLink): Promise<boolean> {
  if (typeof navigator.share === 'function' && window.matchMedia('(pointer: coarse)').matches) {
    // The person dismissing the share sheet rejects the promise; there is nothing to report.
    await navigator.share({ title: link.title, url: link.url }).catch(() => undefined)
    return false
  }
  return await writeClipboard(link.url)
}

/**
 * The share dialog.
 * @param props - the message, its thumbnail copies, the share verb, and the close and manage callbacks.
 * @returns the dialog, or null while closed.
 */
export function ShareDialog({ open, messageId, preview, share, onClose, onManage, t }: ShareDialogProps) {
  const [link, setLink] = useState<MessageShareLink | null>(null)
  const [pending, setPending] = useState(false)
  const [copied, setCopied] = useState(false)
  const [failure, setFailure] = useState<MessageShareFailureCode | null>(null)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const alive = useRef(true)

  useEffect(() => () => {
    alive.current = false
    if (copiedTimer.current !== null) clearTimeout(copiedTimer.current)
  }, [])

  // Each opening starts over: sharing again refreshes the link's snapshot.
  useEffect(() => {
    if (!open) return
    setLink(null)
    setPending(false)
    setCopied(false)
    setFailure(null)
  }, [open])

  const handOver = useCallback(async (current: MessageShareLink) => {
    if (!(await deliver(current)) || !alive.current) return
    setCopied(true)
    if (copiedTimer.current !== null) clearTimeout(copiedTimer.current)
    copiedTimer.current = setTimeout(() => {
      copiedTimer.current = null
      if (alive.current) setCopied(false)
    }, COPIED_MS)
  }, [])

  const onShare = useCallback(async () => {
    if (link !== null) {
      await handOver(link)
      return
    }
    setPending(true)
    setFailure(null)
    const result = await share(messageId)
    if (!alive.current) return
    setPending(false)
    if (!result.ok) {
      setFailure(result.code)
      return
    }
    setLink(result.value)
    await handOver(result.value)
  }, [handOver, link, messageId, share])

  const loadPreview = useCallback(async () => await preview(messageId), [preview, messageId])

  const label = copied ? 'dialog.copied' : link === null ? 'dialog.share' : 'dialog.copy'

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('dialog.title')}
      closeLabel={t('dialog.close')}
      contentClassName={css.shareContent ?? ''}
      width="min(480px, 100%)"
      footer={(
        <>
          <Button variant="outline" onClick={onManage}>{t('dialog.manage')}</Button>
          <Button
            variant="primary"
            className={css.createButton ?? ''}
            aria-busy={pending || undefined}
            onClick={() => { if (!pending) void onShare() }}
          >
            {/* Every label sits in one grid cell, so the button keeps the widest label's width. */}
            <span className={css.createLabels}>
              {(['dialog.share', 'dialog.copied', 'dialog.copy'] as const).map(key => (
                <span key={key} aria-hidden={key !== label || undefined} data-current={key === label || undefined}>{t(key)}</span>
              ))}
            </span>
            <span className={css.createGlyph}>{pending ? <Spinner /> : <IconLucideLink />}</span>
          </Button>
        </>
      )}
    >
      <ShareThumb open={open} load={loadPreview} label={t('dialog.preview')} loadingLabel={t('dialog.previewLoading')} />
      <p className={css.description}>{t('dialog.description')}</p>
      {link !== null && (
        <Input
          className={css.linkField ?? ''}
          icon={<IconLinkOutline16 />}
          readOnly
          value={link.url}
          aria-label={t('dialog.link')}
          onFocus={(event) => { event.currentTarget.select() }}
        />
      )}
      {failure !== null && <p className={css.failure} role="alert">{t(`error.${failure}`)}</p>}
    </Modal>
  )
}
