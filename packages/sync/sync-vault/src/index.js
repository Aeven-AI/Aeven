/**
 * Account sync cryptography: the account key, opaque ids, encrypted envelopes, and the proof devices exchange
 * when they link on a local network. Library only; holds no state.
 * @module @aeven/sync-vault
 */
export * from "./types.js";
export { contentKeyOf, fromBase64Url, generateDeviceId, generateVaultKey, opaqueIdOf, proveKey, SyncVaultError, toBase64Url, verifyKeyProof, } from "./keys.js";
export { openEnvelope, readEnvelopeHeader, sealEnvelope } from "./envelope.js";
//# sourceMappingURL=index.js.map