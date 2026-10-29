/**
 * Account sync cryptography: envelopes open only under the account key that sealed them, headers are readable for
 * routing and authenticated with the payload, malformed frames are refused, opaque ids hide names, and link proofs
 * check against the account key.
 */
import { describe, expect, it } from 'vitest'
import {
  fromBase64Url, generateDeviceId, generateVaultKey, opaqueIdOf, openEnvelope, proveKey, readEnvelopeHeader,
  sealEnvelope, SyncVaultError, toBase64Url, verifyKeyProof,
} from '../src/index.ts'

const key = generateVaultKey()
const device = generateDeviceId()
const id = opaqueIdOf(key, 'notes')

function frame(header: string, body = new Uint8Array(28)): Uint8Array {
  const json = Buffer.from(header)
  const prefix = Buffer.alloc(3)
  prefix.writeUInt8(2, 0)
  prefix.writeUInt16BE(json.length, 1)
  return new Uint8Array(Buffer.concat([prefix, json, body]))
}

describe('envelopes', () => {
  it('open under the account key that sealed them, with a readable header', () => {
    const sealed = sealEnvelope({ kind: 'update', id, accountKey: key, device, counter: 3, payload: Uint8Array.of(1, 2) })
    expect(readEnvelopeHeader(sealed)).toEqual({ v: 2, kind: 'update', id, device, counter: 3 })
    expect(openEnvelope(sealed, key).payload).toEqual(Uint8Array.of(1, 2))
    expect(() => openEnvelope(sealed, generateVaultKey())).toThrow(SyncVaultError)
    const tampered = new Uint8Array(sealed)
    tampered[10] = tampered[10]! ^ 1
    expect(() => openEnvelope(tampered, key)).toThrow(SyncVaultError)
  })

  it.each([
    ['another version', new Uint8Array(40).fill(1)],
    ['a truncated header', new Uint8Array([2, 0xff, 0xff, ...new Uint8Array(40)])],
    ['a header that is not JSON', frame('{')],
    ['a null header', frame('null')],
    ['an unknown kind', frame(JSON.stringify({ v: 2, kind: 'other', id: 'x', device: 'd', counter: 1 }))],
    ['a negative counter', frame(JSON.stringify({ v: 2, kind: 'update', id: 'x', device: 'd', counter: -1 }))],
    ['a null fragment', frame(JSON.stringify({ v: 2, kind: 'update', id: 'x', device: 'd', counter: 1, fragment: null }))],
    ['an invalid fragment id', frame(JSON.stringify({ v: 2, kind: 'update', id: 'x', device: 'd', counter: 1, fragment: { id: 'x', index: 0, count: 2 } }))],
    ['an out-of-range fragment', frame(JSON.stringify({ v: 2, kind: 'update', id: 'x', device: 'd', counter: 1, fragment: { id: 'a'.repeat(64), index: 2, count: 2 } }))],
    ['a fractional fragment count', frame(JSON.stringify({ v: 2, kind: 'update', id: 'x', device: 'd', counter: 1, fragment: { id: 'a'.repeat(64), index: 0, count: 2.5 } }))],
    ['a truncated ciphertext', frame(JSON.stringify({ v: 2, kind: 'update', id: 'x', device: 'd', counter: 1 }), new Uint8Array(28))],
  ])('refuse %s', (_label, data) => {
    expect(() => openEnvelope(data, key)).toThrow(SyncVaultError)
  })

  it('authenticates fragment positions with their payloads', () => {
    const fragment = { id: 'a'.repeat(64), index: 0, count: 2 }
    const sealed = sealEnvelope({ kind: 'stream', id, accountKey: key, device, counter: 1, fragment, payload: Uint8Array.of(7) })
    expect(openEnvelope(sealed, key)).toMatchObject({ header: { fragment }, payload: Uint8Array.of(7) })
    const tampered = Buffer.from(sealed)
    const headerEnd = 3 + tampered.readUInt16BE(1)
    const json = tampered.subarray(3, headerEnd).toString().replace('"index":0', '"index":1')
    tampered.write(json, 3)
    expect(() => openEnvelope(tampered, key)).toThrow(SyncVaultError)
  })
})

describe('keys', () => {
  it('derive stable opaque ids that hide names, and fresh device ids', () => {
    expect(opaqueIdOf(key, 'notes')).toBe(id)
    expect(id).not.toContain('notes')
    expect(generateDeviceId()).not.toBe(device)
  })

  it('prove holding the account key', () => {
    const data = Uint8Array.of(1, 2, 3)
    const proof = proveKey(key, data)
    expect(verifyKeyProof(key, data, proof)).toBe(true)
    expect(verifyKeyProof(generateVaultKey(), data, proof)).toBe(false)
    expect(verifyKeyProof(key, data, proof.subarray(1))).toBe(false)
  })

  it('round-trip base64url and check lengths', () => {
    expect(fromBase64Url(toBase64Url(key), 32)).toEqual(key)
    expect(() => fromBase64Url(toBase64Url(key), 16)).toThrow(SyncVaultError)
  })
})
