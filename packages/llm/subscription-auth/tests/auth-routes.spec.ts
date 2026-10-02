import { mkdtemp, rm } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { setImmediate as waitImmediate } from 'node:timers/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { Api, AuthInteraction, Credential, Model, OAuthCredential } from '@earendil-works/pi-ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CODING_OAUTH_CORE_ABI } from 'dsh-coding-oauth-core'
import {
  CODING_OAUTH_LOGIN_CANCEL_PATH,
  CODING_OAUTH_LOGIN_CODE_PATH,
  CODING_OAUTH_LOGIN_PATH,
  CODING_OAUTH_LOGOUT_PATH,
  CODING_OAUTH_MODELS_PATH,
  CODING_OAUTH_STATUS_PATH,
  GROK_BUILD_AUTH_IMPORT_PATH,
  GROK_BUILD_AUTH_LOGIN_CANCEL_PATH,
  GROK_BUILD_AUTH_LOGIN_CODE_PATH,
  GROK_BUILD_AUTH_LOGIN_PATH,
  GROK_BUILD_AUTH_LOGOUT_PATH,
  GROK_BUILD_AUTH_STATUS_PATH,
  type CodingOAuthWebStatus,
  GrokBuildWebAuth,
  registerCodingOAuthRoutes,
  registerGrokBuildAuthRoutes,
} from '../src/auth-routes.ts'
import type { CatalogSource } from '../src/catalog.ts'
import type { AvnCompatibility } from '../src/compatibility.ts'
import type { PkceLoginCallbacks } from '../src/oauth.ts'
import {
  CODEX_OAUTH_PROVIDER,
  type OAuthProviderDefinition,
} from '../src/oauth-providers.ts'
import type { OAuthProviderSession } from '../src/oauth-session.ts'
import { GrokBuildSession } from '../src/session.ts'
import { type AccountSummary, GrokBuildCredentialStore } from '../src/store.ts'
import type { OwnerAccessMode, OwnerRequestPolicy } from '../src/web-origin.ts'

interface RegisteredRoute {
  path: string
  handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
}

class TestResponse {
  status = 0
  body = ''

  writeHead(status: number): this {
    this.status = status
    return this
  }

  end(value?: string): this {
    this.body += value ?? ''
    return this
  }
}

function request(
  body: string,
  headers: IncomingMessage['headers'] = {},
  method = 'POST',
  remoteAddress = '127.0.0.1',
): IncomingMessage {
  const stream = Readable.from([body]) as unknown as IncomingMessage
  Object.defineProperties(stream, {
    method: { value: method, configurable: true },
    headers: { value: { host: '127.0.0.1:3080', ...headers }, configurable: true },
    socket: { value: { remoteAddress }, configurable: true },
  })
  return stream
}

const temporaryDirectories: string[] = []

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) await rm(directory, { recursive: true, force: true })
})

async function loginHandler(): Promise<RegisteredRoute['handler']> {
  const directory = await mkdtemp(join(tmpdir(), 'avn-coding-oauth-routes-'))
  temporaryDirectories.push(directory)
  const routes = new Map<string, RegisteredRoute['handler']>()
  const cleanups: Array<() => void | Promise<void>> = []
  const context = {
    webServer: {
      register(route: RegisteredRoute) {
        routes.set(route.path, route.handler)
        return () => routes.delete(route.path)
      },
    },
    llm: { listProviders: () => [] },
    effect(setup: () => unknown) {
      const cleanup = setup()
      if (typeof cleanup === 'function') cleanups.push(cleanup as () => void | Promise<void>)
    },
  } as unknown as Context
  registerCodingOAuthRoutes(
    context,
    new GrokBuildSession(new GrokBuildCredentialStore(join(directory, 'auth.json'))),
    [],
  )
  const handler = routes.get(CODING_OAUTH_LOGIN_PATH)
  if (handler === undefined) throw new Error('login route was not registered')
  return handler
}

describe('Coding OAuth HTTP body guards', () => {
  it('returns 400 for malformed JSON instead of a generic route failure', async () => {
    const handler = await loginHandler()
    const response = new TestResponse()
    await handler(request('{not-json'), response as unknown as ServerResponse)
    expect(response.status).toBe(400)
    expect(JSON.parse(response.body)).toEqual({ error: 'request body must contain valid JSON' })
  })

  it('returns 413 before parsing an oversized declared body', async () => {
    const handler = await loginHandler()
    const response = new TestResponse()
    await handler(request('', { 'content-length': String(64 * 1024 + 1) }), response as unknown as ServerResponse)
    expect(response.status).toBe(413)
    expect(JSON.parse(response.body)).toEqual({ error: 'request body is too large' })
  })

  it('keeps loopback and cross-site request protections ahead of body parsing', async () => {
    const handler = await loginHandler()
    const response = new TestResponse()
    await handler(request('{}', { 'sec-fetch-site': 'cross-site' }), response as unknown as ServerResponse)
    expect(response.status).toBe(403)
  })
})

function createAuthRouteContext(failOnPath?: string): {
  routes: Map<string, RegisteredRoute['handler']>
  cleanups: Array<() => void | Promise<void>>
  context: Context
} {
  const routes = new Map<string, RegisteredRoute['handler']>()
  const cleanups: Array<() => void | Promise<void>> = []
  const context = {
    webServer: {
      register(route: RegisteredRoute) {
        if (failOnPath !== undefined && route.path === failOnPath) {
          throw new Error(`webserver: duplicate exact route "${route.path}"`)
        }
        routes.set(route.path, route.handler)
        return () => {
          routes.delete(route.path)
        }
      },
    },
    llm: { listProviders: () => [] },
    effect(setup: () => unknown) {
      const cleanup = setup()
      if (typeof cleanup === 'function') cleanups.push(cleanup as () => void | Promise<void>)
    },
  } as unknown as Context
  return { routes, cleanups, context }
}

function unusedSession(): GrokBuildSession {
  return {} as GrokBuildSession
}

