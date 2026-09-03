import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session/types'
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
    const navigation = new BrowserSessionUrlNavigation(browser)
    const sessionId = SessionId('session / one')

    expect(navigation.read()).toBeUndefined()
    navigation.push(sessionId)
    expect(browser.calls).toEqual([{
      method: 'push',
      url: '/sessions/session%20%2F%20one?fixture#turn',
    }])
    expect(navigation.read()).toBe(sessionId)

    navigation.push(sessionId)
    expect(browser.calls).toHaveLength(1)
    navigation.replace(undefined)
    expect(browser.calls.at(-1)).toEqual({ method: 'replace', url: '/?fixture#turn' })
  })

  it('follows Popstate and ignores malformed or nested Session paths', () => {
    const browser = new FakeWindow()
    const navigation = new BrowserSessionUrlNavigation(browser)
    let changes = 0
    const dispose = navigation.subscribe(() => { changes++ })

    browser.navigate('/sessions/selected')
    expect(navigation.read()).toBe(SessionId('selected'))
    expect(changes).toBe(1)
    browser.navigate('/sessions/nested/path')
    expect(navigation.read()).toBeUndefined()
    browser.navigate('/sessions/%E0%A4%A')
    expect(navigation.read()).toBeUndefined()

    dispose()
    browser.navigate('/')
    expect(changes).toBe(3)
  })
})
