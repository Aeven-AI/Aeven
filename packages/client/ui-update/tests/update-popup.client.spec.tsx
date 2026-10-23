// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { UpdatePopup, type UpdatePopupProps } from '../src/client/UpdatePopup.tsx'
import type { DesktopUpdateStatus } from '../src/client/update-carrier.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

/** The real seat answers from this package's dictionary and interpolates its params. */
const t: UpdatePopupProps['t'] = (key, params) => {
  const template = (en as Record<string, string>)[key] ?? key
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/gu, (_match, name: string) => {
    const value = params[name]
    return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
  })
}

/**
 * Render the popup over one shell state.
 * @param status - the state the shell published.
 * @param open - whether the popup is showing.
 * @returns the injected verbs, spied.
 */
function popup(status: DesktopUpdateStatus, open = true) {
  const verbs = { check: vi.fn(), install: vi.fn(), close: vi.fn() }
  const useUpdate = (selector: (surface: { open: boolean; status: DesktopUpdateStatus }) => unknown) =>
    selector({ open, status }) as never
  render(
    <UpdatePopup
      useUpdate={useUpdate}
      useSessions={unusedHook}
      useSessionPendingInteraction={unusedHook}
      useWorkspaces={unusedHook}
      {...verbs}
      t={t}
    />,
  )
  return verbs
}

/** Global standard kit seats this popup never reads. */
const unusedHook = (() => { throw new Error('unused by the update popup') }) as never

describe('desktop update popup', () => {
  it('renders nothing while the reader has it closed', () => {
    popup({ phase: 'ready', version: '1.2.0' }, false)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('reports the newest release and closes on Close', () => {
    const { close } = popup({ phase: 'idle' })
    expect(screen.getByText('You already have the latest version.')).toBeTruthy()
    fireEvent.click(screen.getByText('Close'))
    expect(close).toHaveBeenCalledOnce()
  })

  it('shows the check running with the loading mark', () => {
    popup({ phase: 'checking' })
    expect(screen.getByText('Checking for updates…')).toBeTruthy()
    expect(document.querySelector('svg')).toBeTruthy()
    expect(screen.queryByText('Later')).toBeNull()
  })

  it('follows a download with and without a percentage', () => {
    popup({ phase: 'downloading', version: '1.2.0', percent: 42 })
    expect(screen.getByText('Downloading update 1.2.0 — 42%')).toBeTruthy()
    cleanup()
    popup({ phase: 'available', version: '1.2.0' })
    expect(screen.getByText('Downloading update 1.2.0…')).toBeTruthy()
  })

  it('asks before the restart that installs the downloaded release', () => {
    const { install, close } = popup({ phase: 'ready', version: '1.2.0' })
    expect(screen.getByText('Update 1.2.0 is ready to install.')).toBeTruthy()
    expect(screen.getByText('Restarting switches Aeven to the new version.')).toBeTruthy()
    fireEvent.click(screen.getByText('Restart and install'))
    expect(install).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByText('Later'))
    expect(close).toHaveBeenCalledOnce()
  })

  it('reports the install in flight without offering another answer', () => {
    popup({ phase: 'installing', version: '1.2.0' })
    expect(screen.getByText('Installing update 1.2.0. Aeven restarts when it is done.')).toBeTruthy()
    expect(screen.queryByText('Restart and install')).toBeNull()
    expect(screen.queryByText('Later')).toBeNull()
  })

  it('reports a failed check and offers another try', () => {
    const { check, close } = popup({ phase: 'error', message: 'api.github.com is unreachable' })
    expect(screen.getByText('The update could not be checked: api.github.com is unreachable')).toBeTruthy()
    fireEvent.click(screen.getByText('Try again'))
    expect(check).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByText('Close'))
    expect(close).toHaveBeenCalledOnce()
  })

  it('names no cause when the shell reported none', () => {
    popup({ phase: 'error' })
    expect(screen.getByText('The update could not be checked.')).toBeTruthy()
  })

  it('keeps the English dictionary key-identical to the Chinese source of truth', async () => {
    const { zh } = await import('../src/client/locales.ts')
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
})