describe('OAuth route registrar atomic setup', () => {
  it('retires the legacy direct Grok import so Pull confirmation cannot be bypassed', async () => {
    const { routes, context } = createAuthRouteContext()
    registerGrokBuildAuthRoutes(context, unusedSession())
    const handler = routes.get(GROK_BUILD_AUTH_IMPORT_PATH)
    if (handler === undefined) throw new Error('legacy import route was not registered')
    const response = new TestResponse()
    await handler(request(''), response as unknown as ServerResponse)
    expect(response.status).toBe(410)
    expect(JSON.parse(response.body)).toEqual({
      error: 'legacy import retired; use OAuth Pull preview and confirmation',
    })
  })

  it('rolls back earlier Grok routes when a later register throws', () => {
    const { routes, context } = createAuthRouteContext(GROK_BUILD_AUTH_LOGIN_CODE_PATH)
    expect(() =>{  registerGrokBuildAuthRoutes(context, unusedSession()) }).toThrow(
      `webserver: duplicate exact route "${GROK_BUILD_AUTH_LOGIN_CODE_PATH}"`,
    )
    expect(routes.size).toBe(0)
    expect(routes.has(GROK_BUILD_AUTH_STATUS_PATH)).toBe(false)
    expect(routes.has(GROK_BUILD_AUTH_LOGIN_PATH)).toBe(false)
  })

  it('does not let the Grok group own or dispose an injected existingAuth', async () => {
    const { routes, cleanups, context } = createAuthRouteContext()
    let disposeCalls = 0
    const existingAuth = {
      dispose: async () => {
        disposeCalls += 1
      },
    } as unknown as GrokBuildWebAuth
    registerGrokBuildAuthRoutes(context, unusedSession(), existingAuth)
    expect(routes.has(GROK_BUILD_AUTH_STATUS_PATH)).toBe(true)
    for (const cleanup of cleanups) await cleanup()
    expect(routes.size).toBe(0)
    expect(disposeCalls).toBe(0)
  })

  it('does not dispose existingAuth when Grok setup rolls back', () => {
    const { routes, context } = createAuthRouteContext(GROK_BUILD_AUTH_LOGIN_CODE_PATH)
    let disposeCalls = 0
    const existingAuth = {
      dispose: async () => {
        disposeCalls += 1
      },
    } as unknown as GrokBuildWebAuth
    expect(() =>{  registerGrokBuildAuthRoutes(context, unusedSession(), existingAuth) }).toThrow(
      `webserver: duplicate exact route "${GROK_BUILD_AUTH_LOGIN_CODE_PATH}"`,
    )
    expect(routes.size).toBe(0)
    expect(disposeCalls).toBe(0)
  })

  it('rolls back earlier Coding routes when a later register throws', () => {
    const { routes, context } = createAuthRouteContext(CODING_OAUTH_LOGIN_PATH)
    expect(() =>{  registerCodingOAuthRoutes(context, unusedSession(), []) }).toThrow(
      `webserver: duplicate exact route "${CODING_OAUTH_LOGIN_PATH}"`,
    )
    expect(routes.has(CODING_OAUTH_STATUS_PATH)).toBe(false)
    expect(routes.has(CODING_OAUTH_LOGIN_PATH)).toBe(false)
    expect(routes.has(GROK_BUILD_AUTH_STATUS_PATH)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Non-deterministic seams. The device/PKCE flows reach xAI over the network and
// the grok-import probe reads the operator's home directory; every other
// collaborator here is a real implementation.
// ---------------------------------------------------------------------------

function abortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason
  return reason instanceof Error ? reason : new Error(String(reason))
}

function pendingAbort(signal: AbortSignal | undefined): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    if (signal === undefined) return
    if (signal.aborted) {
      reject(abortReason(signal))
      return
    }
    signal.addEventListener(
      'abort',
      () => {
        reject(abortReason(signal))
      },
      { once: true },
    )
  })
}

const seams = vi.hoisted(() => ({
  device: undefined as ((interaction: AuthInteraction) => Promise<unknown>) | undefined,
  pkce: undefined as ((callbacks: PkceLoginCallbacks) => Promise<unknown>) | undefined,
  importGrok: undefined as (() => Promise<void>) | undefined,
  probe: undefined as (() => Promise<{ available: boolean; path: string }>) | undefined,
}))

vi.mock('../src/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/auth.ts')>()
  return {
    ...actual,
    loginGrokBuildSession: async (interaction: AuthInteraction, session: GrokBuildSession) =>
      seams.device === undefined ? actual.loginGrokBuildSession(interaction, session) : seams.device(interaction),
    importGrokBuildSession: async (session: GrokBuildSession, filename?: string) =>
      seams.importGrok === undefined ? actual.importGrokBuildSession(session, filename) : seams.importGrok(),
  }
})

vi.mock('../src/oauth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/oauth.ts')>()
  return {
    ...actual,
    loginGrokBuildPkce: (callbacks: PkceLoginCallbacks) =>
      seams.pkce === undefined ? actual.loginGrokBuildPkce(callbacks) : seams.pkce(callbacks),
  }
})

vi.mock('../src/grok-import.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/grok-import.ts')>()
  return {
    ...actual,
    probeGrokAuth: async (filename?: string) =>
      seams.probe === undefined ? actual.probeGrokAuth(filename) : seams.probe(),
  }
})

beforeEach(() => {
  seams.device = undefined
  seams.pkce = undefined
  seams.importGrok = undefined
  seams.probe = async () => ({ available: false, path: '/nonexistent/.grok/auth.json' })
})

const credential: OAuthCredential = {
  type: 'oauth',
  access: 'access-1',
  refresh: 'refresh-1',
  expires: Date.now() + 3_600_000,
}

function namedModel(id: string): Model<Api> {
  return { id } as unknown as Model<Api>
}

interface GrokSessionFake {
  session: GrokBuildSession
  calls: { logout: number; refresh: number; modified: Credential[] }
  setCredential(credential: OAuthCredential | undefined): void
}

interface GrokSessionOptions {
  modelIds?: string[]
  visibleIds?: string[]
  selectedIds?: string[]
  catalogSource?: CatalogSource
  catalogError?: string
  credential?: OAuthCredential
  accounts?: AccountSummary[]
  activeAccountId?: string
  readThrows?: Error
  modify?: 'candidate' | 'undefined' | 'wrong-type'
}

/** A GrokBuildSession over an in-memory credential store, so no home dir is read. */
function fakeGrokSession(options: GrokSessionOptions = {}): GrokSessionFake {
  let stored = options.credential
  const calls: GrokSessionFake['calls'] = { logout: 0, refresh: 0, modified: [] }
  const accountSummaries = (): AccountSummary[] =>
    stored === undefined ? [] : (options.accounts ?? [{ id: 'acct-1', expires: stored.expires }])
  const session = {
    store: {
      read: async () => {
        if (options.readThrows !== undefined) throw options.readThrows
        return stored
      },
      modify: async (
        _provider: string,
        fn: (current: Credential | undefined) => Promise<Credential | undefined>,
      ) => {
        const candidate = await fn(stored)
        calls.modified.push(candidate as Credential)
        if (options.modify === 'undefined') return undefined
        if (options.modify === 'wrong-type') return { type: 'api_key' } as unknown as Credential
        if (candidate?.type === 'oauth') stored = candidate
        return candidate
      },
      listAccounts: async () => accountSummaries(),
      getActiveAccountId: async () =>
        stored === undefined ? undefined : (options.activeAccountId ?? 'acct-1'),
      delete: async () => {
        stored = undefined
      },
    },
    availableModels: () => (options.modelIds ?? ['grok-4']).map(namedModel),
    visibleModels: () => (options.visibleIds ?? options.modelIds ?? ['grok-4']).map(namedModel),
    selectedModelIds: () => options.selectedIds,
    catalogSource: options.catalogSource ?? 'fallback',
    catalogError: options.catalogError,
    refreshLiveCatalog: async () => {
      calls.refresh += 1
    },
    logout: async () => {
      calls.logout += 1
      stored = undefined
    },
  }
  return {
    session: session as unknown as GrokBuildSession,
    calls,
    setCredential: (next) => {
      stored = next
    },
  }
}

/** A device login that announces `event`, then stays pending until the flow aborts. */
function hangingDeviceLogin(event: Parameters<AuthInteraction['notify']>[0]): void {
  seams.device = async (interaction) => {
    await Promise.resolve()
    interaction.notify(event)
    await pendingAbort(interaction.signal)
    return credential
  }
}

/** A PKCE login that publishes `url`, then resolves with the pasted authorization code. */
function pastedCodeLogin(url = 'https://auth.example/authorize'): void {
  seams.pkce = async (callbacks) => {
    callbacks.onAuthorizeUrl(url)
    const code = await callbacks.awaitCode!(new AbortController().signal)
    return { ...credential, access: `access-${String(code)}` }
  }
}

const deviceChallenge = {
  method: 'device',
  url: 'https://auth.example/device',
  userCode: 'ABCD-EFGH',
}

