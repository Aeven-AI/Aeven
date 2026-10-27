/** Device keys, vault keys, derived per-id keys, and key wrapping on `node:crypto` primitives. */
import {
  createCipheriv, createDecipheriv, createHash, createHmac, createPrivateKey, createPublicKey,
  diffieHellman, generateKeyPairSync, hkdfSync, randomBytes, sign, verify,
  type KeyObject,
} from 'node:crypto'
import { brandNumber, brandString } from '@aeven/brand'
import type { DeviceId, DeviceKeys, DevicePublicKeys, KeyEpoch, Keyring, OpaqueId, RecoveryKeys } from './types.ts'

const ED25519_SPKI = Buffer.from('302a300506032b6570032100', 'hex')
const ED25519_PKCS8 = Buffer.from('302e020100300506032b657004220420', 'hex')
const X25519_SPKI = Buffer.from('302a300506032b656e032100', 'hex')
const X25519_PKCS8 = Buffer.from('302e020100300506032b656e04220420', 'hex')
const WRAP_VERSION = 1
const NONCE_BYTES = 12
const TAG_BYTES = 16

/** A malformed, unauthenticated, or unauthorized vault value. */
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

function rawPublic(key: KeyObject): Uint8Array {
  return new Uint8Array(key.export({ format: 'der', type: 'spki' }).subarray(-32))
}

function rawPrivate(key: KeyObject): Uint8Array {
  return new Uint8Array(key.export({ format: 'der', type: 'pkcs8' }).subarray(-32))
}

function ed25519Private(seed: Uint8Array): KeyObject {
  return createPrivateKey({ key: Buffer.concat([ED25519_PKCS8, seed]), format: 'der', type: 'pkcs8' })
}

function ed25519Public(raw: Uint8Array): KeyObject {
  return createPublicKey({ key: Buffer.concat([ED25519_SPKI, raw]), format: 'der', type: 'spki' })
}

function x25519Private(raw: Uint8Array): KeyObject {
  return createPrivateKey({ key: Buffer.concat([X25519_PKCS8, raw]), format: 'der', type: 'pkcs8' })
}

function x25519Public(raw: Uint8Array): KeyObject {
  return createPublicKey({ key: Buffer.concat([X25519_SPKI, raw]), format: 'der', type: 'spki' })
}

/**
 * Derive a device id from its public keys.
 * @param keys - the device's public keys.
 * @returns the device id.
 */
export function deviceIdOf(keys: DevicePublicKeys): DeviceId {
  const digest = createHash('sha256').update(keys.signing).update(keys.agreement).digest()
  return brandString<DeviceId>(toBase64Url(digest.subarray(0, 16)))
}

/**
 * Generate a new device identity.
 * @returns fresh signing and agreement key pairs with the derived id.
 */
export function generateDeviceKeys(): DeviceKeys {
  const signing = generateKeyPairSync('ed25519')
  const agreement = generateKeyPairSync('x25519')
  const publicKeys = { signing: rawPublic(signing.publicKey), agreement: rawPublic(agreement.publicKey) }
  return {
    id: deviceIdOf(publicKeys),
    publicKeys,
    secretKeys: { signing: rawPrivate(signing.privateKey), agreement: rawPrivate(agreement.privateKey) },
  }
}

/**
 * Sign bytes with an Ed25519 seed.
 * @param seed - 32-byte Ed25519 private seed.
 * @param data - bytes to sign.
 * @returns the 64-byte signature.
 */
export function signBytes(seed: Uint8Array, data: Uint8Array): Uint8Array {
  return new Uint8Array(sign(null, data, ed25519Private(seed)))
}

/**
 * Verify an Ed25519 signature.
 * @param publicKey - 32-byte raw Ed25519 public key.
 * @param data - signed bytes.
 * @param signature - signature to check.
 * @returns whether the signature is valid for `data` under `publicKey`.
 */
export function verifyBytes(publicKey: Uint8Array, data: Uint8Array, signature: Uint8Array): boolean {
  return signature.length === 64 && verify(null, data, ed25519Public(publicKey), signature)
}

/**
 * Generate a vault key for one epoch.
 * @returns 32 random bytes.
 */
export function generateVaultKey(): Uint8Array {
  return new Uint8Array(randomBytes(32))
}

function hkdf(key: Uint8Array, salt: Uint8Array, info: string): Uint8Array {
  return new Uint8Array(hkdfSync('sha256', key, salt, info, 32))
}

/**
 * Derive the opaque id the server sees for a logical document or stream name. The naming key is the
 * genesis-epoch vault key, so ids stay stable across key rotation; a removed device can still map names it
 * knows to future ids, which reveals which document changed but not its content.
 * @param genesisKey - the epoch-0 vault key.
 * @param name - logical name, such as `memory/traces/yf`.
 * @returns the opaque id.
 */
export function opaqueIdOf(genesisKey: Uint8Array, name: string): OpaqueId {
  const naming = hkdf(genesisKey, new Uint8Array(0), 'aeven-sync/naming')
  return brandString<OpaqueId>(toBase64Url(createHmac('sha256', naming).update(name).digest()))
}

