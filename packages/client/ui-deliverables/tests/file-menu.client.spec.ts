// @vitest-environment jsdom
/**
 * ui-deliverables' desktop file menu: the rows it shows for one produced path,
 * the Host handoffs its rows make, the path spellings they copy, and that the
 * bridge is read only where a desktop shell is there to draw a menu.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClientRemote } from '@aeven/api-remotes/client'
import type { SessionOpenWorkspacePathRequest, SessionWorkspacePathApplication } from '@aeven/api-session-controller/types'
import { makeTranslate } from '@aeven/client-test-runtime'
import {
  FILE_MENU_ROWS, desktopFileMenus, fileMenuLabels, fileMenuRows, revealLabel, showFileMenu,
  type FileMenuCarrier, type FileMenuLabels, type FileMenuRow,
} from '../src/client/file-menu.ts'
import { en, zh } from '../src/client/locales.ts'

const LABELS: FileMenuLabels = {
  open: 'Open',
  openIn: 'Open in {app}',
  reveal: 'Show in Finder',
  copyRelativePath: 'Copy relative path',
  copyFullPath: 'Copy full path',
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/** A Remote whose session namespace records every handoff and answers one handler list. */
function remoteWith(
  applications: readonly SessionWorkspacePathApplication[] | Error,
  opened: SessionOpenWorkspacePathRequest[],
): ClientRemote {
  const answer = applications instanceof Error
    ? Promise.reject(applications)
    : Promise.resolve({ ok: true as const, value: applications })
  return {
    session: {
      openWorkspacePath: (request: SessionOpenWorkspacePathRequest) => {
        opened.push(request)
        return Promise.resolve({ ok: true as const, value: { opened: true as const } })
      },
      workspacePathApplications: () => answer,
    },
  } as unknown as ClientRemote
}

/** A shell stand-in that reports the row the reader chose. */
function carrier(chosen: string | null, shown: FileMenuRow[][] = []): FileMenuCarrier {
  return {
    show: (items) => {
      shown.push([...items])
      return Promise.resolve(chosen)
    },
  }
}

const cursor: SessionWorkspacePathApplication = { id: 'cursor', name: 'Cursor.app', default: true, icon: null }
const typora: SessionWorkspacePathApplication = { id: 'typora', name: 'Typora', default: false, icon: null }

describe('file menu rows', () => {
  it('offers the default application, the reveal row, and both path spellings', () => {
    expect(fileMenuRows(LABELS, 'Cursor')).toEqual([
      { type: 'row', id: FILE_MENU_ROWS.open, label: 'Open in Cursor' },
      { type: 'row', id: FILE_MENU_ROWS.reveal, label: 'Show in Finder' },
      { type: 'row', id: FILE_MENU_ROWS.copyRelative, label: 'Copy relative path' },
      { type: 'row', id: FILE_MENU_ROWS.copyFull, label: 'Copy full path' },
    ])
    expect(fileMenuRows(LABELS)[0]).toEqual({ type: 'row', id: FILE_MENU_ROWS.open, label: 'Open' })
  })

  it('names the file manager the platform ships, and reads its own dictionary', () => {
    const t = makeTranslate(en)
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' })
    expect(revealLabel(t)).toBe('Show in Finder')
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })
    expect(revealLabel(t)).toBe('Show in Explorer')
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' })
    expect(revealLabel(t)).toBe('Show in folder')
    expect(fileMenuLabels(t)).toEqual({
      open: 'Open',
      openIn: 'Open in {app}',
      reveal: 'Show in folder',
      copyRelativePath: 'Copy relative path',
      copyFullPath: 'Copy full path',
    })
    expect(Object.keys(zh)).toEqual(Object.keys(en))
  })
})

describe('the desktop menu bridge', () => {
  it('is absent in the browser-served client and present in the shell', () => {
    expect(desktopFileMenus()).toBeUndefined()
    const show = (): Promise<string | null> => Promise.resolve(null)
    vi.stubGlobal('window', { avnDesktop: { contextMenu: { show } } })
    expect(desktopFileMenus()?.show).toBe(show)
    vi.stubGlobal('window', { avnDesktop: {} })
    expect(desktopFileMenus()).toBeUndefined()
  })
})

