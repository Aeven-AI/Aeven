/**
 * Vault cryptography behavior: envelopes open only for active senders and held epochs, wrapped keyrings open
 * only for their recipient, the device chain admits only authorized changes, and the approval code binds both
 * devices' keys.
 */
import { describe, expect, it } from 'vitest'
import { brandNumber, brandString } from '@aeven/brand'
import {
  applyChainEntry, approvalCode, chainDeviceOf, commitToKeys, contentKeyOf, createChainEntry, createGenesis,
  decodeKeyring, deviceIdOf, encodeKeyring, fromBase64Url, generateDeviceKeys, generateVaultKey, opaqueIdOf,
  openEnvelope, readEnvelopeHeader, recoveryKeysOf, sealEnvelope, signBytes, SyncVaultError, toBase64Url,
  unwrapForDevice, unwrapWithKey, verifyBytes, verifyChain, verifyCommitment, wrapForDevice, wrapWithKey,
  type ChainEntry, type DeviceId, type DeviceKeys, type KeyEpoch, type OpaqueId,
} from '../src/index.ts'

const epoch0 = brandNumber<KeyEpoch>(0)
const epoch1 = brandNumber<KeyEpoch>(1)
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)

function seal(sender: DeviceKeys, vaultKey: Uint8Array, payload = bytes('hello')): Uint8Array {
  return sealEnvelope({
    kind: 'update', id: brandString<OpaqueId>('doc'), epoch: epoch0, vaultKey, sender, counter: 7, payload,
  })
}

function keysFor(device: DeviceKeys, vaultKey: Uint8Array) {
  return {
    vaultKey: (e: KeyEpoch) => (e === epoch0 ? vaultKey : undefined),
    signingKey: (d: DeviceId) => (d === device.id ? device.publicKeys.signing : undefined),
  }
}

describe('envelopes', () => {
  const device = generateDeviceKeys()
  const vaultKey = generateVaultKey()

  it('round-trips a payload with its header', () => {
    const frame = seal(device, vaultKey)
    const opened = openEnvelope(frame, keysFor(device, vaultKey))
    expect(new TextDecoder().decode(opened.payload)).toBe('hello')
    expect(opened.header).toEqual({ v: 1, kind: 'update', id: 'doc', epoch: 0, device: device.id, counter: 7 })
    expect(readEnvelopeHeader(frame)).toEqual(opened.header)
  })

  it('does not carry the plaintext in the frame', () => {
    const frame = seal(device, vaultKey, bytes('a secret memory'))
    expect(Buffer.from(frame).includes(Buffer.from('a secret memory'))).toBe(false)
  })

  it('refuses a sender that is not active', () => {
    expect(() => openEnvelope(seal(generateDeviceKeys(), vaultKey), keysFor(device, vaultKey))).toThrow(/not an active device/)
  })

  it('refuses a frame whose signature does not match', () => {
    const frame = seal(device, vaultKey)
    frame[frame.length - 1]! ^= 1
    expect(() => openEnvelope(frame, keysFor(device, vaultKey))).toThrow(/signature is invalid/)
  })

  it('refuses an epoch the receiver does not hold', () => {
    const frame = sealEnvelope({
      kind: 'stream', id: brandString<OpaqueId>('s'), epoch: epoch1, vaultKey, sender: device, counter: 0, payload: bytes('x'),
    })
    expect(() => openEnvelope(frame, keysFor(device, vaultKey))).toThrow(/epoch 1 is not held/)
  })

  it('refuses ciphertext sealed under another vault key', () => {
    expect(() => openEnvelope(seal(device, generateVaultKey()), keysFor(device, vaultKey))).toThrow(/failed authentication/)
  })

  it('rejects malformed frames', () => {
    const header = (value: unknown): Uint8Array => {
      const json = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value))
      const prefix = Buffer.alloc(3)
      prefix.writeUInt8(1, 0)
      prefix.writeUInt16BE(json.length, 1)
      return new Uint8Array(Buffer.concat([prefix, json, Buffer.alloc(64)]))
    }
    expect(() => readEnvelopeHeader(new Uint8Array(10))).toThrow(/unsupported envelope/)
    const truncated = new Uint8Array(70)
    truncated[0] = 1
    truncated[1] = 0xff
    expect(() => readEnvelopeHeader(truncated)).toThrow(/truncated/)
    expect(() => readEnvelopeHeader(header('{'))).toThrow(/not JSON/)
    expect(() => readEnvelopeHeader(header(null))).toThrow(/malformed/)
    expect(() => readEnvelopeHeader(header({ v: 1, kind: 'other', id: 'a', device: 'd', epoch: 0, counter: 0 }))).toThrow(/malformed/)
    expect(() => readEnvelopeHeader(header({ v: 1, kind: 'update', id: 'a', device: 'd', epoch: -1, counter: 0 }))).toThrow(/malformed/)
    expect(() => readEnvelopeHeader(header({ v: 1, kind: 'update', id: 'a', device: 'd', epoch: 0, counter: 1.5 }))).toThrow(/malformed/)
  })
})