describe('GrokBuildWebAuth status', () => {
  it('reports the probed grok import availability alongside a signed-out status', async () => {
    seams.probe = async () => ({ available: true, path: '/home/operator/.grok/auth.json' })
    const { session } = fakeGrokSession()
    await expect(new GrokBuildWebAuth(session).status()).resolves.toEqual({
      status: 'signed-out',
      grokImportAvailable: true,
    })
  })

  it('reports the stored accounts beside the model list', async () => {
    const { session } = fakeGrokSession({
      credential,
      modelIds: ['grok-4', 'grok-3'],
      accounts: [{ id: 'acct-1', expires: credential.expires }],
      activeAccountId: 'acct-1',
    })
    await expect(new GrokBuildWebAuth(session).status()).resolves.toEqual({
      status: 'signed-in',
      models: [],
      grokImportAvailable: false,
      accounts: [{ id: 'acct-1', expires: credential.expires }],
      activeAccountId: 'acct-1',
    })
  })

  it('reports the model list with its selection once signed in', async () => {
    const { session } = fakeGrokSession({ credential, modelIds: ['grok-4'] })
    const models = [{ id: 'grok-4', name: 'Grok 4', imageInput: true, imageOutput: false, selected: false }]
    const status = await new GrokBuildWebAuth(session, () => models).status()
    expect(status.status).toBe('signed-in')
    if (status.status !== 'signed-in') throw new Error('expected a signed-in status')
    expect(status.models).toEqual(models)
  })

  it('re-reads import availability for a failed sign-in instead of the stored credential', async () => {
    seams.probe = async () => ({ available: true, path: '/home/operator/.grok/auth.json' })
    seams.device = async () => {
      await Promise.resolve()
      throw new Error('device flow exploded')
    }
    const auth = new GrokBuildWebAuth(fakeGrokSession({ credential }).session)
    await expect(auth.signIn('device')).rejects.toThrow('device flow exploded')
    await expect(auth.status()).resolves.toEqual({
      status: 'error',
      message: 'device flow exploded',
      grokImportAvailable: true,
    })
  })
})

describe('GrokBuildWebAuth device sign-in', () => {
  it('publishes one device challenge and hands it to every waiting caller', async () => {
    const { session } = fakeGrokSession()
    let notifications = 0
    seams.device = async (interaction) => {
      await Promise.resolve()
      notifications += 1
      interaction.notify({ type: 'device_code', userCode: deviceChallenge.userCode, verificationUri: deviceChallenge.url })
      await pendingAbort(interaction.signal)
      return credential
    }
    const auth = new GrokBuildWebAuth(session)
    const first = auth.signIn('device')
    await waitImmediate()
    const joined = await auth.signIn('device')
    await expect(first).resolves.toEqual(deviceChallenge)
    expect(joined).toEqual(deviceChallenge)
    expect(notifications).toBe(1)
    await expect(auth.status()).resolves.toEqual({
      status: 'signing-in',
      method: 'device',
      url: deviceChallenge.url,
      userCode: deviceChallenge.userCode,
      grokImportAvailable: false,
    })
    await auth.cancel()
    await expect(auth.status()).resolves.toEqual({ status: 'signed-out', grokImportAvailable: false })
  })

  it('omits an empty device user code from the published challenge', async () => {
    hangingDeviceLogin({ type: 'device_code', userCode: '', verificationUri: deviceChallenge.url })
    const auth = new GrokBuildWebAuth(fakeGrokSession().session)
    const challenge = await auth.signIn('device')
    expect(challenge).toEqual({ method: 'device', url: deviceChallenge.url })
    expect('userCode' in challenge).toBe(false)
    await auth.cancel()
  })

  it('publishes an authorization URL announced by the device flow', async () => {
    hangingDeviceLogin({ type: 'auth_url', url: 'https://auth.example/authorize?device=1' })
    const auth = new GrokBuildWebAuth(fakeGrokSession().session)
    await expect(auth.signIn('device')).resolves.toEqual({
      method: 'device',
      url: 'https://auth.example/authorize?device=1',
    })
    await auth.cancel()
  })

  it('cancels a pending device login before restarting with the requested method', async () => {
    const { session, calls } = fakeGrokSession()
    hangingDeviceLogin({
      type: 'device_code',
      userCode: deviceChallenge.userCode,
      verificationUri: deviceChallenge.url,
    })
    seams.pkce = async (callbacks) => {
      await Promise.resolve()
      callbacks.onAuthorizeUrl('https://auth.example/authorize')
      return credential
    }
    const auth = new GrokBuildWebAuth(session)
    expect(await auth.signIn('device')).toEqual(deviceChallenge)
    await expect(auth.signIn('pkce')).resolves.toEqual({
      method: 'pkce',
      url: 'https://auth.example/authorize',
    })
    await waitImmediate()
    expect(calls.refresh).toBe(1)
    await expect(auth.status()).resolves.toMatchObject({ status: 'signed-in', activeAccountId: 'acct-1' })
  })
})

describe('GrokBuildWebAuth PKCE sign-in', () => {
  it('publishes the authorization URL and persists the exchanged authorization code', async () => {
    const { session, calls } = fakeGrokSession()
    let exchanged = ''
    seams.pkce = async (callbacks) => {
      callbacks.onAuthorizeUrl('https://auth.example/authorize?state=abc')
      const code = await callbacks.awaitCode!(new AbortController().signal)
      if (code === undefined) throw new Error('the PKCE flow resolved before the pasted code arrived')
      exchanged = code
      return { ...credential, access: `access-${exchanged}` }
    }
    const auth = new GrokBuildWebAuth(session)
    await expect(auth.signIn('pkce')).resolves.toEqual({
      method: 'pkce',
      url: 'https://auth.example/authorize?state=abc',
    })
    await auth.submitCode('pasted-code')
    await waitImmediate()
    expect(exchanged).toBe('pasted-code')
    expect(calls.modified).toEqual([{ ...credential, access: 'access-pasted-code' }])
    await expect(auth.status()).resolves.toMatchObject({ status: 'signed-in', activeAccountId: 'acct-1' })
  })

  it('reports the persistence failure when the store keeps no credential', async () => {
    pastedCodeLogin()
    const auth = new GrokBuildWebAuth(fakeGrokSession({ modify: 'undefined' }).session)
    await auth.signIn('pkce')
    await auth.submitCode('pasted-code')
    await waitImmediate()
    await expect(auth.status()).resolves.toEqual({
      status: 'error',
      message: 'grok-build: failed to persist the login credential',
      grokImportAvailable: false,
    })
  })

  it('reports the persistence failure when the store answers with a non-OAuth credential', async () => {
    pastedCodeLogin()
    const auth = new GrokBuildWebAuth(fakeGrokSession({ modify: 'wrong-type' }).session)
    await auth.signIn('pkce')
    await auth.submitCode('pasted-code')
    await waitImmediate()
    await expect(auth.status()).resolves.toEqual({
      status: 'error',
      message: 'grok-build: failed to persist the login credential',
      grokImportAvailable: false,
    })
  })

  it('rejects a code channel that is already aborted instead of waiting for a paste', async () => {
    const aborted = new AbortController()
    aborted.abort(new Error('browser code channel closed'))
    seams.pkce = async (callbacks) => {
      callbacks.onAuthorizeUrl('https://auth.example/authorize')
      return { ...credential, access: await callbacks.awaitCode!(aborted.signal) }
    }
    const auth = new GrokBuildWebAuth(fakeGrokSession().session)
    await auth.signIn('pkce')
    await waitImmediate()
    await expect(auth.status()).resolves.toEqual({
      status: 'error',
      message: 'grok-build: sign-in cancelled',
      grokImportAvailable: false,
    })
  })

  it('aborts a pending code wait when the sign-in is cancelled', async () => {
    seams.pkce = async (callbacks) => {
      callbacks.onAuthorizeUrl('https://auth.example/authorize')
      return { ...credential, access: await callbacks.awaitCode!(callbacks.signal!) }
    }
    const auth = new GrokBuildWebAuth(fakeGrokSession().session)
    await auth.signIn('pkce')
    await auth.cancel()
    await expect(auth.submitCode('late-code')).rejects.toThrow(
      'grok-build: no authorization-code login is waiting for a code',
    )
    await expect(auth.status()).resolves.toEqual({ status: 'signed-out', grokImportAvailable: false })
  })

  it('rejects an authorization URL that cannot be parsed', async () => {
    seams.pkce = async (callbacks) => {
      const aborted = pendingAbort(callbacks.signal)
      callbacks.onAuthorizeUrl('not an authorization url')
      await aborted
      return credential
    }
    const auth = new GrokBuildWebAuth(fakeGrokSession().session)
    await expect(auth.signIn('pkce')).rejects.toThrow('xAI returned an invalid authorization URL')
    await expect(auth.status()).resolves.toEqual({
      status: 'error',
      message: 'xAI returned an invalid authorization URL',
      grokImportAvailable: false,
    })
  })

  it('rejects an authorization URL that is not HTTPS', async () => {
    seams.pkce = async (callbacks) => {
      const aborted = pendingAbort(callbacks.signal)
      callbacks.onAuthorizeUrl('http://auth.example/authorize')
      await aborted
      return credential
    }
    const auth = new GrokBuildWebAuth(fakeGrokSession().session)
    await expect(auth.signIn('pkce')).rejects.toThrow('xAI returned an unsafe authorization URL')
    await expect(auth.status()).resolves.toEqual({
      status: 'error',
      message: 'xAI returned an unsafe authorization URL',
      grokImportAvailable: false,
    })
  })
})

