import type { Branded } from '@aeven/brand'

/** Random identifier one device of an account chose for itself; it names the sender of the device's frames. */
export type DeviceId = Branded<'SyncDeviceId'>

/** Server-visible identifier of one document or stream; an HMAC of its logical name under the account key. */
export type OpaqueId = Branded<'SyncOpaqueId'>

/** What one envelope carries. */
export type EnvelopeKind = 'update' | 'snapshot' | 'stream'

/** Plaintext envelope fields: authenticated, readable by the relay for routing, never secret. */
export interface EnvelopeHeader {
  /** Envelope format version; this package writes and reads 2. */
  v: 2
  /** Payload kind. */
  kind: EnvelopeKind
  /** Document or stream the payload belongs to. */
  id: OpaqueId
  /** Sending device. */
  device: DeviceId
  /**
   * Sender's counter for this id. Receivers drop a frame whose counter does not exceed the last one accepted
   * from the same device for the same id; this package does not track counters.
   */
  counter: number
}
