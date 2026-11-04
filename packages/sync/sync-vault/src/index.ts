/**
 * Account sync cryptography: the account key, opaque ids, encrypted envelopes, the proof devices exchange when
 * they link on a local network, and the account key wrapped under a passkey's PRF output. Library only; holds no
 * state.
 * @module @aeven/sync-vault
 */
export * from './types.ts'
export {
  contentKeyOf, derivedSecretOf, fromBase64Url, generateDeviceId, generateVaultKey, opaqueIdOf, proveKey, SyncVaultError, toBase64Url,
  verifyKeyProof,
} from './keys.ts'
export { openEnvelope, readEnvelopeHeader, sealEnvelope } from './envelope.ts'
export type { SealEnvelopeInput } from './envelope.ts'
export {
  generateHostKeys, keyIdOf, openSealedForHost, PASSKEY_PRF_SALT, PRF_BYTES, unwrapUnderPasskey, wrapUnderPasskey,
} from './passkey.ts'
export type { HostKeyPair } from './passkey.ts'
