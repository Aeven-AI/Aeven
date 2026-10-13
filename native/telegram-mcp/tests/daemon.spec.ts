/** The daemon's HTTP surface: the token gate, the account control routes, and the tool list it serves. */

import { randomBytes } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, describe, expect, it } from 'vitest'
import { startDaemon, type DaemonHandle } from '../aeven/daemon.ts'
import { createTelegramServer } from '../aeven/server.ts'
import { TELEGRAM_AEVEN_TOOLS as AEVEN_TOOLS, TELEGRAM_READ_TOOLS } from '../aeven/tools.ts'
import { FakeLogin } from './fake-login.ts'

const me = { id: '42', name: 'Olivier', username: 'olivier', phone: '31612345678' }

/** The tools upstream ships, before the Aeven-owned moderation and administration tools. */
const UPSTREAM_TOOLS = 33

/** A daemon serving the real tool list over a fake sign-in. */
async function serve(): Promise<{ daemon: DaemonHandle, login: FakeLogin, token: string }> {
  const login = new FakeLogin()
  const token = randomBytes(32).toString('hex')
  const daemon = await startDaemon({ token, login, server: createTelegramServer })
  return { daemon, login, token }
}

function call(daemon: DaemonHandle, token: string | undefined, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`http://${daemon.address}${path}`, {
    ...init,
    headers: { ...init.headers, ...token === undefined ? {} : { Authorization: `Bearer ${token}` } },
  })
}

function post(token: string | undefined, daemon: DaemonHandle, path: string, body: unknown): Promise<Response> {
  return call(daemon, token, path, { method: 'POST', body: JSON.stringify(body) })
}

const running: DaemonHandle[] = []

afterEach(async () => {
  await Promise.all(running.splice(0).map(async daemon => { await daemon.close() }))
})

describe('telegram daemon', () => {
  it('refuses every route without the bearer token', async () => {
    const { daemon, token } = await serve()
    running.push(daemon)

    expect((await call(daemon, undefined, '/status')).status).toBe(401)
    expect((await call(daemon, 'a-wrong-token-of-the-same-length-0000000000000000000000000000000000000000', '/status')).status).toBe(401)
    expect((await call(daemon, undefined, '/logout', { method: 'POST' })).status).toBe(401)
    expect((await post(undefined, daemon, '/login/start', { phone: '31612345678' })).status).toBe(401)
    expect((await post(undefined, daemon, '/mcp', {})).status).toBe(401)
    expect(token).toHaveLength(64)
  })

  it('drives phone, code, password, and stop on the control routes', async () => {
    const { daemon, login, token } = await serve()
    running.push(daemon)

    expect(await (await call(daemon, token, '/status')).json()).toEqual({ state: 'login' })

    const missing = await post(token, daemon, '/login/start', {})
    expect(missing.status).toBe(400)
    expect(await missing.json()).toEqual({ error: 'phone-required' })
    expect(login.phones).toEqual([])

    // A number Telegram would not accept stops here rather than at Telegram.
    expect(await (await post(token, daemon, '/login/start', { phone: '+31 612345678' })).json())
      .toEqual({ state: 'failed', reason: 'phone-invalid' })
    expect(login.phones).toEqual([])

    expect(await (await post(token, daemon, '/login/start', { phone: '31612345678' })).json()).toEqual({ state: 'code', phone: '31612345678' })
    expect(login.phones).toEqual(['31612345678'])

    expect(await (await post(token, daemon, '/login/code', { code: '12345' })).json()).toEqual({ state: 'code', phone: '31612345678' })
    expect(login.codes).toEqual(['12345'])

    login.handlers!.passwordRequired()
    expect(await (await post(token, daemon, '/login/password', { password: 'hunter2' })).json()).toEqual({ state: 'password', phone: '31612345678' })
    expect(login.passwords).toEqual(['hunter2'])

    login.handlers!.authorized(me)
    expect(await (await call(daemon, token, '/status')).json()).toEqual({ state: 'authorized', phone: '31612345678', identity: me })
    // The identity this process obtained answers without asking Telegram again.
    expect(login.verified).toEqual([false])

    login.answered({ kind: 'identity', identity: me })
    expect(await (await call(daemon, token, '/status?verify=1')).json()).toEqual({ state: 'authorized', phone: '31612345678', identity: me })
    expect(login.verified).toEqual([false, true])

    expect(await (await post(token, daemon, '/logout', {})).json()).toEqual({ state: 'login' })
    expect(login.loggedOut).toBe(true)
  })

  it('requires the field each control route carries', async () => {
    const { daemon, token } = await serve()
    running.push(daemon)

    expect(await (await post(token, daemon, '/login/code', {})).json()).toEqual({ error: 'code-required' })
    expect(await (await post(token, daemon, '/login/password', {})).json()).toEqual({ error: 'password-required' })
  })

  it('rejects unknown routes, wrong methods, and oversized bodies', async () => {
    const { daemon, token } = await serve()
    running.push(daemon)

    expect((await call(daemon, token, '/nope')).status).toBe(404)
    expect((await call(daemon, token, '/login/start')).status).toBe(405)
    expect((await call(daemon, token, '/status', { method: 'POST' })).status).toBe(405)
    const oversized = await post(token, daemon, '/login/start', { phone: 'x'.repeat(70_000) })
    expect(oversized.status).toBe(413)
  })

  it('serves the tool list, with the read-only tools marked', async () => {
    const { daemon, token } = await serve()
    running.push(daemon)

    const client = new Client({ name: 'telegram-daemon-spec', version: '1.0.0' })
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://${daemon.address}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }))
      const { tools } = await client.listTools()
      expect(tools).toHaveLength(UPSTREAM_TOOLS + AEVEN_TOOLS.length)
      for (const name of [...TELEGRAM_READ_TOOLS, ...AEVEN_TOOLS]) {
        expect(tools.map(tool => tool.name)).toContain(name)
      }
      expect(tools.filter(tool => tool.annotations?.readOnlyHint === true).map(tool => tool.name).sort())
        .toEqual([...TELEGRAM_READ_TOOLS].sort())
    } finally {
      await client.close()
    }
  })
})
