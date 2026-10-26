import { useEffect, useRef, useState, type RefObject } from 'react'
import type React from 'react'

import JSConfetti from '../../../vendor/confetti/index.ts'

import Input, { type InputHandle } from '../com/Input.tsx'
import Button, { type ButtonHandle } from '../com/Button.tsx'

import * as api from '../services/api.ts'
import * as events from '../services/events.ts'
import * as routes from '../services/routes.ts'
import * as config from '../services/config.ts'
import * as utility from '../services/utility.ts'
import * as oauth from '../services/oauth.ts'
import { storage } from '../services/session.ts'
import { t } from '../../locales.ts'

// The screen is carried over as it stands, so the service objects it reaches
// for are assembled here from the ported modules rather than edited out of a
// thousand lines of markup and handlers.
const ROUTE_CONFIG = {
  home: { path: routes.AUTH_ROUTES.home },
  signIn: { path: routes.AUTH_ROUTES.signIn },
  signUp: { path: routes.AUTH_ROUTES.signUp },
}

/** Lucide's `arrow-left`, the mark the header's back control carries. */
const BACK_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="auth-back-icon"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>'

/**
 * Lucide's `shield-check`, the mark the authenticator challenge's buttons
 * carry in the seat the code step gives its mail icon.
 */
const MFA_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mail-icon mail"><path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6z"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg>'

/** Element id of the challenge's recovery-code field, which its label points at. */
const MFA_RECOVERY_INPUT_ID = 'mfa-recovery-code'

/**
 * The Æven monogram, at the geometry the shell's preloader and the sidebar
 * draw it. These screens run before the plugin graph, so the mark is carried
 * here rather than read from the brand packages.
 */
const AEVEN_MARK_PATHS = [
  'm225.301 0 305.5 529.142-43.301 25L182 25z',
  'M140 529.141 445.5 0l43.302 25-305.5 529.141z',
  'M167.901 530.059h335v50h-335z',
  'm43.302 264.5 167.5 290.119-43.302 25L0 289.5zM503.302 0l167.5 290.119-43.302 25L460 25z',
  'M460 554.618 627.5 264.5l43.301 25-167.5 290.118zM0 290.118 167.5 0 210.8 25l-167.5 290.118z',
  'M167.5 0h57.8v50h-57.8zM445.5 0h57.8v50h-57.8zM72.5 405.3 306.5 0l43.302 25-234 405.3z',
  'm364.301 0 234 405.3-43.3 25L321 25z',
  'M306.5 0h57.8v50h-57.8z',
] as const

/**
 * The header's brand seat, on the screens that have no step above them.
 * @returns the monogram, drawn in the tone of the seat that holds it.
 */
function AevenMark(): React.JSX.Element {
  return (
    <svg className="auth-mark-icon" viewBox="0 0 671 581" fill="none" aria-hidden="true">
      {AEVEN_MARK_PATHS.map(path => <path key={path} d={path} fill="currentColor" />)}
    </svg>
  )
}

const appService = {
  signIn: api.signIn,
  signUp: api.signUp,
  verifyEmail: api.verifyEmail,
  resendCode: api.resendCode,
  forgotPassword: api.forgotPassword,
  checkResetCode: api.checkResetCode,
  resetPassword: api.resetPassword,
  getInitData: api.getProfile,
}
const eventService = events
const routeService = { navigateRoute: routes.navigateRoute, routeConfig: ROUTE_CONFIG }
const configService = {
  get confettiColors() { return config.confettiColors() },
  get oauth() {
    const urls = config.oauthUrls()
    return { xOAuth: urls.x, appleOAuth: urls.apple, googleOAuth: urls.google }
  },
  oauthFlow: config.oauthFlow,
}
const oauthService = {
  open: oauth.openProviderSignIn,
  awaitSession: oauth.awaitProviderSession,
  watchReturn: oauth.watchProviderReturn,
  onEnded: oauth.onProviderSignInEnded,
}
const utilityService = utility
const storageService = storage


/**
 * The reset code the reader confirmed on the code screen, held for the password
 * screen that follows. It lives only as long as the page, so a reload returns
 * the reader to the code screen.
 */
let pendingResetCode: string | undefined

/**
 * The cover the boot gate raises over the page, lent to the screen so a
 * provider sign-in can raise it from the press on and lower it when the reader
 * comes back without finishing.
 */
export interface AuthScreenCover {
  show(): void
  hide(): void
}

/** What the router matched out of the path, and the gate's cover. */
export interface AuthenticateProps {
  readonly cover?: AuthScreenCover
  readonly match?: { readonly path?: string; readonly params?: { readonly authType?: string } }
  readonly location?: {
    readonly state?: {
      readonly from?: {
        readonly pathname?: { readonly pathname?: string; readonly search?: string; readonly hash?: string }
        readonly search?: string
        readonly hash?: string
      }
    }
  }
}

/* jscpd:ignore-start */
/*
 * The repeated handler preludes and form markup below are not an extraction
 * waiting to happen: this screen is carried over verbatim from the Aeven web
 * client so one stylesheet governs both, and it stays diffable against that
 * origin. Factoring the shared field rows, button rows and modal dispatches
 * into local helpers would break that diff for no behavior gain, which is the
 * same reason these files are excluded from per-file coverage (see the
 * rationale in vitest.config.ts). Clone detection is suppressed for the same
 * decision rather than answered by restructuring the port.
 */
