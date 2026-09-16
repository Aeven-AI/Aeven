/** Same-origin Web settings routes for Grok Build OAuth. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@aeven/host-webserver'
import type {} from '@aeven/llm'
import type { AuthEvent, AuthPrompt } from '@earendil-works/pi-ai'
import { CODING_OAUTH_CORE_ABI } from 'dsh-coding-oauth-core'
import { grokBuildAuthStatus, importGrokBuildSession, loginGrokBuildSession } from './auth.ts'
import type { CatalogSource } from './catalog.ts'
import type { DshCompatibility } from './compatibility.ts'
import { probeGrokAuth } from './grok-import.ts'
import { readJsonRequest, requestErrorStatus } from './http-json.ts'
import {
  CODING_OAUTH_LOGIN_CANCEL_PATH,
  CODING_OAUTH_LOGIN_CODE_PATH,
  CODING_OAUTH_LOGIN_PATH,
  CODING_OAUTH_LOGOUT_PATH,
  CODING_OAUTH_STATUS_PATH,
  type CodingOAuthProviderSlug,
  GROK_BUILD_AUTH_IMPORT_PATH,
  GROK_BUILD_AUTH_LOGIN_CANCEL_PATH,
  GROK_BUILD_AUTH_LOGIN_CODE_PATH,
  GROK_BUILD_AUTH_LOGIN_PATH,
  GROK_BUILD_AUTH_LOGOUT_PATH,
  GROK_BUILD_AUTH_STATUS_PATH,
  XAI_PI_PROVIDER,
} from './ids.ts'
import { loginGrokBuildPkce } from './oauth.ts'
import type { SubscriptionLoginMethod } from './oauth-providers.ts'
import type { OAuthProviderSession } from './oauth-session.ts'
import { safeMessage } from './redact.ts'
import type { GrokBuildSession } from './session.ts'
import type { AccountSummary, OAuthCredentialFileStore } from './store.ts'
import { LOOPBACK_OWNER_REQUEST_POLICY, type OwnerAccessMode, type OwnerRequestPolicy } from './web-origin.ts'
import { registerWebRouteSetupAtomically } from './web-routes.ts'

export {
  CODING_OAUTH_LOGIN_CANCEL_PATH,
  CODING_OAUTH_LOGIN_CODE_PATH,
  CODING_OAUTH_LOGIN_PATH,
  CODING_OAUTH_LOGOUT_PATH,
  CODING_OAUTH_STATUS_PATH,
  GROK_BUILD_AUTH_IMPORT_PATH,
  GROK_BUILD_AUTH_LOGIN_CANCEL_PATH,
  GROK_BUILD_AUTH_LOGIN_CODE_PATH,
  GROK_BUILD_AUTH_LOGIN_PATH,
  GROK_BUILD_AUTH_LOGOUT_PATH,
  GROK_BUILD_AUTH_STATUS_PATH,
} from './ids.ts'
/** Grok build login method. */
export type GrokBuildLoginMethod = 'pkce' | 'device'

/** Reported grok build web auth status. */
export type GrokBuildWebAuthStatus =
	| { status: 'signed-out'; grokImportAvailable: boolean }
	| {
	  status: 'signing-in'
	  method: GrokBuildLoginMethod
	  url?: string
	  userCode?: string
	  grokImportAvailable: boolean
	}
	| {
	  status: 'signed-in'
	  models: string[]
	  available: string[]
	  selected: string[]
	  catalogSource: CatalogSource
	  catalogError?: string
	  grokImportAvailable: boolean
	  accounts: AccountSummary[]
	  activeAccountId: string
	}
	| { status: 'error'; message: string; grokImportAvailable: boolean }

/** Login challenge. */
export interface LoginChallenge {
  method: GrokBuildLoginMethod
  url: string
  userCode?: string
}

/**
 * Map a device-code prompt event onto the challenge both web-auth classes
 * accept. Shared so the two classes cannot drift on how a device prompt is
 * advertised; `userCode` is omitted rather than passed empty, which is what
 * every consumer reads as "no code shown yet".
 * @param event - the device-code prompt event.
 * @returns the challenge to accept.
 */
function deviceCodeChallenge(event: Extract<AuthEvent, { type: 'device_code' }>): {
  method: 'device'
  url: string
  userCode?: string
} {
  return {
    method: 'device',
    url: event.verificationUri,
    ...(event.userCode.length > 0 ? { userCode: event.userCode } : {}),
  }
}

