import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { grokAuthPath, importGrokAuth, parseGrokAuthDocument, probeGrokAuth } from '../src/grok-import.ts'
import { XAI_PI_PROVIDER } from '../src/ids.ts'
import { GrokBuildCredentialStore } from '../src/store.ts'

const grokShape = {
  'https://auth.x.ai::b1a00492-073a-47ea-816f-4c329264a828': {
    key: 'access-from-grok',
    refresh_token: 'refresh-from-grok',
    expires_at: '2026-08-14T12:00:00.000000Z',
    oidc_issuer: 'https://auth.x.ai',
    user_id: 'user-1',
    email: 'hidden@example.com',
  },
}

function oauthDocument(fields: Record<string, unknown>): string {
  return JSON.stringify({ access_token: 'access', refresh_token: 'refresh', ...fields })
}

describe('parseGrokAuthDocument', () => {
  it('reads the Grok CLI issuer::client_id document', () => {
    const credential = parseGrokAuthDocument(JSON.stringify(grokShape), 'auth.json')
    expect(credential).toMatchObject({
      type: 'oauth',
      access: 'access-from-grok',
      refresh: 'refresh-from-grok',
      accountId: 'user-1',
    })
    expect(credential.expires).toBe(Date.parse('2026-08-14T12:00:00.000000Z'))
  })

  it('accepts a flat access_token document', () => {
    const credential = parseGrokAuthDocument(
      JSON.stringify({
        access_token: 'a',
        refresh_token: 'r',
        expires_in: 3600,
      }),
      'auth.json',
    )
    expect(credential.access).toBe('a')
    expect(credential.refresh).toBe('r')
    expect(credential.expires).toBeGreaterThan(Date.now())
  })

  it('rejects a document without a refresh token', () => {
    expect(() => parseGrokAuthDocument(JSON.stringify({ key: 'only-access' }), 'auth.json')).toThrow(/refresh token/)
  })

  it('rejects text that is not JSON', () => {
    expect(() => parseGrokAuthDocument('{ not json', 'auth.json')).toThrow(
      'grok-build: auth.json is not valid JSON',
    )
  })

  it('walks nested arrays and prefers the candidate that names the x.ai issuer', () => {
    const credential = parseGrokAuthDocument(
      JSON.stringify({
        accounts: [
          { access_token: 'generic-access', refresh_token: 'generic-refresh' },
          { access_token: 'xai-access', refresh_token: 'xai-refresh', issuer: 'https://auth.x.ai' },
        ],
      }),
      'auth.json',
    )
    expect(credential).toMatchObject({ type: 'oauth', access: 'xai-access', refresh: 'xai-refresh' })
  })

  it('reads second- and millisecond-shaped numeric expiry fields', () => {
    const seconds = 1_800_000_000
    expect(parseGrokAuthDocument(oauthDocument({ expires_at: seconds }), 'auth.json').expires).toBe(seconds * 1000)
    expect(parseGrokAuthDocument(oauthDocument({ expires_at: seconds * 1000 }), 'auth.json').expires).toBe(
      seconds * 1000,
    )
    expect(parseGrokAuthDocument(oauthDocument({ expires: seconds }), 'auth.json').expires).toBe(seconds * 1000)
    expect(parseGrokAuthDocument(oauthDocument({ expires: seconds * 1000 }), 'auth.json').expires).toBe(
      seconds * 1000,
    )
  })

  it('falls through a non-finite or non-positive expiry to the next field', () => {
    const seconds = 1_800_000_000
    // 1e999 parses to Infinity: a number, but not a usable instant.
    const infinite = parseGrokAuthDocument(
      `{"access_token":"access","refresh_token":"refresh","expires_at":1e999,"expires":${String(seconds)}}`,
      'auth.json',
    )
    expect(infinite.expires).toBe(seconds * 1000)

    const nonPositive = parseGrokAuthDocument(
      oauthDocument({ expires_at: 0, expires: -1, expires_in: 3600 }),
      'auth.json',
    )
    expect(nonPositive.expires).toBeGreaterThan(Date.now())
  })

  it('falls through an unparseable timestamp to the next expiry field', () => {
    const before = Date.now()
    const credential = parseGrokAuthDocument(
      oauthDocument({ expires_at: 'not-a-date', expires_in: 60 }),
      'auth.json',
    )
    expect(credential.expires).toBeGreaterThanOrEqual(before + 60_000)
    expect(credential.expires).toBeLessThanOrEqual(Date.now() + 60_000)
  })

  it('treats a pre-epoch timestamp as no expiry at all', () => {
    const before = Date.now()
    const credential = parseGrokAuthDocument(
      oauthDocument({ expires_at: '1969-12-31T23:59:59.500Z' }),
      'auth.json',
    )
    expect(credential.expires).toBeGreaterThanOrEqual(before + 60 * 60 * 1000)
    expect(credential.expires).toBeLessThanOrEqual(Date.now() + 60 * 60 * 1000)
  })

  it('tolerates sub-millisecond precision on engines that reject extra fractional digits', () => {
    // V8 truncates every fractional digit, but the retry exists because other
    // engines refuse more than three: pin the truncated second attempt by
    // standing in for such an engine.
    const realParse = Date.parse
    const expected = realParse('2026-08-14T12:00:00.123Z')
    const parse = vi.spyOn(Date, 'parse').mockImplementation((value: string) =>
      /\.\d{4,}/u.test(value) ? Number.NaN : realParse(value),
    )
    try {
      const credential = parseGrokAuthDocument(
        oauthDocument({ expires_at: '2026-08-14T12:00:00.123456Z' }),
        'auth.json',
      )
      expect(credential.expires).toBe(expected)
    } finally {
      parse.mockRestore()
    }
  })

  it('defaults a credential that declares no expiry to one hour', () => {
    const before = Date.now()
    const credential = parseGrokAuthDocument(oauthDocument({}), 'auth.json')
    expect(credential.expires).toBeGreaterThanOrEqual(before + 60 * 60 * 1000)
    expect(credential.expires).toBeLessThanOrEqual(Date.now() + 60 * 60 * 1000)
  })
})

