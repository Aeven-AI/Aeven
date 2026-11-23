/**
 * The navigation band's options foldout: the first control of the Session
 * header's action cluster, immediately right of the fold control, so the Views
 * a Session can show are one press away from the control that folds the
 * browsing column.
 *
 * Rows name the Views the reader is not in, one per registered View: the entry
 * offers "View Trajectory" over the chat and "View Chat" over the ledger, and
 * reads whatever a deployment registers rather than a list of its own names.
 * Each row composes its text from that View's own localized tab label, so the
 * registered owner keeps naming the View.
 *
 * The foldout is the shared Menu primitive a Session row's options button
 * opens: same card, same dismissal.
 */
import { useState } from 'react'
import {
  Button, IconArchiveOutline20, IconBranchOutline16, IconDownloadOutline16, IconInspectOutline12, IconLucideEllipsisVertical,
  IconLucideFolder, IconLucideLaptopMinimal, IconLucideMessageCircle, Menu, Modal, Tooltip, type MenuEntry,
} from '@aeven/client-ui-primitives'
import type { WorkspaceId } from '@aeven/workspace/types'
import type { ReactNode } from 'react'
import type { SessionContinueTarget, SessionDevicePlacement, SessionMoveTarget } from '../contract/slots.ts'
import type { ViewTab } from '../contract/views.ts'
import type { ConversationSessionHeaderProps } from './ConversationSession.tsx'
import { DesktopChooser } from './DesktopChooser.tsx'
import css from './NavigationOptions.module.css'

/**
 * The mark each shipped View's row carries, by registered View id: the
 * trajectory affordance the tool rows already use to jump into the ledger, and
 * the chat bubble the sidebar's Chat row carries. A View another deployment
 * registers keeps its label alone.
 */
const VIEW_MARKS: Readonly<Record<string, ReactNode>> = {
  chat: <IconLucideMessageCircle className={css.rowIcon} />,
  trajectory: <IconInspectOutline12 size={16} className={css.rowIcon} />,
}

/** Menu-id prefix of a move destination row; the rest of the id is the Workspace id. */
const MOVE_PREFIX = 'move:'

/** What the band's options control needs from the Session it belongs to. */
export interface NavigationOptionsProps {
  /** Registered Conversation Views, in ring order. */
  views: readonly ViewTab[]
  /** View on screen now; undefined until the Session has activated one. */
  activeId: string | undefined
  /** Select one registered View. */
  onSelect: (view: string) => void
  /** Fork this Session at its last completed turn and open the child. */
  onFork: () => void
  /** Download this Session's complete history as a ZIP archive. */
  onExport: () => Promise<void>
  /** Archive this Session; absent hides the row, as for an archived Session. */
  onArchive: (() => void) | undefined
  /** Restore this archived Session; present only while it is archived, in place of archive. */
  onUnarchive: (() => void) | undefined
  /** Workspaces this Session can move into; empty hides the move row. */
  moveTargets: readonly SessionMoveTarget[]
  /** Whether a move cannot start now, such as while a turn runs. */
  moveDisabled: boolean
  /** Move this Session into one Workspace. */
  onMove: (workspaceId: WorkspaceId) => void
  /** The device moves this Host offers for this Session, read each time the options open. */
  devicePlacement: () => Promise<SessionDevicePlacement>
  /** Run this Session's next turns on this computer or on one of the account's desktops. */
  onContinueOn: (target: SessionContinueTarget) => Promise<void>
  /** The header's locale seat. */
  t: ConversationSessionHeaderProps['t']
}

/**
 * Render the band's options control.
 * @param props - the Session's own actions, the View roster, the View on screen, its selection, and the locale seat.
 * @returns the options anchor with its conditional foldout, or null when no View lies beyond the current one.
 */
