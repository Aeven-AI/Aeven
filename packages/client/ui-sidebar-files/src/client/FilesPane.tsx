/**
 * The right sidebar's file explorer: the session's workspace as a tree, loaded
 * one folder at a time, with a name search, and a file viewer that the tree
 * docks beside once a file is open.
 *
 * Folders carry lucide folder glyphs, closed and open, rather than chevrons;
 * files carry a glyph for their kind. Everything the explorer asks for goes
 * through the `workspaceFiles` Remote; everything it remembers is per session
 * and surface (memory.ts). While a file is open, the surface's pill carries the
 * file's name beside the Files glyph.
 *
 * Listings stay current on their own: the Host's change stream reloads each
 * visible folder a change touches, and the open file, gathered into one reload
 * per folder per burst. Where the Host cannot watch the workspace, the pane
 * revalidates when the window regains focus. A reload keeps the rows on screen
 * until its answer lands, and an answer from a superseded request is dropped.
 */
import type {
  KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode, UIEvent as ReactUIEvent,
} from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import type { ClientRemote, SessionId } from '@aeven/api-remotes/client'
// Type-only: pulls the generated `workspaceFiles` namespace into ClientRemote.
import type {} from '@aeven/api-workspace-files/remote'
import type {
  WorkspaceDirectoryEntry, WorkspaceEntryCount, WorkspaceFileChange, WorkspaceFilesAccess, WorkspaceFileText,
  WorkspaceSearchHit,
} from '@aeven/api-workspace-files/types'
import {
  Button, CodeBlock, CopyIconButton, extensionOf, fileGlyph, fileKindOf, IconLucideArrowLeft, IconLucideArrowRight,
  IconLucideCheck, IconLucideChevronsDownUp, IconLucideDownload, IconLucideEye, IconLucideFolder, IconLucideFolderOpen,
  IconLucideFolderSearch, IconLucideRefreshCw, IconLucideSearch, IconLucideX, MarkdownText, Menu, Modal, Spinner,
  VideoPlayer, videoPlayerLabels, writeClipboard,
  type MarkdownLabels, type MenuEntry,
} from '@aeven/client-ui-primitives'
import type { SidebarContentPaneProps } from '@aeven/client-ui-sidebar-select/client'
import { resolveWorkspacePath } from '@aeven/util-workspace-path'
import type { TranslateNS } from '@aeven/client-ui-slots'
import {
  ancestorsOf, forgotten, recall, remember, renamed, stepHistory, visit, type ExplorerMemory,
} from './memory.ts'
import { middleTruncate, nameProblem } from './names.ts'
import {
  applicationItems, canPreviewFile, downloadWorkspaceFile, openOnDesktop, operationOf, OpenWithButton, revealLabel,
  useApplications, workspaceFileUrl,
} from './open-with.tsx'
import { previewDocument } from './preview.ts'
import css from './FilesPane.module.css'

/** What the plugin hands every Files pane beyond the column's props. */
export interface FilesPaneProps extends SidebarContentPaneProps {
  /** Report the current file and workspace root to the sidebar opener. */
  readonly onFileChange?: ((path: string | null, root: string | null) => void) | undefined
  /** Workspace-relative or absolute file requested by another client surface. */
  readonly requestedFile?: { readonly path: string } | undefined
  /** Workspace-relative folder requested by another client surface, which the tree expands to. */
  readonly requestedFolder?: { readonly path: string } | undefined
  /**
   * Offer this pane to reveal later folder requests in place.
   * @param reveal - expands the tree to a workspace-relative folder and focuses it.
   * @returns withdrawal of the offer.
   */
  readonly registerReveal?: ((reveal: (path: string) => void) => () => void) | undefined
  readonly t: TranslateNS<'sidebarFiles'>
  readonly remote: ClientRemote
  /**
   * The stored copy another surface named for a file, which an image, video, or audio file plays from instead of
   * the workspace path, such as a file another device wrote.
   * @param path - the file as the pane opened it.
   * @returns the copy's URL, or undefined to read the workspace path.
   */
  readonly copyOf?: ((path: string) => string | undefined) | undefined
}

type EntryType = WorkspaceDirectoryEntry['type']

/** One folder's listing as the tree holds it. A reload that fails keeps the previous rows and says why above them. */
type Folder =
  | { readonly status: 'loading' }
  | {
    readonly status: 'ready'
    readonly entries: readonly WorkspaceDirectoryEntry[]
    readonly truncated: boolean
    readonly failure?: string | undefined
  }
  | { readonly status: 'error'; readonly message: string }

/** One visible line of the tree. */
type Row =
  | {
    readonly kind: 'entry'
    readonly path: string
    readonly name: string
    readonly type: EntryType
    readonly depth: number
    readonly position: number
    readonly siblings: number
  }
  | { readonly kind: 'note'; readonly key: string; readonly text: string; readonly depth: number; readonly error?: boolean }
  | { readonly kind: 'draft'; readonly key: string; readonly folder: string; readonly type: 'file' | 'directory'; readonly depth: number }

/** A row's or the tree's right-click menu, anchored at the pointer. */
interface RowMenu {
  /** The entry, or null for the tree's empty space. */
  readonly target: { readonly path: string; readonly type: EntryType } | null
  readonly x: number
  readonly y: number
}

/** An entry name being typed: a new file or folder in a folder, or a rename. */
type Editing =
  | { readonly kind: 'create'; readonly folder: string; readonly type: 'file' | 'directory' }
  | { readonly kind: 'rename'; readonly path: string; readonly type: EntryType }

/** A delete awaiting confirmation, with what it takes along once counted. */
interface PendingDelete {
  readonly path: string
  readonly type: EntryType
  readonly count: WorkspaceEntryCount | null
}

/** Natural, case-insensitive name order, so `file2` precedes `file10`. */
const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Directories first, then files, each by name. */
function ordered(entries: readonly WorkspaceDirectoryEntry[]): WorkspaceDirectoryEntry[] {
  return [...entries].sort((left, right) => {
    const group = Number(right.type === 'directory') - Number(left.type === 'directory')
    return group !== 0 ? group : byName.compare(left.name, right.name)
  })
}

function join(parent: string, name: string): string {
  return parent === '' ? name : `${parent}/${name}`
}

