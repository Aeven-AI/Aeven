import { setImmediate as waitImmediate } from 'node:timers/promises'
import type { Api, AuthInteraction, Credential, Model, OAuthCredential } from '@earendil-works/pi-ai'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SubscriptionWebAuth } from '../src/auth-routes.ts'
import { CODEX_OAUTH_PROVIDER } from '../src/oauth-providers.ts'
import type { OAuthProviderSession } from '../src/oauth-session.ts'

function fakeModel(): Model<'openai-codex-responses'> {
  return CODEX_OAUTH_PROVIDER.providerFactory().getModels()[0] as Model<'openai-codex-responses'>
}

const credential: OAuthCredential = {
  type: 'oauth',
  access: 'secret-access',
  refresh: 'secret-refresh',
  expires: Date.now() + 3_600_000,
}

function fakeSession(login: (interaction: AuthInteraction) => Promise<Credential>): OAuthProviderSession {
  let authenticated = false
  const model = fakeModel()
  const accounts = [
    {
      id: 'acct-1',
      expires: credential.expires,
      accountId: 'user-1',
    },
  ]
  return {
    definition: CODEX_OAUTH_PROVIDER,
    availableModels: () => [model],
    visibleModels: () => [model],
    selectedModelIds: () => undefined,
    status: async () => ({ authenticated }),
    store: {
      listAccounts: async () => (authenticated ? accounts : []),
      getActiveAccountId: async () => (authenticated ? 'acct-1' : undefined),
      setActiveAccount: async () => {},
      removeAccount: async () => {
        authenticated = false
      },
    },
    notifyCredentialChange: () => {},
    login: async (interaction: AuthInteraction) => {
      const next = await login(interaction)
      authenticated = true
      return next
    },
    setSelectedModels: async () => {},
    logout: async () => {
      authenticated = false
    },
  } as unknown as OAuthProviderSession
}

describe('SubscriptionWebAuth', () => {
  it('answers the Codex select prompt with device_code and publishes a device challenge', async () => {
    let selected = ''
    const session = fakeSession(async (interaction) => {
      selected = await interaction.prompt({
        type: 'select',
        message: 'method',
        options: [
          { id: 'browser', label: 'Browser login' },
          { id: 'device_code', label: 'Device code login' },
        ],
      })
      interaction.notify({
        type: 'device_code',
        userCode: 'ABCD-EFGH',
        verificationUri: 'https://auth.example/device',
      })
      await pendingAbort(interaction.signal)
      return credential
    })
    const auth = new SubscriptionWebAuth(session)
    const challenge = await auth.signIn('device')
    expect(selected).toBe('device_code')
    expect(challenge).toEqual({
      method: 'device',
      url: 'https://auth.example/device',
      userCode: 'ABCD-EFGH',
    })
    await auth.cancel()
  })

  it('accepts a pasted browser redirect without exposing credentials in status', async () => {
    let pasted = ''
    const session = fakeSession(async (interaction) => {
      const selected = await interaction.prompt({
        type: 'select',
        message: 'method',
        options: [{ id: 'browser', label: 'Browser login' }],
      })
      expect(selected).toBe('browser')
      interaction.notify({ type: 'auth_url', url: 'https://auth.example/authorize' })
      pasted = await interaction.prompt({ type: 'manual_code', message: 'paste redirect' })
      return credential
    })
    const auth = new SubscriptionWebAuth(session)
    expect(await auth.signIn('browser')).toEqual({
      method: 'browser',
      url: 'https://auth.example/authorize',
    })
    await auth.submitCode('http://localhost:1455/auth/callback?code=abc')
    await waitImmediate()
    expect(pasted).toContain('code=abc')
    const status = await auth.status()
    expect(status.status).toBe('signed-in')
    if (status.status === 'signed-in') {
      expect(status.accounts).toEqual([{ id: 'acct-1', expires: credential.expires, accountId: 'user-1' }])
      expect(status.activeAccountId).toBe('acct-1')
    }
    expect(JSON.stringify(status)).not.toContain('secret-access')
    expect(JSON.stringify(status)).not.toContain('secret-refresh')
  })

  it('times out and aborts a provider that never emits an OAuth challenge', async () => {
    const session = fakeSession(async interaction => pendingAbort(interaction.signal))
    const auth = new SubscriptionWebAuth(session, 5)
    await expect(auth.signIn('device')).rejects.toThrow(/timed out waiting/)
    await waitImmediate()
    expect((await auth.status()).status).toBe('signed-out')
  })

  it('turns a credential-store failure into a provider-local error status', async () => {
    const session = fakeSession(async () => credential);
    (session as unknown as { status(): Promise<never> }).status = async () => {
      throw new Error('Authorization: Bearer credential-secret')
    }
    const status = await new SubscriptionWebAuth(session).status()
    expect(status.status).toBe('error')
    expect(JSON.stringify(status)).not.toContain('credential-secret')
  })

  it('rejects unsupported login methods before starting OAuth', async () => {
    const auth = new SubscriptionWebAuth(fakeSession(async () => credential))
    await expect(auth.signIn('pkce' as never)).rejects.toThrow(/not supported/)
    await auth.dispose()
  })
})

