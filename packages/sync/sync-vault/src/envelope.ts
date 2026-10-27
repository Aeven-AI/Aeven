/**
 * Envelope frames: `[version u8][header length u16 BE][header JSON][nonce|ciphertext|tag][Ed25519 signature 64]`.
 * The header is the AES-GCM associated data; the signature covers every preceding byte.
 */
import { brandNumber, brandString } from '@aeven/brand'
import { contentKeyOf, open, seal, signBytes, SyncVaultError, verifyBytes } from './keys.ts'
import type { DeviceId, DeviceKeys, EnvelopeHeader, EnvelopeKind, KeyEpoch, OpaqueId } from './types.ts'

const FRAME_VERSION = 1
const SIGNATURE_BYTES = 64
const KINDS: ReadonlySet<string> = new Set<EnvelopeKind>(['update', 'snapshot', 'stream'])

/** Fields the sender chooses for one envelope. */
export interface SealEnvelopeInput {
  /** Payload kind. */
  kind: EnvelopeKind
  /** Document or stream id. */
  id: OpaqueId
  /** Epoch of `vaultKey`. */
  epoch: KeyEpoch
  /** Vault key of `epoch`. */
  vaultKey: Uint8Array
  /** Sending device. */
  sender: DeviceKeys
  /** Sender's next counter for `id`. */
  counter: number
  /** Plaintext payload. */
  payload: Uint8Array
}

/**
 * Encrypt and sign one payload.
 * @param input - envelope fields, key, sender, and payload.
 * @returns the frame.
 */
export function sealEnvelope(input: SealEnvelopeInput): Uint8Array {
  const header: EnvelopeHeader = {
    v: 1, kind: input.kind, id: input.id, epoch: input.epoch, device: input.sender.id, counter: input.counter,
  }
  const headerBytes = new TextEncoder().encode(JSON.stringify(header))
  const prefix = Buffer.alloc(3)
  prefix.writeUInt8(FRAME_VERSION, 0)
  prefix.writeUInt16BE(headerBytes.length, 1)
  const aad = Buffer.concat([prefix, headerBytes])
  const signed = Buffer.concat([aad, seal(contentKeyOf(input.vaultKey, input.id), input.payload, aad)])
  return new Uint8Array(Buffer.concat([signed, signBytes(input.sender.secretKeys.signing, signed)]))
}

/** The parts of a frame. */
interface FrameParts {
  header: EnvelopeHeader
  aad: Uint8Array
  sealed: Uint8Array
  signed: Uint8Array
  signature: Uint8Array
}

function split(frame: Uint8Array): FrameParts {
  if (frame.length < 3 + SIGNATURE_BYTES || frame[0] !== FRAME_VERSION) throw new SyncVaultError('unsupported envelope')
  const headerLength = Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength).readUInt16BE(1)
  const aadEnd = 3 + headerLength
  if (aadEnd > frame.length - SIGNATURE_BYTES) throw new SyncVaultError('envelope is truncated')
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(frame.subarray(3, aadEnd)))
  } catch {
    // Only a malformed header reaches here; it is reported as a malformed envelope.
    throw new SyncVaultError('envelope header is not JSON')
  }
  const h = parsed as Record<string, unknown>
  if (
    typeof parsed !== 'object' || parsed === null || h.v !== 1 || typeof h.kind !== 'string' || !KINDS.has(h.kind)
    || typeof h.id !== 'string' || typeof h.device !== 'string'
    || !Number.isSafeInteger(h.epoch) || (h.epoch as number) < 0
    || !Number.isSafeInteger(h.counter) || (h.counter as number) < 0
  ) throw new SyncVaultError('envelope header is malformed')
  const header: EnvelopeHeader = {
    v: 1,
    kind: h.kind as EnvelopeKind,
    id: brandString<OpaqueId>(h.id),
    epoch: brandNumber<KeyEpoch>(h.epoch as number),
    device: brandString<DeviceId>(h.device),
    counter: h.counter as number,
  }
  const signedEnd = frame.length - SIGNATURE_BYTES
  return {
    header,
    aad: frame.subarray(0, aadEnd),
    sealed: frame.subarray(aadEnd, signedEnd),
    signed: frame.subarray(0, signedEnd),
    signature: frame.subarray(signedEnd),
  }
}

/**
 * Read an envelope's header without verifying or decrypting it, for routing by a party without keys.
 * @param frame - the frame.
 * @returns the unverified header.
 * @throws {SyncVaultError} when the frame is malformed.
 */
export function readEnvelopeHeader(frame: Uint8Array): EnvelopeHeader {
  return split(frame).header
}

/** Key lookups a receiver supplies to {@link openEnvelope}. */
export interface OpenEnvelopeKeys {
  /**
   * Vault key of an epoch.
   * @param epoch - the header's epoch.
   * @returns the key, or undefined when the receiver does not hold that epoch.
   */
  vaultKey(epoch: KeyEpoch): Uint8Array | undefined
  /**
   * Signing key of a device that may send envelopes now.
   * @param device - the header's device.
   * @returns the raw Ed25519 public key, or undefined when the device is not active in the chain.
   */
  signingKey(device: DeviceId): Uint8Array | undefined
}

/**
 * Verify and decrypt one envelope.
 * @param frame - the frame.
 * @param keys - the receiver's key lookups.
 * @returns the verified header and plaintext payload.
 * @throws {SyncVaultError} when the frame is malformed, its sender is not active, its signature fails, its
 * epoch is unknown, or its ciphertext fails authentication.
 */
export function openEnvelope(frame: Uint8Array, keys: OpenEnvelopeKeys): { header: EnvelopeHeader; payload: Uint8Array } {
  const parts = split(frame)
  const signingKey = keys.signingKey(parts.header.device)
  if (signingKey === undefined) throw new SyncVaultError(`envelope sender ${parts.header.device} is not an active device`)
  if (!verifyBytes(signingKey, parts.signed, parts.signature)) throw new SyncVaultError('envelope signature is invalid')
  const vaultKey = keys.vaultKey(parts.header.epoch)
  if (vaultKey === undefined) throw new SyncVaultError(`envelope epoch ${String(parts.header.epoch)} is not held`)
  return { header: parts.header, payload: open(contentKeyOf(vaultKey, parts.header.id), parts.sealed, parts.aad) }
}