describe('keys', () => {
  it('derives stable opaque ids that hide the name and differ per vault', () => {
    const key = generateVaultKey()
    const id = opaqueIdOf(key, 'memory/traces/yf')
    expect(opaqueIdOf(key, 'memory/traces/yf')).toBe(id)
    expect(id).not.toContain('memory')
    expect(opaqueIdOf(generateVaultKey(), 'memory/traces/yf')).not.toBe(id)
    expect(contentKeyOf(key, id)).not.toEqual(contentKeyOf(key, opaqueIdOf(key, 'other')))
  })

  it('derives the device id from both public keys', () => {
    const device = generateDeviceKeys()
    expect(deviceIdOf(device.publicKeys)).toBe(device.id)
    expect(deviceIdOf({ ...device.publicKeys, agreement: generateDeviceKeys().publicKeys.agreement })).not.toBe(device.id)
  })

  it('signs and verifies, rejecting wrong-length signatures', () => {
    const device = generateDeviceKeys()
    const signature = signBytes(device.secretKeys.signing, bytes('m'))
    expect(verifyBytes(device.publicKeys.signing, bytes('m'), signature)).toBe(true)
    expect(verifyBytes(device.publicKeys.signing, bytes('n'), signature)).toBe(false)
    expect(verifyBytes(device.publicKeys.signing, bytes('m'), signature.subarray(1))).toBe(false)
  })

  it('round-trips a keyring through device wrapping only for its recipient', () => {
    const keyring = new Map([[epoch0, generateVaultKey()], [epoch1, generateVaultKey()]])
    const recipient = generateDeviceKeys()
    const wrapped = wrapForDevice(encodeKeyring(keyring), recipient.publicKeys.agreement)
    expect(decodeKeyring(unwrapForDevice(wrapped, recipient.secretKeys.agreement, recipient.publicKeys.agreement))).toEqual(keyring)
    const other = generateDeviceKeys()
    expect(() => unwrapForDevice(wrapped, other.secretKeys.agreement, other.publicKeys.agreement)).toThrow(SyncVaultError)
    expect(() => unwrapForDevice(new Uint8Array(5), recipient.secretKeys.agreement, recipient.publicKeys.agreement)).toThrow(/unsupported/)
  })

  it('unlocks the same keyring from the same passkey PRF result', () => {
    const prf = generateVaultKey()
    const keyring = new Map([[epoch0, generateVaultKey()]])
    const wrapped = wrapWithKey(encodeKeyring(keyring), recoveryKeysOf(prf).wrappingKey)
    const again = recoveryKeysOf(prf)
    expect(decodeKeyring(unwrapWithKey(wrapped, again.wrappingKey))).toEqual(keyring)
    expect(verifyBytes(again.signingPublicKey, bytes('m'), signBytes(again.signingSeed, bytes('m')))).toBe(true)
    expect(() => unwrapWithKey(wrapped, recoveryKeysOf(generateVaultKey()).wrappingKey)).toThrow(/failed authentication/)
    expect(() => unwrapWithKey(new Uint8Array(0), again.wrappingKey)).toThrow(/unsupported/)
    expect(() => unwrapWithKey(Uint8Array.of(1, 2), again.wrappingKey)).toThrow(/truncated/)
  })

  it('rejects malformed keyrings and base64 of the wrong length', () => {
    expect(() => decodeKeyring(bytes('{'))).toThrow(/not JSON/)
    expect(() => decodeKeyring(bytes('{}'))).toThrow(/not a list/)
    expect(() => decodeKeyring(bytes('[[-1, "a"]]'))).toThrow(/malformed/)
    expect(() => decodeKeyring(bytes('[[0, 5]]'))).toThrow(/malformed/)
    expect(() => decodeKeyring(bytes('[1]'))).toThrow(/malformed/)
    expect(() => fromBase64Url(toBase64Url(new Uint8Array(3)), 32)).toThrow(/expected 32 bytes, got 3/)
  })
})