function waitForPromptAbort(prompt: AuthPrompt): Promise<string> {
  const signal = prompt.signal
  if (signal === undefined) return new Promise<string>(() => {})
  // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- every abort in this module passes an Error as the reason
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<string>((_resolve, reject) => {
    signal.addEventListener(
      'abort',
      () => {
        // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- every abort in this module passes an Error as the reason
        reject(signal.reason)
      },
      { once: true },
    )
  })
}

async function grokImportAvailable(): Promise<boolean> {
  return (await probeGrokAuth()).available
}

async function signedInAccountFields(store: OAuthCredentialFileStore): Promise<{
  accounts: AccountSummary[]
  activeAccountId: string
}> {
  const accounts = [...(await store.listAccounts())]
  const activeAccountId = await store.getActiveAccountId()
  if (activeAccountId === undefined || accounts.length === 0) {
    throw new Error('signed-in status requires at least one stored account')
  }
  return { accounts, activeAccountId }
}

/**
 * One lifecycle owner for the pending login (PKCE or device), the published
 * challenge, the pasted-code channel, and the public status.
 */
export class GrokBuildWebAuth {
  private state: GrokBuildWebAuthStatus = { status: 'signed-out', grokImportAvailable: false }
  private operation: Promise<void> | undefined
  private cancellation: AbortController | undefined
  private method: GrokBuildLoginMethod = 'pkce'
  private challenge: LoginChallenge | undefined
  private challengeWaiters: Array<{ resolve(value: LoginChallenge): void; reject(error: unknown): void }> = []
  private codeResolver: ((code: string) => void) | undefined

  constructor(private readonly session: GrokBuildSession) {}

  /**
   * Return the current state.
   * @returns The status.
   */
  async status(): Promise<GrokBuildWebAuthStatus> {
    if (this.operation !== undefined) return this.state
    if (this.state.status === 'error') {
      return { ...this.state, grokImportAvailable: await grokImportAvailable() }
    }
    return this.readStoredStatus()
  }

  /**
   * Start (or join) a login. A different method aborts and restarts the flow.
   * @param method - Method value.
   * @returns The resulting sign in.
   */
  async signIn(method: GrokBuildLoginMethod): Promise<LoginChallenge> {
    if (this.operation !== undefined && this.method !== method) {
      await this.cancel()
    }
    if (this.operation === undefined) this.start(method)
    if (this.challenge !== undefined) return this.challenge
    return new Promise<LoginChallenge>((resolve, reject) => {
      this.challengeWaiters.push({ resolve, reject })
    })
  }

  /**
   * Hand a pasted authorization code (or redirect URL) to a pending PKCE login.
   * @param code - Code value.
   */
  // oxlint-disable-next-line typescript/require-await -- the method throws, so async keeps the failure a rejection
  async submitCode(code: string): Promise<void> {
    const resolver = this.codeResolver
    if (resolver === undefined) {
      throw new Error('grok-build: no authorization-code login is waiting for a code')
    }
    this.codeResolver = undefined
    resolver(code)
  }

  /** Abort a pending login without touching any stored credential. */
  async cancel(): Promise<void> {
    this.cancellation?.abort(new Error('grok-build: sign-in cancelled'))
    await this.operation?.catch(() => undefined)
    this.codeResolver = undefined
    this.challenge = undefined
    this.state = await this.readStoredStatus()
  }

  /** Import grok. */
  async importGrok(): Promise<void> {
    this.cancellation?.abort(new Error('grok-build: sign-in cancelled'))
    await this.operation?.catch(() => undefined)
    this.codeResolver = undefined
    await importGrokBuildSession(this.session)
    this.challenge = undefined
    this.state = await this.readStoredStatus()
  }

  /** End the provider session and remove its stored credential. */
  async signOut(): Promise<void> {
    this.cancellation?.abort(new Error('grok-build: sign-in cancelled'))
    await this.operation?.catch(() => undefined)
    this.codeResolver = undefined
    await this.session.logout()
    this.state = { status: 'signed-out', grokImportAvailable: await grokImportAvailable() }
    this.challenge = undefined
  }

  /** Release resources owned by this instance. */
  async dispose(): Promise<void> {
    const failure = new Error('grok-build: plugin disposed')
    this.cancellation?.abort(failure)
    this.rejectChallenge(failure)
    await this.operation?.catch(() => undefined)
    this.codeResolver = undefined
    this.challenge = undefined
  }

  private start(method: GrokBuildLoginMethod): void {
    const cancellation = new AbortController()
    this.cancellation = cancellation
    this.method = method
    this.challenge = undefined
    this.state = { status: 'signing-in', method, grokImportAvailable: false }
    const run = method === 'pkce' ? this.runPkce(cancellation) : this.runDevice(cancellation)
    this.operation = run
      .then(
        async () => {
          this.state = await this.readStoredStatus()
        },
        (error: unknown) => {
          this.rejectChallenge(error)
          this.state = { status: 'error', message: safeMessage(error), grokImportAvailable: false }
        },
      )
      .finally(() => {
        this.operation = undefined
        this.cancellation = undefined
        this.codeResolver = undefined
      })
  }

