/**
 * Vault cryptography for account sync: device keys, vault key generations, opaque ids, signed and encrypted
 * envelopes, key wrapping, the device chain, and the device approval code. Library only; holds no state.
 * @module @aeven/sync-vault
 */
export * from './types.ts'
export {
  contentKeyOf, decodeKeyring, deviceIdOf, encodeKeyring, fromBase64Url, generateAgreementKeys, generateDeviceKeys,
  generateVaultKey, opaqueIdOf, RECOVERY_PRF_SALT, recoveryKeysOf, signBytes, SyncVaultError, toBase64Url,
  unwrapForDevice, verifyBytes, wrapForDevice,
} from './keys.ts'
export { openEnvelope, readEnvelopeHeader, sealEnvelope } from './envelope.ts'
export type { OpenEnvelopeKeys, SealEnvelopeInput } from './envelope.ts'
export { applyChainEntry, chainDeviceOf, createChainEntry, createGenesis, recoveryRecordOf, signingKeyAt, verifyChain } from './chain.ts'
export type { ChainSigner } from './chain.ts'
export { approvalCode, commitToKeys, verifyCommitment } from './approval.ts'
export type { ApprovalCodeInput } from './approval.ts'
