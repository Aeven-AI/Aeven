/**
 * teleproto-backed sign-in: the {@link TelegramLoginPort} the daemon drives against a real account.
 *
 * Telegram's own client offers long-running sign-in calls with callbacks — `start()` for a
 * phone number and `signInUserWithQrCode()` for a scanned login token — so the adapter holds
 * them open across HTTP requests: the code and password callbacks park on deferred values that
 * the control endpoints resolve, and each rejected step re-arms its deferred so the user can type
 * another code or password.
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Api, TelegramClient } from 'teleproto'
import { StringSession } from 'teleproto/sessions/index.js'
import { disconnect, entityName, getMe } from '../source/src/client.ts'
import { classifyLoginError, type LoginHandlers, type TelegramIdentity, type TelegramIdentityRead, type TelegramLoginFailure, type TelegramLoginPort } from './auth.ts'

/** The `start()` parameters this adapter supplies. */
export interface LoginStartParams {
  /** The number to sign in. */
  phoneNumber: () => Promise<string>
  /** Parked until the user submits the code Telegram sent. */
  phoneCode: () => Promise<string>
  /** Parked until the user submits the account's 2FA password. */
  password: () => Promise<string>
  /** Reports a rejected step; returning nothing lets Telegram's client continue. */
  onError: (error: Error) => void
}

/** The `signInUserWithQrCode()` parameters this adapter supplies. */
export interface QrSignInParams {
  /** Receives each login token Telegram issues; the client asks for a fresh one before the last expires. */
  qrCode: (code: { token: Buffer; expires: number }) => Promise<void>
  /** Parked until the user submits the account's 2FA password. */
  password: (hint?: string) => Promise<string>
  /** Reports a failure; returning true stops the sign-in. */
  onError: (error: Error) => Promise<boolean>
  /** Stops the token refresh when the attempt is abandoned. */
  abortSignal: AbortSignal
}

/**
 * The teleproto client surface the adapter drives. A test supplies its own
 * implementation, so the adapter's step handling runs without a network.
 */
export interface TelegramClientLike {
  start(params: LoginStartParams): Promise<void>
  connect(): Promise<unknown>
  signInUserWithQrCode(credentials: { apiId: number; apiHash: string }, params: QrSignInParams): Promise<unknown>
  getMe(): Promise<Api.User>
  logOut(): Promise<boolean>
  disconnect(): Promise<void>
}

/** Sign-in configuration: deployment-owned credentials plus the files the account owns. */
export interface TeleprotoLoginOptions {
  /** Telegram application id. */
  apiId: number
  /** Telegram application hash; never leaves the daemon. */
  apiHash: string
  /** File holding the session string, mode 0600. */
  sessionFile: string
  /** Cache of the signed-in identity, so `/status` answers without a round trip. */
  identityFile: string
  /** Client factory, replaced by tests. */
  createClient?: (session: StringSession, apiId: number, apiHash: string) => TelegramClientLike
}

/** A value the sign-in callbacks await and the control endpoints resolve. */
interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => { resolve = settle })
  return { promise, resolve }
}

/** One in-flight sign-in: the client Telegram's callbacks run against and the first-step signals. */
interface Attempt {
  generation: number
  handlers: LoginHandlers
  client: TelegramClientLike
  /** Settles once Telegram confirmed the code was delivered or issued the first login token. */
  firstStep: Deferred<TelegramLoginFailure | undefined>
  /** Stops a QR attempt's token refresh. */
  abort?: AbortController
}

/** Reasons Telegram's client lets the user retry with another value. */
function retryable(reason: TelegramLoginFailure): boolean {
  return reason === 'code-invalid' || reason === 'password-invalid'
}

/** Whether Telegram rejected the stored session itself, rather than the network failing. */
function sessionRejected(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /SESSION_REVOKED|SESSION_EXPIRED|AUTH_KEY_UNREGISTERED|AUTH_KEY_DUPLICATED|USER_DEACTIVATED|USER_DEACTIVATED_BAN/i.test(message)
}

/** Read the identity fields the connector identifies an account by. */
function identityOf(me: Api.User): TelegramIdentity {
  return {
    id: String(me.id),
    name: entityName(me),
    ...me.username === undefined || me.username === '' ? {} : { username: me.username },
    ...me.phone === undefined || me.phone === '' ? {} : { phone: me.phone },
  }
}

/** Sign-in over teleproto, with the session string and identity cached under the account's directory. */
export class TeleprotoLogin implements TelegramLoginPort {
  private readonly options: TeleprotoLoginOptions
  private generation = 0
  private attempt: Attempt | undefined
  private pendingCode: Deferred<string> | undefined
  private pendingPassword: Deferred<string> | undefined

