// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountAuthScreen, type MountedAuthScreen } from '../src/client/auth/mount.tsx'
import { session } from '../src/client/auth/services/session.ts'
import { t } from '../src/client/locales.ts'

let mounted: MountedAuthScreen | undefined
let container: HTMLDivElement | undefined

/**
 * Install the opener a reader's own tab has.
 *
 * jsdom leaves `window.opener` undefined rather than null, and the sign-in
 * screens read a window that was opened for them from `window.opener !== null`
 * — so without this the challenge would take the landing path and close the
 * test window the moment it finished.
 */
function withNoOpener(): void {
  Object.defineProperty(window, 'opener', { value: null, configurable: true, writable: true })
}

beforeEach(withNoOpener)

afterEach(() => {
  act(() => { mounted?.unmount() })
  container?.remove()
  mounted = undefined
  container = undefined
  cleanup()
  vi.unstubAllGlobals()
  delete (globalThis as { __AVN_AEVEN__?: unknown }).__AVN_AEVEN__
  window.history.replaceState(null, '', '/')
  window.localStorage.clear()
  session.reset()
})

describe('password sign-in through the mounted MFA screen', () => {
  it('recovers from profile loading failure without resubmitting a consumed MFA challenge', async () => {
    const calls: string[] = []
    let profileReads = 0
    const grant = { userId: 'mfa-reader', accessToken: `header.${btoa(JSON.stringify({ userId: 'mfa-reader', exp: 9999999999 }))}.sig` }
    ;(globalThis as { __AVN_AEVEN__?: unknown }).__AVN_AEVEN__ = { apiUrl: 'http://api.test' }
    window.localStorage.clear()
    session.reset()
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const path = new URL(input).pathname
      calls.push(path)
      if (path === '/login') return Response.json({ challenge: 'first-factor-challenge' }, { status: 202 })
      if (path === '/mfa/login') return Response.json(grant)
      if (path === '/get-profile') {
        profileReads++
        return profileReads === 1
          ? Response.json({ error: 'temporary-error' }, { status: 500 })
          : Response.json({ userId: grant.userId, displayName: 'Reader', displayNameSet: true })
      }
      return Response.json({ error: 'unexpected-route' }, { status: 404 })
    }))
    window.history.replaceState(null, '', '/sign-in/email')
    container = document.createElement('div')
    document.body.append(container)
    const root = container
    act(() => { mounted = mountAuthScreen(root, '/sign-in/email') })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'reader@example.test' } })
    fireEvent.change(root.querySelector('input[type="password"]')!, { target: { value: 'Password123!' } })
    fireEvent.click(screen.getByRole('button', { name: t('action.signIn') }))
    await screen.findByText(t('mfa.login'))
    const boxes = root.querySelectorAll<HTMLInputElement>('.input-numbers input')
    for (const [index, digit] of [...'123456'].entries()) {
      fireEvent.change(boxes[index]!, { target: { value: digit } })
    }
    fireEvent.click(screen.getByRole('button', { name: t('mfa.confirm') }))
    await screen.findByText(t('mfa.failure'))
    expect(calls.filter(path => path === '/mfa/login')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: t('mfa.confirm') }))
    await waitFor(() => { expect(window.location.pathname).toBe('/') })
    await mounted?.authenticated
    expect(calls.filter(path => path === '/mfa/login')).toHaveLength(1)
    expect(profileReads).toBe(2)
    expect(session.userSignedIn).toBe(true)
  })
})