  private async runPkce(cancellation: AbortController): Promise<void> {
    const credential = await loginGrokBuildPkce({
      signal: cancellation.signal,
      onAuthorizeUrl: (url) =>{  this.acceptChallenge({ method: 'pkce', url }) },
      awaitCode: signal =>
        new Promise<string>((resolve, reject) => {
          this.codeResolver = resolve
          const onAbort = (): void => {
            this.codeResolver = undefined
            reject(new Error('grok-build: sign-in cancelled'))
          }
          if (signal.aborted) {
            onAbort()
            return
          }
          signal.addEventListener('abort', onAbort, { once: true })
        }),
    })
    const written = await this.session.store.modify(XAI_PI_PROVIDER, () => credential)
    if (written === undefined || written.type !== 'oauth') {
      throw new Error('grok-build: failed to persist the login credential')
    }
    await this.session.refreshLiveCatalog()
  }

  private async runDevice(cancellation: AbortController): Promise<void> {
    await loginGrokBuildSession(
      {
        signal: cancellation.signal,
        prompt: prompt =>
          prompt.type === 'select'
            ? Promise.resolve(
              prompt.options.some(option => option.id === 'oauth') ? 'oauth' : (prompt.options[0]?.id ?? 'oauth'),
            )
            : waitForPromptAbort(prompt),
        notify: (event) => {
          this.onEvent(event)
        },
      },
      this.session,
    )
  }

  private onEvent(event: AuthEvent): void {
    if (event.type === 'device_code') {
      this.acceptChallenge(deviceCodeChallenge(event))
      return
    }
    if (event.type === 'auth_url') {
      this.acceptChallenge({ method: this.method, url: event.url })
    }
  }

  private acceptChallenge(challenge: LoginChallenge): void {
    try {
      const url = new URL(challenge.url)
      if (url.protocol !== 'https:') {
        const error = new Error('xAI returned an unsafe authorization URL')
        this.cancellation?.abort(error)
        this.rejectChallenge(error)
        return
      }
    } catch {
      const error = new Error('xAI returned an invalid authorization URL')
      this.cancellation?.abort(error)
      this.rejectChallenge(error)
      return
    }
    this.challenge = challenge
    this.state = {
      status: 'signing-in',
      method: challenge.method,
      url: challenge.url,
      grokImportAvailable: false,
      ...(challenge.userCode === undefined ? {} : { userCode: challenge.userCode }),
    }
    for (const waiter of this.challengeWaiters.splice(0)) waiter.resolve(challenge)
  }

  private async readStoredStatus(): Promise<GrokBuildWebAuthStatus> {
    const [stored, grok] = await Promise.all([grokBuildAuthStatus(this.session.store), grokImportAvailable()])
    if (!stored.authenticated) return { status: 'signed-out', grokImportAvailable: grok }
    const available = this.session.availableModels().map(model => model.id)
    const selected = this.session.selectedModelIds()
    const accounts = await signedInAccountFields(this.session.store)
    return {
      status: 'signed-in',
      models: this.session.visibleModels().map(model => model.id),
      available,
      selected: selected ?? available,
      catalogSource: this.session.catalogSource,
      grokImportAvailable: grok,
      ...accounts,
      ...(this.session.catalogError === undefined ? {} : { catalogError: this.session.catalogError }),
    }
  }

  private rejectChallenge(error: unknown): void {
    for (const waiter of this.challengeWaiters.splice(0)) waiter.reject(error)
  }
}

/** Reported subscription web auth status. */
export type SubscriptionWebAuthStatus = {
  provider: Exclude<CodingOAuthProviderSlug, 'grok'>
  route: string
  displayName: string
  loginMethods: readonly SubscriptionLoginMethod[]
  recommendedLoginMethod: SubscriptionLoginMethod
  models: string[]
  available: string[]
  selected: string[]
} & (
	| { status: 'signed-out' }
	| { status: 'signing-in'; method: SubscriptionLoginMethod; url?: string; userCode?: string }
	| { status: 'signed-in'; expiresAt?: number; accounts: AccountSummary[]; activeAccountId: string }
	| { status: 'error'; message: string }
)

/** Subscription login challenge. */
export interface SubscriptionLoginChallenge {
  method: SubscriptionLoginMethod
  url: string
  userCode?: string
}

