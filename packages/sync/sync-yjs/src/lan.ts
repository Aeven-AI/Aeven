/**
 * Direct exchange of document updates between an account's devices on one local network. Each enrolled device
 * listens on a WebSocket port and advertises it over mDNS under an opaque account tag. Two devices that find
 * each other link once both proved, by signing the other's challenge, that they hold an active device key of
 * the account's chain; a found device whose link closed or was refused is tried again while it stays found.
 * A linked device receives each local update the moment it is made. The relay still carries every update, so
 * the direct link only makes delivery faster and keeps it working without internet.
 */
import { randomBytes } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { Bonjour, type Service } from 'bonjour-service'
import { WebSocket, WebSocketServer, type RawData } from 'ws'

/** mDNS service type of an Aeven sync device. */
const SERVICE = 'aeven-sync'

/** Bytes of a handshake challenge. */
const NONCE_BYTES = 32

/** This device as discovery advertises it. */
export interface LanSelf {
  /** This device's id. */
  device: string
  /** The account's opaque tag; only devices with the same tag are reported. */
  tag: string
  /** The port this device accepts links on. */
  port: number
}

/** Another device of the account found on the local network. */
export interface LanPeer {
  /** Its device id, as it advertised it; the handshake proves it. */
  device: string
  /** An address it was reached at. */
  host: string
  /** Its link port. */
  port: number
}

/** Reports devices of the account appearing on and leaving the local network. */
export interface LanDiscovery {
  /**
   * Advertise this device and report the account's other devices.
   * @param self - this device's advertisement.
   * @param found - called for each device of the account that appears.
   * @param lost - called with the id of a device that left.
   * @returns a function that stops advertising and browsing.
   */
  start(self: LanSelf, found: (peer: LanPeer) => void, lost: (device: string) => void): () => void
}

/** The vault operations a link needs. */
export interface LanVault {
  /** @returns the account's opaque local-network tag. */
  tag(): string
  /** @returns this device's id. */
  device(): string
  /**
   * Sign handshake bytes with this device's key.
   * @param data - the bytes.
   * @returns the signature.
   */
  sign(data: Uint8Array): Uint8Array
  /**
   * Check a handshake signature against an active device of the chain.
   * @param device - the claimed device.
   * @param data - the signed bytes.
   * @param signature - the signature.
   * @returns whether `device` is active and signed `data`.
   */
  verify(device: string, data: Uint8Array, signature: Uint8Array): boolean
  /**
   * Apply an update frame a linked device sent.
   * @param frame - the sealed frame.
   */
  receive(frame: Uint8Array): void
}

/** Link tuning the provider configures. */
export interface LanTuning {
  /** Port to accept links on; 0 picks a free one. */
  port: number
  /** Longest a link handshake may take, in milliseconds. */
  handshakeMs: number
  /** Wait before linking again to a known device whose link closed, in milliseconds. */
  retryMs: number
  /** Largest message a link accepts, in bytes. */
  maxBytes: number
}

/** The first IPv4 address a found device answered from or advertised. */
function hostOf(service: Service): string | undefined {
  if (service.referer?.family === 'IPv4') return service.referer.address
  return service.addresses?.find(address => !address.includes(':'))
}

/** Local-network discovery over mDNS. */
export class MdnsDiscovery implements LanDiscovery {
  /** @inheritdoc */
  start(self: LanSelf, found: (peer: LanPeer) => void, lost: (device: string) => void): () => void {
    const bonjour = new Bonjour()
    bonjour.publish({ name: self.device, type: SERVICE, port: self.port, txt: { a: self.tag, d: self.device } })
    const deviceOf = (service: Service): string | undefined => {
      const txt = service.txt as Record<string, unknown> | undefined
      return txt?.a === self.tag && typeof txt.d === 'string' && txt.d !== self.device ? txt.d : undefined
    }
    const browser = bonjour.find({ type: SERVICE }, (service) => {
      const device = deviceOf(service)
      const host = hostOf(service)
      if (device !== undefined && host !== undefined) found({ device, host, port: service.port })
    })
    browser.on('down', (service) => {
      const device = deviceOf(service)
      if (device !== undefined) lost(device)
    })
    return () => {
      browser.stop()
      bonjour.unpublishAll()
      bonjour.destroy()
    }
  }
}

