/** The account key, keys derived from it, and AES-256-GCM sealing on `node:crypto` primitives. */
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'
import { brandString } from '@aeven/brand'
import type { DeviceId, OpaqueId } from './types.ts'

const NONCE_BYTES = 12
const TAG_BYTES = 16

/** A malformed or unauthenticated vault value. */
export class SyncVaultError extends Error {
  override name = 'SyncVaultError'
}

/**
 * Encode bytes as unpadded base64url.
 * @param bytes - bytes to encode.
 * @returns base64url text.
 */
export function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

/**
 * Decode unpadded base64url, requiring an exact byte length when given.
 * @param text - base64url text.
 * @param length - required decoded length.
 * @returns the decoded bytes.
 * @throws {SyncVaultError} when the decoded length differs from `length`.
 */
export function fromBase64Url(text: string, length?: number): Uint8Array {
  const bytes = new Uint8Array(Buffer.from(text, 'base64url'))
  if (length !== undefined && bytes.length !== length) throw new SyncVaultError(`expected ${String(length)} bytes, got ${String(bytes.length)}`)
  return bytes
}

/**
 * Generate a device id.
 * @returns 16 random bytes as base64url.
 */
export function generateDeviceId(): DeviceId {
  return brandString<DeviceId>(toBase64Url(randomBytes(16)))
}

/**
 * Generate an account key.
 * @returns 32 random bytes.
 */
export function generateVaultKey(): Uint8Array {
  return new Uint8Array(randomBytes(32))
}

function hkdf(key: Uint8Array, salt: Uint8Array, info: string): Uint8Array {
  return new Uint8Array(hkdfSync('sha256', key, salt, info, 32))
}

/**
 * Derive the opaque id the relay sees for a logical document or stream name.
 * @param accountKey - the account key.
 * @param name - logical name, such as `memory/traces/yf`.
 * @returns the opaque id.
 */
export function opaqueIdOf(accountKey: Uint8Array, name: string): OpaqueId {
  const naming = hkdf(accountKey, new Uint8Array(0), 'aeven-sync/naming')
  return brandString<OpaqueId>(toBase64Url(createHmac('sha256', naming).update(name).digest()))
}

/**
 * Derive the AES-256 key for one id.
 * @param vaultKey - the account key.
 * @param id - document or stream id.
 * @returns the 32-byte content key.
 */
export function contentKeyOf(vaultKey: Uint8Array, id: OpaqueId): Uint8Array {
  return hkdf(vaultKey, new Uint8Array(0), `aeven-sync/content/${id}`)
}

/**
 * AES-256-GCM encrypt with a random nonce.
 * @param key - 32-byte key.
 * @param plaintext - bytes to encrypt.
 * @param aad - authenticated associated data.
 * @returns nonce, ciphertext, and tag, concatenated.
 */
export function seal(key: Uint8Array, plaintext: Uint8Array, aad: Uint8Array): Uint8Array {
  const nonce = randomBytes(NONCE_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  cipher.setAAD(aad)
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return new Uint8Array(Buffer.concat([nonce, body, cipher.getAuthTag()]))
}

/**
 * Reverse {@link seal}.
 * @param key - 32-byte key.
 * @param sealed - nonce, ciphertext, and tag.
 * @param aad - the associated data used at sealing.
 * @returns the plaintext.
 * @throws {SyncVaultError} when the value is truncated or fails authentication.
 */
export function open(key: Uint8Array, sealed: Uint8Array, aad: Uint8Array): Uint8Array {
  if (sealed.length < NONCE_BYTES + TAG_BYTES) throw new SyncVaultError('sealed value is truncated')
  const decipher = createDecipheriv('aes-256-gcm', key, sealed.subarray(0, NONCE_BYTES))
  decipher.setAAD(aad)
  decipher.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES))
  try {
    return new Uint8Array(Buffer.concat([decipher.update(sealed.subarray(NONCE_BYTES, sealed.length - TAG_BYTES)), decipher.final()]))
  } catch {
    // final() throws only on a failed tag check; the caller sees one authentication error.
    throw new SyncVaultError('sealed value failed authentication')
  }
}

/**
 * Prove holding the account key over some bytes, for devices that link on a local network.
 * @param accountKey - the account key.
 * @param data - the bytes to authenticate.
 * @returns the 32-byte proof.
 */
export function proveKey(accountKey: Uint8Array, data: Uint8Array): Uint8Array {
  const linking = hkdf(accountKey, new Uint8Array(0), 'aeven-sync/link')
  return new Uint8Array(createHmac('sha256', linking).update(data).digest())
}

/**
 * Check a {@link proveKey} proof.
 * @param accountKey - the account key.
 * @param data - the authenticated bytes.
 * @param proof - the proof to check.
 * @returns whether the proof was made with `accountKey` over `data`.
 */
export function verifyKeyProof(accountKey: Uint8Array, data: Uint8Array, proof: Uint8Array): boolean {
  const expected = proveKey(accountKey, data)
  return proof.length === expected.length && timingSafeEqual(proof, expected)
}
