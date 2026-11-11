import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@aeven/agent'
import * as cloudMeter from '@aeven/cloud-meter'
import { PROVIDER as AEVEN_PROVIDER } from '@aeven/llm-aeven'
import type { Config } from '@aeven/cloud-meter'

interface Call { url: string; method: string; authorization: string | undefined; body: unknown }

/** A scripted Aeven API: each answer is a status and body, or a thrown value. */
function api(answer: (call: Call) => { status: number; body?: unknown } | { throws: unknown }) {
  const calls: Call[] = []
  const fetch = vi.fn((url: string, init: RequestInit = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>
    const call: Call = {
      url,
      method: init.method ?? 'GET',
      authorization: headers.authorization,
      body: init.body === undefined ? undefined : JSON.parse(init.body as string) as unknown,
    }
    calls.push(call)
    const result = answer(call)
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- the plugin must survive a non-Error rejection too
    if ('throws' in result) return Promise.reject(result.throws)
    const text = typeof result.body === 'string' ? result.body : JSON.stringify(result.body ?? {})
    return Promise.resolve(new Response(text, { status: result.status }))
  })
  vi.stubGlobal('fetch', fetch)
  return calls
}

function agent(owner: string | undefined, session = 'session-1'): Agent {
  return { session: { id: session, header: { owner } } } as unknown as Agent
}

const OWNER_TOKENS: Record<string, string> = { alice: 'token-alice', bob: 'token-bob' }

async function setup(config: Partial<Config> = {}, tokens: (owner: string | undefined) => Promise<{ value: string } | undefined> =
  owner => Promise.resolve(owner !== undefined && OWNER_TOKENS[owner] !== undefined ? { value: OWNER_TOKENS[owner] } : undefined)) {
  const ctx = new Context()
  ctx.provide('credentials', { resolve: (_ref: unknown, owner?: string) => tokens(owner) })
  const fiber = ctx.plugin(cloudMeter, { apiUrl: 'https://api.test/', ...config })
  await fiber
  const request = (owner: string | undefined, provider: string, step = 1, turn = 1) =>
    (ctx.waterfall as unknown as (name: string, payload: unknown, next: () => Promise<unknown>) => Promise<{ provider: string }>)(
      'agent/request', { agent: agent(owner), turn, step, signal: new AbortController().signal },
      () => Promise.resolve({ provider, model: 'm' }),
    )
  const admit = (account: string) => (ctx.bail as unknown as (name: string, account: string) => string | undefined)('sandbox-jail/admit', account)
  const usage = (account: string, cpuSeconds: number) => {
    (ctx.emit as unknown as (name: string, payload: unknown) => void)('sandbox-jail/usage', { account, cpuSeconds })
  }
  return { ctx, fiber, request, admit, usage }
}

/** Collect the plugin's log lines of one level. */
function logLines(ctx: Context, type: string): string[] {
  const lines: string[] = []
  type Exporter = { levels: Record<string, number>; export: (message: { type: string; args: unknown[] }) => void }
  ;(ctx.logger as unknown as { exporter: (exporter: Exporter) => void })
    .exporter({ levels: { default: 3 }, export: (message) => { if (message.type === type) lines.push(String(message.args[0])) } })
  return lines
}

