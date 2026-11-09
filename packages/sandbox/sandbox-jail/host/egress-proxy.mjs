/**
 * The egress proxy of the sandbox jail: the one process through which jailed commands reach the network.
 *
 * The sandbox-jail provider starts it outside every jail, in its own cgroup. Its standard input carries one JSON
 * document per line: first the configuration, then the provider's answers; its standard output carries its
 * questions to the provider, one JSON document per line. It ends when standard input closes. It listens on a Unix
 * socket that every jail mounts; `egress-relay.c` inside a jail copies the command's loopback connections to it.
 *
 * Each connection opens with `AEVEN <account> <session> <token>\n`, where the token is the hex HMAC-SHA256 of
 * `<account> <session>` under `secret`, and continues as HTTP/1.1 with one of two kinds of request:
 *
 *   - `CONNECT <host>:<port>`: after `200`, bytes are copied both ways. A tunnel opens only to a host name on
 *     `allow` and a port in `ports`.
 *   - `GET|POST /git/<host>/<owner>/<repository>/…`: Git's smart HTTP requests, forwarded to `https://<host>/` for a
 *     host in `gitHosts`. The proxy asks the provider for the account's credential for that host and sends it
 *     upstream, so the credential never enters a jail. Before forwarding a push it reads the ref updates; one that
 *     creates, moves, or deletes anything but a branch, or deletes a branch, is forwarded only after the provider
 *     reports the user's approval.
 *
 * Either way the proxy resolves the name itself and connects only to an address that is not loopback, private,
 * link-local, or otherwise internal, so a name cannot point a jail at this machine's own services. Every refusal is
 * an HTTP response whose body names the reason.
 *
 * Each account is bounded in open requests, bytes per second, and bytes per UTC day; all accounts together are
 * bounded in requests and bytes per second. Counters live in this process and start over when it restarts.
 *
 * Questions: `{ id, type: 'git-token', account, host }` answered `{ id, token? }`;
 * `{ id, type: 'git-approve', account, session, host, repository, updates }` answered `{ id, approved }`;
 * `{ id, type: 'cancel' }` withdraws a question whose request ended and has no answer.
 *
 * Run: node egress-proxy.mjs   (configuration and answers on standard input)
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { chmodSync, rmSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { createInterface } from 'node:readline'

/**
 * @typedef {object} Config
 * @property {string} socket - path of the Unix socket to listen on.
 * @property {string} secret - hex key of the connection tokens.
 * @property {string[]} allow - host names a tunnel may reach, or `*.suffix` for every name beneath one.
 * @property {number[]} ports - destination ports a tunnel may open.
 * @property {string[]} gitHosts - hosts whose Git requests are forwarded with the account's credential.
 * @property {number} accountConnections - open requests per account.
 * @property {number} connections - open requests in all.
 * @property {number} accountBytesPerSecond - bytes per second per account, both directions together.
 * @property {number} bytesPerSecond - bytes per second for all accounts together.
 * @property {number} accountBytesPerDay - bytes per UTC day per account.
 * @property {number} connectTimeoutMs - time allowed to resolve and reach a destination.
 * @property {number} idleTimeoutMs - time a connection may carry nothing before it is closed.
 */

const TICK_MS = 100
const HELLO_LIMIT = 1024
/** A push's ref updates precede its pack; one that needs more than this is refused. */
const COMMANDS_LIMIT = 1024 * 1024
const LOG_LINES_PER_SECOND = 20
const RESOLVE_TTL_MS = 30_000
const TOKEN_TTL_MS = 60_000
const ZERO_OID = /^0+$/u

/** Addresses no connection may reach, whatever name resolved to them; an IPv4-mapped IPv6 address is checked as IPv4. */
const internal = new net.BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) internal.addSubnet(address, prefix, 'ipv4')
for (const [address, prefix] of [
  ['::', 127], ['64:ff9b::', 96], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
]) internal.addSubnet(address, prefix, 'ipv6')

let logged = 0
/** Write one stderr line, which the provider records; beyond the per-second budget lines are dropped. */
function log(message) {
  if (logged++ < LOG_LINES_PER_SECOND) process.stderr.write(`egress-proxy: ${message}\n`)
}