/** A workspace-relative path in Host syntax, once the root is known. */
function absolutePath(root: string | null, path: string): string {
  return resolveWorkspacePath(root ?? undefined, path)
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/** Folder of a workspace-relative path; empty for an entry at the root. */
function folderOf(path: string): string {
  return ancestorsOf(path).at(-1) ?? ''
}

/** The tree's search waits this long after the last keystroke. */
const SEARCH_DEBOUNCE_MS = 200

/** A burst of workspace changes is gathered this long into one reload per folder. */
const CHANGE_DEBOUNCE_MS = 200

/** Longest wait before the change stream is reopened after it failed. */
const MAX_REOPEN_MS = 30_000

/** Height of an entry row, its 1px gap included, and of a note row; the windowed list positions rows by them. */
const ENTRY_HEIGHT = 41
const NOTE_HEIGHT = 32

/** The list's top padding, which its first row starts under. */
const LIST_TOP = 5

/** Pixels rendered beyond each end of the visible window, so a fast scroll never shows blank rows. */
const OVERSCAN = 600

/** Characters a search hit's folder shows before shortening from the middle. */
const PARENT_MAX = 36

/**
 * Say why a Remote call failed, in terms of the path it concerned.
 * @param t - namespace-bound translate.
 * @param code - the Remote failure code.
 * @param message - the failure's own message.
 * @returns the line to show.
 */
function failureLine(t: TranslateNS<'sidebarFiles'>, code: string, message: string): string {
  switch (code) {
    case 'workspace-file/not-found': return t('error.notFound')
    case 'workspace-file/outside-workspace': return t('error.outsideWorkspace')
    case 'workspace-file/not-text': return t('error.notText')
    case 'workspace-file/too-large': return t('error.tooLarge')
    case 'workspace-file/exists': return t('error.exists')
    case 'workspace-file/read-only': return t('error.readOnly')
    case 'workspace-file/permission-denied': return t('error.permissionDenied')
    case 'workspace-file/unsupported': return t('error.unsupported')
    case 'workspace-file/invalid-name': return t('name.character')
    default: return t('error.unavailable', { message })
  }
}

/** The failure line for a thrown value. */
function thrownLine(t: TranslateNS<'sidebarFiles'>, error: unknown): string {
  return t('error.unavailable', { message: error instanceof Error ? error.message : String(error) })
}

/** The Remote failure code a stream threw, when it carries one. */
function codeOf(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : undefined
}

/** Whether an event comes from a text field, where the tree's keys must not act. */
function fromTextField(event: ReactKeyboardEvent): boolean {
  const target = event.target as HTMLElement
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
}

/**
 * Render one Files surface.
 * @param props - the column's pane props plus the plugin's copy and Remote.
 * @returns the explorer element tree.
 */
export function FilesPane({
  sessionId, surfaceId, setTab, t, remote, requestedFile, requestedFolder, registerReveal, onFileChange, copyOf,
}: FilesPaneProps): ReactNode {
  const session = sessionId as SessionId
  const [memory, setMemory] = useState<ExplorerMemory>(() => recall(sessionId, surfaceId))
  const memoryRef = useRef(memory)
  memoryRef.current = memory
  const update = useCallback((next: (current: ExplorerMemory) => ExplorerMemory) => {
    setMemory((current) => {
      const value = next(current)
      remember(sessionId, surfaceId, value)
      return value
    })
  }, [sessionId, surfaceId])

  const [root, setRoot] = useState<string | null>(null)
  useEffect(() => {
    onFileChange?.(memory.openFile, root)
  }, [memory.openFile, root, onFileChange])

  const [folders, setFolders] = useState<ReadonlyMap<string, Folder>>(new Map())
  const foldersRef = useRef(folders)
  foldersRef.current = folders
  const [focus, setFocus] = useState<string | null>(null)
  const [rowMenu, setRowMenu] = useState<RowMenu | null>(null)
  const [canOpenNative, setCanOpenNative] = useState(false)
  const [access, setAccess] = useState<WorkspaceFilesAccess | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [fileVersion, setFileVersion] = useState(0)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [watching, setWatching] = useState(false)

  // Each folder's newest request: an answer from an older one is dropped, and a new request aborts the old.
  const generations = useRef(new Map<string, number>())
  const controllers = useRef(new Map<string, AbortController>())
  // Folders loaded once but collapsed when a change touched them; they reload when next expanded.
  const dirty = useRef(new Set<string>())
  useEffect(() => () => {
    for (const controller of controllers.current.values()) controller.abort()
  }, [])

  /**
   * Reload folders together and publish every answer in one update. A folder with rows keeps them until its answer
   * lands; one never loaded shows a loading note meanwhile.
   */
  const reload = useCallback(async (paths: Iterable<string>): Promise<void> => {
    const unique = [...new Set(paths)]
    if (unique.length === 0) return
    for (const path of unique) dirty.current.delete(path)
    setFolders((current) => {
      if (unique.every(path => current.get(path)?.status === 'ready')) return current
      const next = new Map(current)
      for (const path of unique) if (current.get(path)?.status !== 'ready') next.set(path, { status: 'loading' })
      return next
    })
    const outcomes = await Promise.all(unique.map(async (path) => {
      controllers.current.get(path)?.abort()
      const controller = new AbortController()
      controllers.current.set(path, controller)
      const generation = (generations.current.get(path) ?? 0) + 1
      generations.current.set(path, generation)
      try {
        const result = await remote.workspaceFiles.list(session, path, controller.signal)
        return { path, generation, controller, result, error: undefined }
      } catch (error: unknown) {
        return { path, generation, controller, result: undefined, error }
      }
    }))
    const live = outcomes.filter(outcome => generations.current.get(outcome.path) === outcome.generation)
    if (live.length === 0) return
    for (const outcome of live) {
      if (controllers.current.get(outcome.path) === outcome.controller) controllers.current.delete(outcome.path)
    }
    const listedRoot = live.find(outcome => outcome.result?.ok === true)?.result
    if (listedRoot?.ok === true) setRoot(listedRoot.value.root)
    setFolders((current) => {
      const next = new Map(current)
      for (const { path, result, error } of live) {
        const failure = result === undefined
          ? thrownLine(t, error)
          : result.ok ? undefined : failureLine(t, result.error.code, result.error.message)
        if (result?.ok === true) {
          next.set(path, { status: 'ready', entries: ordered(result.value.entries), truncated: result.value.truncated })
          continue
        }
        const previous = current.get(path)
        next.set(path, previous?.status === 'ready'
          ? { ...previous, failure }
          : { status: 'error', message: failure ?? t('error.unavailable', { message: '' }) })
      }
      return next
    })
  }, [remote, session, t])

  /** The folders whose rows show: the root and every expanded folder whose ancestors are all expanded. */
  const shownFolders = useCallback((expanded: ReadonlySet<string>): string[] => [
    '', ...[...expanded].filter(path => ancestorsOf(path).every(ancestor => expanded.has(ancestor))),
  ], [])

  // The root, and every folder the surface remembers open, load on mount.
  useEffect(() => {
    void reload(['', ...memory.expanded])
    void remote.session.canOpenWorkspacePath().then((result) => { setCanOpenNative(result.ok && result.value) }, () => undefined)
    void remote.workspaceFiles.access(session).then((result) => { if (result.ok) setAccess(result.value) }, () => undefined)
    // Mount-time restore only; later expansions load as they happen.
  }, [])

  /** Reload what shows and mark the rest stale; with `spin`, the refresh control spins until it settles. */
  const revalidate = useCallback(async (spin: boolean): Promise<void> => {
    const shown = shownFolders(memoryRef.current.expanded)
    for (const path of foldersRef.current.keys()) if (!shown.includes(path)) dirty.current.add(path)
    setFileVersion(version => version + 1)
    if (spin) setRefreshing(true)
    try {
      await reload(shown)
    } finally {
      if (spin) setRefreshing(false)
    }
  }, [reload, shownFolders])

  const refresh = useCallback(() => {
    if (refreshing) return
    setActionError(null)
    void revalidate(true)
  }, [refreshing, revalidate])

  // Changes elsewhere in the workspace (a shell command, an agent turn, another device) reach the tree through the
  // Host's change stream, gathered into one reload per visible folder per burst.
  useEffect(() => {
    const lifetime = new AbortController()
    const folderChanges = new Set<string>()
    let fileChanged = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const flush = (): void => {
      timer = undefined
      const shown = new Set(shownFolders(memoryRef.current.expanded))
      const visible: string[] = []
      for (const folder of folderChanges) {
        if (shown.has(folder)) visible.push(folder)
        else if (foldersRef.current.has(folder)) dirty.current.add(folder)
      }
      folderChanges.clear()
      if (fileChanged) setFileVersion(version => version + 1)
      fileChanged = false
      void reload(visible)
    }
    const take = (changes: readonly WorkspaceFileChange[]): void => {
      const open = memoryRef.current.openFile
      for (const change of changes) {
        folderChanges.add(folderOf(change.path))
        if (foldersRef.current.has(change.path)) folderChanges.add(change.path)
        if (change.path === open) fileChanged = true
      }
      if (changes.length > 0) timer ??= setTimeout(flush, CHANGE_DEBOUNCE_MS)
    }
    const pause = (delay: number): Promise<void> => new Promise((resolve) => {
      const wait = setTimeout(resolve, delay)
      lifetime.signal.addEventListener('abort', () => { clearTimeout(wait); resolve() }, { once: true })
    })
    const stopped = (): boolean => lifetime.signal.aborted
    void (async () => {
      for (let attempt = 0; !stopped(); attempt += 1) {
        try {
          for await (const batch of remote.workspaceFiles.changes(session, lifetime.signal)) {
            setWatching(true)
            attempt = 0
            take(batch.changes)
          }
        } catch (error: unknown) {
          if (stopped()) return
          if (codeOf(error) === 'workspace-file/unsupported') {
            setWatching(false)
            return
          }
        }
        setWatching(false)
        await pause(Math.min(1000 * 2 ** attempt, MAX_REOPEN_MS))
      }
    })()
    return () => {
      lifetime.abort()
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [remote, session, reload, shownFolders])

  // Without a change stream, the tree and the open file revalidate whenever the window comes back.
  useEffect(() => {
    if (watching) return undefined
    const onFocus = (): void => { void revalidate(false) }
    const onVisible = (): void => { if (document.visibilityState === 'visible') void revalidate(false) }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [watching, revalidate])

  const toggle = useCallback((path: string) => {
    const opening = !memoryRef.current.expanded.has(path)
    update((current) => {
      const expanded = new Set(current.expanded)
      if (expanded.has(path)) expanded.delete(path)
      else expanded.add(path)
      return { ...current, expanded }
    })
    if (opening && (foldersRef.current.get(path)?.status !== 'ready' || dirty.current.has(path))) void reload([path])
  }, [reload, update])

  const openFile = useCallback((path: string) => {
    const before = memoryRef.current
    update(current => visit(current, path))
    setFocus(path)
    // The viewer opens at once; a file it cannot show then goes back to where it was and opens elsewhere.
    void canPreviewFile(remote, session, path).then((previewable) => {
      if (previewable) return
      update(current => current.openFile !== path ? current : {
        ...current, openFile: before.openFile, history: before.history, historyIndex: before.historyIndex,
      })
      // A Host without a desktop, such as hosted Web, hands the file to the reader's browser instead.
      if (canOpenNative && root !== null) void openOnDesktop(remote, absolutePath(root, path), { kind: 'default' })
      else downloadWorkspaceFile(sessionId, absolutePath(root, path))
    })
  }, [canOpenNative, remote, root, session, sessionId, update])

  useEffect(() => {
    if (requestedFile !== undefined) openFile(requestedFile.path)
  }, [requestedFile, openFile])

  /** Show a path in the tree: open its folders and focus its row. */
  const reveal = useCallback((path: string, type: EntryType) => {
    const opened = type === 'directory' ? [...ancestorsOf(path), path] : ancestorsOf(path)
    update(current => ({ ...current, query: '', expanded: new Set([...current.expanded, ...opened]) }))
    void reload(opened.filter(folder => foldersRef.current.get(folder)?.status !== 'ready' || dirty.current.has(folder)))
    setFocus(path)
  }, [reload, update])

  useEffect(() => {
    if (requestedFolder !== undefined) reveal(requestedFolder.path, 'directory')
  }, [requestedFolder, reveal])
  useEffect(() => registerReveal?.((path) => {
    // Revealing a folder shows the tree, so an open file preview gives way to it.
    update(current => ({ ...current, openFile: null }))
    reveal(path, 'directory')
  }), [registerReveal, reveal, update])

  // The pill names the open file and keeps the Files glyph.
  useEffect(() => {
    if (memory.openFile === null) setTab(undefined)
    else setTab({ title: basename(memory.openFile) })
  }, [memory.openFile, setTab])
  useEffect(() => () => { setTab(undefined) }, [setTab])

  const rows = useMemo(
    () => visibleRows(folders, memory.expanded, memory.showIgnored, editing, t),
    [folders, memory.expanded, memory.showIgnored, editing, t],
  )

  const search = useSearch(remote, sessionId, memory.query)
  const searching = memory.query.trim() !== ''

  const writable = access?.writable === true
  const writeNote = access === null || access.writable ? undefined
    : access.reason === 'read-only' ? t('write.readOnly') : t('write.unsupported')

  const onRowMenu = (event: ReactMouseEvent, path: string, type: EntryType) => {
    event.preventDefault()
    event.stopPropagation()
    setFocus(path)
    setRowMenu({ target: { path, type }, x: event.clientX, y: event.clientY })
  }
  const onTreeMenu = (event: ReactMouseEvent) => {
    event.preventDefault()
    setRowMenu({ target: null, x: event.clientX, y: event.clientY })
  }
  const absolute = (path: string) => absolutePath(root, path)
  const menuTarget = rowMenu?.target ?? null
  const menuApplications = useApplications(
    remote, menuTarget?.type === 'file' && root !== null ? absolute(menuTarget.path) : null, canOpenNative,
  )
  const writeItem = (id: string, label: string): MenuEntry => ({
    id, label, disabled: !writable, ...writeNote === undefined ? {} : { description: writeNote },
  })
  const rowMenuItems: MenuEntry[] = rowMenu === null ? [] : menuTarget === null
    ? [
      writeItem('new-file', t('menu.newFile')),
      writeItem('new-folder', t('menu.newFolder')),
      { type: 'separator', id: 'view-separator' },
      {
        id: 'show-ignored', label: t('menu.showIgnored'),
        ...memory.showIgnored ? { icon: <IconLucideCheck /> } : {},
      },
      { id: 'refresh', label: t('refresh'), disabled: refreshing },
    ]
    : [
      ...menuTarget.type === 'file' ? [{ id: 'open', label: t('menu.open') }] : [],
      ...canOpenNative && menuTarget.type === 'file'
        ? [{ id: 'open-with', label: t('menu.openWith'), disabled: root === null, submenu: applicationItems(menuApplications, t) }]
        : [],
      ...canOpenNative && menuTarget.type === 'directory' ? [{ id: 'reveal', label: revealLabel(t), disabled: root === null }] : [],
      ...menuTarget.type === 'file' ? [{ id: 'download', label: t('menu.download') }] : [],
      { type: 'separator', id: 'write-separator' },
      ...menuTarget.type === 'directory'
        ? [writeItem('new-file', t('menu.newFile')), writeItem('new-folder', t('menu.newFolder'))]
        : [],
      writeItem('rename', t('menu.rename')),
      ...menuTarget.type === 'file' ? [writeItem('duplicate', t('menu.duplicate'))] : [],
      { ...writeItem('delete', t('menu.delete')), danger: true },
      { type: 'separator', id: 'copy-separator' },
      { id: 'copy', label: t('menu.copyPath'), disabled: root === null },
      { id: 'copy-relative', label: t('menu.copyRelativePath') },
    ]

  /** Start typing a new entry's name in `folder`, opening the folder first. */
  const startCreate = useCallback((folder: string, type: 'file' | 'directory') => {
    if (!writable) return
    setActionError(null)
    if (folder !== '') reveal(folder, 'directory')
    update(current => ({ ...current, query: '' }))
    setEditing({ kind: 'create', folder, type })
  }, [reveal, update, writable])

  const startRename = useCallback((path: string, type: EntryType) => {
    if (!writable) return
    setActionError(null)
    setEditing({ kind: 'rename', path, type })
  }, [writable])

  const startDelete = useCallback((path: string, type: EntryType) => {
    if (!writable) return
    setActionError(null)
    setPendingDelete({ path, type, count: type === 'directory' ? null : { items: 0, capped: false } })
    if (type !== 'directory') return
    void remote.workspaceFiles.count(session, path).then((result) => {
      setPendingDelete(current => current?.path !== path ? current : {
        ...current, count: result.ok ? result.value : { items: 0, capped: true },
      })
    }, () => undefined)
  }, [remote, session, writable])

  /** The folder a new entry goes into for the focused row: the folder itself, or a file's folder. */
  const createFolderFor = (path: string | null, type: EntryType | undefined): string =>
    path === null ? '' : type === 'directory' ? path : folderOf(path)

  /** Submit a typed name; resolves to the reason it was refused, so the input keeps the text. */
  const commitName = useCallback(async (name: string): Promise<string | undefined> => {
    const current = editing
    if (current === null) return undefined
    if (current.kind === 'rename' && name === basename(current.path)) {
      setEditing(null)
      return undefined
    }
    const problem = nameProblem(name)
    if (problem !== undefined) return t(problem)
    if (current.kind === 'create') {
      const result = current.type === 'file'
        ? await remote.workspaceFiles.createFile(session, current.folder, name)
        : await remote.workspaceFiles.createFolder(session, current.folder, name)
      if (!result.ok) return failureLine(t, result.error.code, result.error.message)
      setEditing(null)
      await reload([current.folder])
      setFocus(result.value.path)
      if (current.type === 'file') openFile(result.value.path)
      return undefined
    }
    const result = await remote.workspaceFiles.rename(session, current.path, name)
    if (!result.ok) return failureLine(t, result.error.code, result.error.message)
    setEditing(null)
    const to = result.value.path
    // The renamed entry stays open, expanded and focused under its new name.
    update(state => renamed(state, current.path, to))
    setFolders((state) => {
      const next = new Map<string, Folder>()
      for (const [path, folder] of state) {
        const moved = path === current.path ? to : path.startsWith(`${current.path}/`) ? to + path.slice(current.path.length) : path
        next.set(moved, folder)
      }
      return next
    })
    setFocus(to)
    await reload([folderOf(current.path)])
    return undefined
  }, [editing, openFile, reload, remote, session, t, update])

  const confirmDelete = useCallback(async () => {
    const target = pendingDelete
    if (target === null) return
    setPendingDelete(null)
    const result = await remote.workspaceFiles.deleteEntry(session, target.path)
    if (!result.ok) {
      setActionError(failureLine(t, result.error.code, result.error.message))
      return
    }
    update(state => forgotten(state, target.path))
    if (focus === target.path) setFocus(null)
    await reload([folderOf(target.path)])
  }, [focus, pendingDelete, reload, remote, session, t, update])

  const duplicate = useCallback(async (path: string) => {
    setActionError(null)
    const result = await remote.workspaceFiles.duplicate(session, path)
    if (!result.ok) {
      setActionError(failureLine(t, result.error.code, result.error.message))
      return
    }
    await reload([folderOf(path)])
    setFocus(result.value.path)
  }, [reload, remote, session, t])

  const onRowMenuSelect = (id: string) => {
    const menu = rowMenu
    setRowMenu(null)
    if (menu === null) return
    const target = menu.target
    if (id === 'new-file' || id === 'new-folder') {
      startCreate(createFolderFor(target?.path ?? null, target?.type), id === 'new-file' ? 'file' : 'directory')
      return
    }
    if (id === 'show-ignored') { update(current => ({ ...current, showIgnored: !current.showIgnored })); return }
    if (id === 'refresh') { refresh(); return }
    if (target === null) return
    const operation = operationOf(id)
    if (operation !== null) void openOnDesktop(remote, absolute(target.path), operation)
    else if (id === 'open') openFile(target.path)
    else if (id === 'download') downloadWorkspaceFile(sessionId, absolute(target.path))
    else if (id === 'rename') startRename(target.path, target.type)
    else if (id === 'duplicate') void duplicate(target.path)
    else if (id === 'delete') startDelete(target.path, target.type)
    else if (id === 'copy') void writeClipboard(absolute(target.path))
    else if (id === 'copy-relative') void writeClipboard(target.path)
  }

  const activate = (path: string, type: EntryType) => {
    if (type === 'directory') toggle(path)
    else if (type === 'file') openFile(path)
  }

  const rowsRef = useRef<HTMLDivElement | null>(null)
  const entries = useMemo(
    () => searching
      ? search.hits.map(hit => ({ path: hit.path, type: hit.type as EntryType }))
      : rows.flatMap(row => row.kind === 'entry' ? [{ path: row.path, type: row.type }] : []),
    [rows, search.hits, searching],
  )
  // Roving focus: exactly one row is in the tab order, the focused one or else the first.
  const tabStop = entries.some(entry => entry.path === focus) ? focus : entries[0]?.path ?? null
  const keyboardFocus = useRef(false)

  /** Move focus to a row by keyboard: scroll it into the window, then move the DOM focus once it renders. */
  const focusRow = (path: string) => {
    keyboardFocus.current = true
    setFocus(path)
    const list = rowsRef.current
    if (list === null || searching) return
    const index = rows.findIndex(row => row.kind === 'entry' && row.path === path)
    if (index >= 0) scrollRowIntoView(list, rowOffsets(rows), index)
  }
  useLayoutEffect(() => {
    if (!keyboardFocus.current || focus === null) return
    keyboardFocus.current = false
    const element = rowsRef.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(focus)}"]`)
    element?.focus({ preventScroll: !searching })
    if (searching) element?.scrollIntoView({ block: 'nearest' })
  })

  const onTreeKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (fromTextField(event)) return
    const index = entries.findIndex(entry => entry.path === focus)
    const current = entries[index]
    const command = event.metaKey || event.ctrlKey
    if (command && (event.key === 'n' || event.key === 'N')) {
      event.preventDefault()
      startCreate(createFolderFor(current?.path ?? null, current?.type), event.shiftKey ? 'directory' : 'file')
      return
    }
    if (entries.length === 0) return
    const move = (to: number) => {
      const next = entries[Math.max(0, Math.min(entries.length - 1, to))]
      if (next !== undefined) focusRow(next.path)
    }
    switch (event.key) {
      case 'ArrowDown': event.preventDefault(); move(index + 1); break
      case 'ArrowUp': event.preventDefault(); move(index < 0 ? 0 : index - 1); break
      case 'Home': event.preventDefault(); move(0); break
      case 'End': event.preventDefault(); move(entries.length - 1); break
      case 'ArrowRight':
        if (current?.type === 'directory' && !memory.expanded.has(current.path)) { event.preventDefault(); toggle(current.path) }
        break
      case 'ArrowLeft':
        if (current === undefined) break
        event.preventDefault()
        if (current.type === 'directory' && memory.expanded.has(current.path)) toggle(current.path)
        else {
          const parent = ancestorsOf(current.path).at(-1)
          if (parent !== undefined) move(entries.findIndex(entry => entry.path === parent))
        }
        break
      case 'Enter':
        if (current === undefined) break
        event.preventDefault()
        if (searching && current.type === 'directory') reveal(current.path, 'directory')
        else activate(current.path, current.type)
        break
      case 'F2':
        if (current === undefined) break
        event.preventDefault()
        startRename(current.path, current.type)
        break
      case 'Delete':
      case 'Backspace':
        if (current === undefined || (event.key === 'Backspace' && !command)) break
        event.preventDefault()
        startDelete(current.path, current.type)
        break
      default:
        break
    }
  }

  const [listWindow, setListWindow] = useState({ top: 0, height: 800 })
  useLayoutEffect(() => {
    const list = rowsRef.current
    if (list === null) return undefined
    const measure = () => { setListWindow({ top: list.scrollTop, height: list.clientHeight }) }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(list)
    return () => { observer.disconnect() }
  }, [memory.openFile === null, memory.treeVisible])
  const onListScroll = (event: ReactUIEvent<HTMLDivElement>) => {
    const list = event.currentTarget
    setListWindow({ top: list.scrollTop, height: list.clientHeight })
  }

  const renderEntry = (row: Extract<Row, { kind: 'entry' }>): ReactNode => {
    const expanded = memory.expanded.has(row.path)
    const renaming = editing?.kind === 'rename' && editing.path === row.path
    return (
      <div
        key={row.path}
        role="treeitem"
        aria-level={row.depth + 1}
        aria-setsize={row.siblings}
        aria-posinset={row.position}
        aria-expanded={row.type === 'directory' ? expanded : undefined}
        aria-selected={row.path === memory.openFile}
        tabIndex={row.path === tabStop ? 0 : -1}
        data-path={row.path}
        className={css.row}
        data-focused={row.path === focus || undefined}
        data-selected={row.path === memory.openFile || undefined}
        data-kind={row.type}
        style={{ paddingLeft: rowIndent(row.depth) }}
        title={row.path}
        onClick={() => { if (!renaming) { setFocus(row.path); activate(row.path, row.type) } }}
        onContextMenu={(event) => { onRowMenu(event, row.path, row.type) }}
      >
        <span className={css.glyph} data-folder={row.type === 'directory' || undefined}>
          {row.type === 'directory' ? expanded ? <IconLucideFolderOpen /> : <IconLucideFolder /> : fileGlyph(row.name)}
        </span>
        {renaming
          ? <NameInput initial={row.name} label={row.type === 'directory' ? t('name.folder') : t('name.file')}
            onCommit={commitName} onCancel={() => { setEditing(null) }} />
          : <span className={css.name}>{row.name}</span>}
      </div>
    )
  }

  const renderRow = (row: Row): ReactNode => {
    switch (row.kind) {
      case 'note':
        return (
          <div key={row.key} className={clsx(css.note, row.error === true && css.noteError)} style={{ paddingLeft: noteIndent(row.depth) }}>
            {row.text}
          </div>
        )
      case 'draft':
        return (
          <div key={row.key} className={css.row} data-draft="" style={{ paddingLeft: rowIndent(row.depth) }}>
            <span className={css.glyph} data-folder={row.type === 'directory' || undefined}>
              {row.type === 'directory' ? <IconLucideFolder /> : fileGlyph('')}
            </span>
            <NameInput initial="" label={row.type === 'directory' ? t('name.folder') : t('name.file')}
              onCommit={commitName} onCancel={() => { setEditing(null) }} />
          </div>
        )
      case 'entry':
        return renderEntry(row)
      default: {
        const unknown: never = row
        throw new Error(`unknown row ${String(unknown)}`)
      }
    }
  }

  const offsets = useMemo(() => rowOffsets(rows), [rows])
  const windowed = windowOf(offsets, listWindow.top - LIST_TOP - OVERSCAN, listWindow.top + listWindow.height + OVERSCAN)

  const tree = (
    <div className={css.tree}>
      <div className={css.toolbar}>
        <label className={css.search}>
          <span className={css.searchGlyph}><IconLucideSearch /></span>
          <input
            className={css.searchInput}
            type="search"
            value={memory.query}
            placeholder={t('search.placeholder')}
            aria-label={t('search.placeholder')}
            spellCheck={false}
            onChange={(event) => { const query = event.target.value; update(current => ({ ...current, query })) }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') { update(current => ({ ...current, query: '' })); event.currentTarget.blur() }
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                const first = search.hits[0]
                if (first !== undefined) focusRow(first.path)
              }
            }}
          />
          {memory.query !== '' && (
            <button type="button" className={css.iconButton} aria-label={t('search.clear')} onClick={() => { update(current => ({ ...current, query: '' })) }}>
              <IconLucideX />
            </button>
          )}
        </label>
        <button
          type="button"
          className={clsx(css.iconButton, css.lightButton)}
          aria-label={refreshing ? t('refreshing') : t('refresh')}
          title={refreshing ? t('refreshing') : t('refresh')}
          aria-busy={refreshing || undefined}
          disabled={refreshing}
          onClick={refresh}
        >
          {refreshing ? <Spinner className={css.spinner} /> : <IconLucideRefreshCw />}
        </button>
        <button
          type="button"
          className={clsx(css.iconButton, css.disc)}
          aria-label={t('collapseAll')}
          title={t('collapseAll')}
          disabled={memory.expanded.size === 0}
          onClick={() => { update(current => ({ ...current, expanded: new Set() })) }}
        >
          <IconLucideChevronsDownUp />
        </button>
      </div>
      {actionError !== null && <div className={clsx(css.note, css.noteError, css.actionError)} role="alert">{actionError}</div>}
      <div className={css.scrollFrame}>
        <div
          ref={rowsRef}
          className={css.rows}
          role="tree"
          aria-label={t('tree.label')}
          tabIndex={entries.length === 0 ? 0 : -1}
          onKeyDown={onTreeKey}
          onScroll={onListScroll}
          onContextMenu={onTreeMenu}
        >
          {searching
            ? <SearchRows search={search} focus={focus} tabStop={tabStop} openFile={memory.openFile} t={t} onOpen={(hit) => {
              if (hit.type === 'directory') reveal(hit.path, 'directory')
              else { openFile(hit.path); reveal(hit.path, 'file') }
            }} onFocus={setFocus} onMenu={onRowMenu} />
            : (
              <>
                {windowed.start > 0 && <div aria-hidden style={{ height: offsets[windowed.start] }} />}
                {rows.slice(windowed.start, windowed.end).map(renderRow)}
                {windowed.end < rows.length && (
                  <div aria-hidden style={{ height: (offsets[rows.length] ?? 0) - (offsets[windowed.end] ?? 0) }} />
                )}
              </>
            )}
        </div>
      </div>
    </div>
  )

  const canBack = memory.historyIndex > 0
  const canForward = memory.historyIndex >= 0 && memory.historyIndex < memory.history.length - 1

  return (
    <div className={css.root} data-sidebar-right-files="">
      {memory.openFile === null
        ? tree
        : (
          <div className={css.split}>
            <FileView
              key={memory.openFile}
              path={memory.openFile}
              version={fileVersion}
              copy={copyOf?.(memory.openFile)}
              root={root}
              canOpenNative={canOpenNative}
              treeVisible={memory.treeVisible}
              htmlView={memory.htmlView}
              remote={remote}
              sessionId={sessionId}
              t={t}
              onReveal={(path) => { reveal(path, 'directory') }}
              onToggleTree={() => { update(current => ({ ...current, treeVisible: !current.treeVisible })) }}
              onHtmlView={(htmlView) => { update(current => ({ ...current, htmlView })) }}
              onRefresh={() => { setFileVersion(version => version + 1) }}
              onBack={canBack ? () => { update(current => stepHistory(current, -1)) } : undefined}
              onForward={canForward ? () => { update(current => stepHistory(current, 1)) } : undefined}
              onClose={() => { update(current => ({ ...current, openFile: null })) }}
            />
            {memory.treeVisible && <div className={css.dock}>{tree}</div>}
          </div>
        )}
      {rowMenu !== null && (
        <Menu
          open
          onClose={() => { setRowMenu(null) }}
          items={rowMenuItems}
          onSelect={onRowMenuSelect}
          portal
          getAnchorRect={() => new DOMRect(rowMenu.x, rowMenu.y, 0, 0)}
          anchor={<span />}
        />
      )}
      {pendingDelete !== null && (
        <DeleteDialog
          target={pendingDelete}
          trash={access?.trash === true}
          t={t}
          onCancel={() => { setPendingDelete(null) }}
          onConfirm={() => { void confirmDelete() }}
        />
      )}
    </div>
  )
}

