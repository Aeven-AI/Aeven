/**
 * ES256 verification for the tokens the Aeven API signs, against the public keys it publishes.
 *
 * The API signs with a P-256 private key that only it holds and serves the public half at
 * `/.well-known/jwks.json`. This module verifies with that public half, so a Host — including
 * one running on a reader's own machine — can identify a caller without holding anything that
 * could sign a token for another user.
 * @module @aeven/identity-user-aeven/jwt
 */

import { createPublicKey, verify, type KeyObject } from 'node:crypto'

/** The only algorithm accepted, whatever a token's own header claims. */
const ALGORITHM = 'ES256'

/** Token kinds the API issues under one key; the `typ` claim keeps them from standing in for each other. */
export type TokenType = 'access' | 'refresh'

/** Decoded claims this package reads; Aeven signs `{ userId, typ }` plus the registered times. */
interface Claims {
  readonly userId?: unknown
  readonly typ?: unknown
  readonly exp?: unknown
}

/** Outcome of one verification; `unknown-key` tells the caller its key set may be stale. */
export type Verification =
  | { readonly kind: 'verified'; readonly userId: string }
  | { readonly kind: 'unknown-key'; readonly kid: string }
  | { readonly kind: 'rejected' }

const REJECTED: Verification = { kind: 'rejected' }

/**
 * Decode one base64url segment.
 * @param segment - the encoded segment.
 * @returns the decoded bytes, or undefined when the segment is not base64url.
 */
function decodeSegment(segment: string): Buffer | undefined {
  // Reject before decoding: Buffer's base64 decoder accepts and silently drops
  // characters outside the alphabet, so a forged segment would round-trip.
  if (!/^[A-Za-z0-9_-]*$/.test(segment)) return undefined
  return Buffer.from(segment, 'base64url')
}

/**
 * Parse a base64url JSON segment.
 * @param segment - the encoded segment.
 * @returns the parsed value, or undefined when the segment is not base64url JSON.
 */
function decodeJson(segment: string): unknown {
  const bytes = decodeSegment(segment)
  if (bytes === undefined) return undefined
  try {
    return JSON.parse(bytes.toString('utf8')) as unknown
  } catch {
    // A segment that is not JSON carries nothing this package can verify; the
    // parse is the only statement here, so nothing else can throw.
    return undefined
  }
}

/**
 * Parse a base64url JSON object segment.
 * @param segment - the encoded segment.
 * @returns the parsed object, or undefined when the segment is not base64url JSON object.
 */
function decodeObject(segment: string): Record<string, unknown> | undefined {
  const parsed = decodeJson(segment)
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : undefined
}

/**
 * Verify a token of one type and return the user it names.
 * @param token - the compact JWS.
 * @param type - the token type the caller accepts.
 * @param keyFor - the public key published under a key id, or undefined when the set holds none.
 * @param nowSeconds - current time, for the expiry comparison.
 * @returns the verified user, `unknown-key` when the token names a key the set lacks, or
 * `rejected` when it is malformed, uses another algorithm, fails its signature, is of the other
 * type, has expired, or names no user.
 */
export function verifyToken(token: string, type: TokenType, keyFor: (kid: string) => KeyObject | undefined,
  nowSeconds: number): Verification {
  const parts = token.split('.')
  if (parts.length !== 3) return REJECTED
  const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string]

  const header = decodeObject(encodedHeader)
  // Pinned, not read from the token: accepting the token's own `alg` is what
  // turns `none` and key-confusion into a signature bypass.
  if (header?.alg !== ALGORITHM || typeof header.kid !== 'string') return REJECTED
  const key = keyFor(header.kid)
  if (key === undefined) return { kind: 'unknown-key', kid: header.kid }

  const signature = decodeSegment(encodedSignature)
  // A JWS ES256 signature is the raw 64-byte r||s pair, not DER.
  if (signature?.length !== 64) return REJECTED
  const signed = Buffer.from(`${encodedHeader}.${encodedPayload}`)
  if (!verify('sha256', signed, { key, dsaEncoding: 'ieee-p1363' }, signature)) return REJECTED

  const claims: Claims | undefined = decodeObject(encodedPayload)
  if (claims === undefined || claims.typ !== type) return REJECTED
  // An unexpired signature still proves nothing once the deadline passed, and a
  // token without one never expires — neither is accepted.
  if (typeof claims.exp !== 'number' || claims.exp <= nowSeconds) return REJECTED
  return typeof claims.userId === 'string' && claims.userId.length > 0
    ? { kind: 'verified', userId: claims.userId }
    : REJECTED
}

/**
 * Read the ES256 keys out of a JSON Web Key Set document.
 *
 * The document arrives over the network, so every entry is checked; an entry that is not a
 * P-256 signing key is skipped rather than failing the set.
 * @param document - the parsed `/.well-known/jwks.json` body.
 * @returns public keys by key id.
 */
export function parseKeySet(document: unknown): Map<string, KeyObject> {
  const keys = new Map<string, KeyObject>()
  const entries = (document as { keys?: unknown } | null)?.keys
  if (!Array.isArray(entries)) return keys
  for (const entry of entries as unknown[]) {
    const jwk = entry as Record<string, unknown> | null
    if (jwk?.kty !== 'EC' || jwk.crv !== 'P-256' || typeof jwk.kid !== 'string'
      || typeof jwk.x !== 'string' || typeof jwk.y !== 'string'
      || (jwk.alg !== undefined && jwk.alg !== ALGORITHM)) continue
    keys.set(jwk.kid, createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, format: 'jwk' }))
  }
  return keys
}
