/**
 * Device approval over relay signals. The joining device broadcasts a commitment to its keys; each enrolled
 * device whose user has its add-device screen open answers with a challenge and its own public keys, and
 * announces `join-open` when that screen opens so a device already waiting asks again; the joining device reveals its keys to the first
 * answer only; both sides derive the same six-digit code, and the user approves on the enrolled device.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import {
  approvalCode, commitToKeys, fromBase64Url, toBase64Url, verifyCommitment,
  type DeviceKeys, type DevicePublicKeys,
} from '@aeven/sync-vault'
import type { SyncJoinRequest } from '@aeven/sync'
import type { RelayConnection } from './relay.ts'

/** Signal payloads of the approval exchange. */
type JoinSignal =
  | { type: 'join-open' }
  | { type: 'join-request'; commitment: string }
  | { type: 'join-challenge'; challenge: string; signing: string; agreement: string }
  | { type: 'join-reveal'; signing: string; agreement: string; opening: string }

function parseSignal(data: unknown): JoinSignal | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const signal = data as Record<string, unknown>
  const strings = (...keys: string[]): boolean => keys.every(key => typeof signal[key] === 'string')
  switch (signal.type) {
    case 'join-open': return signal as JoinSignal
    case 'join-request': return strings('commitment') ? signal as JoinSignal : undefined
    case 'join-challenge': return strings('challenge', 'signing', 'agreement') ? signal as JoinSignal : undefined
    case 'join-reveal': return strings('signing', 'agreement', 'opening') ? signal as JoinSignal : undefined
    default: return undefined
  }
}

function keysOf(signal: { signing: string; agreement: string }): DevicePublicKeys {
  return { signing: fromBase64Url(signal.signing, 32), agreement: fromBase64Url(signal.agreement, 32) }
}

/** The joining device's side. */
export class JoinRequester {
  /** Resolves with the code once an enrolled device answered. */
  readonly code: Promise<string>
  private resolveCode!: (code: string) => void
  private answered = false
  private readonly opening: Uint8Array
  private readonly commitment: string

  /**
   * @param relay - a connection for the account, used only for this exchange.
   * @param keys - the joining device's keys.
   */
  constructor(private readonly relay: RelayConnection, private readonly keys: DeviceKeys) {
    this.code = new Promise((resolve) => {
      this.resolveCode = resolve
    })
    const { commitment, opening } = commitToKeys(keys.publicKeys)
    this.commitment = commitment
    this.opening = opening
  }

  /** Broadcast the commitment to the account's enrolled devices. */
  async start(): Promise<void> {
    await this.relay.request('signal', { data: { type: 'join-request', commitment: this.commitment } })
  }

  /**
   * Handle a signal from another device.
   * @param from - the sender's relay peer number.
   * @param data - the signal payload.
   */
  receive(from: number, data: unknown): void {
    const signal = parseSignal(data)
    if (signal?.type === 'join-open' && !this.answered) {
      void this.start().catch(() => {
        // A dropped connection ends the join; the caller cancels it.
      })
      return
    }
    if (signal?.type !== 'join-challenge' || this.answered) return
    this.answered = true
    const challenge = fromBase64Url(signal.challenge, 32)
    const approver = keysOf(signal)
    void this.relay.request('signal', {
      to: from,
      data: { type: 'join-reveal', signing: toBase64Url(this.keys.publicKeys.signing), agreement: toBase64Url(this.keys.publicKeys.agreement), opening: toBase64Url(this.opening) },
    }).catch(() => {
      // A dropped connection ends the join; the caller sees `admitted` never settle and cancels.
    })
    this.resolveCode(approvalCode({ joining: this.keys.publicKeys, opening: this.opening, challenge, approver }))
  }
}

interface Challenge {
  commitment: string
  challenge: Uint8Array
}

/** A revealed join request awaiting the user's decision. */
export interface PendingJoin extends SyncJoinRequest {
  /** The joining device's keys. */
  keys: DevicePublicKeys
}

/** An enrolled device's side: answers requests and holds revealed ones until the user decides. */
export class JoinApprover {
  private readonly challenges = new Map<number, Challenge>()
  private readonly requests = new Map<string, PendingJoin>()
  private accepting = 0

  /**
   * @param keys - this enrolled device's keys.
   * @param changed - called when the set of pending requests changes.
   */
  constructor(private readonly keys: DeviceKeys, private readonly changed: () => void) {}

  /**
   * Answer join requests until the returned function is called, and ask waiting devices to repeat theirs.
   * @param relay - the account's open connection.
   * @returns a function that stops answering for this caller.
   */
  accept(relay: RelayConnection): () => void {
    this.accepting += 1
    void relay.request('signal', { data: { type: 'join-open' } }).catch(() => {
      // Without a connection no device can be waiting on this one.
    })
    let stopped = false
    return () => {
      if (stopped) return
      stopped = true
      this.accepting -= 1
      if (this.accepting === 0) this.challenges.clear()
    }
  }

  /** @returns requests whose code is ready for the user. */
  pending(): PendingJoin[] {
    return [...this.requests.values()]
  }

  /**
   * Remove a request once the user decided.
   * @param id - the request id.
   * @returns the request, or undefined when it is unknown.
   */
  take(id: string): PendingJoin | undefined {
    const request = this.requests.get(id)
    if (request === undefined) return undefined
    this.requests.delete(id)
    this.changed()
    return request
  }

  /**
   * Handle a signal from another socket of the account.
   * @param relay - the connection the signal arrived on.
   * @param from - the sender's relay peer number.
   * @param data - the signal payload.
   */
  receive(relay: RelayConnection, from: number, data: unknown): void {
    const signal = parseSignal(data)
    if (signal?.type === 'join-request') {
      if (this.accepting === 0) return
      const challenge = new Uint8Array(randomBytes(32))
      this.challenges.set(from, { commitment: signal.commitment, challenge })
      void relay.request('signal', {
        to: from,
        data: { type: 'join-challenge', challenge: toBase64Url(challenge), signing: toBase64Url(this.keys.publicKeys.signing), agreement: toBase64Url(this.keys.publicKeys.agreement) },
      }).catch(() => {
        // The connection dropped; the joining device can ask again.
      })
      return
    }
    if (signal?.type !== 'join-reveal') return
    const pending = this.challenges.get(from)
    this.challenges.delete(from)
    if (pending === undefined) return
    const joining = keysOf(signal)
    const opening = fromBase64Url(signal.opening, 32)
    if (!verifyCommitment(pending.commitment, joining, opening)) return
    const id = randomUUID()
    const code = approvalCode({ joining, opening, challenge: pending.challenge, approver: this.keys.publicKeys })
    this.requests.set(id, { id, code, keys: joining })
    this.changed()
  }
}