function charges(call: Call): unknown[] {
  return (call.body as { charges: unknown[] }).charges
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('cloud-meter reports', () => {
  it('sends each owner\'s sandbox seconds as one report per interval, with that owner\'s token', async () => {
    const calls = api(() => ({ status: 200, body: { funded: true } }))
    const { usage } = await setup()
    usage('alice', 1.5)
    usage('alice', 0.5)
    usage('bob', 3)

    await vi.advanceTimersByTimeAsync(60_000)

    expect(calls.map(call => [call.url, call.authorization])).toEqual([
      ['https://api.test/api/cloud/meter/charges', 'Bearer token-alice'],
      ['https://api.test/api/cloud/meter/charges', 'Bearer token-bob'],
    ])
    expect(charges(calls[0] as Call)).toEqual([{ id: expect.stringMatching(/^sandbox:/u) as string, kind: 'sandbox', quantity: 2 }])
    expect(charges(calls[1] as Call)).toEqual([expect.objectContaining({ kind: 'sandbox', quantity: 3 })])

    await vi.advanceTimersByTimeAsync(60_000)
    expect(calls).toHaveLength(2)
  })

  it('reports a turn on an unbilled provider once, on its first request, and only for an owned session', async () => {
    const calls = api(() => ({ status: 200, body: { funded: true } }))
    const { request } = await setup()

    expect(await request('alice', 'grok-build')).toEqual({ provider: 'grok-build', model: 'm' })
    await request('alice', 'grok-build', 2)
    await request('alice', AEVEN_PROVIDER)
    await request(undefined, 'grok-build')
    await vi.advanceTimersByTimeAsync(60_000)

    const posted = calls.filter(call => call.method === 'POST')
    expect(posted).toHaveLength(1)
    expect(charges(posted[0] as Call)).toEqual([{ id: 'turn:session-1:1', kind: 'turn', quantity: 1 }])
  })

  it('keeps a report the API did not take and resends it under the same id', async () => {
    let attempt = 0
    const calls = api(() => {
      attempt += 1
      if (attempt === 1) return { throws: new Error('offline') }
      if (attempt === 2) return { throws: 'reset' }
      if (attempt === 3) return { status: 503 }
      return { status: 200, body: { funded: true } }
    })
    const { usage } = await setup()
    usage('alice', 1)

    for (let i = 0; i < 4; i++) await vi.advanceTimersByTimeAsync(60_000)

    expect(calls).toHaveLength(4)
    expect(new Set(calls.map(call => JSON.stringify(charges(call)))).size).toBe(1)
  })

  it('drops a batch the API refuses as malformed and sends the rest', async () => {
    let posts = 0
    const calls = api(call => (call.method === 'POST' && posts++ === 0 ? { status: 400, body: 'bad' } : { status: 200, body: { funded: true } }))
    const { request } = await setup()
    for (let turn = 1; turn <= 101; turn++) await request('alice', 'byok', 1, turn)

    await vi.advanceTimersByTimeAsync(60_000)

    expect(calls.filter(call => call.method === 'POST').map(call => charges(call).length)).toEqual([100, 1])
  })

  it('waits for a token before sending, and drops the oldest reports beyond its limit', async () => {
    const calls = api(() => ({ status: 200, body: { funded: true } }))
    const auth: { token?: string } = {}
    const tokens = () => Promise.resolve(auth.token === undefined ? undefined : { value: auth.token })
    const { ctx, request } = await setup({ maxQueuedPerOwner: 2 }, tokens)
    const warnings = logLines(ctx, 'warn')
    for (let turn = 1; turn <= 3; turn++) await request('alice', 'byok', 1, turn)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(calls).toHaveLength(0)

    auth.token = 'later'
    await vi.advanceTimersByTimeAsync(60_000)
    expect(charges(calls[0] as Call)).toEqual([
      expect.objectContaining({ id: 'turn:session-1:2' }),
      expect.objectContaining({ id: 'turn:session-1:3' }),
    ])
    expect(warnings.some(line => line.includes('dropped the oldest cloud usage reports of alice'))).toBe(true)
  })

  it('reads a failing credential store as no token', async () => {
    const calls = api(() => ({ status: 200, body: { funded: true } }))
    const { usage, admit } = await setup({}, () => Promise.reject(new Error('locked')))
    usage('alice', 1)
    expect(admit('alice')).toBeUndefined()

    await vi.advanceTimersByTimeAsync(60_000)
    expect(calls).toHaveLength(0)
  })

  it('sends what is queued when it stops, and one send at a time', async () => {
    let release: () => void = () => {}
    const calls = api(() => ({ status: 200, body: { funded: true } }))
    vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit) => {
      calls.push({ url, method: init.method ?? 'GET', authorization: undefined, body: JSON.parse(init.body as string) as unknown })
      return new Promise<Response>((resolve) => { release = () => { resolve(new Response('{"funded":true}')) } })
    }))
    const { fiber, usage } = await setup({ flushIntervalMs: 1000 })
    usage('alice', 1)
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(1000)
    expect(calls).toHaveLength(1)
    release()
    await vi.advanceTimersByTimeAsync(0)

    usage('alice', 2)
    await fiber.dispose()
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toHaveLength(2)
  })
})

