import { chmod, lstat, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { OAuthCredential } from '@earendil-works/pi-ai'
import { afterEach, describe, expect, it } from 'vitest'
import { CODEX_PI_PROVIDER, GROK_BUILD_AUTH_FILENAME, XAI_PI_PROVIDER } from '../src/ids.ts'
import { CREDENTIAL_FILE_MAX_BYTES } from '../src/credential-file.ts'
import {
  GrokBuildCredentialStore,
  OAUTH_MAX_ACCOUNTS,
  OAuthCredentialFileStore,
  grokBuildAuthPath,
  oauthCredentialPath,
} from '../src/store.ts'

const files: string[] = []

afterEach(async () => {
  files.length = 0
})

async function tempStore(): Promise<GrokBuildCredentialStore> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-grok-build-'))
  const filename = join(dir, 'auth.json')
  files.push(filename)
  return new GrokBuildCredentialStore(filename)
}

describe('oauthCredentialPath', () => {
  it('accepts only a local basename and cannot escape DSH_HOME', () => {
    expect(oauthCredentialPath('codex-oauth.json', '/tmp/example-dsh-home')).toBe(
      resolve('/tmp/example-dsh-home', 'codex-oauth.json'),
    )
    for (const basename of ['../outside.json', 'nested/auth.json', 'nested\\auth.json', '.', '..', '']) {
      expect(() => oauthCredentialPath(basename, '/tmp/example-dsh-home')).toThrow(/safe local filename/)
    }
  })

  it('resolves the legacy Grok Build auth document below DSH_HOME', () => {
    expect(grokBuildAuthPath('/tmp/example-dsh-home')).toBe(
      resolve('/tmp/example-dsh-home', GROK_BUILD_AUTH_FILENAME),
    )
  })
})

