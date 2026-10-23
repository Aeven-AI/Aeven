/**
 * The screen that asks an unnamed reader what to call them.
 *
 * Ported from the Aeven client's `initCheck` step: there, `Home` renders it in
 * place of the chat while `displayNameSet` is not true, so a reader who has
 * never chosen a name answers this once before they can talk to anything. The
 * API records the name against the account, which is what every surface names
 * them by afterwards.
 *
 * The screen is React, and it runs before the plugin graph, so the gate brings
 * React forward for it exactly as it does for the sign-in screens.
 * @module
 */

import { useCallback, useRef, useState } from 'react'
import type React from 'react'

import Input, { type InputHandle } from '../com/Input.tsx'
import Button, { type ButtonHandle } from '../com/Button.tsx'

import * as api from '../services/api.ts'
import * as events from '../services/events.ts'
import { isSessionRefusal } from '../services/errors.ts'
import { session } from '../services/session.ts'
import { sanitizeString } from '../services/utility.ts'
import { leaveForSignIn } from '../services/watch.ts'
import { t } from '../../locales.ts'

/** What the gate hands the screen. */
export interface NameCheckProps {
  /** Called once the name is stored, so the caller can load the application. */
  readonly onNamed: () => void
}

/**
 * Render the naming step.
 * @param props - the completion callback.
 * @returns the step: a greeting, the name field, and Continue.
 */
export function NameCheck({ onNamed }: NameCheckProps): React.JSX.Element {
  const nameInput = useRef<InputHandle>(null)
  const submitButton = useRef<ButtonHandle>(null)
  const [anonymous, setAnonymous] = useState(false)

  const submit = useCallback((): void => {
    const name = sanitizeString(nameInput.current?.value ?? '')
    if (name === '') {
      // The API refuses an empty name, so the screen refuses it first: asking
      // again costs a round trip and answers nothing the reader did not mean.
      setAnonymous(true)
      nameInput.current?.focus()
      return
    }
    setAnonymous(false)
    submitButton.current?.loadingStatus(true)
    void api.setDisplayName(name)
      .then(() => {
        submitButton.current?.loadingStatus(false)
        onNamed()
      })
      .catch((error: unknown) => {
        submitButton.current?.loadingStatus(false)
        // A refused bearer ends the session; the naming step is not somewhere
        // to leave a reader whose credential has lapsed.
        if (isSessionRefusal(error)) {
          leaveForSignIn()
          return
        }
        // A refused name is reported the way this surface reports every other
        // refusal: the popup, rather than a line below the button.
        events.dispatchObjectEvent('show:modal', {
          header: t('modal.oops'),
          content: t('name.saveFailed'),
          buttonText: t('action.ok'),
        })
      })
  }, [onNamed])

  return (
    <div className="init-check">
      <div className="content-container">
        <div className="form-container">
          <span className="header-text">{t('name.title')}</span>
          <span className="content-text">
            {anonymous ? t('name.promptAnonymous') : t('name.prompt')}
          </span>
          <form
            className="form"
            onSubmit={(event) => {
              event.preventDefault()
              event.stopPropagation()
              submit()
            }}
          >
            <div className="input-container">
              <Input
                ref={nameInput}
                inputType={'inputText'}
                type={'text'}
                cssClass={'input-text large center square'}
                placeholder={t('field.name')}
                defaultValue={session.displayName ?? ''}
                autoCapitalize={'words'}
                autoComplete={'name'}
              />
            </div>
            <div className="button-container">
              <Button
                ref={submitButton}
                type={'loaderButton'}
                cssClass={'loader-button large center'}
                label={t('action.continue')}
                loading={false}
                onClick={() => { submit() }}
              />
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

export default NameCheck
