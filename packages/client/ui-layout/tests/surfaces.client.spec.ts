import { describe, expect, it, vi } from 'vitest'
import { Surfaces, type SurfaceWindow } from '@aeven/client-ui-layout/src/client/surfaces.ts'

class FakeWindow implements SurfaceWindow {
  readonly calls: Array<{ method: 'push' | 'replace'; url: string }> = []
  readonly listeners = new Set<() => void>()
  readonly location = { href: 'http://127.0.0.1:3080/' }
  readonly history = {
    pushState: (_data: unknown, _unused: string, url?: string | URL | null) => { this.commit('push', url) },
    replaceState: (_data: unknown, _unused: string, url?: string | URL | null) => { this.commit('replace', url) },
  }

  addEventListener(_type: 'popstate', listener: () => void): void { this.listeners.add(listener) }
  removeEventListener(_type: 'popstate', listener: () => void): void { this.listeners.delete(listener) }

  /** Browser Back/Forward: the address moves, then popstate fires. */
  pop(path: string): void {
    this.location.href = new URL(path, this.location.href).href
    for (const listener of [...this.listeners]) listener()
  }

  private commit(method: 'push' | 'replace', url: string | URL | null | undefined): void {
    const value = String(url)
    this.calls.push({ method, url: value })
    this.location.href = new URL(value, this.location.href).href
  }
}

describe('Surfaces', () => {
  it('names the surface whose root owns the path, and none elsewhere', () => {
    const browser = new FakeWindow()
    const surfaces = new Surfaces(() => browser)
    const release = surfaces.register({ id: 'imagine', root: '/i' })

    for (const [path, expected] of [
      ['/', undefined], ['/c/abc', undefined], ['/i', 'imagine'], ['/i/abc', 'imagine'], ['/in', undefined],
    ] as const) {
      browser.pop(path)
      expect(surfaces.current.getSnapshot()).toBe(expected)
      expect(surfaces.pathname()).toBe(path)
    }

    release()
    expect(surfaces.current.getSnapshot()).toBeUndefined()
  })

  it('announces History writes, Back/Forward, and claim changes to subscribers', () => {
    const browser = new FakeWindow()
    const surfaces = new Surfaces(() => browser)
    const first = vi.fn()
    const second = vi.fn()
    const offFirst = surfaces.current.subscribe(first)
    const offSecond = surfaces.current.subscribe(second)
    expect(browser.listeners.size).toBe(1)

    const release = surfaces.register({ id: 'imagine', root: '/i' })
    surfaces.push('/i/one')
    surfaces.replace('/i/two')
    browser.pop('/c/x')
    release()
    expect(browser.calls).toEqual([{ method: 'push', url: '/i/one' }, { method: 'replace', url: '/i/two' }])
    expect(first).toHaveBeenCalledTimes(5)

    offFirst()
    expect(browser.listeners.size).toBe(1)
    offSecond()
    expect(browser.listeners.size).toBe(0)
    offSecond()
    expect(browser.listeners.size).toBe(0)
  })

  it('rejects malformed roots and colliding claims at registration', () => {
    const surfaces = new Surfaces(() => new FakeWindow())
    for (const root of ['/', 'i', '/i/', '/i/x']) {
      expect(() => surfaces.register({ id: 'imagine', root })).toThrow(/one path segment/)
    }
    const release = surfaces.register({ id: 'imagine', root: '/i' })
    expect(() => surfaces.register({ id: 'imagine', root: '/j' })).toThrow(/collides/)
    expect(() => surfaces.register({ id: 'other', root: '/i' })).toThrow(/collides/)
    release()
    // A released claim frees both its id and its root.
    expect(() => surfaces.register({ id: 'imagine', root: '/i' })).not.toThrow()
  })
})
