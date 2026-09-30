import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import type { Server } from 'node:http'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { OAuthCredential } from '@earendil-works/pi-ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildAuthorizeUrl,
  discoverOAuthEndpoints,
  extractCode,
  GROK_BUILD_OAUTH_CLIENT_ID,
  GROK_BUILD_OAUTH_DEFAULT_PORT,
  GROK_BUILD_OAUTH_ISSUER,
  GROK_BUILD_OAUTH_SCOPE,
  GrokBuildOAuthError,
  generatePkce,
  loginGrokBuildPkce,
  type PkceLoginCallbacks,
  refreshGrokBuildToken,
  resolveOAuthParams,
} from '../src/oauth.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

interface MockIdP {
  issuer: string
  lastAuthorizeQuery: () => URLSearchParams | undefined
  lastTokenForm: () => URLSearchParams | undefined
  close(): Promise<void>
}

/** Loopback OIDC issuer double: discovery + authorize (302) + token exchange. */
async function startMockIdP(
  options: { omitRefreshOnRefreshGrant?: boolean; tokenResponsePaddingBytes?: number } = {},
): Promise<MockIdP> {
  const challenges = new Map<string, string>()
  let lastAuthorizeQuery: URLSearchParams | undefined
  let lastTokenForm: URLSearchParams | undefined
  let issuer = ''
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.pathname === '/.well-known/openid-configuration') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          issuer,
          authorization_endpoint: `${issuer}/oauth2/authorize`,
          token_endpoint: `${issuer}/oauth2/token`,
        }),
      )
      return
    }
    if (url.pathname === '/oauth2/authorize') {
      lastAuthorizeQuery = url.searchParams
      const redirectUri = url.searchParams.get('redirect_uri') ?? ''
      const state = url.searchParams.get('state') ?? ''
      const challenge = url.searchParams.get('code_challenge') ?? ''
      const code = `mock-code-${challenges.size}`
      challenges.set(code, challenge)
      res.writeHead(302, { location: `${redirectUri}?code=${code}&state=${state}` }).end()
      return
    }
    if (url.pathname === '/oauth2/token' && req.method === 'POST') {
      let body = ''
      req.on('data', (chunk) => {
        body += String(chunk)
      })
      req.on('end', () => {
        lastTokenForm = new URLSearchParams(body)
        const grant = lastTokenForm.get('grant_type')
        if (grant === 'authorization_code') {
          const code = lastTokenForm.get('code') ?? ''
          const verifier = lastTokenForm.get('code_verifier') ?? ''
          const expected = challenges.get(code)
          const actual = createHash('sha256').update(verifier).digest('base64url')
          if (expected === undefined || actual !== expected) {
            res
              .writeHead(400, { 'content-type': 'application/json' })
              .end(JSON.stringify({ error: 'invalid_grant', error_description: 'PKCE verification failed' }))
            return
          }
          res.writeHead(200, { 'content-type': 'application/json' }).end(
            JSON.stringify({
              access_token: 'mock-access',
              refresh_token: 'mock-refresh',
              expires_in: 3600,
            }),
          )
          return
        }
        if (grant === 'refresh_token') {
          const payload: Record<string, unknown> = { access_token: 'mock-access-2', expires_in: 3600 }
          if (!options.omitRefreshOnRefreshGrant) payload['refresh_token'] = 'mock-refresh-2'
          if (options.tokenResponsePaddingBytes !== undefined) {
            payload['padding'] = 'x'.repeat(options.tokenResponsePaddingBytes)
          }
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(payload))
          return
        }
        res
          .writeHead(400, { 'content-type': 'application/json' })
          .end(JSON.stringify({ error: 'unsupported_grant_type' }))
      })
      return
    }
    res.writeHead(404).end()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return {
    issuer,
    lastAuthorizeQuery: () => lastAuthorizeQuery,
    lastTokenForm: () => lastTokenForm,
    close: () => new Promise(resolve => server.close(() =>{  resolve() })),
  }
}

function urlSignal(): { promise: Promise<string>; deliver(url: string): void } {
  let deliver: (url: string) => void = () => {}
  const promise = new Promise<string>((resolve) => {
    deliver = resolve
  })
  return { promise, deliver }
}

describe('generatePkce', () => {
  it('produces an S256 verifier/challenge pair', () => {
    const { verifier, challenge } = generatePkce()
    expect(verifier.length).toBeGreaterThanOrEqual(43)
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(challenge)
  })
})

describe('extractCode', () => {
  it('passes a bare code through and parses a full redirect URL', () => {
    expect(extractCode('  abc123  ')).toBe('abc123')
    expect(extractCode('http://127.0.0.1:56121/callback?code=xyz789&state=s')).toBe('xyz789')
    expect(extractCode('not-a-url-no-query')).toBe('not-a-url-no-query')
  })
})

