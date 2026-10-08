/** The composer's Options popup: the settings-2 disc opens a card whose rows
 * carry the permission mode and the context occupancy. Each row opens its own
 * card beside the open popup — the popup itself stays open, so a mode is picked
 * while the row it belongs to is still on screen. */

import { useEffect, useRef, useState } from 'react'
import type { MouseEvent, ReactNode, RefObject } from 'react'
import clsx from 'clsx'
import type { PermissionSelect as PermissionSelectValue } from '@aeven/permission-presets/client'
import {
  IconChevronRightOutline14, IconLucideImages, IconLucideSettings2, IconLucidePlay,
  RiskConfirmation, Tooltip, useDismissOnOutsidePointer,
} from '@aeven/client-ui-primitives'
import type { UseProjection } from '@aeven/api-session-controller/client'
// Type-only: the `contextPressure` / `contextBreakdown` projection key merges.
import type {} from '@aeven/token-meter/client'
import type { ComposerBarProps } from '../contract/slots.ts'
import { contextOccupancy } from '../context-occupancy.ts'
import { ContextActions, ContextPanel, ContextRing } from './ContextMeter.tsx'
import { FULL_ACCESS, PermissionList, permissionGlyph, permissionLabel } from './PermissionOptions.tsx'
import css from './ComposerOptions.module.css'

/** Which row's card is showing beside the popup; null while none is open. */
type Pane = 'permissions' | 'context'

/**
 * One row of the popup: leading glyph, name, trailing chevron. The row keeps
 * the accessible name of the control it replaced, which states the current
 * value in the locale's own sentence.
 */
function OptionsRow({ glyph, label, ariaLabel, opens = false, open = false, disabled = false, keepFocus, onToggle }: {
  glyph?: ReactNode
  label: string
  ariaLabel: string
  /** Whether the row discloses a card beside the popup; it drives the row's ARIA state, not its chevron. */
  opens?: boolean
  open?: boolean
  disabled?: boolean
  keepFocus: (event: MouseEvent<HTMLButtonElement>) => void
  /** Receives the row's own control: a row that opens a card elsewhere anchors it there. */
  onToggle: (trigger: HTMLButtonElement) => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={clsx(css.row, open && css.rowOpen)}
      aria-label={ariaLabel}
      aria-haspopup={opens ? 'menu' : undefined}
      aria-expanded={opens ? open : undefined}
      disabled={disabled}
      onMouseDown={keepFocus}
      onClick={(event) => { onToggle(event.currentTarget) }}
    >
      {glyph !== undefined && <span className={css.rowIcon} aria-hidden>{glyph}</span>}
      <span className={css.rowLabel}>{label}</span>
      <span className={css.rowChevron} aria-hidden>
        <IconChevronRightOutline14 />
      </span>
    </button>
  )
}

export interface ComposerOptionsProps {
  /** Host-computed permission modes; absent on a permission-less host or a Draft. */
  permissions: PermissionSelectValue | undefined
  locked: boolean
  /** Command face; absent with the session, so the popup offers no mode pick. */
  command: ((line: string) => Promise<boolean>) | undefined
  /**
   * Opens the host's image-model picker, anchored to the row that asked; absent
   * when the bar has no command face.
   */
  onImageModel: ((anchor: Element) => void) | undefined
  /** Opens the host video-model picker beside its row; absent without a command face. */
  onVideoModel: ((anchor: Element) => void) | undefined
  useProjection: UseProjection
  /** The bar's pointerdown guard, so opening the popup or a row keeps the draft focused. */
  keepFocus: (event: MouseEvent<HTMLButtonElement>) => void
  /**
   * The composer's overlay seat, where a picker opened from a row renders. A
   * press inside it belongs to a popup this popup opened, so it does not
   * dismiss this one: the row keeps the popup it came from open while its
   * picker is in use.
   */
  overlayRef: RefObject<HTMLElement | null>
  /** The owning bar's locale seat, passed down as a plain prop. */
  t: ComposerBarProps['t']
}

