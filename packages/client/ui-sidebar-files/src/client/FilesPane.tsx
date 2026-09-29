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
 */
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import type { ClientRemote, SessionId } from '@aeven/api-remotes/client'
// Type-only: pulls the generated `workspaceFiles` namespace into ClientRemote.
import type {} from '@aeven/api-workspace-files/remote'
import type { WorkspaceDirectoryEntry, WorkspaceFileText, WorkspaceSearchHit } from '@aeven/api-workspace-files/types'
import {
  CodeBlock, CopyIconButton, IconLucideChevronsDownUp, IconLucideFolder, IconLucideFolderOpen, IconLucideFolderSearch,
  IconLucideRefreshCw, IconLucideSearch, IconLucideX, MarkdownText, Menu, writeClipboard,
  type MarkdownLabels, type MenuEntry,
} from '@aeven/client-ui-primitives'
import type { SidebarContentPaneProps } from '@aeven/client-ui-sidebar-select/client'
import type { TranslateNS } from '@aeven/client-ui-slots'
import { extensionOf, fileGlyph, fileKindOf } from './file-kind.tsx'
import { ancestorsOf, recall, remember, type ExplorerMemory } from './memory.ts'
import { applicationItems, openOnDesktop, operationOf, OpenWithButton, revealLabel, useApplications } from './open-with.tsx'
import css from './FilesPane.module.css'

/** What the plugin hands every Files pane beyond the column's props. */
export interface FilesPaneProps extends SidebarContentPaneProps {
  readonly t: TranslateNS<'sidebarFiles'>
  readonly remote: ClientRemote
}

/** One folder's listing as the tree holds it. */
type Folder =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly entries: readonly WorkspaceDirectoryEntry[]; readonly truncated: boolean }
  | { readonly status: 'error'; readonly message: string }

/** One visible line of the tree. */
type Row =
  | { readonly kind: 'entry'; readonly path: string; readonly name: string; readonly type: WorkspaceDirectoryEntry['type']; readonly depth: number }
  | { readonly kind: 'note'; readonly key: string; readonly text: string; readonly depth: number }

/** A row's right-click menu, anchored at the pointer. */
interface RowMenu {
  readonly path: string
  readonly type: WorkspaceDirectoryEntry['type']
  readonly x: number
  readonly y: number
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
  if (root === null) return path
  const base = root.replace(/\/+$/, '')
  return path === '' ? base : `${base}/${path}`
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/** The tree's search waits this long after the last keystroke. */
const SEARCH_DEBOUNCE_MS = 200

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
    default: return t('error.unavailable', { message })
  }
}

/**
 * Render one Files surface.
 * @param props - the column's pane props plus the plugin's copy and Remote.
 * @returns the explorer element tree.
 */
