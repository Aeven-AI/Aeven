/**
 * Phone → code → 2FA, or QR scan → 2FA, sign-in as a resumable state machine.
 *
 * The flow owns only progress and validation; every Telegram operation arrives
 * through {@link TelegramLoginPort}, so the state machine and the HTTP surface
 * above it run in tests without a network or an account.
 */

import { qrDataUrl } from './qr.ts'

/** Identity Telegram reports for the signed-in account. */
export interface TelegramIdentity {
  /** Telegram user id; the connector rejects a second row with the same one. */
  id: string
  /** Display name Telegram reports. */
  name?: string
  /** Public username without the leading `@`. */
  username?: string
  /** Phone number Telegram reports, without the leading `+`. */
  phone?: string
}

/**
 * Why a sign-in attempt stopped. Fixed values rather than Telegram's own error
 * text, which the browser must not render and which changes between versions.
 */
export type TelegramLoginFailure = 'code-invalid' | 'password-invalid' | 'phone-invalid' | 'too-many-attempts' | 'unreachable' | 'other'

/**
 * Sign-in progress: `code` and `password` are the steps a phone sign-in can require, and `qr` waits
 * for the Telegram app to scan the login code before the same `password` step.
 */
export type TelegramLoginState = 'login' | 'code' | 'qr' | 'password' | 'authorized' | 'unlinked' | 'failed'

/** One attempt as the connector and the browser see it. */
export interface TelegramLoginView {
  state: TelegramLoginState
  /** The number this attempt is signing in, once it was accepted. */
  phone?: string
  /** Present in the `failed` state. */
  reason?: TelegramLoginFailure
  /** Present in the `authorized` state. */
  identity?: TelegramIdentity
  /** SVG data URL of the current login QR code, present in the `qr` state once Telegram issued a token. */
  qr?: string
}

/** Progress reports the port raises while an attempt runs. */
export interface LoginHandlers {
  /**
   * Telegram issued a login token; it replaces the previous one, which expires.
   * @param link - the `tg://login` link the Telegram app scans.
   */
  qrCode(link: string): void
  /** Telegram requires the account's 2FA password before it completes sign-in. */
  passwordRequired(): void
  /** Telegram rejected the submitted code or password; the same step accepts another value. */
  retry(reason: TelegramLoginFailure): void
  /** Sign-in completed and the session is stored. */
  authorized(identity: TelegramIdentity): void
  /** The attempt cannot continue. */
  failed(reason: TelegramLoginFailure): void
}

/** What reading the stored account identity found. */
export type TelegramIdentityRead =
  | { kind: 'identity'; identity: TelegramIdentity }
  /** No session is stored, so the account has to sign in. */
  | { kind: 'none' }
  /** Telegram rejected the stored session; the account has to sign in again. */
  | { kind: 'rejected' }

/** The Telegram operations one attempt needs. */
export interface TelegramLoginPort {
  /**
   * Send a login code to `phone` and keep the attempt open for the code and password steps.
   * @param phone - international number, with or without a leading `+`.
   * @param handlers - progress reports for the rest of the attempt.
   * @returns the reason the attempt could not start, or undefined once Telegram delivered a code.
   */
  begin(phone: string, handlers: LoginHandlers): Promise<TelegramLoginFailure | undefined>
  /**
   * Request a login token for the Telegram app to scan and keep the attempt open for the scan and password steps.
   * @param handlers - progress reports for the rest of the attempt, including each refreshed token.
   * @returns the reason the attempt could not start, or undefined once Telegram issued the first token.
   */
  beginQr(handlers: LoginHandlers): Promise<TelegramLoginFailure | undefined>
  /**
   * Deliver the code Telegram sent.
   * @param code - digits from the Telegram message.
   */
  code(code: string): void
  /**
   * Deliver the account's 2FA password.
   * @param password - the password, never logged or echoed.
   */
  password(password: string): void
  /**
   * Read the stored account identity.
   * @param verify - also confirm with Telegram that the session still works.
   * @returns the identity, or that no session is stored or Telegram rejected it.
   */
  identity(verify: boolean): Promise<TelegramIdentityRead>
  /** Terminate the Telegram session and clear everything stored for it. */
  logOut(): Promise<void>
  /** Release connections the port holds, called when the daemon stops. */
  dispose?(): Promise<void>
}

/** Digits with an optional leading `+`, in the length range Telegram accepts. */
const phonePattern = /^\+?[0-9]{5,15}$/
/** Telegram sends 5- and 6-digit codes; accept the range and let Telegram reject the rest. */
const codePattern = /^[0-9]{3,8}$/
/** Telegram's own ceiling for 2FA passwords. */
const MAX_PASSWORD_LENGTH = 256

/** Read a JSON request body field as a trimmed non-empty string, or undefined. */
export function readField(body: unknown, field: string): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const value = (body as Record<string, unknown>)[field]
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** One sign-in attempt, from the number the user typed to the stored session. */
export class TelegramLoginFlow {
  private readonly port: TelegramLoginPort
  private state: TelegramLoginState = 'login'
  private phone: string | undefined
  private reason: TelegramLoginFailure | undefined
  private identityValue: TelegramIdentity | undefined
  private qr: string | undefined
  /** Set once the port reported the outcome, so a late report cannot reopen a settled attempt. */
  private settled = false

  /**
   * @param port - the Telegram operations this attempt drives.
   */
  constructor(port: TelegramLoginPort) {
    this.port = port
  }

