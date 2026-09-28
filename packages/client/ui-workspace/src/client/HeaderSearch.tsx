/**
 * The Session search control, seated at the leading edge of the sidebar
 * shell's header row. It opens the search popup (SearchDialog.tsx) and leaves
 * the session list below untouched: the popup lists recent Sessions and search
 * results itself and opens the one chosen.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { IconLucideSearch, Tooltip } from '@aeven/client-ui-primitives'
import type { WorkspaceHeaderSearchProps } from './contract/slots.ts'
import { SearchDialog } from './SearchDialog.tsx'
import css from './HeaderActions.module.css'

/**
 * Render the header's search control and, while open, its popup.
 * @param props - global data hooks, injected search actions, and the seat's localized copy.
 * @returns the search control element tree.
 */
export function WorkspaceHeaderSearch({
  useSessions, useSessionPendingInteraction, useWorkspaces, open, searchSessions, searchResultLimit, t,
}: WorkspaceHeaderSearchProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const wasOpen = useRef(dialogOpen)
  const close = useCallback(() => { setDialogOpen(false) }, [])
  // Restore after the close commit, when the popup can no longer own focus.
  useEffect(() => {
    if (wasOpen.current && !dialogOpen) trigger.current?.focus()
    wasOpen.current = dialogOpen
  }, [dialogOpen])

  return (
    <>
      <Tooltip label={t('search')} side="bottom" anchor="icon" disabled={dialogOpen}>
        <button
          ref={trigger}
          type="button"
          className={clsx(css.action, css.leading)}
          aria-label={t('search.sessions.aria')}
          aria-haspopup="dialog"
          aria-expanded={dialogOpen}
          onClick={() => { setDialogOpen(true) }}
        >
          <IconLucideSearch />
        </button>
      </Tooltip>
      {dialogOpen && (
        <SearchDialog
          useSessions={useSessions}
          useSessionPendingInteraction={useSessionPendingInteraction}
          useWorkspaces={useWorkspaces}
          open={open}
          searchSessions={searchSessions}
          searchResultLimit={searchResultLimit}
          t={t}
          onClose={close}
        />
      )}
    </>
  )
}