describe('loginGrokBuildPkce', () => {
  it('completes a PKCE login via the loopback channel', async () => {
    const idp = await startMockIdP()
    try {
      const url = urlSignal()
      const login = loginGrokBuildPkce(
        { onAuthorizeUrl: (value) =>{  url.deliver(value) } },
        { issuer: idp.issuer, clientId: 'test-client', port: 0, allowInsecureLoopbackIssuer: true },
      )
      const authorizeUrl = await url.promise
      // Simulate the browser: authorize → 302 → loopback callback.
      const authResponse = await fetch(authorizeUrl, { redirect: 'manual' })
      expect(authResponse.status).toBe(302)
      const location = authResponse.headers.get('location')!
      const callbackResponse = await fetch(location)
      expect(callbackResponse.status).toBe(200)
      const credential = await login
      expect(credential).toMatchObject({ type: 'oauth', access: 'mock-access', refresh: 'mock-refresh' })
      expect(credential.expires).toBeGreaterThan(Date.now())
      const query = idp.lastAuthorizeQuery()!
      expect(query.get('client_id')).toBe('test-client')
      expect(query.get('response_type')).toBe('code')
      expect(query.get('code_challenge_method')).toBe('S256')
      expect(query.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)
      expect(query.get('scope')).toContain('grok-cli:access')
      // The mock only answers when code_verifier matches the challenge.
      expect(idp.lastTokenForm()?.get('grant_type')).toBe('authorization_code')
    } finally {
      await idp.close()
    }
  })

  it('lets the xAI consent page read the delivery answer, and ignores its preflight', async () => {
    const idp = await startMockIdP()
    try {
      const url = urlSignal()
      const login = loginGrokBuildPkce(
        { onAuthorizeUrl: (value) =>{  url.deliver(value) } },
        { issuer: idp.issuer, clientId: 'test-client', port: 0, allowInsecureLoopbackIssuer: true },
      )
      const authResponse = await fetch(await url.promise, { redirect: 'manual' })
      const location = authResponse.headers.get('location')!
      const consent = { origin: 'https://accounts.x.ai' }
      const preflight = await fetch(location, {
        method: 'OPTIONS',
        headers: { ...consent, 'access-control-request-method': 'GET', 'access-control-request-private-network': 'true' },
      })
      expect(preflight.status).toBe(204)
      expect(preflight.headers.get('access-control-allow-private-network')).toBe('true')
      const delivery = await fetch(location, { headers: consent })
      expect(delivery.status).toBe(200)
      expect(delivery.headers.get('access-control-allow-origin')).toBe('https://accounts.x.ai')
      await expect(login).resolves.toMatchObject({ access: 'mock-access' })
    } finally {
      await idp.close()
    }
  })

  it('grants no other origin a readable callback answer', async () => {
    const idp = await startMockIdP()
    try {
      const url = urlSignal()
      const login = loginGrokBuildPkce(
        { onAuthorizeUrl: (value) =>{  url.deliver(value) } },
        { issuer: idp.issuer, clientId: 'test-client', port: 0, allowInsecureLoopbackIssuer: true },
      )
      const authResponse = await fetch(await url.promise, { redirect: 'manual' })
      const delivery = await fetch(authResponse.headers.get('location')!, { headers: { origin: 'https://evil.example' } })
      expect(delivery.headers.get('access-control-allow-origin')).toBeNull()
      await login
    } finally {
      await idp.close()
    }
  })

  it('completes via the manual paste channel (full redirect URL accepted)', async () => {
    const idp = await startMockIdP()
    try {
      const url = urlSignal()
      const login = loginGrokBuildPkce(
        {
          onAuthorizeUrl: (value) =>{  url.deliver(value) },
          awaitCode: async () => {
            const authorizeUrl = await url.promise
            const authResponse = await fetch(authorizeUrl, { redirect: 'manual' })
            return authResponse.headers.get('location') ?? ''
          },
        },
        { issuer: idp.issuer, clientId: 'test-client', port: 0, allowInsecureLoopbackIssuer: true },
      )
      const credential = await login
      expect(credential.access).toBe('mock-access')
    } finally {
      await idp.close()
    }
  })

  it('rejects with state_mismatch on a forged callback', async () => {
    const idp = await startMockIdP()
    try {
      const url = urlSignal()
      const login = loginGrokBuildPkce(
        { onAuthorizeUrl: (value) =>{  url.deliver(value) } },
        { issuer: idp.issuer, clientId: 'test-client', port: 0, allowInsecureLoopbackIssuer: true },
      )
      // Attach a handler up front: the rejection lands mid-test, and a
      // late-attached .rejects would trip Node's unhandled-rejection hook.
      const outcome = login.then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      )
      const authorizeUrl = await url.promise
      const authResponse = await fetch(authorizeUrl, { redirect: 'manual' })
      const location = authResponse.headers.get('location')!
      const forged = location.replace(/state=[^&]+/, 'state=forged')
      const page = await fetch(forged)
      expect(page.status).toBe(400)
      const result = await outcome
      expect(result.ok).toBe(false)
      expect(!result.ok && result.error).toMatchObject({ code: 'state_mismatch' })
    } finally {
      await idp.close()
    }
  })

  it('rejects with timeout when nothing completes', async () => {
    const idp = await startMockIdP()
    try {
      const login = loginGrokBuildPkce(
        { onAuthorizeUrl: () => {}, timeoutMs: 150 },
        { issuer: idp.issuer, clientId: 'test-client', port: 0, allowInsecureLoopbackIssuer: true },
      )
      await expect(login).rejects.toMatchObject({ code: 'timeout' })
    } finally {
      await idp.close()
    }
  })

  it('rejects with the authorization error when the redirect carries one', async () => {
    const idp = await startMockIdP()
    try {
      const url = urlSignal()
      const login = loginGrokBuildPkce(
        { onAuthorizeUrl: (value) =>{  url.deliver(value) } },
        { issuer: idp.issuer, clientId: 'test-client', port: 0, allowInsecureLoopbackIssuer: true },
      )
      const outcome = login.then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      )
      const authorizeUrl = new URL(await url.promise)
      const callback = new URL(authorizeUrl.searchParams.get('redirect_uri')!)
      const page = await fetch(`${callback.href}?error=access_denied`)
      expect(page.status).toBe(400)
      const result = await outcome
      expect(result.ok).toBe(false)
      expect(!result.ok && result.error).toMatchObject({ code: 'token_exchange' })
      expect(!result.ok && (result.error as Error).message).toContain('access_denied')
    } finally {
      await idp.close()
    }
  })

  it('reports a cancelled login when the caller aborts', async () => {
    const idp = await startMockIdP()
    try {
      const controller = new AbortController()
      const url = urlSignal()
      const login = loginGrokBuildPkce(
        { onAuthorizeUrl: (value) =>{  url.deliver(value) }, signal: controller.signal },
        { issuer: idp.issuer, clientId: 'test-client', port: 0, allowInsecureLoopbackIssuer: true },
      )
      // The loopback listener is bound once the authorize URL reaches the caller.
      await url.promise
      controller.abort()
      await expect(login).rejects.toThrow(/login was cancelled/u)
    } finally {
      await idp.close()
    }
  })

  it('requires HTTPS when the loopback override is not requested', async () => {
    await expect(
      loginGrokBuildPkce(
        { onAuthorizeUrl: () => {} },
        { issuer: 'http://127.0.0.1:56121', clientId: 'test-client', port: 0 },
      ),
    ).rejects.toMatchObject({ code: 'discovery' })
  })
})

