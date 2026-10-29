/**
 * Envelope frames: `[version u8][header length u16 BE][header JSON][nonce|ciphertext|tag]`. The header is the
 * AES-GCM associated data, so the account key authenticates both header and payload.
 */
import { brandString } from '@aeven/brand';
import { contentKeyOf, open, seal, SyncVaultError } from "./keys.js";
const FRAME_VERSION = 2;
/** AES-GCM nonce and tag around the ciphertext. */
const SEALED_OVERHEAD = 12 + 16;
const KINDS = new Set(['update', 'snapshot', 'stream']);
/**
 * Encrypt one payload.
 * @param input - envelope fields, key, sender, and payload.
 * @returns the frame.
 */
export function sealEnvelope(input) {
    const header = { v: 2, kind: input.kind, id: input.id, device: input.device, counter: input.counter,
        ...input.fragment === undefined ? {} : { fragment: input.fragment },
    };
    const headerBytes = new TextEncoder().encode(JSON.stringify(header));
    const prefix = Buffer.alloc(3);
    prefix.writeUInt8(FRAME_VERSION, 0);
    prefix.writeUInt16BE(headerBytes.length, 1);
    const aad = Buffer.concat([prefix, headerBytes]);
    return new Uint8Array(Buffer.concat([aad, seal(contentKeyOf(input.accountKey, input.id), input.payload, aad)]));
}
function split(frame) {
    if (frame.length < 3 + SEALED_OVERHEAD || frame[0] !== FRAME_VERSION)
        throw new SyncVaultError('unsupported envelope');
    const aadEnd = 3 + Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength).readUInt16BE(1);
    if (aadEnd > frame.length - SEALED_OVERHEAD)
        throw new SyncVaultError('envelope is truncated');
    let parsed;
    try {
        parsed = JSON.parse(new TextDecoder().decode(frame.subarray(3, aadEnd)));
    }
    catch {
        // Only a malformed header reaches here; it is reported as a malformed envelope.
        throw new SyncVaultError('envelope header is not JSON');
    }
    const h = parsed;
    if (typeof parsed !== 'object' || parsed === null || h.v !== 2 || typeof h.kind !== 'string' || !KINDS.has(h.kind)
        || typeof h.id !== 'string' || typeof h.device !== 'string'
        || !Number.isSafeInteger(h.counter) || h.counter < 0)
        throw new SyncVaultError('envelope header is malformed');
    const fragment = h.fragment;
    if (fragment !== undefined && (fragment === null || typeof fragment !== 'object' || typeof fragment.id !== 'string' || !/^[a-f0-9]{64}$/.test(fragment.id)
        || !Number.isSafeInteger(fragment.index) || !Number.isSafeInteger(fragment.count)
        || fragment.index < 0 || fragment.count < 2 || fragment.index >= fragment.count))
        throw new SyncVaultError('envelope fragment is malformed');
    const header = {
        v: 2,
        kind: h.kind,
        id: brandString(h.id),
        device: brandString(h.device),
        counter: h.counter,
        ...fragment === undefined ? {} : { fragment },
    };
    return { header, aad: frame.subarray(0, aadEnd), sealed: frame.subarray(aadEnd) };
}
/**
 * Read an envelope's header without decrypting it, for routing by a party without the key.
 * @param frame - the frame.
 * @returns the unauthenticated header.
 * @throws {SyncVaultError} when the frame is malformed.
 */
export function readEnvelopeHeader(frame) {
    return split(frame).header;
}
/**
 * Authenticate and decrypt one envelope.
 * @param frame - the frame.
 * @param accountKey - the account key.
 * @returns the header and plaintext payload.
 * @throws {SyncVaultError} when the frame is malformed or fails authentication under `accountKey`.
 */
export function openEnvelope(frame, accountKey) {
    const parts = split(frame);
    return { header: parts.header, payload: open(contentKeyOf(accountKey, parts.header.id), parts.sealed, parts.aad) };
}
//# sourceMappingURL=envelope.js.map