/** A byte budget refilled every tick, holding the streams it paused. */
class Bucket {
  /** @param {number} perSecond - bytes added per second; one second's worth is the most it holds. */
  constructor(perSecond) {
    this.perTick = perSecond * TICK_MS / 1000
    this.capacity = perSecond
    this.allowance = perSecond
    this.paused = new Set()
  }

  /** Charge bytes read from `source`, pausing it once the budget is spent. */
  spend(bytes, source) {
    this.allowance -= bytes
    if (this.allowance <= 0) hold(source, this.paused)
  }

  refill() {
    this.allowance = Math.min(this.capacity, this.allowance + this.perTick)
    if (this.allowance <= 0 || this.paused.size === 0) return
    const paused = [...this.paused]
    this.paused.clear()
    for (const source of paused) release(source)
  }
}

/** Pause a stream for one more reason; it resumes when every reason is released. */
function hold(source, set) {
  if (set?.has(source) === true) return
  set?.add(source)
  source.holds = (source.holds ?? 0) + 1
  source.pause()
}

function release(source) {
  source.holds -= 1
  if (source.holds === 0 && !source.destroyed) source.resume()
}

/** @type {Config} */
let config
let secret
let exact
let suffixes
let ports
let gitHosts
let total
/** @type {Map<string, { connections: number, bucket: Bucket }>} */
const accounts = new Map()
/** Bytes each account moved on `day`. */
const dayBytes = new Map()
let day = new Date().toISOString().slice(0, 10)
let connections = 0

/** Questions to the provider that await their answer, by id. */
const pending = new Map()
let nextId = 1

/**
 * Ask the provider one question.
 * @param {object} message - the question without its id.
 * @param {import('node:http').ServerResponse} response - the response it serves; when that closes first, the question is withdrawn.
 * @returns {Promise<object | undefined>} the answer, or undefined once withdrawn.
 */
function ask(message, response) {
  const id = nextId++
  return new Promise((resolve) => {
    const withdraw = () => {
      if (!pending.delete(id)) return
      process.stdout.write(`${JSON.stringify({ id, type: 'cancel' })}\n`)
      resolve(undefined)
    }
    pending.set(id, (answer) => {
      response.off('close', withdraw)
      resolve(answer)
    })
    response.once('close', withdraw)
    process.stdout.write(`${JSON.stringify({ id, ...message })}\n`)
  })
}

function allowed(host) {
  return exact.has(host) || suffixes.some(suffix => host.endsWith(suffix))
}

/** @type {Map<string, { expires: number, address: Promise<{ address: string, family: number } | undefined> }>} */
const resolved = new Map()

/**
 * The first address of `host` a connection may reach, or undefined when it has none or every one is internal.
 * Answers are kept for {@link RESOLVE_TTL_MS}, because a package manager opens many connections to one host at once.
 */
function resolve(host) {
  const now = Date.now()
  const known = resolved.get(host)
  if (known !== undefined && known.expires > now) return known.address
  const address = lookup(host, { all: true }).then(
    addresses => addresses.find(({ address, family }) => !internal.check(address, family === 6 ? 'ipv6' : 'ipv4')),
    // ENOTFOUND and resolver failures alike: the destination cannot be reached, and the client is told so.
    () => undefined,
  )
  if (resolved.size > 4096) resolved.clear()
  resolved.set(host, { expires: now + RESOLVE_TTL_MS, address })
  return address
}

/** `dns.lookup` for the upstream HTTPS agent, answering only with an address {@link resolve} accepts. */
function checkedLookup(host, options, callback) {
  void resolve(host).then((found) => {
    if (found === undefined) callback(Object.assign(new Error(`${host} did not resolve to a public address`), { code: 'ENOTFOUND' }))
    else if (options.all === true) callback(null, [found])
    else callback(null, found.address, found.family)
  })
}

/**
 * Count one more open request for an account.
 * @returns the account's state, or undefined when the account or the proxy is at its bound.
 */
function enter(name) {
  let account = accounts.get(name)
  if (account === undefined) {
    account = { connections: 0, bucket: new Bucket(config.accountBytesPerSecond) }
    accounts.set(name, account)
  }
  if (account.connections >= config.accountConnections || connections >= config.connections) return undefined
  account.connections += 1
  connections += 1
  return account
}

function leave(account) {
  account.connections -= 1
  connections -= 1
}

function overDay(name) {
  return (dayBytes.get(name) ?? 0) > config.accountBytesPerDay
}