describe('refreshGrokBuildToken', () => {
  it('adopts a rotated refresh token', async () => {
    const idp = await startMockIdP()
    try {
      const credential = await refreshGrokBuildToken(
        'old-refresh',
        { issuer: idp.issuer, clientId: 'test-client' },
        undefined,
        { allowInsecureLoopbackIssuer: true },
      )
      expect(credential).toMatchObject({ type: 'oauth', access: 'mock-access-2', refresh: 'mock-refresh-2' })
      expect(idp.lastTokenForm()?.get('refresh_token')).toBe('old-refresh')
    } finally {
      await idp.close()
    }
  })

  it('keeps the previous refresh token when the issuer does not rotate', async () => {
    const idp = await startMockIdP({ omitRefreshOnRefreshGrant: true })
    try {
      const credential = await refreshGrokBuildToken(
        'old-refresh',
        { issuer: idp.issuer, clientId: 'test-client' },
        undefined,
        { allowInsecureLoopbackIssuer: true },
      )
      expect(credential.refresh).toBe('old-refresh')
      expect(credential.access).toBe('mock-access-2')
    } finally {
      await idp.close()
    }
  })

  it('rejects an oversized token response before JSON parsing', async () => {
    const idp = await startMockIdP({ tokenResponsePaddingBytes: 70 * 1024 })
    try {
      await expect(
        refreshGrokBuildToken('old-refresh', { issuer: idp.issuer, clientId: 'test-client' }, undefined, {
          allowInsecureLoopbackIssuer: true,
        }),
      ).rejects.toMatchObject({ code: 'token_exchange' })
    } finally {
      await idp.close()
    }
  })
})

