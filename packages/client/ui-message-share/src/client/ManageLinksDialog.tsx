/**
 * The link manager: every link the signed-in account created, newest
 * first, loaded a page at a time as the list scrolls, each deletable on its
 * own, and a confirmed action that deletes them all.
 * @module @aeven/client-ui-message-share/client/ManageLinksDialog
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, IconLucideExternalLink, IconLucideTrash, Modal, Spinner, Tooltip } from '@aeven/client-ui-primitives'
import type {
  MessageShareCursor, MessageShareFailureCode, MessageShareId, MessageShareLink,
} from '@aeven/host-message-share/types'
import type { MessageShareActionProps, MessageShareInjected } from './slots.ts'
import css from './ShareAction.module.css'

/** Props of {@link ManageLinksDialog}. */
export interface ManageLinksDialogProps {
  readonly open: boolean
  readonly list: MessageShareInjected['list']
  readonly remove: MessageShareInjected['remove']
  readonly removeAll: MessageShareInjected['removeAll']
  readonly onClose: () => void
  readonly t: MessageShareActionProps['t']
}

/** Where paging stands: more pages exist after `cursor`, or the list is complete. */
type Paging = { readonly kind: 'more'; readonly cursor: MessageShareCursor | undefined } | { readonly kind: 'done' }

/**
 * Format a link's date in the document's language.
 * @param time - Unix epoch milliseconds.
 * @returns the medium date.
 */
function formatDate(time: number): string {
  return new Intl.DateTimeFormat(document.documentElement.lang || undefined, { dateStyle: 'medium' }).format(time)
}

/**
 * The link manager dialog.
 * @param props - the link verbs and the close callback.
 * @returns the dialog and its delete-all confirmation, or null while closed.
 */