function optionForLoginMethod(
  prompt: Extract<AuthPrompt, { type: 'select' }>,
  method: SubscriptionLoginMethod,
): string {
  const exactIds =
    method === 'device' ? ['device_code', 'device-code', 'device'] : ['browser', 'browser_login', 'browser-login']
  for (const id of exactIds) {
    if (prompt.options.some(option => option.id === id)) return id
  }
  const label = method === 'device' ? /device|headless/iu : /browser|pkce/iu
  return prompt.options.find(option => label.test(option.label))?.id ?? prompt.options[0]?.id ?? ''
}

/** Web lifecycle for one pi-ai subscription OAuth provider. */
export class SubscriptionWebAuth {
  private state: SubscriptionWebAuthStatus | undefined
  private operation: Promise<void> | undefined
  private cancellation: AbortController | undefined
  private method: SubscriptionLoginMethod
  private challenge: SubscriptionLoginChallenge | undefined
  private challengeWaiters: Array<{ resolve(value: SubscriptionLoginChallenge): void; reject(error: unknown): void }> =
    []
  private codeResolver: ((code: string) => void) | undefined

  constructor(
    readonly session: OAuthProviderSession,
    private readonly challengeTimeoutMs = 60_000,
  ) {
    this.method = session.definition.recommendedLoginMethod
  }

  /**
   * Return the current state.
   * @returns The status.
   */
  async status(): Promise<SubscriptionWebAuthStatus> {
    if (this.operation !== undefined && this.state !== undefined) return this.state
    return this.readStoredStatus()
  }

  /**
   * Start the provider sign-in flow.
   * @param method - Method value.
   * @returns The resulting sign in.
   */
  async signIn(method: SubscriptionLoginMethod): Promise<SubscriptionLoginChallenge> {
    if (!this.session.definition.loginMethods.includes(method)) {
      throw new Error(`${this.session.definition.route}: login method "${method}" is not supported`)
    }
    if (this.operation !== undefined && this.method !== method) await this.cancel()
    if (this.operation === undefined) this.start(method)
    if (this.challenge !== undefined) return this.challenge
    return new Promise<SubscriptionLoginChallenge>((resolve, reject) => {
      // The timeout only fires after `waiter` is registered below.
      const timer = setTimeout(() => {
        const index = this.challengeWaiters.indexOf(waiter)
        if (index >= 0) this.challengeWaiters.splice(index, 1)
        const failure = new Error(`${this.session.definition.route}: timed out waiting for an OAuth challenge`)
        this.cancellation?.abort(failure)
        reject(failure)
      }, this.challengeTimeoutMs)
      const waiter = {
        resolve: (challenge: SubscriptionLoginChallenge): void => {
          clearTimeout(timer)
          resolve(challenge)
        },
        reject: (error: unknown): void => {
          clearTimeout(timer)
          // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- callers pass through an Error from the abort reason
          reject(error)
        },
      }
      this.challengeWaiters.push(waiter)
    })
  }

  /**
   * Submit code.
   * @param code - Code value.
   */
  // oxlint-disable-next-line typescript/require-await -- the method throws, so async keeps the failure a rejection
  async submitCode(code: string): Promise<void> {
    const resolver = this.codeResolver
    if (resolver === undefined) {
      throw new Error(`${this.session.definition.route}: no authorization-code login is waiting for a code`)
    }
    this.codeResolver = undefined
    resolver(code)
  }

  /** Cancel the active operation. */
  async cancel(): Promise<void> {
    this.cancellation?.abort(new Error(`${this.session.definition.route}: sign-in cancelled`))
    await this.operation?.catch(() => undefined)
    this.codeResolver = undefined
    this.challenge = undefined
    this.state = await this.readStoredStatus()
  }

  /** End the provider session and remove its stored credential. */
  async signOut(): Promise<void> {
    this.cancellation?.abort(new Error(`${this.session.definition.route}: sign-in cancelled`))
    await this.operation?.catch(() => undefined)
    this.codeResolver = undefined
    await this.session.logout()
    this.challenge = undefined
    this.state = await this.readStoredStatus()
  }

  /** Release resources owned by this instance. */
  async dispose(): Promise<void> {
    this.cancellation?.abort(new Error(`${this.session.definition.route}: plugin disposed`))
    await this.operation?.catch(() => undefined)
    this.codeResolver = undefined
    this.rejectChallenge(new Error(`${this.session.definition.route}: plugin disposed`))
  }