describe('cloud-meter defaults', () => {
  it('bills no turn on the provider llm-aeven registers, by its own name', () => {
    expect(cloudMeter.Config({ apiUrl: 'https://api.test' }).billedProviders).toEqual([AEVEN_PROVIDER])
    expect(AEVEN_PROVIDER).toBe('aeven-cloud')
  })
})

describe('cloud-meter shutdown', () => {
  it('sends its last reports when the credential store stops first, as on Host shutdown', async () => {
    const calls = api(() => ({ status: 200, body: { funded: true } }))
    const ctx = new Context()
    const store = ctx.plugin({
      name: 'credentials-under-test',
      apply: (inner: Context) => {
        inner.provide('credentials', { resolve: () => Promise.resolve({ value: 'token-alice' }) })
      },
    })
    await store
    await ctx.plugin(cloudMeter, { apiUrl: 'https://api.test' })
    ;(ctx.emit as unknown as (name: string, payload: unknown) => void)('sandbox-jail/usage', { account: 'alice', cpuSeconds: 1 })

    // Stopping the store stops the meter, which injects it; the meter's last send must still read a token.
    await store.dispose()
    await vi.advanceTimersByTimeAsync(0)

    expect(calls.map(call => call.authorization)).toEqual(['Bearer token-alice'])
  })

  it('logs a send that throws instead of rejecting the flush', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ status: 200, ok: true, json: () => Promise.reject(new Error('bad json')) })))
    const { ctx, fiber, usage } = await setup()
    const warnings = logLines(ctx, 'warn')
    usage('alice', 1)

    await fiber.dispose()
    await vi.advanceTimersByTimeAsync(0)

    expect(warnings.some(line => line.includes('cannot report cloud usage of alice: bad json'))).toBe(true)
  })

  it('reads a store that throws while resolving as no token', async () => {
    const calls = api(() => ({ status: 200, body: { funded: true } }))
    const { usage } = await setup({}, () => { throw new Error('stopped') })
    usage('alice', 1)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(calls).toHaveLength(0)
  })
})

