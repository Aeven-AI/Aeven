/** The leading mark of a failed or interrupted row in the conversation's work log. */
import clsx from 'clsx'
import css from './FailMark.module.css'

/**
 * An open ring, sized to the 14px row glyphs it replaces and riding the same
 * font-size axis, drawn in the colour of the glyph it stands in for, so a
 * failure reads as calmly as the rows around it. Decorative: pair it with a
 * visually hidden status.
 * @param props.className - extra class for layout placement.
 * @returns the mark (aria-hidden).
 */
export function FailMark({ className }: { readonly className?: string | undefined }) {
  return <span className={clsx(css.mark, className)} aria-hidden="true" />
}