export function NavigationOptions({
  views, activeId, onSelect, onFork, onExport, onArchive, onUnarchive, moveTargets, moveDisabled, onMove,
  devicePlacement, onContinueOn, t,
}: NavigationOptionsProps) {
  const [open, setOpen] = useState(false)
  // Read each time the options open, so a turn that ran on another device since shows its move.
  const [placement, setPlacement] = useState<SessionDevicePlacement>({})
  const [choosing, setChoosing] = useState(false)
  // A failed action opens a dialog until dismissed; a newer failure replaces the one showing.
  const [failure, setFailure] = useState<string | null>(null)
  const fail = (error: unknown): void => {
    setFailure(error instanceof Error ? error.message : String(error))
  }
  const toggle = (): void => {
    if (!open) void devicePlacement().then(setPlacement, () => { setPlacement({}) })
    setOpen(!open)
  }
  const runExport = (): void => {
    void onExport().catch(fail)
  }
  // The Session's own actions, in the order its row menu lists them (fork),
  // then the export, archive or unarchive as the row menu offers it, the
  // desktop choice, the move destinations and the other device moves, followed
  // by the Views the reader is not in.
  const items: MenuEntry[] = [
    { id: 'fork', label: t('nav.fork'), icon: <IconBranchOutline16 /> },
    { id: 'export', label: t('nav.export'), icon: <IconDownloadOutline16 /> },
    // 20-native glyph in the menu's 16px icon slot, as the row menu draws it.
    ...onArchive === undefined
      ? []
      : [{ id: 'archive', label: t('nav.archive'), icon: <IconArchiveOutline20 size={16} /> }],
    ...onUnarchive === undefined
      ? []
      : [{ id: 'unarchive', label: t('nav.unarchive'), icon: <IconArchiveOutline20 size={16} /> }],
    ...placement.desktops === undefined
      ? []
      : [{
        id: 'choose-desktop',
        label: t('nav.chooseDesktop'),
        icon: <IconLucideLaptopMinimal className={css.rowIcon} />,
        disabled: moveDisabled,
      }],
    ...moveTargets.length === 0
      ? []
      : [{
        id: 'move',
        label: t('nav.move'),
        icon: <IconLucideFolder className={css.rowIcon} />,
        disabled: moveDisabled,
        // The Menu opens a submenu on hover even over a disabled row, so a
        // disabled row carries none.
        ...moveDisabled
          ? {}
          : { submenu: moveTargets.map(target => ({ id: `${MOVE_PREFIX}${target.workspaceId}`, label: target.title })) },
      }],
    ...activeId === undefined
      ? []
      : views
        .filter(view => view.id !== activeId)
        .map(view => ({
          id: view.id,
          label: t('nav.view', { name: view.label }),
          ...VIEW_MARKS[view.id] === undefined ? {} : { icon: VIEW_MARKS[view.id] },
        })),
  ]
  const label = t('nav.options')
  return (
    <>
      <Menu
        open={open}
        onClose={() => { setOpen(false) }}
        items={items}
        onSelect={(id) => {
          setOpen(false)
          if (id === 'fork') onFork()
          else if (id === 'export') runExport()
          else if (id === 'archive') onArchive?.()
          else if (id === 'unarchive') onUnarchive?.()
          else if (id.startsWith(MOVE_PREFIX)) onMove(id.slice(MOVE_PREFIX.length) as WorkspaceId)
          else if (id === 'choose-desktop') setChoosing(true)
          // A remaining id is a View: the roster supplies exactly those.
          else onSelect(id)
        }}
        portal
        closeOnPointerLeave
        anchor={(
          <Tooltip label={label} side="bottom" anchor="icon">
            <button
              type="button"
              className={css.optionsButton}
              aria-label={label}
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={toggle}
            >
              <IconLucideEllipsisVertical className={css.optionsIcon} />
            </button>
          </Tooltip>
        )}
      />
      <DesktopChooser
        open={choosing}
        desktops={placement.desktops ?? []}
        onClose={() => { setChoosing(false) }}
        onChoose={(desktop) => {
          setChoosing(false)
          void onContinueOn(desktop.self ? { target: 'here' } : { target: 'desktop', device: desktop.device }).catch(fail)
        }}
        onRelease={() => {
          setChoosing(false)
          void onContinueOn({ target: 'here' }).catch(fail)
        }}
        t={t}
      />
      {failure !== null && (
        <Modal
          open
          onClose={() => { setFailure(null) }}
          closeLabel={t('error.close')}
          title={t('error.actionTitle')}
          description={failure}
          footer={<Button variant="primary" onClick={() => { setFailure(null) }}>{t('error.dismiss')}</Button>}
        />
      )}
    </>
  )
}
