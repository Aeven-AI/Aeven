import { createHmac } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import IdentityUsers from '@aeven/identity-user'
import type { IdentityRequest } from '@aeven/identity-user'
import { apply, Config } from '../src/index.ts'
import type { IndexInjection } from '@aeven/host-webserver'

const ACCESS_SECRET = 'access-secret'
const REFRESH_SECRET = 'refresh-secret'

/** Sign as the Aeven API's `jsonwebtoken` default does. */
function sign(payload: object, secret: string): string {
  const encode = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url')
  const body = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}`
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`
}

const future = (): number => Math.floor(Date.now() / 1000) + 3600

/** The seam with the Aeven authority registered, as a composition mounts it. */
function seam(): IdentityUsers {
  const ctx = new Context()
  const users = new IdentityUsers(ctx)
  ;(ctx as unknown as { identityUsers: IdentityUsers }).identityUsers = users
  apply(ctx, Config({
    accessSecretEnv: 'TEST_ACCESS_SECRET',
    refreshSecretEnv: 'TEST_REFRESH_SECRET',
  }))
  return users
}

const headers = (rows: Record<string, string>): IdentityRequest => ({ headers: rows })

describe('the Aeven authority', () => {
  beforeEach(() => {
    process.env['TEST_ACCESS_SECRET'] = ACCESS_SECRET
    process.env['TEST_REFRESH_SECRET'] = REFRESH_SECRET
  })
  afterEach(() => {
    delete process.env['TEST_ACCESS_SECRET']
    delete process.env['TEST_REFRESH_SECRET']
  })

  it('identifies the caller from the access bearer an HTTP call carries', () => {
    const users = seam()
    const token = sign({ userId: 'u-1', exp: future() }, ACCESS_SECRET)
    expect(users.resolve(headers({ authorization: `Bearer ${token}` }))).toEqual({ id: 'u-1' })
  })

  it('identifies the caller from the refresh cookie an upgrade carries', () => {
    const users = seam()
    const token = sign({ userId: 'u-2', exp: future() }, REFRESH_SECRET)
    // A browser cannot set a header on a WebSocket upgrade, so this is the only
    // credential that path can present.
    expect(users.resolve(headers({ cookie: `refreshToken=${token}; other=x` }))).toEqual({ id: 'u-2' })
  })

  it('refuses each token under the other secret', () => {
    const users = seam()
    const asAccess = sign({ userId: 'u-1', exp: future() }, ACCESS_SECRET)
    const asRefresh = sign({ userId: 'u-1', exp: future() }, REFRESH_SECRET)
    // The two secrets are not interchangeable: a refresh token presented as a
    // bearer would outlive the access token's lifetime by a year.
    expect(users.resolve(headers({ authorization: `Bearer ${asRefresh}` }))).toBeUndefined()
    expect(users.resolve(headers({ cookie: `refreshToken=${asAccess}` }))).toBeUndefined()
  })

  it('refuses a request carrying no credential', () => {
    const users = seam()
    expect(users.resolve(headers({}))).toBeUndefined()
    expect(users.resolve(headers({ cookie: 'unrelated=1' }))).toBeUndefined()
    expect(users.resolve(headers({ authorization: 'Basic abc' }))).toBeUndefined()
    expect(users.resolve(headers({ authorization: 'Bearer' }))).toBeUndefined()
  })

  it('reads the bearer whatever case the scheme was written in', () => {
    const users = seam()
    const token = sign({ userId: 'u-3', exp: future() }, ACCESS_SECRET)
    expect(users.resolve(headers({ authorization: `bearer ${token}` }))).toEqual({ id: 'u-3' })
  })

  it('reads headers from a Fetch Headers as well as a node record', () => {
    const users = seam()
    const token = sign({ userId: 'u-4', exp: future() }, ACCESS_SECRET)
    expect(users.resolve({ headers: new Headers({ authorization: `Bearer ${token}` }) }))
      .toEqual({ id: 'u-4' })
  })

  it('refuses a Fetch Headers carrying no credential', () => {
    const users = seam()
    expect(users.resolve({ headers: new Headers({ 'content-type': 'application/json' }) }))
      .toBeUndefined()
  })

  it('refuses a repeated header, which names no single credential', () => {
    const users = seam()
    const token = sign({ userId: 'u-5', exp: future() }, ACCESS_SECRET)
    expect(users.resolve({ headers: { authorization: [`Bearer ${token}`, 'Bearer other'] } }))
      .toBeUndefined()
  })

  it('authenticates nobody while a secret is absent or empty', () => {
    const users = seam()
    const token = sign({ userId: 'u-1', exp: future() }, ACCESS_SECRET)
    delete process.env['TEST_ACCESS_SECRET']
    expect(users.resolve(headers({ authorization: `Bearer ${token}` }))).toBeUndefined()
    process.env['TEST_ACCESS_SECRET'] = ''
    expect(users.resolve(headers({ authorization: `Bearer ${token}` }))).toBeUndefined()
  })

  it('falls through to the cookie when the bearer does not verify', () => {
    const users = seam()
    const good = sign({ userId: 'u-6', exp: future() }, REFRESH_SECRET)
    // An expired access token with a live session: the socket still opens.
    const stale = sign({ userId: 'u-6', exp: Math.floor(Date.now() / 1000) - 1 }, ACCESS_SECRET)
    expect(users.resolve(headers({ authorization: `Bearer ${stale}`, cookie: `refreshToken=${good}` })))
      .toEqual({ id: 'u-6' })
  })
})

describe('the endpoints the Host states in the page', () => {
  it('carries only what a deployment configured, so an absent provider offers no button', () => {
    const ctx = new Context()
    const users = new IdentityUsers(ctx)
    ;(ctx as unknown as { identityUsers: IdentityUsers }).identityUsers = users
    apply(ctx, Config({
      apiUrl: 'http://api.test:9000',
      xOAuthUrl: 'https://x.test/o',
      appleOAuthUrl: 'https://apple.test/o',
      googleOAuthUrl: 'https://google.test/o',
      webUrl: 'https://web.test',
      mediaUrl: 'https://media.test',
    }))

    const table: IndexInjection[] = []
    ctx.emit('webserver/index-inject', table)
    expect(table).toEqual([{
      kind: 'global',
      name: '__DSH_AEVEN__',
      value: {
        apiUrl: 'http://api.test:9000',
        xOAuthUrl: 'https://x.test/o',
        appleOAuthUrl: 'https://apple.test/o',
        googleOAuthUrl: 'https://google.test/o',
        webUrl: 'https://web.test',
        mediaUrl: 'https://media.test',
      },
    }])
  })

  it('states nothing when no Aeven is configured', () => {
    const ctx = new Context()
    const users = new IdentityUsers(ctx)
    ;(ctx as unknown as { identityUsers: IdentityUsers }).identityUsers = users
    apply(ctx, Config({}))
    const table: IndexInjection[] = []
    ctx.emit('webserver/index-inject', table)
    expect(table[0]).toMatchObject({ name: '__DSH_AEVEN__', value: {} })
  })
})