/** Left padding of an entry row at `depth`: the row's fill reaches 8px left of its glyph's column. */
function rowIndent(depth: number): string {
  return `${String(depth * 16 + 8)}px`
}

/** Left padding of a note at `depth`, on its row's glyph column. */
function noteIndent(depth: number): string {
  return `${String(depth * 16)}px`
}

/** Each row's top within the list, and the list's total height as the last element. */
function rowOffsets(rows: readonly Row[]): number[] {
  const offsets = [0]
  let top = 0
  for (const row of rows) {
    top += row.kind === 'note' ? NOTE_HEIGHT : ENTRY_HEIGHT
    offsets.push(top)
  }
  return offsets
}

/** The rows overlapping `[from, to)`, as a slice of the list. */
function windowOf(offsets: readonly number[], from: number, to: number): { start: number; end: number } {
  const count = offsets.length - 1
  const first = (target: number): number => {
    let low = 0
    let high = count
    while (low < high) {
      const middle = (low + high) >> 1
      if ((offsets[middle + 1] ?? 0) <= target) low = middle + 1
      else high = middle
    }
    return low
  }
  const start = first(from)
  let end = first(to) + 1
  if (end > count) end = count
  return { start, end: Math.max(start, end) }
}

/** Scroll the list so row `index` shows clear of both fades. */
function scrollRowIntoView(list: HTMLElement, offsets: readonly number[], index: number): void {
  const top = LIST_TOP + (offsets[index] ?? 0)
  const bottom = LIST_TOP + (offsets[index + 1] ?? 0)
  if (top < list.scrollTop + LIST_TOP) list.scrollTop = top - LIST_TOP
  else if (bottom > list.scrollTop + list.clientHeight - 40) list.scrollTop = bottom - list.clientHeight + 40
}

