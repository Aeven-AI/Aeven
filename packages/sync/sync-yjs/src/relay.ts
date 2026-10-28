/**
 * Client side of the relay protocol, JSON text messages over one WebSocket per account, authenticated with the
 * account's Aeven access token. Requests carry `rid` and receive `ok` or `error` with the same `rid`; the relay
 * also pushes `frame` messages. Frames and the account key travel as base64url.
 *
 * Requests:
 * - `key.get` → `{ key }`; the account key, created by the relay on first use
 * - `publish { frame, covers? }` → `{ seq }`; `covers` marks a snapshot that replaces the id's frames up to it
 * - `sync { since, limit? }` → pushes stored document frames after `since`, at most `limit` of them, then answers
 *   `{ seq, more? }`; `more` asks for the next page, and its absence subscribes the socket to new frames
 * - `stream.get { id, after? }` → `{ frames, more }`
 * - `lease.acquire { name, device, ttlMs }` / `lease.release { name, device }`
 */
import WebSocket from 'ws'

/** Listener for socket errors whose `close` that follows is handled. */
function ignore(): void {}

/** A relay `error` answer. */
export class RelayError extends Error {
  override name = 'RelayError'

  /**
   * @param code - the relay's error code.
   * @param message - the relay's description.
   */
  constructor(readonly code: string, message: string) {
    super(message)
  }
}

/** Callbacks for relay pushes. */
export interface RelayHandlers {
  /**
   * A stored frame, in sequence order.
   * @param seq - the relay sequence number.
   * @param frame - the sealed frame.
   */
  frame(seq: number, frame: Uint8Array): void
  /** The connection closed, for any reason. */
  closed(): void
}

interface Pending {
  resolve(value: Record<string, unknown>): void
  reject(error: Error): void
}

/** One open relay connection. */
export class RelayConnection {
  private nextRid = 1
  private readonly pending = new Map<number, Pending>()
  /** Settles once the connection has closed, for any reason. */
  readonly closed: Promise<void>

  private constructor(
    private readonly socket: WebSocket,
    private readonly handlers: RelayHandlers,
    private readonly requestMs: number,
  ) {
    // The socket keeps ws's default `nodebuffer` binary type, so every message arrives as one Buffer.
    socket.on('message', (data: Buffer) => { this.receive(data.toString('utf8')) })
    this.closed = new Promise((resolve) => {
      socket.on('close', () => {
        for (const request of this.pending.values()) request.reject(new RelayError('closed', 'relay connection closed'))
        this.pending.clear()
        handlers.closed()
        resolve()
      })
    })
  }

  /**
   * Connect to the relay.
   * @param url - the relay's WebSocket URL.
   * @param token - the account's Aeven access token.
   * @param handlers - push callbacks.
   * @param timeoutMs - longest the opening handshake may take.
   * @param requestMs - longest a request may wait for its answer before the connection is closed.
   * @returns the open connection.
   */
  static open(url: string, token: string, handlers: RelayHandlers, timeoutMs: number, requestMs: number): Promise<RelayConnection> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url, { headers: { authorization: `Bearer ${token}` }, handshakeTimeout: timeoutMs })
      const fail = (error: Error): void => {
        socket.removeAllListeners()
        // Terminating a connecting socket emits one more `error`; without a listener it would be unhandled.
        socket.on('error', ignore)
        socket.terminate()
        reject(error)
      }
      socket.once('error', fail)
      socket.once('unexpected-response', (_request, response) => { fail(new RelayError('refused', `relay refused the connection (HTTP ${String(response.statusCode)})`)) })
      socket.once('open', () => {
        socket.removeAllListeners()
        // A protocol error ends the connection; `close` follows and fails pending requests.
        socket.on('error', ignore)
        resolve(new RelayConnection(socket, handlers, requestMs))
      })
    })
  }

  private receive(text: string): void {
    let message: Record<string, unknown>
    try {
      message = JSON.parse(text) as Record<string, unknown>
    } catch {
      // A relay message that is not JSON breaks the protocol; dropping the connection lets the owner reconnect.
      this.socket.terminate()
      return
    }
    switch (message.t) {
      case 'ok':
      case 'error': {
        const request = this.pending.get(message.rid as number)
        if (request === undefined) return
        this.pending.delete(message.rid as number)
        if (message.t === 'ok') request.resolve(message)
        else request.reject(new RelayError(String(message.code), String(message.message)))
        return
      }
      case 'frame':
        this.handlers.frame(message.seq as number, new Uint8Array(Buffer.from(message.frame as string, 'base64url')))
        return
      default:
        // Messages this build does not know are ignored so the relay can add push types.
        return
    }
  }

  /**
   * Send one request and wait for its answer.
   * @param type - the request type.
   * @param fields - the request's fields.
   * @returns the `ok` answer's fields.
   * @throws {RelayError} on an `error` answer or a closed connection. An answer that does not arrive in time closes
   * the connection, which fails this and every other waiting request, so the connection loop starts over.
   */
  request(type: string, fields: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    if (this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new RelayError('closed', 'relay connection closed'))
    const rid = this.nextRid++
    const timer = setTimeout(() => {
      if (this.pending.has(rid)) this.socket.terminate()
    }, this.requestMs)
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      this.pending.set(rid, { resolve, reject })
      this.socket.send(JSON.stringify({ ...fields, rid, t: type }))
    }).finally(() => { clearTimeout(timer) })
  }

  /** Close the connection. */
  close(): void {
    this.socket.close()
  }
}
