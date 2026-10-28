/**
 * Device approval code. The joining device commits to its keys before it sees the approver's challenge, so a
 * relay that substitutes keys cannot search for a key pair whose code matches: it must commit first and then
 * has one chance in a million per attempt, and each attempt is visible to the user as a failed approval.
 *
 * Flow: the joining device sends {@link commitToKeys}'s commitment; the approver replies with a random
 * challenge; the joining device reveals its keys and opening; the approver checks {@link verifyCommitment};
 * both show {@link approvalCode} and the user confirms they match.
 */
import { createHash, randomBytes } from 'node:crypto'
import { toBase64Url } from './keys.ts'
import type { DevicePublicKeys } from './types.ts'

function keyCommitment(keys: DevicePublicKeys, opening: Uint8Array): string {
  return toBase64Url(createHash('sha256').update('aeven-sync/commit').update(keys.signing).update(keys.agreement).update(opening).digest())
}

/**
 * Commit to a joining device's keys.
 * @param keys - the joining device's public keys.
 * @returns the commitment to send now and the opening to reveal after the challenge arrives.
 */
export function commitToKeys(keys: DevicePublicKeys): { commitment: string; opening: Uint8Array } {
  const opening = new Uint8Array(randomBytes(32))
  return { commitment: keyCommitment(keys, opening), opening }
}

/**
 * Check a revealed key set against an earlier commitment.
 * @param commitment - the commitment received first.
 * @param keys - the revealed public keys.
 * @param opening - the revealed opening.
 * @returns whether the reveal matches the commitment.
 */
export function verifyCommitment(commitment: string, keys: DevicePublicKeys, opening: Uint8Array): boolean {
  return keyCommitment(keys, opening) === commitment
}

/** What both devices know once the joining device has revealed its keys. */
export interface ApprovalCodeInput {
  /** The joining device's public keys. */
  joining: DevicePublicKeys
  /** The joining device's revealed opening. */
  opening: Uint8Array
  /** The approver's random challenge. */
  challenge: Uint8Array
  /** The approving device's public keys. */
  approver: DevicePublicKeys
}

/**
 * Derive the six-digit code both devices display.
 * @param input - the keys, opening, and challenge of one approval.
 * @returns six decimal digits.
 */
export function approvalCode(input: ApprovalCodeInput): string {
  const digest = createHash('sha256')
    .update('aeven-sync/approval')
    .update(input.joining.signing).update(input.joining.agreement).update(input.opening)
    .update(input.challenge)
    .update(input.approver.signing).update(input.approver.agreement)
    .digest()
  return String(digest.readUInt32BE(0) % 1_000_000).padStart(6, '0')
}