  /**
   * @param options - credentials and account-owned files.
   */
  constructor(options: TeleprotoLoginOptions) {
    this.options = options
  }

  /** {@inheritDoc TelegramLoginPort.begin} */
  async begin(phone: string, handlers: LoginHandlers): Promise<TelegramLoginFailure | undefined> {
    await this.abort()
    // The client signs in through this session object, so it is the one whose string is stored.
    const session = new StringSession('')
    const attempt: Attempt = {
      generation: this.generation, handlers,
      client: this.client(session), firstStep: deferred<TelegramLoginFailure | undefined>(),
    }
    this.attempt = attempt
    void this.run(attempt, session, phone)
    return await attempt.firstStep.promise
  }

  /** {@inheritDoc TelegramLoginPort.beginQr} */
  async beginQr(handlers: LoginHandlers): Promise<TelegramLoginFailure | undefined> {
    await this.abort()
    // As with a phone sign-in, the client signs in through this session object, so it is the one stored.
    const session = new StringSession('')
    const attempt: Attempt = {
      generation: this.generation, handlers, abort: new AbortController(),
      client: this.client(session), firstStep: deferred<TelegramLoginFailure | undefined>(),
    }
    this.attempt = attempt
    void this.runQr(attempt, session)
    return await attempt.firstStep.promise
  }

  /** {@inheritDoc TelegramLoginPort.code} */
  code(value: string): void {
    const pending = this.pendingCode
    this.pendingCode = undefined
    pending?.resolve(value)
  }

  /** {@inheritDoc TelegramLoginPort.password} */
  password(value: string): void {
    const pending = this.pendingPassword
    this.pendingPassword = undefined
    pending?.resolve(value)
  }

  /** {@inheritDoc TelegramLoginPort.identity} */
  async identity(verify: boolean): Promise<TelegramIdentityRead> {
    if (!verify) return await this.cached()
    try {
      const identity = identityOf(await getMe())
      await this.writeIdentity(identity)
      return { kind: 'identity', identity }
    } catch (error) {
      if (sessionRejected(error)) {
        await this.clear()
        return { kind: 'rejected' }
      }
      // A transient failure keeps the last known link: the account is only reported
      // as unlinked when Telegram itself rejected the session.
      return await this.cached()
    }
  }

  /** {@inheritDoc TelegramLoginPort.logOut} */
  async logOut(): Promise<void> {
    await this.abort()
    const session = await this.readSession()
    if (session !== '') {
      const client = this.client(new StringSession(session))
      try {
        await client.logOut()
      } catch {
        // Without a network the phone keeps listing the session until it expires; the local session is cleared regardless.
      } finally {
        await client.disconnect().catch(() => {})
      }
    }
    await this.clear()
    await disconnect()
  }

  /** Drop any in-flight attempt and the client it holds. */
  async dispose(): Promise<void> {
    await this.abort()
    await disconnect()
  }

  /** Drive one attempt to its outcome, reporting every step to the flow. */
  private async run(attempt: Attempt, session: StringSession, phone: string): Promise<void> {
    const current = (): boolean => this.attempt === attempt && this.generation === attempt.generation
    try {
      await attempt.client.start({
        phoneNumber: async () => phone,
        phoneCode: async () => {
          if (!current()) throw new Error('AUTH_USER_CANCEL')
          // Reaching this callback means Telegram delivered a code, which is what
          // releases the caller's request; a rejected code parks here again.
          attempt.firstStep.resolve(undefined)
          const code = deferred<string>()
          this.pendingCode = code
          return await code.promise
        },
        password: async () => {
          if (!current()) throw new Error('AUTH_USER_CANCEL')
          attempt.handlers.passwordRequired()
          const password = deferred<string>()
          this.pendingPassword = password
          return await password.promise
        },
        onError: (error: Error) => {
          if (!current()) return
          const reason = classifyLoginError(error)
          if (retryable(reason)) {
            attempt.handlers.retry(reason)
            attempt.firstStep.resolve(reason)
            return
          }
          attempt.handlers.failed(reason)
          attempt.firstStep.resolve(reason)
        },
      })
      if (!current()) return
      await this.complete(attempt, session)
    } catch (error) {
      this.failAttempt(attempt, error)
    } finally {
      await this.release(attempt)
    }
  }