describe('cloud-meter funding gate', () => {
  it('refuses jailed commands and unbilled turns once the API reports the owner unfunded', async () => {
    api(() => ({ status: 200, body: { funded: false } }))
    const { admit, request } = await setup()

    expect(admit('alice')).toBeUndefined()
    await vi.advanceTimersByTimeAsync(0)
    expect(admit('alice')).toMatch(/credit is used up/u)
    await expect(request('alice', 'byok')).rejects.toThrow(/credit is used up/u)
    expect(await request('alice', AEVEN_PROVIDER)).toEqual({ provider: AEVEN_PROVIDER, model: 'm' })
  })

  it('takes the funding answer from a send, and caches a quote for quoteTtlMs', async () => {
    const calls = api(call => (call.method === 'GET' ? { status: 200, body: { funded: true } } : { status: 200, body: { funded: false } }))
    const { admit, usage, request } = await setup({ quoteTtlMs: 120_000 })
    await request('alice', 'byok')
    await request('alice', 'byok', 1, 2)
    expect(calls.filter(call => call.method === 'GET')).toHaveLength(1)

    usage('alice', 1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(admit('alice')).toMatch(/credit is used up/u)
  })

  it('shares one quote between concurrent asks', async () => {
    const calls = api(() => ({ status: 200, body: { funded: true } }))
    const { request } = await setup()

    await Promise.all([request('alice', 'byok', 1, 1), request('alice', 'byok', 1, 2)])
    expect(calls.filter(call => call.method === 'GET')).toHaveLength(1)
  })

  it.each([
    ['an error answer', { status: 500 }],
    ['a network error', { throws: new Error('offline') }],
    ['a thrown string', { throws: 'offline' }],
  ])('admits work when the quote fails with %s, keeping the last answer it had', async (_name, failure) => {
    let fail = false
    api(call => (fail && call.method === 'GET' ? failure : { status: 200, body: { funded: false } }))
    const { request } = await setup({ quoteTtlMs: 1000 })
    const owner = 'bob'

    fail = true
    expect(await request('alice', 'byok')).toEqual({ provider: 'byok', model: 'm' })

    fail = false
    await expect(request(owner, 'byok')).rejects.toThrow()
    fail = true
    vi.advanceTimersByTime(2000)
    await expect(request(owner, 'byok', 1, 2)).rejects.toThrow()
  })

  it('admits an owner without a token without asking the API', async () => {
    const calls = api(() => ({ status: 200, body: { funded: false } }))
    const { request } = await setup()

    expect(await request('carol', 'byok')).toEqual({ provider: 'byok', model: 'm' })
    expect(calls).toHaveLength(0)
  })
})

describe('cloud-meter storage', () => {
  /** A `du` stand-in on PATH: KiB per owner folder name, or a failure for `fail`. */
  function fakeDu() {
    const bin = mkdtempSync(join(tmpdir(), 'avn-fake-du-'))
    writeFileSync(join(bin, 'du'), [
      '#!/bin/sh',
      'case "$2" in',
      '  */alice) printf "12\\t%s\\n" "$2" ;;',
      '  */empty) printf "0\\t%s\\n" "$2" ;;',
      '  *) echo "du: cannot read" >&2; exit 1 ;;',
      'esac',
      '',
    ].join('\n'), { mode: 0o755 })
    vi.stubEnv('PATH', `${bin}${delimiter}${process.env.PATH ?? ''}`)
  }

  it('measures each owner folder a minute after start and every interval after, queueing one report per day', async () => {
    fakeDu()
    const root = mkdtempSync(join(tmpdir(), 'avn-accounts-'))
    for (const name of ['alice', 'empty', 'bob', 'not a segment']) mkdirSync(join(root, name))
    let funded = false
    const calls = api(() => (funded ? { status: 200, body: { funded: true } } : { status: 503 }))
    vi.setSystemTime(new Date('2026-11-11T08:00:00Z'))
    const { fiber } = await setup({ accountsRoot: root, flushIntervalMs: 1000, storageIntervalMs: 60_000 })

    // Two measurements of the same day while the API is down, then a send once it answers.
    await vi.advanceTimersByTimeAsync(60_000)
    await vi.waitFor(() => { expect(calls.length).toBeGreaterThan(0) }, { timeout: 10_000, interval: 50 })
    await vi.advanceTimersByTimeAsync(60_000)
    const before = calls.length
    await vi.waitFor(() => { expect(calls.length).toBeGreaterThan(before) }, { timeout: 10_000, interval: 50 })
    funded = true
    await vi.advanceTimersByTimeAsync(1000)

    expect(charges(calls.at(-1) as Call)).toEqual([{ id: 'storage:2026-11-11', kind: 'storage', day: '2026-11-11', quantity: 12 * 1024 }])
    await fiber.dispose()
  })

  it('warns when the accounts folder cannot be listed, and stops cleanly before its first measurement', async () => {
    api(() => ({ status: 200, body: { funded: true } }))
    const first = await setup({ accountsRoot: join(tmpdir(), 'avn-missing-accounts-root') })
    await first.fiber.dispose()

    const { ctx, fiber } = await setup({ accountsRoot: join(tmpdir(), 'avn-missing-accounts-root') })
    const warnings = logLines(ctx, 'warn')
    await vi.advanceTimersByTimeAsync(60_000)
    await vi.waitFor(() => { expect(warnings.some(message => message.includes('cannot list account folders'))).toBe(true) })
    await fiber.dispose()
  })
})
