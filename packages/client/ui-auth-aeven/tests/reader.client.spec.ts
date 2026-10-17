// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { publishReader, publishedReader } from '../src/client/auth/services/reader.ts'
import { session } from '../src/client/auth/services/session.ts'
import { setBearerToken } from '../src/client/auth/services/tokens.ts'

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

  it('restates the reader with the picture it stored, and without the one it removed', async () => {
    scope.__AVN_AEVEN__ = { apiUrl: 'http://api.aeven.test', mediaUrl: 'https://media.aeven.test' }
    session.adoptProfile({ userId: 'u-5' })
    window.localStorage.setItem('userId', 'u-5')
    setBearerToken('u-5', `header.${btoa(JSON.stringify({ userId: 'u-5', exp: 9999999999 }))}.sig`)
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof URL ? input.href : input
      const path = new URL(url as string).pathname
      const body = path === '/upload-avatar' ? { avatar: { url: '/user-images/u-5.webp' } } : { result: 'avatar-removed' }
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    publishReader()
    expect(publishedReader()?.imageUrl).toBeUndefined()

    const stored = await publishedReader()?.setImage(new File([new Uint8Array([1])], 'me.png', { type: 'image/png' }))

    expect(stored).toBe('https://media.aeven.test/user-images/u-5.webp')
    expect(publishedReader()?.imageUrl).toBe('https://media.aeven.test/user-images/u-5.webp')

    await publishedReader()?.removeImage()
    expect(publishedReader()?.imageUrl).toBeUndefined()
  })

  it('carries a sign-out the caller can await', () => {
    session.adoptProfile({ userId: 'u-4' })
    publishReader()
    expect(typeof publishedReader()?.signOut).toBe('function')
  })
})
