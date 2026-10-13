/**
 * ModelSelect: the composer's model seat (`conversation.input.model`), an
 * icon-only control on the composer's own 40px disc — the current model and
 * effort are the card's own first row rather than the trigger's label, so the
 * row keeps one control width whatever the catalog names. Hovering names the
 * seat in the shared tooltip instead of opening it, as the Options disc beside
 * it does; the card opens on a press, or on the trigger's own focus for the
 * seat's keyboard path, and closes on the press after that, on a press
 * outside, on focus leaving, or on Escape.
 * Two levels, each keeping the picker its list fits:
 *
 * - the Model row hands over to the shared popupSelect shell, so the composer
 *   button and the `/model` line open one searchable catalog list;
 * - the Effort row opens the seat's own pane (Figma 496:26454's drilled list),
 *   because an adapter advertises three or four levels that are all on screen
 *   at once — a search input would cost the card a row of height and filter
 *   nothing a reader could not pick by eye. The pane and the selection it
 *   submits read ONE derivation (`effort.ts`), so it cannot offer a level the
 *   adapter does not serve.
 *
 * The seat owns the chooser, the trigger's tooltip, and the trigger's
 * accessible name (the model name and the effective effort), and nothing else.
 * Data rides the per-session ModelDirectory, so a switch made anywhere is what
 * these labels show next.
 */
import {
  useEffect, useId, useRef, useState, useSyncExternalStore,
  type FocusEvent, type KeyboardEvent,
} from 'react'
import clsx from 'clsx'
import {
  IconCheckOutline16, IconChevronRightOutline14, IconLucideDatabaseCheck,
  IconWarningOutline16, Toast, Tooltip,
} from '@aeven/client-ui-primitives'
import type { PropsLocale } from '@aeven/client-ui-slots'
import { effectiveEffortOf, effortLevelsOf, type EffortLevel } from './effort.ts'
import type { ModelSelectInjected } from './slots.ts'
import css from './ModelSelect.module.css'

/** Which pane the seat's card shows: the two-cell root or the drilled effort list. */
type Pane = 'root' | 'effort'

/**
 * Render the composer model seat: the trigger and, while open, its card.
 * @param props - owner share (locked) + injected face (shared directory store,
 * its refresh, the shell opener, and the effort submit verb) + the standard
 * locale seat.
 * @returns the trigger and the card.
 */
