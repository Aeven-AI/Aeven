/**
 * The web page's extension prompt: asks the reader to add the Aeven extension when the agent needs their
 * browser, or to continue in the desktop app or download it instead, offers to continue the task once the
 * extension arrives after the agent stopped waiting, and explains when this browser cannot run it. It is Aeven's
 * standard modal, with its text in the description.
 */
import { useEffect, useState } from 'react'
import { Button, Modal } from '@aeven/client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import type {} from '@aeven/client-ui-layout/client'
import type { ExtensionPromptState } from './extension-install.ts'

/** How long the page waits for the desktop app to take focus before it suggests installing it, in milliseconds. */
const OPEN_GRACE_MS = 1500

/**
 * The `aeven://` link that continues a conversation in the desktop app.
 * @param sessionId - the conversation the prompt was opened for.
 * @returns the link.
 */
function desktopLink(sessionId: string): string {
  return `aeven://c/${encodeURIComponent(sessionId)}`
}

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
  /** The desktop app took the conversation the prompt was opened for. */
  openedDesktop: () => void
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
  const { usePrompt, storeUrl, browser, downloadUrl, dismiss, openedDesktop, check, close, continueTask, t } = props
  const state = usePrompt(snapshot => snapshot)
  const [opened, setOpened] = useState(false)
  const [notOpened, setNotOpened] = useState(false)
  useEffect(() => {
    if (state.kind !== 'install') {
      setOpened(false)
      setNotOpened(false)
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
      const status = notOpened
        ? t('extension.install.notOpened')
        : !state.waiting ? t('extension.install.stopped') : opened ? t('extension.install.waiting') : undefined
      const openDesktop = (): void => {
        setNotOpened(false)
        // The page loses focus when the operating system hands the link to an installed app.
        let left = false
        const onBlur = (): void => { left = true }
        window.addEventListener('blur', onBlur, { once: true })
        window.setTimeout(() => {
          window.removeEventListener('blur', onBlur)
          if (!left && document.hasFocus()) setNotOpened(true)
          else openedDesktop()
        }, OPEN_GRACE_MS)
        window.location.href = desktopLink(state.sessionId)
      }
      return (
        <Modal
          open
          onClose={dismiss}
          title={t('extension.install.title')}
          description={status === undefined ? t('extension.install.body') : `${t('extension.install.body')} ${status}`}
          closeLabel={t('handoff.close')}
          footer={(
            <>
              <Button variant="primary" onClick={openDesktop}>{t('extension.install.openDesktop')}</Button>
              {downloadUrl !== undefined && (
                <Button variant="outline" onClick={() => { window.open(downloadUrl, '_blank', 'noopener') }}>{t('extension.install.download')}</Button>
              )}
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