/**
 * Derive the AES-256 key for one id under one epoch's vault key.
 * @param vaultKey - the epoch's vault key.
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
 * Encode a keyring for wrapping.
 * @param keyring - every epoch's vault key.
 * @returns JSON bytes mapping epoch to base64url key.
 */
export function encodeKeyring(keyring: Keyring): Uint8Array {
  const entries = [...keyring].sort(([a], [b]) => a - b).map(([epoch, key]) => [epoch, toBase64Url(key)])
  return new TextEncoder().encode(JSON.stringify(entries))
}

/**
 * Decode a keyring produced by {@link encodeKeyring}.
 * @param bytes - JSON bytes.
 * @returns the keyring.
 * @throws {SyncVaultError} when the value is not a keyring.
 */
export function decodeKeyring(bytes: Uint8Array): Keyring {
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    // Only malformed JSON reaches here; it is reported as a malformed keyring.
    throw new SyncVaultError('keyring is not JSON')
  }
  if (!Array.isArray(parsed)) throw new SyncVaultError('keyring is not a list')
  const keyring = new Map<KeyEpoch, Uint8Array>()
  for (const entry of parsed as unknown[]) {
    if (!Array.isArray(entry) || !Number.isSafeInteger(entry[0]) || entry[0] < 0 || typeof entry[1] !== 'string') {
      throw new SyncVaultError('keyring entry is malformed')
    }
    keyring.set(brandNumber<KeyEpoch>(entry[0] as number), fromBase64Url(entry[1], 32))
  }
  return keyring
}

/**
 * Wrap a secret to a device's X25519 key (ephemeral-static ECDH, HKDF, AES-256-GCM).
 * @param secret - bytes to wrap, normally an encoded keyring.
 * @param recipient - the recipient's X25519 public key.
 * @returns version, ephemeral public key, and sealed secret.
 */
export function wrapForDevice(secret: Uint8Array, recipient: Uint8Array): Uint8Array {
  const ephemeral = generateKeyPairSync('x25519')
  const ephemeralPublic = rawPublic(ephemeral.publicKey)
  const shared = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: x25519Public(recipient) })
  const salt = Buffer.concat([ephemeralPublic, recipient])
  const key = hkdf(shared, salt, 'aeven-sync/wrap/device')
  const header = Buffer.concat([Buffer.of(WRAP_VERSION), ephemeralPublic])
  return new Uint8Array(Buffer.concat([header, seal(key, secret, header)]))
}

/**
 * Reverse {@link wrapForDevice}.
 * @param wrapped - the wrapped value.
 * @param agreementSecret - the recipient's X25519 private key.
 * @param agreementPublic - the recipient's X25519 public key.
 * @returns the secret.
 * @throws {SyncVaultError} when the value is malformed or was not wrapped to this key.
 */
export function unwrapForDevice(wrapped: Uint8Array, agreementSecret: Uint8Array, agreementPublic: Uint8Array): Uint8Array {
  if (wrapped.length < 33 || wrapped[0] !== WRAP_VERSION) throw new SyncVaultError('unsupported wrapped value')
  const header = wrapped.subarray(0, 33)
  const ephemeralPublic = wrapped.subarray(1, 33)
  const shared = diffieHellman({ privateKey: x25519Private(agreementSecret), publicKey: x25519Public(ephemeralPublic) })
  const key = hkdf(shared, Buffer.concat([ephemeralPublic, agreementPublic]), 'aeven-sync/wrap/device')
  return open(key, wrapped.subarray(33), header)
}

/** Salt the passkey PRF is evaluated with; every recovery ceremony uses the same one. */
export const RECOVERY_PRF_SALT: Uint8Array = new Uint8Array(createHash('sha256').update('aeven-sync/recovery/prf').digest())

/**
 * Derive recovery keys from a WebAuthn PRF result.
 * @param prfOutput - the PRF extension output for {@link RECOVERY_PRF_SALT}.
 * @returns the recovery signing and agreement key pairs.
 */
export function recoveryKeysOf(prfOutput: Uint8Array): RecoveryKeys {
  const signing = hkdf(prfOutput, new Uint8Array(0), 'aeven-sync/recovery/sign')
  const agreement = hkdf(prfOutput, new Uint8Array(0), 'aeven-sync/recovery/agree')
  return {
    publicKeys: {
      signing: rawPublic(createPublicKey(ed25519Private(signing))),
      agreement: rawPublic(createPublicKey(x25519Private(agreement))),
    },
    secretKeys: { signing, agreement },
  }
}

/**
 * Generate a one-use X25519 key pair, such as the one a passkey ceremony's result is wrapped to.
 * @returns the raw public and private keys.
 */
export function generateAgreementKeys(): { publicKey: Uint8Array; secretKey: Uint8Array } {
  const pair = generateKeyPairSync('x25519')
  return { publicKey: rawPublic(pair.publicKey), secretKey: rawPrivate(pair.privateKey) }
}
