import { afterEach, describe, expect, it, vi } from 'vitest'
import { publishReader, publishedReader } from '../src/client/auth/services/reader.ts'
import { session } from '../src/client/auth/services/session.ts'

interface Scope {
  __AVN_AEVEN__?: Record<string, string>
  __AVN_AEVEN_READER__?: unknown
}

const scope = globalThis as Scope

afterEach(() => {
  session.reset()
  delete scope.__AVN_AEVEN__
  delete scope.__AVN_AEVEN_READER__
  vi.unstubAllGlobals()
})

describe('published Aeven reader', () => {
  it('states nothing while nobody is signed in', () => {
    publishReader()
    expect(publishedReader()).toBeUndefined()
  })

  it('states nothing when a session carries no user id', () => {
    session.userSignedIn = true
    session.userId = null
    publishReader()
    expect(publishedReader()).toBeUndefined()
  })

  it('states the reader with only the facts this deployment knows', () => {
    session.adoptProfile({ userId: 'u-1' })
    publishReader()
    expect(publishedReader()).toMatchObject({ userId: 'u-1' })
    expect(publishedReader()?.displayName).toBeUndefined()
    expect(publishedReader()?.imageUrl).toBeUndefined()
    expect(publishedReader()?.accountUrl).toBeUndefined()
  })

  it('resolves the picture and account page against the configured origins', () => {
    scope.__AVN_AEVEN__ = { webUrl: 'https://aeven.test', mediaUrl: 'https://media.aeven.test' }
    session.adoptProfile({
      userId: 'u-2',
      displayName: 'Ollie',
      profile: { avatar: { url: '/user-images/u-2.png' } },
    })
    publishReader()
    expect(publishedReader()).toMatchObject({
      userId: 'u-2',
      displayName: 'Ollie',
      imageUrl: 'https://media.aeven.test/user-images/u-2.png',
      accountUrl: 'https://aeven.test/account/',
    })
  })

  it('withdraws a stated reader once the session is reset', () => {
    session.adoptProfile({ userId: 'u-3' })
    publishReader()
    session.reset()
    publishReader()
    expect(publishedReader()).toBeUndefined()
  })

  it('carries a sign-out the caller can await', () => {
    session.adoptProfile({ userId: 'u-4' })
    publishReader()
    expect(typeof publishedReader()?.signOut).toBe('function')
  })
})
