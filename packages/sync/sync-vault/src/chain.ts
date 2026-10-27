/**
 * The device chain: an append-only, hash-linked list of signed membership changes. Every device verifies the
 * whole chain before trusting a device key, so the server that stores the chain cannot add a member.
 */
import { createHash } from 'node:crypto'
import { brandNumber } from '@aeven/brand'
import { deviceIdOf, fromBase64Url, signBytes, SyncVaultError, toBase64Url, verifyBytes } from './keys.ts'
import type {
  ChainBody, ChainDevice, ChainEntry, ChainState, DeviceId, DeviceKeys, DevicePublicKeys, KeyEpoch, RecoveryKeys, RecoveryRecord,
} from './types.ts'

/** Who signs a new entry. */
export type ChainSigner =
  | { kind: 'device'; device: DeviceKeys }
  | { kind: 'recovery'; recovery: RecoveryKeys }

/** JSON with object keys sorted, so a chain re-serialized by the server verifies. Chain values hold no arrays. */
function canonical(value: unknown): string {
  if (typeof value !== 'object' || value === null) return JSON.stringify(value)
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined)
  entries.sort(([a], [b]) => (a < b ? -1 : 1))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
}

function signedBytes(entry: Omit<ChainEntry, 'signature'>): Uint8Array {
  const { index, previous, body, signer } = entry
  return new TextEncoder().encode(canonical({ index, previous, body, signer }))
}

function entryHash(entry: ChainEntry): string {
  return toBase64Url(createHash('sha256').update(canonical(entry)).digest())
}

/**
 * Describe a device for a chain entry.
 * @param keys - the device's public keys.
 * @returns the chain record.
 */
export function chainDeviceOf(keys: DevicePublicKeys): ChainDevice {
  return { id: deviceIdOf(keys), signing: toBase64Url(keys.signing), agreement: toBase64Url(keys.agreement) }
}

/**
 * Describe a recovery key for a `set-recovery` entry.
 * @param keys - the recovery key's public keys.
 * @returns the chain record.
 */
export function recoveryRecordOf(keys: DevicePublicKeys): RecoveryRecord {
  return { signing: toBase64Url(keys.signing), agreement: toBase64Url(keys.agreement) }
}

function publicKeysOf(device: ChainDevice): DevicePublicKeys {
  const keys = { signing: fromBase64Url(device.signing, 32), agreement: fromBase64Url(device.agreement, 32) }
  if (deviceIdOf(keys) !== device.id) throw new SyncVaultError(`device ${device.id} does not match its keys`)
  return keys
}

/** The state before any entry. */
const EMPTY: ChainState = {
  devices: new Map(), removed: new Map(), epoch: brandNumber<KeyEpoch>(0), length: 0, head: '',
}

/**
 * Apply one entry to a verified state.
 * @param state - the state after every earlier entry.
 * @param entry - the next entry.
 * @returns the state after `entry`.
 * @throws {SyncVaultError} when the entry is out of place, unsigned by an authorized key, or not allowed.
 */