export function Authenticate(props: AuthenticateProps): React.JSX.Element {
  // Identifies this screen's event listeners so unmount removes its own.
  const guidRef = useRef<string | null>(null)
  guidRef.current ??= utilityService.guid()
  const guid = guidRef.current

  const emailInput = useRef<InputHandle>(null)
  const verifyInput = useRef<InputHandle>(null)
  const passwordInput = useRef<InputHandle>(null)
  const passwordConfirmInput = useRef<InputHandle>(null)

  const signInButton = useRef<ButtonHandle>(null)
  const signInEmailButton = useRef<ButtonHandle>(null)
  const signInPasswordButton = useRef<ButtonHandle>(null)

  const signUpEmailButton = useRef<ButtonHandle>(null)
  const signUpVerifyButton = useRef<ButtonHandle>(null)
  const signUpResendCodeButton = useRef<ButtonHandle>(null)

  const mfaInput = useRef<InputHandle>(null)
  const mfaRecoveryInput = useRef<HTMLInputElement>(null)
  const mfaConfirmButton = useRef<ButtonHandle>(null)

  // The authenticator challenge offers both code formats; the recovery code is
  // the reader's way back in when the app is gone, so the step switches the
  // field rather than sending them elsewhere.
  const [mfaRecovery, setMfaRecovery] = useState(false)

  // A code the server accepted is spent: a profile load that fails afterwards
  // is retried on its own, never answered with a second challenge.
  const mfaAccepted = useRef(false)

  // The one failure the challenge reports in place of its instruction: a
  // challenge already answered, whose profile read can simply be tried again.
  const [mfaFailure, setMfaFailure] = useState<string>()

  const forgotSendButton = useRef<ButtonHandle>(null)
  const resetButton = useRef<ButtonHandle>(null)
  const resetResendButton = useRef<ButtonHandle>(null)
  const setPasswordButton = useRef<ButtonHandle>(null)

  const loginX = useRef<ButtonHandle>(null)
  const loginApple = useRef<ButtonHandle>(null)
  const loginGoogle = useRef<ButtonHandle>(null)

  /** The provider sign-in in flight; a newer press or its end abandons it. */
  const providerAttempt = useRef<AbortController | undefined>(undefined)
  useEffect(() => () => { providerAttempt.current?.abort() }, [])

  /** Put the form back as it was before the press: no cover, no provider in progress. */
  const releaseProviderForm = (): void => {
    props.cover?.hide()
    for (const provider of [loginX, loginApple, loginGoogle]) provider.current?.loadingStatus(false)
  }

  // A provider sign-in an embedding shell ran and lost leaves nothing in progress.
  useEffect(() => oauthService.onEnded(() => {
    providerAttempt.current?.abort()
    releaseProviderForm()
  }), [props.cover])

  /** The screen's root class, which the stylesheet keys on. */
  const componentName = 'authenticate'

  const streamInterval = useRef<ReturnType<typeof setInterval> | undefined>(undefined)

  const getCurrentReferrer = () => {

    const from = props.location?.state?.from?.pathname
    const fromPathName = props.location?.state?.from?.pathname?.pathname

    const storedReferrer = storageService.getItem('authReferrer')

    const routeAuthPaths = {
      home: routeService.routeConfig.home.path,
      signIn: routeService.routeConfig.signIn.path,
      signUp: routeService.routeConfig.signUp.path,
    }

    if (!fromPathName) {
      if (storedReferrer) {
        return storedReferrer
      } else {
        return routeAuthPaths.home
      }
    } else {
      if (
        fromPathName.startsWith(routeAuthPaths.signIn) ||
        fromPathName.startsWith(routeAuthPaths.signUp)
      ) {
        if (storedReferrer) {
          return storedReferrer
        } else {
          return routeAuthPaths.home
        }
      } else {
        const { pathname = '', search = '', hash = '' } = from ?? {}
        const referrer = `${pathname}${search}${hash}`
        storageService.setItem('authReferrer', referrer)
        return referrer
      }
    }
  }

  // Where to return the reader once they are through; resolved once, because
  // the value depends on where they arrived from.
  const referrerRef = useRef<string | null>(null)
  referrerRef.current ??= getCurrentReferrer()
  const referrer = referrerRef.current

  useEffect(() => {
    if (props.match?.params?.authType === 'mfa' && !api.hasPendingMfaChallenge()) {
      routeService.navigateRoute('/sign-in')
    }
  }, [props.match?.params?.authType])

  useEffect(() => {
    events.on('confetti:show', guid, () => {
      const jsConfetti = new JSConfetti()
      void jsConfetti.addConfetti({
        confettiRadius: 8,
        confettiColors: configService.confettiColors,
      })
    })
    return () => {
      events.off('confetti:show', guid)
      if (streamInterval.current !== undefined) clearInterval(streamInterval.current)
    }
  }, [guid])


  const showModal = (header: string, content: string): void => {
    eventService.dispatchObjectEvent('show:modal', { header, content, buttonText: t('action.ok') })
  }

  const errorCode = (responseError: unknown): string | undefined =>
    responseError instanceof api.AevenApiError ? responseError.message : undefined

  const signUp = () => {
    const email = emailInput.current?.value.trim()
    const password = passwordInput.current?.value.trim()
    const passwordConfirm = passwordConfirmInput.current?.value.trim()

    if (!email || email === '') {
      eventService.dispatchObjectEvent('show:modal', {
        type: 'alertModal',
        header: t('field.email'),
        content: t('modal.emailMissing'),
        buttonText: t('action.ok'),
      })

      return
    }

    if (!utilityService.isEmail(email)) {
      eventService.dispatchObjectEvent('show:modal', {
        type: 'alertModal',
        header: t('field.email'),
        content: t('modal.emailInvalid'),
        buttonText: t('action.ok'),
      })

      return
    }

    if (!password || password === '') {
      eventService.dispatchObjectEvent('show:modal', {
        type: 'alertModal',
        header: t('field.password'),
        content: t('modal.passwordRules'),

        buttonText: t('action.ok'),
      })

      return
    }

    if (password !== passwordConfirm) {
      eventService.dispatchObjectEvent('show:modal', {
        type: 'alertModal',
        header: t('field.password'),
        content: t('modal.passwordMismatch'),
        buttonText: t('action.ok'),
      })

      return
    }

    if (!utilityService.isValidPassword(password)) {
      eventService.dispatchObjectEvent('show:modal', {
        type: 'alertModal',
        header: t('field.password'),
        content: t('modal.passwordRules'),

        buttonText: t('action.ok'),
      })

      return
    }

    signUpEmailButton.current?.loadingStatus(true)

    appService
      .signUp(email, password)
      .then(() => {
        {
          storageService.setItem('email', email)

          routeService.navigateRoute(
            utilityService.href('/sign-up/verify', false),
          )
        }

        signUpEmailButton.current?.loadingStatus(false)
      })
      .catch((responseError: unknown) => {
        const code = responseError instanceof api.AevenApiError ? responseError.message : undefined
        if (code === 'mfa-required') {
          routeService.navigateRoute('/sign-in/mfa')
        } else if (code !== 'user-exists' && code !== 'social-id-exists') {
          eventService.dispatchObjectEvent('show:modal', {
            type: 'alertModal',
            header: t('modal.oops'),
            content: t('modal.genericFailure'),
            buttonText: t('action.ok'),
          })
        } else {
          if (code === 'user-exists') {
            eventService.dispatchObjectEvent('show:modal', {
              type: 'alertModal',
              header: t('modal.accountExists'),
              content: t('modal.accountExistsPassword'),
              buttonText: t('action.ok'),
            })
          } else {
            eventService.dispatchObjectEvent('show:modal', {
              type: 'alertModal',
              header: t('modal.accountExists'),
              content: t('modal.accountExistsSocial'),
              buttonText: t('action.ok'),
            })
          }
        }

        signUpEmailButton.current?.loadingStatus(false)
      })
  }

  const signIn = () => {

    const email = emailInput.current?.value.trim()
    const password = passwordInput.current?.value.trim()

    if (!email || email === '') {
      eventService.dispatchObjectEvent('show:modal', {
        type: 'alertModal',
        header: t('field.email'),
        content: t('modal.emailMissing'),
        buttonText: t('action.ok'),
      })

      return
    }

    if (!utilityService.isEmail(email)) {
      eventService.dispatchObjectEvent('show:modal', {
        type: 'alertModal',
        header: t('field.email'),
        content: t('modal.emailInvalid'),
        buttonText: t('action.ok'),
      })

      return
    }

    if (!password || password === '') {
      eventService.dispatchObjectEvent('show:modal', {
        type: 'alertModal',
        header: t('field.password'),
        content: t('modal.passwordMissing'),

        buttonText: t('action.ok'),
      })

      return
    }

    signInButton.current?.loadingStatus(true)

    appService
      .signIn(email, password)
      .then(() => {
        getInitData()
      })
      .catch((responseError: unknown) => {
        signInButton.current?.loadingStatus(false)

        const code = errorCode(responseError)

        if (code === 'mfa-required') {
          routeService.navigateRoute('/sign-in/mfa')
        } else if (code === 'too-many-attempts') {
          eventService.dispatchObjectEvent('show:modal', {
            type: 'alertModal',
            header: t('modal.blocked'),
            content: t('modal.tooManyAttempts'),
            buttonText: t('action.ok'),
          })
        } else if (code === 'email-not-verified') {
          // The account exists and was never verified: a fresh code goes out
          // and the reader continues at the verification step.
          storageService.setItem('email', email)
          appService.resendCode(email).catch(() => {
            // The step's own Resend button asks again.
          })
          routeService.navigateRoute(utilityService.href('/sign-up/verify', false))
          showModal(t('modal.emailNotVerified'), t('modal.emailNotVerifiedBody'))
        } else if (code === undefined || ((responseError as api.AevenApiError).status ?? 500) >= 500) {
          showModal(t('modal.oops'), t('modal.genericFailure'))
        } else {
          eventService.dispatchObjectEvent('show:modal', {
            type: 'alertModal',
            header: t('modal.oopsExclaim'),
            content: t('modal.invalidCredentials'),
            buttonText: t('action.ok'),
          })
        }
      })

    function getInitData() {
      appService
        .getInitData()
        .then(() => {
          // The button keeps its progress state. The boot gate takes over from
          // here and covers the screen, so clearing it here showed the reader an
          // idle button between the wait and the transition — which reads as a
          // failure that quietly restarted.
          if (!referrer) {
            routeService.navigateRoute(utilityService.href('/', false))
          } else {
            routeService.navigateRoute(utilityService.href(referrer, false))
          }
        })
        .catch((responseError: unknown) => {
          console.log(responseError)
          signInButton.current?.loadingStatus(false)
        })
    }
  }

  /**
   * Reach a provider by whichever flow the deployment states.
   *
   * A `redirect` deployment takes this document to the provider, which returns
   * it to `/oauth-result`. A `window` deployment opens a separate window and
   * leaves this document where it is, so the reader keeps the page they asked
   * for; that window finishes the sign-in and this one picks the session up as
   * it does after the email form.
   *
   * The cover rises from the press on and the pressed button shows progress, so a
   * reader coming back from a finished sign-in never sees an idle form. A reader
   * who comes back without finishing gets the form back as it was; the wait goes
   * on unseen, so finishing in the browser afterwards still signs them in, and
   * pressing any provider starts over.
   * @param url - the provider's sign-in URL, absent when the deployment offers that provider.
   * @param button - the button that was pressed.
   */
  const beginProviderSignIn = (url: string | undefined, button: RefObject<ButtonHandle | null>): void => {
    if (url === undefined) return
    for (const provider of [loginX, loginApple, loginGoogle]) provider.current?.loadingStatus(provider === button)
    if (configService.oauthFlow() === 'redirect') {
      location.href = url
      return
    }
    providerAttempt.current?.abort()
    const attempt = new AbortController()
    providerAttempt.current = attempt
    props.cover?.show()
    oauthService.open(url)
    oauthService.watchReturn(releaseProviderForm, attempt.signal)
    // The session exists once the wait ends, so the screen hands over at once:
    // the boot gate reads the session under the cover and returns here if there
    // is none.
    void oauthService.awaitSession(attempt.signal).then((signedIn) => {
      attempt.abort()
      if (signedIn) routeService.navigateRoute(utilityService.href(referrer, false), routes.AUTH_EXIT_ELSEWHERE)
    })
  }

  const signInOauth = (provider: string) => {
    switch (provider) {
      default:
        break

      case 'x':
        {
          beginProviderSignIn(configService.oauth.xOAuth, loginX)
        }
        break

      case 'apple':
        {
          beginProviderSignIn(configService.oauth.appleOAuth, loginApple)
        }
        break

      case 'google':
        {
          beginProviderSignIn(configService.oauth.googleOAuth, loginGoogle)
        }
        break
    }
  }

  const forgotPassword = (): void => {
    const email = emailInput.current?.value.trim()
    if (email) storageService.setItem('email', email)
    routeService.navigateRoute(utilityService.href('/sign-in/forgot', false))
  }

  /** Popup for a refused verification or reset code. */
  const showCodeError = (code: string | undefined): void => {
    if (code === 'invalid-code') showModal(t('field.verificationCode'), t('modal.codeInvalid'))
    else if (code === 'expired-code') showModal(t('field.verificationCode'), t('modal.codeExpired'))
    else if (code === 'too-many-attempts') showModal(t('modal.blocked'), t('modal.tooManyCodeAttempts'))
    else showModal(t('modal.oops'), t('modal.genericFailure'))
  }

  const requestReset = (): void => {
    const email = emailInput.current?.value.trim()

    if (!email) {
      showModal(t('field.email'), t('modal.emailMissing'))
      return
    }

    if (!utilityService.isEmail(email)) {
      showModal(t('field.email'), t('modal.emailInvalid'))
      return
    }

    forgotSendButton.current?.loadingStatus(true)

    appService
      .forgotPassword(email)
      .then(() => {
        forgotSendButton.current?.loadingStatus(false)
        storageService.setItem('email', email)
        routeService.navigateRoute(utilityService.href('/sign-in/reset', false))
        showModal(t('modal.resetCodeSent'), t('modal.resetCodeSentBody'))
      })
      .catch(() => {
        forgotSendButton.current?.loadingStatus(false)
        showModal(t('modal.oops'), t('modal.genericFailure'))
      })
  }

  const continueReset = (): void => {
    const email = storageService.getItem('email')
    const code = verifyInput.current?.value ?? ''

    if (!email) {
      routeService.navigateRoute(utilityService.href('/sign-in/forgot', false))
      return
    }

    if (code.length !== 6) {
      showModal(t('field.verificationCode'), t('modal.codeMissing'))
      return
    }

    resetButton.current?.loadingStatus(true)

    appService
      .checkResetCode(email, code)
      .then(() => {
        resetButton.current?.loadingStatus(false)
        pendingResetCode = code
        routeService.navigateRoute(utilityService.href('/sign-in/new-password', false))
      })
      .catch((responseError: unknown) => {
        resetButton.current?.loadingStatus(false)
        verifyInput.current?.clear()
        showCodeError(errorCode(responseError))
      })
  }

  const setPassword = (): void => {
    const email = storageService.getItem('email')
    const code = pendingResetCode
    const password = passwordInput.current?.value.trim()
    const passwordConfirm = passwordConfirmInput.current?.value.trim()

    if (!email || code === undefined) {
      routeService.navigateRoute(utilityService.href('/sign-in/reset', false))
      return
    }

    if (!password || !utilityService.isValidPassword(password)) {
      showModal(t('field.newPassword'), t('modal.passwordRules'))
      return
    }

    if (password !== passwordConfirm) {
      showModal(t('field.newPassword'), t('modal.passwordMismatch'))
      return
    }

    setPasswordButton.current?.loadingStatus(true)

    appService
      .resetPassword(email, code, password)
      .then(() => {
        setPasswordButton.current?.loadingStatus(false)
        pendingResetCode = undefined
        routeService.navigateRoute(utilityService.href('/sign-in/email', false))
        showModal(t('modal.passwordChanged'), t('modal.passwordChangedBody'))
      })
      .catch((responseError: unknown) => {
        setPasswordButton.current?.loadingStatus(false)
        const errorName = errorCode(responseError)
        if (errorName === 'invalid-password') {
          showModal(t('field.newPassword'), t('modal.passwordRules'))
          return
        }
        // The code stopped being valid after it was checked: the reader needs a new one.
        pendingResetCode = undefined
        routeService.navigateRoute(utilityService.href('/sign-in/reset', false))
        showCodeError(errorName)
      })
  }

  const resendResetCode = (): void => {
    const email = storageService.getItem('email')
    if (!email) {
      routeService.navigateRoute(utilityService.href('/sign-in/forgot', false))
      return
    }

    resetResendButton.current?.loadingStatus(true)

    appService
      .forgotPassword(email)
      .then(() => {
        resetResendButton.current?.loadingStatus(false)
        showModal(t('modal.codeSent'), t('modal.codeSentBody'))
      })
      .catch(() => {
        resetResendButton.current?.loadingStatus(false)
        showModal(t('modal.oops'), t('modal.genericFailure'))
      })
  }

  const verifyCode = () => {
    let codeValue

    const email = storageService.getItem('email')
    const codeArray = verifyInput.current?.value

    if (!email) {
      routeService.navigateRoute(utilityService.href('/sign-up/email', false))
      return
    }

    if (!codeArray) {
      codeValue = ''
    } else {
      codeValue = codeArray
    }

    if (codeValue.length !== 6) {
      eventService.dispatchObjectEvent('show:modal', {
        type: 'alertModal',
        header: t('field.verificationCode'),
        content: t('modal.codeMissing'),
        buttonText: t('action.ok'),
      })

      return
    }

    signUpVerifyButton.current?.loadingStatus(true)

    appService
      .verifyEmail(email, codeValue)
      .then(() => {
        {
          routeService.navigateRoute(
            utilityService.href('/sign-in/email', false),
          )

          eventService.dispatchObjectEvent('show:modal', {
            type: 'alertModal',
            header: t('modal.accountCreated'),
            content: t('modal.accountCreatedBody'),
            buttonText: t('action.ok'),
          })

          eventService.dispatchObjectEvent('confetti:show', true)
        }

        signUpVerifyButton.current?.loadingStatus(false)
      })
      .catch((responseError: unknown) => {
        signUpVerifyButton.current?.loadingStatus(false)
        verifyInput.current?.clear()
        showCodeError(errorCode(responseError))
      })
  }

  const resendCode = (): void => {
    const email = storageService.getItem('email')
    if (!email) {
      routeService.navigateRoute(utilityService.href('/sign-up/email', false))
      return
    }

    signUpResendCodeButton.current?.loadingStatus(true)

    appService
      .resendCode(email)
      .then(() => {
        signUpResendCodeButton.current?.loadingStatus(false)
        showModal(t('modal.codeSent'), t('modal.codeSentBody'))
      })
      .catch((responseError: unknown) => {
        signUpResendCodeButton.current?.loadingStatus(false)
        if (errorCode(responseError) === 'email-already-verified') {
          routeService.navigateRoute(utilityService.href('/sign-in/email', false))
          showModal(t('modal.accountExists'), t('modal.alreadyVerified'))
        } else {
          showModal(t('modal.oops'), t('modal.genericFailure'))
        }
      })
  }

  const getAuthPath = () => {
    const path = props.match?.path ?? ''
    return path.split('/')[1] ?? ''
  }

  const getAuthType = () => {
    const authType = props.match?.params?.authType
    return authType
  }

  /**
   * The provider list this step was chosen from, or undefined when the step has
   * nowhere above it. Only an email step is entered from a list, so only an
   * email step has a header and a way back to it.
   * @returns the path of the screen the reader came from.
   */
  const getBackTarget = (): string | undefined => {
    switch (getAuthType()) {
      case 'email':
        return getAuthPath() === 'sign-up'
          ? routeService.routeConfig.signUp.path
          : routeService.routeConfig.signIn.path
      case 'verify':
        return '/sign-up/email'
      case 'forgot':
        return '/sign-in/email'
      case 'reset':
        return '/sign-in/forgot'
      case 'new-password':
        return '/sign-in/reset'
      default:
        return undefined
    }
  }


  const authComponent = () => {
    let headerTxt
    let mode: 'signIn' | 'signUp' = 'signIn'

    let emailButtonHref = ''

    let subContentTxt = ''
    let subContentButtonTxt = ''
    let subContentButtonHref = ''

    const pathName = window.location.pathname

    if (pathName.startsWith(routeService.routeConfig.signUp.path)) {
      headerTxt = t('signUp.title')
      mode = 'signUp'

      emailButtonHref = '/sign-up/email'

      subContentTxt = t('signUp.altPrompt')
      subContentButtonTxt = t('action.signIn')
      subContentButtonHref = '/sign-in'
    }

    if (pathName.startsWith(routeService.routeConfig.signIn.path)) {
      headerTxt = t('signIn.title')
      mode = 'signIn'

      emailButtonHref = '/sign-in/email'

      subContentTxt = t('signIn.altPrompt')
      subContentButtonTxt = t('action.signUp')
      subContentButtonHref = '/sign-up'
    }

    return (
      <div className="form-container">
        <form className="form">
          <span className="form-title">{headerTxt}</span>
          <div className="action-container">
            <div className="button-container">
              <Button
                ref={signInEmailButton}
                type={'loaderButtonIcon'}
                cssClass={'loader-button-icon large'}
                label={t(`${mode}.withEmail`)}
                loading={false}
                icon={
                  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mail-icon mail"><path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"/><rect x="2" y="4" width="20" height="16" rx="2"/></svg>'
                }
                onClick={(event) => {
                  console.log('click', emailButtonHref)
                  event.preventDefault()
                  event.stopPropagation()

                  routeService.navigateRoute(
                    utilityService.href(emailButtonHref, false),
                  )
                }}
              />
            </div>
            <div className="separator">
              <div className="line" />
              <span className="txt">{t('separator.or')}</span>
              <div className="line" />
            </div>
            <div className="button-container">
              <Button
                ref={loginX}
                type={'loaderButtonIcon'}
                interruptible
                cssClass={'loader-button-icon large light'}
                label={t(`${mode}.withX`)}
                loading={false}
                icon={
                  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M10.4883 14.651L15.25 21H22.25L14.3917 10.5223L20.9308 3H18.2808L13.1643 8.88578L8.75 3H1.75L9.26086 13.0145L2.31915 21H4.96917L10.4883 14.651ZM16.25 19L5.75 5H7.75L18.25 19H16.25Z"></path></svg>'
                }
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()

                  signInOauth('x')
                }}
              />

              <Button
                ref={loginApple}
                type={'loaderButtonIcon'}
                interruptible
                cssClass={'loader-button-icon large light'}
                label={t(`${mode}.withApple`)}
                loading={false}
                icon={
                  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M11.6734 7.22198C10.7974 7.22198 9.44138 6.22598 8.01338 6.26198C6.12938 6.28598 4.40138 7.35397 3.42938 9.04597C1.47338 12.442 2.92538 17.458 4.83338 20.218C5.76938 21.562 6.87338 23.074 8.33738 23.026C9.74138 22.966 10.2694 22.114 11.9734 22.114C13.6654 22.114 14.1454 23.026 15.6334 22.99C17.1454 22.966 18.1054 21.622 19.0294 20.266C20.0974 18.706 20.5414 17.194 20.5654 17.11C20.5294 17.098 17.6254 15.982 17.5894 12.622C17.5654 9.81397 19.8814 8.46998 19.9894 8.40998C18.6694 6.47798 16.6414 6.26198 15.9334 6.21398C14.0854 6.06998 12.5374 7.22198 11.6734 7.22198ZM14.7934 4.38998C15.5734 3.45398 16.0894 2.14598 15.9454 0.849976C14.8294 0.897976 13.4854 1.59398 12.6814 2.52998C11.9614 3.35798 11.3374 4.68998 11.5054 5.96198C12.7414 6.05798 14.0134 5.32598 14.7934 4.38998Z"></path></svg>'
                }
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()

                  signInOauth('apple')
                }}
              />

              <Button
                ref={loginGoogle}
                type={'loaderButtonIcon'}
                interruptible
                cssClass={'loader-button-icon large light'}
                label={t(`${mode}.withGoogle`)}
                loading={false}
                icon={
                  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M3.06364 7.50914C4.70909 4.24092 8.09084 2 12 2C14.6954 2 16.959 2.99095 18.6909 4.60455L15.8227 7.47274C14.7864 6.48185 13.4681 5.97727 12 5.97727C9.39542 5.97727 7.19084 7.73637 6.40455 10.1C6.2045 10.7 6.09086 11.3409 6.09086 12C6.09086 12.6591 6.2045 13.3 6.40455 13.9C7.19084 16.2636 9.39542 18.0227 12 18.0227C13.3454 18.0227 14.4909 17.6682 15.3864 17.0682C16.4454 16.3591 17.15 15.3 17.3818 14.05H12V10.1818H21.4181C21.5364 10.8363 21.6 11.5182 21.6 12.2273C21.6 15.2727 20.5091 17.8363 18.6181 19.5773C16.9636 21.1046 14.7 22 12 22C8.09084 22 4.70909 19.7591 3.06364 16.4909C2.38638 15.1409 2 13.6136 2 12C2 10.3864 2.38638 8.85911 3.06364 7.50914Z"></path></svg>'
                }
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()

                  signInOauth('google')
                }}
              />
            </div>
          </div>
          <div className="subtext">
            <span className="txt">
              {subContentTxt}{' '}
              <a
                href={utilityService.href(subContentButtonHref, true)}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()

                  routeService.navigateRoute(
                    utilityService.href(subContentButtonHref, false),
                  )
                }}
              >
                {subContentButtonTxt}
              </a>
            </span>
          </div>
        </form>
        <div className="form-footer">
          <span>{t('legal.prefix')} </span>
          <a target="_blank" href="#">
            {t('legal.terms')}
          </a>{' '}
          <span>{t('legal.and')}</span>{' '}
          <a target="_blank" href="#">
            {t('legal.privacy')}
          </a>
        </div>
      </div>
    )
  }

  const authSignInComponent = () => {
    const headerTxt = t('signIn.title')

    const subContentTxt = t('signIn.altPrompt')
    const subContentButtonTxt = t('action.signUp')
    const subContentButtonHref = '/sign-up'

    return (
      <div className="form-container">
        <form className="form">
          <span className="form-title">{headerTxt}</span>
          <div className="signin-container">
            <div className="input-items">
              <div className="input-item">
                <span className="title-container">
                  <span className="title">{t('field.email')}</span>
                </span>
                <div className="input-container">
                  <Input
                    ref={emailInput}
                    inputType={'inputText'}
                    type={'text'}
                    cssClass={'input-text large square'}
                    placeholder={''}
                    defaultValue={''}
                    autoCapitalize={'none'}
                    autoCorrect={'off'}
                    spellCheck={false}
                    inputMode={'email'}
                    autoComplete={'email'}
                    onChange={() => {}}
                  />
                </div>
              </div>
              <div className="input-item">
                <span className="title-container">
                  <span className="title">{t('field.password')}</span>
                </span>
                <div className="input-container">
                  <Input
                    ref={passwordInput}
                    inputType={'inputText'}
                    type={'password'}
                    cssClass={'input-text large square'}
                    placeholder={''}
                    defaultValue={''}
                    autoCapitalize={'none'}
                    autoCorrect={'off'}
                    spellCheck={false}
                    autoComplete={'current-password'}
                    onChange={() => {}}
                  />
                </div>
              </div>
            </div>
            <div className="form-spacer" />
            <div className="button-container">
              <Button
                ref={signInButton}
                type={'loaderButton'}
                cssClass={'loader-button large center'}
                label={t('action.signIn')}
                loading={false}
                icon={
                  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mail-icon mail"><path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"/><rect x="2" y="4" width="20" height="16" rx="2"/></svg>'
                }
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()

                  signIn()
                }}
              />

              <Button
                ref={signInPasswordButton}
                type={'loaderButton'}
                cssClass={'loader-button large center light'}
                label={t('action.forgotPassword')}
                loading={false}
                icon={
                  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mail-icon mail"><path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"/><rect x="2" y="4" width="20" height="16" rx="2"/></svg>'
                }
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()

                  forgotPassword()
                }}
              />
            </div>
          </div>
          <div className="subtext">
            <span className="txt">
              {subContentTxt}{' '}
              <a
                href={utilityService.href(subContentButtonHref, true)}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()

                  routeService.navigateRoute(
                    utilityService.href(subContentButtonHref, false),
                  )
                }}
              >
                {subContentButtonTxt}
              </a>
            </span>
          </div>
        </form>
        <div className="form-footer">
          <span>{t('legal.prefix')} </span>
          <a target="_blank" href="#">
            {t('legal.terms')}
          </a>{' '}
          <span>{t('legal.and')}</span>{' '}
          <a target="_blank" href="#">
            {t('legal.privacy')}
          </a>
        </div>
      </div>
    )
  }

  const authSignupComponent = () => {



    const headerTxt = t('signUp.title')

    const subContentTxt = t('signUp.altPrompt')
    const subContentButtonTxt = t('action.signIn')
    const subContentButtonHref = '/sign-in'

    return (
      <div className="form-container">
        <form className="form">
          <span className="form-title">{headerTxt}</span>
          <div className="register-container">
            <div className="input-items">
              <div className="input-item">
                <span className="title-container">
                  <span className="title">{t('field.email')}</span>
                </span>
                <div className="input-container">
                  <Input
                    ref={emailInput}
                    inputType={'inputText'}
                    type={'text'}
                    cssClass={'input-text large square'}
                    placeholder={''}
                    defaultValue={''}
                    autoCapitalize={'none'}
                    autoCorrect={'off'}
                    spellCheck={false}
                    inputMode={'email'}
                    autoComplete={'email'}
                    onChange={() => {}}
                  />
                </div>
              </div>
              <div className="input-item">
                <span className="title-container">
                  <span className="title">{t('field.password')}</span>
                </span>
                <div className="input-container">
                  <Input
                    ref={passwordInput}
                    inputType={'inputText'}
                    type={'password'}
                    cssClass={'input-text large square'}
                    placeholder={''}
                    defaultValue={''}
                    autoCapitalize={'none'}
                    autoCorrect={'off'}
                    spellCheck={false}
                    autoComplete={'new-password'}
                    onChange={() => {}}
                  />
                </div>
              </div>
              <div className="input-item">
                <span className="title-container">
                  <span className="title">{t('field.confirmPassword')}</span>
                </span>
                <div className="input-container">
                  <Input
                    ref={passwordConfirmInput}
                    inputType={'inputText'}
                    type={'password'}
                    cssClass={'input-text large square'}
                    placeholder={''}
                    defaultValue={''}
                    autoCapitalize={'none'}
                    autoCorrect={'off'}
                    spellCheck={false}
                    autoComplete={'new-password'}
                    onChange={() => {}}
                  />
                </div>
              </div>
            </div>
            <div className="form-spacer" />
            <div className="button-container">
              <Button
                ref={signUpEmailButton}
                type={'loaderButton'}
                cssClass={'loader-button large center'}
                label={t('action.signUp')}
                loading={false}
                icon={
                  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mail-icon mail"><path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"/><rect x="2" y="4" width="20" height="16" rx="2"/></svg>'
                }
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()

                  signUp()
                }}
              />
            </div>
          </div>
          <div className="subtext">
            <span className="txt">
              {subContentTxt}{' '}
              <a
                href={utilityService.href(subContentButtonHref, true)}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()

                  routeService.navigateRoute(
                    utilityService.href(subContentButtonHref, false),
                  )
                }}
              >
                {subContentButtonTxt}
              </a>
            </span>
          </div>
        </form>
        <div className="form-footer">
          <span>{t('legal.prefix')} </span>
          <a target="_blank" href="#">
            {t('legal.terms')}
          </a>{' '}
          <span>{t('legal.and')}</span>{' '}
          <a target="_blank" href="#">
            {t('legal.privacy')}
          </a>
        </div>
      </div>
    )
  }

  const authVerifyComponent = () => {

    const headerTxt = t('verify.title')

    return (
      <div className="form-container">
        <form className="form">
          <span className="form-title">{headerTxt}</span>
          <div className="verification-container">
            <div className="input-items">
              <div className="input-item">
                <span className="title-container">
                  <span className="title">{t('field.verificationCode')}</span>
                </span>
                <div className="input-container">
                  <Input
                    ref={verifyInput}
                    inputType={'inputNumbers'}
                    type={'number'}
                    cssClass={'input-numbers large'}
                    placeholder={'•'}
                    defaultValue={''}
                    autoCapitalize={'none'}
                    autoCorrect={'off'}
                    spellCheck={false}
                    inputMode={'numeric'}
                    autoComplete={'one-time-code'}
                    onChange={() => {}}
                  />
                </div>
              </div>
            </div>
            <div className="info-txt">
              <span className="txt">{t('verify.info')}</span>
            </div>
            <div className="form-spacer" />
            <div className="button-container">
              <Button
                ref={signUpVerifyButton}
                type={'loaderButton'}
                cssClass={'loader-button large center'}
                label={t('action.verify')}
                loading={false}
                icon={
                  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mail-icon mail"><path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"/><rect x="2" y="4" width="20" height="16" rx="2"/></svg>'
                }
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()

                  verifyCode()
                }}
              />

              <Button
                ref={signUpResendCodeButton}
                type={'loaderButton'}
                cssClass={'loader-button large center light'}
                label={t('action.resendCode')}
                loading={false}
                icon={
                  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mail-icon mail"><path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"/><rect x="2" y="4" width="20" height="16" rx="2"/></svg>'
                }
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()

                  resendCode()
                }}
              />
            </div>
          </div>
          <div className="subtext"></div>
        </form>
        <div className="form-footer">
          <span>{t('legal.prefix')} </span>
          <a target="_blank" href="#">
            {t('legal.terms')}
          </a>{' '}
          <span>{t('legal.and')}</span>{' '}
          <a target="_blank" href="#">
            {t('legal.privacy')}
          </a>
        </div>
      </div>
    )
  }

  /**
   * Complete the challenge: read the profile, then return the reader where
   * they came from.
   * @returns the settled navigation.
   */
  const finishMfa = (): Promise<void> => api.getProfile().then(() => {
    if (oauth.isProviderLanding()) window.close()
    else routeService.navigateRoute(referrer || '/')
  })

  /** Load the profile behind an accepted code, which is the only work left. */
  const loadMfaProfile = (): void => {
    mfaConfirmButton.current?.loadingStatus(true)
    finishMfa().then(
      () => { mfaConfirmButton.current?.loadingStatus(false) },
      () => {
        mfaConfirmButton.current?.loadingStatus(false)
        setMfaFailure(t('mfa.failure'))
      },
    )
  }

  /** What has been typed into whichever code field the step is showing. */
  const mfaEntry = (): string => ((mfaRecovery ? mfaRecoveryInput.current?.value : mfaInput.current?.value) ?? '').trim()

  /** Empty the code field and put the caret back in it. */
  const clearMfaEntry = (): void => {
    if (mfaRecovery) {
      if (mfaRecoveryInput.current !== null) mfaRecoveryInput.current.value = ''
      mfaRecoveryInput.current?.focus()
      return
    }
    mfaInput.current?.clear()
    mfaInput.current?.focus()
  }

  /** Answer the challenge with one authenticator or recovery code. */
  const submitMfa = (): void => {
    if (mfaAccepted.current) {
      loadMfaProfile()
      return
    }
    const entered = mfaEntry()
    const field = t(mfaRecovery ? 'mfa.recoveryCode' : 'mfa.code')
    setMfaFailure(undefined)
    if (entered === '') {
      showModal(field, t('modal.codeMissing'))
      return
    }
    mfaConfirmButton.current?.loadingStatus(true)
    api.mfa('login', entered).then(() => {
      mfaAccepted.current = true
      return finishMfa()
    }).then(
      () => { mfaConfirmButton.current?.loadingStatus(false) },
      (failure: unknown) => {
        mfaConfirmButton.current?.loadingStatus(false)
        // The refusal is reported the way this surface reports every other
        // one. An accepted code is not offered again, so a failure past it is
        // the profile load rather than the challenge.
        if (mfaAccepted.current) {
          setMfaFailure(t('mfa.failure'))
          return
        }
        const refusal = errorCode(failure)
        if (refusal === 'too-many-attempts') showModal(t('modal.blocked'), t('mfa.limited'))
        else if (refusal === 'expired-code') showModal(t('modal.blocked'), t('mfa.expired'))
        else if (refusal === 'code-already-used') showModal(field, t('mfa.used'))
        else showModal(field, t('mfa.error'))
        clearMfaEntry()
      },
    )
  }

  /** Switch the step between an authenticator code and a recovery code. */
  const toggleMfaRecovery = (): void => {
    setMfaRecovery(value => !value)
  }

  /*
   * The authenticator challenge is a second factor that arrives after the
   * password, so it takes the shape of the emailed-code step: the same sheet,
   * title scale, code field, info line and button rows, with this step's own
   * copy and operations.
   */
  const authMfaComponent = () => (
    <div className="form-container">
      <form className="form">
        <span className="form-title">{t('mfa.login')}</span>
        <div className="verification-container">
          <div className="input-items">
            <div className="input-item">
              <span className="title-container">
                <label className="title" htmlFor={mfaRecovery ? MFA_RECOVERY_INPUT_ID : 'n0'}>
                  {t(mfaRecovery ? 'mfa.recoveryCode' : 'mfa.code')}
                </label>
              </span>
              <div className="input-container">
                {mfaRecovery
                  ? <div className={'input-text large square'}>
                    <input
                      id={MFA_RECOVERY_INPUT_ID}
                      ref={mfaRecoveryInput}
                      type={'text'}
                      placeholder={''}
                      autoCapitalize={'none'}
                      autoCorrect={'off'}
                      spellCheck={false}
                      autoComplete={'one-time-code'}
                    />
                  </div>
                  : <Input
                    ref={mfaInput}
                    inputType={'inputNumbers'}
                    type={'number'}
                    cssClass={'input-numbers large'}
                    placeholder={'•'}
                    defaultValue={''}
                    autoCapitalize={'none'}
                    autoCorrect={'off'}
                    spellCheck={false}
                    inputMode={'numeric'}
                    autoComplete={'one-time-code'}
                    onChange={() => {}}
                  />}
              </div>
            </div>
          </div>
          <div className="info-txt">
            <span className="txt">{mfaFailure ?? t('mfa.loginInfo')}</span>
          </div>
          <div className="form-spacer" />
          <div className="button-container">
            <Button
              ref={mfaConfirmButton}
              type={'loaderButton'}
              cssClass={'loader-button large center'}
              label={t('mfa.confirm')}
              loading={false}
              icon={MFA_ICON}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                submitMfa()
              }}
            />

            <Button
              type={'loaderButton'}
              cssClass={'loader-button large center light'}
              label={t(mfaRecovery ? 'mfa.useApp' : 'mfa.useRecovery')}
              loading={false}
              icon={MFA_ICON}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                toggleMfaRecovery()
              }}
            />
          </div>
        </div>
      </form>
      {legalFooter()}
    </div>
  )

  const legalFooter = () => (
    <div className="form-footer">
      <span>{t('legal.prefix')} </span>
      <a target="_blank" href="#">
        {t('legal.terms')}
      </a>{' '}
      <span>{t('legal.and')}</span>{' '}
      <a target="_blank" href="#">
        {t('legal.privacy')}
      </a>
    </div>
  )

  const passwordField = (
    ref: React.RefObject<InputHandle>,
    title: string,
  ) => (
    <div className="input-item">
      <span className="title-container">
        <span className="title">{title}</span>
      </span>
      <div className="input-container">
        <Input
          ref={ref}
          inputType={'inputText'}
          type={'password'}
          cssClass={'input-text large square'}
          placeholder={''}
          defaultValue={''}
          autoCapitalize={'none'}
          autoCorrect={'off'}
          spellCheck={false}
          autoComplete={'new-password'}
          onChange={() => {}}
        />
      </div>
    </div>
  )

  const authForgotComponent = () => (
    <div className="form-container">
      <form className="form">
        <span className="form-title">{t('forgot.title')}</span>
        <div className="verification-container">
          <div className="input-items">
            <div className="input-item">
              <span className="title-container">
                <span className="title">{t('field.email')}</span>
              </span>
              <div className="input-container">
                <Input
                  ref={emailInput}
                  inputType={'inputText'}
                  type={'text'}
                  cssClass={'input-text large square'}
                  placeholder={''}
                  defaultValue={storageService.getItem('email') ?? ''}
                  autoCapitalize={'none'}
                  autoCorrect={'off'}
                  spellCheck={false}
                  inputMode={'email'}
                  autoComplete={'email'}
                  onChange={() => {}}
                />
              </div>
            </div>
          </div>
          <div className="info-txt">
            <span className="txt">{t('forgot.info')}</span>
          </div>
          <div className="form-spacer" />
          <div className="button-container">
            <Button
              ref={forgotSendButton}
              type={'loaderButton'}
              cssClass={'loader-button large center'}
              label={t('action.sendCode')}
              loading={false}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()

                requestReset()
              }}
            />
          </div>
        </div>
        <div className="subtext"></div>
      </form>
      {legalFooter()}
    </div>
  )

  // Laid out as the verification step: the same boxes, note, and buttons.
  const authResetComponent = () => (
    <div className="form-container">
      <form className="form">
        <span className="form-title">{t('reset.title')}</span>
        <div className="verification-container">
          <div className="input-items">
            <div className="input-item">
              <span className="title-container">
                <span className="title">{t('field.verificationCode')}</span>
              </span>
              <div className="input-container">
                <Input
                  ref={verifyInput}
                  inputType={'inputNumbers'}
                  cssClass={'input-numbers large'}
                  placeholder={'•'}
                  autoComplete={'one-time-code'}
                />
              </div>
            </div>
          </div>
          <div className="info-txt">
            <span className="txt">{t('verify.info')}</span>
          </div>
          <div className="form-spacer" />
          <div className="button-container">
            <Button
              ref={resetButton}
              type={'loaderButton'}
              cssClass={'loader-button large center'}
              label={t('action.continue')}
              loading={false}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()

                continueReset()
              }}
            />

            <Button
              ref={resetResendButton}
              type={'loaderButton'}
              cssClass={'loader-button large center light'}
              label={t('action.resendCode')}
              loading={false}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()

                resendResetCode()
              }}
            />
          </div>
        </div>
        <div className="subtext"></div>
      </form>
      {legalFooter()}
    </div>
  )

  // Laid out as the email sign-in step: two fields over the buttons.
  const authNewPasswordComponent = () => (
    <div className="form-container">
      <form className="form">
        <span className="form-title">{t('newPassword.title')}</span>
        <div className="signin-container">
          <div className="input-items">
            {passwordField(passwordInput, t('field.newPassword'))}
            {passwordField(passwordConfirmInput, t('field.confirmNewPassword'))}
          </div>
          <div className="form-spacer" />
          <div className="button-container">
            <Button
              ref={setPasswordButton}
              type={'loaderButton'}
              cssClass={'loader-button large center'}
              label={t('action.setPassword')}
              loading={false}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()

                setPassword()
              }}
            />
          </div>
        </div>
        <div className="subtext"></div>
      </form>
      {legalFooter()}
    </div>
  )

  const renderAuthComponent = () => {

    const authPath = getAuthPath()
    const authType = getAuthType()


    if (authType === 'mfa') {
      return authMfaComponent()
    }

    if (authPath === 'sign-in' && authType === 'forgot') return authForgotComponent()
    if (authPath === 'sign-in' && authType === 'reset') return authResetComponent()
    if (authPath === 'sign-in' && authType === 'new-password') return authNewPasswordComponent()

    if (authType !== 'email' && authType !== 'verify') {
      return authComponent()
    } else {
      if (authPath === 'sign-in') {
        if (authType === 'email') {
          return authSignInComponent()
        }
      }

      if (authPath === 'sign-up') {
        if (authType === 'email') {
          return authSignupComponent()
        }

        return authVerifyComponent()
      }
    }
  }

  const backTarget = getBackTarget()

  return (
    <>
      <div className={componentName + ' view '}>
        <div id="main-content" className="main-content">
          <div className="auth-header">
            {backTarget === undefined
              ? (
                <span className="auth-mark">
                  <AevenMark />
                </span>
              )
              : (
                <button
                  type="button"
                  className="auth-back"
                  aria-label={t('action.back')}
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()

                    routeService.navigateRoute(
                      utilityService.href(backTarget, false),
                    )
                  }}
                >
                  <span dangerouslySetInnerHTML={{ __html: BACK_ICON }} />
                </button>
              )}
          </div>
          <div className="content-container">
            {renderAuthComponent()}
            <div className="graphics-container"></div>
          </div>
        </div>
      </div>
    </>
  )
}

/* jscpd:ignore-end */

export default Authenticate
