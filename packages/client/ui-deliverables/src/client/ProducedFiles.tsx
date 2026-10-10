import { useEffect } from 'react'
import { fileGlyph, IconLucideFolderOpen, Tooltip } from '@aeven/client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale } from '@aeven/client-ui-slots'
import type { TurnTailOwnerProps } from '@aeven/client-ui-chat/client'
import { basename, parentFolder } from './turn-deliverables.ts'
import { revealLabel } from './file-menu.ts'
import type { NS } from './locales.ts'
import css from './ProducedFiles.module.css'

/** Maximum number of file rows rendered before the remainder counter. */
const SHOWN_LIMIT = 6

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
  hooks: {
    /** Current generation's Session workspace opener capability. */
    workspacePathOpen: HostObservable<boolean | undefined>
  }
}

/** Matched paths plus the opener, workspace root, locale, and injected Host capability. */
export type ProducedFilesProps = Pick<TurnTailOwnerProps, 'openFile' | 'cwd'> & {
  matched: readonly string[]
} & PropsLocale<typeof NS> & InjectFace<ProducedFilesInjected>

function moreLabel(t: ProducedFilesProps['t'], count: number): string {
  return count === 1 ? t('produced.moreOne') : t('produced.more', { count: String(count) })
}

/**
 * Render one turn's produced files as a table of openable files, styled as the answer's table block.
 * @param props - selector-matched paths, the chat view's file opener and workspace root, and the locale seat.
 * @returns The produced-files card.
 */
export function ProducedFiles({
  matched: paths, openFile, cwd, isLoopback, ensureWorkspacePathOpen, openFileMenu, useWorkspacePathOpen, t,
}: ProducedFilesProps) {
  useEffect(() => { ensureWorkspacePathOpen() }, [ensureWorkspacePathOpen])
  const hostCanOpenPath = useWorkspacePathOpen(available => available === true)
  const canOpenPath = isLoopback && hostCanOpenPath
  const shown = paths.slice(0, SHOWN_LIMIT)
  const hidden = paths.length - shown.length
  return (
    <section className={css.root} aria-label={t('produced.label')}>
      <header className={css.header}>
        <span className={css.title}>{t('produced.label')}</span>
        {paths.length > 1 && canOpenPath && (
          <Tooltip label={revealLabel(t)} side="top" anchor="icon">
            <button
              type="button"
              className={css.iconButton}
              aria-label={revealLabel(t)}
              onClick={() => { openFile('.') }}
            >
              <IconLucideFolderOpen />
            </button>
          </Tooltip>
        )}
      </header>
      <table className={css.table}>
        <thead>
          <tr>
            <th>{t('produced.file')}</th>
            <th>{t('produced.folder')}</th>
          </tr>
        </thead>
        <tbody data-produced-files-row>
          {shown.map((path) => {
            const name = basename(path)
            return (
              <tr key={path}>
                <td>
                  <button
                    type="button"
                    className={css.file}
                    // The full path is the disambiguator when two turns produce
                    // files that share a basename; the row shows the folder beside it.
                    title={path}
                    aria-label={t('produced.open', { name: path })}
                    onClick={() => { openFile(path) }}
                    onContextMenu={openFileMenu === undefined ? undefined : (event) => {
                      event.preventDefault()
                      openFileMenu(path, cwd)
                    }}
                  >
                    {fileGlyph(name)}
                    <span className={css.name}>{name}</span>
                  </button>
                </td>
                <td>{parentFolder(path, cwd)}</td>
              </tr>
            )
          })}
          {hidden > 0 && (
            <tr>
              <td className={css.more} colSpan={2}>{moreLabel(t, hidden)}</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  )
}