describe('GrokBuildCredentialStore', () => {
  it('round-trips an oauth credential', async () => {
    const store = await tempStore()
    const written = await store.modify(XAI_PI_PROVIDER, async () => ({
      type: 'oauth',
      access: 'access-token',
      refresh: 'refresh-token',
      expires: 1_700_000_000_000,
    }))
    expect(written).toMatchObject({ type: 'oauth', access: 'access-token', refresh: 'refresh-token' })
    const read = await store.read(XAI_PI_PROVIDER)
    expect(read).toEqual(written)
    expect(await store.list()).toEqual([{ providerId: XAI_PI_PROVIDER, type: 'oauth' }])
    const text = await readFile(store.filename, 'utf8')
    const onDisk = JSON.parse(text) as { version: number; activeAccountId: string; accounts: unknown[] }
    expect(onDisk.version).toBe(2)
    expect(onDisk.accounts).toHaveLength(1)
    expect(onDisk.activeAccountId).toBeTruthy()
  })

  it('writes the credential owner-only', async () => {
    const store = await tempStore()
    await store.modify(XAI_PI_PROVIDER, async () => ({
      type: 'oauth',
      access: 'a',
      refresh: 'r',
      expires: 1,
    }))
    const { stat } = await import('node:fs/promises')
    const mode = (await stat(store.filename)).mode & 0o777
    if (process.platform !== 'win32') expect(mode).toBe(0o600)
  })

  it('rejects a credential file that became group-readable', async () => {
    if (process.platform === 'win32') return
    const store = await tempStore()
    await store.modify(XAI_PI_PROVIDER, async () => ({
      type: 'oauth',
      access: 'a',
      refresh: 'r',
      expires: 1,
    }))
    await chmod(store.filename, 0o640)
    await expect(store.read(XAI_PI_PROVIDER)).rejects.toThrow(/owner-only no-follow validation/)
  })

  it('rejects a leaf symlink even when its target is owner-only', async () => {
    if (process.platform === 'win32') return
    const dir = await mkdtemp(join(tmpdir(), 'dsh-grok-build-symlink-'))
    const target = join(dir, 'real-auth.json')
    const store = new GrokBuildCredentialStore(join(dir, 'auth.json'))
    await writeFile(
      target,
      `${JSON.stringify({
        version: 1,
        credential: { type: 'oauth', access: 'a', refresh: 'r', expires: 1 },
      })}\n`,
      { mode: 0o600 },
    )
    await symlink(target, store.filename)
    await expect(store.read(XAI_PI_PROVIDER)).rejects.toThrow(/owner-only no-follow validation/)
  })

  it('ignores other provider ids on read and refuses them on write', async () => {
    const store = await tempStore()
    await store.modify(XAI_PI_PROVIDER, async () => ({
      type: 'oauth',
      access: 'a',
      refresh: 'r',
      expires: 1,
    }))
    expect(await store.read('openai-codex')).toBeUndefined()
    await expect(store.modify('openai-codex', async current => current)).rejects.toThrow(/does not own/)
  })

  it('rejects an unsupported document version', async () => {
    const store = await tempStore()
    await writeFile(
      store.filename,
      `${JSON.stringify({
        version: 99,
        credential: { type: 'oauth', access: 'a', refresh: 'r', expires: 1 },
      })}\n`,
      { mode: 0o600 },
    )
    await expect(store.read(XAI_PI_PROVIDER)).rejects.toThrow(/unsupported auth format version/)
  })

  it('rejects unknown credential fields', async () => {
    const store = await tempStore()
    await writeFile(
      store.filename,
      `${JSON.stringify({
        version: 1,
        credential: { type: 'oauth', access: 'a', refresh: 'r', expires: 1, leak: 'nope' },
      })}\n`,
      { mode: 0o600 },
    )
    await expect(store.read(XAI_PI_PROVIDER)).rejects.toThrow(/unknown field/)
  })

  it('lets modify replace an owner-only unreadable JSON file', async () => {
    const store = await tempStore()
    await writeFile(store.filename, '{not-json', { mode: 0o600 })
    await expect(store.read(XAI_PI_PROVIDER)).rejects.toThrow(/is not valid JSON/)
    await expect(store.list()).rejects.toThrow(/is not valid JSON/)

    let seen: unknown = 'unset'
    const written = await store.modify(XAI_PI_PROVIDER, async (current) => {
      seen = current
      return { type: 'oauth', access: 'new-access', refresh: 'new-refresh', expires: 2 }
    })
    expect(seen).toBeUndefined()
    expect(written).toMatchObject({ type: 'oauth', access: 'new-access', refresh: 'new-refresh', expires: 2 })
    expect(await store.read(XAI_PI_PROVIDER)).toEqual(written)
    const { stat } = await import('node:fs/promises')
    if (process.platform !== 'win32') expect((await stat(store.filename)).mode & 0o777).toBe(0o600)
    const text = await readFile(store.filename, 'utf8')
    expect(JSON.parse(text)).toMatchObject({
      version: 2,
      accounts: [
        expect.objectContaining({
          credential: expect.objectContaining({ access: 'new-access' }) as { access: string },
        }) as { credential: { access: string } },
      ],
    })
    expect(text).not.toContain('{not-json')
  })

  it('lets modify replace owner-only documents that fail schema while read stays loud', async () => {
    const store = await tempStore()
    await writeFile(
      store.filename,
      `${JSON.stringify({
        version: 99,
        credential: { type: 'oauth', access: 'old', refresh: 'old-r', expires: 1 },
      })}\n`,
      { mode: 0o600 },
    )
    await expect(store.read(XAI_PI_PROVIDER)).rejects.toThrow(/unsupported auth format version/)
    const replaced = await store.modify(XAI_PI_PROVIDER, async (current) => {
      expect(current).toBeUndefined()
      return { type: 'oauth', access: 'fixed', refresh: 'fixed-r', expires: 3 }
    })
    expect(replaced).toMatchObject({ access: 'fixed' })

    await writeFile(
      store.filename,
      `${JSON.stringify({
        version: 1,
        credential: { type: 'oauth', access: 'a', refresh: 'r', expires: 1, leak: 'nope' },
      })}\n`,
      { mode: 0o600 },
    )
    await expect(store.list()).rejects.toThrow(/unknown field/)
    await store.modify(XAI_PI_PROVIDER, async (current) => {
      expect(current).toBeUndefined()
      return { type: 'oauth', access: 'clean', refresh: 'clean-r', expires: 4 }
    })
    expect(await store.read(XAI_PI_PROVIDER)).toMatchObject({ access: 'clean' })
  })

  it('refuses to modify a group-readable, symlink, or oversized destination', async () => {
    if (process.platform !== 'win32') {
      const wide = await tempStore()
      await writeFile(wide.filename, '{not-json', { mode: 0o600 })
      await chmod(wide.filename, 0o644)
      await expect(
        wide.modify(XAI_PI_PROVIDER, async () => ({ type: 'oauth', access: 'a', refresh: 'r', expires: 1 })),
      ).rejects.toThrow(/owner-only no-follow validation/)
      expect(await readFile(wide.filename, 'utf8')).toBe('{not-json')

      const dir = await mkdtemp(join(tmpdir(), 'dsh-grok-build-symlink-mod-'))
      const target = join(dir, 'real-auth.json')
      const linked = new GrokBuildCredentialStore(join(dir, 'auth.json'))
      await writeFile(target, '{not-json', { mode: 0o600 })
      await symlink(target, linked.filename)
      await expect(
        linked.modify(XAI_PI_PROVIDER, async () => ({ type: 'oauth', access: 'a', refresh: 'r', expires: 1 })),
      ).rejects.toThrow(/owner-only no-follow validation/)
      expect((await lstat(linked.filename)).isSymbolicLink()).toBe(true)
      expect(await readFile(target, 'utf8')).toBe('{not-json')
    }

    const huge = await tempStore()
    await writeFile(huge.filename, 'x'.repeat(CREDENTIAL_FILE_MAX_BYTES + 1), { mode: 0o600 })
    await expect(
      huge.modify(XAI_PI_PROVIDER, async () => ({ type: 'oauth', access: 'a', refresh: 'r', expires: 1 })),
    ).rejects.toMatchObject({ code: 'too_large' })
    expect((await readFile(huge.filename)).byteLength).toBe(CREDENTIAL_FILE_MAX_BYTES + 1)
  })

  it('revalidates the destination immediately before replace', async () => {
    if (process.platform === 'win32') return
    const store = await tempStore()
    await writeFile(store.filename, '{not-json', { mode: 0o600 })
    await expect(
      store.modify(XAI_PI_PROVIDER, async (current) => {
        expect(current).toBeUndefined()
        await chmod(store.filename, 0o644)
        return { type: 'oauth', access: 'a', refresh: 'r', expires: 1 }
      }),
    ).rejects.toThrow(/owner-only no-follow validation/)
    expect(await readFile(store.filename, 'utf8')).toBe('{not-json')

    const dir = await mkdtemp(join(tmpdir(), 'dsh-grok-build-revalidate-'))
    const store2 = new GrokBuildCredentialStore(join(dir, 'auth.json'))
    const target = join(dir, 'outside.json')
    await writeFile(store2.filename, '{not-json', { mode: 0o600 })
    await writeFile(target, 'secret-outside', { mode: 0o600 })
    await expect(
      store2.modify(XAI_PI_PROVIDER, async (current) => {
        expect(current).toBeUndefined()
        await rm(store2.filename)
        await symlink(target, store2.filename)
        return { type: 'oauth', access: 'a', refresh: 'r', expires: 1 }
      }),
    ).rejects.toThrow(/owner-only no-follow validation/)
    expect((await lstat(store2.filename)).isSymbolicLink()).toBe(true)
    expect(await readFile(target, 'utf8')).toBe('secret-outside')
  })

  it('deletes only the xAI credential', async () => {
    const store = await tempStore()
    await store.modify(XAI_PI_PROVIDER, async () => ({
      type: 'oauth',
      access: 'a',
      refresh: 'r',
      expires: 1,
    }))
    await store.delete(XAI_PI_PROVIDER)
    expect(await store.read(XAI_PI_PROVIDER)).toBeUndefined()
    expect(await store.list()).toEqual([])
  })
})

