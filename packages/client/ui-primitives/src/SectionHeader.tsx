/** The heading block every settings section opens with. */
import type { ReactNode } from 'react'
import css from './SectionHeader.module.css'

/**
 * Render a section's title and optional description in the one settings
 * heading style, so sections contributed by different packages match.
 * @param props.title - the section heading, rendered as an `h2`.
 * @param props.description - supporting text under the title; absent renders none.
 * @returns the header element.
 */
export function SectionHeader({ title, description }: {
  title: ReactNode
  description?: ReactNode
}) {
  return (
    <header className={css.header}>
      <h2 className={css.title}>{title}</h2>
      {description !== undefined && <p className={css.description}>{description}</p>}
    </header>
  )
}
