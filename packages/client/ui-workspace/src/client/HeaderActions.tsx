/**
 * The browsing region's controls in the sidebar shell's header row: search,
 * view options, and add workspace. The search field replaces the cluster's
 * icons while it is open, and the query it writes lives in the shared viewing
 * store — the session list below reads the same store, so the header never
 * reaches into the region. Adding raises the directory flow (WorkspacePicker,
 * same package — direct composition, no slot between them).
 */
import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  IconCloseFill14, IconLucideFolderPlus, IconLucideSearch, IconLucideSettings2, Menu, Tooltip,
} from '@aeven/client-ui-primitives'
import type { WorkspaceId } from '@aeven/api-workspace-controller/client'
import type { WorkspaceHeaderActionsProps } from './contract/slots.ts'
import type { SessionOrderBy } from './tree.ts'
import { WorkspacePickFlow } from './WorkspacePicker.tsx'
import css from './HeaderActions.module.css'

/** `session.search` wire bound, measured in JavaScript UTF-16 code units. */
const SEARCH_QUERY_MAX_CODE_UNITS = 500

/** Keep controlled input and RPC payload inside the session.search wire contract. */
function sanitizeSearchQuery(value: string): string {
  const withoutNul = value.replaceAll('\0', '')
  if (withoutNul.length <= SEARCH_QUERY_MAX_CODE_UNITS) return withoutNul
  let end = SEARCH_QUERY_MAX_CODE_UNITS
  const last = withoutNul.charCodeAt(end - 1)
  const next = withoutNul.charCodeAt(end)
  if (last >= 0xD800 && last <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF) end--
  return withoutNul.slice(0, end)
}

/** Grouping and ordering menu; own open state so it resets with the wide chrome. */
function ViewOptionsMenu({ groupBy, orderBy, onGroupPick, onOrderPick, t }: {
  groupBy: 'workspace' | 'flat'
  orderBy: SessionOrderBy
  onGroupPick: (mode: 'workspace' | 'flat') => void
  onOrderPick: (mode: SessionOrderBy) => void
  t: WorkspaceHeaderActionsProps['t']
}) {
  const [open, setOpen] = useState(false)
  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      items={[
        { type: 'label' as const, id: 'group-by', text: t('groupBy.label') },
        { id: 'workspace', label: t('groupBy.workspace') },
        { id: 'flat', label: t('groupBy.flat') },
        { type: 'separator' as const, id: 'order-by-separator' },
        { type: 'label' as const, id: 'order-by', text: t('orderBy.label') },
        { id: 'manual', label: t('orderBy.manual') },
        { id: 'updated', label: t('orderBy.updated') },
      ]}
      selectedIds={[groupBy, orderBy]}
      onSelect={(id) => {
        if (id === 'workspace' || id === 'flat') onGroupPick(id)
        else if (id === 'manual' || id === 'updated') onOrderPick(id)
        setOpen(false)
      }}
      align="end"
      dense
      portal
      anchor={(
        <Tooltip label={t('viewOptions.label')} side="bottom">
          <button
            type="button"
            className={css.action}
            aria-label={t('viewOptions.label')}
            onClick={() => { setOpen(v => !v) }}
          >
            <IconLucideSettings2 />
          </button>
        </Tooltip>
      )}
    />
  )
}

/**
 * Render the header control cluster.
 * @param props - shell owner share + shared viewing store + injected actions.
 * @returns the cluster element tree.
 */
