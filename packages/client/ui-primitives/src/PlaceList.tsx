/**
 * The rows of a dialog that chooses where work runs: one row per place, such as Aeven Cloud or one of the account's
 * desktops, with its name, a status line, and a mark on the current place.
 */
import type { ReactNode } from 'react'
import { IconLucideMonitorCheck } from './icons/index.tsx'
import css from './PlaceList.module.css'

/** One place a row offers. */
export interface PlaceListItem {
  /** Stable key of the place. */
  readonly id: string
  /** Glyph before the name, sized by the list. */
  readonly icon: (props: { className?: string | undefined }) => ReactNode
  readonly name: string
  /** The line under the name. */
  readonly status: string
  /** Whether the status line reads as a live connection. */
  readonly present?: boolean
  /** Whether the work runs here now; the row carries the list's current mark. */
  readonly current?: boolean
  /** Whether the press is off; the row stays legible. */
  readonly disabled?: boolean
}

/** What the list needs from its dialog. */
export interface PlaceListProps {
  readonly items: readonly PlaceListItem[]
  /**
   * Press on one row.
   * @param item - the pressed row's place.
   */
  readonly onChoose: (item: PlaceListItem) => void
  /** Accessible name of the current mark. */
  readonly currentLabel: string
}

/**
 * Render the place rows.
 * @param props - the places, the press action, and the current mark's name.
 * @returns the list.
 */
export function PlaceList({ items, onChoose, currentLabel }: PlaceListProps) {
  return (
    <ul className={css.list}>
      {items.map(item => (
        <li key={item.id}>
          <button
            type="button"
            className={css.row}
            disabled={item.disabled === true}
            aria-current={item.current === true ? 'true' : undefined}
            onClick={() => { onChoose(item) }}
          >
            <item.icon className={css.icon} />
            <span className={css.text}>
              <span className={css.name}>{item.name}</span>
              <span className={css.status} data-present={item.present === true ? '' : undefined}>{item.status}</span>
            </span>
            {item.current === true && (
              <span className={css.current} role="img" aria-label={currentLabel}>
                <IconLucideMonitorCheck className={css.icon} />
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  )
}

/** Class of the list's empty-state paragraph, for a dialog with no place to offer. */
export const placeListEmptyClass = css.empty