afterEach(() => {
  vi.useRealTimers()
})

const AUTHORIZE_URL = 'https://auth.example/authorize'

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

/** Announce an authorization URL, then settle only once the flow aborts. */
async function announcingLogin(interaction: AuthInteraction): Promise<Credential> {
  await Promise.resolve()
  interaction.notify({ type: 'auth_url', url: AUTHORIZE_URL })
  await pendingAbort(interaction.signal).catch(() => undefined)
  return credential
}

/** A session whose catalog read can be made to fail after the sign-in began. */
function catalogFailureSession(login: (interaction: AuthInteraction) => Promise<Credential>): {
  session: OAuthProviderSession
  breakCatalog(): void
} {
  const session = fakeSession(login)
  let broken = false
  ;(session as unknown as { availableModels(): Model<Api>[] }).availableModels = () => {
    if (broken) throw new Error('model catalog unavailable')
    return [fakeModel()]
  }
  return {
    session,
    breakCatalog: () => {
      broken = true
    },
  }
}

/** Answer one select prompt with `options` and report what the provider received. */
async function selectedOption(
  method: 'device' | 'browser',
  options: readonly { id: string; label: string }[],
): Promise<string> {
  let selected = ''
  const session = fakeSession(async (interaction) => {
    await Promise.resolve()
    interaction.notify({ type: 'auth_url', url: AUTHORIZE_URL })
    selected = await interaction.prompt({ type: 'select', message: 'sign-in method', options })
    return credential
  })
  const auth = new SubscriptionWebAuth(session)
  await auth.signIn(method)
  await waitImmediate()
  await auth.dispose()
  return selected
}

describe('SubscriptionWebAuth select prompts', () => {
  it('answers a device select prompt by label when no well-known id is offered', async () => {
    const selected = await selectedOption('device', [
      { id: 'xai-headless', label: 'Headless sign-in' },
      { id: 'xai-browser', label: 'Browser sign-in' },
    ])
    expect(selected).toBe('xai-headless')
  })

  it('answers a browser select prompt by label when no well-known id is offered', async () => {
    const selected = await selectedOption('browser', [{ id: 'pkce-flow', label: 'PKCE in the browser' }])
    expect(selected).toBe('pkce-flow')
  })

  it('falls back to the first offered option when no id or label matches', async () => {
    const selected = await selectedOption('browser', [
      { id: 'primary', label: 'Continue' },
      { id: 'secondary', label: 'Something else' },
    ])
    expect(selected).toBe('primary')
  })

  it('answers an empty select prompt with the empty option id', async () => {
    expect(await selectedOption('browser', [])).toBe('')
  })
})

