import { EventEmitter } from 'node:events'
import { createServer, request as httpRequest, type IncomingMessage } from 'node:http'
import { connect, createServer as createTcpServer, type AddressInfo, type Server as TcpServer, type Socket } from 'node:net'
import { networkInterfaces } from 'node:os'
import { fetch as undiciFetch } from 'undici'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BAD_PROXY_RETRY_MS,
  SystemProxyDispatcher,
  installSystemProxy,
  ipcProxyLookup,
  isLoopbackHostname,
  isProxyAnswer,
  isUnreachable,
  type ProxyLookup,
  type ProxyRoute,
} from '../src/system-proxy.ts'

const closers: (() => Promise<void>)[] = []

/** A non-internal IPv4 address of this machine, when it has one. */
const lanAddress = Object.values(networkInterfaces()).flat()
  .find(address => address !== undefined && address.family === 'IPv4' && !address.internal)?.address

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close()
})

async function listen(server: TcpServer, port = 0): Promise<number> {
  await new Promise<void>((resolve) => { server.listen(port, '127.0.0.1', resolve) })
  const sockets = new Set<Socket>()
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.once('close', () => { sockets.delete(socket) })
  })
  closers.push(async () => {
    for (const socket of sockets) socket.destroy()
    if (!server.listening) return
    await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
  })
  return (server.address() as AddressInfo).port
}

/** Origin server that answers with the Host header it received. */
async function startTarget(): Promise<number> {
  return await listen(createServer((request, response) => {
    response.end(`target saw ${request.headers.host ?? ''}`)
  }))
}

interface TestProxy {
  readonly url: string
  readonly port: number
  /** Each `host:port` the proxy was asked for, in order. */
  readonly seen: string[]
  stop(): Promise<void>
}

/**
 * Forward proxy that sends every destination to the target port and records each `host:port` it was asked for.
 * It serves both proxy forms: absolute-form requests, which undici uses for `http:` destinations, and CONNECT
 * tunnels, which it uses for `https:` ones.
 */
async function startProxy(targetPort: number, port = 0): Promise<TestProxy> {
  const seen: string[] = []
  const server = createServer((request, response) => {
    const destination = new URL(request.url ?? '')
    seen.push(`${destination.hostname}:${destination.port === '' ? '80' : destination.port}`)
    const upstream = httpRequest({
      host: '127.0.0.1',
      port: targetPort,
      method: request.method,
      path: destination.pathname + destination.search,
      headers: request.headers,
    }, (answer) => {
      response.writeHead(answer.statusCode ?? 502, answer.headers)
      answer.pipe(response)
    })
    upstream.on('error', () => { response.destroy() })
    request.pipe(upstream)
  })
  server.on('connect', (request: IncomingMessage, client: Socket, head: Buffer) => {
    seen.push(request.url ?? '')
    const upstream = connect(targetPort, '127.0.0.1', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length > 0) upstream.write(head)
      upstream.pipe(client)
      client.pipe(upstream)
    })
    upstream.on('error', () => { client.destroy() })
    client.on('error', () => { upstream.destroy() })
  })
  const bound = await listen(server, port)
  return {
    url: `http://127.0.0.1:${String(bound)}`,
    port: bound,
    seen,
    stop: () => new Promise<void>((resolve) => {
      server.closeAllConnections()
      server.close(() => { resolve() })
    }),
  }
}

interface TestSocks5 {
  readonly url: string
  /** Each destination as `type host:port`, where `type` is the SOCKS5 address type the client sent. */
  readonly seen: string[]
}

/**
 * SOCKS5 server (RFC 1928, no authentication) that tunnels every CONNECT to the target port and records the
 * address the client asked for. With `reply` other than 0 it answers every CONNECT with that failure code.
 */
async function startSocks5(targetPort: number, reply = 0): Promise<TestSocks5> {
  const seen: string[] = []
  const server = createTcpServer((client) => {
    client.on('error', () => { client.destroy() })
    client.once('data', (greeting: Buffer) => {
      // VER 5, then the client's method list; select "no authentication required".
      if (greeting[0] !== 5) return client.destroy()
      client.write(Buffer.from([5, 0]))
      client.once('data', (request: Buffer) => {
        const type = request[3]
        let host: string
        let offset: number
        if (type === 1) {
          host = [...request.subarray(4, 8)].join('.')
          offset = 8
        } else if (type === 3) {
          const length = request[4] ?? 0
          host = request.subarray(5, 5 + length).toString('utf8')
          offset = 5 + length
        } else {
          host = request.subarray(4, 20).toString('hex')
          offset = 20
        }
        seen.push(`${type === 3 ? 'domain' : type === 1 ? 'ipv4' : 'ipv6'} ${host}:${String(request.readUInt16BE(offset))}`)
        if (reply !== 0) {
          client.end(Buffer.from([5, reply, 0, 1, 0, 0, 0, 0, 0, 0]))
          return
        }
        const upstream = connect(targetPort, '127.0.0.1', () => {
          client.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]))
          upstream.pipe(client)
          client.pipe(upstream)
        })
        upstream.on('error', () => { client.destroy() })
      })
    })
  })
  const port = await listen(server)
  return { url: `socks5://127.0.0.1:${String(port)}`, seen }
}