describe('issuer and discovery hardening', () => {
  it('rejects a non-https issuer in production (no loopback override)', async () => {
    await expect(discoverOAuthEndpoints('http://auth.x.ai')).rejects.toMatchObject({ code: 'discovery' })
  })

  it('rejects a https issuer on a non-approved origin', async () => {
    await expect(discoverOAuthEndpoints('https://auth.evil.example')).rejects.toMatchObject({ code: 'discovery' })
  })

  it('rejects an issuer string with userinfo', async () => {
    await expect(discoverOAuthEndpoints('https://auth.x.ai@evil.example/')).rejects.toMatchObject({
      code: 'discovery',
    })
  })

  it('accepts the approved origin with the loopback override for tests', async () => {
    const idp = await startMockIdP()
    try {
      const document = await discoverOAuthEndpoints(idp.issuer, undefined, {
        allowInsecureLoopbackIssuer: true,
      })
      expect(document.token_endpoint).toBe(`${idp.issuer}/oauth2/token`)
    } finally {
      await idp.close()
    }
  })

  it('rejects discovery when the issuer returns foreign authorization/token endpoints', async () => {
    const rogueIssuer = 'https://attacker.example/oauth'
    const server: Server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname === '/.well-known/openid-configuration') {
        res.writeHead(200, { 'content-type': 'application/json' }).end(
          JSON.stringify({
            issuer: rogueIssuer,
            authorization_endpoint: `${rogueIssuer}/authorize`,
            token_endpoint: `${rogueIssuer}/token`,
          }),
        )
        return
      }
      res.writeHead(404).end()
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    try {
      await expect(
        discoverOAuthEndpoints(`http://127.0.0.1:${port}`, undefined, {
          allowInsecureLoopbackIssuer: true,
        }),
      ).rejects.toMatchObject({ code: 'discovery' })
    } finally {
      await new Promise<void>(resolve => server.close(() =>{  resolve() }))
    }
  })

  it('rejects a discovery document whose issuer identity differs from the configured issuer', async () => {
    const server: Server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname === '/.well-known/openid-configuration') {
        const port = (server.address() as AddressInfo).port
        res.writeHead(200, { 'content-type': 'application/json' }).end(
          JSON.stringify({
            issuer: 'https://auth.x.ai',
            authorization_endpoint: `http://127.0.0.1:${String(port)}/authorize`,
            token_endpoint: `http://127.0.0.1:${String(port)}/token`,
          }),
        )
        return
      }
      res.writeHead(404).end()
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    try {
      await expect(
        discoverOAuthEndpoints(`http://127.0.0.1:${String(port)}`, undefined, {
          allowInsecureLoopbackIssuer: true,
        }),
      ).rejects.toMatchObject({ code: 'discovery' })
    } finally {
      await new Promise<void>(resolve => server.close(() =>{  resolve() }))
    }
  })

  it('keeps the loopback test override pinned to the exact issuer port', async () => {
    const server: Server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname === '/.well-known/openid-configuration') {
        const port = (server.address() as AddressInfo).port
        res.writeHead(200, { 'content-type': 'application/json' }).end(
          JSON.stringify({
            authorization_endpoint: `http://127.0.0.1:${String(port + 1)}/authorize`,
            token_endpoint: `http://127.0.0.1:${String(port + 1)}/token`,
          }),
        )
        return
      }
      res.writeHead(404).end()
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    try {
      await expect(
        discoverOAuthEndpoints(`http://127.0.0.1:${String(port)}`, undefined, {
          allowInsecureLoopbackIssuer: true,
        }),
      ).rejects.toMatchObject({ code: 'discovery' })
    } finally {
      await new Promise<void>(resolve => server.close(() =>{  resolve() }))
    }
  })

  it('rejects discovery when the declared body exceeds 64 KiB', async () => {
    const oversize = 'a'.repeat(65 * 1024)
    const server: Server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname === '/.well-known/openid-configuration') {
        res
          .writeHead(200, {
            'content-type': 'application/json',
            'content-length': String(Buffer.byteLength(oversize, 'utf8')),
          })
          .end(oversize)
        return
      }
      res.writeHead(404).end()
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    try {
      await expect(
        discoverOAuthEndpoints(`http://127.0.0.1:${port}`, undefined, {
          allowInsecureLoopbackIssuer: true,
        }),
      ).rejects.toMatchObject({ code: 'discovery' })
    } finally {
      await new Promise<void>(resolve => server.close(() =>{  resolve() }))
    }
  })

  it('rejects discovery when the streamed body grows past the 64 KiB cap', async () => {
    const server: Server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname === '/.well-known/openid-configuration') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.write(
          '{"issuer":"https://auth.x.ai","authorization_endpoint":"https://auth.x.ai/oauth2/authorize","token_endpoint":"https://auth.x.ai/oauth2/token","pad":"',
        )
        res.write('a'.repeat(70 * 1024))
        res.end('"}')
        return
      }
      res.writeHead(404).end()
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    try {
      await expect(
        discoverOAuthEndpoints(`http://127.0.0.1:${port}`, undefined, {
          allowInsecureLoopbackIssuer: true,
        }),
      ).rejects.toMatchObject({ code: 'discovery' })
    } finally {
      await new Promise<void>(resolve => server.close(() =>{  resolve() }))
    }
  })
})

