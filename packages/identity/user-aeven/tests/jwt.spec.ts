import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifiedUserId } from '../src/jwt.ts'

const SECRET = 'shared-signing-secret'
const NOW = 1_800_000_000

/** Sign exactly as the Aeven API's `jsonwebtoken` default does. */
function sign(payload: object, secret = SECRET, header: object = { alg: 'HS256', typ: 'JWT' }): string {
  const encode = (value: object): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url')
  const body = `${encode(header)}.${encode(payload)}`
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`
}

describe('verifiedUserId', () => {
  it('returns the user a correctly signed, unexpired token names', () => {
    const token = sign({ userId: 'u-1', exp: NOW + 60 })
    expect(verifiedUserId(token, SECRET, NOW)).toBe('u-1')
  })

  it('refuses a token signed with another secret', () => {
    const token = sign({ userId: 'u-1', exp: NOW + 60 }, 'other-secret')
    expect(verifiedUserId(token, SECRET, NOW)).toBeUndefined()
  })

  it('refuses a token whose payload was edited after signing', () => {
    const original = sign({ userId: 'u-1', exp: NOW + 60 })
    const [header, , signature] = original.split('.') as [string, string, string]
    const forged = Buffer.from(JSON.stringify({ userId: 'admin', exp: NOW + 60 })).toString('base64url')
    expect(verifiedUserId(`${header}.${forged}.${signature}`, SECRET, NOW)).toBeUndefined()
  })

  it('refuses `alg: none`, whatever the header claims', () => {
    const encode = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url')
    const unsigned = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ userId: 'u-1', exp: NOW + 60 })}.`
    expect(verifiedUserId(unsigned, SECRET, NOW)).toBeUndefined()
  })

  it('refuses a token whose header names another algorithm, even when the HMAC matches', () => {
    // The signature is valid for these bytes; only the pinned algorithm rejects it.
    const token = sign({ userId: 'u-1', exp: NOW + 60 }, SECRET, { alg: 'HS512', typ: 'JWT' })
    expect(verifiedUserId(token, SECRET, NOW)).toBeUndefined()
  })

  it('refuses an expired token, and one expiring exactly now', () => {
    expect(verifiedUserId(sign({ userId: 'u-1', exp: NOW - 1 }), SECRET, NOW)).toBeUndefined()
    expect(verifiedUserId(sign({ userId: 'u-1', exp: NOW }), SECRET, NOW)).toBeUndefined()
  })

  it('refuses a token that never expires', () => {
    expect(verifiedUserId(sign({ userId: 'u-1' }), SECRET, NOW)).toBeUndefined()
  })

  it('refuses a token carrying no usable user', () => {
    expect(verifiedUserId(sign({ exp: NOW + 60 }), SECRET, NOW)).toBeUndefined()
    expect(verifiedUserId(sign({ userId: '', exp: NOW + 60 }), SECRET, NOW)).toBeUndefined()
    expect(verifiedUserId(sign({ userId: 42, exp: NOW + 60 }), SECRET, NOW)).toBeUndefined()
  })

  it('refuses malformed compact serializations', () => {
    expect(verifiedUserId('', SECRET, NOW)).toBeUndefined()
    expect(verifiedUserId('a.b', SECRET, NOW)).toBeUndefined()
    expect(verifiedUserId('a.b.c.d', SECRET, NOW)).toBeUndefined()
    // Base64 decoders drop characters outside the alphabet; a segment that is
    // not base64url must be refused rather than silently repaired.
    expect(verifiedUserId('!!!.b.c', SECRET, NOW)).toBeUndefined()
    const valid = sign({ userId: 'u-1', exp: NOW + 60 })
    const [header, payload] = valid.split('.') as [string, string]
    expect(verifiedUserId(`${header}.${payload}.!!!`, SECRET, NOW)).toBeUndefined()
  })

  it('refuses segments that decode to something other than JSON', () => {
    const encode = (raw: string): string => Buffer.from(raw).toString('base64url')
    const body = `${encode('not json')}.${encode('{}')}`
    expect(verifiedUserId(`${body}.${createHmac('sha256', SECRET).update(body).digest('base64url')}`, SECRET, NOW))
      .toBeUndefined()
    const header = encode(JSON.stringify({ alg: 'HS256' }))
    const body2 = `${header}.${encode('not json')}`
    expect(verifiedUserId(`${body2}.${createHmac('sha256', SECRET).update(body2).digest('base64url')}`, SECRET, NOW))
      .toBeUndefined()
  })

  it('refuses a signature of the wrong length without throwing', () => {
    const valid = sign({ userId: 'u-1', exp: NOW + 60 })
    const [header, payload] = valid.split('.') as [string, string]
    expect(verifiedUserId(`${header}.${payload}.AAAA`, SECRET, NOW)).toBeUndefined()
  })
})
