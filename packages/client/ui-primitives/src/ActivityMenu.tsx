/**
 * The session header's activity menus (background jobs, agents): a white pill
 * that opens the composer's popup card listing items, each of which unfolds
 * in place into a grouped details view with facts and disclosure cards.
 */
import {
  useEffect, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode,
} from 'react'
import clsx from 'clsx'
import type { BlockHeaderCopy } from './BlockHeader.tsx'
import { CopyIconButton } from './BlockHeader.tsx'
import { IconChevronDownOutline14, IconChevronLeftOutline14, IconChevronRightOutline14 } from './icons/index.tsx'
import { Spinner } from './Spinner.tsx'
import { StateDot } from './StateDot.tsx'
import { useDismissOnOutsidePointer } from './useDismissOnOutsidePointer.ts'
import css from './ActivityMenu.module.css'

/** Minimum gap kept between the popup and the viewport edges (the Menu primitive's portal margin). */
const VIEWPORT_MARGIN = 12

/** Props of {@link ActivityMenu}. */
export interface ActivityMenuProps {
  /** Whether the list is showing. */
  readonly open: boolean
  /** Requests a new open state (trigger press, outside press, Escape). */
  readonly onOpenChange: (open: boolean) => void
  /** The trigger's words, such as "1 job active". */
  readonly label: string
  /** Shows the loading mark in the trigger while something runs. */
  readonly busy: boolean
  /** Accessible name of the list. */
  readonly menuLabel: string
  /**
   * Suspends outside-press and Escape dismissal while a body-portaled dialog
   * above the list owns them.
   */
  readonly holdOpen?: boolean | undefined
  readonly children: ReactNode
}

/**
 * A header pill and its anchored popup list. The list stays inside the
 * viewport horizontally and closes on an outside press or Escape.
 * @param props - see {@link ActivityMenuProps}.
 * @returns the trigger and, while open, its list.
 */
export function ActivityMenu({ open, onOpenChange, label, busy, menuLabel, holdOpen = false, children }: ActivityMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLUListElement>(null)

  useDismissOnOutsidePointer(rootRef, open && !holdOpen, onOpenChange)

  useLayoutEffect(() => {
    if (!open) return
    const fit = (): void => {
      const menu = menuRef.current
      /* v8 ignore next -- the ref is attached while the open list renders. */
      if (menu === null) return
      // Measure where the stylesheet anchors the list (start or end of its
      // trigger), then shift it back inside the viewport if it crosses an edge.
      menu.style.setProperty('--activity-shift', '0px')
      const rect = menu.getBoundingClientRect()
      // Unlaid-out nodes (and jsdom) measure 0: keep the pure CSS anchor.
      if (rect.width === 0) return
      const overLeft = VIEWPORT_MARGIN - rect.left
      const overRight = rect.right - (window.innerWidth - VIEWPORT_MARGIN)
      const shift = overLeft > 0 ? overLeft : overRight > 0 ? -overRight : 0
      menu.style.setProperty('--activity-shift', `${shift}px`)
    }
    fit()
    window.addEventListener('resize', fit)
    return () => { window.removeEventListener('resize', fit) }
  }, [open])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    // A dialog above the list handles its own Escape; its React events bubble here.
    if (event.key !== 'Escape' || !open || holdOpen) return
    event.preventDefault()
    onOpenChange(false)
    triggerRef.current?.focus()
  }

  return (
    <div ref={rootRef} className={css.root} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className={css.trigger}
        aria-expanded={open}
        aria-label={label}
        onClick={() => { onOpenChange(!open) }}
      >
        {busy ? <Spinner className={css.triggerSpinner} /> : null}
        <span className={css.count}>{label}</span>
        <span className={clsx(css.triggerChevron, open && css.triggerChevronOpen)} aria-hidden>
          <IconChevronDownOutline14 size={12} />
        </span>
      </button>
      {open
        ? (
          <ul ref={menuRef} className={css.menu} aria-label={menuLabel}>
            {children}
          </ul>
        )
        : null}
    </div>
  )
}

/**
 * A header pill that navigates instead of opening a list (the way back to a
 * parent conversation), in the same material as {@link ActivityMenu}'s.
 * @param props.label - the pill's words.
 * @param props.onClick - the navigation.
 * @returns the pill.
 */
export function ActivityPill({ label, onClick }: { readonly label: string; readonly onClick: () => void }) {
  return (
    <button type="button" className={clsx(css.trigger, css.back)} onClick={onClick}>
      <IconChevronLeftOutline14 size={12} className={css.backChevron} />
      <span className={css.count}>{label}</span>
    </button>
  )
}

/** Props of {@link ActivitySection}. */
export interface ActivitySectionProps {
  /** The heading's words, such as "Finished". */
  readonly title: string
  /** Whether the section's items show. */
  readonly open: boolean
  readonly onToggle: () => void
  /** A trailing action, such as "Clear". */
  readonly action?: { readonly label: string; readonly onClick: () => void } | undefined
}