/** One link to another device. */
interface Link {
  readonly socket: WebSocket
  /** The device that opened the link. */
  dialer: string
  /** The peer's device id: the dialed device, or the id an accepted peer's hello names. */
  device?: string
  /** Whether the peer's hello arrived. */
  greeted: boolean
  /** The challenge this side sent. */
  readonly nonce: string
  /** The peer's signature over this side's challenge, once it verified. */
  proof?: Uint8Array
  /** Closes the link unless the handshake finishes first. */
  handshake?: ReturnType<typeof setTimeout>
}

type Message =
  | { t: 'hello'; device: string; nonce: string }
  | { t: 'proof'; signature: string }
  | { t: 'frame'; frame: string }

/** Parse one link message, or undefined for anything else. */
function parse(data: RawData): Message | undefined {
  let message: unknown
  try {
    // ws delivers text and binary messages as one Buffer by default.
    message = JSON.parse((data as Buffer).toString('utf8'))
  } catch {
    // A message that is not JSON is not a link message; the caller closes the link.
    return undefined
  }
  if (typeof message !== 'object' || message === null) return undefined
  const fields = message as Record<string, unknown>
  if (fields.t === 'hello' && typeof fields.device === 'string' && typeof fields.nonce === 'string') return fields as Message
  if (fields.t === 'proof' && typeof fields.signature === 'string') return fields as Message
  if (fields.t === 'frame' && typeof fields.frame === 'string') return fields as Message
  return undefined
}

/** One account's links to its other devices on the local network. */
export class LanTransport {
  private readonly links = new Set<Link>()
  private readonly known = new Map<string, LanPeer>()
  private readonly retries = new Map<string, ReturnType<typeof setTimeout>>()
  private stopDiscovery: (() => void) | undefined
  private closed = false

  private constructor(
    private readonly vault: LanVault,
    private readonly server: WebSocketServer,
    private readonly tuning: LanTuning,
  ) {}

