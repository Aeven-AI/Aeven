/** The shared Aeven loading mark. */
import css from './Spinner.module.css'

/**
 * The rotating Aeven loading glyph, drawn once for every surface that reports
 * work in flight. Purely decorative: the surface around it owns the status
 * role and the accessible text, because only the surface knows what is loading.
 * @param className - Additional class for surface-specific sizing or colour.
 * @returns the spinner element.
 */
export function Spinner({ className }: { className?: string | undefined }) {
  return (
    <span className={className === undefined ? css.spinner : `${css.spinner} ${className}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M16 16L19 19M18 12H22M8 8L5 5M16 8L19 5M8 16L5 19M2 12H6M12 2V6M12 18V22"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  )
}
