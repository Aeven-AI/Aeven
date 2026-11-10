/**
 * The "Continue on a desktop" dialog the options foldout opens on an always-on
 * Host such as Aeven Web: one row per desktop of the account, with whether its
 * relay connection is open now, and a press moves the Session's next turns to
 * that desktop.
 */
import { useMemo } from 'react'
import { IconLucideLaptopMinimal, IconLucideMonitorCheck, Modal, relativeTime } from '@aeven/client-ui-primitives'
import type { SessionDesktop } from '../contract/slots.ts'
import type { ConversationSessionHeaderProps } from './ConversationSession.tsx'
import css from './DesktopChooser.module.css'

/** What the dialog needs from the options foldout. */
export interface DesktopChooserProps {
  /** Whether the dialog shows. */
  open: boolean
  /** The account's desktops, present ones first. */
  desktops: readonly SessionDesktop[]
  /** Escape, mask press, or the close control. */
  onClose: () => void
  /**
   * Move the Session's next turns to one desktop.
   * @param device - its device id.
   */
  onChoose: (device: string) => void
  /** The header's locale seat. */
  t: ConversationSessionHeaderProps['t']
}

/**
 * The status line under one desktop's name.
 * @param desktop - the desktop.
 * @param now - current epoch ms.
 * @param t - the header's locale seat.
 * @returns "Online", "Last seen …", or "Offline" when it never stamped its connection.
 */
function status(desktop: SessionDesktop, now: number, t: DesktopChooserProps['t']): string {
  if (desktop.present) return t('desktops.online')
  if (desktop.seenAt === undefined) return t('desktops.offline')
  const { unit, n } = relativeTime(desktop.seenAt, now)
  const count = { n: String(n) }
  switch (unit) {
    case 'now': return t('desktops.seen', { when: t('desktops.time.now') })
    case 'minutes': return t('desktops.seen', { when: t('desktops.time.minutes', count) })
    case 'hours': return t('desktops.seen', { when: t('desktops.time.hours', count) })
    case 'days': return t('desktops.seen', { when: t('desktops.time.days', count) })
    case 'months': return t('desktops.seen', { when: t('desktops.time.months', count) })
    case 'years': return t('desktops.seen', { when: t('desktops.time.years', count) })
  }
}

/**
 * Render the desktop chooser.
 * @param props - the desktops, the dialog's open state, its close and choose actions, and the locale seat.
 * @returns the dialog, or null while closed.
 */
export function DesktopChooser({ open, desktops, onClose, onChoose, t }: DesktopChooserProps) {
  // Dated once per opening, so the status lines stay put while the dialog shows.
  const now = useMemo(() => Date.now(), [open])
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('desktops.title')}
      description={t('desktops.description')}
      closeLabel={t('desktops.close')}
    >
      {desktops.length === 0
        ? <p className={css.empty}>{t('desktops.empty')}</p>
        : (
          <ul className={css.list}>
            {desktops.map(desktop => (
              <li key={desktop.device}>
                <button
                  type="button"
                  className={css.row}
                  disabled={desktop.home}
                  aria-current={desktop.home ? 'true' : undefined}
                  onClick={() => { onChoose(desktop.device) }}
                >
                  <IconLucideLaptopMinimal className={css.icon} />
                  <span className={css.text}>
                    <span className={css.name}>{desktop.name === '' ? t('desktops.unnamed') : desktop.name}</span>
                    <span className={css.status} data-present={desktop.present ? '' : undefined}>
                      {status(desktop, now, t)}
                    </span>
                  </span>
                  {desktop.home && (
                    <span className={css.current} role="img" aria-label={t('desktops.current')}>
                      <IconLucideMonitorCheck className={css.icon} />
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
    </Modal>
  )
}
