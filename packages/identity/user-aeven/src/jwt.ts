/**
 * HS256 verification for the tokens the Aeven API signs.
 *
 * Aeven signs with `jsonwebtoken`'s default algorithm and a shared secret, so
 * verifying needs an HMAC and two comparisons rather than a dependency.
 * @module @aeven/identity-user-aeven/jwt
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

/** The only algorithm accepted, whatever a token's own header claims. */
const ALGORITHM = 'HS256'

/** Decoded claims this package reads; Aeven signs `{ userId }` plus the registered times. */
interface Claims {
  readonly userId?: unknown
  readonly exp?: unknown
}

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
 * Verify a token and return the user it names.
 *
 * @param token - the compact JWS.
 * @param secret - the shared signing secret.
 * @param nowSeconds - current time, for the expiry comparison.
 * @returns the `userId` claim, or undefined when the token is malformed, signed
 * with another algorithm or key, expired, or carries no user.
 */
export function verifiedUserId(token: string, secret: string, nowSeconds: number): string | undefined {
  const parts = token.split('.')
  if (parts.length !== 3) return undefined
  const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string]

  const headerBytes = decodeSegment(encodedHeader)
  if (headerBytes === undefined) return undefined
  let header: { alg?: unknown }
  try {
    header = JSON.parse(headerBytes.toString('utf8')) as { alg?: unknown }
  } catch {
    // A header that is not JSON is not a token this package can verify; the
    // literal below is the only other statement, so nothing else can throw.
    return undefined
  }
  // Pinned, not read from the token: accepting the token's own `alg` is what
  // turns `none` and key-confusion into a signature bypass.
  if (header.alg !== ALGORITHM) return undefined

  const expected = createHmac('sha256', secret).update(`${encodedHeader}.${encodedPayload}`).digest()
  const actual = decodeSegment(encodedSignature)
  // Length is checked first because timingSafeEqual throws on a mismatch, and
  // the length of a signature is not a secret.
  if (actual === undefined || actual.length !== expected.length) return undefined
  if (!timingSafeEqual(actual, expected)) return undefined

  const payloadBytes = decodeSegment(encodedPayload)
  /* v8 ignore next -- the signature covers this segment, so a payload that is
     not base64url cannot have verified a moment ago. */
  if (payloadBytes === undefined) return undefined
  let claims: Claims
  try {
    claims = JSON.parse(payloadBytes.toString('utf8')) as Claims
  } catch {
    // As above: a payload that is not JSON carries no claims to read.
    return undefined
  }

  // An unexpired signature still proves nothing once the deadline passed, and a
  // token without one never expires — neither is accepted.
  if (typeof claims.exp !== 'number' || claims.exp <= nowSeconds) return undefined
  return typeof claims.userId === 'string' && claims.userId.length > 0 ? claims.userId : undefined
}
