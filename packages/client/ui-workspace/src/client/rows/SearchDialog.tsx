/**
 * The Session search popup the sidebar header's search control opens: a
 * centered modal on the settings panel's chrome (mask, surface, elevation,
 * close control, page insets) holding the query field and its results. An
 * empty query lists the most recent Sessions; a query lists title and
 * Workspace matches at once and merges the Host's content matches after a
 * debounce. Choosing a row opens that Session and closes the popup.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { IconCloseOutline16 } from '@aeven/client-ui-primitives'
import type { SessionSearchResultItem } from '@aeven/api-session-controller/client'
import type { SessionId, SessionSeq } from '@aeven/session/types'
import type { WorkspaceHeaderSearchProps } from '../contract/slots.ts'
import { deriveRecentResults, deriveSearchResults } from '../tree.ts'
import { SearchResultItem } from './Rows.tsx'
import css from './SearchDialog.module.css'

/** Pause between the latest keystroke and a Host content-search request. */
const SEARCH_DEBOUNCE_MS = 250
/** `session.search` wire bound, measured in JavaScript UTF-16 code units. */
const SEARCH_QUERY_MAX_CODE_UNITS = 500

/**
 * Keep controlled input and RPC payload inside the session.search wire contract.
 * @param value - the field's raw text.
 * @returns the query with NULs dropped and the length bound applied.
 */
function sanitizeSearchQuery(value: string): string {
  const withoutNul = value.replaceAll('\0', '')
  if (withoutNul.length <= SEARCH_QUERY_MAX_CODE_UNITS) return withoutNul
  let end = SEARCH_QUERY_MAX_CODE_UNITS
  const last = withoutNul.charCodeAt(end - 1)
  const next = withoutNul.charCodeAt(end)
  if (last >= 0xD800 && last <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF) end--
  return withoutNul.slice(0, end)
}

/** The Host content-search page for one query, and how far it has got. */
interface RemoteSearchState {
  query: string
  status: 'idle' | 'loading' | 'ready' | 'disabled' | 'error'
  items: readonly SessionSearchResultItem[]
  hasMore: boolean
}

/** The search control's data and actions the popup reads, plus its dismissal. */
type SearchDialogProps = Pick<
  WorkspaceHeaderSearchProps,
  | 'useSessions' | 'useSessionPendingInteraction' | 'useWorkspaces'
  | 'open' | 'searchSessions' | 'searchResultLimit' | 't'
> & {
  /** Dismiss the popup (close control, mask click, Escape, or a chosen row). */
  onClose: () => void
}

/**
 * Render the search popup into `document.body`, so it paints above the sidebar
 * column that hosts its trigger. Mounted only while open: the query and the
 * Host request start fresh on every opening.
 * @param props - search data, actions, and the dismissal callback.
 * @returns the portaled popup.
 */
export function SearchDialog({
  useSessions, useSessionPendingInteraction, useWorkspaces,
  open, searchSessions, searchResultLimit, t, onClose,
}: SearchDialogProps) {
  const list = useSessions(s => s)
  const pendingInteractions = useSessionPendingInteraction(s => s)
  const workspaces = useWorkspaces(state => state.items)
  const archivedSessionIds = useWorkspaces(state => state.archivedSessionIds)
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim()
  const [remote, setRemote] = useState<RemoteSearchState>({ query: '', status: 'idle', items: [], hasMore: false })
  const input = useRef<HTMLInputElement | null>(null)

  useEffect(() => { input.current?.focus() }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [onClose])

  useEffect(() => {
    if (normalizedQuery === '') {
      setRemote({ query: '', status: 'idle', items: [], hasMore: false })
      return
    }
    const controller = new AbortController()
    setRemote({ query: normalizedQuery, status: 'loading', items: [], hasMore: false })
    const timer = window.setTimeout(() => {
      searchSessions(normalizedQuery, controller.signal).then((result) => {
        if (controller.signal.aborted) return
        setRemote({ query: normalizedQuery, status: 'ready', items: result.items, hasMore: result.hasMore })
      }).catch((error: unknown) => {
        if (controller.signal.aborted) return
        setRemote({
          query: normalizedQuery,
          status: typeof error === 'object' && error !== null
            && Reflect.get(error, 'code') === 'session/search-disabled'
            ? 'disabled'
            : 'error',
          items: [],
          hasMore: false,
        })
      })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [normalizedQuery, searchSessions])

  // A page answering an older query is shown as still loading this one.
  const currentRemote = remote.query === normalizedQuery
    ? remote
    : { query: normalizedQuery, status: 'loading' as const, items: [], hasMore: false }
  const results = useMemo(
    () => normalizedQuery === ''
      ? { items: deriveRecentResults(list, workspaces, archivedSessionIds, pendingInteractions, searchResultLimit), hasMore: false }
      : deriveSearchResults(
        list, workspaces, normalizedQuery, archivedSessionIds, pendingInteractions, currentRemote, searchResultLimit,
      ),
    [list, workspaces, normalizedQuery, archivedSessionIds, pendingInteractions, currentRemote, searchResultLimit],
  )
  const pending = normalizedQuery !== '' && currentRemote.status === 'loading'
  const unavailable = currentRemote.status === 'disabled' || currentRemote.status === 'error'

  const choose = (sessionId: SessionId, matchSeq?: SessionSeq): void => {
    onClose()
    open(sessionId, matchSeq)
  }

  return createPortal((
    <div className={css.overlay} role="presentation">
      <div className={css.mask} aria-hidden="true" onClick={onClose} />
      <div className={css.panel} role="dialog" aria-modal="true" aria-label={t('search.sessions.aria')}>
        <div className={css.header}>
          <input
            ref={input}
            className={css.input}
            type="text"
            placeholder={t('search.placeholder')}
            aria-label={t('search.sessions.aria')}
            maxLength={SEARCH_QUERY_MAX_CODE_UNITS}
            value={query}
            onChange={(e) => { setQuery(sanitizeSearchQuery(e.target.value)) }}
          />
          {query !== '' && (
            <button
              type="button"
              className={css.clear}
              onClick={() => {
                setQuery('')
                input.current?.focus()
              }}
            >
              {t('search.clear')}
            </button>
          )}
          <button type="button" className={css.close} aria-label={t('close')} onClick={onClose}>
            <IconCloseOutline16 size={14} />
          </button>
        </div>
        <div className={clsx(css.results, 'no-scrollbar')}>
          {normalizedQuery === '' && results.items.length > 0 && (
            <div className={css.sectionLabel}>{t('search.recent')}</div>
          )}
          <div
            role="tree"
            aria-label={t(normalizedQuery === '' ? 'search.recent' : 'search.results.aria')}
          >
            {results.items.map(result => (
              <SearchResultItem
                key={result.id}
                result={result}
                currentId={list.current}
                onOpen={choose}
                t={t}
              />
            ))}
          </div>
          {pending && <div className={css.status} role="status">{t('search.pending')}</div>}
          {unavailable && (
            <div className={css.warning} role="status">
              {t(currentRemote.status === 'disabled' ? 'search.disabled' : 'search.unavailable')}
            </div>
          )}
          {!pending && results.items.length === 0 && (
            <div className={css.status}>{t(normalizedQuery === '' ? 'empty.none' : 'search.noMatches')}</div>
          )}
          {results.hasMore && (
            <div className={css.status}>{t('search.hasMore', { n: searchResultLimit })}</div>
          )}
        </div>
      </div>
    </div>
  ), document.body)
}
