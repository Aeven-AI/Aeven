/** The REST client: connector-supplied authentication, rate-limit waits, retry limits, and fixed error text. */

import { afterEach, describe, expect, it } from 'vitest'
import { DiscordError, DiscordRest, isGuildUnreachable } from '../aeven/rest.ts'
import { json, refusal, stubFetch, TEST_AUTHORIZATION, TEST_BASE, type FetchStub } from './harness.ts'

const strays: FetchStub[] = []

/** Install a fetch stub and remember it for teardown. */
function stub(respond: Parameters<typeof stubFetch>[0]): FetchStub {
  const installed = stubFetch(respond)
  strays.push(installed)
  return installed
}

/** The client under test. */
function rest(timeoutMs = 5_000): DiscordRest {
  return new DiscordRest({ authorization: TEST_AUTHORIZATION, baseUrl: TEST_BASE, timeoutMs })
}

afterEach(() => {
  for (const stray of strays.splice(0)) stray.restore()
})

describe('authentication', () => {
  it('sends the connector\'s authorization value verbatim, as the only credential header', async () => {
    const installed = stub(() => json({ ok: true }))
    await rest().request('GET', '/ping')
    expect(installed.requests[0]?.headers['authorization']).toBe('Bearer spec-session')
    expect(Object.keys(installed.requests[0]?.headers ?? {})).toEqual(['authorization'])
  })

  it('honours the configured API base', async () => {
    const installed = stub(() => json({ ok: true }))
    await rest().request('GET', '/ping')
    expect(installed.requests[0]?.url).toBe(`${TEST_BASE}/ping`)
  })

  it('sends a JSON body with the JSON content type, and caller headers beside it', async () => {
    const installed = stub(() => json({ ok: true }))
    await rest().request('PATCH', '/guilds/1', { body: { name: 'x' }, headers: { 'X-Audit-Log-Reason': 'why' } })
    expect(installed.requests[0]?.headers['content-type']).toBe('application/json')
    expect(installed.requests[0]?.headers['X-Audit-Log-Reason']).toBe('why')
    expect(installed.requests[0]?.body).toBe('{"name":"x"}')
  })
})

describe('rate limits', () => {
  it('waits the fractional retry_after a 429 names, then retries', async () => {
    const installed = stub((request) => installed.requests.length === 1
      ? json({ message: 'rate limited', retry_after: 0.02 }, 429)
      : json({ id: '9' }))
    const started = Date.now()
    await expect(rest().request('GET', '/ping')).resolves.toEqual({ id: '9' })
    expect(installed.requests).toHaveLength(2)
    expect(Date.now() - started).toBeGreaterThanOrEqual(15)
  })

  it('falls back to X-RateLimit-Remaining and X-RateLimit-Reset-After when the 429 body says nothing', async () => {
    const installed = stub((request) => installed.requests.length === 1
      ? new Response('', {
        status: 429,
        headers: { 'x-rate-limit-remaining': '0', 'x-rate-limit-reset-after': '0.02' },
      })
      : json({ id: '9' }))
    await expect(rest().request('GET', '/ping')).resolves.toEqual({ id: '9' })
    expect(installed.requests).toHaveLength(2)
  })

  it('retries a 429 for a write, because Discord refused it outright', async () => {
    const installed = stub((request) => installed.requests.length === 1
      ? json({ retry_after: 0.01 }, 429)
      : json({ id: '9' }))
    await expect(rest().request('POST', '/channels/1/messages', { body: { content: 'hi' } })).resolves.toEqual({ id: '9' })
    expect(installed.requests).toHaveLength(2)
  })

  it('gives up after three attempts rather than retrying forever', async () => {
    const installed = stub(() => json({ retry_after: 0.01 }, 429))
    await expect(rest().request('GET', '/ping')).rejects.toMatchObject({ status: 429 })
    expect(installed.requests).toHaveLength(3)
  })

  it('fails a wait longer than this client will hold, instead of hanging', async () => {
    const installed = stub(() => json({ retry_after: 3_600 }, 429))
    const started = Date.now()
    const thrown = await rest().request('GET', '/ping').catch((error: unknown) => error)
    expect(thrown).toBeInstanceOf(DiscordError)
    expect((thrown as DiscordError).status).toBe(429)
    expect((thrown as DiscordError).message).toMatch(/longer wait/u)
    expect(installed.requests).toHaveLength(1)
    expect(Date.now() - started).toBeLessThan(1_000)
  })
})

