import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { credentialRef, type CredentialRef } from '@aeven/credentials'
import { IdentityUsers, type IdentityRequest, type User, type UserResolver } from '../src/index.ts'

/** A resolver that recognizes one fixed header value, optionally naming the credential it opens. */
function resolverFor(id: string, token: string, user: User, opens?: CredentialRef): UserResolver {
  return {
    id,
    resolve: (request: IdentityRequest) =>
      (request.headers as Record<string, string>)['authorization'] === token ? user : undefined,
    // A launch-token authority declares nothing, so the property is absent rather
    // than present-and-undefined.
    ...(opens === undefined ? {} : { credentialRef: opens }),
  }
}

const request = (authorization?: string): IdentityRequest =>
  ({ headers: authorization === undefined ? {} : { authorization } })

describe('IdentityUsers', () => {
  function seam() {
    return new IdentityUsers(new Context())
  }

  it('authenticates nobody, and does not enforce, until an authority registers', () => {
    const users = seam()
    expect(users.enforcing).toBe(false)
    expect(users.resolve(request('anything'))).toBeUndefined()
  })

  it('enforces once an authority registers, and stops when it is disposed', () => {
    const users = seam()
    const dispose = users.registerResolver(resolverFor('a', 'tok', { id: 'u-1' }))
    expect(users.enforcing).toBe(true)
    expect(users.resolve(request('tok'))).toEqual({ id: 'u-1' })
    dispose()
    // A harness that loses its only authority stops claiming to authenticate.
    expect(users.enforcing).toBe(false)
    expect(users.resolve(request('tok'))).toBeUndefined()
  })

  it('returns undefined for a credential no authority recognizes', () => {
    const users = seam()
    users.registerResolver(resolverFor('a', 'tok', { id: 'u-1' }))
    expect(users.resolve(request('wrong'))).toBeUndefined()
    expect(users.resolve(request())).toBeUndefined()
  })

  it('consults authorities in registration order and takes the first answer', () => {
    const users = seam()
    users.registerResolver(resolverFor('first', 'tok', { id: 'from-first' }))
    users.registerResolver(resolverFor('second', 'tok', { id: 'from-second' }))
    expect(users.resolve(request('tok'))).toEqual({ id: 'from-first' })
    // A later authority still answers for a credential the earlier one declines.
    users.registerResolver(resolverFor('third', 'other', { id: 'from-third' }))
    expect(users.resolve(request('other'))).toEqual({ id: 'from-third' })
  })

  it('refuses two authorities under one name', () => {
    const users = seam()
    users.registerResolver(resolverFor('a', 'tok', { id: 'u-1' }))
    // Silently replacing one would make which authority answers depend on mount
    // order rather than on the composition.
    expect(() => users.registerResolver(resolverFor('a', 'other', { id: 'u-2' })))
      .toThrow(/already registered/)
  })
})

describe('IdentityUsers.credentialRefFor', () => {
  const session = credentialRef('AEVEN_TOKEN')
  function seam() {
    return new IdentityUsers(new Context())
  }

  it('names the reference the authority that recognizes the request declared', () => {
    const users = seam()
    users.registerResolver(resolverFor('aeven', 'tok', { id: 'u-1' }, session))
    expect(users.credentialRefFor(request('tok'))).toBe(session)
  })

  it('takes the reference from the first authority that recognizes the credential', () => {
    const users = seam()
    users.registerResolver(resolverFor('launch', 'other', { id: 'from-launch' }, credentialRef('LAUNCH_TOKEN')))
    users.registerResolver(resolverFor('aeven', 'tok', { id: 'from-aeven' }, session))
    expect(users.credentialRefFor(request('tok'))).toBe(session)
  })

  it('names nothing for an unrecognized request or an authority that declared none', () => {
    const users = seam()
    // A launch-token authority admits a browser and opens nothing upstream, so
    // it declares no reference: there is nothing to re-present anywhere.
    users.registerResolver(resolverFor('launch', 'tok', { id: 'u-1' }))
    expect(users.credentialRefFor(request('tok'))).toBeUndefined()
    expect(users.credentialRefFor(request('wrong'))).toBeUndefined()
    expect(users.credentialRefFor(request())).toBeUndefined()
  })
})