export function ModelSelect(
  { locked, available, directory, load, openModel, selectEffort, t }:
  ModelSelectInjected & { locked: boolean } & PropsLocale<'model'>,
) {
  const state = useSyncExternalStore(
    fn => directory.subscribe(fn),
    () => directory.getSnapshot(),
  )
  const [open, setOpen] = useState(false)
  // Whether a press has claimed the open card. The trigger's own focus opens
  // the card ahead of the click of that same press, so the click claims the
  // card instead of reading as the press that closes it.
  const [claimed, setClaimed] = useState(false)
  const [pane, setPane] = useState<Pane>('root')
  // A refused selection announces through the shared transient Toast anchored
  // to the composer card; catalog-load failures keep the shell's own retry
  // strip, which the Model row shows.
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)
  const toastSeq = useRef(0)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const modelRowRef = useRef<HTMLButtonElement | null>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const id = useId()

  // A picker this seat's rows open renders in the composer's overlay seat, not
  // inside the seat's own card: presses and focus there belong to that picker,
  // so they neither dismiss the card nor count as leaving it.
  const inOverlaySeat = (node: Node | null): boolean => {
    if (node === null) return false
    const seat = rootRef.current
      ?.closest<HTMLElement>('[data-composer-card]')
      ?.querySelector('[data-slot="conversation.input.overlay"]')
    return seat?.contains(node) === true
  }

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: MouseEvent): void => {
      const target = event.target as Node
      if (rootRef.current?.contains(target) === true || inOverlaySeat(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    return () => { document.removeEventListener('mousedown', closeOutside) }
  }, [open])

  if (!available) return null

  // The current selection's catalog row supplies the display name (a route
  // serving a model it stopped advertising keeps its raw id instead); the
  // levels and the effort in force come from `effort.ts`, so the pane renders
  // exactly the levels a pick can resolve to, and no Effort row appears for an
  // adapter that advertises no level at all.
  const current = state.current
  const currentModelName = current === null
    ? undefined
    : state.groups
      .find(group => group.id === current.provider)
      ?.models.find(model => model.id === current.model)?.name
  const levels = effortLevelsOf(state)
  const effectiveEffort = effectiveEffortOf(state)
  const effortLabel = levels.length === 0
    ? undefined
    : levels.find(level => level.effort === effectiveEffort)?.name ?? t('effort.providerDefault')

  const waiting = current === null && state.status === 'loading'
  const modelLabel = waiting
    ? t('trigger.loading')
    : currentModelName
      ?? (current === null ? t('trigger.fallback') : `${current.provider}/${current.model}`)
  const triggerAria = waiting
    ? t('trigger.loading')
    : current === null
      ? t('trigger.selectAria')
      : effortLabel === undefined
        ? t('trigger.aria', { model: modelLabel })
        : t('trigger.ariaEffort', { model: modelLabel, effort: effortLabel })
  const busy = state.status === 'selecting'

  const show = (): void => {
    setPane('root')
    setOpen(true)
    load()
  }

  const close = (restoreFocus = false): void => {
    setOpen(false)
    setClaimed(false)
    setPane('root')
    if (restoreFocus) queueMicrotask(() => { triggerRef.current?.focus() })
  }

  /** Open from the trigger's own focus: the seat's keyboard path onto the card. */
  const openFromFocus = (): void => {
    if (!open) show()
  }

  const moveFocus = (offset: number): void => {
    const items = itemRefs.current.filter(item => item !== null)
    if (items.length === 0) return
    const active = items.findIndex(item => item === document.activeElement)
    const next = (Math.max(active, 0) + offset + items.length) % items.length
    items[next]?.focus()
  }

  const onRootKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      // Escape backs out of the drilled pane first, then closes.
      if (pane !== 'root') setPane('root')
      else close(true)
      return
    }
    if (!open) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveFocus(event.key === 'ArrowDown' ? 1 : -1)
    }
  }

  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    if (event.relatedTarget instanceof Node
      && (rootRef.current?.contains(event.relatedTarget) === true || inOverlaySeat(event.relatedTarget))) return
    close()
  }

  /**
   * Back to the seat's rows after an effort pick. The card stays open — the
   * pick changed what its Effort row states — and the picked row unmounts with
   * the pane, so the trigger takes the focus back to keep the card alive.
   */
  const returnToRows = (): void => {
    setPane('root')
    queueMicrotask(() => { triggerRef.current?.focus() })
  }

  const chooseEffort = (level: EffortLevel): void => {
    if (level.effort === effectiveEffort) {
      returnToRows()
      return
    }
    void selectEffort(level.id).then((accepted) => {
      if (accepted) {
        returnToRows()
        return
      }
      const message = directory.getSnapshot().error
      if (message !== null) {
        toastSeq.current += 1
        setToast({ seq: toastSeq.current, text: t('error.action', { message }) })
      }
    })
  }

  itemRefs.current = []
  let itemIndex = 0
  const itemRef = () => {
    const at = itemIndex++
    return (node: HTMLButtonElement | null) => { itemRefs.current[at] = node }
  }
  const modelCellRef = itemRef()

  return (
    <div
      ref={rootRef}
      className={css.root}
      onKeyDown={onRootKeyDown}
      onBlur={onBlur}
    >
      <Tooltip label={t('trigger.tooltip')} side="top" disabled={open}>
        <button
          ref={triggerRef}
          type="button"
          className={css.trigger}
          aria-label={triggerAria}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? `${id}-menu` : undefined}
          disabled={locked}
          onFocus={openFromFocus}
          onClick={() => {
            // The press after the one that opened the card closes it.
            if (claimed) {
              close()
              return
            }
            setClaimed(true)
            if (!open) show()
          }}
        >
          <IconLucideDatabaseCheck />
        </button>
      </Tooltip>

      {open && (
        <div
          id={`${id}-menu`}
          className={css.menu}
          role="menu"
          aria-label={t('menu.aria')}
          aria-busy={state.status === 'loading' || busy}
        >
          {pane === 'root' && (
            <>
              <button
                ref={(node) => {
                  modelCellRef(node)
                  modelRowRef.current = node
                }}
                type="button"
                role="menuitem"
                className={css.cell}
                onClick={() => {
                  // The shell owns that list; the row hands the seat its own
                  // control, so the list opens beside this card rather than at
                  // the composer's edge — and the card stays open around it.
                  openModel(modelRowRef.current)
                }}
              >
                <span className={css.cellLabel}>{t('menu.model')}</span>
                <span className={css.cellValue}>{modelLabel}</span>
                <IconChevronRightOutline14 className={css.cellChevron} />
              </button>
              {levels.length > 0 && (
                <button
                  ref={itemRef()}
                  type="button"
                  role="menuitem"
                  className={css.cell}
                  onClick={() => { setPane('effort') }}
                >
                  <span className={css.cellLabel}>{t('menu.effort')}</span>
                  <span className={css.cellValue}>{effortLabel}</span>
                  <IconChevronRightOutline14 className={css.cellChevron} />
                </button>
              )}
            </>
          )}

          {pane === 'effort' && levels.map((level) => {
            const selected = level.effort === effectiveEffort
            const label = level.name ?? t('effort.providerDefault')
            return (
              <button
                ref={itemRef()}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                className={clsx(css.option, selected && css.selected)}
                key={level.id}
                title={label}
                disabled={busy}
                onClick={() => { chooseEffort(level) }}
              >
                <span className={css.optionCopy}>
                  <span className={css.optionName}>{label}</span>
                </span>
                <span className={css.check}>
                  {selected ? <IconCheckOutline16 /> : null}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {toast !== null && (
        <Toast
          key={toast.seq}
          text={toast.text}
          icon={<IconWarningOutline16 />}
          anchor={rootRef.current?.closest<HTMLElement>('[data-composer-card]') ?? null}
          onDone={() => { setToast(null) }}
        />
      )}
    </div>
  )
}
