/** The centered loading state every section shows while its own data is in flight. */
import { Spinner } from './Spinner.tsx'
import css from './LoadingBlock.module.css'

/**
 * A section's loading state: one spinner, horizontally centered, and nothing
 * else — no visible copy and no rule. The mark stays decorative; `label` is the
 * surface's own localized status text, carried into the accessibility tree.
 * @param label - the status text announced while the section loads.
 * @param className - Additional class for surface-specific spacing.
 * @returns the centered loading block.
 */
export function LoadingBlock({ label, className }: { label: string; className?: string | undefined }) {
  return (
    <div className={className === undefined ? css.block : `${css.block} ${className}`} role="status">
      <span className={css.label}>{label}</span>
      <Spinner />
    </div>
  )
}
