// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SyncKeyHolderView, SyncView } from '@aeven/api-remotes/client'
import { SyncPasskeyPopup, type SyncPasskeyPopupProps } from '../src/client/SyncPasskeyPopup.tsx'
import { AccountPrivacy, type AccountPrivacyProps } from '../src/client/AccountPrivacy.tsx'
import { RecoveryKeyDialog } from '../src/client/RecoveryKeyDialog.tsx'
import { useFocusAfterPasskey, type SyncOperations } from '../src/client/passkey.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: keyof typeof en, values?: Record<string, string>): string => {
  let text = en[key]
  for (const [name, value] of Object.entries(values ?? {})) text = text.replace(`{${name}}`, value)
  return text
}

const ANDROID: SyncKeyHolderView = { id: 'cred-1', kind: 'passkey', aaguid: 'ea9b8d664d011d213ce4b6b48cb575d4', device: 'android', addedAt: '2026-11-16T10:28:30.000Z' }
const RECOVERY: SyncKeyHolderView = { id: 'recovery-1', kind: 'recovery', addedAt: '2026-11-17T09:00:00.000Z' }

function protectedView(holders: SyncKeyHolderView[], locked: boolean): SyncView {
  return {
    state: locked ? 'starting' : 'online', pending: 0, queued: 0, sessionsPending: 0, sessionsTotal: 0,
    protection: { mode: 'passkey', locked, downgraded: false, passkeys: holders.filter(h => h.kind === 'passkey').length, holders },
  }
}

function operations(view: SyncView): SyncOperations {
  return {
    status: vi.fn(() => Promise.resolve(view)),
    devices: vi.fn(() => Promise.resolve([])),
    setEnabled: vi.fn(() => Promise.resolve(view)),
    startPasskey: vi.fn(() => Promise.resolve({ url: 'https://example.test/passkey' })),
    cancelPasskey: vi.fn(() => Promise.resolve(view)),
    unprotect: vi.fn(() => Promise.resolve(view)),
    acceptServerKey: vi.fn(() => Promise.resolve(view)),
    createRecoveryKey: vi.fn(() => Promise.resolve({ key: '13XH-M8MT-SVSY-WJ5M-PKQ2-HDF7-Q2PW' })),
    unlockWithRecoveryKey: vi.fn(() => Promise.resolve(view)),
    renamePasskey: vi.fn(() => Promise.resolve(view)),
    removePasskey: vi.fn(() => Promise.resolve(view)),
    unlockFromSignIn: vi.fn(() => Promise.resolve(view)),
    onChange: () => () => {},
    onDevicesChange: () => () => {},
  }
}

function popup(view: SyncView) {
  const ops = operations(view)
  const props = { ...ops, signedInThisPage: () => false, takeSignInUnlock: () => undefined, t } as unknown as SyncPasskeyPopupProps
  render(<SyncPasskeyPopup {...props} />)
  return ops
}

describe('the unlock popup', () => {
  it('names the passkey that unlocks the account', async () => {
    popup(protectedView([ANDROID], true))
    await screen.findByText(new RegExp('Use your passkey from Google Password Manager on your Android phone, added'))
    expect(screen.queryByText(en.useRecovery)).toBeNull()
  })

  it('falls back to a general hint for passkeys stored before providers were recorded', async () => {
    popup(protectedView([{ id: 'old', kind: 'passkey' }], true))
    await screen.findByText(new RegExp(en.holderUnknown))
  })

  it('starts over only after the reader confirms', async () => {
    const ops = popup(protectedView([ANDROID], true))
    fireEvent.click(await screen.findByText(en.startOver))
    await screen.findByText(en.startOverTitle)
    expect(ops.unprotect).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText(en.back))
    fireEvent.click(await screen.findByText(en.startOver))
    fireEvent.click(await screen.findByText(en.startOverConfirm))
    await waitFor(() => { expect(ops.unprotect).toHaveBeenCalledTimes(1) })
  })

  it('unlocks with a recovery key and says so when the key does not fit', async () => {
    const ops = popup(protectedView([ANDROID, RECOVERY], true))
    vi.mocked(ops.unlockWithRecoveryKey).mockRejectedValueOnce(new Error('mismatch'))
    fireEvent.click(await screen.findByText(en.useRecovery))
    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: 'wrong-key' } })
    fireEvent.click(screen.getByText(en.unlock))
    await screen.findByText(en.recoveryWrong)
    fireEvent.change(input, { target: { value: '13xh m8mt svsy wj5m pkq2 hdf7 q2pw' } })
    fireEvent.click(screen.getByText(en.unlock))
    await waitFor(() => { expect(ops.unlockWithRecoveryKey).toHaveBeenLastCalledWith('13xh m8mt svsy wj5m pkq2 hdf7 q2pw') })
  })
})