/** Copy `source` to `sink`, charging the account, and pass on the end of the stream. */
function copy(source, sink, name, account) {
  source.on('data', (chunk) => {
    dayBytes.set(name, (dayBytes.get(name) ?? 0) + chunk.length)
    if (overDay(name)) {
      log(`${name} passed its daily byte limit`)
      source.destroy()
      sink.destroy()
      return
    }
    account.bucket.spend(chunk.length, source)
    total.spend(chunk.length, source)
    if (!sink.write(chunk)) {
      hold(source)
      sink.once('drain', () => { release(source) })
    }
  })
  source.on('end', () => { sink.end() })
}

const DAY_LIMIT = 'this account reached its daily network limit; it resets at 00:00 UTC'
const BUSY = 'too many open connections; retry when one has closed'

/** Answer a tunnel request the proxy does not serve and close the connection. */
function refuse(socket, status, reason) {
  const body = `aeven-egress: ${reason}\n`
  socket.end(`HTTP/1.1 ${status}\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`)
}

/** Answer an ordinary request the proxy does not serve. */
function deny(response, status, reason) {
  if (response.headersSent) {
    response.destroy()
    return
  }
  response.writeHead(status, { 'Content-Type': 'text/plain', Connection: 'close' })
  response.end(`aeven-egress: ${reason}\n`)
}

async function tunnel(request, client, head) {
  const { name } = client.identity
  const target = request.url ?? ''
  const separator = target.lastIndexOf(':')
  const host = target.slice(0, separator).toLowerCase()
  const port = Number(target.slice(separator + 1))
  if (net.isIP(host.replace(/^\[|\]$/gu, '')) !== 0 || !allowed(host) || !ports.has(port)) {
    log(`${name} refused ${target}`)
    refuse(client, '403 Forbidden', `${target} is not on the sandbox's allowed list`)
    return
  }
  if (overDay(name)) {
    refuse(client, '429 Too Many Requests', DAY_LIMIT)
    return
  }
  let account = enter(name)
  if (account === undefined) {
    refuse(client, '429 Too Many Requests', BUSY)
    return
  }
  let upstream
  const done = () => {
    client.destroy()
    upstream?.destroy()
    if (account !== undefined) leave(account)
    account = undefined
  }
  client.on('close', done)
  client.on('error', done)
  const address = await resolve(host)
  if (client.destroyed) return
  if (address === undefined) {
    refuse(client, '502 Bad Gateway', `${host} did not resolve to a public address`)
    return
  }
  upstream = net.connect({ host: address.address, port, family: address.family })
  let connected = false
  upstream.setTimeout(config.connectTimeoutMs, () => {
    if (connected) done()
    else refuse(client, '504 Gateway Timeout', `${host} did not answer`)
    upstream.destroy()
  })
  upstream.on('error', (error) => {
    if (connected) done()
    else refuse(client, '502 Bad Gateway', `${host}: ${error.code ?? 'connection failed'}`)
  })
  upstream.on('close', () => { if (connected) done() })
  upstream.once('connect', () => {
    connected = true
    upstream.setTimeout(config.idleTimeoutMs)
    client.setTimeout(config.idleTimeoutMs, done)
    client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    if (head.length > 0) upstream.write(head)
    copy(client, upstream, name, account)
    copy(upstream, client, name, account)
    client.resume()
  })
}

/**
 * Read the ref updates that open a push: pkt-lines of `<old> <new> <ref>` up to the first flush packet.
 * @returns the bytes read so far, which include the updates and may include the start of the pack, and the updates;
 * or a refusal reason.
 */