export function FilesPane({ sessionId, surfaceId, setTab, t, remote }: FilesPaneProps): ReactNode {
  const [memory, setMemory] = useState<ExplorerMemory>(() => recall(sessionId, surfaceId))
  const update = useCallback((next: (current: ExplorerMemory) => ExplorerMemory) => {
    setMemory((current) => {
      const value = next(current)
      remember(sessionId, surfaceId, value)
      return value
    })
  }, [sessionId, surfaceId])

  const [root, setRoot] = useState<string | null>(null)
  const [folders, setFolders] = useState<ReadonlyMap<string, Folder>>(new Map())
  const [focus, setFocus] = useState<string | null>(null)
  const [rowMenu, setRowMenu] = useState<RowMenu | null>(null)
  const [canOpenNative, setCanOpenNative] = useState(false)
  const loading = useRef(new Set<string>())

  const load = useCallback(async (path: string) => {
    if (loading.current.has(path)) return
    loading.current.add(path)
    setFolders(current => new Map(current).set(path, { status: 'loading' }))
    try {
      const result = await remote.workspaceFiles.list(sessionId as SessionId, path)
      const folder: Folder = result.ok
        ? { status: 'ready', entries: ordered(result.value.entries), truncated: result.value.truncated }
        : { status: 'error', message: failureLine(t, result.error.code, result.error.message) }
      if (result.ok) setRoot(result.value.root)
      setFolders(current => new Map(current).set(path, folder))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setFolders(current => new Map(current).set(path, { status: 'error', message: t('error.unavailable', { message }) }))
    } finally {
      loading.current.delete(path)
    }
  }, [remote, sessionId, t])

  // The root, and every folder the surface remembers open, load on mount.
  useEffect(() => {
    void load('')
    for (const path of memory.expanded) void load(path)
    void remote.session.canOpenWorkspacePath().then((result) => { setCanOpenNative(result.ok && result.value) }, () => undefined)
    // Mount-time restore only; later expansions load as they happen.
  }, [])

  const refresh = useCallback(() => {
    setFolders(new Map())
    void load('')
    for (const path of memory.expanded) void load(path)
  }, [load, memory.expanded])

  const toggle = useCallback((path: string) => {
    update((current) => {
      const expanded = new Set(current.expanded)
      if (expanded.has(path)) expanded.delete(path)
      else expanded.add(path)
      return { ...current, expanded }
    })
    if (!memory.expanded.has(path) && folders.get(path)?.status !== 'ready') void load(path)
  }, [folders, load, memory.expanded, update])

  const openFile = useCallback((path: string) => {
    update(current => ({ ...current, openFile: path }))
    setFocus(path)
  }, [update])

  /** Show a path in the tree: open its folders and focus its row. */
  const reveal = useCallback((path: string, type: WorkspaceDirectoryEntry['type']) => {
    const folders = type === 'directory' ? [...ancestorsOf(path), path] : ancestorsOf(path)
    update(current => ({ ...current, query: '', expanded: new Set([...current.expanded, ...folders]) }))
    for (const folder of folders) void load(folder)
    setFocus(path)
  }, [load, update])

  // The pill names the open file and keeps the Files glyph.
  useEffect(() => {
    if (memory.openFile === null) setTab(undefined)
    else setTab({ title: basename(memory.openFile) })
  }, [memory.openFile, setTab])
  useEffect(() => () => { setTab(undefined) }, [setTab])

  const rows = useMemo(() => visibleRows(folders, memory.expanded, t), [folders, memory.expanded, t])

  const search = useSearch(remote, sessionId, memory.query)

  const onRowMenu = (event: ReactMouseEvent, path: string, type: WorkspaceDirectoryEntry['type']) => {
    event.preventDefault()
    setFocus(path)
    setRowMenu({ path, type, x: event.clientX, y: event.clientY })
  }
  const absolute = (path: string) => absolutePath(root, path)
  const menuApplications = useApplications(
    remote, rowMenu?.type === 'file' ? absolute(rowMenu.path) : null, canOpenNative,
  )
  const rowMenuItems: MenuEntry[] = rowMenu === null ? [] : [
    ...rowMenu.type === 'file' ? [{ id: 'open', label: t('menu.open') }] : [],
    ...canOpenNative && rowMenu.type === 'file'
      ? [{ id: 'open-with', label: t('menu.openWith'), submenu: applicationItems(menuApplications, t) }]
      : [],
    ...canOpenNative && rowMenu.type === 'directory' ? [{ id: 'reveal', label: revealLabel(t) }] : [],
    { type: 'separator', id: 'copy-separator' },
    { id: 'copy', label: t('menu.copyPath') },
    { id: 'copy-relative', label: t('menu.copyRelativePath') },
  ]
  const onRowMenuSelect = (id: string) => {
    const target = rowMenu
    setRowMenu(null)
    if (target === null) return
    const operation = operationOf(id)
    if (operation !== null) void openOnDesktop(remote, absolute(target.path), operation)
    else if (id === 'open') openFile(target.path)
    else if (id === 'copy') void writeClipboard(absolute(target.path))
    else if (id === 'copy-relative') void writeClipboard(target.path)
  }

  const activate = (path: string, type: WorkspaceDirectoryEntry['type']) => {
    if (type === 'directory') toggle(path)
    else if (type === 'file') openFile(path)
  }

  const onTreeKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const entries = memory.query.trim() !== ''
      ? search.hits.map(hit => ({ path: hit.path, type: hit.type }))
      : rows.flatMap(row => row.kind === 'entry' ? [{ path: row.path, type: row.type }] : [])
    if (entries.length === 0) return
    const index = entries.findIndex(entry => entry.path === focus)
    const current = entries[index]
    const move = (to: number) => {
      const next = entries[Math.max(0, Math.min(entries.length - 1, to))]
      if (next === undefined) return
      setFocus(next.path)
      event.currentTarget.querySelector(`[data-path="${CSS.escape(next.path)}"]`)?.scrollIntoView({ block: 'nearest' })
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
        if (memory.query.trim() !== '' && current.type === 'directory') reveal(current.path, 'directory')
        else activate(current.path, current.type)
        break
      default:
        break
    }
  }

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
                if (first !== undefined) setFocus(first.path)
                ;(event.currentTarget.closest(`.${css.tree}`)?.querySelector(`.${css.rows}`) as HTMLElement | null)?.focus()
              }
            }}
          />
          {memory.query !== '' && (
            <button type="button" className={css.iconButton} aria-label={t('search.clear')} onClick={() => { update(current => ({ ...current, query: '' })) }}>
              <IconLucideX />
            </button>
          )}
        </label>
        <button type="button" className={clsx(css.iconButton, css.lightButton)} aria-label={t('refresh')} title={t('refresh')} onClick={refresh}>
          <IconLucideRefreshCw />
        </button>
        <button
          type="button"
          className={css.iconButton}
          aria-label={t('collapseAll')}
          title={t('collapseAll')}
          disabled={memory.expanded.size === 0}
          onClick={() => { update(current => ({ ...current, expanded: new Set() })) }}
        >
          <IconLucideChevronsDownUp />
        </button>
      </div>
      <div className={css.scrollFrame}>
        <div className={css.rows} role="tree" tabIndex={0} onKeyDown={onTreeKey}>
          {memory.query.trim() !== ''
            ? <SearchRows search={search} focus={focus} t={t} onOpen={(hit) => {
              if (hit.type === 'directory') reveal(hit.path, 'directory')
              else { openFile(hit.path); reveal(hit.path, 'file') }
            }} onMenu={onRowMenu} />
            : rows.map(row => row.kind === 'note'
              ? <div key={row.key} className={css.note} style={{ paddingLeft: indent(row.depth) }}>{row.text}</div>
              : (
                <div
                  key={row.path}
                  role="treeitem"
                  aria-expanded={row.type === 'directory' ? memory.expanded.has(row.path) : undefined}
                  aria-selected={row.path === memory.openFile}
                  data-path={row.path}
                  className={css.row}
                  data-focused={row.path === focus || undefined}
                  data-selected={row.path === memory.openFile || undefined}
                  data-kind={row.type}
                  style={{ paddingLeft: indent(row.depth) }}
                  title={row.path}
                  onClick={() => { setFocus(row.path); activate(row.path, row.type) }}
                  onContextMenu={(event) => { onRowMenu(event, row.path, row.type) }}
                >
                  <span className={css.glyph} data-folder={row.type === 'directory' || undefined}>
                    {row.type === 'directory'
                      ? memory.expanded.has(row.path) ? <IconLucideFolderOpen /> : <IconLucideFolder />
                      : fileGlyph(row.name)}
                  </span>
                  <span className={css.name}>{row.name}</span>
                </div>
              ))}
        </div>
      </div>
    </div>
  )

  return (
    <div className={css.root} data-sidebar-right-files="">
      {memory.openFile === null
        ? tree
        : (
          <div className={css.split}>
            <FileView
              key={memory.openFile}
              path={memory.openFile}
              root={root}
              canOpenNative={canOpenNative}
              treeVisible={memory.treeVisible}
              remote={remote}
              sessionId={sessionId}
              t={t}
              onReveal={(path) => { reveal(path, 'directory') }}
              onToggleTree={() => { update(current => ({ ...current, treeVisible: !current.treeVisible })) }}
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
    </div>
  )
}

/** Left padding of a row at `depth`. Depth 0 starts on the toolbar's left edge. */
function indent(depth: number): string {
  return `${String(depth * 16)}px`
}

/** Flatten the loaded folders into the rows the tree shows. */
function visibleRows(folders: ReadonlyMap<string, Folder>, expanded: ReadonlySet<string>, t: TranslateNS<'sidebarFiles'>): Row[] {
  const rows: Row[] = []
  const walk = (path: string, depth: number) => {
    const folder = folders.get(path)
    if (folder === undefined || folder.status === 'loading') {
      rows.push({ kind: 'note', key: `${path}\u0000loading`, text: t('loading'), depth })
      return
    }
    if (folder.status === 'error') {
      rows.push({ kind: 'note', key: `${path}\u0000error`, text: folder.message, depth })
      return
    }
    if (folder.entries.length === 0) rows.push({ kind: 'note', key: `${path}\u0000empty`, text: t('tree.empty'), depth })
    for (const entry of folder.entries) {
      const child = join(path, entry.name)
      rows.push({ kind: 'entry', path: child, name: entry.name, type: entry.type, depth })
      if (entry.type === 'directory' && expanded.has(child)) walk(child, depth + 1)
    }
    if (folder.truncated) rows.push({ kind: 'note', key: `${path}\u0000truncated`, text: t('tree.truncated'), depth })
  }
  walk('', 0)
  return rows
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

/** Search results: one row per hit, its folder dimmed after its name. */
function SearchRows({ search, focus, t, onOpen, onMenu }: {
  search: ReturnType<typeof useSearch>
  focus: string | null
  t: TranslateNS<'sidebarFiles'>
  onOpen: (hit: WorkspaceSearchHit) => void
  onMenu: (event: ReactMouseEvent, path: string, type: WorkspaceDirectoryEntry['type']) => void
}) {
  if (search.pending && search.hits.length === 0) return <div className={css.note}>{t('loading')}</div>
  if (search.hits.length === 0) return <div className={css.note}>{t('search.empty')}</div>
  return (
    <>
      {search.hits.map((hit) => {
        const name = basename(hit.path)
        const parent = hit.path.slice(0, Math.max(0, hit.path.length - name.length - 1))
        return (
          <div
            key={hit.path}
            role="treeitem"
            data-path={hit.path}
            className={css.row}
            data-focused={hit.path === focus || undefined}
            data-kind={hit.type}
            style={{ paddingLeft: indent(0) }}
            title={hit.path}
            onClick={() => { onOpen(hit) }}
            onContextMenu={(event) => { onMenu(event, hit.path, hit.type) }}
          >
            <span className={css.glyph} data-folder={hit.type === 'directory' || undefined}>
              {hit.type === 'directory' ? <IconLucideFolder /> : fileGlyph(name)}
            </span>
            <span className={css.name}>{name}</span>
            {parent !== '' && <span className={css.parent}>{parent}</span>}
          </div>
        )
      })}
      {search.truncated && <div className={css.note}>{t('search.more')}</div>}
    </>
  )
}

/** The open file: its breadcrumbs, its actions, and its content by kind. */
function FileView({ path, root, canOpenNative, treeVisible, remote, sessionId, t, onReveal, onToggleTree, onClose }: {
  path: string
  root: string | null
  canOpenNative: boolean
  treeVisible: boolean
  remote: ClientRemote
  sessionId: string
  t: TranslateNS<'sidebarFiles'>
  onReveal: (path: string) => void
  onToggleTree: () => void
  onClose: () => void
}) {
  const name = basename(path)
  const kind = fileKindOf(name)
  const isCode = kind !== 'image' && kind !== 'markdown'
  const [content, setContent] = useState<{ status: 'loading' } | { status: 'ready'; file: WorkspaceFileText } | { status: 'error'; message: string }>(
    { status: 'loading' },
  )
  useEffect(() => {
    if (kind === 'image') return undefined
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
  }, [kind, path, remote, sessionId, t])

  const labels = useMemo<MarkdownLabels>(() => ({
    code: { copyLabel: t('code.copy'), copiedLabel: t('code.copied') },
    footnotes: t('markdown.footnotes'),
  }), [t])

  const segments = path.split('/')
  const rootName = root === null ? '' : basename(root.replace(/\/+$/, ''))
  const absolute = absolutePath(root, path)

  return (
    <div className={css.file}>
      <div className={css.fileBar}>
        <nav className={css.crumbs} aria-label={path}>
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
        {canOpenNative && root !== null && <OpenWithButton path={absolute} remote={remote} t={t} />}
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
        <button type="button" className={css.iconButton} aria-label={t('file.close')} title={t('file.close')} onClick={onClose}>
          <IconLucideX />
        </button>
      </div>
      {isCode && (
        <div className={css.codeBar}>
          <span className={css.codeLang}>{extensionOf(name)}</span>
          {content.status === 'ready' && (
            <CopyIconButton text={content.file.text} label={t('code.copy')} copiedLabel={t('code.copied')} />
          )}
        </div>
      )}
      <div className={css.scrollFrame}>
        <div className={clsx(css.fileBody, kind === 'markdown' && css.fileBodyProse)}>
          {kind === 'image'
            ? <img className={css.image} src={new URL(`api/file?path=${encodeURIComponent(absolute)}`, document.baseURI).href} alt={name} />
            : content.status === 'loading'
              ? <div className={css.note}>{t('loading')}</div>
              : content.status === 'error'
                ? <div className={css.note}>{content.message}</div>
                : (
                  <>
                    {kind === 'markdown'
                      ? <MarkdownText text={content.file.text} labels={labels} animation={false} />
                      : <CodeBlock code={content.file.text} lang={extensionOf(name)} bare copyLabel={t('code.copy')} copiedLabel={t('code.copied')} className={css.code} />}
                    {!content.file.eof && <div className={css.note}>{t('file.truncated')}</div>}
                  </>
                )}
        </div>
      </div>
    </div>
  )
}