/**
 * A foldable section heading inside an {@link ActivityMenu} list.
 * @param props - see {@link ActivitySectionProps}.
 * @returns the heading list item.
 */
export function ActivitySection({ title, open, onToggle, action }: ActivitySectionProps) {
  return (
    <li className={css.sectionHeader}>
      <button type="button" className={css.sectionToggle} aria-expanded={open} onClick={onToggle}>
        {title}
        <IconChevronDownOutline14 className={clsx(css.sectionChevron, open && css.sectionChevronOpen)} />
      </button>
      {action !== undefined
        ? <button type="button" className={css.sectionAction} onClick={action.onClick}>{action.label}</button>
        : null}
    </li>
  )
}

/** A row's state marker: the loading mark while it runs, otherwise a still dot. */
export type ActivityState = 'running' | 'done' | 'stopped' | 'warning' | 'error'

/** Props of {@link ActivityItem}. */
export interface ActivityItemProps {
  /** The item's name, ellipsized in the closed row and in full once open. */
  readonly name: string
  readonly state: ActivityState
  /** How a settled item ended, shown after its name (closed row). */
  readonly status?: string | undefined
  /** The trailing time or figure (closed row). */
  readonly meta?: ReactNode
  /** Tooltip of {@link meta}. */
  readonly metaTitle?: string | undefined
  /** Whether the details show. */
  readonly open: boolean
  /** Toggles the details; absent renders a static row without details. */
  readonly onToggle?: (() => void) | undefined
  /** Accessible name of the toggle. */
  readonly toggleLabel?: string | undefined
  /** Marks the item the reader is currently viewing. */
  readonly current?: boolean | undefined
  /** A control after the row, such as a stop button (see {@link ActivityRowButton}). */
  readonly trailing?: ReactNode
  /** The details, rendered while open (see {@link ActivityDetails}). */
  readonly children?: ReactNode
}

/**
 * One list item: a closed row (marker, name, status, time, chevron), which
 * opens into a light group titled by the full name over its details.
 * @param props - see {@link ActivityItemProps}.
 * @returns the list item.
 */
export function ActivityItem({
  name, state, status, meta, metaTitle, open, onToggle, toggleLabel, current = false, trailing, children,
}: ActivityItemProps) {
  const expandable = onToggle !== undefined
  const opened = open && expandable
  const chevron = expandable
    ? (
      <span
        className={clsx(css.chevron, trailing === undefined && css.chevronEnd, opened && css.chevronOpen)}
        aria-hidden
      >
        <IconChevronDownOutline14 />
      </span>
    )
    : null
  // Opened, the row becomes the details' title: the full name alone, since
  // the state and the time are listed in the facts below it.
  const body = opened
    ? (
      <>
        <span className={clsx(css.label, css.labelOpen)}>{name}</span>
        <span className={css.spacer} />
        {chevron}
      </>
    )
    : (
      <>
        {state === 'running'
          ? <Spinner className={css.rowSpinner} />
          : (
            <StateDot
              state={state === 'stopped' ? 'done' : state}
              className={clsx(css.rowDot, state === 'stopped' && css.rowDotNeutral)}
            />
          )}
        <span className={clsx(css.label, current && css.labelCurrent)} title={name}>{name}</span>
        {status !== undefined ? <span className={css.status}>{status}</span> : null}
        <span className={css.spacer} />
        {meta !== undefined ? <span className={css.meta} title={metaTitle}>{meta}</span> : null}
        {chevron}
      </>
    )
  const rowClass = clsx(css.row, trailing !== undefined && css.rowWithTrailing)
  return (
    <li className={clsx(css.item, opened && css.itemOpen)}>
      <div className={css.rowLine}>
        {expandable
          ? (
            <button
              type="button"
              className={rowClass}
              aria-expanded={opened}
              aria-current={current || undefined}
              aria-label={toggleLabel}
              onClick={onToggle}
            >
              {body}
            </button>
          )
          : <span className={clsx(rowClass, css.rowStatic)}>{body}</span>}
        {trailing}
      </div>
      {opened ? children : null}
    </li>
  )
}

/** Props of {@link ActivityRowButton}. */
export interface ActivityRowButtonProps {
  /** Accessible name and tooltip. */
  readonly label: string
  readonly onClick: () => void
  readonly disabled?: boolean | undefined
  /** Draws the icon in the error colour, after a failed action. */
  readonly failed?: boolean | undefined
  /** The 12px icon. */
  readonly children: ReactNode
}

/**
 * A round icon control at the end of an {@link ActivityItem} row, with a
 * danger hover (a stop).
 * @param props - see {@link ActivityRowButtonProps}.
 * @returns the button.
 */