describe('GrokBuildWebAuth lifecycle', () => {
  it('returns the stored status when there is no pending login to cancel', async () => {
    const auth = new GrokBuildWebAuth(fakeGrokSession({ credential }).session)
    await auth.cancel()
    await expect(auth.status()).resolves.toMatchObject({ status: 'signed-in', activeAccountId: 'acct-1' })
  })

  it('drops the published challenge and adopts the imported credential', async () => {
    const fake = fakeGrokSession()
    hangingDeviceLogin({
      type: 'device_code',
      userCode: deviceChallenge.userCode,
      verificationUri: deviceChallenge.url,
    })
    seams.importGrok = async () => {
      fake.setCredential(credential)
    }
    const auth = new GrokBuildWebAuth(fake.session)
    expect(await auth.signIn('device')).toEqual(deviceChallenge)
    await auth.importGrok()
    await expect(auth.status()).resolves.toMatchObject({ status: 'signed-in', activeAccountId: 'acct-1' })
    expect(fake.calls.logout).toBe(0)
  })

  it('ends the provider session, aborts a pending login, and re-probes import availability', async () => {
    const fake = fakeGrokSession({ credential })
    hangingDeviceLogin({
      type: 'device_code',
      userCode: deviceChallenge.userCode,
      verificationUri: deviceChallenge.url,
    })
    seams.probe = async () => ({ available: true, path: '/home/operator/.grok/auth.json' })
    const auth = new GrokBuildWebAuth(fake.session)
    await auth.signIn('device')
    await auth.signOut()
    expect(fake.calls.logout).toBe(1)
    await expect(auth.status()).resolves.toEqual({ status: 'signed-out', grokImportAvailable: true })
  })

  it('rejects the waiting callers with the dispose failure', async () => {
    seams.device = async (interaction) => {
      await pendingAbort(interaction.signal)
      return credential
    }
    const auth = new GrokBuildWebAuth(fakeGrokSession().session)
    const pending = auth.signIn('device')
    await auth.dispose()
    await expect(pending).rejects.toThrow('grok-build: plugin disposed')
    await expect(auth.status()).resolves.toEqual({
      status: 'error',
      message: 'grok-build: plugin disposed',
      grokImportAvailable: false,
    })
  })
})

// ---------------------------------------------------------------------------
// Route registrars: the unified Coding OAuth API plus the compatibility Grok
// group, driven through the same request/response harness as above.
// ---------------------------------------------------------------------------

function policyWith(decision: Record<string, unknown>): OwnerRequestPolicy {
  return { authorize: () => decision } as unknown as OwnerRequestPolicy
}

function accessModePolicy(accessMode: OwnerAccessMode): OwnerRequestPolicy {
  return policyWith({ authorized: true, accessMode })
}

const denyPolicy = policyWith({ authorized: false, reason: 'peer' })
const modeLessPolicy = policyWith({ authorized: true })

function handlerFor(routes: Map<string, RegisteredRoute['handler']>, path: string): RegisteredRoute['handler'] {
  const handler = routes.get(path)
  if (handler === undefined) throw new Error(`route ${path} was not registered`)
  return handler
}

async function callRoute(
  handler: RegisteredRoute['handler'],
  body = '',
  options: { method?: string; headers?: IncomingMessage['headers'] } = {},
): Promise<{ status: number; body: unknown }> {
  const response = new TestResponse()
  await handler(
    request(body, options.headers ?? {}, options.method ?? 'POST'),
    response as unknown as ServerResponse,
  )
  return { status: response.status, body: response.body === '' ? undefined : JSON.parse(response.body) }
}

interface SubscriptionSessionFake {
  session: OAuthProviderSession
  calls: { login: number; logout: number }
  isAuthenticated(): boolean
}

/** A subscription session whose provider login is supplied per test. */
function fakeSubscriptionSession(
  definition: OAuthProviderDefinition,
  login?: (interaction: AuthInteraction) => Promise<Credential>,
): SubscriptionSessionFake {
  let authenticated = false
  const calls = { login: 0, logout: 0 }
  const models = [namedModel(`${definition.slug}-model`)]
  const accounts = [{ id: `${definition.slug}-acct`, expires: credential.expires }]
  const session = {
    definition,
    availableModels: () => models,
    visibleModels: () => [...models],
    selectedModelIds: () => undefined,
    status: async () =>
      authenticated ? { authenticated: true, expiresAt: credential.expires } : { authenticated: false },
    store: {
      listAccounts: async () => (authenticated ? accounts : []),
      getActiveAccountId: async () => (authenticated ? accounts[0]!.id : undefined),
      setActiveAccount: async () => undefined,
      removeAccount: async () => {
        authenticated = false
      },
    },
    notifyCredentialChange: () => undefined,
    login: async (interaction: AuthInteraction) => {
      calls.login += 1
      const next = await announcedSubscriptionLogin(interaction, login)
      authenticated = true
      return next
    },
    setSelectedModels: async () => undefined,
    logout: async () => {
      calls.logout += 1
      authenticated = false
    },
  }
  return { session: session as unknown as OAuthProviderSession, calls, isAuthenticated: () => authenticated }
}

/** Announce an authorization URL, then stay pending until the flow aborts. */
async function announcedSubscriptionLogin(
  interaction: AuthInteraction,
  login?: (interaction: AuthInteraction) => Promise<Credential>,
): Promise<Credential> {
  if (login !== undefined) return login(interaction)
  await Promise.resolve()
  interaction.notify({ type: 'auth_url', url: SUBSCRIPTION_AUTHORIZE_URL })
  await pendingAbort(interaction.signal)
  return credential
}

const SUBSCRIPTION_AUTHORIZE_URL = 'https://auth.example/subscription/authorize'

interface CodingRouteHarness {
  routes: Map<string, RegisteredRoute['handler']>
  cleanups: Array<() => void | Promise<void>>
  grok: GrokSessionFake
  codex: SubscriptionSessionFake
}

function codingRouteHarness(options: {
  policy?: OwnerRequestPolicy
  compatibility?: (accessMode: OwnerAccessMode) => AvnCompatibility
  grokOptions?: GrokSessionOptions
  subscriptions?: readonly OAuthProviderSession[]
  codexLogin?: (interaction: AuthInteraction) => Promise<Credential>
} = {}): CodingRouteHarness {
  const { routes, cleanups, context } = createAuthRouteContext()
  const grok = fakeGrokSession(options.grokOptions)
  const codex = fakeSubscriptionSession(CODEX_OAUTH_PROVIDER, options.codexLogin)
  registerCodingOAuthRoutes(
    context,
    grok.session,
    options.subscriptions ?? [codex.session],
    options.policy,
    options.compatibility,
  )
  return { routes, cleanups, grok, codex }
}

