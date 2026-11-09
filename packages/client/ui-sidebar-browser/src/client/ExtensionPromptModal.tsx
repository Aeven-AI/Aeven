/**
 * The web page's extension prompt: asks the reader to add the Aeven extension when the agent needs their
 * browser, offers to continue the task once it arrives after the agent stopped waiting, and explains when this
 * browser cannot run it. It is Aeven's standard modal, with its text in the description.
 */
import { useEffect, useState } from 'react'
import { Button, Modal } from '@aeven/client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import type {} from '@aeven/client-ui-layout/client'
import type { ExtensionPromptState } from './extension-install.ts'

/** What the plugin hands the prompt. */
export interface ExtensionPromptInjected {
  hooks: {
    prompt: {
      getSnapshot(): ExtensionPromptState
      subscribe(listener: () => void): () => void
    }
  }
  /** The Chrome Web Store page the add button opens. */
  storeUrl: string
  /** This browser's short name for the add button, when it says. */
  browser: string | undefined
  /** The download page of this deployment's Aeven site, when it names one. */
  downloadUrl: string | undefined
  /** The reader declined or closed the prompt. */
  dismiss: () => void
  /** Check for the extension now, as when the reader returns to the page. */
  check: () => void
  /** Close the prompt without declining. */
  close: () => void
  /**
   * Send the continue message into a session.
   * @param sessionId - the session the prompt was opened for.
   * @param text - the message.
   */
  continueTask: (sessionId: string, text: string) => void
}

export type ExtensionPromptModalProps = PropsRuntime<'shell.overlay'> & InjectFace<ExtensionPromptInjected> & PropsLocale<'sidebarBrowser'>

/**
 * Render the prompt while it is open.
 * @param props - the prompt state hook, its actions, and copy.
 * @returns the prompt, or null while closed.
 */
export function ExtensionPromptModal(props: ExtensionPromptModalProps) {
  const { usePrompt, storeUrl, browser, downloadUrl, dismiss, check, close, continueTask, t } = props
  const state = usePrompt(snapshot => snapshot)
  const [opened, setOpened] = useState(false)
  useEffect(() => {
    if (state.kind !== 'install') {
      setOpened(false)
      return
    }
    // The reader installs in the store's tab and comes back here.
    const onReturn = (): void => { if (document.visibilityState === 'visible') check() }
    window.addEventListener('focus', onReturn)
    document.addEventListener('visibilitychange', onReturn)
    return () => {
      window.removeEventListener('focus', onReturn)
      document.removeEventListener('visibilitychange', onReturn)
    }
  }, [state.kind, check])
  switch (state.kind) {
    case 'closed':
      return null
    case 'install': {
      const status = !state.waiting ? t('extension.install.stopped') : opened ? t('extension.install.waiting') : undefined
      return (
        <Modal
          open
          onClose={dismiss}
          title={t('extension.install.title')}
          description={status === undefined ? t('extension.install.body') : `${t('extension.install.body')} ${status}`}
          closeLabel={t('handoff.close')}
          footer={(
            <>
              <Button variant="outline" onClick={dismiss}>{t('handoff.decline')}</Button>
              <Button
                variant="primary"
                onClick={() => {
                  setOpened(true)
                  window.open(storeUrl, '_blank', 'noopener')
                }}
              >
                {browser === undefined ? t('extension.install.addGeneric') : t('extension.install.add', { browser })}
              </Button>
            </>
          )}
        />
      )
    }
    case 'connected':
      return (
        <Modal
          open
          onClose={close}
          title={t('extension.connected.title')}
          description={t('extension.connected.body', { browser: state.browser })}
          closeLabel={t('handoff.close')}
          footer={(
            <>
              <Button variant="outline" onClick={close}>{t('handoff.close')}</Button>
              <Button
                variant="primary"
                onClick={() => {
                  close()
                  continueTask(state.sessionId, t('extension.connected.message'))
                }}
              >
                {t('extension.connected.continue')}
              </Button>
            </>
          )}
        />
      )
    case 'unsupported':
      return (
        <Modal
          open
          onClose={close}
          title={t('extension.unsupported.title')}
          description={t('extension.unsupported.body')}
          closeLabel={t('handoff.close')}
          footer={(
            <>
              {downloadUrl !== undefined && (
                <Button variant="outline" onClick={() => { window.open(downloadUrl, '_blank', 'noopener') }}>{t('extension.unsupported.download')}</Button>
              )}
              <Button variant="primary" onClick={close}>{t('handoff.ok')}</Button>
            </>
          )}
        />
      )
    default: {
      const unknown: never = state
      return unknown
    }
  }
}
