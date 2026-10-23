import { useEffect, useRef, useState, type MouseEvent } from 'react'
import {
  fileGlyph, IconChevronDownOutline14, IconChevronUpOutline14, IconLucideFolderOpen, Tooltip,
} from '@aeven/client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale } from '@aeven/client-ui-slots'
import type { TurnTailOwnerProps } from '@aeven/client-ui-chat/client'
import { basename, type ProducedFile } from './turn-deliverables.ts'
import { revealLabel } from './file-menu.ts'
import type { NS } from './locales.ts'
import css from './ProducedFiles.module.css'

/** Rows or cards shown before the fold. */
const COLLAPSED_COUNT = 4

const GROUPED = new Intl.NumberFormat('en-US')

/** Registration-side Host capability facts. */
export interface ProducedFilesInjected {
  /** Open a produced file in the session's Files sidebar. @param path - Produced file path. */
  previewFile(path: string): Promise<boolean>
  /** Whether the browser itself is connected over loopback. */
  isLoopback: boolean
  /** Load the opener capability when this row first reaches the page. */
  ensureWorkspacePathOpen(): void
  /**
   * Show the row's own right-click menu for one produced path. Absent where the
   * client has no menu to offer — served over HTTP, the platform's own menu is
   * what its reader expects.
   * @param path - the produced path as the assistant wrote it.
   * @param cwd - the Session workspace root, used to resolve a relative path.
   */
  openFileMenu?: ((path: string, cwd: string | undefined) => void) | undefined
  /**
   * Reveal one produced file in the Host's file manager.
   * @param path - the produced path as the assistant wrote it.
   * @param cwd - the Session workspace root, used to resolve a relative path.
   */
  revealFile(path: string, cwd: string | undefined): void
  hooks: {
    /** Current generation's Session workspace opener capability. */
    workspacePathOpen: HostObservable<boolean | undefined>
  }
}

/** Matched files plus the opener, workspace root, locale, and injected Host capability. */
export type ProducedFilesProps = Pick<TurnTailOwnerProps, 'openFile' | 'cwd'> & {
  matched: readonly ProducedFile[]
} & PropsLocale<typeof NS> & InjectFace<ProducedFilesInjected>

type Translate = ProducedFilesProps['t']

/**
 * Render one turn's produced files: a changed-files card for the files it
 * edited, then the same table without change counts for files it created.
 * @param props - selector-matched files, the chat view's file opener and workspace root, and the locale seat.
 * @returns The produced-files section.
 */
export function ProducedFiles({
  matched, openFile, previewFile, cwd, isLoopback, ensureWorkspacePathOpen, openFileMenu, useWorkspacePathOpen, t,
}: ProducedFilesProps) {
  useEffect(() => { ensureWorkspacePathOpen() }, [ensureWorkspacePathOpen])
  const hostCanOpenPath = useWorkspacePathOpen(available => available === true)
  const canOpenPath = isLoopback && hostCanOpenPath
  const openProducedFile = (path: string): void => {
    void previewFile(path).then((previewed) => { if (!previewed) openFile(path) })
  }
  const edited = matched.filter(file => !file.created)
  const created = matched.filter(file => file.created)
  const menu = openFileMenu === undefined
    ? undefined
    : (path: string) => (event: MouseEvent) => {
      event.preventDefault()
      openFileMenu(path, cwd)
    }
  return (
    <section className={css.root} aria-label={t('produced.label')} data-produced-files-row>
      {edited.length > 0 && (
        <FilesTable files={edited} openFile={openProducedFile} menu={menu} t={t}
          openWorkspace={canOpenPath ? () => { openFile('.') } : undefined} />
      )}
      {created.length > 0 && (
        <FilesTable files={created} created openFile={openProducedFile} menu={menu} t={t}
          openWorkspace={canOpenPath ? () => { openFile('.') } : undefined} />
      )}
    </section>
  )
}

