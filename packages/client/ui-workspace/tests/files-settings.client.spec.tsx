// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceFilesSettings, WorkspaceId } from '@aeven/api-workspace-controller/client'
import { FilesSection, type FilesSectionInjected, type FilesSectionProps } from '../src/client/settings/FilesSection.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const initial: WorkspaceFilesSettings = {
  paused: false,
  ignores: ['node_modules', '*.log'],
  workspaces: [{ workspaceId: 'workspace' as WorkspaceId, title: 'Project', path: '/project', files: null }],
}

function setup(load = vi.fn(() => Promise.resolve(initial))) {
  let changed = () => {}
  const ops: FilesSectionInjected = {
    load,
    setPaused: vi.fn(paused => Promise.resolve({ ...initial, paused })),
    setIgnores: vi.fn(ignores => Promise.resolve({ ...initial, ignores: [...ignores] })),
    reveal: vi.fn(),
    onChange: (listener) => { changed = listener; return () => { changed = () => {} } },
  }
  const props = { ...ops, t: (key: keyof typeof en) => en[key] } as unknown as FilesSectionProps
  const page = render(<FilesSection {...props} />)
  return { ops, page, changed: () => { changed() } }
}

describe('Files settings', () => {
  it('lists folders, pauses locally, and saves advanced ignore patterns', async () => {
    const { ops, page } = setup()
    await screen.findByText('Project')
    expect(page.container.textContent).toMatchSnapshot('files overview')
    fireEvent.click(screen.getByRole('switch', { name: en['filesSettings.sync'] }))
    await waitFor(() => { expect(ops.setPaused).toHaveBeenCalledWith(true) })
    await screen.findByText(en['filesSettings.syncOff'])
    fireEvent.click(screen.getByText(en['filesSettings.showAdvanced']))
    const ignores = screen.getByRole('textbox', { name: en['filesSettings.ignores'] })
    fireEvent.change(ignores, { target: { value: 'node_modules\n*.cache' } })
    fireEvent.click(screen.getByText(en['filesSettings.save']))
    await waitFor(() => { expect(ops.setIgnores).toHaveBeenCalledWith(['node_modules', '*.cache']) })
    await waitFor(() => { expect(screen.getByRole('button', { name: en['filesSettings.save'] }).hasAttribute('disabled')).toBe(true) })
  })

  it('offers another read after an initial load fails', async () => {
    const load = vi.fn(() => Promise.resolve(initial)).mockRejectedValueOnce(new Error('offline'))
    setup(load)
    fireEvent.click(await screen.findByRole('button', { name: en['filesSettings.retry'] }))
    await screen.findByText('Project')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('keeps an unsaved edit after a write fails', async () => {
    const { ops } = setup()
    vi.mocked(ops.setIgnores).mockRejectedValueOnce(new Error('offline'))
    await screen.findByText('Project')
    fireEvent.click(screen.getByText(en['filesSettings.showAdvanced']))
    const ignores = screen.getByRole('textbox', { name: en['filesSettings.ignores'] }) as HTMLTextAreaElement
    fireEvent.change(ignores, { target: { value: '*.cache' } })
    fireEvent.click(screen.getByText(en['filesSettings.save']))
    expect((await screen.findByRole('alert')).textContent).toBe(en['filesSettings.failed'])
    expect(ignores.value).toBe('*.cache')
  })

  it('refreshes workspace details when the workspace list changes', async () => {
    const { ops, changed } = setup()
    await screen.findByText('Project')
    vi.mocked(ops.load).mockResolvedValue({ ...initial, workspaces: [] })
    await act(async () => { changed() })
    await waitFor(() => { expect(screen.queryByText('Project')).toBeNull() })
  })
})