/** Flatten the loaded folders into the rows the tree shows, a new entry's name field first in its folder. */
function visibleRows(
  folders: ReadonlyMap<string, Folder>,
  expanded: ReadonlySet<string>,
  showIgnored: boolean,
  editing: Editing | null,
  t: TranslateNS<'sidebarFiles'>,
): Row[] {
  const rows: Row[] = []
  const walk = (path: string, depth: number) => {
    const folder = folders.get(path)
    if (folder === undefined || folder.status === 'loading') {
      rows.push({ kind: 'note', key: `${path}\u0000loading`, text: t('loading'), depth })
      return
    }
    if (folder.status === 'error') {
      rows.push({ kind: 'note', key: `${path}\u0000error`, text: folder.message, depth, error: true })
      return
    }
    if (folder.failure !== undefined) rows.push({ kind: 'note', key: `${path}\u0000failure`, text: folder.failure, depth, error: true })
    if (editing?.kind === 'create' && editing.folder === path) {
      rows.push({ kind: 'draft', key: `${path}\u0000draft`, folder: path, type: editing.type, depth })
    }
    const shown = showIgnored ? folder.entries : folder.entries.filter(entry => !entry.ignored)
    if (shown.length === 0 && editing?.kind !== 'create') rows.push({ kind: 'note', key: `${path}\u0000empty`, text: t('tree.empty'), depth })
    shown.forEach((entry, index) => {
      const child = join(path, entry.name)
      rows.push({ kind: 'entry', path: child, name: entry.name, type: entry.type, depth, position: index + 1, siblings: shown.length })
      if (entry.type === 'directory' && expanded.has(child)) walk(child, depth + 1)
    })
    if (folder.truncated) rows.push({ kind: 'note', key: `${path}\u0000truncated`, text: t('tree.truncated'), depth })
  }
  walk('', 0)
  return rows
}

