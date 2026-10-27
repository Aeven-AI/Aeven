/**
 * Client side of the relay protocol, JSON text messages over one WebSocket per account, authenticated with the
 * account's Aeven access token. Requests carry `rid` and receive `ok` or `error` with the same `rid`; the relay
 * also pushes `frame` and `chain` messages. Frames and wrapped keys travel as base64url.
 *
 * Requests:
 * - `chain.get` → `{ entries }`
 * - `chain.append { entry }` → `{}`; refused unless `entry.index` equals the stored length
 * - `keys.put { recipient, wrapped }` → `{}`; `recipient` is a device id or `recovery`
 * - `keys.get { recipient }` → `{ wrapped? }`
 * - `publish { frame, covers? }` → `{ seq }`; `covers` marks a snapshot that replaces the id's frames up to it
 * - `signal { to?, data }` → `{ peer }`; forwards `data` to one peer or every other socket of the account
 * - `sync { since }` → pushes every stored document frame after `since`, then answers `{ seq }`, the account's
 *   latest sequence number
 */
import WebSocket from 'ws'
import type { ChainEntry } from '@aeven/sync-vault'

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
  /**
   * A chain entry another device appended.
   * @param entry - the entry.
   */
  chain(entry: ChainEntry): void
  /**
   * A device-to-device message from another socket of the account.
   * @param from - the sender's relay peer number.
   * @param data - the message.
   */
  signal(from: number, data: unknown): void
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

  private constructor(private readonly socket: WebSocket, private readonly handlers: RelayHandlers) {
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
   * @returns the open connection.
   */
  static open(url: string, token: string, handlers: RelayHandlers, timeoutMs: number): Promise<RelayConnection> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url, { headers: { authorization: `Bearer ${token}` }, handshakeTimeout: timeoutMs })
      const fail = (error: Error): void => {
        socket.removeAllListeners()
        socket.terminate()
        reject(error)
      }
      socket.once('error', fail)
      socket.once('unexpected-response', (_request, response) => { fail(new RelayError('refused', `relay refused the connection (HTTP ${String(response.statusCode)})`)) })
      socket.once('open', () => {
        socket.removeAllListeners()
        socket.on('error', () => { socket.terminate() })
        resolve(new RelayConnection(socket, handlers))
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
      case 'chain':
        this.handlers.chain(message.entry as ChainEntry)
        return
      case 'signal':
        this.handlers.signal(message.from as number, message.data)
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
   * @throws {RelayError} on an `error` answer or a closed connection.
   */
  request(type: string, fields: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    if (this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new RelayError('closed', 'relay connection closed'))
    const rid = this.nextRid++
    return new Promise((resolve, reject) => {
      this.pending.set(rid, { resolve, reject })
      this.socket.send(JSON.stringify({ ...fields, rid, t: type }))
    })
  }

  /** Close the connection. */
  close(): void {
    this.socket.close()
  }
}
