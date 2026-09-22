/**
 * The right sidebar's content selection: the doors out of an empty column, and
 * the one each session was left on.
 *
 * A kind with no provider behind it still lists, disabled, so the column states
 * what it will hold rather than hiding it until the day it works. Choosing one
 * is remembered per session, so reopening the column returns to it.
 */
import type { ReactNode } from 'react'
import { useCallback, useState } from 'react'
import {
  IconFolderOpenOutline16, IconGlobeOutline14, IconTerminalOutline16,
} from '@aeven/client-ui-primitives'
import type { ContentSelectComponentProps } from './contract/slots.ts'
import {
  AVAILABLE_CONTENT_KINDS, SIDEBAR_CONTENT_KINDS,
  readSelection, writeSelection, type SidebarContentKind,
} from './selection.ts'
import css from './ContentSelect.module.css'

/** The glyph each kind is listed with. */
const GLYPHS: Record<SidebarContentKind, (props: { size: number }) => ReactNode> = {
  browser: IconGlobeOutline14,
  terminal: IconTerminalOutline16,
  files: IconFolderOpenOutline16,
}

/**
 * Render one session's content selection.
 * @param props - composed slot props (runtime share + locale, contract/slots.ts).
 * @returns the selection element tree.
 */
export function ContentSelect({ sessionId, t }: ContentSelectComponentProps) {
  const [chosen, setChosen] = useState<SidebarContentKind | undefined>(() => readSelection(sessionId))

  const choose = useCallback((kind: SidebarContentKind) => {
    setChosen(kind)
    writeSelection(sessionId, kind)
  }, [sessionId])

  // Until a provider registers, a chosen kind has nothing to render, so the
  // column stays on its selection rather than going blank.
  if (chosen !== undefined && AVAILABLE_CONTENT_KINDS.has(chosen)) return null

  return (
    <div className={css.root} data-sidebar-right-select="">
      {SIDEBAR_CONTENT_KINDS.map((kind) => {
        const Glyph = GLYPHS[kind]
        const available = AVAILABLE_CONTENT_KINDS.has(kind)
        return (
          <button
            key={kind}
            type="button"
            className={css.entry}
            data-sidebar-right-select-entry={kind}
            disabled={!available}
            onClick={() => { choose(kind) }}
          >
            <span className={css.entryIcon}><Glyph size={18} /></span>
            <span className={css.entryText}>
              <span className={css.entryTitle}>{t(`${kind}.title`)}</span>
              <span className={css.entryDescription}>
                {available ? t(`${kind}.description`) : t('entry.unavailable')}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