  /** Drive one QR attempt: show each token Telegram issues until the app scans one, then the password step. */
  private async runQr(attempt: Attempt, session: StringSession): Promise<void> {
    const current = (): boolean => this.attempt === attempt && this.generation === attempt.generation
    try {
      await attempt.client.connect()
      await attempt.client.signInUserWithQrCode({ apiId: this.options.apiId, apiHash: this.options.apiHash }, {
        qrCode: async ({ token }) => {
          if (!current()) return
          attempt.handlers.qrCode(`tg://login?token=${token.toString('base64url')}`)
          attempt.firstStep.resolve(undefined)
        },
        password: async () => {
          if (!current()) throw new Error('AUTH_USER_CANCEL')
          attempt.handlers.passwordRequired()
          const password = deferred<string>()
          this.pendingPassword = password
          return await password.promise
        },
        onError: async (error: Error) => {
          if (!current()) return true
          const reason = classifyLoginError(error)
          if (retryable(reason)) {
            attempt.handlers.retry(reason)
            return false
          }
          attempt.handlers.failed(reason)
          attempt.firstStep.resolve(reason)
          return true
        },
        abortSignal: attempt.abort!.signal,
      })
      if (!current()) return
      await this.complete(attempt, session)
    } catch (error) {
      this.failAttempt(attempt, error)
    } finally {
      await this.release(attempt)
    }
  }

  /** Store the session the client signed in through and report the account. */
  private async complete(attempt: Attempt, session: StringSession): Promise<void> {
    const identity = identityOf(await attempt.client.getMe())
    const saved = session.save()
    if (saved === '') throw new Error('Telegram sign-in produced no session to store')
    await this.writeSession(saved)
    await this.writeIdentity(identity)
    attempt.handlers.authorized(identity)
  }

  /** Report a sign-in that threw, unless a newer attempt replaced it. */
  private failAttempt(attempt: Attempt, error: unknown): void {
    if (this.attempt !== attempt || this.generation !== attempt.generation) return
    const reason = classifyLoginError(error)
    attempt.handlers.failed(reason)
    attempt.firstStep.resolve(reason)
  }

  /** Drop the attempt's client once its sign-in ended. */
  private async release(attempt: Attempt): Promise<void> {
    if (this.attempt === attempt) this.attempt = undefined
    attempt.abort?.abort()
    await attempt.client.disconnect().catch(() => {})
    // Telegram's own MCP client, if a tool call opened one, still holds the previous session.
    await disconnect()
  }

  /** Forget the running attempt so its callbacks stop reporting. */
  private async abort(): Promise<void> {
    this.generation += 1
    const attempt = this.attempt
    this.attempt = undefined
    this.pendingCode = undefined
    this.pendingPassword = undefined
    if (attempt === undefined) return
    attempt.abort?.abort()
    // Disconnecting settles the parked callbacks with a transport error the flow ignores.
    await attempt.client.disconnect().catch(() => {})
  }

  private client(session: StringSession): TelegramClientLike {
    const factory = this.options.createClient
    if (factory !== undefined) return factory(session, this.options.apiId, this.options.apiHash)
    return new TelegramClient(session, this.options.apiId, this.options.apiHash, { connectionRetries: 5 })
  }

  private async readSession(): Promise<string> {
    try {
      return (await readFile(this.options.sessionFile, 'utf8')).trim()
    } catch {
      // No session file yet means no account is signed in.
      return ''
    }
  }

  private async writeSession(session: string): Promise<void> {
    await mkdir(dirname(this.options.sessionFile), { recursive: true, mode: 0o700 })
    await writeFile(this.options.sessionFile, session, { mode: 0o600 })
  }

  /** The identity cached at sign-in, or that the account has no stored session. */
  private async cached(): Promise<TelegramIdentityRead> {
    // An identity without a session string cannot serve a tool call, so the account is not signed in.
    if (await this.readSession() === '') return { kind: 'none' }
    const identity = await this.readIdentity()
    return identity === undefined ? { kind: 'none' } : { kind: 'identity', identity }
  }

  private async readIdentity(): Promise<TelegramIdentity | undefined> {    try {
      const raw = JSON.parse(await readFile(this.options.identityFile, 'utf8')) as Partial<TelegramIdentity>
      if (typeof raw.id !== 'string' || raw.id === '') return undefined
      return {
        id: raw.id,
        ...typeof raw.name === 'string' ? { name: raw.name } : {},
        ...typeof raw.username === 'string' ? { username: raw.username } : {},
        ...typeof raw.phone === 'string' ? { phone: raw.phone } : {},
      }
    } catch {
      // A missing or unreadable cache means the identity is not known without asking Telegram.
      return undefined
    }
  }

  private async writeIdentity(identity: TelegramIdentity): Promise<void> {
    await mkdir(dirname(this.options.identityFile), { recursive: true, mode: 0o700 })
    await writeFile(this.options.identityFile, `${JSON.stringify(identity)}\n`, { mode: 0o600 })
  }

  private async clear(): Promise<void> {
    await rm(this.options.sessionFile, { force: true })
    await rm(this.options.identityFile, { force: true })
  }
}
