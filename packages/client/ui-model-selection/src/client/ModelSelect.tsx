/**
 * ModelSelect: the composer's named model seat (`conversation.input.model`).
 * It is a two-level entry whose lists belong to the shared popupSelect shell:
 * the trigger opens a small chooser (Figma 496:26454's MenuDropdown) offering
 * Model and Effort, and each row opens its list through `commandUi.openSelect` —
 * the Model row opens the very spec `/model` registers, search included.
 *
 * The seat therefore owns the chooser and the trigger's label (Figma
 * 313:14108's ToggleButton: the model name in the secondary tone plus the
 * effective effort in the caption tone), and nothing else: no row builder, no
 * filtering, no failure surface. Data rides the per-session ModelDirectory, so
 * a switch made anywhere is what these labels show next.
 */
import {
  useEffect, useId, useRef, useState, useSyncExternalStore,
  type FocusEvent, type KeyboardEvent,
} from 'react'
import clsx from 'clsx'
import type { ModelReasoningEffort } from '@deepseek-ai/dsh-api-remotes/client'
import {
  IconChevronDownOutline14, IconChevronRightOutline14,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelSelectInjected } from './slots.ts'
import css from './ModelSelect.module.css'

/**
 * Render the composer model seat: the trigger and, while open, the Model/Effort chooser.
 * @param props - owner share (locked) + injected face (shared directory store,
 * its refresh, and the two shared-shell openers) + the standard locale seat.
 * @returns the trigger and the chooser.
 */
export function ModelSelect(
  { locked, available, directory, load, openModel, openEffort, t }:
  ModelSelectInjected & { locked: boolean } & PropsLocale<'model'>,
) {
  const state = useSyncExternalStore(
    fn => directory.subscribe(fn),
    () => directory.getSnapshot(),
  )
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const id = useId()

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    return () => { document.removeEventListener('mousedown', closeOutside) }
  }, [open])

  if (!available) return null

  // The current selection's catalog row supplies both the display name (a route
  // serving a model it stopped advertising keeps its raw id instead) and the
  // adapter-owned effort vocabulary; an unadvertised route offers no Effort row.
  const current = state.current
  const currentModel = current === null
    ? undefined
    : state.groups
      .find(group => group.id === current.provider)
      ?.models.find(model => model.id === current.model)
  const reasoning = currentModel?.reasoning
  const effectiveEffort = current?.reasoningEffort ?? reasoning?.defaultEffort
  const effortLabel = reasoning === undefined
    ? undefined
    : effectiveEffort === undefined
      ? t('effort.providerDefault')
      : reasoning.efforts.find((level: ModelReasoningEffort) => level.id === effectiveEffort)?.name
        ?? effectiveEffort

  const waiting = current === null && state.status === 'loading'
  const modelLabel = waiting
    ? t('trigger.loading')
    : currentModel?.name
      ?? (current === null ? t('trigger.fallback') : `${current.provider}/${current.model}`)
  const triggerLabel = effortLabel === undefined ? modelLabel : `${modelLabel} · ${effortLabel}`
  const triggerAria = waiting
    ? t('trigger.loading')
    : current === null
      ? t('trigger.selectAria')
      : effortLabel === undefined
        ? t('trigger.aria', { model: modelLabel })
        : t('trigger.ariaEffort', { model: modelLabel, effort: effortLabel })

  const show = (): void => {
    setOpen(true)
    load()
  }

  const close = (restoreFocus = false): void => {
    setOpen(false)
    if (restoreFocus) queueMicrotask(() => { triggerRef.current?.focus() })
  }

  /** Leave the chooser and hand over to the shared shell for one of its lists. */
  const drill = (next: () => void): void => {
    close()
    next()
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
      close(true)
      return
    }
    if (!open) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveFocus(event.key === 'ArrowDown' ? 1 : -1)
    }
  }

  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    if (event.relatedTarget instanceof Node && rootRef.current?.contains(event.relatedTarget)) return
    close()
  }

  itemRefs.current = []
  let itemIndex = 0
  const itemRef = () => {
    const at = itemIndex++
    return (node: HTMLButtonElement | null) => { itemRefs.current[at] = node }
  }

  return (
    <div ref={rootRef} className={css.root} onKeyDown={onRootKeyDown} onBlur={onBlur}>
      <button
        ref={triggerRef}
        type="button"
        className={css.trigger}
        aria-label={triggerAria}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        title={triggerLabel}
        disabled={locked}
        onClick={() => {
          if (open) {
            close()
          } else {
            show()
          }
        }}
      >
        <span className={css.triggerLabel}>{modelLabel}</span>
        {effortLabel !== undefined && <span className={css.triggerEffort}>{effortLabel}</span>}
        <IconChevronDownOutline14 className={clsx(css.chevron, open && css.chevronOpen)} />
      </button>

      {open && (
        <div
          id={`${id}-menu`}
          className={css.menu}
          role="menu"
          aria-label={t('menu.aria')}
        >
          <button
            ref={itemRef()}
            type="button"
            role="menuitem"
            className={css.cell}
            onClick={() => { drill(openModel) }}
          >
            <span className={css.cellLabel}>{t('menu.model')}</span>
            <span className={css.cellValue}>{modelLabel}</span>
            <IconChevronRightOutline14 className={css.cellChevron} />
          </button>
          {reasoning !== undefined && (
            <button
              ref={itemRef()}
              type="button"
              role="menuitem"
              className={css.cell}
              onClick={() => { drill(openEffort) }}
            >
              <span className={css.cellLabel}>{t('menu.effort')}</span>
              <span className={css.cellValue}>{effortLabel}</span>
              <IconChevronRightOutline14 className={css.cellChevron} />
            </button>
          )}
        </div>
      )}
    </div>
  )
}
