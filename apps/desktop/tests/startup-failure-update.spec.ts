import { describe, expect, it, vi } from 'vitest'
import { en } from '../src/locale.ts'
import { failedStartUpdateStatus, updateAfterFailedStart } from '../src/startup-failure-update.ts'
import type { DesktopUpdateState } from '../src/ipc.ts'

const stream = (found: DesktopUpdateState) => ({
  check: vi.fn(async () => found),
  install: vi.fn(async (): Promise<DesktopUpdateState> => ({ phase: 'installing', version: '1.1.0' })),
})

describe('the update offered after a failed start', () => {
  it('installs a downloaded release when the reader agrees', async () => {
    const updates = stream({ phase: 'ready', version: '1.1.0' })
    const confirmRestart = vi.fn(async () => true)

    await updateAfterFailedStart({ updates, confirmRestart })

    expect(confirmRestart).toHaveBeenCalledWith('1.1.0')
    expect(updates.install).toHaveBeenCalledOnce()
  })

  it('keeps the failure window when the reader declines', async () => {
    const updates = stream({ phase: 'ready', version: '1.1.0' })

    const state = await updateAfterFailedStart({ updates, confirmRestart: async () => false })

    expect(state).toEqual({ phase: 'ready', version: '1.1.0' })
    expect(updates.install).not.toHaveBeenCalled()
  })

  it('asks nothing when no release was downloaded', async () => {
    for (const found of [{ phase: 'idle' }, { phase: 'error', message: 'offline' }] as const) {
      const updates = stream(found)
      const confirmRestart = vi.fn(async () => true)

      await updateAfterFailedStart({ updates, confirmRestart })

      expect(confirmRestart).not.toHaveBeenCalled()
      expect(updates.install).not.toHaveBeenCalled()
    }
  })

  it('words every state for the failure window', () => {
    expect(failedStartUpdateStatus({ phase: 'checking' }, en)).toBe('Checking for a newer version…')
    expect(failedStartUpdateStatus({ phase: 'idle' }, en)).toBe('No newer version is available yet.')
    expect(failedStartUpdateStatus({ phase: 'downloading', version: '1.1.0', percent: 40 }, en))
      .toBe('Downloading version 1.1.0… 40%')
    expect(failedStartUpdateStatus({ phase: 'ready', version: '1.1.0' }, en))
      .toBe('Version 1.1.0 is downloaded and installs when Æven restarts.')
    expect(failedStartUpdateStatus({ phase: 'error', message: 'offline' }, en))
      .toBe('Could not check for a newer version: offline')
  })
})