export function ComposerOptions({
  permissions, locked, command, onImageModel, onVideoModel, useProjection, keepFocus, overlayRef, t,
}: ComposerOptionsProps) {
  const [open, setOpen] = useState(false)
  const [pane, setPane] = useState<Pane | null>(null)
  const [details, setDetails] = useState(false)
  const [pick, setPick] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<string | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)
  const context = contextOccupancy(useProjection('contextPressure'))
  const breakdown = useProjection('contextBreakdown')

  useDismissOnOutsidePointer(rootRef, open, setOpen, overlayRef)
  useEffect(() => {
    if (!open) setPane(null)
    setDetails(false)
  }, [open])
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [open])

  // A locked composer, a withdrawn projection, or a mode already on its way
  // through the command face leaves nothing to pick: the card closes rather
  // than offering a choice that cannot land.
  const pickable = permissions !== undefined && command !== undefined && !locked
  useEffect(() => {
    if (pickable || confirmation !== null) return
    setAcknowledged(false)
    setPane(current => (current === 'permissions' ? null : current))
  }, [confirmation, pickable])
  // A model switch can withdraw the capacity the reading is drawn from while
  // this popup stays mounted: drop the now-empty row with its card.
  useEffect(() => {
    if (context !== null) return
    setPane(current => (current === 'context' ? null : current))
    setDetails(false)
  }, [context])

  const submit = (id: string): void => {
    if (command === undefined) return
    setPick(id)
    void command(`/permission ${id}`)
      .catch(() => false)
      .then(() => { setPick(null) })
  }

  const choose = (id: string): void => {
    setPane(null)
    if (permissions === undefined || id === permissions.currentValue) return
    if (id === FULL_ACCESS) {
      setAcknowledged(false)
      setConfirmation(id)
      return
    }
    submit(id)
  }

  const closeConfirmation = (): void => {
    setAcknowledged(false)
    setConfirmation(null)
  }

  const currentValue = pick ?? permissions?.currentValue ?? ''
  const current = permissions?.options.find(option => option.value === currentValue)
  const currentLabel = current === undefined
    ? permissionLabel(currentValue, currentValue, t)
    : permissionLabel(current.value, current.name, t)
  const busy = pick !== null || confirmation !== null

  // Nothing to hold: a composer with none of the popup's rows keeps the disc
  // off the row rather than opening an empty card.
  if (permissions === undefined && context === null
    && onImageModel === undefined && onVideoModel === undefined) return null

  return (
    <span ref={rootRef} className={css.root}>
      <Tooltip label={t('input.options')} side="top-start" disabled={open}>
        <button
          type="button"
          className={css.disc}
          aria-label={t('input.options')}
          aria-haspopup="menu"
          aria-expanded={open}
          onMouseDown={keepFocus}
          onClick={() => { setOpen(!open) }}
        >
          <IconLucideSettings2 />
        </button>
      </Tooltip>
      {open && (
        <div className={css.card} role="menu" aria-label={t('input.options')}>
          {context === null ? null : (
            <div className={css.rowSeat}>
              <OptionsRow
                glyph={<ContextRing percent={context.percent} />}
                label={`${context.percent}%`}
                ariaLabel={t('context.aria', { percent: `${context.percent}%` })}
                opens
                open={pane === 'context'}
                keepFocus={keepFocus}
                onToggle={() => { setPane(current => (current === 'context' ? null : 'context')) }}
              />
              {pane === 'context' && !details && (
                <div className={css.pane} role="menu">
                  <ContextActions
                    t={t}
                    onCompact={() => {
                      setOpen(false)
                      void command?.('/compact').catch(() => false)
                    }}
                    onDetails={() => { setDetails(true) }}
                  />
                </div>
              )}
              {pane === 'context' && details && (
                <div className={clsx(css.pane, css.paneDetails)} role="dialog" aria-label={t('context.used')}>
                  <ContextPanel context={context} breakdown={breakdown} t={t} />
                </div>
              )}
            </div>
          )}
          {onImageModel === undefined ? null : (
            <OptionsRow
              glyph={<IconLucideImages className={css.rowGlyph} />}
              label={t('options.imageModel')}
              ariaLabel={t('options.imageModel')}
              keepFocus={keepFocus}
              onToggle={(trigger) => { onImageModel(trigger) }}
            />
          )}
          {onVideoModel === undefined ? null : (
            <OptionsRow
              glyph={<IconLucidePlay className={css.rowGlyph} />}
              label={t('options.videoModel')}
              ariaLabel={t('options.videoModel')}
              keepFocus={keepFocus}
              onToggle={(trigger) => { onVideoModel(trigger) }}
            />
          )}
          {permissions === undefined ? null : (
            <div className={css.rowSeat}>
              <OptionsRow
                glyph={permissionGlyph(currentValue)}
                label={currentLabel}
                ariaLabel={t('input.accessMode', { name: currentLabel })}
                opens
                open={pane === 'permissions'}
                keepFocus={keepFocus}
                disabled={!pickable || busy}
                onToggle={() => { setPane(current => (current === 'permissions' ? null : 'permissions')) }}
              />
              {pane === 'permissions' && (
                <div className={css.pane} role="menu">
                  <PermissionList
                    options={permissions.options}
                    current={currentValue}
                    disabled={!pickable || busy}
                    t={t}
                    onSelect={choose}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}
      <RiskConfirmation
        open={confirmation !== null}
        title={t('access.confirm.title')}
        description={t('access.confirm.description')}
        acknowledgeLabel={t('access.confirm.acknowledge')}
        cancelLabel={t('access.confirm.cancel')}
        closeLabel={t('close')}
        confirmLabel={t('access.confirm.enable')}
        acknowledged={acknowledged}
        disabled={locked}
        onAcknowledgedChange={setAcknowledged}
        onCancel={closeConfirmation}
        onConfirm={() => {
          if (locked || !acknowledged || confirmation === null) return
          const id = confirmation
          closeConfirmation()
          submit(id)
        }}
      />
    </span>
  )
}
