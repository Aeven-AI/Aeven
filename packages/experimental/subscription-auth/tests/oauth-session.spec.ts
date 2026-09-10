import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CLAUDE_CODE_OAUTH_PROVIDER } from '../src/oauth-providers.ts'
import { OAuthProviderSession, oauthModelsCachePath } from '../src/oauth-session.ts'
import { OAuthCredentialFileStore } from '../src/store.ts'

describe('oauthModelsCachePath', () => {
  it('resolves the models cache below the harness home', () => {
    expect(oauthModelsCachePath('claude-models.json', '/tmp/example-dsh-home')).toBe(
      resolve('/tmp/example-dsh-home', 'claude-models.json'),
    )
  })
})

describe('OAuthProviderSession', () => {
  it('exposes the whole catalogue and resolves the refreshed store token', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-oauth-session-'))
    const authFile = join(dir, 'auth.json')
    const cacheFile = join(dir, 'models.json')
    const store = new OAuthCredentialFileStore(
      CLAUDE_CODE_OAUTH_PROVIDER.nativeProviderId,
      authFile,
      CLAUDE_CODE_OAUTH_PROVIDER.route,
    )
    await store.modify(CLAUDE_CODE_OAUTH_PROVIDER.nativeProviderId, async () => ({
      type: 'oauth',
      access: 'claude-access',
      refresh: 'claude-refresh',
      expires: Date.now() + 3_600_000,
    }))
    const first = new OAuthProviderSession(CLAUDE_CODE_OAUTH_PROVIDER, undefined, store, cacheFile)
    // There is no per-provider selection; the subscription's catalogue is what
    // the session offers.
    expect(first.visibleModels().map(model => model.id)).toEqual(first.availableModels().map(model => model.id))
    expect(await first.resolveAccessToken()).toBe('claude-access')

    const second = new OAuthProviderSession(CLAUDE_CODE_OAUTH_PROVIDER, undefined, store, cacheFile)
    await second.loadCachedModels()
    expect(second.provider().id).toBe(CLAUDE_CODE_OAUTH_PROVIDER.nativeProviderId)
  })

  it('notifies the LLM registry after a successful login', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-oauth-login-notify-'))
    const notify = vi.fn()
    const session = new OAuthProviderSession(
      CLAUDE_CODE_OAUTH_PROVIDER,
      notify,
      new OAuthCredentialFileStore(
        CLAUDE_CODE_OAUTH_PROVIDER.nativeProviderId,
        join(dir, 'auth.json'),
        CLAUDE_CODE_OAUTH_PROVIDER.route,
      ),
      join(dir, 'models.json'),
    )
    vi.spyOn(session.models, 'login').mockResolvedValue({
      type: 'oauth',
      access: 'a',
      refresh: 'r',
      expires: Date.now() + 3_600_000,
    })
    await session.login({ prompt: async () => '', notify: () => {} })
    expect(notify).toHaveBeenCalledOnce()
  })

  it('deletes only its credential and cache on logout', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-oauth-logout-'))
    const store = new OAuthCredentialFileStore(
      CLAUDE_CODE_OAUTH_PROVIDER.nativeProviderId,
      join(dir, 'auth.json'),
      CLAUDE_CODE_OAUTH_PROVIDER.route,
    )
    await store.modify(CLAUDE_CODE_OAUTH_PROVIDER.nativeProviderId, async () => ({
      type: 'oauth',
      access: 'a',
      refresh: 'r',
      expires: Date.now() + 3_600_000,
    }))
    const notify = vi.fn()
    const session = new OAuthProviderSession(CLAUDE_CODE_OAUTH_PROVIDER, notify, store, join(dir, 'models.json'))
    await session.logout()
    expect(await session.status()).toEqual({ authenticated: false })
    expect(notify).toHaveBeenCalledOnce()
  })

  it('notifies discovery when cache cleanup fails after credential deletion', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-oauth-logout-cleanup-failure-'))
    const store = new OAuthCredentialFileStore(
      CLAUDE_CODE_OAUTH_PROVIDER.nativeProviderId,
      join(dir, 'auth.json'),
      CLAUDE_CODE_OAUTH_PROVIDER.route,
    )
    await store.modify(CLAUDE_CODE_OAUTH_PROVIDER.nativeProviderId, async () => ({
      type: 'oauth',
      access: 'a',
      refresh: 'r',
      expires: Date.now() + 3_600_000,
    }))
    const blockedParent = join(dir, 'not-a-directory')
    await writeFile(blockedParent, 'blocked')
    const notify = vi.fn()
    const session = new OAuthProviderSession(
      CLAUDE_CODE_OAUTH_PROVIDER,
      notify,
      store,
      join(blockedParent, 'models.json'),
    )
    await expect(session.logout()).rejects.toThrow()
    expect(await session.status()).toEqual({ authenticated: false })
    expect(notify).toHaveBeenCalledOnce()
  })

  it('invalidateAccessToken backdates the stored credential expiry', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-oauth-invalidate-'))
    const store = new OAuthCredentialFileStore(
      CLAUDE_CODE_OAUTH_PROVIDER.nativeProviderId,
      join(dir, 'auth.json'),
      CLAUDE_CODE_OAUTH_PROVIDER.route,
    )
    await store.modify(CLAUDE_CODE_OAUTH_PROVIDER.nativeProviderId, async () => ({
      type: 'oauth',
      access: 'a',
      refresh: 'r',
      expires: Date.now() + 3_600_000,
    }))
    const session = new OAuthProviderSession(CLAUDE_CODE_OAUTH_PROVIDER, undefined, store, join(dir, 'models.json'))
    await session.invalidateAccessToken()
    const credential = await store.read(CLAUDE_CODE_OAUTH_PROVIDER.nativeProviderId)
    expect(credential?.type === 'oauth' && credential.expires).toBeLessThanOrEqual(Date.now())
    expect(credential?.type === 'oauth' && credential.access).toBe('a')
  })

  it('notifies host discovery on an account switch without a logout', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-oauth-notify-change-'))
    const notify = vi.fn()
    const session = new OAuthProviderSession(
      CLAUDE_CODE_OAUTH_PROVIDER,
      notify,
      new OAuthCredentialFileStore(
        CLAUDE_CODE_OAUTH_PROVIDER.nativeProviderId,
        join(dir, 'auth.json'),
        CLAUDE_CODE_OAUTH_PROVIDER.route,
      ),
      join(dir, 'models.json'),
    )
    session.notifyCredentialChange()
    expect(notify).toHaveBeenCalledOnce()
  })

  it('reports no access token when the provider resolves no credential', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-oauth-no-auth-'))
    const session = new OAuthProviderSession(
      CLAUDE_CODE_OAUTH_PROVIDER,
      undefined,
      new OAuthCredentialFileStore(
        CLAUDE_CODE_OAUTH_PROVIDER.nativeProviderId,
        join(dir, 'auth.json'),
        CLAUDE_CODE_OAUTH_PROVIDER.route,
      ),
      join(dir, 'models.json'),
    )
    vi.spyOn(session.models, 'getAuth').mockResolvedValue(undefined)
    await expect(session.resolveAccessToken()).resolves.toBeUndefined()
  })

  it('ignores a stored credential that is not an OAuth one', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-oauth-non-oauth-'))
    const store = new OAuthCredentialFileStore(
      CLAUDE_CODE_OAUTH_PROVIDER.nativeProviderId,
      join(dir, 'auth.json'),
      CLAUDE_CODE_OAUTH_PROVIDER.route,
    )
    await store.modify(CLAUDE_CODE_OAUTH_PROVIDER.nativeProviderId, async () => ({
      type: 'oauth',
      access: 'a',
      refresh: 'r',
      expires: Date.now() + 3_600_000,
    }))
    const session = new OAuthProviderSession(CLAUDE_CODE_OAUTH_PROVIDER, undefined, store, join(dir, 'models.json'))
    vi.spyOn(session.models, 'getAuth').mockResolvedValue({ auth: { apiKey: 'a' } })
    vi.spyOn(store, 'read').mockResolvedValue({ type: 'api_key', key: 'a' })
    await expect(session.resolveAccessToken()).resolves.toBeUndefined()
  })

  it('reads the stored OAuth credential and reports absence as undefined', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-oauth-stored-'))
    const store = new OAuthCredentialFileStore(
      CLAUDE_CODE_OAUTH_PROVIDER.nativeProviderId,
      join(dir, 'auth.json'),
      CLAUDE_CODE_OAUTH_PROVIDER.route,
    )
    await store.modify(CLAUDE_CODE_OAUTH_PROVIDER.nativeProviderId, async () => ({
      type: 'oauth',
      access: 'claude-access',
      refresh: 'claude-refresh',
      expires: Date.now() + 3_600_000,
    }))
    const session = new OAuthProviderSession(CLAUDE_CODE_OAUTH_PROVIDER, undefined, store, join(dir, 'models.json'))
    await expect(session.storedCredential()).resolves.toMatchObject({
      type: 'oauth',
      access: 'claude-access',
      refresh: 'claude-refresh',
    })

    const empty = new OAuthProviderSession(
      CLAUDE_CODE_OAUTH_PROVIDER,
      undefined,
      new OAuthCredentialFileStore(
        CLAUDE_CODE_OAUTH_PROVIDER.nativeProviderId,
        join(dir, 'absent.json'),
        CLAUDE_CODE_OAUTH_PROVIDER.route,
      ),
      join(dir, 'absent-models.json'),
    )
    await expect(empty.storedCredential()).resolves.toBeUndefined()
  })
})
