import type { DeviceId, EnvelopeHeader, EnvelopeKind, OpaqueId } from './types.ts';
/** Fields the sender chooses for one envelope. */
export interface SealEnvelopeInput {
    /** Payload kind. */
    kind: EnvelopeKind;
    /** Document or stream id. */
    id: OpaqueId;
    /** The account key. */
    accountKey: Uint8Array;
    /** Sending device. */
    device: DeviceId;
    /** Sender's next counter for `id`. */
    counter: number;
    /** Plaintext payload. */
    payload: Uint8Array;
    /** Transport part metadata, authenticated with the ciphertext. */
    fragment?: EnvelopeHeader['fragment'];
}
/**
 * Encrypt one payload.
 * @param input - envelope fields, key, sender, and payload.
 * @returns the frame.
 */
export declare function sealEnvelope(input: SealEnvelopeInput): Uint8Array;
/**
 * Read an envelope's header without decrypting it, for routing by a party without the key.
 * @param frame - the frame.
 * @returns the unauthenticated header.
 * @throws {SyncVaultError} when the frame is malformed.
 */
export declare function readEnvelopeHeader(frame: Uint8Array): EnvelopeHeader;
/**
 * Authenticate and decrypt one envelope.
 * @param frame - the frame.
 * @param accountKey - the account key.
 * @returns the header and plaintext payload.
 * @throws {SyncVaultError} when the frame is malformed or fails authentication under `accountKey`.
 */
export declare function openEnvelope(frame: Uint8Array, accountKey: Uint8Array): {
    header: EnvelopeHeader;
    payload: Uint8Array;
};
//# sourceMappingURL=envelope.d.ts.map