const GROK_MUTATION_PATHS = [
  GROK_BUILD_AUTH_LOGIN_PATH,
  GROK_BUILD_AUTH_LOGIN_CODE_PATH,
  GROK_BUILD_AUTH_LOGIN_CANCEL_PATH,
  GROK_BUILD_AUTH_IMPORT_PATH,
  GROK_BUILD_AUTH_LOGOUT_PATH,
]

describe('coding OAuth route registration', () => {
  it('registers the unified API beside the compatibility Grok group', () => {
    const { routes } = codingRouteHarness()
    expect([...routes.keys()].sort()).toEqual(
      [
        CODING_OAUTH_LOGIN_CANCEL_PATH,
        CODING_OAUTH_LOGIN_CODE_PATH,
        CODING_OAUTH_LOGIN_PATH,
        CODING_OAUTH_LOGOUT_PATH,
        CODING_OAUTH_MODELS_PATH,
        CODING_OAUTH_STATUS_PATH,
        ...GROK_MUTATION_PATHS,
        GROK_BUILD_AUTH_STATUS_PATH,
      ].sort(),
    )
  })

  it('aborts the in-flight provider login and releases every route on teardown', async () => {
    let loginFailure: unknown
    const { routes, cleanups, codex } = codingRouteHarness({
      codexLogin: async (interaction) => {
        await Promise.resolve()
        interaction.notify({ type: 'auth_url', url: SUBSCRIPTION_AUTHORIZE_URL })
        try {
          await pendingAbort(interaction.signal)
        } catch (error) {
          loginFailure = error
          throw error
        }
        return credential
      },
    })
    const login = await callRoute(handlerFor(routes, CODING_OAUTH_LOGIN_PATH), '{"provider":"codex"}')
    expect(login).toEqual({ status: 200, body: { method: 'device', url: SUBSCRIPTION_AUTHORIZE_URL } })
    expect(codex.calls.login).toBe(1)
    for (const cleanup of cleanups) await cleanup()
    expect(routes.size).toBe(0)
    await waitImmediate()
    expect(String(loginFailure)).toContain('plugin disposed')
  })

  it('disposes the plugin-owned Grok auth when its own routes are released', async () => {
    const { routes, cleanups, context } = createAuthRouteContext()
    let loginStarted = (): void => undefined
    const started = new Promise<void>((resolve) => {
      loginStarted = resolve
    })
    seams.device = async (interaction) => {
      loginStarted()
      await pendingAbort(interaction.signal)
      return credential
    }
    registerGrokBuildAuthRoutes(context, fakeGrokSession().session)
    const login = callRoute(handlerFor(routes, GROK_BUILD_AUTH_LOGIN_PATH), '{"method":"device"}')
    await started
    for (const cleanup of cleanups) await cleanup()
    await expect(login).resolves.toEqual({ status: 500, body: { error: 'grok-build: plugin disposed' } })
    expect(routes.size).toBe(0)
  })
})

describe('Grok auth route guards', () => {
  it('answers 405 to a non-matching method on every Grok route', async () => {
    const { routes } = codingRouteHarness()
    for (const path of GROK_MUTATION_PATHS) {
      const answer = await callRoute(handlerFor(routes, path), '', { method: 'GET' })
      expect({ path, answer }).toEqual({ path, answer: { status: 405, body: { error: 'method not allowed' } } })
    }
    const status = await callRoute(handlerFor(routes, GROK_BUILD_AUTH_STATUS_PATH), '', { method: 'POST' })
    expect(status).toEqual({ status: 405, body: { error: 'method not allowed' } })
  })

  it('answers 403 when the owner policy refuses a Grok route', async () => {
    const { routes } = codingRouteHarness({ policy: denyPolicy })
    const requests: Array<[string, string]> = [
      [GROK_BUILD_AUTH_STATUS_PATH, 'GET'],
      ...GROK_MUTATION_PATHS.map((path): [string, string] => [path, 'POST']),
    ]
    for (const [path, method] of requests) {
      const answer = await callRoute(handlerFor(routes, path), '{}', { method })
      expect({ path, answer }).toEqual({ path, answer: { status: 403, body: { error: 'forbidden' } } })
    }
  })

  it('keeps the retired legacy import behind the owner guard', async () => {
    const { routes } = codingRouteHarness({ policy: denyPolicy })
    const answer = await callRoute(handlerFor(routes, GROK_BUILD_AUTH_IMPORT_PATH), '')
    expect(answer).toEqual({ status: 403, body: { error: 'forbidden' } })
  })
})

describe('Grok auth status route', () => {
  it('serves the stored Grok status to an owner request', async () => {
    const { routes } = codingRouteHarness({ grokOptions: { credential } })
    await expect(
      callRoute(handlerFor(routes, GROK_BUILD_AUTH_STATUS_PATH), '', { method: 'GET' }),
    ).resolves.toMatchObject({
      status: 200,
      body: { status: 'signed-in', activeAccountId: 'acct-1', models: [] },
    })
  })
})

describe('Grok login route', () => {
  it('reads the requested login method from the JSON body', async () => {
    const requested: string[] = []
    const auth = {
      signIn: async (method: string) => {
        requested.push(method)
        return { method, url: 'https://auth.example/authorize' }
      },
    } as unknown as GrokBuildWebAuth
    const { routes, context } = createAuthRouteContext()
    registerGrokBuildAuthRoutes(context, unusedSession(), auth)
    const handler = handlerFor(routes, GROK_BUILD_AUTH_LOGIN_PATH)
    for (const body of ['{"method":"device"}', '{"method":"pkce"}', '{}', 'null', '5', '[1]']) {
      await expect(callRoute(handler, body)).resolves.toMatchObject({ status: 200 })
    }
    expect(requested).toEqual(['device', 'pkce', 'pkce', 'pkce', 'pkce', 'pkce'])
  })

  it('starts the device login a body asks for', async () => {
    hangingDeviceLogin({
      type: 'device_code',
      userCode: deviceChallenge.userCode,
      verificationUri: deviceChallenge.url,
    })
    const { routes } = codingRouteHarness()
    await expect(
      callRoute(handlerFor(routes, GROK_BUILD_AUTH_LOGIN_PATH), '{"method":"device"}'),
    ).resolves.toEqual({ status: 200, body: deviceChallenge })
  })

  it('starts a PKCE login when the body names no method', async () => {
    seams.pkce = async (callbacks) => {
      callbacks.onAuthorizeUrl('https://auth.example/authorize')
      return credential
    }
    const { routes, grok } = codingRouteHarness()
    await expect(callRoute(handlerFor(routes, GROK_BUILD_AUTH_LOGIN_PATH), '{}')).resolves.toEqual({
      status: 200,
      body: { method: 'pkce', url: 'https://auth.example/authorize' },
    })
    await waitImmediate()
    expect(grok.calls.refresh).toBe(1)
  })

  it('rejects a malformed login body with 400 instead of a generic failure', async () => {
    const { routes } = codingRouteHarness()
    await expect(callRoute(handlerFor(routes, GROK_BUILD_AUTH_LOGIN_PATH), '{not-json')).resolves.toEqual({
      status: 400,
      body: { error: 'request body must contain valid JSON' },
    })
  })

  it('maps a login failure to 500 without echoing the credential-bearing detail', async () => {
    const failing = {
      signIn: async () => {
        throw new Error('Authorization: Bearer credential-secret')
      },
    } as unknown as GrokBuildWebAuth
    const { routes, context } = createAuthRouteContext()
    registerGrokBuildAuthRoutes(context, unusedSession(), failing)
    const answer = await callRoute(handlerFor(routes, GROK_BUILD_AUTH_LOGIN_PATH), '{"method":"device"}')
    expect(answer.status).toBe(500)
    expect((answer.body as { error: string }).error).toContain('Authorization: Bearer [redacted]')
  })
})

