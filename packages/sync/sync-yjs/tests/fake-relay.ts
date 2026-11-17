/**
 * In-process stand-in for the Aeven sync relay, speaking the same protocol over a WebSocket on an ephemeral
 * loopback port: `Authorization: Bearer <token>` names the account, each account has one key, frames are
 * delivered to each syncing socket in sequence order, and snapshots prune what they cover.
 */
import { randomBytes } from 'node:crypto'
import { WebSocketServer, type WebSocket } from 'ws'
import { keyIdOf } from '@aeven/sync-vault'
import { RELAY_MAX_MESSAGE_BYTES } from '../src/relay.ts'

interface StoredFrame {
  seq: number
  id: string
  kind: string
  data: Buffer
}

/** One copy of the account key a protected account stores, as the relay describes it. */
interface StoredHolder {
  id: string
  wrapped: string
  kind: 'passkey' | 'recovery'
  name?: string
  aaguid?: string
  device?: string
  addedAt: string
}

interface Account {
  seq: number
  frames: StoredFrame[]
  key: string
  /** Set while passkeys hold the key: the key id and every copy; the relay then holds no key. */
  protection?: { keyId: string; holders: StoredHolder[] } | undefined
  leases: Map<string, { device: string; expiresAt: number }>
  sockets: Set<Peer>
}

interface Peer {
  socket: WebSocket
  account: Account
  peer: number
  cursor?: number
  /** While a paged catch-up runs, frames published meanwhile wait for the next page. */
  paging?: boolean
}

/** Header fields the relay routes on. */
function headerOf(data: Buffer): { kind: string; id: string } {
  const end = 3 + data.readUInt16BE(1)
  return JSON.parse(data.subarray(3, end).toString('utf8')) as { kind: string; id: string }
}

/** A running fake relay. */
/** A copy of the key without the wrapped key, as `passkey.*` answers describe it. */
function describe({ wrapped: _wrapped, ...holder }: StoredHolder): Omit<StoredHolder, 'wrapped'> {
  return holder
}

/** The answer `passkey.add`, `passkey.remove` and `passkey.rename` give. */
function answer(holders: readonly StoredHolder[]): Record<string, unknown> {
  return { passkeys: holders.filter(holder => holder.kind === 'passkey').map(holder => holder.id), entries: holders.map(describe) }
}

export class FakeRelay {
  /** Complete JSON request sizes observed after the transport accepted them. */
  readonly requests: Array<{ type: string; bytes: number }> = []
  /** Transport refusals, including oversized messages rejected before protocol handling. */
  readonly transportErrors: Error[] = []
  readonly accounts = new Map<string, Account>()
  /** Codes the next requests of a type answer with, consumed in order. */
  readonly refusals = new Map<string, string[]>()
  /** Replies the next requests of a type receive instead of the relay's own, consumed in order. */
  readonly replies = new Map<string, Array<Record<string, unknown>>>()
  /** Answer `sync` the way a relay without paging does: push every frame and answer without `more`. */
  legacySync = false
  /** Request types the relay leaves unanswered. */
  readonly unanswered = new Set<string>()
  /** Delay before accepting a handshake, in milliseconds. */
  handshakeDelayMs = 0
  private nextPeer = 0

  private constructor(private readonly server: WebSocketServer, readonly url: string) {}

  /**
   * Start a relay on an ephemeral loopback port.
   * @param maxPayload - complete WebSocket message limit, matching the deployed relay by default.
   * @returns the running relay.
   */
  static async start(maxPayload = RELAY_MAX_MESSAGE_BYTES): Promise<FakeRelay> {
    // eslint-disable-next-line prefer-const -- assigned once the server listens; verifyClient reads it later.
    let relay: FakeRelay
    const server = new WebSocketServer({
      host: '127.0.0.1',
      port: 0,
      maxPayload,
      verifyClient: (info: { req: { headers: Record<string, string | string[] | undefined> } }, done: (accept: boolean) => void) => {
        const accept = typeof info.req.headers.authorization === 'string' && info.req.headers.authorization.startsWith('Bearer ok-')
        setTimeout(() => { done(accept) }, relay.handshakeDelayMs)
      },
    })
    await new Promise<void>((resolve) => { server.once('listening', () => { resolve() }) })
    const { port } = server.address() as { port: number }
    relay = new FakeRelay(server, `ws://127.0.0.1:${String(port)}/sync`)
    server.on('connection', (socket, request) => { relay.connect(socket, String(request.headers.authorization).slice('Bearer ok-'.length)) })
    return relay
  }

