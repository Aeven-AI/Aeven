/**
 * The screen a reader whose account is scheduled for deletion sees instead of the application.
 *
 * Every Aeven API but the account routes refuses such an account, so the application could not run; this states when
 * the account will be erased and offers the two ways out: restore it, which withdraws the deletion and resumes a plan
 * the request ended, or sign out.
 * @module
 */

import { useCallback, useRef } from 'react'
import type React from 'react'

import Button, { type ButtonHandle } from '../com/Button.tsx'

import * as api from '../services/api.ts'
import * as events from '../services/events.ts'
import { isSessionRefusal } from '../services/errors.ts'
import { leaveForSignIn } from '../services/watch.ts'
import { t } from '../../locales.ts'

/** What the gate hands the screen. */
export interface RestoreAccountProps {
  /** ISO time the account will be erased. */
  readonly purgeAt: string
  /** Called once the account is restored or the reader signed out, so the gate re-reads the session. */
  readonly onDone: () => void
}

/**
 * Render the restore screen.
 * @param props - the erase date and the completion callback.
 * @returns the screen: what happens when, Restore account, and Sign out.
 */
export function RestoreAccount({ purgeAt, onDone }: RestoreAccountProps): React.JSX.Element {
  const restoreButton = useRef<ButtonHandle>(null)
  const date = new Date(purgeAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })

  const restore = useCallback((): void => {
    restoreButton.current?.loadingStatus(true)
    void api.account('/restore', { method: 'POST', body: '{}' })
      .then(() => {
        restoreButton.current?.loadingStatus(false)
        onDone()
      })
      .catch((error: unknown) => {
        restoreButton.current?.loadingStatus(false)
        if (isSessionRefusal(error)) {
          leaveForSignIn()
          return
        }
        events.dispatchObjectEvent('show:modal', {
          header: t('modal.oops'),
          content: t('restore.failed'),
          buttonText: t('action.ok'),
        })
      })
  }, [onDone])

  const signOut = useCallback((): void => {
    void api.signOut().finally(onDone)
  }, [onDone])

  return (
    <div className="init-check">
      <div className="content-container">
        <div className="form-container">
          <span className="header-text">{t('restore.title')}</span>
          <span className="content-text">{t('restore.body').replace('{date}', date)}</span>
          <div className="button-container">
            <Button
              ref={restoreButton}
              type={'loaderButton'}
              cssClass={'loader-button large center'}
              label={t('restore.action')}
              loading={false}
              onClick={() => { restore() }}
            />
          </div>
          <div className="button-container">
            <Button
              type={'loaderButton'}
              cssClass={'loader-button large center light'}
              label={t('restore.signOut')}
              loading={false}
              onClick={() => { signOut() }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export default RestoreAccount