  /**
   * Listen for links and start discovery.
   * @param vault - the account's vault operations.
   * @param discovery - how devices find each other.
   * @param tuning - port, timeouts, and message bound.
   * @returns the running transport.
   */
  static async start(vault: LanVault, discovery: LanDiscovery, tuning: LanTuning): Promise<LanTransport> {
    const server = new WebSocketServer({ port: tuning.port, maxPayload: tuning.maxBytes })
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve)
      server.once('error', reject)
    })
    const transport = new LanTransport(vault, server, tuning)
    server.on('connection', (socket) => { transport.adopt(socket, '') })
    const { port } = server.address() as AddressInfo
    transport.stopDiscovery = discovery.start(
      { device: vault.device(), tag: vault.tag(), port },
      (peer) => { transport.found(peer) },
      (device) => { transport.known.delete(device) },
    )
    return transport
  }

  /** @returns the ids of linked devices. */
  peers(): string[] {
    return [...this.links].flatMap(link => (link.proof !== undefined && link.device !== undefined ? [link.device] : []))
  }

  /**
   * Send an update frame to every linked device.
   * @param frame - the sealed frame.
   */
  send(frame: Uint8Array): void {
    const message = JSON.stringify({ t: 'frame', frame: Buffer.from(frame).toString('base64url') })
    for (const link of this.links) if (link.proof !== undefined) link.socket.send(message)
  }

  /**
   * Follow a change of the device chain: close links to devices it no longer holds active, and link to found
   * devices that are not linked, such as one whose admission had not arrived when it first tried.
   */
  refresh(): void {
    for (const link of this.links) {
      // An active device's key verifies its handshake proof again; a removed device's no longer does.
      const { device, proof } = link
      if (device !== undefined && proof !== undefined && !this.vault.verify(device, this.transcript(link.nonce, device), proof)) {
        link.socket.close()
      }
    }
    for (const device of this.known.keys()) if (!this.linked(device)) this.dial(device)
  }

  private found(peer: LanPeer): void {
    this.known.set(peer.device, peer)
    if (!this.linked(peer.device)) this.dial(peer.device)
  }

  private linked(device: string): boolean {
    return [...this.links].some(link => link.device === device)
  }

  private dial(device: string): void {
    const peer = this.known.get(device)
    if (this.closed || peer === undefined) return
    const socket = new WebSocket(`ws://${peer.host}:${String(peer.port)}`, { maxPayload: this.tuning.maxBytes })
    this.adopt(socket, this.vault.device(), device)
  }

  private retry(device: string): void {
    if (this.closed || this.retries.has(device) || !this.known.has(device)) return
    this.retries.set(device, setTimeout(() => {
      this.retries.delete(device)
      if (!this.linked(device)) this.dial(device)
    }, this.tuning.retryMs))
  }

  private transcript(nonce: string, device: string): Uint8Array {
    return new TextEncoder().encode(`aeven-sync/lan\n${this.vault.tag()}\n${nonce}\n${device}`)
  }

  private adopt(socket: WebSocket, dialer: string, device?: string): void {
    const link: Link = { socket, dialer, ...device === undefined ? {} : { device }, greeted: false, nonce: randomBytes(NONCE_BYTES).toString('base64url') }
    this.links.add(link)
    // A refused or reset link only ends; the close handler below forgets it and schedules a retry.
    socket.on('error', () => {})
    link.handshake = setTimeout(() => { socket.close() }, this.tuning.handshakeMs)
    const hello = (): void => { socket.send(JSON.stringify({ t: 'hello', device: this.vault.device(), nonce: link.nonce })) }
    if (socket.readyState === WebSocket.OPEN) hello()
    else socket.once('open', hello)
    socket.on('message', (data) => {
      const message = parse(data)
      if (message === undefined || !this.handle(link, message)) socket.close()
    })
    socket.once('close', () => {
      clearTimeout(link.handshake)
      this.links.delete(link)
      if (link.device !== undefined) this.retry(link.device)
    })
  }

  /** @returns whether the link stays open. */
  private handle(link: Link, message: Message): boolean {
    if (message.t === 'hello') {
      if (link.greeted || message.device === this.vault.device()) return false
      if (link.device !== undefined && link.device !== message.device) return false
      link.greeted = true
      link.device = message.device
      if (link.dialer === '') link.dialer = message.device
      const signature = this.vault.sign(this.transcript(message.nonce, this.vault.device()))
      link.socket.send(JSON.stringify({ t: 'proof', signature: Buffer.from(signature).toString('base64url') }))
      return true
    }
    if (message.t === 'proof') {
      if (!link.greeted || link.device === undefined || link.proof !== undefined) return false
      const proof = new Uint8Array(Buffer.from(message.signature, 'base64url'))
      if (!this.vault.verify(link.device, this.transcript(link.nonce, link.device), proof)) return false
      link.proof = proof
      clearTimeout(link.handshake)
      this.settleDuplicate(link, link.device)
      return true
    }
    if (link.proof === undefined) return false
    this.vault.receive(new Uint8Array(Buffer.from(message.frame, 'base64url')))
    return true
  }

  /** Two devices that dialed each other at once keep the link the smaller device id opened, on both sides. */
  private settleDuplicate(link: Link, device: string): void {
    const other = [...this.links].find(candidate => candidate !== link && candidate.proof !== undefined && candidate.device === device)
    if (other === undefined) return
    const keep = [this.vault.device(), device].sort()[0]
    ;(other.dialer === keep ? link : other).socket.close()
  }

  /** Stop discovery, close every link, and stop listening. */
  async close(): Promise<void> {
    this.closed = true
    this.stopDiscovery?.()
    for (const timer of this.retries.values()) clearTimeout(timer)
    this.retries.clear()
    for (const link of this.links) link.socket.terminate()
    await new Promise<void>((resolve) => { this.server.close(() => { resolve() }) })
  }
}