describe('importGrokAuth', () => {
  it('copies tokens into the avn store and leaves the Grok file unchanged', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'avn-grok-build-grok-'))
    const grokFile = join(dir, 'auth.json')
    const avnFile = join(dir, 'avn.json')
    const original = `${JSON.stringify(grokShape, null, 2)}\n`
    await writeFile(grokFile, original)
    const store = new GrokBuildCredentialStore(avnFile)
    await importGrokAuth(store, grokFile)
    expect(await readFile(grokFile, 'utf8')).toBe(original)
    const stored = await store.read(XAI_PI_PROVIDER)
    expect(stored).toMatchObject({ type: 'oauth', access: 'access-from-grok', refresh: 'refresh-from-grok' })
  })

  it('probes availability without returning secrets', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'avn-grok-build-probe-'))
    const missing = await probeGrokAuth(join(dir, 'missing.json'))
    expect(missing.available).toBe(false)
    const grokFile = join(dir, 'auth.json')
    await writeFile(grokFile, JSON.stringify(grokShape))
    const present = await probeGrokAuth(grokFile)
    expect(present.available).toBe(true)
    expect(JSON.stringify(present)).not.toContain('access-from-grok')
    expect(JSON.stringify(present)).not.toContain('refresh-from-grok')
  })

  it('reports an unreadable auth path as unavailable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'avn-grok-build-probe-broken-'))
    const broken = join(dir, 'auth.json')
    await writeFile(broken, 'not json')
    expect(await probeGrokAuth(broken)).toEqual({ available: false, path: broken })
    expect(await probeGrokAuth(dir)).toEqual({ available: false, path: dir })
  })

  it('reports a missing Grok CLI auth file by path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'avn-grok-build-absent-'))
    const missing = join(dir, 'absent.json')
    const store = new GrokBuildCredentialStore(join(dir, 'avn.json'))
    await expect(importGrokAuth(store, missing)).rejects.toThrow(
      `grok-build: Grok CLI auth file not found at ${missing}`,
    )
  })

  it('propagates a read failure that is not a missing file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'avn-grok-build-unreadable-'))
    const store = new GrokBuildCredentialStore(join(dir, 'avn.json'))
    const failure = await importGrokAuth(store, dir).then(
      () => undefined,
      (error: unknown) => error as NodeJS.ErrnoException,
    )
    expect(failure?.message).not.toContain('not found')
    expect(failure?.code).toBe('EISDIR')
  })

  it('refuses to report success when the store keeps no oauth credential', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'avn-grok-build-persist-'))
    const grokFile = join(dir, 'auth.json')
    await writeFile(grokFile, JSON.stringify(grokShape))
    const dropped = { modify: async () => undefined } as unknown as GrokBuildCredentialStore
    await expect(importGrokAuth(dropped, grokFile)).rejects.toThrow(
      'grok-build: failed to persist the imported Grok credential',
    )
    const wrongType = { modify: async () => ({ type: 'api_key', key: 'k' }) } as unknown as GrokBuildCredentialStore
    await expect(importGrokAuth(wrongType, grokFile)).rejects.toThrow(
      'grok-build: failed to persist the imported Grok credential',
    )
  })
})

describe('grokAuthPath', () => {
  it('resolves under the given home', () => {
    expect(grokAuthPath('/tmp/home').replaceAll('\\', '/')).toMatch(/\/tmp\/home\/.grok\/auth\.json$/)
  })
})