describe('the recovery key dialog', () => {
  it('shows the key, then closes only once the reader types it back', async () => {
    const onClose = vi.fn()
    render(<RecoveryKeyDialog recoveryKey="13XH-M8MT-SVSY-WJ5M-PKQ2-HDF7-Q2PW" t={t} onClose={onClose} />)
    await screen.findByText('13XH-M8MT-SVSY-WJ5M-PKQ2-HDF7-Q2PW')
    fireEvent.click(screen.getByText(en.continue))
    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: '13XH-M8MT-SVSY-WJ5M-PKQ2-HDF7-AAAA' } })
    fireEvent.click(screen.getByText(en.done))
    await screen.findByText(en.confirmMismatch)
    expect(onClose).not.toHaveBeenCalled()
    // Lower case, spaces, and the look-alikes l and o read as Crockford base32 does.
    fireEvent.change(input, { target: { value: 'l3xh m8mt svsy wj5m pkq2 hdf7 q2pw' } })
    fireEvent.click(screen.getByText(en.done))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('passkeys in Account → Security', () => {
  function section(view: SyncView) {
    const ops = operations(view)
    const props = { ...ops, t } as unknown as AccountPrivacyProps
    render(<AccountPrivacy {...props} />)
    return ops
  }

  it('lists each passkey by provider and device and removes one while another stays', async () => {
    const ops = section(protectedView([ANDROID, { id: 'cred-2', kind: 'passkey', name: 'Work laptop' }], false))
    await screen.findByText('Google Password Manager on your Android phone')
    await screen.findByText(en.passkeysSignIn)
    const second = screen.getAllByText(en.remove)[1]
    if (second === undefined) throw new Error('two passkey rows expected')
    fireEvent.click(second)
    await screen.findByText(en.removeTitle)
    const buttons = screen.getAllByText(en.remove)
    const confirm = buttons[buttons.length - 1]
    if (confirm === undefined) throw new Error('a confirmation button expected')
    fireEvent.click(confirm)
    await waitFor(() => { expect(ops.removePasskey).toHaveBeenCalledWith('cred-2') })
  })

  it('offers a passkey that only unlocks to sign in as well, and leaves a passkey that signs in as it is', async () => {
    // The desktop bridge opens the passkey page in the system browser; jsdom has no window.open to stand in for it.
    const openExternal = vi.fn(() => Promise.resolve())
    ;(window as { avnDesktop?: unknown }).avnDesktop = { browser: { openExternal } }
    try {
      const ops = section(protectedView([{ ...ANDROID, signIn: true }, { id: 'cred-old', kind: 'passkey', signIn: false }], false))
      await screen.findByText(en.passkeyUnlockOnly)
      const upgrades = screen.getAllByText(en.useToSignIn)
      expect(upgrades).toHaveLength(1)
      fireEvent.click(upgrades[0] as HTMLElement)
      await waitFor(() => { expect(ops.startPasskey).toHaveBeenCalledWith('upgrade', undefined, 'cred-old') })
      expect(openExternal).toHaveBeenCalledWith('https://example.test/passkey')
    } finally {
      delete (window as { avnDesktop?: unknown }).avnDesktop
    }
  })

  it('creates a recovery key', async () => {
    const ops = section(protectedView([ANDROID], false))
    fireEvent.click(await screen.findByText(en.createRecovery))
    await screen.findByText('13XH-M8MT-SVSY-WJ5M-PKQ2-HDF7-Q2PW')
    expect(ops.createRecoveryKey).toHaveBeenCalledTimes(1)
  })

  it('removes the only passkey by turning protection off, after saying so, and never removes it alone', async () => {
    const ops = section(protectedView([ANDROID], false))
    fireEvent.click(await screen.findByText(en.remove))
    await screen.findByText(en.removeLastTitle)
    expect(ops.unprotect).not.toHaveBeenCalled()
    fireEvent.click(screen.getAllByText(en.remove).at(-1) as HTMLElement)
    await waitFor(() => { expect(ops.unprotect).toHaveBeenCalledTimes(1) })
    expect(ops.removePasskey).not.toHaveBeenCalled()
  })
})

describe('returning to the desktop app after a passkey step', () => {
  function Probe({ view }: { view: SyncView }) {
    useFocusAfterPasskey(view)
    return null
  }

  it('brings the window forward when the step succeeds, not when it fails', () => {
    const focus = vi.fn(() => Promise.resolve())
    ;(window as { avnDesktop?: unknown }).avnDesktop = { window: { focus } }
    try {
      const base = protectedView([ANDROID], true)
      const waiting: SyncView = { ...base, passkey: { purpose: 'unlock', state: 'waiting' } }
      const failed: SyncView = { ...base, passkey: { purpose: 'unlock', state: 'wrong-passkey' } }
      const done: SyncView = protectedView([ANDROID], false)
      const { rerender } = render(<Probe view={waiting} />)
      rerender(<Probe view={failed} />)
      expect(focus).not.toHaveBeenCalled()
      rerender(<Probe view={waiting} />)
      rerender(<Probe view={done} />)
      expect(focus).toHaveBeenCalledTimes(1)
    } finally {
      delete (window as { avnDesktop?: unknown }).avnDesktop
    }
  })
})
