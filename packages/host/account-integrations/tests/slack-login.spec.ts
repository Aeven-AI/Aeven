/**
 * The Slack login against a fixture Slack: the consent URL it builds, the callback it accepts and
 * rejects, the exchange it sends without a client secret, the refresh, the revocation, and the
 * token probe. No test reaches Slack.
 *
 * Each test observes the completion from before it redirects the browser, so a login that fails
 * while the redirect is in flight is never an unobserved rejection.
 */

import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { isSlackConsentFailure, probeSlackToken, refreshSlackToken, revokeSlackToken, SlackLoginError, startSlackLogin } from '../src/slack-login.ts'

/** One request the fixture received. */
interface Recorded {
  path: string
  form: URLSearchParams
  authorization: string | undefined
}

/** A fixture standing in for Slack's OAuth and web API. */
interface Fixture {
  endpoints: { authorize: string; token: string; authTest: string; revoke: string }
  received: Recorded[]
  /** Replace the answer the next exchange gives; a content type sends the body raw, a delay holds it back. */
  answerExchange: (next: { status: number; body: unknown; contentType?: string; delayMs?: number }) => void
  /** Replace the answer the next workspace read gives. */
  answerAuthTest: (next: unknown) => void
  /** Replace the answer the next revocation gives; a content type sends the body raw. */
  answerRevoke: (next: { status?: number; body: unknown; contentType?: string }) => void
  close: () => Promise<void>
}

/** The token exchange answer that connects a fixture workspace. */
const TOKEN_BODY = { ok: true, access_token: 'xoxp-1', authed_user: { id: 'U1', scope: 'search:read.public,chat:write' }, team: { id: 'T1' } }

/** The workspace read answer for that token. */
const WORKSPACE_BODY = { ok: true, team_id: 'T1', user_id: 'U1', team: 'Acme', user: 'olivier', url: 'https://acme.slack.com/' }

let fixture: Fixture | undefined

afterEach(async () => {
  await fixture?.close()
  fixture = undefined
})

/** Start a fixture Slack on an ephemeral port. */
async function startFixture(): Promise<Fixture> {
  const received: Recorded[] = []
  let exchange: { status: number; body: unknown; contentType?: string; delayMs?: number } = { status: 200, body: TOKEN_BODY }
  let authTest: unknown = WORKSPACE_BODY
  let revoke: { status?: number; body: unknown; contentType?: string } = { body: { ok: true } }
  const server: Server = createServer((request: IncomingMessage, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      const path = request.url ?? '/'
      received.push({ path, form: new URLSearchParams(Buffer.concat(chunks).toString()), authorization: request.headers.authorization })
      const send = (status: number, body: unknown): void => {
        response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body))
      }
      if (path === '/oauth/v2/user.access') {
        const reply = (): void => {
          if (exchange.contentType === undefined) send(exchange.status, exchange.body)
          else response.writeHead(exchange.status, { 'Content-Type': exchange.contentType }).end(String(exchange.body))
        }
        if (exchange.delayMs === undefined) reply()
        else setTimeout(reply, exchange.delayMs)
      }
      else if (path === '/auth.test') send(200, authTest)
      else if (path === '/auth.revoke') {
        if (revoke.contentType === undefined) send(revoke.status ?? 200, revoke.body)
        else response.writeHead(revoke.status ?? 200, { 'Content-Type': revoke.contentType }).end(String(revoke.body))
      }
      else send(404, { ok: false, error: 'unknown_endpoint' })
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  /* v8 ignore next -- a listening server always reports an object address */
  const port = typeof address === 'object' && address !== null ? address.port : 0
  const base = `http://127.0.0.1:${port}`
  return {
    endpoints: { authorize: `${base}/oauth/v2/authorize`, token: `${base}/oauth/v2/user.access`, authTest: `${base}/auth.test`, revoke: `${base}/auth.revoke` },
    received,
    answerExchange: (next) => { exchange = next },
    answerAuthTest: (next) => { authTest = next },
    answerRevoke: (next) => { revoke = next },
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => { resolve() }))
    },
  }
}

