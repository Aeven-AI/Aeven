/**
 * Vault cryptography behavior: envelopes open only for active senders and held epochs, wrapped keyrings open
 * only for their recipient, the device chain admits only authorized changes, and the approval code binds both
 * devices' keys.
 */
import { describe, expect, it } from 'vitest'
import { brandNumber, brandString } from '@aeven/brand'
import {
  applyChainEntry, approvalCode, chainDeviceOf, commitToKeys, contentKeyOf, createChainEntry, createGenesis,
  decodeKeyring, deviceIdOf, encodeKeyring, fromBase64Url, generateAgreementKeys, generateDeviceKeys, generateVaultKey,
  opaqueIdOf, openEnvelope, readEnvelopeHeader, RECOVERY_PRF_SALT, recoveryKeysOf, recoveryRecordOf, sealEnvelope,
  signBytes, signingKeyAt, SyncVaultError, toBase64Url, unwrapForDevice, verifyBytes, verifyChain, verifyCommitment, wrapForDevice,
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
    const truncated = wrapped.subarray(0, 40)
    expect(() => unwrapForDevice(truncated, recipient.secretKeys.agreement, recipient.publicKeys.agreement)).toThrow(/truncated/)
  })

  it('unlocks a keyring wrapped to the recovery key only with the same passkey PRF result', () => {
    const prf = generateVaultKey()
    const keyring = new Map([[epoch0, generateVaultKey()]])
    const wrapped = wrapForDevice(encodeKeyring(keyring), recoveryKeysOf(prf).publicKeys.agreement)
    const again = recoveryKeysOf(prf)
    expect(decodeKeyring(unwrapForDevice(wrapped, again.secretKeys.agreement, again.publicKeys.agreement))).toEqual(keyring)
    expect(verifyBytes(again.publicKeys.signing, bytes('m'), signBytes(again.secretKeys.signing, bytes('m')))).toBe(true)
    const other = recoveryKeysOf(generateVaultKey())
    expect(() => unwrapForDevice(wrapped, other.secretKeys.agreement, other.publicKeys.agreement)).toThrow(/failed authentication/)
    expect(RECOVERY_PRF_SALT).toHaveLength(32)
  })

  it('opens a value wrapped to a one-use agreement key', () => {
    const pair = generateAgreementKeys()
    expect(unwrapForDevice(wrapForDevice(bytes('prf'), pair.publicKey), pair.secretKey, pair.publicKey)).toEqual(bytes('prf'))
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
  const withRecovery = applyChainEntry(base, createChainEntry(base, { type: 'set-recovery', recovery: recoveryRecordOf(recovery.publicKeys) }, { kind: 'device', device: first }))

  it('admits the genesis device', () => {
    expect([...base.devices.keys()]).toEqual([first.id])
    expect(base.epoch).toBe(0)
    expect(base.recovery).toBeUndefined()
  })

  it('adds a device signed by an active device or by the recovery key', () => {
    const byDevice = applyChainEntry(base, createChainEntry(base, { type: 'add-device', device: chainDeviceOf(second.publicKeys) }, { kind: 'device', device: first }))
    expect(byDevice.devices.has(second.id)).toBe(true)
    const byRecovery = applyChainEntry(withRecovery, createChainEntry(withRecovery, { type: 'add-device', device: chainDeviceOf(second.publicKeys) }, { kind: 'recovery', recovery }))
    expect(byRecovery.devices.has(second.id)).toBe(true)
  })

  it('removes a device by advancing the epoch, and never re-admits it', () => {
    const added = applyChainEntry(base, createChainEntry(base, { type: 'add-device', device: chainDeviceOf(second.publicKeys) }, { kind: 'device', device: first }))
    const removed = applyChainEntry(added, createChainEntry(added, { type: 'remove-device', device: second.id, epoch: epoch1, until: 5 }, { kind: 'device', device: first }))
    expect(removed.devices.has(second.id)).toBe(false)
    expect(removed.epoch).toBe(1)
    expect(() => applyChainEntry(removed, createChainEntry(removed, { type: 'add-device', device: chainDeviceOf(second.publicKeys) }, { kind: 'device', device: first }))).toThrow(/already enrolled/)
    expect(() => applyChainEntry(removed, createChainEntry(removed, { type: 'remove-device', device: second.id, epoch: brandNumber<KeyEpoch>(2), until: 5 }, { kind: 'device', device: first }))).toThrow(/not active/)
    expect(() => applyChainEntry(added, createChainEntry(added, { type: 'remove-device', device: second.id, epoch: brandNumber<KeyEpoch>(3), until: 5 }, { kind: 'device', device: first }))).toThrow(/advance the epoch/)
    expect(() => applyChainEntry(added, createChainEntry(added, { type: 'remove-device', device: second.id, epoch: epoch1, until: -1 }, { kind: 'device', device: first }))).toThrow(/relay sequence/)
    expect(signingKeyAt(removed, second.id, 5)).toEqual(second.publicKeys.signing)
    expect(signingKeyAt(removed, second.id, 6)).toBeUndefined()
    expect(signingKeyAt(removed, first.id, 6)).toEqual(first.publicKeys.signing)
    expect(signingKeyAt(removed, generateDeviceKeys().id, 1)).toBeUndefined()
  })

  it('refuses entries from keys the chain does not authorize', () => {
    const outsider = generateDeviceKeys()
    expect(() => applyChainEntry(base, createChainEntry(base, { type: 'add-device', device: chainDeviceOf(outsider.publicKeys) }, { kind: 'device', device: outsider }))).toThrow(/not authorized/)
    expect(() => applyChainEntry(base, createChainEntry(base, { type: 'add-device', device: chainDeviceOf(outsider.publicKeys) }, { kind: 'recovery', recovery }))).toThrow(/not authorized/)
    expect(() => applyChainEntry(withRecovery, createChainEntry(withRecovery, { type: 'set-recovery', recovery: recoveryRecordOf(outsider.publicKeys) }, { kind: 'recovery', recovery }))).toThrow(/only adds devices/)
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
