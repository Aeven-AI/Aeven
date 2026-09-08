import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { IdentityUsers, type IdentityRequest, type User, type UserResolver } from '../src/index.ts'

/** A resolver that recognizes one fixed header value. */
function resolverFor(id: string, token: string, user: User): UserResolver {
  return {
    id,
    resolve: (request: IdentityRequest) =>
      (request.headers as Record<string, string>)['authorization'] === token ? user : undefined,
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
