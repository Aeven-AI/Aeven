/**
 * The model-provider row family: one outlined card per provider, with a name,
 * an optional tag and status dot, trailing actions, and a body for whatever the
 * row discloses. Every package that lists model providers renders through it,
 * so API-key and subscription providers read as one list.
 */
import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import clsx from 'clsx'
import { IconLucideCircleDot } from './icons/index.tsx'
import css from './ProviderRow.module.css'

/** A row's confirmed state: `ok` draws the success dot, `missing` the error dot. */
export interface ProviderRowStatus {
  tone: 'ok' | 'missing'
  /** Accessible name and tooltip of the dot. */
  label: string
}

/** Props of {@link ProviderRow}. */
export interface ProviderRowProps {
  /** The provider name. */
  name: string
  /** Caption-sized annotation beside the name; absent renders none. */
  tag?: string | undefined
  /** Status dot beside the name; absent renders none. */
  status?: ProviderRowStatus | undefined
  /** Trailing controls, usually {@link ProviderRowButton}s. */
  actions?: ReactNode
  /** Content under the head row: editors, sign-in steps, usage. */
  children?: ReactNode
}

/**
 * Render one provider row as a list item; place it inside {@link ProviderRowList}.
 * @param props - see {@link ProviderRowProps}.
 * @returns the `li` element.
 */
export function ProviderRow({ name, tag, status, actions, children }: ProviderRowProps) {
  return (
    <li className={css.row}>
      <div className={css.head}>
        <span className={css.identity}>
          <span className={css.name}>{name}</span>
          {tag !== undefined && <span className={css.tag}>{tag}</span>}
          {status === undefined
            ? null
            : (
              <span
                className={clsx(css.dot, status.tone === 'ok' ? css.dotOk : css.dotMissing)}
                role="img"
                aria-label={status.label}
                title={status.label}
              >
                {status.tone === 'ok' ? <IconLucideCircleDot /> : null}
              </span>
            )}
        </span>
        {actions == null ? null : <span className={css.actions}>{actions}</span>}
      </div>
      {children}
    </li>
  )
}

/**
 * Render the list that holds {@link ProviderRow}s, optionally under a group heading.
 * @param props.title - group heading, rendered as an `h3`; absent renders none.
 * @param props.description - supporting text under the heading.
 * @param props.children - the rows.
 * @returns the list, wrapped with its heading when one is given.
 */
export function ProviderRowList({ title, description, children }: {
  title?: string | undefined
  description?: string | undefined
  children?: ReactNode
}) {
  const list = <ul className={css.list}>{children}</ul>
  if (title === undefined) return list
  return (
    <section className={css.group}>
      <h3 className={css.groupTitle}>{title}</h3>
      {description !== undefined && <p className={css.groupDescription}>{description}</p>}
      {list}
    </section>
  )
}

/** Props of {@link ProviderRowButton}. */
export type ProviderRowButtonProps = {
  /** `danger` for destructive actions (default `default`). */
  tone?: 'default' | 'danger'
  className?: string | undefined
  children?: ReactNode
} & ButtonHTMLAttributes<HTMLButtonElement>

/** A dense row control; the ref reaches the native button so owners can move focus to it. */
export const ProviderRowButton = forwardRef<HTMLButtonElement, ProviderRowButtonProps>(
  function ProviderRowButton({ tone = 'default', className, children, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        className={clsx(css.button, tone === 'danger' ? css.danger : css.default, className)}
        {...rest}
      >
        {children}
      </button>
    )
  },
)
