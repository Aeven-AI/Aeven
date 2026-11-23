/**
 * The screen a social sign-in returns to.
 *
 * The provider redirects the browser here with either an error or a
 * session/challenge pair. A pair is exchanged for a session; a provider window
 * then closes so the page waiting on it boots the app, and any other landing
 * sends the reader on to where they came from. Anything else leaves the apology
 * on screen.
 * Rendering matches the Aeven client exactly.
 * @module
 */

import { useEffect, useRef, useState } from 'react'
import type React from 'react'

import * as api from '../services/api.ts'
import { t } from '../../locales.ts'
import * as events from '../services/events.ts'
import { navigateRoute, AUTH_ROUTES } from '../services/routes.ts'
import { oauthFlow } from '../services/config.ts'
import { providerLandingFinish } from '../services/oauth.ts'
import { href } from '../services/utility.ts'
import { session, storage } from '../services/session.ts'

/** What the route matched out of the path. */
export interface OauthResultParams {
  readonly error?: string
  readonly oAuthSession?: string
  readonly oAuthChallenge?: string
}

export interface OauthResultProps {
  readonly match: { readonly params: OauthResultParams }
}

/**
 * Where to return the reader once the exchange settles: the screen they
 * started from, or the application root.
 * @returns the path to return to.
 */
function currentReferrer(): string {
  return storage.getItem('authReferrer') ?? AUTH_ROUTES.home
}

/** How long a landing that asked to close stays before it counts the close as refused. */
const CLOSE_REFUSED_MS = 500

export function OauthResult(props: OauthResultProps): React.JSX.Element | null {
  const [status, setStatus] = useState<'error' | 'signed-in' | null>(null)
  const referrer = useRef(currentReferrer())

  useEffect(() => {
    // The redirect is handled once. A second run would exchange a challenge the
    // API has already spent, which it refuses.
    let cancelled = false
    const { error, oAuthSession, oAuthChallenge } = props.match.params

    /** Leave the apology up, or move on if a session exists after all. */
    const settleFailure = (): void => {
      if (cancelled) return
      if (session.userSignedIn) {
        navigateRoute(href(AUTH_ROUTES.home))
      } else {
        setStatus('error')
      }
      events.dispatchObjectEvent('hide:preloader', true)
    }

    const complete = async (): Promise<void> => {
      if (error !== undefined || oAuthSession === undefined || oAuthChallenge === undefined) {
        settleFailure()
        return
      }
      try {
        await api.checkOauthToken(oAuthSession, oAuthChallenge)
        await api.getProfile()
        if (cancelled) return
        // A landing in a provider window is where the sign-in finishes, not where
        // the application belongs: the page waiting on that window boots the shell.
        // A landing no page waits on goes on to the screen the reader came from.
        const finish = await providerLandingFinish(oauthFlow())
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- the effect's cleanup can run during the await.
        if (cancelled) return
        if (finish === 'close') {
          window.close()
          // A browser that refuses the close leaves this note, never a second shell.
          setTimeout(() => { if (!cancelled) setStatus('signed-in') }, CLOSE_REFUSED_MS)
        } else {
          navigateRoute(href(referrer.current))
        }
        events.dispatchObjectEvent('hide:preloader', true)
      } catch (failure) {
        if (failure instanceof api.AevenApiError && failure.message === 'mfa-required') {
          navigateRoute('/sign-in/mfa')
          return
        }
        // Every failure here is the same to the reader: the provider did not
        // establish a session, whether the exchange or the profile read failed.
        settleFailure()
      }
    }
    void complete()
    return () => { cancelled = true }
  }, [props.match.params])

  if (status === null) return null
  const heading = status === 'error' ? t('oauth.failedHeading') : t('oauth.signedInHeading')
  const body = status === 'error' ? t('oauth.failedBody') : t('oauth.signedInBody')
  return (
    <div className="oauth-result view">
      <div id="main-content" className="main-content">
        <div className="content-container">
          <div className="message-container">
            <div className="message">
              <span className="txt-header">{heading}</span>
              <span className="txt-content">
                <span>{body}</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default OauthResult
