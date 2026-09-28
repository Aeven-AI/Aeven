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
import { WorkspacePickFlow } from './WorkspacePicker.tsx'
import css from './HeaderActions.module.css'

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