export function applyChainEntry(state: ChainState, entry: ChainEntry): ChainState {
  if (entry.index !== state.length) throw new SyncVaultError(`chain entry ${String(entry.index)} is out of place`)
  if (entry.previous !== state.head) throw new SyncVaultError(`chain entry ${String(entry.index)} does not follow the head`)
  const body = entry.body
  let signerKey: Uint8Array | undefined
  if (body.type === 'genesis') {
    if (state.length !== 0) throw new SyncVaultError('genesis is not the first entry')
    if (entry.signer !== body.device.id) throw new SyncVaultError('genesis is not signed by its device')
    signerKey = publicKeysOf(body.device).signing
  } else if (state.length === 0) {
    throw new SyncVaultError('the chain does not start with genesis')
  } else if (entry.signer === 'recovery') {
    if (body.type !== 'add-device') throw new SyncVaultError('the recovery key only adds devices')
    signerKey = state.recovery?.signing
  } else {
    signerKey = state.devices.get(entry.signer)?.signing
  }
  if (signerKey === undefined) throw new SyncVaultError(`chain entry ${String(entry.index)} signer is not authorized`)
  if (!verifyBytes(signerKey, signedBytes(entry), fromBase64Url(entry.signature))) {
    throw new SyncVaultError(`chain entry ${String(entry.index)} signature is invalid`)
  }
  const devices = new Map(state.devices)
  const removed = new Map(state.removed)
  let { recovery, epoch } = state
  switch (body.type) {
    case 'genesis':
    case 'add-device': {
      if (devices.has(body.device.id) || removed.has(body.device.id)) throw new SyncVaultError(`device ${body.device.id} was already enrolled`)
      devices.set(body.device.id, publicKeysOf(body.device))
      break
    }
    case 'remove-device': {
      const device = devices.get(body.device)
      if (device === undefined) throw new SyncVaultError(`device ${body.device} is not active`)
      if (body.epoch !== epoch + 1) throw new SyncVaultError('device removal must advance the epoch by one')
      if (!Number.isSafeInteger(body.until) || body.until < 0) throw new SyncVaultError('device removal needs a relay sequence number')
      devices.delete(body.device)
      removed.set(body.device, { signing: device.signing, until: body.until })
      epoch = body.epoch
      break
    }
    case 'set-recovery': {
      recovery = { signing: fromBase64Url(body.recovery.signing, 32), agreement: fromBase64Url(body.recovery.agreement, 32) }
      break
    }
    default: {
      const unknown: never = body
      throw new SyncVaultError(`unknown chain entry ${JSON.stringify(unknown)}`)
    }
  }
  return { devices, removed, ...recovery === undefined ? {} : { recovery }, epoch, length: state.length + 1, head: entryHash(entry) }
}

/**
 * The key that verifies a device's frame at a relay position: an active device's key, or a removed device's
 * key for frames up to its removal's `until`.
 * @param state - the verified chain state.
 * @param device - the sending device.
 * @param seq - the frame's relay sequence number.
 * @returns the Ed25519 public key, or undefined when the device may not send at `seq`.
 */
export function signingKeyAt(state: ChainState, device: DeviceId, seq: number): Uint8Array | undefined {
  const active = state.devices.get(device)?.signing
  if (active !== undefined) return active
  const removed = state.removed.get(device)
  return removed !== undefined && seq <= removed.until ? removed.signing : undefined
}

/**
 * Verify a whole chain from genesis.
 * @param entries - every entry, in order.
 * @returns the membership the chain establishes.
 * @throws {SyncVaultError} at the first invalid entry.
 */
export function verifyChain(entries: readonly ChainEntry[]): ChainState {
  return entries.reduce(applyChainEntry, EMPTY)
}

/**
 * Create and sign the entry that follows `state`. The result is not applied; pass it to
 * {@link applyChainEntry} to check it and advance the state.
 * @param state - the current verified state.
 * @param body - the change.
 * @param signer - the active device or recovery key signing it.
 * @returns the signed entry.
 */
export function createChainEntry(state: ChainState, body: ChainBody, signer: ChainSigner): ChainEntry {
  const unsigned: Omit<ChainEntry, 'signature'> = {
    index: state.length,
    previous: state.head,
    body,
    signer: signer.kind === 'device' ? signer.device.id : 'recovery',
  }
  const seed = signer.kind === 'device' ? signer.device.secretKeys.signing : signer.recovery.secretKeys.signing
  return { ...unsigned, signature: toBase64Url(signBytes(seed, signedBytes(unsigned))) }
}

/**
 * Start a vault's chain with its first device.
 * @param device - the first device.
 * @returns the signed genesis entry.
 */
export function createGenesis(device: DeviceKeys): ChainEntry {
  return createChainEntry(EMPTY, { type: 'genesis', device: chainDeviceOf(device.publicKeys) }, { kind: 'device', device })
}