describe('OAuthCredentialFileStore', () => {
  it('isolates provider ids and preserves Codex accountId', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-codex-store-'))
    const store = new OAuthCredentialFileStore(CODEX_PI_PROVIDER, join(dir, 'codex.json'), 'codex-oauth')
    const credential = await store.modify(CODEX_PI_PROVIDER, async () => ({
      type: 'oauth',
      access: 'codex-access',
      refresh: 'codex-refresh',
      expires: 1_800_000_000_000,
      accountId: 'account-1',
    }))
    expect(credential).toMatchObject({ accountId: 'account-1' })
    expect(await store.read(XAI_PI_PROVIDER)).toBeUndefined()
    await expect(store.modify(XAI_PI_PROVIDER, async current => current)).rejects.toThrow(/does not own provider/)
  })

  it('keeps two provider files independent', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-oauth-stores-'))
    const codex = new OAuthCredentialFileStore(CODEX_PI_PROVIDER, join(dir, 'codex.json'), 'codex-oauth')
    const other = new OAuthCredentialFileStore('anthropic', join(dir, 'claude.json'), 'claude-code-oauth')
    await codex.modify(CODEX_PI_PROVIDER, async () => ({
      type: 'oauth',
      access: 'c',
      refresh: 'cr',
      expires: 10,
    }))
    await other.modify('anthropic', async () => ({
      type: 'oauth',
      access: 'a',
      refresh: 'ar',
      expires: 20,
    }))
    expect(await codex.read(CODEX_PI_PROVIDER)).toMatchObject({ access: 'c' })
    expect(await other.read('anthropic')).toMatchObject({ access: 'a' })
    await codex.delete(CODEX_PI_PROVIDER)
    expect(await other.read('anthropic')).toMatchObject({ access: 'a' })
  })

  it('invalidate backdates expires while preserving the token pair', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-invalidate-'))
    const store = new OAuthCredentialFileStore(CODEX_PI_PROVIDER, join(dir, 'codex.json'), 'codex-oauth')
    const future = Date.now() + 3_600_000
    await store.modify(CODEX_PI_PROVIDER, async () => ({
      type: 'oauth',
      access: 'codex-access',
      refresh: 'codex-refresh',
      expires: future,
      accountId: 'account-1',
    }))
    const before = Date.now()
    expect(await store.invalidate(CODEX_PI_PROVIDER)).toBe(true)
    const after = Date.now()
    const credential = await store.read(CODEX_PI_PROVIDER)
    expect(credential).toMatchObject({
      type: 'oauth',
      access: 'codex-access',
      refresh: 'codex-refresh',
      accountId: 'account-1',
    })
    // Backdated into the past (so getAuth refreshes) yet still a valid document.
    expect(credential?.type === 'oauth' && credential.expires).toBeGreaterThan(0)
    expect(credential?.type === 'oauth' && credential.expires).toBeLessThanOrEqual(after)
    expect(credential?.type === 'oauth' && credential.expires).toBeLessThanOrEqual(before)
  })

  it('invalidate is a no-op without a stored credential and for foreign ids', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-invalidate-empty-'))
    const store = new OAuthCredentialFileStore(CODEX_PI_PROVIDER, join(dir, 'codex.json'), 'codex-oauth')
    expect(await store.invalidate(CODEX_PI_PROVIDER)).toBe(false)
    expect(await store.invalidate(XAI_PI_PROVIDER)).toBe(false)
  })
})

function oauthCredential(overrides: Partial<OAuthCredential> & { access: string; refresh: string }): OAuthCredential {
  return {
    type: 'oauth',
    expires: Date.now() + 3_600_000,
    ...overrides,
  }
}