describe('device chain', () => {
  const first = generateDeviceKeys()
  const second = generateDeviceKeys()
  const recovery = recoveryKeysOf(generateVaultKey())
  const genesis = createGenesis(first)
  const base = verifyChain([genesis])
  const withRecovery = applyChainEntry(base, createChainEntry(base, { type: 'set-recovery', recovery: toBase64Url(recovery.signingPublicKey) }, { kind: 'device', device: first }))

  it('admits the genesis device', () => {
    expect([...base.devices.keys()]).toEqual([first.id])
    expect(base.epoch).toBe(0)
    expect(base.recovery).toBeUndefined()
  })

  it('adds a device signed by an active device or by the recovery key', () => {
    const byDevice = applyChainEntry(base, createChainEntry(base, { type: 'add-device', device: chainDeviceOf(second.publicKeys) }, { kind: 'device', device: first }))
    expect(byDevice.devices.has(second.id)).toBe(true)
    const byRecovery = applyChainEntry(withRecovery, createChainEntry(withRecovery, { type: 'add-device', device: chainDeviceOf(second.publicKeys) }, { kind: 'recovery', signingSeed: recovery.signingSeed }))
    expect(byRecovery.devices.has(second.id)).toBe(true)
  })

  it('removes a device by advancing the epoch, and never re-admits it', () => {
    const added = applyChainEntry(base, createChainEntry(base, { type: 'add-device', device: chainDeviceOf(second.publicKeys) }, { kind: 'device', device: first }))
    const removed = applyChainEntry(added, createChainEntry(added, { type: 'remove-device', device: second.id, epoch: epoch1 }, { kind: 'device', device: first }))
    expect(removed.devices.has(second.id)).toBe(false)
    expect(removed.epoch).toBe(1)
    expect(() => applyChainEntry(removed, createChainEntry(removed, { type: 'add-device', device: chainDeviceOf(second.publicKeys) }, { kind: 'device', device: first }))).toThrow(/already enrolled/)
    expect(() => applyChainEntry(removed, createChainEntry(removed, { type: 'remove-device', device: second.id, epoch: brandNumber<KeyEpoch>(2) }, { kind: 'device', device: first }))).toThrow(/not active/)
    expect(() => applyChainEntry(added, createChainEntry(added, { type: 'remove-device', device: second.id, epoch: brandNumber<KeyEpoch>(3) }, { kind: 'device', device: first }))).toThrow(/advance the epoch/)
  })

  it('refuses entries from keys the chain does not authorize', () => {
    const outsider = generateDeviceKeys()
    expect(() => applyChainEntry(base, createChainEntry(base, { type: 'add-device', device: chainDeviceOf(outsider.publicKeys) }, { kind: 'device', device: outsider }))).toThrow(/not authorized/)
    expect(() => applyChainEntry(base, createChainEntry(base, { type: 'add-device', device: chainDeviceOf(outsider.publicKeys) }, { kind: 'recovery', signingSeed: recovery.signingSeed }))).toThrow(/not authorized/)
    expect(() => applyChainEntry(withRecovery, createChainEntry(withRecovery, { type: 'set-recovery', recovery: toBase64Url(outsider.publicKeys.signing) }, { kind: 'recovery', signingSeed: recovery.signingSeed }))).toThrow(/cannot replace itself/)
  })

  it('refuses a tampered, reordered, or misplaced entry', () => {
    const entry = createChainEntry(base, { type: 'add-device', device: chainDeviceOf(second.publicKeys) }, { kind: 'device', device: first })
    const tampered: ChainEntry = { ...entry, body: { type: 'add-device', device: chainDeviceOf(generateDeviceKeys().publicKeys) } }
    expect(() => applyChainEntry(base, tampered)).toThrow(/signature is invalid/)
    expect(() => applyChainEntry(base, { ...entry, index: 5 })).toThrow(/out of place/)
    expect(() => applyChainEntry(base, { ...entry, previous: 'x' })).toThrow(/does not follow/)
    expect(() => verifyChain([entry])).toThrow(/out of place/)
    expect(() => verifyChain([{ ...entry, index: 0, previous: '' }])).toThrow(/does not start with genesis/)
    expect(() => applyChainEntry(base, { ...genesis, index: 1, previous: base.head })).toThrow(/genesis is not the first entry/)
  })

  it('refuses a genesis signed by another device or describing keys that do not match its id', () => {
    expect(() => verifyChain([{ ...genesis, signer: second.id }])).toThrow(/not signed by its device/)
    const mismatched = chainDeviceOf(first.publicKeys)
    mismatched.agreement = toBase64Url(second.publicKeys.agreement)
    expect(() => verifyChain([createChainEntry(verifyChain([]), { type: 'genesis', device: mismatched }, { kind: 'device', device: first })])).toThrow(/does not match its keys/)
  })

  it('verifies a chain that round-trips through JSON with reordered keys', () => {
    const entries = [genesis, createChainEntry(base, { type: 'add-device', device: chainDeviceOf(second.publicKeys) }, { kind: 'device', device: first })]
    const reordered = JSON.parse(JSON.stringify(entries), (_key, value: unknown) => (
      typeof value === 'object' && value !== null && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).reverse())
        : value
    )) as ChainEntry[]
    expect([...verifyChain(reordered).devices.keys()].sort()).toEqual([first.id, second.id].sort())
  })

  it('refuses an unknown entry type', () => {
    const unknown = createChainEntry(base, { type: 'merge-vaults' } as never, { kind: 'device', device: first })
    expect(() => applyChainEntry(base, unknown)).toThrow(/unknown chain entry/)
  })
})

describe('approval code', () => {
  const joining = generateDeviceKeys().publicKeys
  const approver = generateDeviceKeys().publicKeys
  const challenge = generateVaultKey()

  it('opens a commitment only for the committed keys and opening', () => {
    const { commitment, opening } = commitToKeys(joining)
    expect(verifyCommitment(commitment, joining, opening)).toBe(true)
    expect(verifyCommitment(commitment, approver, opening)).toBe(false)
    expect(verifyCommitment(commitment, joining, generateVaultKey())).toBe(false)
  })

  it('shows six digits that change with either device or the challenge', () => {
    const { opening } = commitToKeys(joining)
    const code = approvalCode({ joining, opening, challenge, approver })
    expect(code).toMatch(/^\d{6}$/)
    expect(approvalCode({ joining, opening, challenge, approver })).toBe(code)
    const others = [
      approvalCode({ joining: generateDeviceKeys().publicKeys, opening, challenge, approver }),
      approvalCode({ joining, opening, challenge: generateVaultKey(), approver }),
      approvalCode({ joining, opening, challenge, approver: generateDeviceKeys().publicKeys }),
    ]
    expect(others.filter(other => other === code).length).toBeLessThan(2)
  })
})