describe('retry limits', () => {
  it('retries a server failure for an idempotent verb', async () => {
    const installed = stub((request) => installed.requests.length === 1 ? json({ message: 'boom' }, 503) : json({ id: '9' }))
    await expect(rest().request('GET', '/ping')).resolves.toEqual({ id: '9' })
    expect(installed.requests).toHaveLength(2)
  })

  it('never retries a server failure for a write, because the write may have landed', async () => {
    const installed = stub(() => json({ message: 'boom' }, 503))
    await expect(rest().request('POST', '/channels/1/messages', { body: { content: 'hi' } })).rejects.toMatchObject({
      status: 503,
    })
    expect(installed.requests).toHaveLength(1)
  })

  it('never retries a write after a transport error', async () => {
    const installed = stub(() => { throw new TypeError('fetch failed') })
    await expect(rest().request('POST', '/channels/1/messages', { body: { content: 'hi' } })).rejects.toMatchObject({
      status: 0,
    })
    expect(installed.requests).toHaveLength(1)
  })

  it('retries an idempotent read after a transport error', async () => {
    const installed = stub((request) => {
      if (installed.requests.length === 1) throw new TypeError('fetch failed')
      expect(request.method).toBe('GET')
      return json({ id: '9' })
    })
    await expect(rest().request('GET', '/ping')).resolves.toEqual({ id: '9' })
    expect(installed.requests).toHaveLength(2)
  })
})

describe('failures', () => {
  it('maps 403 to a fixed sentence and a status, and to a guild the bot cannot reach', async () => {
    stub(() => refusal(403))
    const thrown = await rest().request('GET', '/guilds/1/channels').catch((error: unknown) => error)
    expect(thrown).toBeInstanceOf(DiscordError)
    expect((thrown as DiscordError).status).toBe(403)
    expect((thrown as DiscordError).message).toBe('Discord refused this request for the bot user. (HTTP 403)')
    expect(isGuildUnreachable(thrown)).toBe(true)
  })

  it('maps 404 to its own fixed sentence, distinct from the 403 one', async () => {
    stub(() => refusal(404))
    const thrown = await rest().request('GET', '/guilds/1/channels').catch((error: unknown) => error)
    expect((thrown as DiscordError).status).toBe(404)
    expect((thrown as DiscordError).message).toBe('Discord holds nothing at this path. (HTTP 404)')
    expect((thrown as DiscordError).message).not.toBe('Discord refused this request for the bot user. (HTTP 403)')
    expect(isGuildUnreachable(thrown)).toBe(true)
  })

  it('maps 401 to the token sentence, and is not a guild the bot cannot reach', async () => {
    stub(() => refusal(401))
    const thrown = await rest().request('GET', '/ping').catch((error: unknown) => error)
    expect((thrown as DiscordError).message).toBe('Discord rejected the bot token. (HTTP 401)')
    expect(isGuildUnreachable(thrown)).toBe(false)
  })

  it('maps any other 4xx to a sentence that names the status', async () => {
    stub(() => refusal(400))
    const thrown = await rest().request('GET', '/ping').catch((error: unknown) => error)
    expect((thrown as DiscordError).message).toBe('Discord rejected this request. (HTTP 400)')
  })

  it('never carries Discord\'s response body in the error', async () => {
    stub(() => refusal(400))
    const thrown = await rest().request('POST', '/channels/1/messages', { body: { content: 'hi' } }).catch((error: unknown) => error)
    const serialized = JSON.stringify(thrown, Object.getOwnPropertyNames(thrown))
    expect((thrown as Error).message).not.toContain('BODY_SENTINEL')
    expect(serialized).not.toContain('BODY_SENTINEL')
    expect(serialized).not.toContain('50013')
  })

  it('names an unanswerable request without a status', async () => {
    stub(() => { throw new TypeError('fetch failed') })
    const thrown = await rest().request('POST', '/channels/1/messages', { body: {} }).catch((error: unknown) => error)
    expect((thrown as DiscordError).status).toBe(0)
    expect((thrown as DiscordError).message).toBe('Discord did not answer the request.')
  })

  it('names a successful body it cannot decode', async () => {
    stub(() => new Response('<html>not json</html>', { status: 200 }))
    await expect(rest().request('GET', '/ping')).rejects.toMatchObject({ status: 0 })
  })

  it('reads a 204 as no body', async () => {
    stub(() => new Response(null, { status: 204 }))
    await expect(rest().request('PUT', '/channels/1/messages/2/reactions/x/@me')).resolves.toBeUndefined()
  })
})