function readCommands(request) {
  return new Promise((resolve) => {
    let buffered = Buffer.alloc(0)
    let offset = 0
    const updates = []
    const finish = (result) => {
      request.off('data', onData)
      request.off('end', onEnd)
      request.pause()
      resolve(result)
    }
    const onEnd = () => { finish({ reason: 'the push ended before its ref updates did' }) }
    const onData = (chunk) => {
      buffered = Buffer.concat([buffered, chunk])
      while (buffered.length - offset >= 4) {
        const length = Number.parseInt(buffered.toString('latin1', offset, offset + 4), 16)
        if (length === 0) {
          finish({ buffered, updates })
          return
        }
        if (Number.isNaN(length) || length < 4) {
          finish({ reason: 'the push is not in Git\'s packet format' })
          return
        }
        if (buffered.length - offset < length) break
        const line = buffered.toString('utf8', offset + 4, offset + length).split('\0', 1)[0].trimEnd()
        offset += length
        if (line.startsWith('shallow ')) continue
        const [before, after, ref, ...rest] = line.split(' ')
        if (ref === undefined || rest.length > 0 || !/^[0-9a-f]{40,64}$/u.test(before) || !/^[0-9a-f]{40,64}$/u.test(after)) {
          finish({ reason: 'the push carries a command this sandbox does not forward' })
          return
        }
        updates.push({ ref, kind: ZERO_OID.test(after) ? 'delete' : ZERO_OID.test(before) ? 'create' : 'update' })
      }
      if (buffered.length > COMMANDS_LIMIT) finish({ reason: 'the push updates too many refs at once' })
    }
    request.on('data', onData)
    request.on('end', onEnd)
  })
}

/** Credentials the provider answered with, kept for {@link TOKEN_TTL_MS}. */
const tokens = new Map()

/** The account's credential for a host, undefined when it has none, or null when the response closed while asking. */
async function credential(name, host, response) {
  const key = `${name} ${host}`
  const known = tokens.get(key)
  if (known !== undefined && known.expires > Date.now()) return known.token
  const answer = await ask({ type: 'git-token', account: name, host }, response)
  if (answer === undefined) return null
  const token = typeof answer.token === 'string' && answer.token !== '' ? answer.token : undefined
  if (tokens.size > 4096) tokens.clear()
  tokens.set(key, { token, expires: Date.now() + TOKEN_TTL_MS })
  return token
}

const GIT_PATH = /^\/git\/([a-z0-9.-]+)(\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/(info\/refs\?service=git-(?:upload|receive)-pack|git-upload-pack|git-receive-pack))$/u
const FORWARDED_REQUEST_HEADERS = ['accept', 'accept-encoding', 'content-type', 'content-encoding', 'content-length', 'git-protocol', 'user-agent']
const FORWARDED_RESPONSE_HEADERS = ['content-type', 'content-encoding', 'cache-control', 'expires', 'pragma', 'www-authenticate']

let upstreamAgent

async function git(request, response) {
  const { name, session } = request.socket.identity
  const match = GIT_PATH.exec(request.url ?? '')
  const [, host, path, repository, endpoint] = match ?? []
  const reads = endpoint?.startsWith('info/refs') === true
  if (match === null || !gitHosts.has(host) || request.method !== (reads ? 'GET' : 'POST')) {
    deny(response, 403, 'only HTTPS requests to allowed hosts and Git requests to connected hosts leave the sandbox')
    return
  }
  if (overDay(name)) {
    deny(response, 429, DAY_LIMIT)
    return
  }
  const account = enter(name)
  if (account === undefined) {
    deny(response, 429, BUSY)
    return
  }
  let upstream
  response.once('close', () => {
    leave(account)
    upstream?.destroy()
  })
  let head = Buffer.alloc(0)
  if (endpoint === 'git-receive-pack') {
    if (request.headers['content-encoding'] !== undefined) {
      deny(response, 415, 'a compressed push cannot be checked; push without request compression')
      return
    }
    const commands = await readCommands(request)
    if (commands.reason !== undefined) {
      deny(response, 400, commands.reason)
      return
    }
    const gated = commands.updates.filter(update => update.kind === 'delete' || !update.ref.startsWith('refs/heads/'))
    if (gated.length > 0) {
      const answer = await ask({ type: 'git-approve', account: name, session, host, repository, updates: gated }, response)
      if (answer === undefined) return
      if (answer.approved !== true) {
        log(`${name} was not approved to push ${gated.map(update => update.ref).join(', ')} to ${repository}`)
        deny(response, 403, `the user did not approve pushing ${gated.map(update => `${update.kind} ${update.ref}`).join(', ')}`)
        return
      }
    }
    head = commands.buffered
  }
  const token = await credential(name, host, response)
  if (token === null) return
  const headers = { host }
  for (const header of FORWARDED_REQUEST_HEADERS) if (request.headers[header] !== undefined) headers[header] = request.headers[header]
  if (token !== undefined) headers.authorization = `Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`
  upstream = https.request({ host, port: 443, method: request.method, path, headers, agent: upstreamAgent, lookup: checkedLookup, timeout: config.idleTimeoutMs })
  upstream.on('timeout', () => { upstream.destroy(new Error('no answer')) })
  upstream.on('error', (error) => { deny(response, 502, `${host}: ${error.code ?? error.message}`) })
  upstream.on('response', (answer) => {
    const forwarded = {}
    for (const header of FORWARDED_RESPONSE_HEADERS) if (answer.headers[header] !== undefined) forwarded[header] = answer.headers[header]
    response.writeHead(answer.statusCode ?? 502, forwarded)
    copy(answer, response, name, account)
  })
  if (head.length > 0) upstream.write(head)
  copy(request, upstream, name, account)
  request.resume()
}

