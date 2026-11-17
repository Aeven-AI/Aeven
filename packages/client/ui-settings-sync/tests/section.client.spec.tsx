// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SyncDeviceView, SyncView } from '@aeven/api-remotes/client'
import { SyncSection, type SyncSectionProps } from '../src/client/SyncSection.tsx'
import type { SyncOperations } from '../src/client/passkey.ts'
import { en, es, zh } from '../src/client/locales.ts'

afterEach(cleanup)

function setup(view: SyncView, copy = en) {
  let status = view
  let changed = () => {}
  let devicesChanged = () => {}
  const ops: SyncOperations = {
    status: vi.fn(() => Promise.resolve(status)),
    devices: vi.fn(() => Promise.resolve<SyncDeviceView[]>([{ id: 'd1', name: 'Laptop', current: true }])),
    setEnabled: vi.fn(() => Promise.resolve(status)),
    startPasskey: vi.fn(() => Promise.resolve({ url: 'https://example.test/passkey' })),
    cancelPasskey: vi.fn(() => Promise.resolve(status)),
    unprotect: vi.fn(() => Promise.resolve(status)),
    acceptServerKey: vi.fn(() => Promise.resolve(status)),
    onChange: (listener) => { changed = listener; return () => { changed = () => {} } },
    onDevicesChange: (listener) => { devicesChanged = listener; return () => { devicesChanged = () => {} } },
  }
  const props = {
    ...ops, close: () => {}, detail: undefined, showDetail: () => {}, renderSlot: () => null,
    t: (key: keyof typeof en, values?: Record<string, string>) => {
      let text = copy[key]
      for (const [name, value] of Object.entries(values ?? {})) text = text.replace(`{${name}}`, value)
      return text
    },
  } as unknown as SyncSectionProps
  const rendered = render(<SyncSection {...props} />)
  return { ops, rendered, devicesChanged: () => { devicesChanged() }, update: async (next: SyncView) => {
    status = next
    await act(async () => { changed() })
  } }
}

const online: SyncView = { state: 'online', pending: 0, queued: 0, sessionsPending: 0, sessionsTotal: 0 }

describe('Sync settings', () => {
  const copies = [{ locale: 'en', copy: en }, { locale: 'zh', copy: zh }, { locale: 'es', copy: es }]
  it.each(copies)('$locale keeps catch-up distinct from completed synchronization', async ({ copy }) => {
    const page = setup({ ...online, catchingUp: true }, copy)
    await screen.findByText(copy.downloading)
    await screen.findByText('Laptop')
    expect(screen.queryByText(copy.online)).toBeNull()
    expect(page.rendered.container.textContent).toMatchSnapshot('downloading')
    await page.update(online)
    await screen.findByText(copy.online)
    expect(screen.queryByText('0 / 0')).toBeNull()
    expect(page.rendered.container.textContent).toMatchSnapshot('up-to-date')
  })

  it('shows transfer details only after opening the status icon and retries from the popup', async () => {
    const { ops } = setup({ ...online, error: 'upload', pending: 1, queued: 1, sessionsTotal: 1 })
    const icon = await screen.findByRole('button', { name: en.syncDetails })
    expect(screen.queryByText(en.uploadFailed)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0')
    fireEvent.click(icon)
    await screen.findByText(en.uploadFailed)
    fireEvent.click(screen.getByText(en.retry))
    await waitFor(() => { expect(ops.setEnabled).toHaveBeenCalledWith(true) })
  })

  it('refreshes devices on device changes without rereading them for upload progress', async () => {
    const page = setup(online)
    await screen.findByText('Laptop')
    await page.update({ ...online, pending: 1, queued: 2 })
    expect(page.ops.devices).toHaveBeenCalledTimes(1)
    vi.mocked(page.ops.devices).mockResolvedValue([
      { id: 'd1', name: 'Laptop', current: true }, { id: 'd2', name: 'Desktop', current: false },
    ])
    await act(async () => { page.devicesChanged() })
    await screen.findByText('Desktop')
    expect(screen.getByRole('img', { name: en.thisDevice })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /device/i })).toBeNull()
  })

  it('coalesces device notifications while a device read is in flight', async () => {
    const page = setup(online)
    await screen.findByText('Laptop')
    let finish!: (devices: SyncDeviceView[]) => void
    vi.mocked(page.ops.devices).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    await act(async () => { page.devicesChanged(); page.devicesChanged(); page.devicesChanged() })
    expect(page.ops.devices).toHaveBeenCalledTimes(2)
    await act(async () => { finish([{ id: 'd1', name: 'Laptop', current: true }]) })
    await waitFor(() => { expect(page.ops.devices).toHaveBeenCalledTimes(3) })
  })

  it('offers another device-list read from the failure popup', async () => {
    const page = setup(online)
    await screen.findByText('Laptop')
    vi.mocked(page.ops.devices).mockRejectedValueOnce(new Error('offline'))
    await act(async () => { page.devicesChanged() })
    fireEvent.click(await screen.findByRole('button', { name: en.syncDetails }))
    await screen.findByText(en.devicesFailed)
    fireEvent.click(screen.getByText(en.retry))
    await waitFor(() => { expect(page.ops.devices).toHaveBeenCalledTimes(3) })
  })
})
