/**
 * Official popupSelect shell: renders one session's PopupSelectController
 * store into the conversation.input.overlay anchor. Unlike the slash menu
 * (combobox — textarea keeps focus), this shell HOLDS focus while open: the
 * inner search input takes focus, plain typing filters the loaded options
 * locally, Enter/↑↓ drive the filtered highlight (scrolled into view), Escape
 * dismisses back to the composer, and ←→ keep the search input's native
 * caret. Any pointer interaction outside the box dismisses (the click's own
 * target takes focus). Closed state renders null; the overlay slot stays
 * mounted. The card height clamps to the space above the composer.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useSyncExternalStore } from 'react'
import clsx from 'clsx'
import { RiskConfirmation, useAnchoredMaxHeight } from '@aeven/client-ui-primitives'
import type { PropsLocale } from '@aeven/client-ui-slots'
import { filterOptions } from './popup.ts'
import type { PopupSelectController } from './popup.ts'
import css from './PopupSelectView.module.css'

/** Design cap on the card height (same MenuDropdown family as the slash menu). */
const MAX_HEIGHT = 320

/** Injected business face of the popupSelect overlay entry. */
export interface PopupSelectInjected {
  /** The session's shell controller (state store + verbs; the view never touches the open-context type). */
  popup: PopupSelectController
}

/** Full shell props: injected face + the locale seat. */
export type PopupSelectViewProps = PopupSelectInjected & PropsLocale<'command'>

/**
 * Render the popupSelect shell overlay entry.
 * @param props - injected face: the session's shell controller; `t` rides the standard locale seat.
 * @returns the select card while open; null while closed.
 */