export function ManageLinksDialog({ open, list, remove, removeAll, onClose, t }: ManageLinksDialogProps) {
  const [items, setItems] = useState<readonly MessageShareLink[]>([])
  const [paging, setPaging] = useState<Paging>({ kind: 'more', cursor: undefined })
  const [loading, setLoading] = useState(false)
  const [failure, setFailure] = useState<MessageShareFailureCode | null>(null)
  const [removing, setRemoving] = useState<ReadonlySet<MessageShareId>>(new Set())
  const [confirming, setConfirming] = useState(false)
  const [clearing, setClearing] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const loadingRef = useRef(false)
  // Bumped by each opening and by delete-all, so a page that arrives afterwards is dropped.
  const generation = useRef(0)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  const loadMore = useCallback(async (from: Paging) => {
    if (from.kind === 'done' || loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    const started = generation.current
    const result = await list(from.cursor)
    if (!alive.current || started !== generation.current) return
    loadingRef.current = false
    setLoading(false)
    if (!result.ok) {
      setFailure(result.code)
      return
    }
    setFailure(null)
    setItems(current => [...current, ...result.value.items.filter(item => !current.some(known => known.shareId === item.shareId))])
    setPaging(result.value.nextCursor === null ? { kind: 'done' } : { kind: 'more', cursor: result.value.nextCursor })
  }, [list])

  // Each opening reads the list afresh.
  useEffect(() => {
    if (!open) return
    generation.current += 1
    loadingRef.current = false
    setItems([])
    setFailure(null)
    setRemoving(new Set())
    setConfirming(false)
    setClearing(false)
    setLoading(false)
    const first: Paging = { kind: 'more', cursor: undefined }
    setPaging(first)
    void loadMore(first)
  }, [open, loadMore])

  // The next page loads when the end of the list scrolls into view.
  useEffect(() => {
    const root = scrollRef.current
    const sentinel = sentinelRef.current
    if (!open || root === null || sentinel === null || paging.kind === 'done' || failure !== null) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting)) void loadMore(paging)
    }, { root, rootMargin: '120px 0px' })
    observer.observe(sentinel)
    return () => { observer.disconnect() }
  }, [open, paging, failure, loadMore, items.length])

  const onRemove = useCallback(async (shareId: MessageShareId) => {
    setRemoving(current => new Set(current).add(shareId))
    const result = await remove(shareId)
    if (!alive.current) return
    setRemoving((current) => {
      const next = new Set(current)
      next.delete(shareId)
      return next
    })
    if (!result.ok && result.code !== 'not-found') {
      setFailure(result.code)
      return
    }
    setItems(current => current.filter(item => item.shareId !== shareId))
  }, [remove])

  const onRemoveAll = useCallback(async () => {
    setClearing(true)
    const result = await removeAll()
    if (!alive.current) return
    setClearing(false)
    setConfirming(false)
    if (!result.ok) {
      setFailure(result.code)
      return
    }
    generation.current += 1
    loadingRef.current = false
    setLoading(false)
    setItems([])
    setPaging({ kind: 'done' })
  }, [removeAll])

  const empty = items.length === 0 && paging.kind === 'done' && failure === null

  return (
    <>
      <Modal
        open={open}
        onClose={() => { if (!confirming) onClose() }}
        title={t('manage.title')}
        closeLabel={t('manage.close')}
        width="min(520px, 100%)"
        footer={(
          <Button
            variant="primary"
            className={css.solidButton ?? ''}
            disabled={items.length === 0 || clearing}
            onClick={() => { setConfirming(true) }}
          >
            {t('manage.deleteAll')}
          </Button>
        )}
      >
        <div ref={scrollRef} className={css.list}>
          {items.map(item => (
            <div key={item.shareId} className={css.row} data-removing={removing.has(item.shareId) || undefined}>
              <a className={css.rowMain} href={item.url} target="_blank" rel="noopener noreferrer">
                <span className={css.rowTitle}>{item.title}</span>
                <span className={css.rowDate}>{formatDate(item.updatedAt)}</span>
              </a>
              <span className={css.rowActions}>
                <Tooltip label={t('manage.open')} side="bottom">
                  <a className={css.iconButton} href={item.url} target="_blank" rel="noopener noreferrer" aria-label={t('manage.open')}>
                    <IconLucideExternalLink />
                  </a>
                </Tooltip>
                <Tooltip label={t('manage.delete')} side="bottom">
                  <button
                    type="button"
                    className={css.iconButton}
                    aria-label={t('manage.delete')}
                    disabled={removing.has(item.shareId)}
                    onClick={() => { void onRemove(item.shareId) }}
                  >
                    <IconLucideTrash />
                  </button>
                </Tooltip>
              </span>
            </div>
          ))}
          {empty && <p className={css.empty}>{t('manage.empty')}</p>}
          {loading && <div className={css.loading} role="status" aria-label={t('manage.loading')}><Spinner /></div>}
          {failure !== null && (
            <div className={css.listFailure} role="alert">
              <span>{t(`error.${failure}`)}</span>
              {paging.kind === 'more' && (
                <Button variant="outline" size="sm" onClick={() => { setFailure(null); void loadMore(paging) }}>{t('manage.retry')}</Button>
              )}
            </div>
          )}
          <div ref={sentinelRef} className={css.sentinel} aria-hidden="true" />
        </div>
      </Modal>
      <Modal
        open={open && confirming}
        onClose={() => { if (!clearing) setConfirming(false) }}
        title={t('confirm.title')}
        closeLabel={t('confirm.cancel')}
        description={t('confirm.description')}
        width="min(440px, 100%)"
        footer={(
          <>
            <Button variant="outline" autoFocus disabled={clearing} onClick={() => { setConfirming(false) }}>{t('confirm.cancel')}</Button>
            <Button variant="primary" className={css.dangerFill} disabled={clearing} onClick={() => { void onRemoveAll() }}>{t('confirm.delete')}</Button>
          </>
        )}
      />
    </>
  )
}