describe('Grok login-code route', () => {
  it('rejects a code body that is not a non-empty string', async () => {
    const { routes } = codingRouteHarness()
    const handler = handlerFor(routes, GROK_BUILD_AUTH_LOGIN_CODE_PATH)
    for (const body of ['5', 'null', '{}', '{"code":5}', '{"code":"   "}']) {
      const answer = await callRoute(handler, body)
      expect({ body, answer }).toEqual({
        body,
        answer: { status: 400, body: { error: 'code must be a non-empty string' } },
      })
    }
  })

  it('submits the pasted code to the pending PKCE login', async () => {
    let pasted = ''
    seams.pkce = async (callbacks) => {
      callbacks.onAuthorizeUrl('https://auth.example/authorize')
      const code = await callbacks.awaitCode!(new AbortController().signal)
      if (code === undefined) throw new Error('the PKCE flow resolved before the pasted code arrived')
      pasted = code
      return credential
    }
    const { routes, grok } = codingRouteHarness()
    await callRoute(handlerFor(routes, GROK_BUILD_AUTH_LOGIN_PATH), '{}')
    await expect(callRoute(handlerFor(routes, GROK_BUILD_AUTH_LOGIN_CODE_PATH), '{"code":"pasted-code"}')).resolves.toEqual(
      { status: 200, body: { ok: true } },
    )
    await waitImmediate()
    expect(pasted).toBe('pasted-code')
    expect(grok.calls.refresh).toBe(1)
  })

  it('answers 409 when no login is waiting for a code', async () => {
    const { routes } = codingRouteHarness()
    await expect(callRoute(handlerFor(routes, GROK_BUILD_AUTH_LOGIN_CODE_PATH), '{"code":"stale"}')).resolves.toEqual({
      status: 409,
      body: { error: 'grok-build: no authorization-code login is waiting for a code' },
    })
  })
})

describe('Grok login-cancel route', () => {
  it('cancels the pending login and answers with the stored status', async () => {
    hangingDeviceLogin({
      type: 'device_code',
      userCode: deviceChallenge.userCode,
      verificationUri: deviceChallenge.url,
    })
    const { routes } = codingRouteHarness()
    await callRoute(handlerFor(routes, GROK_BUILD_AUTH_LOGIN_PATH), '{"method":"device"}')
    await expect(callRoute(handlerFor(routes, GROK_BUILD_AUTH_LOGIN_CANCEL_PATH), '{}')).resolves.toEqual({
      status: 200,
      body: { status: 'signed-out', grokImportAvailable: false },
    })
  })
})

describe('Grok logout route', () => {
  it('ends the Grok session and answers ok', async () => {
    const { routes, grok } = codingRouteHarness({ grokOptions: { credential } })
    await expect(callRoute(handlerFor(routes, GROK_BUILD_AUTH_LOGOUT_PATH), '{}')).resolves.toEqual({
      status: 200,
      body: { ok: true },
    })
    expect(grok.calls.logout).toBe(1)
    const status = await callRoute(handlerFor(routes, GROK_BUILD_AUTH_STATUS_PATH), '', { method: 'GET' })
    expect(status).toMatchObject({ status: 200, body: { status: 'signed-out' } })
  })
})

const injectedCompatibility = (accessMode: OwnerAccessMode): AvnCompatibility => ({
  coreAbi: 'injected-abi',
  avnVersion: '9.9.9',
  status: 'healthy',
  uiOwner: 'hub',
  accessMode,
  capabilities: {},
  diagnostics: [],
})

const CODING_MUTATION_PATHS = [
  CODING_OAUTH_LOGIN_PATH,
  CODING_OAUTH_LOGIN_CODE_PATH,
  CODING_OAUTH_LOGIN_CANCEL_PATH,
  CODING_OAUTH_LOGOUT_PATH,
]

describe('coding OAuth route guards', () => {
  it('answers 405 to a non-matching method on every coding route', async () => {
    const { routes } = codingRouteHarness()
    for (const path of CODING_MUTATION_PATHS) {
      const answer = await callRoute(handlerFor(routes, path), '{}', { method: 'GET' })
      expect({ path, answer }).toEqual({ path, answer: { status: 405, body: { error: 'method not allowed' } } })
    }
    const status = await callRoute(handlerFor(routes, CODING_OAUTH_STATUS_PATH), '', { method: 'POST' })
    expect(status).toEqual({ status: 405, body: { error: 'method not allowed' } })
  })

  it('answers 403 whenever the owner decision is refused', async () => {
    const { routes } = codingRouteHarness({ policy: denyPolicy })
    const requests: Array<[string, string]> = [
      [CODING_OAUTH_STATUS_PATH, 'GET'],
      ...CODING_MUTATION_PATHS.map((path): [string, string] => [path, 'POST']),
    ]
    for (const [path, method] of requests) {
      const answer = await callRoute(handlerFor(routes, path), '{"provider":"grok"}', { method })
      expect({ path, answer }).toEqual({ path, answer: { status: 403, body: { error: 'forbidden' } } })
    }
  })

  it('answers 403 when a status, cancel, or logout decision carries no access mode', async () => {
    const { routes } = codingRouteHarness({ policy: modeLessPolicy })
    const requests: Array<[string, string]> = [
      [CODING_OAUTH_STATUS_PATH, 'GET'],
      [CODING_OAUTH_LOGIN_CANCEL_PATH, 'POST'],
      [CODING_OAUTH_LOGOUT_PATH, 'POST'],
    ]
    for (const [path, method] of requests) {
      const answer = await callRoute(handlerFor(routes, path), '{"provider":"grok"}', { method })
      expect({ path, answer }).toEqual({ path, answer: { status: 403, body: { error: 'forbidden' } } })
    }
  })
})

describe('coding OAuth status route', () => {
  it('serves every provider status with the fallback compatibility document', async () => {
    const { routes } = codingRouteHarness({
      policy: accessModePolicy('ssh-tunnel'),
      grokOptions: { credential },
    })
    const answer = await callRoute(handlerFor(routes, CODING_OAUTH_STATUS_PATH), '', { method: 'GET' })
    expect(answer.status).toBe(200)
    const body = answer.body as CodingOAuthWebStatus
    expect(body.accessMode).toBe('ssh-tunnel')
    expect(body.uiOwner).toBe('standalone')
    expect(body.compatibility).toEqual({
      coreAbi: CODING_OAUTH_CORE_ABI,
      avnVersion: null,
      status: 'degraded',
      uiOwner: 'standalone',
      accessMode: 'ssh-tunnel',
      capabilities: {
        webServer: { state: 'available', contract: 'exact-route-v1' },
        llm: { state: 'available', contract: 'llm-adapter-registry-v1' },
        settings: { state: 'missing', contract: 'settings-register-v1' },
        credentials: { state: 'missing', contract: 'credential-resolver-v1' },
      },
      diagnostics: [],
    })
    expect(body.providers.grok).toMatchObject({ status: 'signed-in', activeAccountId: 'acct-1' })
    expect(body.providers.codex).toMatchObject({ provider: 'codex', status: 'signed-out' })
  })

  it('prefers an injected compatibility document over the degraded fallback', async () => {
    const { routes } = codingRouteHarness({
      policy: accessModePolicy('trusted-https-proxy'),
      compatibility: injectedCompatibility,
    })
    const answer = await callRoute(handlerFor(routes, CODING_OAUTH_STATUS_PATH), '', { method: 'GET' })
    const body = answer.body as CodingOAuthWebStatus
    expect(body.compatibility).toEqual(injectedCompatibility('trusted-https-proxy'))
  })

  it('maps a provider that is not configured to 500', async () => {
    const { routes } = codingRouteHarness({ subscriptions: [] })
    await expect(callRoute(handlerFor(routes, CODING_OAUTH_STATUS_PATH), '', { method: 'GET' })).resolves.toEqual({
      status: 500,
      body: { error: 'OAuth provider "codex" is not configured' },
    })
  })

  it('reports a Grok status failure and treats an unreachable import probe as unavailable', async () => {
    seams.probe = async () => {
      throw new Error('probe unavailable')
    }
    const { routes } = codingRouteHarness({
      grokOptions: { readThrows: new Error('Authorization: Bearer credential-secret') },
    })
    const answer = await callRoute(handlerFor(routes, CODING_OAUTH_STATUS_PATH), '', { method: 'GET' })
    expect(answer.status).toBe(200)
    expect((answer.body as CodingOAuthWebStatus).providers.grok).toEqual({
      status: 'error',
      message: 'Authorization: Bearer [redacted]',
      grokImportAvailable: false,
    })
  })
})

