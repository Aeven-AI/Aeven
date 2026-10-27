/**
 * In-process stand-in for the Aeven sync relay, speaking the same protocol over a WebSocket on an ephemeral
 * loopback port: `Authorization: Bearer <token>` names the account, frames are delivered to each syncing socket
 * in sequence order, snapshots prune what they cover, and signals reach the account's other sockets.
 */
import { WebSocketServer, type WebSocket } from 'ws'

interface StoredFrame {
  seq: number
  id: string
  kind: string
  data: Buffer
}

interface Account {
  seq: number
  frames: StoredFrame[]
  chain: unknown[]
  keys: Map<string, string>
  sockets: Set<Peer>
}

interface Peer {
  socket: WebSocket
  account: Account
  peer: number
  cursor?: number
}

/** Header fields the relay routes on. */
function headerOf(data: Buffer): { kind: string; id: string } {
  const end = 3 + data.readUInt16BE(1)
  return JSON.parse(data.subarray(3, end).toString('utf8')) as { kind: string; id: string }
}

/** A running fake relay. */
export class FakeRelay {
  readonly accounts = new Map<string, Account>()
  /** Codes the next requests of a type answer with, consumed in order. */
  readonly refusals = new Map<string, string[]>()
  /** Delay before accepting a handshake, in milliseconds. */
  handshakeDelayMs = 0
  private nextPeer = 0

  private constructor(private readonly server: WebSocketServer, readonly url: string) {}

  /**
   * Start a relay on an ephemeral loopback port.
   * @returns the running relay.
   */
  static async start(): Promise<FakeRelay> {
    // eslint-disable-next-line prefer-const -- assigned once the server listens; verifyClient reads it later.
    let relay: FakeRelay
    const server = new WebSocketServer({
      host: '127.0.0.1',
      port: 0,
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
      account = { seq: 0, frames: [], chain: [], keys: new Map(), sockets: new Set() }
      this.accounts.set(owner, account)
    }
    return account
  }

  private connect(socket: WebSocket, owner: string): void {
    const peer: Peer = { socket, account: this.account(owner), peer: ++this.nextPeer }
    peer.account.sockets.add(peer)
    socket.on('close', () => { peer.account.sockets.delete(peer) })
    socket.on('message', (data: Buffer) => { this.handle(peer, JSON.parse(data.toString('utf8')) as Record<string, unknown>) })
  }

  private send(peer: Peer, message: unknown): void {
    if (peer.socket.readyState === peer.socket.OPEN) peer.socket.send(JSON.stringify(message))
  }

  private pump(peer: Peer): void {
    if (peer.cursor === undefined) return
    for (const frame of peer.account.frames) {
      if (frame.seq <= peer.cursor || frame.kind === 'stream') continue
      this.send(peer, { t: 'frame', seq: frame.seq, frame: frame.data.toString('base64url') })
      peer.cursor = frame.seq
    }
  }

  private handle(peer: Peer, request: Record<string, unknown>): void {
    const { rid, t } = request
    const ok = (fields: Record<string, unknown> = {}): void => { this.send(peer, { ...fields, rid, t: 'ok' }) }
    const refuse = (code: string): void => { this.send(peer, { rid, t: 'error', code, message: `refused: ${code}` }) }
    const queued = this.refusals.get(String(t))?.shift()
    if (queued !== undefined) {
      refuse(queued)
      return
    }
    const account = peer.account
    switch (t) {
      case 'chain.get':
        ok({ entries: account.chain })
        return
      case 'chain.append': {
        const entry = request.entry as { index: number }
        if (entry.index !== account.chain.length) {
          refuse('conflict')
          return
        }
        account.chain.push(entry)
        for (const other of account.sockets) if (other !== peer) this.send(other, { t: 'chain', entry })
        ok()
        return
      }
      case 'keys.put':
        account.keys.set(String(request.recipient), String(request.wrapped))
        ok()
        return
      case 'keys.get': {
        const wrapped = account.keys.get(String(request.recipient))
        ok(wrapped === undefined ? {} : { wrapped })
        return
      }
      case 'publish': {
        const data = Buffer.from(String(request.frame), 'base64url')
        const header = headerOf(data)
        account.seq += 1
        account.frames.push({ seq: account.seq, id: header.id, kind: header.kind, data })
        if (typeof request.covers === 'number') {
          const covers = request.covers
          account.frames = account.frames.filter(frame => frame.id !== header.id || frame.seq > covers)
        }
        ok({ seq: account.seq })
        for (const other of account.sockets) if (other !== peer) this.pump(other)
        return
      }
      case 'sync':
        peer.cursor = request.since as number
        this.pump(peer)
        ok({ seq: peer.cursor })
        return
      case 'stream.get': {
        const after = typeof request.after === 'number' ? request.after : 0
        const frames = account.frames.filter(frame => frame.id === request.id && frame.kind === 'stream' && frame.seq > after)
        ok({ frames: frames.slice(0, 2).map(frame => ({ seq: frame.seq, frame: frame.data.toString('base64url') })), more: frames.length > 2 })
        return
      }
      case 'signal':
        for (const other of account.sockets) {
          if (other !== peer && (request.to === undefined || other.peer === request.to)) this.send(other, { t: 'signal', from: peer.peer, data: request.data })
        }
        ok({ peer: peer.peer })
        return
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