describe('extractCode hardening', () => {
  it('rejects pathological pasted authorization codes', () => {
    const huge = 'a'.repeat(2048)
    expect(() => extractCode(huge)).toThrow(GrokBuildOAuthError)
    expect(() => extractCode(`http://127.0.0.1:56121/callback?code=${'x'.repeat(2048)}`)).toThrow(GrokBuildOAuthError)
  })

  it('extracts a code up to the ceiling', () => {
    const ok = 'a'.repeat(1024)
    expect(extractCode(`http://127.0.0.1:56121/callback?code=${ok}`)).toBe(ok)
  })

  it('returns an empty paste unchanged and keeps a code-less URL intact', () => {
    expect(extractCode('   ')).toBe('')
    expect(extractCode('http://127.0.0.1:56121/callback?state=s')).toBe('http://127.0.0.1:56121/callback?state=s')
  })
})

describe('resolveOAuthParams', () => {
  const ENV_KEYS = [
    'GROK_OAUTH2_ISSUER',
    'GROK_OAUTH2_CLIENT_ID',
    'GROK_OAUTH2_SCOPES',
    'GROK_OAUTH2_PORT',
    'GROK_OAUTH2_REFERRER',
  ]
  const saved = new Map<string, string | undefined>()

  function clearEnvironment(): void {
    delete process.env.GROK_OAUTH2_ISSUER
    delete process.env.GROK_OAUTH2_CLIENT_ID
    delete process.env.GROK_OAUTH2_SCOPES
    delete process.env.GROK_OAUTH2_PORT
    delete process.env.GROK_OAUTH2_REFERRER
  }

  beforeEach(() => {
    for (const key of ENV_KEYS) saved.set(key, process.env[key])
  })

  afterEach(() => {
    clearEnvironment()
    for (const key of ENV_KEYS) {
      const value = saved.get(key)
      if (value !== undefined) process.env[key] = value
    }
  })

  it('falls back to the documented Grok Build defaults', () => {
    clearEnvironment()
    expect(resolveOAuthParams()).toEqual({
      issuer: GROK_BUILD_OAUTH_ISSUER,
      clientId: GROK_BUILD_OAUTH_CLIENT_ID,
      scope: GROK_BUILD_OAUTH_SCOPE,
      port: GROK_BUILD_OAUTH_DEFAULT_PORT,
    })
  })

  it('reads every override from the GROK_OAUTH2_* environment', () => {
    process.env['GROK_OAUTH2_ISSUER'] = 'https://issuer.example'
    process.env['GROK_OAUTH2_CLIENT_ID'] = 'env-client'
    process.env['GROK_OAUTH2_SCOPES'] = 'openid'
    process.env['GROK_OAUTH2_PORT'] = '12345'
    process.env['GROK_OAUTH2_REFERRER'] = 'env-referrer'
    expect(resolveOAuthParams()).toEqual({
      issuer: 'https://issuer.example',
      clientId: 'env-client',
      scope: 'openid',
      port: 12345,
      referrer: 'env-referrer',
    })
  })

  it('prefers an explicit override over the environment, referrer included', () => {
    process.env['GROK_OAUTH2_ISSUER'] = 'https://issuer.example'
    process.env['GROK_OAUTH2_REFERRER'] = 'env-referrer'
    expect(resolveOAuthParams({ issuer: 'https://other.example', referrer: 'explicit-referrer' })).toMatchObject({
      issuer: 'https://other.example',
      referrer: 'explicit-referrer',
    })
    expect(resolveOAuthParams({ port: 0, scope: 'openid profile' })).toMatchObject({
      scope: 'openid profile',
      port: 0,
      referrer: 'env-referrer',
    })
  })
})