/** Added and deleted line counts in the card's colors. */
function Counts({ counts, t }: { counts: NonNullable<ProducedFile['counts']>; t: Translate }) {
  return <>
    <span className={css.added}>{t('changes.added', { count: GROUPED.format(counts.added) })}</span>
    <span className={css.deleted}>{t('changes.deleted', { count: GROUPED.format(counts.deleted) })}</span>
  </>
}

/** Expand or collapse a folded list. */
function FoldToggle({ expanded, count, onToggle, className, t }: {
  expanded: boolean
  count: number
  onToggle: () => void
  className: string | undefined
  t: Translate
}) {
  return (
    <button type="button" className={className} aria-expanded={expanded} onClick={onToggle}>
      <span>{expanded ? t('produced.collapse') : t('produced.all', { count: String(count) })}</span>
      {expanded ? <IconChevronUpOutline14 /> : <IconChevronDownOutline14 />}
    </button>
  )
}

/** Summed counts across files, absent when any file recorded none. */
function totalCounts(files: readonly ProducedFile[]): ProducedFile['counts'] {
  let added = 0
  let deleted = 0
  for (const file of files) {
    if (file.counts === undefined) return undefined
    added += file.counts.added
    deleted += file.counts.deleted
  }
  return { added, deleted }
}

/**
 * A turn's file table, folded after four rows. Created-file tables omit
 * per-file and total line counts.
 */
function FilesTable({ files, created = false, openFile, menu, openWorkspace, t }: {
  created?: boolean
  files: readonly ProducedFile[]
  openFile: (path: string) => void
  menu: ((path: string) => (event: MouseEvent) => void) | undefined
  /** Open the Session workspace; absent where the Host cannot open it. */
  openWorkspace: (() => void) | undefined
  t: Translate
}) {
  const [expanded, setExpanded] = useState(false)
  // The pills take their backdrop only once the header pins, as the code
  // block's own `.scroll` state does.
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (sentinel === null || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      ([entry]) => { setScrolled(entry !== undefined && !entry.isIntersecting) },
      { rootMargin: '-40px 0px 0px 0px' },
    )
    observer.observe(sentinel)
    return () => { observer.disconnect() }
  }, [])
  const foldable = files.length > COLLAPSED_COUNT
  const rows = foldable && !expanded ? files.slice(0, COLLAPSED_COUNT) : files
  const total = created ? undefined : totalCounts(files)
  const heading = (
    <span className={css.heading}>
      <span className={css.title}>{t(created ? 'produced.title' : 'changes.title', { count: String(files.length) })}</span>
      {total !== undefined && <span className={css.counts}><Counts counts={total} t={t} /></span>}
    </span>
  )
  return (
    <div className={css.card} data-changed-files={!created || undefined} data-created-files={created || undefined}>
      <div ref={sentinelRef} className={css.sentinel} aria-hidden="true" />
      <div className={css.header} data-scroll={scrolled || undefined}>
        {heading}
        {openWorkspace !== undefined && (
          <Tooltip label={revealLabel(t)} side="top" anchor="icon">
            <button type="button" className={css.iconButton} aria-label={revealLabel(t)} onClick={openWorkspace}>
              <IconLucideFolderOpen />
            </button>
          </Tooltip>
        )}
      </div>
      <div className={css.content}>
        <ul className={css.list}>
          {rows.map(file => (
            <li key={file.path} data-produced-file={created || undefined}>
              <button type="button" className={css.row} title={file.path}
                aria-label={t('produced.open', { name: file.path })}
                onClick={() => { openFile(file.path) }}
                onContextMenu={menu?.(file.path)}>
                <span className={css.rowName}>
                  {fileGlyph(basename(file.path))}
                  <span className={css.path}>{file.path}</span>
                </span>
                {!created && file.counts !== undefined && <span className={css.counts}><Counts counts={file.counts} t={t} /></span>}
              </button>
            </li>
          ))}
        </ul>
        {foldable && (
          <FoldToggle className={css.listToggle} expanded={expanded} count={files.length} t={t}
            onToggle={() => { setExpanded(value => !value) }} />
        )}
      </div>
    </div>
  )
}