  private baseStatus(): Omit<
    SubscriptionWebAuthStatus,
		'status' | 'method' | 'url' | 'userCode' | 'message' | 'expiresAt'
  > {
    // Every subscription model is offered, so `selected` mirrors `available`.
    const available = this.session.availableModels().map(model => model.id)
    const selected = available
    return {
      provider: this.session.definition.slug,
      route: this.session.definition.route,
      displayName: this.session.definition.displayName,
      loginMethods: this.session.definition.loginMethods,
      recommendedLoginMethod: this.session.definition.recommendedLoginMethod,
      models: this.session.visibleModels().map(model => model.id),
      available,
      selected,
    }
  }

  private async readStoredStatus(): Promise<SubscriptionWebAuthStatus> {
    const base = this.baseStatus()
    try {
      const stored = await this.session.status()
      if (!stored.authenticated) return { ...base, status: 'signed-out' }
      const accounts = await signedInAccountFields(this.session.store)
      return {
        ...base,
        status: 'signed-in',
        ...accounts,
        ...(stored.expiresAt === undefined ? {} : { expiresAt: stored.expiresAt }),
      }
    } catch (error: unknown) {
      return { ...base, status: 'error', message: safeMessage(error) }
    }
  }

  private start(method: SubscriptionLoginMethod): void {
    const cancellation = new AbortController()
    this.cancellation = cancellation
    this.method = method
    this.challenge = undefined
    this.state = { ...this.baseStatus(), status: 'signing-in', method }
    this.operation = this.run(cancellation)
      .then(
        async () => {
          if (this.challenge === undefined)
            this.rejectChallenge(new Error(`${this.session.definition.route}: login completed without a challenge`))
          this.state = await this.readStoredStatus()
        },
        (error: unknown) => {
          this.rejectChallenge(error)
          this.state = { ...this.baseStatus(), status: 'error', message: safeMessage(error) }
        },
      )
      .finally(() => {
        this.operation = undefined
        this.cancellation = undefined
        this.codeResolver = undefined
      })
  }

  private async run(cancellation: AbortController): Promise<void> {
    await this.session.login({
      signal: cancellation.signal,
      prompt: (prompt) => {
        if (prompt.type === 'select') return Promise.resolve(optionForLoginMethod(prompt, this.method))
        if (prompt.type === 'manual_code') return this.awaitCode(prompt, cancellation.signal)
        return Promise.reject(new Error(`${this.session.definition.route}: unsupported OAuth prompt ${prompt.type}`))
      },
      notify: (event) => {
        this.onEvent(event)
      },
    })
  }

