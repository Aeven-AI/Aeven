import { describe, expect, it } from 'vitest'
import { SessionId } from '@aeven/session/types'
import {
  BrowserSessionUrlNavigation,
  type SessionUrlWindow,
} from '../src/client/session-url.ts'

class FakeWindow implements SessionUrlWindow {
  readonly calls: Array<{ method: 'push' | 'replace'; url: string }> = []
  private readonly listeners = new Set<() => void>()

  readonly location = { href: 'http://127.0.0.1:3080/?fixture#turn' }
  readonly history = {
    pushState: (_data: unknown, _unused: string, url?: string | URL | null) => {
      this.commit('push', url)
    },
    replaceState: (_data: unknown, _unused: string, url?: string | URL | null) => {
      this.commit('replace', url)
    },
  }

  addEventListener(_type: 'popstate', listener: () => void): void {
    this.listeners.add(listener)
  }

  removeEventListener(_type: 'popstate', listener: () => void): void {
    this.listeners.delete(listener)
  }

  navigate(url: string): void {
    this.location.href = new URL(url, this.location.href).href
    for (const listener of [...this.listeners]) listener()
  }

  private commit(method: 'push' | 'replace', url: string | URL | null | undefined): void {
    if (url === null || url === undefined) return
    const value = String(url)
    this.calls.push({ method, url: value })
    this.location.href = new URL(value, this.location.href).href
  }
}

describe('BrowserSessionUrlNavigation', () => {
  it('reads, pushes, and replaces encoded SPA Session paths', () => {
    const browser = new FakeWindow()
    const navigation = new BrowserSessionUrlNavigation(() => browser)
    const sessionId = SessionId('session-one / two')

    expect(navigation.read()).toBeUndefined()
    navigation.push(sessionId)
    // The `session-` the Host mints is dropped from the address; everything
    // after it is still encoded, separators included.
    expect(browser.calls).toEqual([{
      method: 'push',
      url: '/c/one%20%2F%20two?fixture#turn',
    }])
    expect(navigation.read()).toBe(sessionId)

    navigation.push(sessionId)
    expect(browser.calls).toHaveLength(1)
    navigation.replace(undefined)
    expect(browser.calls.at(-1)).toEqual({ method: 'replace', url: '/?fixture#turn' })
  })

  it('owns only the root and /c paths, and writes nothing over another surface\'s address', () => {
    const browser = new FakeWindow()
    const navigation = new BrowserSessionUrlNavigation(() => browser)
    for (const [path, owned] of [
      ['/', true], ['/c', true], ['/c/one', true], ['/i', false], ['/i/one', false], ['/cx', false],
    ] as const) {
      browser.navigate(path)
      expect(navigation.ownsAddress()).toBe(owned)
    }

    browser.navigate('/i/one')
    navigation.push(SessionId('session-two'))
    navigation.replace(undefined)
    expect(browser.calls).toEqual([])
    expect(navigation.read()).toBeUndefined()
  })

  it('follows Popstate and ignores malformed or nested Session paths', () => {
    const browser = new FakeWindow()
    const navigation = new BrowserSessionUrlNavigation(() => browser)
    let changes = 0
    const dispose = navigation.subscribe(() => { changes++ })

    browser.navigate('/c/selected')
    // The address carries the id without its prefix, so reading restores it.
    expect(navigation.read()).toBe(SessionId('session-selected'))
    expect(changes).toBe(1)
    // An address written before the prefix was dropped still names its session.
    browser.navigate('/c/session-selected')
    expect(navigation.read()).toBe(SessionId('session-selected'))
    browser.navigate('/c/nested/path')
    expect(navigation.read()).toBeUndefined()
    browser.navigate('/c/%E0%A4%A')
    expect(navigation.read()).toBeUndefined()

    dispose()
    browser.navigate('/')
    expect(changes).toBe(4)
  })
})
