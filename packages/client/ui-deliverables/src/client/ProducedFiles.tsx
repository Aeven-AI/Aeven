import { useEffect, useState, type MouseEvent } from 'react'
import {
  FileTypeIcon, fileExtension, IconChevronDownOutline14, IconChevronUpOutline14, IconLucideFolderOpen, Tooltip,
} from '@aeven/client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale } from '@aeven/client-ui-slots'
import type { TurnTailOwnerProps } from '@aeven/client-ui-chat/client'
import { basename, parentFolder, type ProducedFile } from './turn-deliverables.ts'
import { revealLabel } from './file-menu.ts'
import type { NS } from './locales.ts'
import css from './ProducedFiles.module.css'

/** Rows or cards shown before the fold. */
const COLLAPSED_COUNT = 4

const GROUPED = new Intl.NumberFormat('en-US')

/** Registration-side Host capability facts. */
export interface ProducedFilesInjected {
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
 * edited, then a card per file it created.
 * @param props - selector-matched files, the chat view's file opener and workspace root, and the locale seat.
 * @returns The produced-files section.
 */
export function ProducedFiles({
  matched, openFile, cwd, isLoopback, ensureWorkspacePathOpen, openFileMenu, revealFile, useWorkspacePathOpen, t,
}: ProducedFilesProps) {
  useEffect(() => { ensureWorkspacePathOpen() }, [ensureWorkspacePathOpen])
  const hostCanOpenPath = useWorkspacePathOpen(available => available === true)
  const canOpenPath = isLoopback && hostCanOpenPath
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
        <ChangedFiles files={edited} openFile={openFile} menu={menu} t={t}
          openWorkspace={canOpenPath && matched.length > 1 ? () => { openFile('.') } : undefined} />
      )}
      {created.length > 0 && (
        <CreatedFiles files={created} cwd={cwd} openFile={openFile} menu={menu} t={t}
          reveal={canOpenPath ? (path) => { revealFile(path, cwd) } : undefined} />
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
 * The files a turn edited: a filled header with the total line counts, then
 * one row per file folded after four. A single file is the header alone, and
 * opens that file.
 */
function ChangedFiles({ files, openFile, menu, openWorkspace, t }: {
  files: readonly ProducedFile[]
  openFile: (path: string) => void
  menu: ((path: string) => (event: MouseEvent) => void) | undefined
  /** Open the Session workspace; absent where the Host cannot open it. */
  openWorkspace: (() => void) | undefined
  t: Translate
}) {
  const [expanded, setExpanded] = useState(false)
  const single = files.length === 1 ? files[0] : undefined
  const foldable = files.length > COLLAPSED_COUNT
  const rows = foldable && !expanded ? files.slice(0, COLLAPSED_COUNT) : files
  const total = totalCounts(files)
  const titles = (
    <span className={css.titles}>
      <span className={css.title}>{single === undefined
        ? t('changes.title', { count: String(files.length) })
        : t('changes.singleTitle', { name: basename(single.path) })}</span>
      <span className={css.stat}>
        {total !== undefined && <span className={css.statCounts}><Counts counts={total} t={t} /></span>}
        {single !== undefined && <span className={css.previewHint}>{t('produced.preview')}</span>}
      </span>
    </span>
  )
  return (
    <div className={css.card} data-changed-files data-single={single !== undefined || undefined}>
      {single === undefined
        ? (
          <div className={css.header}>
            <span className={css.tile}><FileTypeIcon kind="code" size={20} /></span>
            {titles}
            {openWorkspace !== undefined && (
              <Tooltip label={revealLabel(t)} side="top" anchor="icon">
                <button type="button" className={css.iconButton} aria-label={revealLabel(t)} onClick={openWorkspace}>
                  <IconLucideFolderOpen />
                </button>
              </Tooltip>
            )}
          </div>
        )
        : (
          <button type="button" className={css.header} title={single.path}
            aria-label={t('produced.open', { name: single.path })}
            onClick={() => { openFile(single.path) }}
            onContextMenu={menu?.(single.path)}>
            <span className={css.tile}><FileTypeIcon path={single.path} size={20} /></span>
            {titles}
          </button>
        )}
      {single === undefined && (
        <ul className={css.list}>
          {rows.map(file => (
            <li key={file.path}>
              <button type="button" className={css.row} title={file.path}
                aria-label={t('produced.open', { name: file.path })}
                onClick={() => { openFile(file.path) }}
                onContextMenu={menu?.(file.path)}>
                <span className={css.rowName}>
                  <FileTypeIcon path={file.path} size={14} />
                  <span className={css.path}>{file.path}</span>
                </span>
                {file.counts !== undefined && <span className={css.counts}><Counts counts={file.counts} t={t} /></span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {foldable && (
        <FoldToggle className={css.listToggle} expanded={expanded} count={files.length} t={t}
          onToggle={() => { setExpanded(value => !value) }} />
      )}
    </div>
  )
}

/**
 * The files a turn created: one card each, two columns on a wide column, the
 * first four shown before the fold. A card opens its file; its folder button
 * reveals it where the Host can.
 */
function CreatedFiles({ files, cwd, openFile, menu, reveal, t }: {
  files: readonly ProducedFile[]
  cwd: string | undefined
  openFile: (path: string) => void
  menu: ((path: string) => (event: MouseEvent) => void) | undefined
  /** Reveal one file in the Host's file manager; absent where the Host cannot. */
  reveal: ((path: string) => void) | undefined
  t: Translate
}) {
  const [expanded, setExpanded] = useState(false)
  const foldable = files.length > COLLAPSED_COUNT
  const shown = foldable && !expanded ? files.slice(0, COLLAPSED_COUNT) : files
  return (
    <div className={css.created}>
      <div className={css.grid} data-single={files.length === 1 || undefined}>
        {shown.map((file) => {
          const name = basename(file.path)
          const folder = parentFolder(file.path, cwd)
          const kind = fileExtension(name).toUpperCase() || t('produced.fileKind')
          return (
            <div key={file.path} className={css.file} data-produced-file>
              <button type="button" className={css.cardPreview} title={file.path}
                aria-label={t('produced.open', { name: file.path })}
                onClick={() => { openFile(file.path) }}
                onContextMenu={menu?.(file.path)} />
              <span className={css.fileIcon}><FileTypeIcon path={file.path} size={20} /></span>
              <div className={css.fileBody}>
                <div className={css.details}>
                  <span className={css.fileName}>{name}</span>
                  <span className={css.description}>
                    <span className={css.secondaryText}>{folder === '' ? kind : `${kind} · ${folder}`}</span>
                    <span className={css.previewHint}>{t('produced.preview')}</span>
                  </span>
                </div>
                {reveal !== undefined && (
                  <Tooltip label={revealLabel(t)} side="top" anchor="icon">
                    <button type="button" className={css.cardAction} aria-label={revealLabel(t)}
                      onClick={() => { reveal(file.path) }}>
                      <IconLucideFolderOpen />
                    </button>
                  </Tooltip>
                )}
              </div>
            </div>
          )
        })}
      </div>
      {foldable && (
        <FoldToggle className={css.gridToggle} expanded={expanded} count={files.length} t={t}
          onToggle={() => { setExpanded(value => !value) }} />
      )}
    </div>
  )
}