export function ActivityRowButton({ label, onClick, disabled = false, failed = false, children }: ActivityRowButtonProps) {
  return (
    <button
      type="button"
      className={clsx(css.rowButton, failed && css.rowButtonFailed)}
      disabled={disabled}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

/** One labelled fact in an item's details. */
export interface ActivityFact {
  readonly label: string
  readonly value: string
}

/**
 * An opened item's details: a two-column list of plain facts, then its cards.
 * @param props.facts - the facts, in reading order.
 * @param props.children - the cards ({@link ActivityCard}, {@link ActivityLink}).
 * @returns the details block.
 */
export function ActivityDetails({ facts, children }: { readonly facts: readonly ActivityFact[]; readonly children?: ReactNode }) {
  return (
    <div className={css.panel}>
      {facts.length > 0
        ? (
          <dl className={css.facts}>
            {facts.map(fact => (
              <div key={fact.label} className={css.fact}>
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
        )
        : null}
      {children !== undefined ? <div className={css.cards}>{children}</div> : null}
    </div>
  )
}

/** Props of {@link ActivityCard}. */
export interface ActivityCardProps {
  readonly title: string
  readonly open: boolean
  readonly onToggle: () => void
  /** What the header copies while the card is open; absent offers no copy. */
  readonly copy?: BlockHeaderCopy | undefined
  readonly children: ReactNode
}

/**
 * A white disclosure card in an item's details, whose header opens it.
 * @param props - see {@link ActivityCardProps}.
 * @returns the card.
 */
export function ActivityCard({ title, open, onToggle, copy, children }: ActivityCardProps) {
  return (
    <div className={css.card}>
      <div className={css.cardHeader}>
        <button type="button" className={css.cardToggle} aria-expanded={open} onClick={onToggle}>
          {title}
          <IconChevronDownOutline14 className={clsx(css.sectionChevron, open && css.sectionChevronOpen)} />
        </button>
        {open && copy !== undefined && copy.text !== '' ? <CopyIconButton {...copy} /> : null}
      </div>
      {open ? children : null}
    </div>
  )
}

/**
 * A white card that acts instead of opening, such as "Open conversation".
 * @param props.title - the action's words.
 * @param props.detail - an optional trailing value.
 * @param props.onClick - the action.
 * @returns the card button.
 */
export function ActivityLink({ title, detail, onClick }: {
  readonly title: string
  readonly detail?: string | undefined
  readonly onClick: () => void
}) {
  return (
    <button type="button" className={clsx(css.card, css.link)} onClick={onClick}>
      <span className={css.linkTitle}>{title}</span>
      {detail !== undefined ? <span className={css.linkDetail}>{detail}</span> : null}
      <IconChevronRightOutline14 className={css.linkChevron} />
    </button>
  )
}

/**
 * Code text in an {@link ActivityCard}: output or a command, wrapped and
 * scrolled at a fixed cap. A following block keeps the newest line in view
 * while the reader stays at its bottom.
 * @param props.text - the text.
 * @param props.note - an optional lead line in the quiet tone (a gap marker).
 * @param props.follow - keep the end in view as the text grows.
 * @param props.compact - the lower cap a command takes.
 * @returns the block.
 */
export function ActivityCode({ text, note, follow = false, compact = false }: {
  readonly text: string
  readonly note?: string | undefined
  readonly follow?: boolean | undefined
  readonly compact?: boolean | undefined
}) {
  const ref = useRef<HTMLPreElement>(null)
  const atEnd = useRef(true)
  useEffect(() => {
    const block = ref.current
    if (follow && block !== null && atEnd.current) block.scrollTop = block.scrollHeight
  }, [text, follow])
  return (
    <pre
      ref={ref}
      className={clsx(css.code, compact && css.codeCompact, 'no-scrollbar')}
      onScroll={(event) => {
        const block = event.currentTarget
        atEnd.current = block.scrollHeight - block.scrollTop - block.clientHeight < 8
      }}
    >
      {note !== undefined ? <span className={css.codeNote}>{note}{'\n'}</span> : null}
      {text}
    </pre>
  )
}

/**
 * A quiet line inside an {@link ActivityCard} (no output yet, an error).
 * @param props.error - the error tone.
 * @param props.children - the words.
 * @returns the line.
 */
export function ActivityNote({ error = false, children }: { readonly error?: boolean | undefined; readonly children: ReactNode }) {
  return <div className={clsx(css.note, error && css.noteError)}>{children}</div>
}

/**
 * A plain message line in an {@link ActivityMenu} list (loading, a failed
 * load), with an optional action such as "Retry".
 * @param props.error - the error tone.
 * @param props.action - the trailing action.
 * @param props.children - the words.
 * @returns the list item.
 */
export function ActivityMessage({ error = false, action, children }: {
  readonly error?: boolean | undefined
  readonly action?: { readonly label: string; readonly onClick: () => void } | undefined
  readonly children: ReactNode
}) {
  return (
    <li className={clsx(css.sectionHeader, error && css.noteError)}>
      <span>{children}</span>
      {action !== undefined
        ? <button type="button" className={css.sectionAction} onClick={action.onClick}>{action.label}</button>
        : null}
    </li>
  )
}