/**
 * The name field of a new or renamed entry. Enter submits, Escape cancels, and leaving the field submits a changed
 * name; a refused name stays in the field with the reason under it.
 */
function NameInput({ initial, label, onCommit, onCancel }: {
  initial: string
  label: string
  onCommit: (name: string) => Promise<string | undefined>
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLInputElement | null>(null)
  useLayoutEffect(() => {
    const input = ref.current
    if (input === null) return
    input.focus()
    // A rename selects the name without its extension, so typing replaces only the stem.
    const dot = initial.lastIndexOf('.')
    input.setSelectionRange(0, dot > 0 ? dot : initial.length)
  }, [initial])
  const submit = async () => {
    if (busy) return
    setBusy(true)
    const reason = await onCommit(value)
    setBusy(false)
    setProblem(reason)
    if (reason !== undefined) ref.current?.focus()
  }
  return (
    <span className={css.nameField}>
      <input
        ref={ref}
        className={css.nameInput}
        value={value}
        aria-label={label}
        aria-invalid={problem !== undefined || undefined}
        spellCheck={false}
        disabled={busy}
        onChange={(event) => { setValue(event.target.value); setProblem(undefined) }}
        onClick={(event) => { event.stopPropagation() }}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Enter') { event.preventDefault(); void submit() }
          if (event.key === 'Escape') { event.preventDefault(); onCancel() }
        }}
        onBlur={() => {
          if (busy || problem !== undefined) return
          if (value === initial || value.trim() === '') onCancel()
          else void submit()
        }}
      />
      {problem !== undefined && <span className={css.nameProblem} role="alert">{problem}</span>}
    </span>
  )
}

