import type { DeviceId, OpaqueId } from './types.ts';
/** A malformed or unauthenticated vault value. */
export declare class SyncVaultError extends Error {
    name: string;
}
/**
 * Encode bytes as unpadded base64url.
 * @param bytes - bytes to encode.
 * @returns base64url text.
 */
export declare function toBase64Url(bytes: Uint8Array): string;
/**
 * Decode unpadded base64url, requiring an exact byte length when given.
 * @param text - base64url text.
 * @param length - required decoded length.
 * @returns the decoded bytes.
 * @throws {SyncVaultError} when the decoded length differs from `length`.
 */
export declare function fromBase64Url(text: string, length?: number): Uint8Array;
/**
 * Generate a device id.
 * @returns 16 random bytes as base64url.
 */
export declare function generateDeviceId(): DeviceId;
/**
 * Generate an account key.
 * @returns 32 random bytes.
 */
export declare function generateVaultKey(): Uint8Array;
/**
 * Derive the opaque id the relay sees for a logical document or stream name.
 * @param accountKey - the account key.
 * @param name - logical name, such as `memory/traces/yf`.
 * @returns the opaque id.
 */
export declare function opaqueIdOf(accountKey: Uint8Array, name: string): OpaqueId;
/**
 * Derive the AES-256 key for one id.
 * @param vaultKey - the account key.
 * @param id - document or stream id.
 * @returns the 32-byte content key.
 */
export declare function contentKeyOf(vaultKey: Uint8Array, id: OpaqueId): Uint8Array;
/**
 * AES-256-GCM encrypt with a random nonce.
 * @param key - 32-byte key.
 * @param plaintext - bytes to encrypt.
 * @param aad - authenticated associated data.
 * @returns nonce, ciphertext, and tag, concatenated.
 */
export declare function seal(key: Uint8Array, plaintext: Uint8Array, aad: Uint8Array): Uint8Array;
/**
 * Reverse {@link seal}.
 * @param key - 32-byte key.
 * @param sealed - nonce, ciphertext, and tag.
 * @param aad - the associated data used at sealing.
 * @returns the plaintext.
 * @throws {SyncVaultError} when the value is truncated or fails authentication.
 */
export declare function open(key: Uint8Array, sealed: Uint8Array, aad: Uint8Array): Uint8Array;
/**
 * Prove holding the account key over some bytes, for devices that link on a local network.
 * @param accountKey - the account key.
 * @param data - the bytes to authenticate.
 * @returns the 32-byte proof.
 */
export declare function proveKey(accountKey: Uint8Array, data: Uint8Array): Uint8Array;
/**
 * Check a {@link proveKey} proof.
 * @param accountKey - the account key.
 * @param data - the authenticated bytes.
 * @param proof - the proof to check.
 * @returns whether the proof was made with `accountKey` over `data`.
 */
export declare function verifyKeyProof(accountKey: Uint8Array, data: Uint8Array, proof: Uint8Array): boolean;
//# sourceMappingURL=keys.d.ts.map