describe('showing one file menu', () => {
  it('opens the file in the desktop default application, resolved against the workspace root', async () => {
    const opened: SessionOpenWorkspacePathRequest[] = []
    const shown: FileMenuRow[][] = []
    await showFileMenu(
      { menus: carrier(FILE_MENU_ROWS.open, shown), remote: remoteWith([cursor, typora], opened), labels: LABELS },
      'src/index.ts',
      '/workspace',
    )
    expect(shown[0]?.[0]).toEqual({ type: 'row', id: FILE_MENU_ROWS.open, label: 'Open in Cursor' })
    expect(opened).toEqual([{ path: '/workspace/src/index.ts', application: 'cursor' }])
  })

  it('reveals the file in the file manager', async () => {
    const opened: SessionOpenWorkspacePathRequest[] = []
    await showFileMenu(
      { menus: carrier(FILE_MENU_ROWS.reveal), remote: remoteWith([], opened), labels: LABELS },
      '/workspace/out/report.md',
      '/workspace',
    )
    expect(opened).toEqual([{ path: '/workspace/out/report.md', action: 'reveal' }])
  })

  it('opens the file with no application named when the Host lists none', async () => {
    const opened: SessionOpenWorkspacePathRequest[] = []
    const shown: FileMenuRow[][] = []
    await showFileMenu(
      { menus: carrier(FILE_MENU_ROWS.open, shown), remote: remoteWith([], opened), labels: LABELS },
      'notes.md',
      undefined,
    )
    expect(shown[0]?.[0]).toEqual({ type: 'row', id: FILE_MENU_ROWS.open, label: 'Open' })
    expect(opened).toEqual([{ path: 'notes.md' }])
  })

  it('copies the path the assistant wrote, and the absolute path, as its own rows say', async () => {
    const written: string[] = []
    vi.stubGlobal('navigator', {
      clipboard: { writeText: (text: string) => { written.push(text); return Promise.resolve() } },
    })
    const remote = remoteWith([], [])
    await showFileMenu({ menus: carrier(FILE_MENU_ROWS.copyRelative), remote, labels: LABELS }, 'src/index.ts', '/workspace')
    await showFileMenu({ menus: carrier(FILE_MENU_ROWS.copyFull), remote, labels: LABELS }, 'src/index.ts', '/workspace')
    expect(written).toEqual(['src/index.ts', '/workspace/src/index.ts'])
  })

  it('leaves the desktop alone when the menu is dismissed, and reports a refused handoff', async () => {
    const opened: SessionOpenWorkspacePathRequest[] = []
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const remote = remoteWith([], opened)
    await showFileMenu({ menus: carrier(null), remote, labels: LABELS }, 'src/index.ts', '/workspace')
    expect(opened).toEqual([])
    expect(warned).not.toHaveBeenCalled()

    const failing = {
      session: {
        openWorkspacePath: () => Promise.resolve({ ok: false as const, error: { message: 'no handler' } }),
        workspacePathApplications: () => Promise.resolve({ ok: true as const, value: [] }),
      },
    } as unknown as ClientRemote
    await showFileMenu({ menus: carrier(FILE_MENU_ROWS.open), remote: failing, labels: LABELS }, 'src/index.ts', '/workspace')
    expect(warned).toHaveBeenCalledWith('ui-deliverables: the Host refused /workspace/src/index.ts: no handler')
  })

  it('still offers the menu when the Host names no applications, and when the query fails', async () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const shown: FileMenuRow[][] = []
    const broken = remoteWith(new Error('nope'), [])
    await showFileMenu({ menus: carrier(null, shown), remote: broken, labels: LABELS }, 'src/index.ts', '/workspace')
    expect(shown[0]?.[0]).toEqual({ type: 'row', id: FILE_MENU_ROWS.open, label: 'Open' })
    expect(warned).toHaveBeenCalledWith(
      'ui-deliverables: the Host named no applications for /workspace/src/index.ts',
      expect.any(Error),
    )

    // A refused handler query is answered by the Remote result, not a rejection.
    await showFileMenu(
      {
        menus: carrier(null, shown),
        remote: {
          session: { workspacePathApplications: () => Promise.resolve({ ok: false as const, error: { message: 'no' } }) },
        } as unknown as ClientRemote,
        labels: LABELS,
      },
      'src/index.ts',
      '/workspace',
    )
    expect(shown).toHaveLength(2)
  })

  it('reports a refused clipboard write', async () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText: () => Promise.reject(new Error('denied')) } })
    await showFileMenu(
      { menus: carrier(FILE_MENU_ROWS.copyFull), remote: remoteWith([], []), labels: LABELS },
      'src/index.ts',
      '/workspace',
    )
    expect(warned).toHaveBeenCalledWith('ui-deliverables: the clipboard refused a path')
  })

  it('ignores a row the shell reports that this menu does not own', async () => {
    const opened: SessionOpenWorkspacePathRequest[] = []
    await showFileMenu(
      { menus: carrier('open-in-browser'), remote: remoteWith([], opened), labels: LABELS },
      'src/index.ts',
      '/workspace',
    )
    expect(opened).toEqual([])
  })
})