/** The confirmation of a delete, naming whether it goes to the trash and what it takes along. */
function DeleteDialog({ target, trash, t, onCancel, onConfirm }: {
  target: PendingDelete
  trash: boolean
  t: TranslateNS<'sidebarFiles'>
  onCancel: () => void
  onConfirm: () => void
}) {
  const name = basename(target.path)
  const count = target.count
  const items = count === null ? '' : `${count.items.toLocaleString()}${count.capped ? '+' : ''}`
  const folder = target.type === 'directory' && count !== null && count.items > 0
  const body = count === null
    ? t('delete.counting')
    : trash
      ? folder ? t('delete.trashFolder', { name, count: items }) : t('delete.trashFile', { name })
      : folder ? t('delete.permanentFolder', { name, count: items }) : t('delete.permanentFile', { name })
  return (
    <Modal
      open
      onClose={onCancel}
      closeLabel={t('delete.close')}
      title={t('delete.title', { name })}
      description={body}
      footer={(
        <>
          <Button variant="outline" onClick={onCancel}>{t('delete.cancel')}</Button>
          <Button variant="primary" disabled={count === null} onClick={onConfirm}>
            {trash ? t('delete.confirmTrash') : t('delete.confirm')}
          </Button>
        </>
      )}
    />
  )
}

