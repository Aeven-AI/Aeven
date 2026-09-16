import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AuthInteraction } from '@earendil-works/pi-ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const setProvider = vi.fn()
const login = vi.fn(async () => {})
const modelsFor = vi.fn((options?: { credentials?: unknown }) => options)

// pi-ai's oauth login drives a device-code flow against auth.x.ai. Everything
// else in the module resolves against the real package.
vi.mock('@earendil-works/pi-ai', async importOriginal => ({
  ...(await importOriginal<typeof import('@earendil-works/pi-ai')>()),
  createModels: (options?: { credentials?: unknown }) => {
    modelsFor(options)
    return { setProvider, login }
  },
}))

const {
  grokBuildAuthStatus,
  importGrokBuildFromGrok,
  importGrokBuildSession,
  loginGrokBuild,
  loginGrokBuildSession,
  logoutGrokBuild,
} = await import('../src/auth.ts')
const { XAI_PI_PROVIDER } = await import('../src/ids.ts')
const { GrokBuildCredentialStore } = await import('../src/store.ts')

const interaction = { prompt: async () => '' } as unknown as AuthInteraction
const grokDocument = {
  'https://auth.x.ai::b1a00492-073a-47ea-816f-4c329264a828': {
    key: 'access-from-grok',
    refresh_token: 'refresh-from-grok',
    expires_at: '2026-08-14T12:00:00.000000Z',
    oidc_issuer: 'https://auth.x.ai',
    user_id: 'user-1',
  },
}

let home: string
let previousHome: string | undefined

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'dsh-auth-'))
  previousHome = process.env.AVN_HOME
  // Default-argument stores resolve below AVN_HOME; keep them in the sandbox.
  process.env.AVN_HOME = home
  setProvider.mockClear()
  login.mockClear()
  modelsFor.mockClear()
})

afterEach(() => {
  if (previousHome === undefined) delete process.env.AVN_HOME
  else process.env.AVN_HOME = previousHome
})

function storeAt(basename = 'auth.json'): InstanceType<typeof GrokBuildCredentialStore> {
  return new GrokBuildCredentialStore(join(home, basename))
}

async function writeOAuth(store: InstanceType<typeof GrokBuildCredentialStore>, expires: number): Promise<void> {
  await store.modify(
    XAI_PI_PROVIDER,
    async () =>
      ({
        type: 'oauth',
        access: 'access',
        refresh: 'refresh',
        expires,
      }),
  )
}

async function writeGrokFile(): Promise<string> {
  const path = join(home, 'grok-auth.json')
  await writeFile(path, JSON.stringify(grokDocument), { mode: 0o600 })
  return path
}

describe('loginGrokBuild', () => {
  it("logs in through the xAI provider with the caller's store and interaction", async () => {
    const store = storeAt()
    await loginGrokBuild(interaction, store)

    expect(modelsFor).toHaveBeenCalledWith({ credentials: store })
    expect(setProvider).toHaveBeenCalledTimes(1)
    expect(login).toHaveBeenCalledWith(XAI_PI_PROVIDER, 'oauth', interaction)
  })

  it('falls back to the AVN_HOME credential document when no store is given', async () => {
    await loginGrokBuild(interaction)

    const credentials = modelsFor.mock.calls[0]?.[0]?.credentials as { filename: string } | undefined
    expect(credentials?.filename).toBe(join(home, '.grok-build-auth.json'))
  })
})

describe('importGrokBuildFromGrok', () => {
  it('copies the Grok CLI document into the given store', async () => {
    const store = storeAt()
    await importGrokBuildFromGrok(store, await writeGrokFile())

    expect(await store.read(XAI_PI_PROVIDER)).toMatchObject({ type: 'oauth', access: 'access-from-grok' })
  })

  it('imports into the AVN_HOME store when no store is given', async () => {
    await importGrokBuildFromGrok(undefined, await writeGrokFile())

    const stored = await new GrokBuildCredentialStore().read(XAI_PI_PROVIDER)
    expect(stored).toMatchObject({ type: 'oauth', refresh: 'refresh-from-grok' })
  })
})

describe('logoutGrokBuild', () => {
  it('removes the stored credential', async () => {
    const store = storeAt()
    await writeOAuth(store, Date.now() + 60_000)
    await logoutGrokBuild(store)

    expect(await store.read(XAI_PI_PROVIDER)).toBeUndefined()
  })

  it('removes the AVN_HOME credential when no store is given', async () => {
    const store = new GrokBuildCredentialStore()
    await writeOAuth(store, Date.now() + 60_000)
    await logoutGrokBuild()

    expect(await store.read(XAI_PI_PROVIDER)).toBeUndefined()
  })
})

describe('grokBuildAuthStatus', () => {
  it('reports the expiry of a stored oauth credential without refreshing it', async () => {
    const expires = Date.now() + 3_600_000
    const store = storeAt()
    await writeOAuth(store, expires)

    expect(await grokBuildAuthStatus(store)).toStrictEqual({ authenticated: true, expiresAt: new Date(expires) })
    expect(login).not.toHaveBeenCalled()
  })

  it('reports an empty store as signed out', async () => {
    expect(await grokBuildAuthStatus(storeAt())).toStrictEqual({ authenticated: false })
  })

  it('reads the AVN_HOME store when no store is given', async () => {
    expect(await grokBuildAuthStatus()).toStrictEqual({ authenticated: false })
  })
})

describe('session helpers', () => {
  function fakeSession(store: InstanceType<typeof GrokBuildCredentialStore>) {
    const refreshLiveCatalog = vi.fn(async () => {})
    return { session: { store, refreshLiveCatalog }, refreshLiveCatalog }
  }

  it('refreshes the account catalog after a session login', async () => {
    const store = storeAt()
    const { session, refreshLiveCatalog } = fakeSession(store)

    await loginGrokBuildSession(interaction, session as never)

    expect(login).toHaveBeenCalledWith(XAI_PI_PROVIDER, 'oauth', interaction)
    expect(modelsFor).toHaveBeenCalledWith({ credentials: store })
    expect(refreshLiveCatalog).toHaveBeenCalledTimes(1)
  })

  it('refreshes the account catalog after a session import', async () => {
    const store = storeAt()
    const { session, refreshLiveCatalog } = fakeSession(store)

    await importGrokBuildSession(session as never, await writeGrokFile())

    expect(await store.read(XAI_PI_PROVIDER)).toMatchObject({ access: 'access-from-grok' })
    expect(refreshLiveCatalog).toHaveBeenCalledTimes(1)
  })
})