describe('SubscriptionWebAuth challenge delivery', () => {
  it('answers the in-flight state while a sign-in still waits for its challenge', async () => {
    const session = fakeSession(announcingLogin)
    const auth = new SubscriptionWebAuth(session)
    expect(await auth.signIn('browser')).toEqual({ method: 'browser', url: AUTHORIZE_URL })
    await expect(auth.status()).resolves.toMatchObject({
      status: 'signing-in',
      method: 'browser',
      url: AUTHORIZE_URL,
    })
    await auth.cancel()
  })

  it('rejects a waiting caller when the provider login settles without a challenge', async () => {
    const auth = new SubscriptionWebAuth(fakeSession(async () => credential))
    await expect(auth.signIn('device')).rejects.toThrow(/login completed without a challenge/)
    await expect(auth.status()).resolves.toMatchObject({ status: 'signed-in', activeAccountId: 'acct-1' })
  })

  it('rejects a waiting caller when the provider login fails before announcing anything', async () => {
    const auth = new SubscriptionWebAuth(
      fakeSession(async () => {
        throw new Error('codex login exploded')
      }),
    )
    await expect(auth.signIn('device')).rejects.toThrow('codex login exploded')
    // A failed provider login is not remembered: the settled status is the store's.
    await expect(auth.status()).resolves.toMatchObject({ status: 'signed-out' })
  })

  it('reports the provider expiry alongside a signed-in status', async () => {
    const session = fakeSession(async () => credential)
    const patched = session as unknown as {
      status(): Promise<{ authenticated: boolean; expiresAt?: number }>
      store: { listAccounts(): Promise<unknown[]>; getActiveAccountId(): Promise<string | undefined> }
    }
    patched.status = async () => ({ authenticated: true, expiresAt: credential.expires })
    patched.store.listAccounts = async () => [{ id: 'acct-1', expires: credential.expires, accountId: 'user-1' }]
    patched.store.getActiveAccountId = async () => 'acct-1'
    await expect(new SubscriptionWebAuth(session).status()).resolves.toMatchObject({
      status: 'signed-in',
      expiresAt: credential.expires,
      activeAccountId: 'acct-1',
    })
  })

  it('rejects a prompt type the subscription flow does not implement', async () => {
    let promptFailure: unknown
    const session = fakeSession(async (interaction) => {
      await Promise.resolve()
      interaction.notify({ type: 'auth_url', url: AUTHORIZE_URL })
      try {
        await interaction.prompt({ type: 'secret', message: 'paste a token' })
      } catch (error) {
        promptFailure = error
        throw error
      }
      return credential
    })
    const auth = new SubscriptionWebAuth(session)
    await auth.signIn('browser')
    await waitImmediate()
    expect(String(promptFailure)).toContain('unsupported OAuth prompt secret')
  })

  it('omits an empty device user code and ignores unrelated device events', async () => {
    const session = fakeSession(async (interaction) => {
      await Promise.resolve()
      interaction.notify({ type: 'progress', message: 'polling for approval' })
      interaction.notify({ type: 'device_code', userCode: '', verificationUri: 'https://auth.example/device' })
      await pendingAbort(interaction.signal).catch(() => undefined)
      return credential
    })
    const auth = new SubscriptionWebAuth(session)
    const challenge = await auth.signIn('device')
    expect(challenge).toEqual({ method: 'device', url: 'https://auth.example/device' })
    expect('userCode' in challenge).toBe(false)
    await auth.cancel()
  })

  it('aborts the flow when the announced authorization URL is not HTTPS', async () => {
    let abortedWith: unknown
    const session = fakeSession(async (interaction) => {
      await Promise.resolve()
      interaction.notify({ type: 'auth_url', url: 'http://insecure.example/authorize' })
      await pendingAbort(interaction.signal).catch((error: unknown) => {
        abortedWith = error
      })
      return credential
    })
    const auth = new SubscriptionWebAuth(session)
    await expect(auth.signIn('browser')).rejects.toThrow(/invalid authorization URL/)
    await waitImmediate()
    expect(String(abortedWith)).toContain('invalid authorization URL')
  })
})