/** A debounced name search over the workspace. */
function useSearch(remote: ClientRemote, sessionId: string, query: string) {
  const [state, setState] = useState<{ query: string; hits: readonly WorkspaceSearchHit[]; truncated: boolean; pending: boolean }>(
    { query: '', hits: [], truncated: false, pending: false },
  )
  useEffect(() => {
    const needle = query.trim()
    if (needle === '') {
      setState({ query: '', hits: [], truncated: false, pending: false })
      return undefined
    }
    setState(current => ({ ...current, pending: true }))
    const controller = new AbortController()
    const timer = setTimeout(() => {
      void remote.workspaceFiles.search(sessionId as SessionId, needle, controller.signal).then((result) => {
        if (controller.signal.aborted) return
        setState(result.ok
          ? { query: needle, hits: result.value.hits, truncated: result.value.truncated, pending: false }
          : { query: needle, hits: [], truncated: false, pending: false })
      }, () => undefined)
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, remote, sessionId])
  return state
}

/** Search results: one row per hit, its folder dimmed after its name and shortened from the middle. */
function SearchRows({ search, focus, tabStop, openFile, t, onOpen, onFocus, onMenu }: {
  search: ReturnType<typeof useSearch>
  focus: string | null
  tabStop: string | null
  openFile: string | null
  t: TranslateNS<'sidebarFiles'>
  onOpen: (hit: WorkspaceSearchHit) => void
  onFocus: (path: string) => void
  onMenu: (event: ReactMouseEvent, path: string, type: EntryType) => void
}) {
  if (search.pending && search.hits.length === 0) return <div className={css.note}>{t('loading')}</div>
  if (search.hits.length === 0) return <div className={css.note}>{t('search.empty')}</div>
  return (
    <>
      {search.hits.map((hit, index) => {
        const name = basename(hit.path)
        const parent = hit.path.slice(0, Math.max(0, hit.path.length - name.length - 1))
        return (
          <div
            key={hit.path}
            role="treeitem"
            aria-level={1}
            aria-setsize={search.hits.length}
            aria-posinset={index + 1}
            aria-selected={hit.path === openFile}
            tabIndex={hit.path === tabStop ? 0 : -1}
            data-path={hit.path}
            className={css.row}
            data-focused={hit.path === focus || undefined}
            data-selected={hit.path === openFile || undefined}
            data-kind={hit.type}
            style={{ paddingLeft: rowIndent(0) }}
            title={hit.path}
            onClick={() => { onFocus(hit.path); onOpen(hit) }}
            onContextMenu={(event) => { onMenu(event, hit.path, hit.type) }}
          >
            <span className={css.glyph} data-folder={hit.type === 'directory' || undefined}>
              {hit.type === 'directory' ? <IconLucideFolder /> : fileGlyph(name)}
            </span>
            <span className={css.name}>{name}</span>
            {parent !== '' && <span className={css.parent}>{middleTruncate(parent, PARENT_MAX)}</span>}
          </div>
        )
      })}
      {search.truncated && <div className={css.note}>{t('search.more')}</div>}
    </>
  )
}

/** The open file: its history steps, breadcrumbs and actions in one bar, and its content by kind. */
function FileView({
  path, version, copy, root, canOpenNative, treeVisible, htmlView, remote, sessionId, t,
  onReveal, onToggleTree, onHtmlView, onRefresh, onBack, onForward, onClose,
}: {
  path: string
  /** Bumped whenever the file may have changed, which reloads it in place. */
  version: number
  /** A stored copy the media kinds play from instead of the workspace path. */
  copy: string | undefined
  root: string | null
  canOpenNative: boolean
  treeVisible: boolean
  htmlView: 'preview' | 'source'
  remote: ClientRemote
  sessionId: string
  t: TranslateNS<'sidebarFiles'>
  onReveal: (path: string) => void
  onToggleTree: () => void
  onHtmlView: (view: 'preview' | 'source') => void
  onRefresh: () => void
  onBack: (() => void) | undefined
  onForward: (() => void) | undefined
  onClose: () => void
}) {
  const name = basename(path)
  const kind = fileKindOf(name)
  const extension = extensionOf(name)
  // Images, video, and audio play from the file's bytes; every other kind previews its text.
  const media = kind === 'image' || kind === 'video' || kind === 'audio'
  const isCode = !media && kind !== 'markdown'
  const isHtml = extension === 'html' || extension === 'htm'
  const showPreview = isHtml && htmlView === 'preview'
  const [content, setContent] = useState<{ status: 'loading' } | { status: 'ready'; file: WorkspaceFileText } | { status: 'error'; message: string }>(
    { status: 'loading' },
  )
  // A reload keeps the text on screen until the new one arrives, so the reader keeps their place.
  useEffect(() => {
    if (media) return undefined
    const controller = new AbortController()
    void remote.workspaceFiles.read(sessionId as SessionId, path, controller.signal).then((result) => {
      if (controller.signal.aborted) return
      setContent(result.ok
        ? { status: 'ready', file: result.value }
        : { status: 'error', message: failureLine(t, result.error.code, result.error.message) })
    }, (error: unknown) => {
      if (!controller.signal.aborted) setContent({ status: 'error', message: t('error.unavailable', { message: String(error) }) })
    })
    return () => { controller.abort() }
  }, [media, path, remote, sessionId, t, version])

  const [page, setPage] = useState<string | null>(null)
  useEffect(() => {
    if (!showPreview || content.status !== 'ready') return undefined
    const controller = new AbortController()
    const read = async (asset: string, signal: AbortSignal): Promise<Blob | undefined> => {
      const response = await fetch(workspaceFileUrl(sessionId, absolutePath(root, asset)), { signal, credentials: 'same-origin' })
      return response.ok ? response.blob() : undefined
    }
    void previewDocument(content.file.text, path, read, controller.signal).then((built) => {
      if (!controller.signal.aborted) setPage(built)
    }, () => {
      if (!controller.signal.aborted) setPage(content.file.text)
    })
    return () => { controller.abort() }
  }, [content, path, root, sessionId, showPreview])

  const labels = useMemo<MarkdownLabels>(() => ({
    code: { copyLabel: t('code.copy'), copiedLabel: t('code.copied') },
    footnotes: t('markdown.footnotes'),
  }), [t])

  // Toggling to the page and back returns the source to where the reader left it.
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const sourceScroll = useRef(0)
  useLayoutEffect(() => {
    if (!showPreview && bodyRef.current !== null) bodyRef.current.scrollTop = sourceScroll.current
  }, [showPreview])

  const segments = path.split('/')
  const rootName = root === null ? '' : basename(root.replace(/\/+$/, ''))
  const absolute = absolutePath(root, path)
  const crumbsRef = useRef<HTMLElement | null>(null)
  const [crumbs, setCrumbs] = useState<HTMLElement | null>(null)
  const [fadeLeft, setFadeLeft] = useState(false)
  const [fadeRight, setFadeRight] = useState(false)
  const measureCrumbs = useCallback(() => {
    if (crumbs === null) return
    setFadeLeft(crumbs.scrollLeft > 1)
    setFadeRight(crumbs.scrollLeft + crumbs.clientWidth < crumbs.scrollWidth - 1)
  }, [crumbs])

  useEffect(() => {
    if (crumbs === null) return undefined
    const observer = new ResizeObserver(measureCrumbs)
    observer.observe(crumbs)
    crumbs.addEventListener('scroll', measureCrumbs, { passive: true })
    measureCrumbs()
    return () => {
      observer.disconnect()
      crumbs.removeEventListener('scroll', measureCrumbs)
    }
  }, [crumbs, measureCrumbs])

  // A path wider than the bar shows its own end, where the file's name is. The
  // column widens after it mounts and the typeface settles later still, so the
  // current segment is followed into view until the reader scrolls the path.
  useEffect(() => {
    const strip = crumbsRef.current
    if (strip === null) return undefined
    const reveal = () => { strip.lastElementChild?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }
    reveal()
    const observer = new ResizeObserver(reveal)
    observer.observe(strip)
    const release = () => { observer.disconnect() }
    strip.addEventListener('pointerdown', release)
    strip.addEventListener('wheel', release, { passive: true })
    return () => {
      observer.disconnect()
      strip.removeEventListener('pointerdown', release)
      strip.removeEventListener('wheel', release)
    }
  }, [path])

  const previewLabel = showPreview ? t('file.source') : t('file.preview')
  return (
    <div className={css.file}>
      <div className={css.fileBar}>
        {(onBack !== undefined || onForward !== undefined) && (
          <>
            <button type="button" className={clsx(css.iconButton, css.lightButton)} aria-label={t('file.back')} title={t('file.back')}
              disabled={onBack === undefined} onClick={onBack}>
              <IconLucideArrowLeft />
            </button>
            <button type="button" className={clsx(css.iconButton, css.lightButton)} aria-label={t('file.forward')} title={t('file.forward')}
              disabled={onForward === undefined} onClick={onForward}>
              <IconLucideArrowRight />
            </button>
          </>
        )}
        <nav
          className={clsx(css.crumbs, fadeLeft && css.fadeLeft, fadeRight && css.fadeRight)}
          ref={(node) => { crumbsRef.current = node; setCrumbs(node) }}
          aria-label={path}
        >
          {rootName !== '' && (
            <>
              <button type="button" className={css.crumb} onClick={() => { onReveal('') }}>{rootName}</button>
              <span className={css.crumbSep} aria-hidden>›</span>
            </>
          )}
          {segments.map((segment, index) => {
            const last = index === segments.length - 1
            const at = segments.slice(0, index + 1).join('/')
            return (
              <span key={at} className={css.crumbItem}>
                {last
                  ? <span className={css.crumbCurrent}>{segment}</span>
                  : <button type="button" className={css.crumb} onClick={() => { onReveal(at) }}>{segment}</button>}
                {!last && <span className={css.crumbSep} aria-hidden>›</span>}
              </span>
            )
          })}
        </nav>
        {isHtml && (
          <button
            type="button"
            className={clsx(css.iconButton, css.lightButton)}
            aria-pressed={showPreview}
            aria-label={previewLabel}
            title={previewLabel}
            onClick={() => {
              if (!showPreview) sourceScroll.current = bodyRef.current?.scrollTop ?? 0
              onHtmlView(showPreview ? 'source' : 'preview')
            }}
          >
            <IconLucideEye />
          </button>
        )}
        {isCode && content.status === 'ready' && (
          <span className={css.copy}>
            <CopyIconButton text={content.file.text} label={t('code.copy')} copiedLabel={t('code.copied')} />
          </span>
        )}
        {!treeVisible && !media && (
          <button type="button" className={clsx(css.iconButton, css.lightButton)} aria-label={t('file.refresh')} title={t('file.refresh')} onClick={onRefresh}>
            <IconLucideRefreshCw />
          </button>
        )}
        {canOpenNative && root !== null && <OpenWithButton path={absolute} remote={remote} t={t} />}
        <button
          type="button"
          className={clsx(css.iconButton, css.lightButton)}
          aria-label={t('file.download')}
          title={t('file.download')}
          disabled={root === null}
          onClick={() => { downloadWorkspaceFile(sessionId, absolute) }}
        >
          <IconLucideDownload />
        </button>
        <button
          type="button"
          className={clsx(css.iconButton, css.lightButton)}
          aria-pressed={treeVisible}
          aria-label={treeVisible ? t('tree.hide') : t('tree.show')}
          title={treeVisible ? t('tree.hide') : t('tree.show')}
          onClick={onToggleTree}
        >
          <IconLucideFolderSearch />
        </button>
        <button type="button" className={clsx(css.iconButton, css.disc)} aria-label={t('file.close')} title={t('file.close')} onClick={onClose}>
          <IconLucideX />
        </button>
      </div>
      {content.status === 'ready' && content.file.outsideWorkspace && <div className={clsx(css.note, css.fileNote)}>{t('file.outside')}</div>}
      {showPreview && (
        page === null
          ? <div className={clsx(css.note, css.fileNote)}>{content.status === 'error' ? content.message : t('file.rendering')}</div>
          : <iframe className={css.preview} sandbox="allow-scripts" srcDoc={page} title={name} />
      )}
      <div className={css.scrollFrame} hidden={showPreview}>
        <div ref={bodyRef} className={clsx(css.fileBody, kind === 'markdown' && css.fileBodyProse)}>
          {kind === 'image' && root !== null && <img className={css.image} src={copy ?? workspaceFileUrl(sessionId, absolute)} alt={name} />}
          {kind === 'video' && root !== null && (
            <div className={css.videoFrame}>
              <VideoPlayer src={copy ?? workspaceFileUrl(sessionId, absolute)} label={name} saveName={name} labels={videoPlayerLabels(t)} />
            </div>
          )}
          {kind === 'audio' && root !== null && (
            <audio className={css.audio} src={copy ?? workspaceFileUrl(sessionId, absolute)} controls preload="metadata" aria-label={name} />
          )}
          {!media && (content.status === 'loading'
            ? <div className={css.note}>{t('loading')}</div>
            : content.status === 'error'
              ? <div className={css.note}>{content.message}</div>
              : (
                <>
                  {kind === 'markdown'
                    ? <MarkdownText text={content.file.text} labels={labels} animation={false} />
                    : <CodeBlock code={content.file.text} lang={extension} bare copyLabel={t('code.copy')} copiedLabel={t('code.copied')} className={css.code} />}
                  {!content.file.eof && <div className={css.note}>{t('file.truncated')}</div>}
                </>
              ))}
        </div>
      </div>
    </div>
  )
}