  private awaitCode(prompt: AuthPrompt, cancellation: AbortSignal): Promise<string> {
    const signal = prompt.signal === undefined ? cancellation : AbortSignal.any([prompt.signal, cancellation])
    return new Promise<string>((resolve, reject) => {
      const resolver = (code: string): void => {
        signal.removeEventListener('abort', onAbort)
        resolve(code)
      }
      const onAbort = (): void => {
        if (this.codeResolver === resolver) this.codeResolver = undefined
        // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- every abort in this module passes an Error as the reason
        reject(signal.reason)
      }
      this.codeResolver = resolver
      if (signal.aborted) {
        onAbort()
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  private onEvent(event: AuthEvent): void {
    if (event.type === 'device_code') {
      this.acceptChallenge(deviceCodeChallenge(event))
      return
    }
    if (event.type === 'auth_url') this.acceptChallenge({ method: this.method, url: event.url })
  }

  private acceptChallenge(challenge: SubscriptionLoginChallenge): void {
    try {
      const url = new URL(challenge.url)
      if (url.protocol !== 'https:') throw new Error('authorization URL must use HTTPS')
    } catch (error) {
      const failure = new Error(`${this.session.definition.route}: invalid authorization URL`, { cause: error })
      this.cancellation?.abort(failure)
      this.rejectChallenge(failure)
      return
    }
    this.challenge = challenge
    this.state = {
      ...this.baseStatus(),
      status: 'signing-in',
      method: challenge.method,
      url: challenge.url,
      ...(challenge.userCode === undefined ? {} : { userCode: challenge.userCode }),
    }
    for (const waiter of this.challengeWaiters.splice(0)) waiter.resolve(challenge)
  }

  private rejectChallenge(error: unknown): void {
    for (const waiter of this.challengeWaiters.splice(0)) waiter.reject(error)
  }
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(value))
}

function readLoginMethod(body: unknown): GrokBuildLoginMethod {
  if (typeof body === 'object' && body !== null && 'method' in body && body.method === 'device') return 'device'
  return 'pkce'
}

/**
 * Register the plugin-owned OAuth routes when the Web server is composed.
 * @param ctx - Cordis context that owns the registration.
 * @param session - Provider session used by the operation.
 * @param existingAuth - Existing auth value.
 * @param ownerRequestPolicy - Owner request policy value.
 */
export function registerGrokBuildAuthRoutes(
  ctx: Context,
  session: GrokBuildSession,
  existingAuth?: GrokBuildWebAuth,
  ownerRequestPolicy: OwnerRequestPolicy = LOOPBACK_OWNER_REQUEST_POLICY,
): void {
  const auth = existingAuth ?? new GrokBuildWebAuth(session)
  const ownsAuth = existingAuth === undefined
  if (ownsAuth) {
    ctx.effect(() => () => auth.dispose(), 'dsh-subscription-auth: Grok OAuth auth lifetime')
  }
  ctx.effect(() => {
    const releaseRoutes = registerWebRouteSetupAtomically(ctx.webServer, webServer => [
      webServer.register({
        kind: 'exact',
        path: GROK_BUILD_AUTH_STATUS_PATH,
        handler: async (req, res) => {
          if (req.method !== 'GET') {  json(res, 405, { error: 'method not allowed' }); return }
          if (!ownerRequestPolicy.authorize(req).authorized) {  json(res, 403, { error: 'forbidden' }); return }
          json(res, 200, await auth.status())
        },
      }),
      webServer.register({
        kind: 'exact',
        path: GROK_BUILD_AUTH_LOGIN_PATH,
        handler: async (req, res) => {
          if (req.method !== 'POST') {  json(res, 405, { error: 'method not allowed' }); return }
          if (!ownerRequestPolicy.authorize(req).authorized) {  json(res, 403, { error: 'forbidden' }); return }
          try {
            json(res, 200, await auth.signIn(readLoginMethod(await readJsonRequest(req))))
          } catch (error: unknown) {
            json(res, requestErrorStatus(error, 500), { error: safeMessage(error) })
          }
        },
      }),
      webServer.register({
        kind: 'exact',
        path: GROK_BUILD_AUTH_LOGIN_CODE_PATH,
        handler: async (req, res) => {
          if (req.method !== 'POST') {  json(res, 405, { error: 'method not allowed' }); return }
          if (!ownerRequestPolicy.authorize(req).authorized) {  json(res, 403, { error: 'forbidden' }); return }
          await answerSubmittedCode(res, async () => {
            const body = await readJsonRequest(req)
            const code = readSubmittedCode(res, body)
            if (code === undefined) return false
            await auth.submitCode(code)
            return true
          })
        },
      }),
      webServer.register({
        kind: 'exact',
        path: GROK_BUILD_AUTH_LOGIN_CANCEL_PATH,
        handler: async (req, res) => {
          if (req.method !== 'POST') {  json(res, 405, { error: 'method not allowed' }); return }
          if (!ownerRequestPolicy.authorize(req).authorized) {  json(res, 403, { error: 'forbidden' }); return }
          await auth.cancel()
          json(res, 200, await auth.status())
        },
      }),
      webServer.register({
        kind: 'exact',
        path: GROK_BUILD_AUTH_IMPORT_PATH,
        handler: (req, res) => {
          if (req.method !== 'POST') {  json(res, 405, { error: 'method not allowed' }); return }
          if (!ownerRequestPolicy.authorize(req).authorized) {  json(res, 403, { error: 'forbidden' }); return }
          json(res, 410, { error: 'legacy import retired; use OAuth Pull preview and confirmation' })
        },
      }),
      webServer.register({
        kind: 'exact',
        path: GROK_BUILD_AUTH_LOGOUT_PATH,
        handler: async (req, res) => {
          if (req.method !== 'POST') {  json(res, 405, { error: 'method not allowed' }); return }
          if (!ownerRequestPolicy.authorize(req).authorized) {  json(res, 403, { error: 'forbidden' }); return }
          await auth.signOut()
          json(res, 200, { ok: true })
        },
      }),
    ])
    return releaseRoutes
  }, 'dsh-subscription-auth: Web OAuth routes')
}

/** Reported coding oauth web status. */
export interface CodingOAuthWebStatus {
  accessMode: OwnerAccessMode
  uiOwner: 'standalone' | 'hub'
  compatibility: DshCompatibility
  providers: {
    grok: GrokBuildWebAuthStatus
    codex: SubscriptionWebAuthStatus
    claude: SubscriptionWebAuthStatus
  }
}

function recordBody(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error('request body must be an object')
  }
  return body as Record<string, unknown>
}

function providerSlug(body: unknown): CodingOAuthProviderSlug {
  const provider = recordBody(body)['provider']
  if (provider === 'grok' || provider === 'codex' || provider === 'kimi' || provider === 'claude') return provider
  throw new Error('provider must be one of grok, codex, kimi, or claude')
}

/**
 * Read the pasted authorization code from a parsed request body, answering 400
 * itself when it is missing or not a non-empty string. Shared so both login-code
 * routes cannot drift on what they accept.
 * @param res - the response to answer on refusal.
 * @param body - the parsed request body.
 * @returns the code, or `undefined` when the response is already sent.
 */
function readSubmittedCode(res: ServerResponse, body: unknown): string | undefined {
  const code = typeof body === 'object' && body !== null ? (body as Record<string, unknown>)['code'] : undefined
  if (typeof code !== 'string' || code.trim().length === 0) {
    json(res, 400, { error: 'code must be a non-empty string' })
    return undefined
  }
  return code
}

/**
 * Answer a pasted-code submit route. The body runs inside the try, so a refusal
 * either request read raises is still mapped onto the same status these routes
 * already returned. `submit` returns `false` when `readSubmittedCode` already
 * answered with 400, in which case no success body is sent.
 * @param res - the response to answer on.
 * @param submit - the route body; `false` when it already answered.
 * @returns nothing; the response is settled.
 */
async function answerSubmittedCode(res: ServerResponse, submit: () => Promise<boolean>): Promise<void> {
  try {
    if (!(await submit())) return
    json(res, 200, { ok: true })
  } catch (error: unknown) {
    json(res, requestErrorStatus(error, 409), { error: safeMessage(error) })
  }
}

/**
 * Run the shared POST + owner-origin guard for a management route, answering
 * 405/403 itself. Shared so every management route refuses the same way.
 * @param req - the incoming request.
 * @param res - the response to answer on refusal.
 * @param policy - the owner-request policy guarding the route.
 * @returns the authorized access mode, or `undefined` when already answered.
 */
function authorizeManagementPost(
  req: IncomingMessage,
  res: ServerResponse,
  policy: OwnerRequestPolicy,
): OwnerAccessMode | undefined {
  if (req.method !== 'POST') {
    json(res, 405, { error: 'method not allowed' })
    return undefined
  }
  const decision = policy.authorize(req)
  if (!decision.authorized || decision.accessMode === undefined) {
    json(res, 403, { error: 'forbidden' })
    return undefined
  }
  return decision.accessMode
}

/**
 * Register the unified Coding OAuth API plus the compatibility Grok routes.
 * @param ctx - Cordis context that owns the registration.
 * @param grokSession - Grok session value.
 * @param subscriptionSessions - Subscription sessions value.
 * @param ownerRequestPolicy - Owner request policy value.
 * @param compatibility - Compatibility value.
 */
export function registerCodingOAuthRoutes(
  ctx: Context,
  grokSession: GrokBuildSession,
  subscriptionSessions: readonly OAuthProviderSession[],
  ownerRequestPolicy: OwnerRequestPolicy = LOOPBACK_OWNER_REQUEST_POLICY,
  compatibility?: (accessMode: OwnerAccessMode) => DshCompatibility,
): void {
  const grok = new GrokBuildWebAuth(grokSession)
  const subscriptions = new Map(
    subscriptionSessions.map(session => [session.definition.slug, new SubscriptionWebAuth(session)]),
  )
  const subscription = (slug: Exclude<CodingOAuthProviderSlug, 'grok'>): SubscriptionWebAuth => {
    const auth = subscriptions.get(slug)
    if (auth === undefined) throw new Error(`OAuth provider "${slug}" is not configured`)
    return auth
  }
  ctx.effect(
    () => () =>
      Promise.all([grok.dispose(), ...[...subscriptions.values()].map(auth => auth.dispose())]).then(() => undefined),
    'dsh-subscription-auth: Coding OAuth auth lifetime',
  )

  registerGrokBuildAuthRoutes(ctx, grokSession, grok, ownerRequestPolicy)

  const allStatus = async (accessMode: OwnerAccessMode): Promise<CodingOAuthWebStatus> => {
    const [grokStatus, codex, claude] = await Promise.all([
      grok.status().catch(
        async (error: unknown): Promise<GrokBuildWebAuthStatus> => ({
          status: 'error',
          message: safeMessage(error),
          grokImportAvailable: await grokImportAvailable().catch(() => false),
        }),
      ),
      subscription('codex').status(),
      subscription('claude').status(),
    ])
    return {
      accessMode,
      uiOwner: 'standalone',
      compatibility: compatibility?.(accessMode) ?? fallbackCompatibility(accessMode),
      providers: { grok: grokStatus, codex, claude },
    }
  }

  /**
   * Handler shared by the cancel and logout routes. Both address one provider
   * and differ only in the operation they apply before answering with status,
   * so the guard, body parsing, and error mapping live here once.
   * @param apply - the lifecycle operation to apply to the addressed slug.
   * @returns the route handler.
   */
  const lifecycleHandler = (
    apply: (slug: CodingOAuthProviderSlug) => Promise<unknown>,
  ): (req: IncomingMessage, res: ServerResponse) => Promise<void> =>
    async (req, res) => {
      const accessMode = authorizeManagementPost(req, res, ownerRequestPolicy)
      if (accessMode === undefined) return
      try {
        const body = await readJsonRequest(req)
        const slug = providerSlug(body)
        await apply(slug)
        json(res, 200, await allStatus(accessMode))
      } catch (error: unknown) {
        json(res, requestErrorStatus(error, 500), { error: safeMessage(error) })
      }
    }

  ctx.effect(() => {
    const releaseRoutes = registerWebRouteSetupAtomically(ctx.webServer, webServer => [
      webServer.register({
        kind: 'exact',
        path: CODING_OAUTH_STATUS_PATH,
        handler: async (req, res) => {
          if (req.method !== 'GET') {  json(res, 405, { error: 'method not allowed' }); return }
          const decision = ownerRequestPolicy.authorize(req)
          if (!decision.authorized || decision.accessMode === undefined) {  json(res, 403, { error: 'forbidden' }); return }
          try {
            json(res, 200, await allStatus(decision.accessMode))
          } catch (error: unknown) {
            json(res, requestErrorStatus(error, 500), { error: safeMessage(error) })
          }
        },
      }),
      webServer.register({
        kind: 'exact',
        path: CODING_OAUTH_LOGIN_PATH,
        handler: async (req, res) => {
          if (req.method !== 'POST') {  json(res, 405, { error: 'method not allowed' }); return }
          if (!ownerRequestPolicy.authorize(req).authorized) {  json(res, 403, { error: 'forbidden' }); return }
          try {
            const body = await readJsonRequest(req)
            const slug = providerSlug(body)
            const value = recordBody(body)
            if (slug === 'grok') {
              const method: GrokBuildLoginMethod = value['method'] === 'device' ? 'device' : 'pkce'
              json(res, 200, await grok.signIn(method)); return
            }
            const auth = subscription(slug)
            const requested = value['method']
            const method: SubscriptionLoginMethod =
              requested === 'browser' || requested === 'device'
                ? requested
                : auth.session.definition.recommendedLoginMethod
            json(res, 200, await auth.signIn(method))
          } catch (error: unknown) {
            json(res, requestErrorStatus(error, 500), { error: safeMessage(error) })
          }
        },
      }),
      webServer.register({
        kind: 'exact',
        path: CODING_OAUTH_LOGIN_CODE_PATH,
        handler: async (req, res) => {
          if (req.method !== 'POST') {  json(res, 405, { error: 'method not allowed' }); return }
          if (!ownerRequestPolicy.authorize(req).authorized) {  json(res, 403, { error: 'forbidden' }); return }
          await answerSubmittedCode(res, async () => {
            const body = await readJsonRequest(req)
            const slug = providerSlug(body)
            const code = readSubmittedCode(res, body)
            if (code === undefined) return false
            if (slug === 'grok') await grok.submitCode(code)
            else await subscription(slug).submitCode(code)
            return true
          })
        },
      }),
      webServer.register({
        kind: 'exact',
        path: CODING_OAUTH_LOGIN_CANCEL_PATH,
        handler: lifecycleHandler(slug => (slug === 'grok' ? grok.cancel() : subscription(slug).cancel())),
      }),
      webServer.register({
        kind: 'exact',
        path: CODING_OAUTH_LOGOUT_PATH,
        handler: lifecycleHandler(slug => (slug === 'grok' ? grok.signOut() : subscription(slug).signOut())),
      }),
    ])
    return releaseRoutes
  }, 'dsh-subscription-auth: Coding OAuth routes')
}

function fallbackCompatibility(accessMode: OwnerAccessMode): DshCompatibility {
  return {
    coreAbi: CODING_OAUTH_CORE_ABI,
    dshVersion: null,
    status: 'degraded',
    uiOwner: 'standalone',
    accessMode,
    capabilities: {
      webServer: { state: 'available', contract: 'exact-route-v1' },
      llm: { state: 'available', contract: 'llm-adapter-registry-v1' },
      settings: { state: 'missing', contract: 'settings-register-v1' },
      credentials: { state: 'missing', contract: 'credential-resolver-v1' },
    },
    diagnostics: [],
  }
}