  /** Current progress, reading the stored session when no attempt is running. */
  async status(verify = false): Promise<TelegramLoginView> {
    // A running attempt owns the state until Telegram settles it; probing would race the steps.
    if (this.state === 'code' || this.state === 'qr' || this.state === 'password') return this.view()
    // An identity this process just obtained is authoritative until the caller asks Telegram to confirm it.
    if (this.identityValue !== undefined && !verify) return this.view()
    const read = await this.port.identity(verify).catch((): TelegramIdentityRead => {
      // A port that cannot read its own storage reports no session, so the account is offered sign-in again.
      return { kind: 'none' }
    })
    if (read.kind === 'identity') {
      this.settled = true
      this.state = 'authorized'
      this.reason = undefined
      this.identityValue = read.identity
      this.phone = read.identity.phone ?? this.phone
    } else if (read.kind === 'rejected') {
      this.settled = true
      this.state = 'unlinked'
      this.reason = undefined
      this.identityValue = undefined
    } else {
      // No stored session. A terminal failure stays reported until the next attempt starts.
      if (this.state !== 'failed') {
        this.state = 'login'
        this.phone = undefined
      }
      this.identityValue = undefined
    }
    return this.view()
  }

  /**
   * Send a login code and wait for the next step.
   * @param phone - international number, with or without a leading `+`.
   * @returns the attempt state, `code` once Telegram accepted the number.
   */
  async start(phone: string): Promise<TelegramLoginView> {
    if (!phonePattern.test(phone)) return this.fail('phone-invalid')
    this.state = 'code'
    this.phone = phone.replace(/^\+/, '')
    this.reason = undefined
    this.qr = undefined
    this.settled = false
    const failure = await this.port.begin(this.phone, this.handlers())
    if (failure !== undefined && !this.settled) this.fail(failure)
    return this.view()
  }

  /**
   * Request a login QR code and wait for its first token.
   * @returns the attempt state, `qr` with the code to scan once Telegram issued it.
   */
  async startQr(): Promise<TelegramLoginView> {
    this.state = 'qr'
    this.phone = undefined
    this.reason = undefined
    this.qr = undefined
    this.settled = false
    const failure = await this.port.beginQr(this.handlers())
    if (failure !== undefined && !this.settled) this.fail(failure)
    return this.view()
  }

  /** Progress reports for one attempt; a report after the attempt settled changes nothing. */
  private handlers(): LoginHandlers {
    return {
      qrCode: (link) => { if (!this.settled && this.state === 'qr') this.qr = qrDataUrl(link) },
      passwordRequired: () => { if (!this.settled) { this.state = 'password'; this.reason = undefined; this.qr = undefined } },
      retry: (reason) => { if (!this.settled) this.reason = reason },
      authorized: (identity) => {
        if (this.settled) return
        this.settled = true
        this.state = 'authorized'
        this.reason = undefined
        this.qr = undefined
        this.identityValue = identity
      },
      failed: (reason) => { if (!this.settled) this.fail(reason) },
    }
  }

  /**
   * Deliver the code Telegram sent.
   * @param code - digits from the Telegram message.
   * @returns the attempt state, `authorized` or `password`.
   */
  code(code: string): TelegramLoginView {
    if (this.state !== 'code') return this.view()
    if (!codePattern.test(code)) return this.view()
    this.reason = undefined
    this.port.code(code)
    return this.view()
  }

  /**
   * Deliver the 2FA password when Telegram asked for it.
   * @param password - the account password.
   * @returns the attempt state.
   */
  password(password: string): TelegramLoginView {
    if (this.state !== 'password') return this.view()
    if (password.length === 0 || password.length > MAX_PASSWORD_LENGTH) return this.view()
    this.reason = undefined
    this.port.password(password)
    return this.view()
  }

  /** Terminate the Telegram session and forget the attempt. */
  async logout(): Promise<void> {
    this.settled = true
    await this.port.logOut()
    this.state = 'login'
    this.phone = undefined
    this.reason = undefined
    this.qr = undefined
    this.identityValue = undefined
  }

  /** Record a terminal failure. */
  private fail(reason: TelegramLoginFailure): TelegramLoginView {
    this.settled = true
    this.state = 'failed'
    this.reason = reason
    this.qr = undefined
    this.identityValue = undefined
    return this.view()
  }

  private view(): TelegramLoginView {
    return {
      state: this.state,
      ...this.phone === undefined ? {} : { phone: this.phone },
      ...this.reason === undefined ? {} : { reason: this.reason },
      ...this.identityValue === undefined ? {} : { identity: this.identityValue },
      ...this.state !== 'qr' || this.qr === undefined ? {} : { qr: this.qr },
    }
  }
}

/** Map a Telegram sign-in error to the fixed reason the browser shows. */
export function classifyLoginError(error: unknown): TelegramLoginFailure {
  const message = error instanceof Error ? error.message : String(error)
  if (/PHONE_CODE_INVALID|PHONE_CODE_EMPTY|PHONE_CODE_EXPIRED/i.test(message)) return 'code-invalid'
  if (/PASSWORD_HASH_INVALID|SESSION_PASSWORD_NEEDED/i.test(message)) return 'password-invalid'
  if (/PHONE_NUMBER_INVALID|PHONE_NUMBER_BANNED|PHONE_NUMBER_UNOCCUPIED/i.test(message)) return 'phone-invalid'
  if (/FLOOD_WAIT|TOO_MANY_ATTEMPTS|PHONE_CODE_TOO_MANY/i.test(message)) return 'too-many-attempts'
  if (/ECONN|ENOTFOUND|ETIMEDOUT|EREQUESTTIMEOUT|TIMEOUT|network/i.test(message)) return 'unreachable'
  return 'other'
}