describe('coding OAuth login route', () => {
  it('starts a Grok login with the method the body names', async () => {
    hangingDeviceLogin({
      type: 'device_code',
      userCode: deviceChallenge.userCode,
      verificationUri: deviceChallenge.url,
    })
    const { routes } = codingRouteHarness()
    const handler = handlerFor(routes, CODING_OAUTH_LOGIN_PATH)
    await expect(callRoute(handler, '{"provider":"grok","method":"device"}')).resolves.toEqual({
      status: 200,
      body: deviceChallenge,
    })
    seams.pkce = async (callbacks) => {
      callbacks.onAuthorizeUrl('https://auth.example/authorize')
      return credential
    }
    await expect(callRoute(handler, '{"provider":"grok"}')).resolves.toEqual({
      status: 200,
      body: { method: 'pkce', url: 'https://auth.example/authorize' },
    })
  })

  it('starts a subscription login with a validated method', async () => {
    const { routes, codex } = codingRouteHarness()
    const handler = handlerFor(routes, CODING_OAUTH_LOGIN_PATH)
    const answer = async (body: string): Promise<unknown> => callRoute(handler, body)
    await expect(answer('{"provider":"codex","method":"browser"}')).resolves.toEqual({
      status: 200,
      body: { method: 'browser', url: SUBSCRIPTION_AUTHORIZE_URL },
    })
    await expect(answer('{"provider":"codex","method":"device"}')).resolves.toEqual({
      status: 200,
      body: { method: 'device', url: SUBSCRIPTION_AUTHORIZE_URL },
    })
    await expect(answer('{"provider":"codex"}')).resolves.toEqual({
      status: 200,
      body: { method: 'device', url: SUBSCRIPTION_AUTHORIZE_URL },
    })
    // The second request joins the pending device login instead of restarting it.
    expect(codex.calls.login).toBe(2)
  })

  it('maps an unconfigured provider or a non-object body to 500', async () => {
    const { routes } = codingRouteHarness()
    const handler = handlerFor(routes, CODING_OAUTH_LOGIN_PATH)
    const cases: Array<[string, string]> = [
      ['{"provider":"kimi"}', 'provider must be one of grok or codex'],
      ['{"provider":"bogus"}', 'provider must be one of grok or codex'],
      ['5', 'request body must be an object'],
      ['null', 'request body must be an object'],
      ['[1]', 'request body must be an object'],
    ]
    for (const [body, error] of cases) {
      const answer = await callRoute(handler, body)
      expect({ body, answer }).toEqual({ body, answer: { status: 500, body: { error } } })
    }
  })

  it('rejects a malformed login body with 400 instead of 500', async () => {
    const { routes } = codingRouteHarness()
    await expect(callRoute(handlerFor(routes, CODING_OAUTH_LOGIN_PATH), '{not-json')).resolves.toEqual({
      status: 400,
      body: { error: 'request body must contain valid JSON' },
    })
  })
})

describe('coding OAuth login-code route', () => {
  it('rejects a code that is not a non-empty string', async () => {
    const { routes } = codingRouteHarness()
    const handler = handlerFor(routes, CODING_OAUTH_LOGIN_CODE_PATH)
    for (const body of ['{"provider":"grok"}', '{"provider":"grok","code":5}', '{"provider":"codex","code":"  "}']) {
      const answer = await callRoute(handler, body)
      expect({ body, answer }).toEqual({
        body,
        answer: { status: 400, body: { error: 'code must be a non-empty string' } },
      })
    }
  })

  it('submits the pasted code to the provider the body names', async () => {
    let grokCode = ''
    let codexCode = ''
    seams.pkce = async (callbacks) => {
      callbacks.onAuthorizeUrl('https://auth.example/authorize')
      const code = await callbacks.awaitCode!(new AbortController().signal)
      if (code === undefined) throw new Error('the PKCE flow resolved before the pasted code arrived')
      grokCode = code
      return credential
    }
    const { routes } = codingRouteHarness({
      codexLogin: async (interaction) => {
        await Promise.resolve()
        interaction.notify({ type: 'auth_url', url: SUBSCRIPTION_AUTHORIZE_URL })
        codexCode = await interaction.prompt({ type: 'manual_code', message: 'paste the authorization code' })
        return credential
      },
    })
    const login = handlerFor(routes, CODING_OAUTH_LOGIN_PATH)
    const code = handlerFor(routes, CODING_OAUTH_LOGIN_CODE_PATH)
    await callRoute(login, '{"provider":"grok"}')
    await expect(callRoute(code, '{"provider":"grok","code":"grok-code"}')).resolves.toEqual({
      status: 200,
      body: { ok: true },
    })
    await callRoute(login, '{"provider":"codex"}')
    await expect(callRoute(code, '{"provider":"codex","code":"codex-code"}')).resolves.toEqual({
      status: 200,
      body: { ok: true },
    })
    await waitImmediate()
    expect(grokCode).toBe('grok-code')
    expect(codexCode).toBe('codex-code')
  })

  it('answers 409 when the selected provider has no code login waiting', async () => {
    const { routes } = codingRouteHarness()
    const handler = handlerFor(routes, CODING_OAUTH_LOGIN_CODE_PATH)
    const cases: Array<[string, string]> = [
      ['{"provider":"grok","code":"stale"}', 'grok-build: no authorization-code login is waiting for a code'],
      ['{"provider":"codex","code":"stale"}', 'codex-oauth: no authorization-code login is waiting for a code'],
      ['{"provider":"kimi","code":"stale"}', 'provider must be one of grok or codex'],
    ]
    for (const [body, error] of cases) {
      const answer = await callRoute(handler, body)
      expect({ body, answer }).toEqual({ body, answer: { status: 409, body: { error } } })
    }
  })
})

describe('coding OAuth login-cancel route', () => {
  it('cancels the selected provider and answers with every provider status', async () => {
    const { routes } = codingRouteHarness()
    const handler = handlerFor(routes, CODING_OAUTH_LOGIN_CANCEL_PATH)
    const grokAnswer = await callRoute(handler, '{"provider":"grok"}')
    expect(grokAnswer.status).toBe(200)
    expect((grokAnswer.body as CodingOAuthWebStatus).providers.grok).toMatchObject({ status: 'signed-out' })
    const codexAnswer = await callRoute(handler, '{"provider":"codex"}')
    expect(codexAnswer.status).toBe(200)
    const body = codexAnswer.body as CodingOAuthWebStatus
    expect(body.accessMode).toBe('loopback')
    expect(body.providers.codex).toMatchObject({ provider: 'codex', status: 'signed-out' })
  })

  it('maps an unconfigured provider to 500', async () => {
    const { routes } = codingRouteHarness()
    await expect(callRoute(handlerFor(routes, CODING_OAUTH_LOGIN_CANCEL_PATH), '{"provider":"kimi"}')).resolves.toEqual({
      status: 500,
      body: { error: 'provider must be one of grok or codex' },
    })
  })
})

