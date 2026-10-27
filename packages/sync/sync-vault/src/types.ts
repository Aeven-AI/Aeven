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

/** One change to the set of devices or the recovery key. */
export type ChainBody =
  | { type: 'genesis'; device: ChainDevice }
  | { type: 'add-device'; device: ChainDevice }
  | { type: 'remove-device'; device: DeviceId; epoch: KeyEpoch }
  | { type: 'set-recovery'; recovery: string }

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

/** The vault membership a valid chain establishes. */
export interface ChainState {
  /** Active devices and their public keys. */
  devices: ReadonlyMap<DeviceId, DevicePublicKeys>
  /** Devices that were removed; they cannot be added again. */
  removed: ReadonlySet<DeviceId>
  /** Raw recovery signing key, once one is set. */
  recovery?: Uint8Array
  /** Current vault key epoch. */
  epoch: KeyEpoch
  /** Number of entries verified. */
  length: number
  /** base64url hash of the last entry; the next entry's `previous`. */
  head: string
}

/** Keys derived from a passkey PRF result. */
export interface RecoveryKeys {
  /** AES-256 key that wraps the keyring for passkey unlock. */
  wrappingKey: Uint8Array
  /** Ed25519 seed that signs chain entries on behalf of the passkey holder. */
  signingSeed: Uint8Array
  /** Ed25519 public key recorded by `set-recovery`. */
  signingPublicKey: Uint8Array
}
