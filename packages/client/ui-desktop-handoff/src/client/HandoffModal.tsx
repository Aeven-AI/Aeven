/**
 * The "Available in Aeven Desktop" dialog: says why the request needs the reader's own computer, opens the same
 * conversation in the installed desktop app through an `aeven://` link, and offers the download when nothing opens.
 */
import { useEffect, useState } from 'react'
import { Button, Modal, openAppLink } from '@aeven/client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import type {} from '@aeven/client-ui-layout/client'
import type { HandoffState } from './store.ts'
import { NS } from './locales.ts'
import css from './HandoffModal.module.css'

/** What the plugin hands the dialog. */
export interface HandoffModalInjected {
  hooks: {
    handoff: {
      getSnapshot(): HandoffState
      subscribe(listener: () => void): () => void
    }
  }
  /** The download page of this deployment's Aeven site, when it names one. */
  downloadUrl: string | undefined
  close: () => void
}

export type HandoffModalProps = PropsRuntime<'shell.overlay'> & InjectFace<HandoffModalInjected> & PropsLocale<typeof NS>

/**
 * The `aeven://` link that continues here in the desktop app.
 * @param sessionId - the current conversation, when there is one.
 * @returns the link.
 */
function desktopLink(sessionId: string | undefined): string {
  return sessionId === undefined ? 'aeven://' : `aeven://c/${encodeURIComponent(sessionId)}`
}

/**
 * Render the dialog while it is open.
 * @param props - the dialog state hook, the download page, close, and copy.
 * @returns the dialog, or null while closed.
 */
export function HandoffModal({ useHandoff, downloadUrl, close, t }: HandoffModalProps) {
  const state = useHandoff(snapshot => snapshot)
  const [notOpened, setNotOpened] = useState(false)
  useEffect(() => {
    if (state.open) setNotOpened(false)
  }, [state.open])
  if (!state.open) return null
  const open = (): void => {
    setNotOpened(false)
    void openAppLink(desktopLink(state.sessionId)).then((opened) => {
      if (opened) close()
      else setNotOpened(true)
    })
  }
  return (
    <Modal
      open
      onClose={close}
      title={t('title')}
      closeLabel={t('close')}
      footer={(
        <div className={css.actions}>
          <Button variant={notOpened ? 'outline' : 'primary'} onClick={open}>{t('open')}</Button>
          {downloadUrl !== undefined && (
            <Button variant={notOpened ? 'primary' : 'outline'} onClick={() => { window.open(downloadUrl, '_blank', 'noopener') }}>
              {t('download')}
            </Button>
          )}
        </div>
      )}
    >
      <p className={css.message}>{t(`reason.${state.reason}`)}</p>
      {notOpened && <p className={css.hint} role="status">{t('notOpened')}</p>}
    </Modal>
  )
}