/** One login whose outcome is observed from the moment it starts, as its caller does. */
async function beginLogin(fixtureSlack: Fixture, options: { port?: number; timeoutMs?: number; scopes?: string[] } = {}) {
  const login = await startSlackLogin({
    clientId: 'cid.test', port: options.port ?? 0, scopes: options.scopes ?? ['search:read.public'],
    timeoutMs: options.timeoutMs ?? 5_000, endpoints: fixtureSlack.endpoints,
  })
  const settled = login.completion.then(
    value => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  )
  return { login, settled }
}

/** Send the browser to one login's callback with the outcome a consent produces. */
async function redirect(login: { redirectUri: string; url: string }, outcome: 'ok' | 'state' | 'denied' | 'refused' | 'no-code'): Promise<number> {
  const state = new URL(login.url).searchParams.get('state') ?? ''
  const query = outcome === 'state' ? 'state=wrong&code=abc'
    : outcome === 'denied' ? `state=${state}&error=access_denied`
      : outcome === 'refused' ? `state=${state}&error=invalid_scope`
        : outcome === 'no-code' ? `state=${state}`
          : `state=${state}&code=abc`
  const answer = await fetch(`${login.redirectUri}?${query}`)
  return answer.status
}

describe('Slack workspace login', () => {
  it('builds a consent URL whose challenge matches the verifier it sends, without a client secret', async () => {
    fixture = await startFixture()
    fixture.answerExchange({ status: 200, body: { ok: false, error: 'invalid_code' } })
    const { login, settled } = await beginLogin(fixture)
    const url = new URL(login.url)
    expect(url.pathname).toBe('/oauth/v2/authorize')
    expect(url.searchParams.get('client_id')).toBe('cid.test')
    expect(url.searchParams.get('user_scope')).toBe('search:read.public')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(await redirect(login, 'ok')).toBe(200)
    expect(await settled).toMatchObject({ ok: false, error: { reason: 'exchange', message: 'invalid_code' } })
    const exchange = fixture.received.find(entry => entry.path === '/oauth/v2/user.access')
    expect(exchange?.form.get('client_secret')).toBeNull()
    expect(exchange?.form.get('grant_type')).toBe('authorization_code')
    expect(createHash('sha256').update(exchange?.form.get('code_verifier') ?? '').digest('base64url')).toBe(url.searchParams.get('code_challenge'))
    expect(exchange?.form.get('redirect_uri')).toBe(url.searchParams.get('redirect_uri'))
  })

  it('names the workspace and account Slack reports, with the scopes the exchange granted', async () => {
    fixture = await startFixture()
    const { login, settled } = await beginLogin(fixture)
    await redirect(login, 'ok')
    expect(await settled).toMatchObject({
      ok: true,
      value: { token: { accessToken: 'xoxp-1', scopes: ['search:read.public', 'chat:write'] }, workspace: { teamId: 'T1', teamName: 'Acme', userId: 'U1', userName: 'olivier', domain: 'acme' } },
    })
    expect(fixture.received.find(entry => entry.path === '/auth.test')?.authorization).toBe('Bearer xoxp-1')
  })

  it('rejects a callback whose state does not match the login', async () => {
    fixture = await startFixture()
    const { login, settled } = await beginLogin(fixture)
    expect(await redirect(login, 'state')).toBe(400)
    expect(await settled).toMatchObject({ ok: false, error: { reason: 'state' } })
  })

  it('reports a consent the reader refused as denied, without exchanging anything', async () => {
    fixture = await startFixture()
    const { login, settled } = await beginLogin(fixture)
    await redirect(login, 'denied')
    expect(await settled).toMatchObject({ ok: false, error: { reason: 'denied', message: 'access_denied' } })
    expect(fixture.received.some(entry => entry.path === '/oauth/v2/user.access')).toBe(false)
  })

  it('reports a consent Slack refused for another reason as a failed exchange', async () => {
    fixture = await startFixture()
    const { login, settled } = await beginLogin(fixture)
    await redirect(login, 'refused')
    expect(await settled).toMatchObject({ ok: false, error: { reason: 'exchange', message: 'invalid_scope' } })
  })

  it('rejects a callback that carries no code', async () => {
    fixture = await startFixture()
    const { login, settled } = await beginLogin(fixture)
    expect(await redirect(login, 'no-code')).toBe(400)
    expect(await settled).toMatchObject({ ok: false, error: { reason: 'response', message: 'the Slack callback carried no code' } })
  })

  it('answers an unrelated path on the callback port without completing the login', async () => {
    fixture = await startFixture()
    const { login, settled } = await beginLogin(fixture)
    const other = await fetch(login.redirectUri.replace('/callback', '/favicon.ico'))
    expect(other.status).toBe(404)
    login.cancel()
    expect(await settled).toMatchObject({ ok: false, error: { reason: 'cancelled' } })
  })

  it('separates an administrator refusal from a spent consent', async () => {
    fixture = await startFixture()
    fixture.answerExchange({ status: 200, body: { ok: false, error: 'app_not_admin_approved' } })
    const refused = await beginLogin(fixture)
    await redirect(refused.login, 'ok')
    expect(await refused.settled).toMatchObject({ ok: false, error: { reason: 'approval', message: 'app_not_admin_approved' } })

    fixture.answerExchange({ status: 200, body: { ok: false, error: 'invalid_code' } })
    const spent = await beginLogin(fixture)
    await redirect(spent.login, 'ok')
    const outcome = await spent.settled
    expect(outcome.ok).toBe(false)
    expect(isSlackConsentFailure(outcome.ok ? undefined : outcome.error)).toBe(true)
  })

  it('refuses an exchange Slack answers without JSON, and one that carries no token', async () => {
    fixture = await startFixture()
    fixture.answerExchange({ status: 200, body: null })
    const empty = await beginLogin(fixture)
    await redirect(empty.login, 'ok')
    expect(await empty.settled).toMatchObject({ ok: false, error: { reason: 'response' } })

    fixture.answerExchange({ status: 200, body: { ok: true } })
    const tokenless = await beginLogin(fixture)
    await redirect(tokenless.login, 'ok')
    expect(await tokenless.settled).toMatchObject({ ok: false, error: { reason: 'response', message: 'Slack returned no access token' } })
  })

  it('refuses a token Slack no longer accepts when a workspace is read', async () => {
    fixture = await startFixture()
    fixture.answerAuthTest({ ok: false, error: 'invalid_auth' })
    const { login, settled } = await beginLogin(fixture)
    await redirect(login, 'ok')
    const outcome = await settled
    expect(outcome.ok).toBe(false)
    expect(isSlackConsentFailure(outcome.ok ? undefined : outcome.error)).toBe(true)
  })

  it('keeps a workspace whose URL Slack did not format as one, and refuses a read that names neither team nor account', async () => {
    fixture = await startFixture()
    fixture.answerAuthTest({ ok: true, team_id: 'T1', user_id: 'U1', team: 'Acme', user: 'olivier', url: 'not a url' })
    const plain = await beginLogin(fixture)
    await redirect(plain.login, 'ok')
    expect(await plain.settled).toMatchObject({ ok: true, value: { workspace: { teamId: 'T1', teamName: 'Acme', userId: 'U1', userName: 'olivier' } } })

    fixture.answerAuthTest({ ok: true })
    const unnamed = await beginLogin(fixture)
    await redirect(unnamed.login, 'ok')
    expect(await unnamed.settled).toMatchObject({ ok: false, error: { reason: 'response', message: 'Slack reported no workspace or account' } })
  })

  it('refuses an answer Slack did not send as JSON, and one that names no error code', async () => {
    fixture = await startFixture()
    fixture.answerExchange({ status: 200, body: 'not json', contentType: 'text/plain' })
    const raw = await beginLogin(fixture)
    await redirect(raw.login, 'ok')
    expect(await raw.settled).toMatchObject({ ok: false, error: { reason: 'response', message: 'Slack answered with no JSON (200)' } })

    fixture.answerExchange({ status: 503, body: { ok: false } })
    const uncoded = await beginLogin(fixture)
    await redirect(uncoded.login, 'ok')
    expect(await uncoded.settled).toMatchObject({ ok: false, error: { reason: 'exchange', message: 'http-503' } })
  })

  it('reads granted scopes from the top level when Slack names no authorizing user', async () => {
    fixture = await startFixture()
    fixture.answerExchange({ status: 200, body: { ok: true, access_token: 'xoxp-3', scope: 'chat:write,search:read.public' } })
    const { login, settled } = await beginLogin(fixture)
    await redirect(login, 'ok')
    expect(await settled).toMatchObject({ ok: true, value: { token: { accessToken: 'xoxp-3', scopes: ['chat:write', 'search:read.public'] } } })
  })

  it('falls back to the ids Slack reports for a workspace and account it does not name', async () => {
    fixture = await startFixture()
    fixture.answerAuthTest({ ok: true, team_id: 'T2', user_id: 'U2', team: '', user: '', url: 'https://.slack.com/' })
    const { login, settled } = await beginLogin(fixture)
    await redirect(login, 'ok')
    expect(await settled).toMatchObject({ ok: true, value: { workspace: { teamId: 'T2', teamName: 'T2', userId: 'U2', userName: 'U2' } } })
  })

  it('keeps a workspace Slack reports without a workspace URL', async () => {
    fixture = await startFixture()
    fixture.answerAuthTest({ ok: true, team_id: 'T3', user_id: 'U3', team: 'Acme', user: 'olivier' })
    const { login, settled } = await beginLogin(fixture)
    await redirect(login, 'ok')
    const outcome = await settled
    expect(outcome.ok).toBe(true)
    expect(outcome.ok && 'domain' in outcome.value.workspace).toBe(false)
  })

  it('stops a login cancelled while its exchange is in flight', async () => {
    fixture = await startFixture()
    fixture.answerExchange({ status: 200, body: TOKEN_BODY, delayMs: 200 })
    const { login, settled } = await beginLogin(fixture)
    await redirect(login, 'ok')
    login.cancel()
    expect(await settled).toMatchObject({ ok: false, error: { reason: 'cancelled' } })
  })

  it('falls back to Slack\'s own endpoints for any the caller leaves out', async () => {
    fixture = await startFixture()
    const partial = await startSlackLogin({ clientId: 'cid.test', port: 0, scopes: [], timeoutMs: 5_000, endpoints: { token: fixture.endpoints.token } })
    expect(new URL(partial.url).origin).toBe('https://slack.com')
    const settled = partial.completion.then(() => undefined, (error: unknown) => error)
    partial.cancel()
    expect(await settled).toMatchObject({ reason: 'cancelled' })
    const token = await refreshSlackToken({ clientId: 'cid.test', refreshToken: 'xoxe-1', timeoutMs: 5_000, endpoints: { token: fixture.endpoints.token } })
    expect(token.accessToken).toBe('xoxp-1')
  })

  it('fails on a busy callback port with that fact', async () => {
    fixture = await startFixture()
    const taken = createServer()
    taken.listen(0, '127.0.0.1')
    await once(taken, 'listening')
    const address = taken.address()
    /* v8 ignore next -- a listening server always reports an object address */
    const port = typeof address === 'object' && address !== null ? address.port : 0
    const refusal = await startSlackLogin({ clientId: 'cid.test', port, scopes: [], timeoutMs: 1_000, endpoints: fixture.endpoints })
      .then(() => undefined, (error: unknown) => error)
    expect(refusal).toBeInstanceOf(SlackLoginError)
    expect((refusal as SlackLoginError).reason).toBe('port')
    expect((refusal as SlackLoginError).message).toContain(String(port))
    taken.closeAllConnections()
    await new Promise<void>(resolve => taken.close(() => { resolve() }))
  })

  it('times out when the reader never finishes', async () => {
    fixture = await startFixture()
    const { settled } = await beginLogin(fixture, { timeoutMs: 200 })
    expect(await settled).toMatchObject({ ok: false, error: { reason: 'timeout' } })
  })

  it('cancels a login in flight', async () => {
    fixture = await startFixture()
    const { login, settled } = await beginLogin(fixture)
    login.cancel()
    expect(await settled).toMatchObject({ ok: false, error: { reason: 'cancelled' } })
  })

  it('refreshes a rotating token with the client id and no secret', async () => {
    fixture = await startFixture()
    fixture.answerExchange({ status: 200, body: { ok: true, access_token: 'xoxp-2', refresh_token: 'xoxe-2', expires_in: 43_200 } })
    const token = await refreshSlackToken({ clientId: 'cid.test', refreshToken: 'xoxe-1', timeoutMs: 5_000, endpoints: fixture.endpoints })
    expect(token.accessToken).toBe('xoxp-2')
    expect(token.refreshToken).toBe('xoxe-2')
    expect(token.expiresAt).toBeGreaterThan(Date.now())
    const sent = fixture.received[0]?.form
    expect(sent?.get('grant_type')).toBe('refresh_token')
    expect(sent?.get('refresh_token')).toBe('xoxe-1')
    expect(sent?.get('client_secret')).toBeNull()
  })

  it('treats a revocation Slack already performed as done and refuses nothing else silently', async () => {
    fixture = await startFixture()
    await expect(revokeSlackToken({ accessToken: 'xoxp-1', timeoutMs: 5_000, endpoints: fixture.endpoints })).resolves.toBeUndefined()
    fixture.answerRevoke({ body: { ok: false, error: 'token_revoked' } })
    await expect(revokeSlackToken({ accessToken: 'xoxp-1', timeoutMs: 5_000, endpoints: fixture.endpoints })).resolves.toBeUndefined()
    fixture.answerRevoke({ body: { ok: false, error: 'invalid_auth' } })
    await expect(revokeSlackToken({ accessToken: 'xoxp-1', timeoutMs: 5_000, endpoints: fixture.endpoints })).resolves.toBeUndefined()
    fixture.answerRevoke({ body: { ok: false, error: 'fatal_error' } })
    await expect(revokeSlackToken({ accessToken: 'xoxp-1', timeoutMs: 5_000, endpoints: fixture.endpoints }))
      .rejects.toMatchObject({ reason: 'exchange', message: 'fatal_error' })
    // An answer Slack did not send as JSON, and one with no error code at all, both report the status.
    fixture.answerRevoke({ status: 503, body: 'not json', contentType: 'text/plain' })
    await expect(revokeSlackToken({ accessToken: 'xoxp-1', timeoutMs: 5_000, endpoints: fixture.endpoints }))
      .rejects.toMatchObject({ reason: 'exchange', message: 'http-503' })
    fixture.answerRevoke({ body: { ok: false } })
    await expect(revokeSlackToken({ accessToken: 'xoxp-1', timeoutMs: 5_000, endpoints: fixture.endpoints }))
      .rejects.toMatchObject({ reason: 'exchange', message: 'http-200' })
  })

  it('reports a failure that is not a Slack refusal as a failure to ask, not a verdict', () => {
    expect(isSlackConsentFailure(new Error('socket closed'))).toBe(false)
    expect(isSlackConsentFailure(new SlackLoginError('exchange', 'fatal_error'))).toBe(false)
  })

  it('probes a stored token without treating an unreachable Slack as a verdict', async () => {
    fixture = await startFixture()
    // A caller that overrides only the endpoint in play leaves the rest to Slack's own.
    await expect(probeSlackToken({ accessToken: 'xoxp-1', timeoutMs: 5_000, endpoints: { authTest: fixture.endpoints.authTest } })).resolves.toBe(true)
    fixture.answerAuthTest({ ok: false, error: 'invalid_auth' })
    await expect(probeSlackToken({ accessToken: 'xoxp-1', timeoutMs: 5_000, endpoints: fixture.endpoints })).resolves.toBe(false)
    const dead = fixture.endpoints
    await fixture.close()
    fixture = undefined
    await expect(probeSlackToken({ accessToken: 'xoxp-1', timeoutMs: 200, endpoints: dead })).rejects.toMatchObject({ reason: 'timeout' })
  })
})
