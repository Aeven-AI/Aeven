// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { ClientRemote, SessionId } from '@aeven/api-remotes/client'
import { canPreviewFile } from '../src/client/open-with.tsx'

describe('sidebar viewer selection', () => {
  it.each(['pdf', 'doc', 'docx', 'docm', 'xls', 'xlsx', 'xlsm', 'ppt', 'pptx', 'ppsx', 'odt', 'ods', 'odp', 'pages', 'numbers', 'key', 'rtf'])(
    'hands .%s documents to the desktop without reading them as text', async (extension) => {
      const read = vi.fn()
      const remote = { workspaceFiles: { read } } as unknown as ClientRemote
      expect(await canPreviewFile(remote, 'session' as SessionId, `/workspace/report.${extension}`)).toBe(false)
      expect(read).not.toHaveBeenCalled()
    },
  )

  it('keeps images in the sidebar and detects other binary files through the workspace reader', async () => {
    const read = vi.fn().mockResolvedValue({ ok: false, error: { code: 'workspace-file/not-text' } })
    const remote = { workspaceFiles: { read } } as unknown as ClientRemote
    expect(await canPreviewFile(remote, 'session' as SessionId, 'image.png')).toBe(true)
    expect(read).not.toHaveBeenCalled()
    expect(await canPreviewFile(remote, 'session' as SessionId, 'unknown.bin')).toBe(false)
    read.mockResolvedValue({ ok: true, value: { text: 'notes' } })
    expect(await canPreviewFile(remote, 'session' as SessionId, 'notes.md')).toBe(true)
  })
})