describe('OAuthCredentialFileStore AuthDocument v2', () => {
  async function createStore(): Promise<{ store: OAuthCredentialFileStore; path: string }> {
    const directory = await mkdtemp(join(tmpdir(), 'sub-oauth-store-v2-'))
    const path = join(directory, 'provider.json')
    files.push(path)
    const store = new OAuthCredentialFileStore('test-provider', path, 'test-oauth')
    return { store, path }
  }

  /** An on-disk account record that passes every field check on its own. */
  function accountRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: 'acct-a',
      credential: { type: 'oauth', access: 'access-a', refresh: 'refresh-a', expires: 1 },
      createdAt: 1,
      ...overrides,
    }
  }

  function v2Document(accounts: unknown, activeAccountId: unknown = 'acct-a'): string {
    return `${JSON.stringify({ version: 2, activeAccountId, accounts })}\n`
  }

  async function writeDocument(path: string, body: string): Promise<void> {
    await writeFile(path, body, { mode: 0o600 })
  }

  it('exports the Hub-aligned account cap', () => {
    expect(OAUTH_MAX_ACCOUNTS).toBe(8)
  })

  it('migrates a v1 document to one account under lock', async () => {
    const { store, path } = await createStore()
    const credential = oauthCredential({
      access: 'access-v1',
      refresh: 'refresh-v1',
      accountId: 'safe-user',
    })
    await writeFile(path, `${JSON.stringify({ version: 1, credential }, null, 2)}\n`, { mode: 0o600 })

    expect(await store.getActiveAccountId()).toBe('safe-user')
    expect(await store.listAccounts()).toEqual([
      {
        id: 'safe-user',
        expires: credential.expires,
        accountId: 'safe-user',
      },
    ])

    const onDisk = JSON.parse(await readFile(path, 'utf8')) as {
      version: number
      activeAccountId: string
      accounts: Array<{ id: string; credential: OAuthCredential }>
    }
    expect(onDisk.version).toBe(2)
    expect(onDisk.activeAccountId).toBe('safe-user')
    expect(onDisk.accounts).toHaveLength(1)
    expect(onDisk.accounts[0]?.credential.access).toBe('access-v1')
  })

  it('migrates unsafe v1 credential.accountId to legacy', async () => {
    const { store, path } = await createStore()
    await writeFile(
      path,
      `${JSON.stringify(
        {
          version: 1,
          credential: oauthCredential({
            access: 'a',
            refresh: 'r',
            accountId: 'has spaces',
          }),
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    )

    expect(await store.getActiveAccountId()).toBe('legacy')
    const onDisk = JSON.parse(await readFile(path, 'utf8')) as { activeAccountId: string }
    expect(onDisk.activeAccountId).toBe('legacy')
  })

  it('serializes concurrent mutateDocument calls through the file lock', async () => {
    const { store, path } = await createStore()
    await writeFile(
      path,
      `${JSON.stringify(
        {
          version: 1,
          credential: oauthCredential({ access: 'access-v1', refresh: 'refresh-v1', accountId: 'locked' }),
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    )

    const started: number[] = []
    const finished: number[] = []
    const run = async (index: number) => {
      started.push(index)
      await store.upsertAccount({
        id: `acct-${String(index)}`,
        credential: oauthCredential({
          access: `access-${String(index)}`,
          refresh: `refresh-${String(index)}`,
        }),
      })
      finished.push(index)
    }

    await Promise.all([run(1), run(2), run(3)])
    expect(started).toHaveLength(3)
    expect([...finished].sort((a, b) => a - b)).toEqual([1, 2, 3])

    const onDisk = JSON.parse(await readFile(path, 'utf8')) as {
      version: number
      accounts: Array<{ id: string }>
    }
    expect(onDisk.version).toBe(2)
    expect(onDisk.accounts.map(account => account.id).sort()).toEqual(['acct-1', 'acct-2', 'acct-3', 'locked'])
  })

  it('upserts a second account and setActive switches CredentialStore.read', async () => {
    const { store } = await createStore()
    await store.upsertAccount({
      id: 'acct-a',
      label: 'Alpha',
      credential: oauthCredential({ access: 'access-a', refresh: 'refresh-a', accountId: 'provider-a' }),
      makeActive: true,
    })
    await store.upsertAccount({
      id: 'acct-b',
      label: 'Beta',
      credential: oauthCredential({ access: 'access-b', refresh: 'refresh-b', accountId: 'provider-b' }),
    })

    expect(await store.getActiveAccountId()).toBe('acct-a')
    expect(await store.read('test-provider')).toMatchObject({ access: 'access-a', refresh: 'refresh-a' })
    expect(await store.listAccounts()).toEqual([
      { id: 'acct-a', label: 'Alpha', expires: expect.any(Number) as number, accountId: 'provider-a' },
      { id: 'acct-b', label: 'Beta', expires: expect.any(Number) as number, accountId: 'provider-b' },
    ])
    expect(JSON.stringify(await store.listAccounts())).not.toMatch(/access-|refresh-/u)

    await store.setActiveAccount('acct-b')
    expect(await store.getActiveAccountId()).toBe('acct-b')
    expect(await store.read('test-provider')).toMatchObject({ access: 'access-b', refresh: 'refresh-b' })
  })

  it('removeAccount failovers when the active account is removed', async () => {
    const { store, path } = await createStore()
    await store.upsertAccount({
      id: 'first',
      credential: oauthCredential({ access: 'access-1', refresh: 'refresh-1' }),
      makeActive: true,
    })
    await store.upsertAccount({
      id: 'second',
      credential: oauthCredential({ access: 'access-2', refresh: 'refresh-2' }),
    })
    await store.setActiveAccount('first')

    await store.removeAccount('first')
    expect(await store.getActiveAccountId()).toBe('second')
    expect(await store.read('test-provider')).toMatchObject({ access: 'access-2' })

    await store.removeAccount('second')
    expect(await store.getActiveAccountId()).toBeUndefined()
    expect(await store.read('test-provider')).toBeUndefined()
    await expect(readFile(path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a ninth distinct account', async () => {
    const { store } = await createStore()
    for (let index = 1; index <= 8; index += 1) {
      await store.upsertAccount({
        id: `acct-${String(index)}`,
        credential: oauthCredential({
          access: `access-${String(index)}`,
          refresh: `refresh-${String(index)}`,
        }),
        makeActive: index === 1,
      })
    }
    await expect(
      store.upsertAccount({
        id: 'acct-9',
        credential: oauthCredential({ access: 'access-9', refresh: 'refresh-9' }),
      }),
    ).rejects.toThrow(/at most 8 accounts/u)

    await store.upsertAccount({
      id: 'acct-1',
      credential: oauthCredential({ access: 'access-1-updated', refresh: 'refresh-1-updated' }),
    })
    expect(await store.listAccounts()).toHaveLength(8)
    expect(await store.read('test-provider')).toMatchObject({ access: 'access-1-updated' })
  })

  it('persistLoginCredential add mode upserts without leaking through listAccounts', async () => {
    const { store } = await createStore()
    await store.persistLoginCredential(
      oauthCredential({ access: 'access-1', refresh: 'refresh-1', accountId: 'user-one' }),
      { mode: 'add' },
    )
    await store.persistLoginCredential(
      oauthCredential({ access: 'access-2', refresh: 'refresh-2', accountId: 'user-two' }),
      { mode: 'add' },
    )
    expect(await store.getActiveAccountId()).toBe('user-two')
    expect(await store.listAccounts()).toEqual([
      expect.objectContaining({ id: 'user-one', accountId: 'user-one' }),
      expect.objectContaining({ id: 'user-two', accountId: 'user-two' }),
    ])
    expect(JSON.stringify(await store.listAccounts())).not.toMatch(/access-|refresh-/u)
  })

  it('CredentialStore.modify and invalidate touch only the active account', async () => {
    const { store } = await createStore()
    const inactiveExpires = Date.now() + 9_000_000
    await store.upsertAccount({
      id: 'active',
      credential: oauthCredential({
        access: 'access-active',
        refresh: 'refresh-active',
        expires: Date.now() + 5_000_000,
      }),
      makeActive: true,
    })
    await store.upsertAccount({
      id: 'inactive',
      credential: oauthCredential({
        access: 'access-inactive',
        refresh: 'refresh-inactive',
        expires: inactiveExpires,
      }),
    })

    await store.modify('test-provider', async (current) => {
      expect(current).toMatchObject({ access: 'access-active' })
      if (current?.type !== 'oauth') return undefined
      return { ...current, access: 'access-active-refreshed' }
    })
    expect(await store.read('test-provider')).toMatchObject({ access: 'access-active-refreshed' })

    const beforeInvalidate = Date.now()
    expect(await store.invalidate('test-provider')).toBe(true)
    const active = await store.read('test-provider')
    expect(active?.type).toBe('oauth')
    if (active?.type === 'oauth') {
      expect(active.expires).toBeLessThan(beforeInvalidate)
      expect(active.access).toBe('access-active-refreshed')
      expect(active.refresh).toBe('refresh-active')
    }

    await store.setActiveAccount('inactive')
    expect(await store.read('test-provider')).toMatchObject({
      access: 'access-inactive',
      refresh: 'refresh-inactive',
      expires: inactiveExpires,
    })
  })

  it('overwrite-active without confirmOverwrite rejects', async () => {
    const { store } = await createStore()
    await store.persistLoginCredential(oauthCredential({ access: 'access-keep', refresh: 'refresh-keep' }), {
      mode: 'add',
    })
    await expect(
      store.persistLoginCredential(oauthCredential({ access: 'access-new', refresh: 'refresh-new' }), {
        mode: 'overwrite-active',
      }),
    ).rejects.toThrow(/confirmOverwrite/u)
    expect(await store.read('test-provider')).toMatchObject({ access: 'access-keep', refresh: 'refresh-keep' })
  })

  it('delete(provider) removes a multi-account document', async () => {
    const { store, path } = await createStore()
    await store.upsertAccount({
      id: 'acct-a',
      credential: oauthCredential({ access: 'access-a', refresh: 'refresh-a' }),
      makeActive: true,
    })
    await store.upsertAccount({
      id: 'acct-b',
      credential: oauthCredential({ access: 'access-b', refresh: 'refresh-b' }),
    })
    expect(await store.listAccounts()).toHaveLength(2)

    await store.delete('test-provider')
    expect(await store.listAccounts()).toEqual([])
    await expect(readFile(path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a document that is not a JSON object', async () => {
    const { store, path } = await createStore()
    for (const body of ['[]', 'null', '"token"', '7']) {
      await writeDocument(path, body)
      await expect(store.read('test-provider')).rejects.toThrow(/must contain an object/u)
    }
  })

  it('rejects a v1 credential that is not an oauth object', async () => {
    const { store, path } = await createStore()
    await writeDocument(path, `${JSON.stringify({ version: 1, credential: 'nope' })}\n`)
    await expect(store.read('test-provider')).rejects.toThrow(/credential must be an object/u)

    await writeDocument(
      path,
      `${JSON.stringify({
        version: 1,
        credential: { type: 'api_key', access: 'a', refresh: 'r', expires: 1 },
      })}\n`,
    )
    await expect(store.read('test-provider')).rejects.toThrow(/credential type must be oauth/u)
  })

  it('rejects a credential with blank tokens, a blank accountId or a bad expiry', async () => {
    const { store, path } = await createStore()
    await writeDocument(
      path,
      `${JSON.stringify({ version: 1, credential: { type: 'oauth', access: 'a', refresh: '', expires: 1 } })}\n`,
    )
    await expect(store.read('test-provider')).rejects.toThrow(/credential refresh must be a non-empty string/u)

    await writeDocument(
      path,
      `${JSON.stringify({
        version: 1,
        credential: { type: 'oauth', access: 'a', refresh: 'r', expires: 1, accountId: '' },
      })}\n`,
    )
    await expect(store.read('test-provider')).rejects.toThrow(/accountId must be a non-empty string when present/u)

    await writeDocument(
      path,
      `${JSON.stringify({ version: 1, credential: { type: 'oauth', access: 'a', refresh: 'r', expires: 0 } })}\n`,
    )
    await expect(store.read('test-provider')).rejects.toThrow(/expires must be a positive finite number/u)
  })

  it('rejects an unknown top-level field in a v1 or v2 document', async () => {
    const { store, path } = await createStore()
    await writeDocument(
      path,
      `${JSON.stringify({
        version: 1,
        credential: { type: 'oauth', access: 'a', refresh: 'r', expires: 1 },
        extra: true,
      })}\n`,
    )
    await expect(store.read('test-provider')).rejects.toThrow(/unknown top-level field/u)

    await writeDocument(path, `${JSON.stringify({ ...JSON.parse(v2Document([accountRecord()])), extra: true })}\n`)
    await expect(store.read('test-provider')).rejects.toThrow(/unknown top-level field/u)
  })

  it('rejects a v2 account list that is not a bounded array of accounts', async () => {
    const { store, path } = await createStore()
    await writeDocument(path, v2Document('nope'))
    await expect(store.read('test-provider')).rejects.toThrow(/accounts must be an array/u)

    await writeDocument(path, v2Document([]))
    await expect(store.read('test-provider')).rejects.toThrow(/accounts must contain between 1 and 8 entries/u)

    const nine = Array.from({ length: 9 }, (_, index) => accountRecord({ id: `acct-${String(index)}` }))
    await writeDocument(path, v2Document(nine))
    await expect(store.read('test-provider')).rejects.toThrow(/accounts must contain between 1 and 8 entries/u)
  })

  it('rejects a v2 document whose active account is invalid, duplicated or absent', async () => {
    const { store, path } = await createStore()
    await writeDocument(path, v2Document([accountRecord()], ''))
    await expect(store.read('test-provider')).rejects.toThrow(/activeAccountId is not a valid account id/u)

    await writeDocument(path, v2Document([accountRecord(), accountRecord()], 'acct-a'))
    await expect(store.read('test-provider')).rejects.toThrow(/accounts contains a duplicate id/u)

    await writeDocument(path, v2Document([accountRecord()], 'acct-other'))
    await expect(store.read('test-provider')).rejects.toThrow(/activeAccountId does not match any account/u)
  })

  it('rejects a v2 account record with a non-object, unknown field or bad id', async () => {
    const { store, path } = await createStore()
    await writeDocument(path, v2Document([null]))
    await expect(store.read('test-provider')).rejects.toThrow(/accounts\[0\] must be an object/u)

    await writeDocument(path, v2Document([accountRecord({ extra: true })]))
    await expect(store.read('test-provider')).rejects.toThrow(/accounts\[0\] contains an unknown field/u)

    await writeDocument(path, v2Document([accountRecord({ id: 'has spaces' })]))
    await expect(store.read('test-provider')).rejects.toThrow(/accounts\[0\]\.id is not a valid account id/u)
  })

  it('rejects a v2 account record with a blank label or a bad creation time', async () => {
    const { store, path } = await createStore()
    await writeDocument(path, v2Document([accountRecord({ label: '' })]))
    await expect(store.read('test-provider')).rejects.toThrow(/label must be a non-empty string when present/u)

    await writeDocument(path, v2Document([accountRecord({ createdAt: 0 })]))
    await expect(store.read('test-provider')).rejects.toThrow(/createdAt must be a positive finite number/u)
  })

  it('upserts an existing labelled account during login without dropping the label', async () => {
    const { store } = await createStore()
    await store.upsertAccount({
      id: 'acct-a',
      label: 'Alpha',
      credential: oauthCredential({ access: 'access-a', refresh: 'refresh-a' }),
    })
    await store.persistLoginCredential(
      oauthCredential({ access: 'access-a2', refresh: 'refresh-a2', accountId: 'acct-a' }),
      { mode: 'add' },
    )
    expect(await store.listAccounts()).toEqual([
      { id: 'acct-a', label: 'Alpha', expires: expect.any(Number) as number, accountId: 'acct-a' },
    ])
    expect(await store.read('test-provider')).toMatchObject({ access: 'access-a2', refresh: 'refresh-a2' })
  })

  it('upserts an existing unlabelled account during login without inventing a label', async () => {
    const { store } = await createStore()
    await store.persistLoginCredential(
      oauthCredential({ access: 'access-a', refresh: 'refresh-a', accountId: 'acct-a' }),
      { mode: 'add' },
    )
    await store.persistLoginCredential(
      oauthCredential({ access: 'access-a2', refresh: 'refresh-a2', accountId: 'acct-a' }),
      { mode: 'add' },
    )
    expect(await store.listAccounts()).toEqual([{ id: 'acct-a', expires: expect.any(Number) as number, accountId: 'acct-a' }])
    expect(await store.read('test-provider')).toMatchObject({ access: 'access-a2' })
  })

  it('refuses a ninth distinct account during login', async () => {
    const { store } = await createStore()
    for (let index = 1; index <= 8; index += 1) {
      await store.persistLoginCredential(
        oauthCredential({
          access: `access-${String(index)}`,
          refresh: `refresh-${String(index)}`,
          accountId: `acct-${String(index)}`,
        }),
        { mode: 'add' },
      )
    }
    await expect(
      store.persistLoginCredential(
        oauthCredential({ access: 'access-9', refresh: 'refresh-9', accountId: 'acct-9' }),
        { mode: 'add' },
      ),
    ).rejects.toThrow(/at most 8 accounts may be stored/u)
    expect(await store.listAccounts()).toHaveLength(8)
  })

  it('overwrite-active on an empty document stores exactly that account', async () => {
    const { store } = await createStore()
    await store.persistLoginCredential(
      oauthCredential({ access: 'access-a', refresh: 'refresh-a', accountId: 'acct-a' }),
      { mode: 'overwrite-active', confirmOverwrite: true },
    )
    expect(await store.getActiveAccountId()).toBe('acct-a')
    expect(await store.read('test-provider')).toMatchObject({ access: 'access-a' })
  })

  it('overwrite-active with confirmation replaces the active token in place', async () => {
    const { store } = await createStore()
    await store.upsertAccount({
      id: 'acct-a',
      label: 'Alpha',
      credential: oauthCredential({ access: 'access-old', refresh: 'refresh-old' }),
      makeActive: true,
    })
    await store.upsertAccount({
      id: 'acct-b',
      credential: oauthCredential({ access: 'access-b', refresh: 'refresh-b' }),
    })
    await store.persistLoginCredential(oauthCredential({ access: 'access-new', refresh: 'refresh-new' }), {
      mode: 'overwrite-active',
      confirmOverwrite: true,
    })
    expect(await store.getActiveAccountId()).toBe('acct-a')
    expect(await store.listAccounts()).toEqual([
      { id: 'acct-a', label: 'Alpha', expires: expect.any(Number) as number },
      { id: 'acct-b', expires: expect.any(Number) as number },
    ])
    expect(await store.read('test-provider')).toMatchObject({ access: 'access-new', refresh: 'refresh-new' })
  })

  it('routes pi-ai login writes through multi-account upsert inside runLoginPersist', async () => {
    const { store } = await createStore()
    await store.runLoginPersist({ mode: 'add' }, async () => {
      await store.modify('test-provider', async () =>
        oauthCredential({ access: 'access-a', refresh: 'refresh-a', accountId: 'acct-a' }),
      )
      await store.modify('test-provider', async () =>
        oauthCredential({ access: 'access-b', refresh: 'refresh-b', accountId: 'acct-b' }),
      )
    })
    expect(await store.listAccounts()).toEqual([
      { id: 'acct-a', expires: expect.any(Number) as number, accountId: 'acct-a' },
      { id: 'acct-b', expires: expect.any(Number) as number, accountId: 'acct-b' },
    ])
    expect(await store.getActiveAccountId()).toBe('acct-b')

    // Outside the window the same call edits only the active account.
    await store.modify('test-provider', async current =>
      current?.type === 'oauth' ? { ...current, access: 'access-b2' } : undefined,
    )
    expect(await store.listAccounts()).toHaveLength(2)
    expect(await store.read('test-provider')).toMatchObject({ access: 'access-b2' })
  })

  it('refuses a login persist nested inside another one', async () => {
    const { store } = await createStore()
    await expect(
      store.runLoginPersist({ mode: 'add' }, async () =>
        store.runLoginPersist({ mode: 'add' }, async () => undefined),
      ),
    ).rejects.toThrow(/login persist already in progress/u)
    // The failed nesting still releases the window for the next login.
    await expect(store.runLoginPersist({ mode: 'add' }, async () => 'ok')).resolves.toBe('ok')
  })

  it('refuses to store a credential that is not an oauth one', async () => {
    const { store } = await createStore()
    await expect(store.modify('test-provider', async () => ({ type: 'api_key', key: 'k' }))).rejects.toThrow(
      /credential type must be oauth/u,
    )
    expect(await store.listAccounts()).toEqual([])
  })

  it('ignores a delete aimed at a provider it does not own', async () => {
    const { store, path } = await createStore()
    await store.upsertAccount({
      id: 'acct-a',
      credential: oauthCredential({ access: 'access-a', refresh: 'refresh-a' }),
      makeActive: true,
    })
    await store.delete('openai-codex')
    expect(await readFile(path, 'utf8')).toContain('access-a')
  })

  it('reads one account by id without moving the active account', async () => {
    const { store } = await createStore()
    await store.upsertAccount({
      id: 'acct-a',
      credential: oauthCredential({ access: 'access-a', refresh: 'refresh-a' }),
      makeActive: true,
    })
    await store.upsertAccount({
      id: 'acct-b',
      credential: oauthCredential({ access: 'access-b', refresh: 'refresh-b' }),
    })
    await expect(store.readAccount('acct-b')).resolves.toMatchObject({ access: 'access-b' })
    expect(await store.getActiveAccountId()).toBe('acct-a')
    await expect(store.readAccount('acct-missing')).resolves.toBeUndefined()
    await expect(store.readAccount('bad id')).resolves.toBeUndefined()
  })

  it('reports accounts of an absent document as empty', async () => {
    const { store } = await createStore()
    await expect(store.readAccount('acct-a')).resolves.toBeUndefined()
    await expect(store.listAccounts()).resolves.toEqual([])
    await expect(store.getActiveAccountId()).resolves.toBeUndefined()
  })

  it('modifyAccount updates one account in place and keeps the active one', async () => {
    const { store } = await createStore()
    await store.upsertAccount({
      id: 'acct-a',
      credential: oauthCredential({ access: 'access-a', refresh: 'refresh-a' }),
      makeActive: true,
    })
    await store.upsertAccount({
      id: 'acct-b',
      credential: oauthCredential({ access: 'access-b', refresh: 'refresh-b' }),
    })
    await expect(
      store.modifyAccount('acct-b', async current =>
        current?.type === 'oauth' ? { ...current, access: 'access-b2' } : undefined,
      ),
    ).resolves.toMatchObject({ access: 'access-b2' })
    expect(await store.getActiveAccountId()).toBe('acct-a')
    await expect(store.readAccount('acct-a')).resolves.toMatchObject({ access: 'access-a' })
    await expect(store.readAccount('acct-b')).resolves.toMatchObject({ access: 'access-b2' })
  })

  it('modifyAccount reports an unknown account, an absent document and a declined update as absent', async () => {
    const { store } = await createStore()
    await store.upsertAccount({
      id: 'acct-a',
      credential: oauthCredential({ access: 'access-a', refresh: 'refresh-a' }),
      makeActive: true,
    })
    await expect(store.modifyAccount('acct-missing', async () => undefined)).resolves.toBeUndefined()
    await expect(store.modifyAccount('acct-a', async () => undefined)).resolves.toMatchObject({ access: 'access-a' })

    const empty = await createStore()
    await expect(empty.store.modifyAccount('acct-a', async () => undefined)).resolves.toBeUndefined()
  })

  it('modifyAccount rejects an invalid id and a non-oauth replacement', async () => {
    const { store } = await createStore()
    await store.upsertAccount({
      id: 'acct-a',
      credential: oauthCredential({ access: 'access-a', refresh: 'refresh-a' }),
      makeActive: true,
    })
    await expect(store.modifyAccount('bad id', async () => undefined)).rejects.toThrow(/account id is invalid/u)
    await expect(store.modifyAccount('acct-a', async () => ({ type: 'api_key', key: 'k' }))).rejects.toThrow(
      /credential type must be oauth/u,
    )
    await expect(store.readAccount('acct-a')).resolves.toMatchObject({ access: 'access-a' })
  })

  it('rejects an invalid id, an absent document and an unknown target on setActiveAccount', async () => {
    const { store } = await createStore()
    await expect(store.setActiveAccount('bad id')).rejects.toThrow(/account id is invalid/u)

    const empty = await createStore()
    await expect(empty.store.setActiveAccount('acct-a')).rejects.toThrow(/no credential accounts are stored/u)

    await store.upsertAccount({
      id: 'acct-a',
      credential: oauthCredential({ access: 'access-a', refresh: 'refresh-a' }),
      makeActive: true,
    })
    await expect(store.setActiveAccount('acct-zzz')).rejects.toThrow(/is not stored/u)
    expect(await store.getActiveAccountId()).toBe('acct-a')
  })

  it('rejects an invalid id and a blank label on upsertAccount', async () => {
    const { store } = await createStore()
    const credential = oauthCredential({ access: 'access-a', refresh: 'refresh-a' })
    await expect(store.upsertAccount({ id: 'bad id', credential })).rejects.toThrow(/account id is invalid/u)
    await expect(store.upsertAccount({ id: 'acct-a', label: '', credential })).rejects.toThrow(
      /label must be a non-empty string when present/u,
    )
    await expect(store.listAccounts()).resolves.toEqual([])
  })

  it('keeps the stored label and active account unless an upsert overrides them', async () => {
    const { store } = await createStore()
    await store.upsertAccount({
      id: 'acct-a',
      label: 'Alpha',
      credential: oauthCredential({ access: 'access-a', refresh: 'refresh-a' }),
      makeActive: true,
    })
    await store.upsertAccount({
      id: 'acct-b',
      label: 'Beta',
      credential: oauthCredential({ access: 'access-b', refresh: 'refresh-b' }),
    })
    expect(await store.getActiveAccountId()).toBe('acct-a')

    // Re-upserting without a label keeps Beta and leaves the active account alone.
    await store.upsertAccount({
      id: 'acct-b',
      credential: oauthCredential({ access: 'access-b2', refresh: 'refresh-b2' }),
    })
    expect(await store.listAccounts()).toEqual([
      { id: 'acct-a', label: 'Alpha', expires: expect.any(Number) as number },
      { id: 'acct-b', label: 'Beta', expires: expect.any(Number) as number },
    ])
    expect(await store.getActiveAccountId()).toBe('acct-a')

    await store.upsertAccount({
      id: 'acct-b',
      label: 'Beta 2',
      credential: oauthCredential({ access: 'access-b3', refresh: 'refresh-b3' }),
      makeActive: true,
    })
    expect(await store.listAccounts()).toEqual([
      { id: 'acct-a', label: 'Alpha', expires: expect.any(Number) as number },
      { id: 'acct-b', label: 'Beta 2', expires: expect.any(Number) as number },
    ])
    expect(await store.getActiveAccountId()).toBe('acct-b')
  })

  it('removeAccount ignores an invalid id, an absent document and an unknown account', async () => {
    const { store } = await createStore()
    await expect(store.removeAccount('bad id')).rejects.toThrow(/account id is invalid/u)

    const empty = await createStore()
    await expect(empty.store.removeAccount('acct-a')).resolves.toBeUndefined()

    await store.upsertAccount({
      id: 'acct-a',
      credential: oauthCredential({ access: 'access-a', refresh: 'refresh-a' }),
      makeActive: true,
    })
    await expect(store.removeAccount('acct-zzz')).resolves.toBeUndefined()
    expect(await store.listAccounts()).toHaveLength(1)
  })

  it('refuses to replace a destination that became oversized while the update ran', async () => {
    const { store, path } = await createStore()
    await store.upsertAccount({
      id: 'acct-a',
      credential: oauthCredential({ access: 'access-a', refresh: 'refresh-a' }),
      makeActive: true,
    })
    await expect(
      store.modify('test-provider', async (current) => {
        await writeFile(path, 'x'.repeat(CREDENTIAL_FILE_MAX_BYTES + 1), { mode: 0o600 })
        return current?.type === 'oauth' ? { ...current, access: 'access-next' } : undefined
      }),
    ).rejects.toThrow(/owner-only no-follow validation/u)
    expect((await readFile(path)).byteLength).toBe(CREDENTIAL_FILE_MAX_BYTES + 1)
  })

  it('keeps the active account when a different one is removed', async () => {
    const { store } = await createStore()
    await store.upsertAccount({
      id: 'acct-a',
      credential: oauthCredential({ access: 'access-a', refresh: 'refresh-a' }),
      makeActive: true,
    })
    await store.upsertAccount({
      id: 'acct-b',
      credential: oauthCredential({ access: 'access-b', refresh: 'refresh-b' }),
    })
    await store.removeAccount('acct-b')
    expect(await store.getActiveAccountId()).toBe('acct-a')
    expect(await store.read('test-provider')).toMatchObject({ access: 'access-a' })
  })
})
