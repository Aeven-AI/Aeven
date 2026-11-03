/**
 * Holding the account key under a passkey: the key id devices and the relay name a key by, the account key wrapped
 * under a WebAuthn PRF output, and the one-use X25519 key a passkey page seals that output to.
 */
import { createHash, createHmac, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, type KeyObject } from 'node:crypto'
import { brandString } from '@aeven/brand'
import { open, seal, SyncVaultError, toBase64Url } from './keys.ts'
import type { KeyId } from './types.ts'

const X25519_SPKI = Buffer.from('302a300506032b656e032100', 'hex')
const X25519_PKCS8 = Buffer.from('302e020100300506032b656e04220420', 'hex')
/** Version byte of a value {@link openSealedForHost} reads. */
const HOST_SEAL_VERSION = 1
/** Length of a WebAuthn PRF output. */
export const PRF_BYTES = 32

/** Salt every passkey ceremony evaluates the PRF with, so one passkey always yields the same output for Aeven. */
export const PASSKEY_PRF_SALT: Uint8Array = new Uint8Array(createHash('sha256').update('aeven-sync/passkey/prf').digest())

/**
 * The public id of an account key: the first 16 bytes of HMAC-SHA-256 over `aeven-sync/key-id` under the key. The
 * relay computes the same id for a key it holds; for a passkey-held key it only stores the id a device sent.
 * @param accountKey - the account key.
 * @returns the key id, base64url.
 */
export function keyIdOf(accountKey: Uint8Array): KeyId {
  return brandString<KeyId>(toBase64Url(createHmac('sha256', accountKey).update('aeven-sync/key-id').digest().subarray(0, 16)))
}

function passkeyWrapping(prf: Uint8Array, keyId: KeyId, credentialId: string): { key: Uint8Array; aad: Uint8Array } {
  if (prf.length !== PRF_BYTES) throw new SyncVaultError(`a passkey PRF output is ${String(PRF_BYTES)} bytes`)
  return {
    key: new Uint8Array(hkdfSync('sha256', prf, new Uint8Array(0), 'aeven-sync/passkey/wrap', 32)),
    aad: new TextEncoder().encode(`aeven-sync/passkey/v1|${keyId}|${credentialId}`),
  }
}

/**
 * Wrap the account key under one passkey's PRF output. The key id and credential id are authenticated, so a copy
 * opens only for the key and passkey it was made for.
 * @param prf - the passkey's PRF output for {@link PASSKEY_PRF_SALT}.
 * @param credentialId - the passkey's credential id, base64url.
 * @param accountKey - the account key.
 * @returns the wrapped key, base64url.
 */
export function wrapUnderPasskey(prf: Uint8Array, credentialId: string, accountKey: Uint8Array): string {
  const { key, aad } = passkeyWrapping(prf, keyIdOf(accountKey), credentialId)
  return toBase64Url(seal(key, accountKey, aad))
}

/**
 * Reverse {@link wrapUnderPasskey} and check the key against the id the relay named.
 * @param prf - the passkey's PRF output for {@link PASSKEY_PRF_SALT}.
 * @param credentialId - the passkey's credential id, base64url.
 * @param keyId - the key id the relay names.
 * @param wrapped - the wrapped key, base64url.
 * @returns the account key.
 * @throws {SyncVaultError} when the copy was not made with this passkey for this key.
 */
export function unwrapUnderPasskey(prf: Uint8Array, credentialId: string, keyId: KeyId, wrapped: string): Uint8Array {
  const { key, aad } = passkeyWrapping(prf, keyId, credentialId)
  const accountKey = open(key, new Uint8Array(Buffer.from(wrapped, 'base64url')), aad)
  if (accountKey.length !== 32 || keyIdOf(accountKey) !== keyId) throw new SyncVaultError('the unwrapped key does not match its id')
  return accountKey
}

function rawPublic(key: KeyObject): Uint8Array {
  return new Uint8Array(key.export({ format: 'der', type: 'spki' }).subarray(-32))
}

function x25519Private(raw: Uint8Array): KeyObject {
  return createPrivateKey({ key: Buffer.concat([X25519_PKCS8, raw]), format: 'der', type: 'pkcs8' })
}

function x25519Public(raw: Uint8Array): KeyObject {
  return createPublicKey({ key: Buffer.concat([X25519_SPKI, raw]), format: 'der', type: 'spki' })
}

/** A one-use X25519 key pair, raw. */
export interface HostKeyPair {
  /** The 32-byte public key the passkey page seals to. */
  readonly publicKey: Uint8Array
  /** The 32-byte private key that opens what was sealed. */
  readonly secretKey: Uint8Array
}

/**
 * Generate the one-use X25519 key pair a passkey ceremony's result is sealed to.
 * @returns the raw public and private keys.
 */
export function generateHostKeys(): HostKeyPair {
  const pair = generateKeyPairSync('x25519')
  return {
    publicKey: rawPublic(pair.publicKey),
    secretKey: new Uint8Array(pair.privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32)),
  }
}

/**
 * Open a value the passkey page sealed to this Host: version 1, the page's ephemeral X25519 public key, then an
 * AES-256-GCM nonce, ciphertext, and tag under HKDF-SHA-256 of the shared secret, salted with both public keys and
 * authenticated over the first 33 bytes.
 * @param sealed - the sealed value.
 * @param keys - the Host's one-use key pair.
 * @returns the plaintext.
 * @throws {SyncVaultError} when the value is malformed or was not sealed to this key.
 */
export function openSealedForHost(sealed: Uint8Array, keys: HostKeyPair): Uint8Array {
  if (sealed.length < 33 || sealed[0] !== HOST_SEAL_VERSION) throw new SyncVaultError('unsupported sealed value')
  const header = sealed.subarray(0, 33)
  const ephemeral = sealed.subarray(1, 33)
  const shared = diffieHellman({ privateKey: x25519Private(keys.secretKey), publicKey: x25519Public(ephemeral) })
  const key = new Uint8Array(hkdfSync('sha256', shared, Buffer.concat([ephemeral, keys.publicKey]), 'aeven-sync/wrap/device', 32))
  return open(key, sealed.subarray(33), header)
}