describe('buildAuthorizeUrl', () => {
  const params = {
    issuer: GROK_BUILD_OAUTH_ISSUER,
    clientId: 'test-client',
    scope: 'openid grok-cli:access',
    port: GROK_BUILD_OAUTH_DEFAULT_PORT,
  }
  const endpoints = {
    issuer: GROK_BUILD_OAUTH_ISSUER,
    authorization_endpoint: `${GROK_BUILD_OAUTH_ISSUER}/oauth2/authorize`,
    token_endpoint: `${GROK_BUILD_OAUTH_ISSUER}/oauth2/token`,
  }

  it('carries the PKCE, state and nonce parameters plus the optional referrer', () => {
    const url = new URL(
      buildAuthorizeUrl(
        endpoints,
        { ...params, referrer: 'xai-cli' },
        'http://127.0.0.1:56121/callback',
        'challenge-value',
        'state-value',
        'nonce-value',
      ),
    )
    expect(url.origin).toBe(GROK_BUILD_OAUTH_ISSUER)
    expect(url.pathname).toBe('/oauth2/authorize')
    for (const [key, value] of [
      ['response_type', 'code'],
      ['client_id', 'test-client'],
      ['redirect_uri', 'http://127.0.0.1:56121/callback'],
      ['scope', 'openid grok-cli:access'],
      ['code_challenge', 'challenge-value'],
      ['code_challenge_method', 'S256'],
      ['state', 'state-value'],
      ['nonce', 'nonce-value'],
      ['referrer', 'xai-cli'],
    ]) {
      expect(url.searchParams.get(key!)).toBe(value)
    }
  })

  it('omits the referrer when the parameters do not carry one', () => {
    const url = new URL(buildAuthorizeUrl(endpoints, params, 'http://127.0.0.1:56121/callback', 'c', 's', 'n'))
    expect(url.searchParams.has('referrer')).toBe(false)
  })
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

let stubbedIssuerPort = 43_000

/**
 * Serve OIDC discovery and the token endpoint from a stubbed fetch, so every
 * hostile-document and hostile-response case is reachable without a listening
 * IdP. Loopback traffic still uses the real network.
 */
function stubIdp(
  options: {
    document?: (issuer: string) => Record<string, unknown>
    rawDiscovery?: { body: string; status?: number }
    discoveryResponse?: () => unknown
    token?: () => unknown
  } = {},
): { issuer: string; calls: () => number } {
  stubbedIssuerPort += 1
  const issuer = `http://127.0.0.1:${String(stubbedIssuerPort)}`
  const realFetch = globalThis.fetch
  let calls = 0
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.endsWith('/.well-known/openid-configuration')) {
      calls += 1
      if (options.discoveryResponse !== undefined) return options.discoveryResponse()
      if (options.rawDiscovery !== undefined) {
        return new Response(options.rawDiscovery.body, { status: options.rawDiscovery.status ?? 200 })
      }
      return jsonResponse({
        issuer,
        authorization_endpoint: `${issuer}/oauth2/authorize`,
        token_endpoint: `${issuer}/oauth2/token`,
        ...options.document?.(issuer),
      })
    }
    if (url.endsWith('/oauth2/token')) return await options.token?.()
    return await realFetch(input, init)
  })
  return { issuer, calls: () => calls }
}

function discoverFrom(idp: { issuer: string }): Promise<{ token_endpoint: string }> {
  return discoverOAuthEndpoints(idp.issuer, undefined, { allowInsecureLoopbackIssuer: true })
}

describe('discovery document validation', () => {
  it('rejects a configured issuer that is not a URL', async () => {
    await expect(discoverOAuthEndpoints('not a url')).rejects.toMatchObject({ code: 'discovery' })
  })

  it('reports the loopback override as ignored for a non-loopback host', async () => {
    await expect(
      discoverOAuthEndpoints('http://auth.evil.example', undefined, { allowInsecureLoopbackIssuer: true }),
    ).rejects.toThrow(/loopback test override ignored/u)
  })

  it('rejects the approved origin when it carries a path', async () => {
    await expect(discoverOAuthEndpoints(`${GROK_BUILD_OAUTH_ISSUER}/oauth`)).rejects.toThrow(
      /origin URL without userinfo or path/u,
    )
  })

  it('serves a repeated discovery read from the process cache', async () => {
    const idp = stubIdp()
    const first = await discoverFrom(idp)
    expect(idp.calls()).toBe(1)
    const second = await discoverFrom(idp)
    expect(second).toEqual(first)
    expect(idp.calls()).toBe(1)
  })

  it('rejects a discovery document that is not JSON', async () => {
    const idp = stubIdp({ rawDiscovery: { body: 'not json' } })
    await expect(discoverFrom(idp)).rejects.toThrow(/invalid JSON/u)
  })

  it('rejects a discovery document served with an error status', async () => {
    const idp = stubIdp({ rawDiscovery: { body: '{"issuer":"x"}', status: 503 } })
    await expect(discoverFrom(idp)).rejects.toThrow(/discovery failed \(HTTP 503\)/u)
  })

  it('reports an unreachable discovery endpoint', async () => {
    const idp = stubIdp({
      discoveryResponse: () => {
        throw new Error('ECONNREFUSED')
      },
    })
    await expect(discoverFrom(idp)).rejects.toThrow(/is unreachable/u)
  })

  it('rejects a discovery document without OAuth endpoints', async () => {
    const idp = stubIdp({ document: () => ({ authorization_endpoint: undefined, token_endpoint: undefined }) })
    await expect(discoverFrom(idp)).rejects.toThrow(/lacks OAuth endpoints/u)
  })

  it('rejects a discovery endpoint that is not a URL', async () => {
    const idp = stubIdp({ document: () => ({ authorization_endpoint: 'nope' }) })
    await expect(discoverFrom(idp)).rejects.toThrow(/authorization_endpoint is not a valid URL/u)
  })

  it('requires HTTPS for a discovery endpoint, and never trusts a foreign host', async () => {
    const idp = stubIdp({ document: () => ({ authorization_endpoint: 'http://other.example/authorize' }) })
    await expect(discoverFrom(idp)).rejects.toThrow(/authorization_endpoint must use HTTPS/u)
  })

  it('rejects a discovery endpoint carrying userinfo on the issuer origin', async () => {
    const idp = stubIdp({
      document: issuer => ({
        authorization_endpoint: `${issuer.replace('http://', 'http://consent:secret@')}/authorize`,
      }),
    })
    await expect(discoverFrom(idp)).rejects.toThrow(/authorization_endpoint must not carry userinfo/u)
  })

  it('rejects a discovery endpoint that escaped the approved issuer origin', async () => {
    const idp = stubIdp({ document: () => ({ token_endpoint: 'https://other.example/token' }) })
    await expect(discoverFrom(idp)).rejects.toThrow(/token_endpoint escaped the approved issuer origin/u)
  })

  it('rejects a discovery body that declares more than 64 KiB even when cancel() fails', async () => {
    const idp = stubIdp({
      discoveryResponse: () => ({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-length': String(70 * 1024) }),
        body: {
          cancel: async () => {
            throw new Error('cancel failed')
          },
        },
      }),
    })
    await expect(discoverFrom(idp)).rejects.toThrow(/exceeds 65536 bytes/u)
  })

  it('rejects a discovery response without a body', async () => {
    const idp = stubIdp({
      discoveryResponse: () => ({ ok: true, status: 200, headers: new Headers(), body: null }),
    })
    await expect(discoverFrom(idp)).rejects.toThrow(/returned no body/u)
  })

  it('skips an empty chunk and refuses a discovery body that streams past 64 KiB', async () => {
    let reads = 0
    const idp = stubIdp({
      discoveryResponse: () => ({
        ok: true,
        status: 200,
        headers: new Headers(),
        body: {
          getReader: () => ({
            read: async () => {
              reads += 1
              if (reads === 1) return { value: undefined, done: false }
              return { value: new Uint8Array(70 * 1024), done: false }
            },
            cancel: async () => {
              throw new Error('cancel failed')
            },
            releaseLock: () => undefined,
          }),
        },
      }),
    })
    await expect(discoverFrom(idp)).rejects.toThrow(/exceeds 65536 bytes/u)
  })
})