/** A loopback port with nothing listening, so connecting to it is refused. */
async function closedPort(): Promise<number> {
  const server = createServer()
  const port = await listen(server)
  await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
  return port
}

function dispatcherFor(lookup: ProxyLookup, now?: () => number): SystemProxyDispatcher {
  const dispatcher = new SystemProxyDispatcher(lookup, now)
  closers.push(() => dispatcher.destroy())
  return dispatcher
}

function answering(...answers: (readonly ProxyRoute[])[]): ProxyLookup {
  return () => Promise.resolve(answers.length > 1 ? answers.shift() ?? [null] : answers[0] ?? [null])
}

async function textVia(dispatcher: SystemProxyDispatcher, url: string): Promise<string> {
  return await (await undiciFetch(url, { dispatcher })).text()
}

/** In-process stand-in for the Host's IPC channel with the shell. */
class FakeChannel extends EventEmitter {
  connected = true
  readonly sent: unknown[] = []
  sendError: Error | null = null
  send(message: unknown, _handle: unknown, _options: unknown, callback: (error: Error | null) => void): boolean {
    this.sent.push(message)
    queueMicrotask(() => { callback(this.sendError) })
    return true
  }
}

function channelLookup(channel: FakeChannel): ReturnType<typeof ipcProxyLookup> {
  const created = ipcProxyLookup(channel as unknown as NodeJS.Process)
  closers.push(() => {
    created.dispose()
    return Promise.resolve()
  })
  return created
}