export function WorkspaceHeaderActions({
  useStore,
  actions,
  useWorkspaces,
  startSession,
  createWorkspace,
  useDirectoryFlow,
  renderSlot,
  t,
}: WorkspaceHeaderActionsProps) {
  const query = useStore(s => s.searchQuery)
  const searchExpanded = useStore(s => s.searchExpanded)
  const groupBy = useStore(s => s.groupBy)
  const orderBy = useStore(s => s.orderBy)
  // Live occupancy of this surface's directory-flow hole (the same source the
  // flow reads): a composition without a picking affordance can add nothing.
  const directoryFlowAvailable = useDirectoryFlow(occupied => occupied)
  const searchRoot = useRef<HTMLDivElement | null>(null)
  const searchInput = useRef<HTMLInputElement | null>(null)
  const [wsPickerOpen, setWsPickerOpen] = useState(false)
  const wsPlusRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!searchExpanded) return
    searchInput.current?.focus({ preventScroll: true })
  }, [searchExpanded])

  // Outside-click dismissal: clicking past the field blurs it, and an empty
  // query folds the cluster back to its icons.
  useEffect(() => {
    if (!searchExpanded) return
    const onClick = (event: MouseEvent): void => {
      if (!(event.target instanceof Node) || searchRoot.current?.contains(event.target) === true) return
      searchInput.current?.blur()
      if (query !== '') return
      actions.setSearchExpanded(false)
    }
    document.addEventListener('click', onClick)
    return () => { document.removeEventListener('click', onClick) }
  }, [actions, query, searchExpanded])

  return (
    <div className={css.cluster}>
      <div
        ref={searchRoot}
        className={clsx(css.search, searchExpanded && css.searchExpanded)}
        onClick={() => { setWsPickerOpen(false); actions.setSearchExpanded(true) }}
      >
        <Tooltip label={t('search')} side="bottom" disabled={searchExpanded}>
          <button
            type="button"
            className={css.action}
            aria-label={t('search.sessions.aria')}
            aria-expanded={searchExpanded}
            onClick={() => { setWsPickerOpen(false); actions.setSearchExpanded(true) }}
          >
            <IconLucideSearch />
          </button>
        </Tooltip>
        <input
          ref={searchInput}
          className={css.searchInput}
          type="text"
          placeholder={t('search.placeholder')}
          maxLength={SEARCH_QUERY_MAX_CODE_UNITS}
          value={query}
          tabIndex={searchExpanded ? 0 : -1}
          onChange={(e) => { actions.setSearchQuery(sanitizeSearchQuery(e.target.value)) }}
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return
            actions.setSearchQuery('')
            actions.setSearchExpanded(false)
          }}
        />
        {searchExpanded && (
          <button
            type="button"
            className={css.clear}
            aria-label={t('search.clear')}
            onClick={(e) => {
              e.stopPropagation()
              actions.setSearchQuery('')
              actions.setSearchExpanded(false)
            }}
          >
            <IconCloseFill14 />
          </button>
        )}
      </div>

      {!searchExpanded && (
        <>
          <ViewOptionsMenu
            groupBy={groupBy}
            orderBy={orderBy}
            onGroupPick={(mode) => { actions.setGroupBy(mode) }}
            onOrderPick={(mode) => { actions.setOrderBy(mode) }}
            t={t}
          />
          {/* Adding is the button's one action, so a composition with no
              picking affordance has nothing to offer here: the cluster hides
              the button rather than leaving a dead one in the header. */}
          {directoryFlowAvailable && (
            <Tooltip label={t('workspace.add')} side="bottom">
              <button
                ref={wsPlusRef}
                type="button"
                className={css.action}
                aria-label={t('workspace.add')}
                onClick={() => { setWsPickerOpen(v => !v) }}
              >
                <IconLucideFolderPlus />
              </button>
            </Tooltip>
          )}
        </>
      )}

      {/* Add flow + its error dialog (same package — direct composition). */}
      <WorkspacePickFlow
        t={t}
        open={wsPickerOpen}
        anchorRef={wsPlusRef}
        useWorkspaces={useWorkspaces}
        createWorkspace={createWorkspace}
        useDirectoryFlow={useDirectoryFlow}
        renderDirectoryFlow={owner => renderSlot('sidebar.header.action.directoryFlow', owner)}
        addOnly
        side="bottom"
        onPick={(workspaceId: WorkspaceId) => {
          setWsPickerOpen(false)
          startSession(workspaceId)
        }}
        onClose={() => { setWsPickerOpen(false) }}
      />
    </div>
  )
}