/** Read the identifying line, then let the HTTP server parse what follows on the same connection. */
function accept(web, client) {
  let buffered = Buffer.alloc(0)
  client.setTimeout(config.connectTimeoutMs, () => { client.destroy() })
  client.on('error', () => { client.destroy() })
  const onData = (chunk) => {
    buffered = Buffer.concat([buffered, chunk])
    const end = buffered.indexOf('\n')
    if (end < 0) {
      if (buffered.length > HELLO_LIMIT) client.destroy()
      return
    }
    client.off('data', onData)
    client.pause()
    const [word, name, session, token] = buffered.toString('latin1', 0, end).split(' ')
    const expected = createHmac('sha256', secret).update(`${name ?? ''} ${session ?? ''}`).digest()
    const given = Buffer.from(token ?? '', 'hex')
    if (word !== 'AEVEN' || name === undefined || given.length !== expected.length || !timingSafeEqual(given, expected)) {
      client.destroy()
      return
    }
    client.identity = { name, session }
    client.setTimeout(config.idleTimeoutMs)
    web.emit('connection', client)
    // The HTTP server reads later bytes straight from the socket's handle, so bytes that arrived with the
    // identifying line are handed to its parser here.
    const rest = buffered.subarray(end + 1)
    if (rest.length > 0) client.emit('data', rest)
    client.resume()
  }
  client.on('data', onData)
}

function start() {
  secret = Buffer.from(config.secret, 'hex')
  exact = new Set(config.allow.filter(name => !name.startsWith('*.')).map(name => name.toLowerCase()))
  suffixes = config.allow.filter(name => name.startsWith('*.')).map(name => name.slice(1).toLowerCase())
  ports = new Set(config.ports)
  gitHosts = new Set(config.gitHosts)
  total = new Bucket(config.bytesPerSecond)
  upstreamAgent = new https.Agent({ keepAlive: true, maxSockets: 256, timeout: config.idleTimeoutMs })

  setInterval(() => {
    logged = 0
    const today = new Date().toISOString().slice(0, 10)
    if (today !== day) {
      day = today
      dayBytes.clear()
    }
  }, 1000).unref()
  setInterval(() => {
    total.refill()
    for (const [name, account] of accounts) {
      account.bucket.refill()
      if (account.connections === 0 && account.bucket.paused.size === 0) accounts.delete(name)
    }
  }, TICK_MS).unref()

  const web = http.createServer({ keepAliveTimeout: config.idleTimeoutMs, requestTimeout: 0 })
  web.on('connect', (request, client, head) => { void tunnel(request, client, head) })
  web.on('request', (request, response) => { void git(request, response) })
  web.on('clientError', (_error, client) => { client.destroy() })

  rmSync(config.socket, { force: true })
  const listener = net.createServer(client => { accept(web, client) })
  listener.on('error', (error) => {
    process.stderr.write(`egress-proxy: ${error.message}\n`)
    process.exit(1)
  })
  listener.listen(config.socket, () => {
    chmodSync(config.socket, 0o600)
    process.stderr.write(`egress-proxy: ready on ${config.socket}\n`)
  })
}

const input = createInterface({ input: process.stdin })
input.on('line', (line) => {
  const message = JSON.parse(line)
  if (config === undefined) {
    config = message
    start()
    return
  }
  const answer = pending.get(message.id)
  pending.delete(message.id)
  answer?.(message)
})
// The provider holds the other end; without it no credential or approval can be answered.
input.on('close', () => { process.exit(0) })
process.on('SIGTERM', () => { process.exit(0) })