describe('system proxy routing', () => {
  it('recognises loopback hostnames and nothing else', () => {
    for (const host of ['localhost', 'LOCALHOST', 'app.localhost', '127.0.0.1', '127.8.9.10', '[::1]', '[::ffff:127.0.0.1]']) {
      expect(isLoopbackHostname(host), host).toBe(true)
    }
    for (const host of ['aeven.io', 'localhost.example.com', '10.0.0.1', '128.0.0.1', '[::2]', '[2001:db8::1]', '192.168.1.127']) {
      expect(isLoopbackHostname(host), host).toBe(false)
    }
  })

  it('accepts only well-formed answers with at least one route and a direct route only last', () => {
    expect(isProxyAnswer({ type: 'proxy', id: 1, routes: [null] })).toBe(true)
    expect(isProxyAnswer({ type: 'proxy', id: 2, routes: ['http://proxy.corp:8080'] })).toBe(true)
    expect(isProxyAnswer({ type: 'proxy', id: 3, routes: ['https://proxy.corp', 'http://backup:3128', null] })).toBe(true)
    expect(isProxyAnswer({ type: 'proxy', id: 4, routes: ['socks5://socks.corp:1080', null] })).toBe(true)
    for (const invalid of [
      null, 'proxy', { type: 'shutdown' }, { type: 'proxy', id: 0, routes: [null] }, { type: 'proxy', id: 1.5, routes: [null] },
      { type: 'proxy', id: 1 }, { type: 'proxy', id: 1, routes: [] }, { type: 'proxy', id: 1, routes: null },
      { type: 'proxy', id: 1, routes: ['socks4://proxy:1080'] }, { type: 'proxy', id: 1, routes: ['socks://proxy:1080'] },
      { type: 'proxy', id: 1, routes: ['not a url'] },
      { type: 'proxy', id: 1, routes: [null, 'http://after-direct:1'] }, { type: 'proxy', id: '1', routes: [null] },
    ]) expect(isProxyAnswer(invalid), JSON.stringify(invalid)).toBe(false)
  })

  it('moves on only for failures to connect, never for an aborted request', () => {
    const coded = (code: string, name = 'Error'): Error => Object.assign(new Error(code), { code, name })
    for (const code of ['ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT']) {
      expect(isUnreachable(coded(code)), code).toBe(true)
    }
    expect(isUnreachable(Object.assign(new Error('wrapped'), { cause: coded('ECONNREFUSED') }))).toBe(true)
    for (const code of ['ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET', 'UND_ERR_ABORTED', 'CERT_HAS_EXPIRED']) {
      expect(isUnreachable(coded(code)), code).toBe(false)
    }
    expect(isUnreachable(coded('ECONNREFUSED', 'AbortError'))).toBe(false)
    expect(isUnreachable(new Error('no code'))).toBe(false)
  })

  it('sends a request through the proxy the lookup names, asking with the request origin', async () => {
    const target = await startTarget()
    const proxy = await startProxy(target)
    const asked: string[] = []
    const dispatcher = dispatcherFor((url) => {
      asked.push(url)
      return Promise.resolve([proxy.url])
    })
    await expect(textVia(dispatcher, 'http://aeven.test/api/v1/models?x=1')).resolves.toBe('target saw aeven.test')
    expect(asked).toEqual(['http://aeven.test/'])
    expect(proxy.seen).toEqual(['aeven.test:80'])
  })

  it('decides the route per request, so a changed answer applies to the next request', async () => {
    const target = await startTarget()
    const office = await startProxy(target)
    const other = await startProxy(target)
    const dispatcher = dispatcherFor(answering([office.url], [other.url], [null]))
    await expect(textVia(dispatcher, 'http://aeven.test/one')).resolves.toBe('target saw aeven.test')
    await expect(textVia(dispatcher, 'http://aeven.test/two')).resolves.toBe('target saw aeven.test')
    expect(office.seen).toEqual(['aeven.test:80'])
    expect(other.seen).toEqual(['aeven.test:80'])
    // A direct route reaches DNS for the name itself, which `.invalid` never resolves; no proxy sees it.
    await expect(textVia(dispatcher, 'http://direct.invalid/three')).rejects.toThrow()
    expect(office.seen).toHaveLength(1)
    expect(other.seen).toHaveLength(1)
  })

  it('connects to loopback directly without asking', async () => {
    const target = await startTarget()
    let asked = 0
    const dispatcher = dispatcherFor(() => {
      asked += 1
      return Promise.resolve(['http://127.0.0.1:9'])
    })
    await expect(textVia(dispatcher, `http://127.0.0.1:${String(target)}/local`)).resolves.toBe(`target saw 127.0.0.1:${String(target)}`)
    expect(asked).toBe(0)
  })

  it('moves to the next route when a proxy cannot be reached, then puts that proxy last until its delay passes', async () => {
    const target = await startTarget()
    const deadPort = await closedPort()
    const dead = `http://127.0.0.1:${String(deadPort)}`
    const backup = await startProxy(target)
    let clock = 1_000
    const dispatcher = dispatcherFor(answering([dead, backup.url]), () => clock)
    await expect(textVia(dispatcher, 'http://aeven.test/first')).resolves.toBe('target saw aeven.test')
    expect(backup.seen).toEqual(['aeven.test:80'])

    // The dead proxy comes back on its port; inside the delay the request still goes to the backup first.
    const revived = await startProxy(target, deadPort)
    await expect(textVia(dispatcher, 'http://aeven.test/second')).resolves.toBe('target saw aeven.test')
    expect(revived.seen).toEqual([])
    expect(backup.seen).toHaveLength(2)

    clock += BAD_PROXY_RETRY_MS + 1
    await expect(textVia(dispatcher, 'http://aeven.test/third')).resolves.toBe('target saw aeven.test')
    expect(revived.seen).toEqual(['aeven.test:80'])
    expect(backup.seen).toHaveLength(2)
  })

  // DIRECT has to reach a non-loopback address, so the target listens on this machine's own LAN address.
  it.runIf(lanAddress !== undefined)('falls back from an unreachable PAC proxy to DIRECT, as a laptop away from the office does', async () => {
    const target = createServer((request, response) => { response.end(`direct to ${request.headers.host ?? ''}`) })
    await new Promise<void>((resolve) => { target.listen(0, lanAddress, resolve) })
    closers.push(() => new Promise<void>((resolve) => { target.close(() => { resolve() }) }))
    const origin = `http://${lanAddress ?? ''}:${String((target.address() as AddressInfo).port)}`
    const dead = `http://127.0.0.1:${String(await closedPort())}`
    const dispatcher = dispatcherFor(answering([dead, null]))
    await expect(textVia(dispatcher, `${origin}/`)).resolves.toBe(`direct to ${new URL(origin).host}`)
  })

  it('tries a proxy marked bad as the last resort, and reaching it clears the mark', async () => {
    const target = await startTarget()
    const deadPort = await closedPort()
    const proxyUrl = `http://127.0.0.1:${String(deadPort)}`
    const backup = await startProxy(target)
    const dispatcher = dispatcherFor(answering([proxyUrl, backup.url], [proxyUrl, null], [proxyUrl, null]))
    await expect(textVia(dispatcher, 'http://aeven.test/mark')).resolves.toBe('target saw aeven.test')

    // Now the proxy is up again but marked: DIRECT goes first, cannot resolve the name, and the marked proxy answers.
    const revived = await startProxy(target, deadPort)
    await expect(textVia(dispatcher, 'http://aeven.test/last-resort')).resolves.toBe('target saw aeven.test')
    expect(revived.seen).toEqual(['aeven.test:80'])
    // The mark is gone, so the proxy is first again.
    await expect(textVia(dispatcher, 'http://aeven.test/cleared')).resolves.toBe('target saw aeven.test')
    expect(revived.seen).toHaveLength(2)
  })

  it('keeps the request on a proxy that answers, even with a refusal', async () => {
    const refusing = createServer((_request, response) => {
      response.statusCode = 403
      response.end('blocked by policy')
    })
    const refusingUrl = `http://127.0.0.1:${String(await listen(refusing))}`
    const target = await startTarget()
    const backup = await startProxy(target)
    const dispatcher = dispatcherFor(answering([refusingUrl, backup.url]))
    const response = await undiciFetch('http://aeven.test/blocked', { dispatcher })
    expect(response.status).toBe(403)
    await expect(response.text()).resolves.toBe('blocked by policy')
    expect(backup.seen).toEqual([])
  })

  it('keeps the request on a proxy that resets the connection', async () => {
    const resetting = createServer()
    resetting.on('connection', (socket) => { socket.resetAndDestroy() })
    const resettingUrl = `http://127.0.0.1:${String(await listen(resetting))}`
    const target = await startTarget()
    const backup = await startProxy(target)
    const dispatcher = dispatcherFor(answering([resettingUrl, backup.url]))
    await expect(undiciFetch('http://aeven.test/reset', { dispatcher })).rejects.toThrow()
    expect(backup.seen).toEqual([])
  })

  it('carries a request body unchanged through a fallback', async () => {
    const echo = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => { chunks.push(chunk) })
      request.on('end', () => { response.end(`echo ${Buffer.concat(chunks).toString('utf8')}`) })
    })
    const echoPort = await listen(echo)
    const dead = `http://127.0.0.1:${String(await closedPort())}`
    const backup = await startProxy(echoPort)
    const dispatcher = dispatcherFor(answering([dead, backup.url]))
    const body = 'x'.repeat(256 * 1024)
    const response = await undiciFetch('http://aeven.test/upload', { dispatcher, method: 'POST', body })
    await expect(response.text()).resolves.toBe(`echo ${body}`)
  })

  it('sends a request through a SOCKS5 proxy, leaving the hostname for the proxy to resolve', async () => {
    const target = await startTarget()
    const socks = await startSocks5(target)
    const dispatcher = dispatcherFor(answering([socks.url]))
    await expect(textVia(dispatcher, 'http://aeven.test/socks')).resolves.toBe('target saw aeven.test')
    await expect(textVia(dispatcher, 'http://other.test:8080/socks')).resolves.toBe('target saw other.test:8080')
    expect(socks.seen).toEqual(['domain aeven.test:80', 'domain other.test:8080'])
  })

  it('carries a request body through a SOCKS5 proxy', async () => {
    const echo = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => { chunks.push(chunk) })
      request.on('end', () => { response.end(`echo ${String(Buffer.concat(chunks).byteLength)}`) })
    })
    const socks = await startSocks5(await listen(echo))
    const dispatcher = dispatcherFor(answering([socks.url]))
    const response = await undiciFetch('http://aeven.test/upload', { dispatcher, method: 'POST', body: Buffer.alloc(512 * 1024, 7) })
    await expect(response.text()).resolves.toBe(`echo ${String(512 * 1024)}`)
  })

  it('moves past a SOCKS5 proxy that cannot be reached', async () => {
    const target = await startTarget()
    const backup = await startProxy(target)
    const dispatcher = dispatcherFor(answering([`socks5://127.0.0.1:${String(await closedPort())}`, backup.url]))
    await expect(textVia(dispatcher, 'http://aeven.test/socks-down')).resolves.toBe('target saw aeven.test')
    expect(backup.seen).toEqual(['aeven.test:80'])
  })

  it('moves from an HTTP proxy that cannot be reached to a SOCKS5 one', async () => {
    const target = await startTarget()
    const socks = await startSocks5(target)
    const dispatcher = dispatcherFor(answering([`http://127.0.0.1:${String(await closedPort())}`, socks.url, null]))
    await expect(textVia(dispatcher, 'http://aeven.test/to-socks')).resolves.toBe('target saw aeven.test')
    expect(socks.seen).toEqual(['domain aeven.test:80'])
  })

  it('keeps the request on a SOCKS5 proxy that answers with a failure', async () => {
    const target = await startTarget()
    const refusing = await startSocks5(target, 5)
    const backup = await startProxy(target)
    const dispatcher = dispatcherFor(answering([refusing.url, backup.url]))
    await expect(undiciFetch('http://aeven.test/refused', { dispatcher })).rejects.toThrow()
    expect(refusing.seen).toEqual(['domain aeven.test:80'])
    expect(backup.seen).toEqual([])
  })

  it('routes the built-in global fetch through a SOCKS5 proxy', async () => {
    const target = await startTarget()
    const socks = await startSocks5(target)
    const dispose = installSystemProxy(() => Promise.resolve([socks.url]))
    try {
      await expect((await fetch('http://aeven.test/global-socks', { method: 'POST', body: 'payload' })).text())
        .resolves.toBe('target saw aeven.test')
    } finally {
      await dispose()
    }
    expect(socks.seen).toEqual(['domain aeven.test:80'])
  })

  // Node's built-in `fetch`, which every Host plugin calls, reaches the dispatcher only through the global slot.
  it('routes the built-in global fetch while installed and restores the previous dispatcher', async () => {
    const target = await startTarget()
    const proxy = await startProxy(target)
    const dispose = installSystemProxy(() => Promise.resolve([proxy.url]))
    try {
      await expect((await fetch('http://aeven.test/global')).text()).resolves.toBe('target saw aeven.test')
    } finally {
      await dispose()
    }
    expect(proxy.seen).toEqual(['aeven.test:80'])
    await expect(fetch('http://aeven.test/after')).rejects.toThrow()
    expect(proxy.seen).toHaveLength(1)
  })

  it('falls back for the built-in global fetch too', async () => {
    const target = await startTarget()
    const dead = `http://127.0.0.1:${String(await closedPort())}`
    const backup = await startProxy(target)
    const dispose = installSystemProxy(() => Promise.resolve([dead, backup.url]))
    try {
      await expect((await fetch('http://aeven.test/global-fallback', { method: 'POST', body: 'payload' })).text())
        .resolves.toBe('target saw aeven.test')
    } finally {
      await dispose()
    }
    expect(backup.seen).toEqual(['aeven.test:80'])
  })

  it('asks the shell over IPC and settles each question by its id', async () => {
    const channel = new FakeChannel()
    const { lookup } = channelLookup(channel)
    const first = lookup('https://aeven.io/')
    const second = lookup('https://api.example/')
    expect(channel.sent).toEqual([
      { type: 'resolveProxy', id: 1, url: 'https://aeven.io/' },
      { type: 'resolveProxy', id: 2, url: 'https://api.example/' },
    ])
    channel.emit('message', { type: 'proxy', id: 2, routes: [null] })
    channel.emit('message', { type: 'proxy', id: 1, routes: ['http://proxy.corp:8080', null] })
    await expect(first).resolves.toEqual(['http://proxy.corp:8080', null])
    await expect(second).resolves.toEqual([null])
  })

  it('ignores malformed and unknown answers', async () => {
    const channel = new FakeChannel()
    const { lookup } = channelLookup(channel)
    const pending = lookup('https://aeven.io/')
    channel.emit('message', { type: 'proxy', id: 1, routes: ['socks4://proxy:1080'] })
    channel.emit('message', { type: 'proxy', id: 99, routes: ['http://wrong:1'] })
    channel.emit('message', { type: 'shutdown' })
    channel.emit('message', { type: 'proxy', id: 1, routes: ['http://proxy.corp:3128'] })
    await expect(pending).resolves.toEqual(['http://proxy.corp:3128'])
  })

  it('connects directly while the channel is closed, when sending fails, and for questions open at disconnect', async () => {
    const channel = new FakeChannel()
    const { lookup } = channelLookup(channel)
    const open = lookup('https://aeven.io/')
    channel.connected = false
    channel.emit('disconnect')
    await expect(open).resolves.toEqual([null])
    await expect(lookup('https://aeven.io/')).resolves.toEqual([null])
    expect(channel.sent).toHaveLength(1)

    const failing = new FakeChannel()
    failing.sendError = new Error('channel closed')
    await expect(channelLookup(failing).lookup('https://aeven.io/')).resolves.toEqual([null])
  })
})