  /**
   * The state of one account, created on first use.
   * @param owner - the account.
   * @returns its state.
   */
  account(owner: string): Account {
    let account = this.accounts.get(owner)
    if (account === undefined) {
      account = { seq: 0, frames: [], key: randomBytes(32).toString('base64url'), leases: new Map(), sockets: new Set() }
      this.accounts.set(owner, account)
    }
    return account
  }

  private connect(socket: WebSocket, owner: string): void {
    const peer: Peer = { socket, account: this.account(owner), peer: ++this.nextPeer }
    peer.account.sockets.add(peer)
    socket.on('close', () => { peer.account.sockets.delete(peer) })
    socket.on('error', (error) => { this.transportErrors.push(error) })
    socket.on('message', (data: Buffer) => {
      const message = JSON.parse(data.toString('utf8')) as Record<string, unknown>
      this.requests.push({ type: String(message.t), bytes: data.length })
      this.handle(peer, message)
    })
  }

  /** Store a copy of the key as the real relay does: the kind defaults to a passkey and the relay dates it. */
  private holder(entry: unknown): StoredHolder {
    const fields = entry as Partial<StoredHolder>
    return {
      id: String(fields.id),
      wrapped: String(fields.wrapped),
      kind: fields.kind === 'recovery' ? 'recovery' : 'passkey',
      ...fields.aaguid === undefined ? {} : { aaguid: fields.aaguid },
      ...fields.device === undefined ? {} : { device: fields.device },
      addedAt: new Date().toISOString(),
    }
  }

  private send(peer: Peer, message: unknown): void {
    if (peer.socket.readyState === peer.socket.OPEN) peer.socket.send(JSON.stringify(message))
  }

  /** Send document frames after the peer's cursor, at most `limit`; returns whether more remain. */
  private pump(peer: Peer, limit = Infinity): boolean {
    if (peer.cursor === undefined) return false
    let sent = 0
    for (const frame of peer.account.frames) {
      if (frame.seq <= peer.cursor || frame.kind === 'stream') continue
      if (sent === limit) return true
      this.send(peer, { t: 'frame', seq: frame.seq, frame: frame.data.toString('base64url') })
      peer.cursor = frame.seq
      sent++
    }
    return false
  }

