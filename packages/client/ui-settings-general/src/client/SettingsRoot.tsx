/**
 * Settings shell root: the connection toast, the sidebar-foot spacing row,
 * and the centered modal panel (figma 501:29947, 1080x700) with the section
 * nav rail, which becomes a horizontal tab strip under the title row on
 * narrow viewports. The shell is
 * a pure composition face — every piece of text (panel title, close label,
 * sections) arrives from registrants through slots; accessible names resolve to
 * that content (dialog: aria-labelledby the title node; close: visually-hidden
 * slot text). No trigger sits in the sidebar: the panel opens on a
 * `settings/open` request from another surface.
 *
 * Whether the panel is open, and which section it shows, is the address bar's
 * state (`#!/settings/<section>`), read through the bound address hook and
 * moved through the injected commands: a nav click addresses the section the
 * reader picked, so each tab is a history entry and a link. The onboarding
 * coordinator mounts exactly one ordered registrant while the sessions-derived
 * empty-Hero fact is active. Visible dialog chrome belongs to the step, so a
 * mounted-but-deciding step paints nothing here.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import {
  ConnectionIndicator,
  IconCloseOutline16, IconCreditCardOutline16, IconDataOutline16, IconEnhanceOutline16,
  IconLightOutline16, IconPersonalizationOutline16, IconSettingsOutline16, IconThinkOutline16, IconUserOutline16,
} from '@aeven/client-ui-primitives'
import type { ConnectionIndicatorState } from '@aeven/client-ui-primitives'
import type { SettingsRootComponentProps, SettingsSectionRow } from './shell-contract.ts'
import css from './SettingsRoot.module.css'

const RECOVERY_CONFIRMATION_MS = 2_000

/** Nav glyph by section id; unknown ids fall back to the settings gear. */
function navIcon(id: string) {
  if (id === 'account') return <IconUserOutline16 className={css.navIcon} size={16} />
  if (id === 'appearance') return <IconLightOutline16 className={css.navIcon} size={16} />
  if (id === 'models') return <IconDataOutline16 className={css.navIcon} size={16} />
  if (id === 'personalization') return <IconEnhanceOutline16 className={css.navIcon} size={16} />
  if (id === 'plugins') return <IconPersonalizationOutline16 className={css.navIcon} size={16} />
  if (id === 'grok-build') return <IconCreditCardOutline16 className={css.navIcon} size={16} />
  if (id === 'memory') return <IconThinkOutline16 className={css.navIcon} size={16} />
  return <IconSettingsOutline16 className={css.navIcon} size={16} />
}

type PanelProps = {
  rows: readonly SettingsSectionRow[]
  renderSlot: SettingsRootComponentProps['renderSlot']
  activeId: string | undefined
  /** Page inside the addressed section; it applies only while that section is the one shown. */
  detail: string | undefined
  onSelect: (id: string, detail?: string) => void
  onClose: () => void
}

/**
 * The modal layer: full-viewport mask + centered panel, portaled to
 * `document.body` so it paints above the shell's corner controls and stays
 * visible while the sidebar that hosts the trigger is collapsed. Close paths:
 * the header button, a mask click, and document-level Escape (mounted only
 * while open, so the listener lifetime is the panel's).
 */