export function PopupSelectView({ popup, t }: PopupSelectViewProps) {
  const state = useSyncExternalStore(
    fn => popup.state.subscribe(fn),
    () => popup.state.getSnapshot(),
  )
  const cardRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  // The card is bottom-anchored above the composer; clamp the design cap to
  // the space above it, re-measured on every store update.
  const maxHeight = useAnchoredMaxHeight(cardRef, MAX_HEIGHT, state)
  const active = state.open ? state.active : null
  // A control-opened shell lines its trailing edge up with that control, so a
  // seat's picker sits under the seat instead of under the composer card. The
  // offset is measured against the card's own offset parent (the overlay
  // anchor) after mount and before paint, so the card never renders at the
  // composer's edge first and jumps.
  const [anchorInset, setAnchorInset] = useState<number | null>(null)
  useLayoutEffect(() => {
    const anchor = state.anchor
    const card = cardRef.current
    // The offset parent is the overlay anchor; `parentElement` is the same
    // element wherever the browser reports no offset parent at all.
    const parent = card?.offsetParent ?? card?.parentElement
    if (anchor === null || card === null || parent === null || parent === undefined || !anchor.isConnected) {
      setAnchorInset(null)
      return
    }
    const parentRect = parent.getBoundingClientRect()
    const anchorRect = anchor.getBoundingClientRect()
    setAnchorInset(Math.max(0, parentRect.right - anchorRect.right))
  }, [state.anchor, state.open, state.status, state.options])

  // The card is `max-content`, so filtering rows away would narrow it while the
  // reader is still typing — the box would jump under the text each keystroke.
  // It holds the widest width it has shown for this open instead, which keeps
  // the search input and the rows steady as the list grows and shrinks beneath
  // them; a fresh open measures again.
  const [minWidth, setMinWidth] = useState(0)
  useLayoutEffect(() => {
    if (!state.open) {
      setMinWidth(0)
      return
    }
    const card = cardRef.current
    if (card === null) return
    const width = card.getBoundingClientRect().width
    if (width > minWidth + 1) setMinWidth(width)
  }, [state.open, state.search, state.options, state.status, minWidth])

  // A pointer hover moves the highlight without moving the list. Revealing the
  // hovered row would scroll a row clipped by the viewport's edge fully into
  // view, which slides a different row under the cursor, which hovers, which
  // scrolls — the list would walk away from the pointer. Every other reason the
  // highlight moves (opening, typing, the arrow keys) still reveals its row.
  const pointerHighlight = useRef(false)
  useEffect(() => { pointerHighlight.current = false }, [state.open, state.search])
  // The search input keeps focus while arrows move a virtual highlight, so
  // the browser never scrolls the active row into view — do it here.
  useEffect(() => {
    if (active === null || pointerHighlight.current) return
    cardRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  // Focus ownership: the search input grabs on open, and ANY outside
  // pointer interaction dismisses —
  // capture phase so a click landing anywhere else (textarea included)
  // closes the shell before its own handlers run; that click's target then
  // takes focus naturally, so no focusComposer here.
  useEffect(() => {
    if (!state.open || state.confirming !== null) return
    const onPointerDown = (ev: PointerEvent): void => {
      if (cardRef.current !== null && ev.target instanceof Node && cardRef.current.contains(ev.target)) return
      popup.dismiss()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => { document.removeEventListener('pointerdown', onPointerDown, true) }
  }, [state.open, state.confirming, popup])

  // Focus the search input after it mounts (separate effect so the ref is populated).
  useEffect(() => {
    if (state.open && state.confirming === null) searchRef.current?.focus()
  }, [state.open, state.confirming])

  if (!state.open) return null

  const rows = filterOptions(state.options, state.search)
  const confirmation = state.confirming?.confirmation

  const onKeyDown = (ev: React.KeyboardEvent<HTMLDivElement>): void => {
    // ArrowLeft/ArrowRight fall through on purpose: the search input keeps
    // its native caret movement.
    switch (ev.key) {
      case 'ArrowDown':
        ev.preventDefault()
        pointerHighlight.current = false
        popup.move(1)
        return
      case 'ArrowUp':
        ev.preventDefault()
        pointerHighlight.current = false
        popup.move(-1)
        return
      case 'Enter':
        ev.preventDefault()
        void popup.select(state.active)
        return
      case 'Escape':
        ev.preventDefault()
        popup.dismiss({ focusComposer: true })
        return
      default:
    }
  }

  return (
    <>
      {state.confirming === null && (
        <div
          ref={cardRef}
          className={css.card}
          style={{
            maxHeight,
            minWidth: minWidth === 0 ? undefined : minWidth,
            ...anchorInset === null ? {} : { right: anchorInset, left: 'auto' },
          }}
          aria-label={t('overlay.aria', { command: String(state.command) })}
          onKeyDown={onKeyDown}
        >
          <input
            ref={searchRef}
            className={css.search}
            type="text"
            placeholder={t('search.placeholder')}
            aria-label={t('search.aria')}
            value={state.search}
            readOnly={state.submitting}
            onChange={(ev) => { popup.setSearch(ev.currentTarget.value) }}
          />
          {state.error !== null && (
            <div className={css.error} role="alert">
              <span className={css.errorText}>{state.error}</span>
              {state.status === 'failed' && (
                <button type="button" className={css.retry} onClick={() => { popup.retry() }}>{t('retry')}</button>
              )}
            </div>
          )}
          {state.status === 'pending' && <div className={css.status}>{t('status.loading')}</div>}
          {state.submitting && <div className={css.status}>{t('status.applying')}</div>}
          {state.status === 'ready' && rows.length === 0 && <div className={css.status}>{t('status.empty')}</div>}
          {state.status === 'ready' && (
            <div role="listbox" aria-label={t('listbox.aria', { command: String(state.command) })} className={clsx(css.viewport, 'no-scrollbar')}>
              {rows.map((option, index) => (
                <div
                  key={option.id}
                  role="option"
                  aria-selected={index === state.active}
                  // Two different facts wear the same treatment: `rowSelected`
                  // is the value the picker is on and stays put, `rowActive` is
                  // where the pointer or the arrow keys are right now.
                  className={clsx(
                    css.row,
                    option.active === true && css.rowSelected,
                    index === state.active && css.rowActive,
                  )}
                  // mousedown would race the document capture listener; the shell
                  // owns focus anyway, so a plain click (inside the card → no
                  // dismiss) works.
                  onClick={() => { void popup.select(index) }}
                  onMouseEnter={() => {
                    pointerHighlight.current = true
                    popup.highlight(index)
                  }}
                >
                  <span className={css.label}>{option.label}</span>
                  {option.detail !== undefined && <span className={css.detail}>{option.detail}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {confirmation !== undefined && (
        <RiskConfirmation
          open
          title={confirmation.title}
          description={confirmation.description}
          acknowledgeLabel={confirmation.acknowledgeLabel}
          cancelLabel={confirmation.cancelLabel}
          closeLabel={t('close')}
          confirmLabel={confirmation.confirmLabel}
          acknowledged={state.acknowledged}
          onAcknowledgedChange={(value) => { popup.acknowledge(value) }}
          onCancel={() => { popup.cancelConfirmation() }}
          onConfirm={() => { void popup.confirm() }}
        />
      )}
    </>
  )
}