describe('SubscriptionWebAuth code prompts', () => {
  it('rejects a manual-code prompt whose channel is already aborted', async () => {
    const closed = new AbortController()
    closed.abort(new Error('the paste channel closed'))
    let promptFailure: unknown
    const session = fakeSession(async (interaction) => {
      await Promise.resolve()
      interaction.notify({ type: 'auth_url', url: AUTHORIZE_URL })
      try {
        await interaction.prompt({ type: 'manual_code', message: 'paste the code', signal: closed.signal })
      } catch (error) {
        promptFailure = error
        throw error
      }
      return credential
    })
    const auth = new SubscriptionWebAuth(session)
    await auth.signIn('browser')
    await waitImmediate()
    expect(String(promptFailure)).toBe('Error: the paste channel closed')
    await expect(auth.submitCode('late')).rejects.toThrow(/no authorization-code login is waiting for a code/)
  })

  it('keeps the newest code resolver when an older paste prompt aborts', async () => {
    const session = fakeSession(async (interaction) => {
      await Promise.resolve()
      interaction.notify({ type: 'auth_url', url: AUTHORIZE_URL })
      const first = interaction.prompt({ type: 'manual_code', message: 'first paste' })
      const second = interaction.prompt({ type: 'manual_code', message: 'second paste' })
      void first.catch(() => undefined)
      void second.catch(() => undefined)
      await pendingAbort(interaction.signal).catch(() => undefined)
      return credential
    })
    const auth = new SubscriptionWebAuth(session)
    await auth.signIn('browser')
    await auth.cancel()
    await expect(auth.submitCode('late')).rejects.toThrow(/no authorization-code login is waiting for a code/)
    await expect(auth.status()).resolves.toMatchObject({ status: 'signed-in', activeAccountId: 'acct-1' })
  })

  it('ignores a timeout that fires after the challenge was already delivered', async () => {
    // The waiter leaves the pending list the moment the challenge is delivered, so
    // this guard only runs on a platform that still fires an already-cancelled
    // timeout. Faking setTimeout alone models exactly that: the delivered challenge
    // wins, and the stale timeout that fires afterwards must change nothing.
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    try {
      const session = fakeSession(async (interaction) => {
        await Promise.resolve()
        interaction.notify({ type: 'auth_url', url: AUTHORIZE_URL })
        return credential
      })
      const auth = new SubscriptionWebAuth(session, 5)
      await expect(auth.signIn('browser')).resolves.toEqual({ method: 'browser', url: AUTHORIZE_URL })
      vi.advanceTimersByTime(50)
      await waitImmediate()
      await expect(auth.status()).resolves.toMatchObject({ status: 'signed-in', activeAccountId: 'acct-1' })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('SubscriptionWebAuth teardown', () => {
  it('cancels a sign-in whose settled flow cannot read the catalog', async () => {
    const catalog = catalogFailureSession(announcingLogin)
    const auth = new SubscriptionWebAuth(catalog.session)
    expect(await auth.signIn('browser')).toEqual({ method: 'browser', url: AUTHORIZE_URL })
    catalog.breakCatalog()
    await expect(auth.cancel()).rejects.toThrow('model catalog unavailable')
  })

  it('ends a provider session whose settled flow cannot read the catalog', async () => {
    const catalog = catalogFailureSession(announcingLogin)
    const auth = new SubscriptionWebAuth(catalog.session)
    expect(await auth.signIn('browser')).toEqual({ method: 'browser', url: AUTHORIZE_URL })
    catalog.breakCatalog()
    await expect(auth.signOut()).rejects.toThrow('model catalog unavailable')
  })

  it('disposes a sign-in whose settled flow cannot read the catalog', async () => {
    const catalog = catalogFailureSession(announcingLogin)
    const auth = new SubscriptionWebAuth(catalog.session)
    expect(await auth.signIn('browser')).toEqual({ method: 'browser', url: AUTHORIZE_URL })
    catalog.breakCatalog()
    await expect(auth.dispose()).resolves.toBeUndefined()
    await expect(auth.status()).rejects.toThrow('model catalog unavailable')
  })
})
