import type { Branded, BrandedNumber } from '@aeven/brand'

/** Stable device identifier: base64url of the first 16 bytes of SHA-256 over the device's two public keys. */
export type DeviceId = Branded<'SyncDeviceId'>

/** Server-visible identifier of one document or stream; an HMAC of its logical name. */
export type OpaqueId = Branded<'SyncOpaqueId'>

/** Generation of the vault key; 0 at genesis, incremented by every device removal. */
export type KeyEpoch = BrandedNumber<'SyncKeyEpoch'>

/** Raw 32-byte public keys of one device. */
export interface DevicePublicKeys {
  /** Ed25519 public key that verifies the device's envelopes and chain entries. */
  signing: Uint8Array
  /** X25519 public key that vault keys are wrapped to. */
  agreement: Uint8Array
}

/** Raw 32-byte secret keys of one device; stored only on that device. */
export interface DeviceSecretKeys {
  /** Ed25519 private seed. */
  signing: Uint8Array
  /** X25519 private key. */
  agreement: Uint8Array
}

/** One device's identity and keys. */
export interface DeviceKeys {
  /** Identifier derived from {@link publicKeys}. */
  id: DeviceId
  /** Keys other devices and the server may hold. */
  publicKeys: DevicePublicKeys
  /** Keys that never leave the device. */
  secretKeys: DeviceSecretKeys
}

/** Every vault key generation a device holds, by epoch. */
export type Keyring = ReadonlyMap<KeyEpoch, Uint8Array>

/** What one envelope carries. */
export type EnvelopeKind = 'update' | 'snapshot' | 'stream'

/** Plaintext envelope fields: authenticated, readable by the server for routing, never secret. */
export interface EnvelopeHeader {
  /** Envelope format version; this package writes and reads 1. */
  v: 1
  /** Payload kind. */
  kind: EnvelopeKind
  /** Document or stream the payload belongs to. */
  id: OpaqueId
  /** Vault key generation the payload is encrypted under. */
  epoch: KeyEpoch
  /** Sending device. */
  device: DeviceId
  /**
   * Sender's counter for this id. Receivers drop a frame whose counter does not exceed the last one accepted
   * from the same device for the same id; this package does not track counters.
   */
  counter: number
}

/** A device as recorded in the device chain. Names and other descriptions live in an encrypted document. */
export interface ChainDevice {
  /** Identifier derived from the two keys. */
  id: DeviceId
  /** base64url Ed25519 public key. */
  signing: string
  /** base64url X25519 public key. */
  agreement: string
}

/** The recovery key as recorded in the device chain. */
export interface RecoveryRecord {
  /** base64url Ed25519 public key that signs `add-device` entries for the passkey holder. */
  signing: string
  /** base64url X25519 public key that every new keyring is wrapped to. */
  agreement: string
}

/** One change to the set of devices or the recovery key. */
export type ChainBody =
  | { type: 'genesis'; device: ChainDevice }
  | { type: 'add-device'; device: ChainDevice }
  /**
   * `until` is the last relay sequence number the removing device had received: frames the removed device
   * published up to it stay valid history, and later ones are refused.
   */
  | { type: 'remove-device'; device: DeviceId; epoch: KeyEpoch; until: number }
  | { type: 'set-recovery'; recovery: RecoveryRecord }

/** One signed, hash-linked device chain entry. */
export interface ChainEntry {
  /** Position in the chain, starting at 0. */
  index: number
  /** base64url SHA-256 of the previous entry's canonical encoding; empty for genesis. */
  previous: string
  /** The change. */
  body: ChainBody
  /** Signing device, or `recovery` for the passkey-derived recovery key. */
  signer: DeviceId | 'recovery'
  /** base64url Ed25519 signature over the canonical encoding of every other field. */
  signature: string
}

/** A removed device as the chain remembers it, so its earlier frames stay readable. */
export interface RemovedDevice {
  /** Raw Ed25519 public key that verified its frames. */
  signing: Uint8Array
  /** The last relay sequence number at which its frames are accepted. */
  until: number
}

/** The vault membership a valid chain establishes. */
export interface ChainState {
  /** Active devices and their public keys. */
  devices: ReadonlyMap<DeviceId, DevicePublicKeys>
  /** Devices that were removed; they cannot be added again. */
  removed: ReadonlyMap<DeviceId, RemovedDevice>
  /** The recovery key's public keys, once one is set. */
  recovery?: DevicePublicKeys
  /** Current vault key epoch. */
  epoch: KeyEpoch
  /** Number of entries verified. */
  length: number
  /** base64url hash of the last entry; the next entry's `previous`. */
  head: string
}

/**
 * Keys derived from a passkey PRF result: the same two key kinds a device holds. Devices wrap every keyring
 * to the public agreement key, so only the passkey holder can unwrap it; the signing key admits a device.
 */
export interface RecoveryKeys {
  /** Keys `set-recovery` records. */
  publicKeys: DevicePublicKeys
  /** Keys that exist only while the passkey's PRF result is in hand. */
  secretKeys: DeviceSecretKeys
}