describe('token endpoint failures', () => {
  function refresh(idp: { issuer: string }, signal?: AbortSignal): Promise<OAuthCredential> {
    return refreshGrokBuildToken('old-refresh', { issuer: idp.issuer, clientId: 'test-client' }, signal, {
      allowInsecureLoopbackIssuer: true,
    })
  }

  it('rejects a token response without an access token', async () => {
    const idp = stubIdp({ token: () => jsonResponse({ refresh_token: 'rotated' }) })
    await expect(refresh(idp)).rejects.toThrow(/missing access_token/u)
  })

  it('rejects a token endpoint body that is not JSON', async () => {
    const idp = stubIdp({ token: () => new Response('not json', { status: 200 }) })
    await expect(refresh(idp)).rejects.toThrow(/invalid JSON \(HTTP 200\)/u)
  })

  it('reports the issuer error and description from a rejected token request', async () => {
    const idp = stubIdp({
      token: () => jsonResponse({ error: 'invalid_grant', error_description: 'refresh token revoked' }, 400),
    })
    await expect(refresh(idp)).rejects.toThrow(/invalid_grant\): refresh token revoked/u)
  })

  it('falls back to the HTTP status when the rejection carries no error field', async () => {
    const idp = stubIdp({ token: () => jsonResponse({}, 500) })
    await expect(refresh(idp)).rejects.toThrow(/HTTP 500/u)
  })

  it('reports an unreachable token endpoint', async () => {
    const idp = stubIdp({
      token: () => {
        throw new Error('ECONNREFUSED')
      },
    })
    await expect(refresh(idp)).rejects.toThrow(/token endpoint is unreachable/u)
  })

  it('reports a cancelled token request', async () => {
    const idp = stubIdp({
      token: () => {
        throw new Error('aborted')
      },
    })
    const controller = new AbortController()
    controller.abort()
    await expect(refresh(idp, controller.signal)).rejects.toMatchObject({ code: 'cancelled' })
  })

  it('rejects an oversized token response even when cancel() fails', async () => {
    const idp = stubIdp({
      token: () => ({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-length': String(70 * 1024) }),
        body: {
          cancel: async () => {
            throw new Error('cancel failed')
          },
        },
      }),
    })
    await expect(refresh(idp)).rejects.toThrow(/size limit/u)
  })

  it('rejects a token response without a body', async () => {
    const idp = stubIdp({ token: () => ({ ok: true, status: 200, headers: new Headers(), body: null }) })
    await expect(refresh(idp)).rejects.toThrow(/returned no body/u)
  })

  it('reads a bounded discovery and token response that advertise their own length', async () => {
    let issuer = ''
    const server: Server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const body =
        url.pathname === '/.well-known/openid-configuration'
          ? JSON.stringify({
            issuer,
            authorization_endpoint: `${issuer}/oauth2/authorize`,
            token_endpoint: `${issuer}/oauth2/token`,
          })
          : JSON.stringify({ access_token: 'sized-access', refresh_token: 'sized-refresh', expires_in: 60 })
      res
        .writeHead(200, {
          'content-type': 'application/json',
          // A declared length the reader accepts, unlike the chunked mock IdP.
          'content-length': String(Buffer.byteLength(body, 'utf8')),
        })
        .end(body)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    issuer = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
    try {
      await expect(
        refreshGrokBuildToken('old-refresh', { issuer, clientId: 'test-client' }, undefined, {
          allowInsecureLoopbackIssuer: true,
        }),
      ).resolves.toMatchObject({ type: 'oauth', access: 'sized-access', refresh: 'sized-refresh' })
    } finally {
      await new Promise<void>(resolve => server.close(() =>{  resolve() }))
    }
  })

  it('skips an empty chunk and refuses a token body that streams past 64 KiB', async () => {
    let reads = 0
    const idp = stubIdp({
      token: () => ({
        ok: true,
        status: 200,
        headers: new Headers(),
        body: {
          getReader: () => ({
            read: async () => {
              reads += 1
              if (reads === 1) return { value: undefined, done: false }
              return { value: new Uint8Array(70 * 1024), done: false }
            },
            cancel: async () => {
              throw new Error('cancel failed')
            },
            releaseLock: () => undefined,
          }),
        },
      }),
    })
    await expect(refresh(idp)).rejects.toThrow(/size limit/u)
  })
})

