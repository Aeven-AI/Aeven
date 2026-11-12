/**
 * The share action of one finalized assistant message. It renders inside the
 * message's IconActions row, directly before branch, and opens the share
 * dialog; the dialog's Manage links action swaps it for the link manager.
 * @module @aeven/client-ui-message-share/client/ShareAction
 */

import { useCallback, useRef, useState } from 'react'
import { IconLucideShare2, Tooltip } from '@aeven/client-ui-primitives'
import type { MessageShareActionProps } from './slots.ts'
import { ManageLinksDialog } from './ManageLinksDialog.tsx'
import { ShareDialog } from './ShareDialog.tsx'
import { captureTurn } from './ShareThumb.tsx'
import css from './ShareAction.module.css'

/**
 * One message's share action and its dialogs.
 * @param props - the owner's message identity, the injected link verbs, and the copy.
 * @returns the share button, with the share dialog or the link manager open above the page.
 */
export function ShareAction({ messageId, share, list, remove, removeAll, t }: MessageShareActionProps) {
  const [dialog, setDialog] = useState<'share' | 'manage' | null>(null)
  const [preview, setPreview] = useState<readonly HTMLElement[]>([])
  const triggerRef = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => { setDialog(null) }, [])

  return (
    <>
      <Tooltip label={t('action.share')} side="bottom">
        <button
          ref={triggerRef}
          type="button"
          className={css.action}
          aria-label={t('action.share')}
          aria-haspopup="dialog"
          onClick={() => {
            setPreview(captureTurn(triggerRef.current))
            setDialog('share')
          }}
        >
          <IconLucideShare2 />
        </button>
      </Tooltip>
      <ShareDialog
        open={dialog === 'share'}
        messageId={messageId}
        preview={preview}
        share={share}
        onClose={close}
        onManage={() => { setDialog('manage') }}
        t={t}
      />
      <ManageLinksDialog open={dialog === 'manage'} list={list} remove={remove} removeAll={removeAll} onClose={close} t={t} />
    </>
  )
}