function SettingsPanel({ rows, renderSlot, activeId, detail: addressedDetail, onSelect, onClose }: PanelProps) {
  // Entries can unmount underneath the requested id, so the render-time
  // projection falls back to the first row when the id is gone.
  const active = rows.find(r => r.id === activeId)?.id ?? rows[0]?.id
  const detail = active === activeId ? addressedDetail : undefined
  const showDetail = useCallback((page?: string) => { if (active !== undefined) onSelect(active, page) }, [active, onSelect])
  const titleId = useId()

  // A section the reader has opened stays mounted: its wrapper keeps that
  // section's own state (scroll, query, expanded rows) together with the data
  // it already read, so returning to a tab never starts those reads again.
  const [visited, setVisited] = useState<readonly string[]>(active === undefined ? [] : [active])
  useEffect(() => {
    if (active === undefined) return
    setVisited(previous => previous.includes(active) ? previous : [...previous, active])
  }, [active])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [onClose])

  // Entering the dialog focuses the close button; the root restores its trigger on close.
  const closeButton = useRef<HTMLButtonElement | null>(null)
  useEffect(() => { closeButton.current?.focus() }, [])

  // The narrow-viewport tab strip scrolls horizontally, so a section opened
  // by id (onboarding's openSection) can start outside it.
  const navList = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    navList.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active])

  // The section scrolls under `no-scrollbar`, so no bar draws and no engine
  // takes width out of the section's right inset; what the padding gives back
  // is therefore already 0. The measurement stays the one place that decides
  // it, so the inset remains one page inset from the panel edge without
  // asserting a bar width the sheet no longer reserves.
  const options = useRef<HTMLDivElement | null>(null)
  const optionsBody = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    const scroller = options.current!
    const sync = () => {
      scroller.style.setProperty('--avn-settings-scrollbar', `${scroller.offsetWidth - scroller.clientWidth}px`)
    }
    const observer = new ResizeObserver(sync)
    observer.observe(scroller)
    observer.observe(optionsBody.current!)
    return () => { observer.disconnect() }
  }, [])

  return createPortal((
    <div className={css.overlay} role="presentation">
      <div className={css.mask} aria-hidden="true" onClick={onClose} />
      <div className={css.panel} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <nav className={css.nav}>
          <div className={css.navTitle} id={titleId}>{renderSlot('settings.header', {})}</div>
          <div ref={navList} className={css.navList}>
            {rows.map(row => (
              <button
                key={row.id}
                type="button"
                className={clsx(css.navCell, row.id === active && css.active)}
                aria-current={row.id === active ? 'true' : undefined}
                onClick={() => { onSelect(row.id) }}
              >
                {navIcon(row.id)}
                <span className={css.navLabel}>{row.label}</span>
              </button>
            ))}
          </div>
        </nav>
        <div className={css.content}>
          <div className={css.header}>
            <div className={css.actions}>{renderSlot('settings.action', { section: active, detail, showDetail })}</div>
            <button ref={closeButton} type="button" className={css.close} onClick={onClose}>
              <IconCloseOutline16 size={14} />
              <span className={css.hiddenLabel}>{renderSlot('settings.close', {})}</span>
            </button>
          </div>
          <div className={css.optionsFrame}>
            <div ref={options} className={clsx(css.options, 'no-scrollbar')}>
              <div ref={optionsBody}>
                {visited.map(id => (
                  <div key={id} className={id === active ? css.paneActive : css.pane}>
                    {renderSlot(
                      'settings.section',
                      {
                        close: onClose,
                        detail: id === active ? detail : undefined,
                        showDetail: (page?: string) => { onSelect(id, page) },
                      },
                      { only: id },
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  ), document.body)
}

/**
 * Render the connection toast, the sidebar-foot spacing row, and the settings panel.
 * @param props - composed slot props (contract/slots.ts).
 * @returns the settings shell element tree.
 */
export function SettingsRoot(props: SettingsRootComponentProps) {
  const {
    wide, reconnect, show, close, useConnectionState, useSections, useSettingsAddress, useOnboardingSteps,
    useSessions, renderSlot, t,
  } = props
  const address = useSettingsAddress(address => address)
  const open = address !== undefined
  const [completedOnboarding, setCompletedOnboarding] = useState<ReadonlySet<string>>(() => new Set())
  const [showRecovery, setShowRecovery] = useState(false)
  // A dismissed toast stays hidden for the rest of that outage; the next
  // healthy connection clears the dismissal.
  const [connectionDismissed, setConnectionDismissed] = useState(false)
  const openSection = useCallback((id: string) => { show(id) }, [show])

  // The ledger tick keeps the nav rows fresh: registrants re-register with
  // freshly localized text on locale change, and the trigger/header/close
  // seats re-render through their own outlets' subscriptions.
  const rows = useSections(s => s)
  const connectionState = useConnectionState(state => state)
  const previousConnectionState = useRef(connectionState)
  const onboardingSteps = useOnboardingSteps(s => s)
  const onboardingActive = useSessions(state =>
    state.phase === 'ready'
    && (state.current === undefined || state.byId[state.current]?.blank === true))
  const onboardingStep = onboardingActive
    ? onboardingSteps.find(step => !completedOnboarding.has(step.id))
    : undefined

  useEffect(() => {
    if (onboardingActive) return
    setCompletedOnboarding(new Set())
  }, [onboardingActive])

  useLayoutEffect(() => {
    const previous = previousConnectionState.current
    previousConnectionState.current = connectionState
    if (connectionState !== 'connected') {
      setShowRecovery(false)
      return
    }
    setConnectionDismissed(false)
    if (previous !== 'disconnected' && previous !== 'connecting') return
    setShowRecovery(true)
    const timeout = window.setTimeout(() => { setShowRecovery(false) }, RECOVERY_CONFIRMATION_MS)
    return () => { window.clearTimeout(timeout) }
  }, [connectionState])

  const completeOnboardingStep = useCallback((id: string) => {
    setCompletedOnboarding((previous) => {
      if (previous.has(id)) return previous
      return new Set([...previous, id])
    })
  }, [])

  const dismissConnection = () => {
    if (connectionState === 'connected') setShowRecovery(false)
    else setConnectionDismissed(true)
  }

  let connectionIndicator: ConnectionIndicatorState | undefined
  if (connectionDismissed) {
    connectionIndicator = undefined
  } else if (connectionState === 'disconnected') {
    connectionIndicator = 'disconnected'
  } else if (connectionState === 'connecting') {
    connectionIndicator = 'connecting'
  } else if (showRecovery) {
    connectionIndicator = 'recovered'
  }

  return (
    <>
      <div className={clsx(css.triggerRow, !wide && css.railRow)} />
      <ConnectionIndicator
        state={connectionIndicator}
        disconnectedLabel={t('connection.error')}
        reconnectLabel={t('connection.retry')}
        connectingLabel={t('connection.connecting')}
        recoveredLabel={t('connection.connected')}
        reconnectActionLabel={t('connection.reconnect')}
        restartActionLabel={t('connection.restart')}
        dismissLabel={t('close')}
        onReconnect={reconnect}
        onDismiss={dismissConnection}
      />
      {open && (
        <SettingsPanel
          rows={rows}
          renderSlot={renderSlot}
          activeId={address.section}
          detail={address.detail}
          onSelect={show}
          onClose={close}
        />
      )}
      {/* Dialog chrome and `#root` inert ownership live inside each step's
          visible branch. A step still deciding (private facts loading)
          renders null, so nothing paints or blocks while it decides. */}
      {onboardingStep !== undefined && renderSlot('settings.onboarding', {
        stepId: onboardingStep.id,
        complete: () => { completeOnboardingStep(onboardingStep.id) },
        openSection,
      }, { only: onboardingStep.id })}
    </>
  )
}