/** Run a full PKCE login against a stubbed IdP, delivering the code to the loopback. */
async function loginViaStub(
  idp: { issuer: string },
  callbacks: Partial<PkceLoginCallbacks> = {},
): Promise<{ ok: true; value: OAuthCredential } | { ok: false; error: unknown }> {
  const url = urlSignal()
  const pending = loginGrokBuildPkce(
    { onAuthorizeUrl: (value) =>{  url.deliver(value) }, ...callbacks },
    { issuer: idp.issuer, clientId: 'test-client', port: 0, allowInsecureLoopbackIssuer: true },
  )
  // Attach the handler up front so a mid-test rejection is never unhandled.
  const outcome = pending.then(
    (value: OAuthCredential) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  )
  const authorizeUrl = new URL(await url.promise)
  const callback = new URL(authorizeUrl.searchParams.get('redirect_uri')!)
  const state = authorizeUrl.searchParams.get('state')!
  const page = await fetch(`${callback.href}?code=auth-code&state=${state}`)
  expect(page.status).toBe(200)
  return await outcome
}

describe('loopback listener binding', () => {
  it('reports a bind failure that never reaches the listening state', async () => {
    const idp = stubIdp()
    await expect(
      loginGrokBuildPkce(
        { onAuthorizeUrl: () => {} },
        { issuer: idp.issuer, clientId: 'test-client', port: 70_000, allowInsecureLoopbackIssuer: true },
      ),
    ).rejects.toThrow(/could not bind a loopback listener near port 70000/u)
  })
})

describe('code grant on the login path', () => {
  it('defaults the lifetime when the issuer omits expires_in', async () => {
    const idp = stubIdp({ token: () => jsonResponse({ access_token: 'fresh', refresh_token: 'rotated' }) })
    const before = Date.now()
    const outcome = await loginViaStub(idp)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw outcome.error
    expect(outcome.value).toMatchObject({ type: 'oauth', access: 'fresh', refresh: 'rotated' })
    expect(outcome.value.expires).toBeGreaterThanOrEqual(before + 3_600_000)
    expect(outcome.value.expires).toBeLessThan(before + 3_601_000)
  })

  it('rejects a fresh login whose token response carries no refresh token', async () => {
    const idp = stubIdp({ token: () => jsonResponse({ access_token: 'fresh' }) })
    const outcome = await loginViaStub(idp)
    expect(outcome.ok).toBe(false)
    expect(!outcome.ok && (outcome.error as Error).message).toMatch(/missing refresh_token/u)
  })

  it('keeps waiting for the loopback when the paste channel yields nothing', async () => {
    const idp = stubIdp({
      token: () => jsonResponse({ access_token: 'fresh', refresh_token: 'rotated', expires_in: 60 }),
    })
    const outcome = await loginViaStub(idp, { awaitCode: async () => undefined })
    expect(outcome.ok).toBe(true)
    expect(outcome.ok && outcome.value).toMatchObject({ access: 'fresh', refresh: 'rotated' })
  })
})
