/**
 * The right sidebar's content selection: the doors out of an empty column, and
 * the one each session was left on.
 *
 * Every kind lists, and one without a provider behind it lists disabled, so the
 * column states what it will hold rather than hiding it until the day it works.
 * Choosing one is remembered per session, and the control above the pane
 * returns the column to this selection.
 */
import type { ReactNode } from 'react'
import { useCallback, useState, useSyncExternalStore } from 'react'
import {
  IconChevronsLeftOutline14, IconFolderOpenOutline16, IconGlobeOutline14, IconSmartphoneOutline16,
  IconTerminalOutline16,
} from '@aeven/client-ui-primitives'
import type { ContentSelectComponentProps } from './contract/slots.ts'
import {
  SIDEBAR_CONTENT_KINDS, readSelection, writeSelection, type SidebarContentKind,
} from './selection.ts'
import css from './ContentSelect.module.css'

/** The glyph each kind is listed with. */
const GLYPHS: Record<SidebarContentKind, (props: { size: number }) => ReactNode> = {
  browser: IconGlobeOutline14,
  terminal: IconTerminalOutline16,
  files: IconFolderOpenOutline16,
  device: IconSmartphoneOutline16,
}

/**
 * Render one session's content selection.
 * @param props - composed slot props (runtime share + locale, contract/slots.ts).
 * @returns the selection element tree.
 */
export function ContentSelect(props: ContentSelectComponentProps) {
  const { sessionId, t, registry } = props
  // Keyed by session: the body slot re-renders this instance for whichever
  // session is current, so a choice read for one session must not stand for
  // the next.
  const [choice, setChoice] = useState(() => ({ sessionId, kind: readSelection(sessionId) }))
  const chosen = choice.sessionId === sessionId ? choice.kind : readSelection(sessionId)
  // Providers register as their plugins mount, so availability is read live
  // rather than captured: a kind becomes pickable the moment it has a pane.
  useSyncExternalStore(
    callback => registry.subscribe(callback),
    () => registry.version,
  )

  const choose = useCallback((kind: SidebarContentKind) => {
    setChoice({ sessionId, kind })
    writeSelection(sessionId, kind)
  }, [sessionId])

  const clear = useCallback(() => {
    setChoice({ sessionId, kind: undefined })
    writeSelection(sessionId, undefined)
  }, [sessionId])

  // A kind saved before its provider existed, or after it was unloaded, has
  // nothing to render, so the column falls back to the selection.
  const Chosen = chosen === undefined ? undefined : registry.resolve(chosen)
  // Only the control above the pane belongs to the selection, so the pane
  // keeps the rest of the body.
  if (chosen !== undefined && Chosen !== undefined) {
    return (
      <div className={css.pane} data-sidebar-right-pane={chosen}>
        <div className={css.paneBar}>
          <button
            type="button"
            className={css.paneBack}
            aria-label={t('back.label')}
            onClick={clear}
          >
            <IconChevronsLeftOutline14 size={14} />
          </button>
          <span className={css.paneTitle}>{t(`${chosen}.title`)}</span>
        </div>
        {/* Keyed by session, so a pane holding per-session state (the
            browser's storage partition) never serves the next session. */}
        <Chosen key={sessionId} sessionId={sessionId} />
      </div>
    )
  }

  return (
    <div className={css.root} data-sidebar-right-select="">
      {SIDEBAR_CONTENT_KINDS.map((kind) => {
        const Glyph = GLYPHS[kind]
        const available = registry.resolve(kind) !== undefined
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