describe('coding OAuth logout route', () => {
  it('ends the selected provider session and answers with every provider status', async () => {
    const { routes, grok, codex } = codingRouteHarness({ grokOptions: { credential } })
    const handler = handlerFor(routes, CODING_OAUTH_LOGOUT_PATH)
    const grokAnswer = await callRoute(handler, '{"provider":"grok"}')
    expect(grokAnswer.status).toBe(200)
    expect((grokAnswer.body as CodingOAuthWebStatus).providers.grok).toMatchObject({ status: 'signed-out' })
    expect(grok.calls.logout).toBe(1)
    const codexAnswer = await callRoute(handler, '{"provider":"codex"}')
    expect(codexAnswer.status).toBe(200)
    expect((codexAnswer.body as CodingOAuthWebStatus).providers.codex).toMatchObject({ status: 'signed-out' })
    expect(codex.calls.logout).toBe(1)
  })

  it('maps an unconfigured provider to 500', async () => {
    const { routes } = codingRouteHarness()
    await expect(callRoute(handlerFor(routes, CODING_OAUTH_LOGOUT_PATH), '{"provider":"kimi"}')).resolves.toEqual({
      status: 500,
      body: { error: 'provider must be one of grok or codex' },
    })
  })
})

/** A device login that announces one event, then resolves once the flow aborts. */
function deviceLoginCompletingOnAbort(): void {
  seams.device = async (interaction) => {
    await Promise.resolve()
    interaction.notify({
      type: 'device_code',
      userCode: deviceChallenge.userCode,
      verificationUri: deviceChallenge.url,
    })
    await pendingAbort(interaction.signal).catch(() => undefined)
    return credential
  }
}

describe('GrokBuildWebAuth device prompts', () => {
  it('answers the device select prompt on the operator code path', async () => {
    const answers: string[] = []
    seams.device = async (interaction) => {
      await Promise.resolve()
      interaction.notify({
        type: 'device_code',
        userCode: deviceChallenge.userCode,
        verificationUri: deviceChallenge.url,
      })
      answers.push(
        await interaction.prompt({
          type: 'select',
          message: 'method',
          options: [
            { id: 'oauth', label: 'Sign in with Grok' },
            { id: 'api_key', label: 'API key' },
          ],
        }),
      )
      answers.push(
        await interaction.prompt({
          type: 'select',
          message: 'method',
          options: [{ id: 'device_code', label: 'Device code' }],
        }),
      )
      answers.push(await interaction.prompt({ type: 'select', message: 'method', options: [] }))
      return credential
    }
    const auth = new GrokBuildWebAuth(fakeGrokSession().session)
    expect(await auth.signIn('device')).toEqual(deviceChallenge)
    await waitImmediate()
    expect(answers).toEqual(['oauth', 'device_code', 'oauth'])
    // The stubbed flow persists nothing, so the settled status is the empty store's.
    await expect(auth.status()).resolves.toEqual({ status: 'signed-out', grokImportAvailable: false })
  })

  it('leaves a text prompt without a cancel channel pending for the whole sign-in', async () => {
    let promptSettled = false
    seams.device = async (interaction) => {
      await Promise.resolve()
      interaction.notify({
        type: 'device_code',
        userCode: deviceChallenge.userCode,
        verificationUri: deviceChallenge.url,
      })
      await interaction.prompt({ type: 'text', message: 'enter the code' })
      promptSettled = true
      return credential
    }
    const auth = new GrokBuildWebAuth(fakeGrokSession().session)
    expect(await auth.signIn('device')).toEqual(deviceChallenge)
    await waitImmediate()
    expect(promptSettled).toBe(false)
    await expect(auth.status()).resolves.toMatchObject({ status: 'signing-in', method: 'device' })
  })

  it('rejects an interactive prompt whose cancel channel is already aborted', async () => {
    seams.device = async (interaction) => {
      await Promise.resolve()
      interaction.notify({
        type: 'device_code',
        userCode: deviceChallenge.userCode,
        verificationUri: deviceChallenge.url,
      })
      await interaction.prompt({
        type: 'text',
        message: 'enter the code',
        signal: AbortSignal.abort(new Error('interactive prompt unavailable')),
      })
      return credential
    }
    const auth = new GrokBuildWebAuth(fakeGrokSession().session)
    await auth.signIn('device')
    await waitImmediate()
    await expect(auth.status()).resolves.toEqual({
      status: 'error',
      message: 'interactive prompt unavailable',
      grokImportAvailable: false,
    })
  })

  it('rejects an interactive prompt when its cancel channel aborts mid-flow', async () => {
    const controller = new AbortController()
    seams.device = async (interaction) => {
      await Promise.resolve()
      interaction.notify({
        type: 'device_code',
        userCode: deviceChallenge.userCode,
        verificationUri: deviceChallenge.url,
      })
      const pending = interaction.prompt({ type: 'text', message: 'enter the code', signal: controller.signal })
      queueMicrotask(() => {
        controller.abort(new Error('operator left the page'))
      })
      await pending
      return credential
    }
    const auth = new GrokBuildWebAuth(fakeGrokSession().session)
    await auth.signIn('device')
    await waitImmediate()
    await expect(auth.status()).resolves.toEqual({
      status: 'error',
      message: 'operator left the page',
      grokImportAvailable: false,
    })
  })

  it('ignores device-flow events that announce neither a code nor a URL', async () => {
    seams.device = async (interaction) => {
      await Promise.resolve()
      interaction.notify({ type: 'progress', message: 'contacting xAI' })
      interaction.notify({
        type: 'device_code',
        userCode: deviceChallenge.userCode,
        verificationUri: deviceChallenge.url,
      })
      await pendingAbort(interaction.signal)
      return credential
    }
    const auth = new GrokBuildWebAuth(fakeGrokSession().session)
    expect(await auth.signIn('device')).toEqual(deviceChallenge)
    await auth.cancel()
  })
})

describe('GrokBuildWebAuth status reads', () => {
  it('refuses a signed-in status that has no stored account', async () => {
    const auth = new GrokBuildWebAuth(fakeGrokSession({ credential, accounts: [] }).session)
    await expect(auth.status()).rejects.toThrow('signed-in status requires at least one stored account')
  })

  it('still cancels a pending login whose settled flow cannot read a status', async () => {
    deviceLoginCompletingOnAbort()
    const auth = new GrokBuildWebAuth(fakeGrokSession({ credential, accounts: [] }).session)
    expect(await auth.signIn('device')).toEqual(deviceChallenge)
    await expect(auth.cancel()).rejects.toThrow('signed-in status requires at least one stored account')
  })

  it('still imports Grok credentials whose settled flow cannot read a status', async () => {
    deviceLoginCompletingOnAbort()
    seams.importGrok = async () => undefined
    const auth = new GrokBuildWebAuth(fakeGrokSession({ credential, accounts: [] }).session)
    expect(await auth.signIn('device')).toEqual(deviceChallenge)
    await expect(auth.importGrok()).rejects.toThrow('signed-in status requires at least one stored account')
  })

  it('still ends the provider session whose settled flow cannot read a status', async () => {
    deviceLoginCompletingOnAbort()
    const fake = fakeGrokSession({ credential, accounts: [] })
    seams.probe = async () => ({ available: true, path: '/home/operator/.grok/auth.json' })
    const auth = new GrokBuildWebAuth(fake.session)
    expect(await auth.signIn('device')).toEqual(deviceChallenge)
    await auth.signOut()
    expect(fake.calls.logout).toBe(1)
    await expect(auth.status()).resolves.toEqual({ status: 'signed-out', grokImportAvailable: true })
  })

  it('still disposes a pending login whose settled flow cannot read a status', async () => {
    deviceLoginCompletingOnAbort()
    const auth = new GrokBuildWebAuth(fakeGrokSession({ credential, accounts: [] }).session)
    expect(await auth.signIn('device')).toEqual(deviceChallenge)
    await auth.dispose()
    await expect(auth.status()).rejects.toThrow('signed-in status requires at least one stored account')
  })
})
