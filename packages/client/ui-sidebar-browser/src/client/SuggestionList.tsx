/**
 * The address bar's completion list: what the reader's engine answered for the
 * text typed so far. Picking an entry searches for it; the list holds no state,
 * so the selection stays with the address field and hovering a row parks that
 * selection on it through `onHover` rather than tinting a second row.
 */
import clsx from 'clsx'
import type { ReactNode } from 'react'
import css from './BrowserPane.module.css'

/** Props of the completion list. */
export interface SuggestionListProps {
  /** Completions in engine order. */
  readonly suggestions: readonly string[]
  /** Draft in the address field, whose prefix the rows read as already typed. */
  readonly query: string
  /** Index the keyboard has selected, or -1 for none. */
  readonly selected: number
  /** Ids tying each option to the address field's `aria-activedescendant`. */
  readonly listId: string
  readonly optionId: (index: number) => string
  /** Accessible name of the list. */
  readonly label: string
  /** Called with the index the pointer is over, so the field selects it. */
  readonly onHover: (index: number) => void
  /** Called with the picked index. */
  readonly onPick: (index: number) => void
}

/**
 * Split a completion into the prefix the reader typed and the remainder the
 * engine proposes. Matching is case-insensitive and anchored at the start,
 * which is where an engine echoes the typed text; a completion the draft is not
 * a prefix of stays whole, so nothing is dimmed that the reader cannot account
 * for.
 * @param text - the completion.
 * @param query - the draft in the address field.
 * @returns the typed prefix and the completion's remainder.
 */
function splitCompletion(text: string, query: string): { readonly lead: string; readonly tail: string } {
  const typed = query.trim().toLowerCase()
  if (typed === '' || !text.toLowerCase().startsWith(typed)) return { lead: text, tail: '' }
  return { lead: text.slice(0, typed.length), tail: text.slice(typed.length) }
}

/**
 * Render the completion list.
 * @param props - see {@link SuggestionListProps}.
 * @returns the list element tree, or null when there is nothing to offer.
 */
export function SuggestionList(props: SuggestionListProps): ReactNode {
  if (props.suggestions.length === 0) return null
  return (
    <ul className={clsx(css.suggestions, 'no-scrollbar')} role="listbox" id={props.listId} aria-label={props.label}>
      {props.suggestions.map((text, index) => {
        const { lead, tail } = splitCompletion(text, props.query)
        return (
          <li
            key={text}
            id={props.optionId(index)}
            role="option"
            aria-selected={index === props.selected}
            className={clsx(css.suggestion, index === props.selected && css.suggestionSelected)}
            onMouseEnter={() => { props.onHover(index) }}
            // Picking keeps the address field focused: the pointer never blurs it,
            // so the selection the reader sees is the one Enter would take.
            onMouseDown={(event) => {
              event.preventDefault()
              props.onPick(index)
            }}
          >
            <span className={css.suggestionText}>
              <span>{lead}</span>
              <span className={css.suggestionTail}>{tail}</span>
            </span>
          </li>
        )
      })}
    </ul>
  )
}