  private handle(peer: Peer, request: Record<string, unknown>): void {
    const { rid, t } = request
    const ok = (fields: Record<string, unknown> = {}): void => { this.send(peer, { ...fields, rid, t: 'ok' }) }
    const refuse = (code: string): void => { this.send(peer, { rid, t: 'error', code, message: `refused: ${code}` }) }
    if (this.unanswered.has(String(t))) return
    const queued = this.refusals.get(String(t))?.shift()
    if (queued !== undefined) {
      refuse(queued)
      return
    }
    const reply = this.replies.get(String(t))?.shift()
    if (reply !== undefined) {
      ok(reply)
      return
    }
    const account = peer.account
    switch (t) {
      case 'key.get':
        if (account.protection !== undefined) {
          ok({ mode: 'passkey', keyId: account.protection.keyId, passkeys: account.protection.holders })
          return
        }
        ok({ key: account.key, keyId: keyIdOf(Buffer.from(account.key, 'base64url')) })
        return
      case 'key.protect': {
        const holder = this.holder(request.passkey)
        if (holder.kind !== 'passkey') { refuse('bad-request'); return }
        account.protection = { keyId: String(request.keyId), holders: [holder] }
        ok({ entries: [describe(holder)] })
        return
      }
      case 'passkey.add': {
        if (account.protection === undefined) { refuse('not-protected'); return }
        const holder = this.holder(request.passkey)
        account.protection.holders = [...account.protection.holders.filter(entry => entry.id !== holder.id), holder]
        ok(answer(account.protection.holders))
        return
      }
      case 'passkey.remove': {
        if (account.protection === undefined) { refuse('not-protected'); return }
        const holders = account.protection.holders.filter(entry => entry.id !== request.id)
        if (!holders.some(entry => entry.kind === 'passkey')) { refuse('last-passkey'); return }
        account.protection.holders = holders
        ok(answer(holders))
        return
      }
      case 'passkey.rename': {
        if (account.protection === undefined) { refuse('not-protected'); return }
        const name = String(request.name)
        account.protection.holders = account.protection.holders.map(entry => entry.id === request.id ? { ...entry, name } : entry)
        ok(answer(account.protection.holders))
        return
      }
      case 'key.unprotect': {
        if (account.protection === undefined) { refuse('not-protected'); return }
        account.protection = undefined
        account.key = randomBytes(32).toString('base64url')
        account.frames = []
        ok({ key: account.key, keyId: keyIdOf(Buffer.from(account.key, 'base64url')) })
        return
      }
      case 'publish': {
        const items = Array.isArray(request.frames) ? request.frames as Array<Record<string, unknown>> : [request]
        const seqs = items.map((item) => {
          const data = Buffer.from(String(item.frame), 'base64url')
          const header = headerOf(data)
          account.seq += 1
          account.frames.push({ seq: account.seq, id: header.id, kind: header.kind, data })
          if (typeof item.covers === 'number') {
            const covers = item.covers
            account.frames = account.frames.filter(frame => frame.id !== header.id || frame.seq > covers)
          }
          return account.seq
        })
        ok(Array.isArray(request.frames) ? { seqs } : { seq: seqs[0] })
        for (const other of account.sockets) if (other !== peer && other.paging !== true) this.pump(other)
        return
      }
      case 'sync': {
        peer.cursor = request.since as number
        if (this.legacySync || typeof request.limit !== 'number') {
          peer.paging = false
          this.pump(peer)
          ok({ seq: peer.cursor })
          return
        }
        const more = this.pump(peer, request.limit)
        peer.paging = more
        ok({ seq: peer.cursor, more })
        return
      }
      case 'stream.get': {
        const after = typeof request.after === 'number' ? request.after : 0
        const frames = account.frames.filter(frame => frame.id === request.id && frame.kind === 'stream' && frame.seq > after)
        ok({ frames: frames.slice(0, 2).map(frame => ({ seq: frame.seq, frame: frame.data.toString('base64url') })), more: frames.length > 2 })
        return
      }
      case 'lease.acquire': {
        const name = String(request.name)
        const device = String(request.device)
        const held = account.leases.get(name)
        if (held !== undefined && held.device !== device && held.expiresAt > Date.now()) {
          ok({ granted: false, holder: held.device, expiresAt: held.expiresAt })
        } else {
          const lease = { device, expiresAt: Date.now() + Number(request.ttlMs) }
          account.leases.set(name, lease)
          ok({ granted: true, holder: device, expiresAt: lease.expiresAt })
        }
        return
      }
      case 'lease.release': {
        const name = String(request.name)
        if (account.leases.get(name)?.device === request.device) account.leases.delete(name)
        ok()
        return
      }
      default:
        refuse('bad-request')
    }
  }

  /**
   * Send raw text to every socket of an account.
   * @param owner - the account.
   * @param text - the text.
   */
  broadcastRaw(owner: string, text: string): void {
    for (const peer of this.account(owner).sockets) peer.socket.send(text)
  }

  /**
   * Write bytes that are not a WebSocket frame to every socket of an account.
   * @param owner - the account.
   */
  corrupt(owner: string): void {
    for (const peer of this.account(owner).sockets) {
      const raw = (peer.socket as unknown as { _socket: { write(data: Buffer): void } })._socket
      raw.write(Buffer.from([0xff, 0xff, 0xff]))
    }
  }

  /** Close every connection and stop listening. */
  async stop(): Promise<void> {
    for (const client of this.server.clients) client.terminate()
    await new Promise<void>((resolve) => { this.server.close(() => { resolve() }) })
  }
}
