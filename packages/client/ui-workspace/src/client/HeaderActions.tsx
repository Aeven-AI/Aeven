/**
 * The browsing region's trailing controls in the sidebar shell's header row:
 * view options and add workspace. The region's search control leads the same
 * row from its own seat (HeaderSearch.tsx) and writes the same viewing store,
 * so this cluster holds only what stays at the trailing edge. Adding raises the
 * directory flow (WorkspacePicker, same package — direct composition, no slot
 * between them).
 */
import { useRef, useState } from 'react'
import {
  IconLucideFolderPlus, IconLucideSettings2, Menu, Tooltip,
} from '@aeven/client-ui-primitives'
import type { WorkspaceId } from '@aeven/api-workspace-controller/client'
import type { WorkspaceHeaderActionsProps } from './contract/slots.ts'
import type { SessionOrderBy } from './tree.ts'
import type { SessionGroupBy } from './stores.ts'
import { WorkspacePickFlow } from './WorkspacePicker.tsx'
import css from './HeaderActions.module.css'

/**
 * Grouping, ordering and section-visibility menu; own open state so it resets
 * with the wide chrome. Status grouping hides the order options: each bucket
 * lists its Sessions by activity, so there is no hand order to choose there.
 */
function ViewOptionsMenu({
  groupBy, orderBy, showAutomations, showArchived, onGroupPick, onOrderPick, onShowAutomations, onShowArchived, t,
}: {
  groupBy: SessionGroupBy
  orderBy: SessionOrderBy
  showAutomations: boolean
  showArchived: boolean
  onGroupPick: (mode: SessionGroupBy) => void
  onOrderPick: (mode: SessionOrderBy) => void
  onShowAutomations: (show: boolean) => void
  onShowArchived: (show: boolean) => void
  t: WorkspaceHeaderActionsProps['t']
}) {
  const [open, setOpen] = useState(false)
  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      items={[
        { type: 'label' as const, id: 'group-by', text: t('groupBy.label') },
        { id: 'status', label: t('groupBy.status') },
        { id: 'workspace', label: t('groupBy.workspace') },
        ...(groupBy === 'workspace'
          ? [
            { type: 'separator' as const, id: 'order-by-separator' },
            { type: 'label' as const, id: 'order-by', text: t('orderBy.label') },
            { id: 'manual', label: t('orderBy.manual') },
            { id: 'updated', label: t('orderBy.updated') },
          ]
          : []),
        { type: 'separator' as const, id: 'show-separator' },
        { type: 'label' as const, id: 'show', text: t('show.label') },
        { id: 'show-archived', label: t('show.archived') },
        { id: 'show-automations', label: t('show.automations') },
      ]}
      selectedIds={[
        groupBy,
        ...(groupBy === 'workspace' ? [orderBy] : []),
        ...(showArchived ? ['show-archived'] : []),
        ...(showAutomations ? ['show-automations'] : []),
      ]}
      onSelect={(id) => {
        if (id === 'workspace' || id === 'status') onGroupPick(id)
        else if (id === 'manual' || id === 'updated') onOrderPick(id)
        else if (id === 'show-automations') onShowAutomations(!showAutomations)
        else if (id === 'show-archived') onShowArchived(!showArchived)
        setOpen(false)
      }}
      align="end"
      dense
      portal
      anchor={(
        <Tooltip label={t('viewOptions.label')} side="bottom" anchor="icon">
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
  const groupBy = useStore(s => s.groupBy)
  const orderBy = useStore(s => s.orderBy)
  const showAutomations = useStore(s => s.showAutomations)
  const showArchived = useStore(s => s.showArchived)
  // Live occupancy of this surface's directory-flow hole (the same source the
  // flow reads): a composition without a picking affordance can add nothing.
  const directoryFlowAvailable = useDirectoryFlow(occupied => occupied)
  const [wsPickerOpen, setWsPickerOpen] = useState(false)
  const wsPlusRef = useRef<HTMLButtonElement>(null)

  return (
    <div className={css.cluster}>
      <ViewOptionsMenu
        groupBy={groupBy}
        orderBy={orderBy}
        onGroupPick={(mode) => { actions.setGroupBy(mode) }}
        onOrderPick={(mode) => { actions.setOrderBy(mode) }}
        showAutomations={showAutomations}
        showArchived={showArchived}
        onShowAutomations={(show) => { actions.setShowAutomations(show) }}
        onShowArchived={(show) => { actions.setShowArchived(show) }}
        t={t}
      />
      {/* Adding is the button's one action, so a composition with no picking
          affordance has nothing to offer here: the cluster hides the button
          rather than leaving a dead one in the header. */}
      {directoryFlowAvailable && (
        <Tooltip label={t('workspace.add')} side="bottom" anchor="icon">
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
