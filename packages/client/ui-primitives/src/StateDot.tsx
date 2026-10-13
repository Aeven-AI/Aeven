import clsx from 'clsx'
import css from './StateDot.module.css'
import { IconLucideCircleDot } from './icons/index.tsx'
import { Spinner } from './Spinner.tsx'

/** State semantic (green circle-dot done / amber user-attention / loading spinner / red error). */
export type StateDotState = 'done' | 'warning' | 'ongoing' | 'error'

/**
 * Render a state dot.
 * @param props.state - which of the four states to show.
 * @param props.size - outer diameter in px (default 10).
 * @param props.className - extra class for layout placement.
 * @returns the dot element (aria-hidden; pair with text for accessibility).
 */
export function StateDot({ state, size = 10, className }: {
  state: StateDotState
  size?: number | undefined
  className?: string | undefined
}) {
  // A ready state reads as lucide's circle-dot rather than a solid light: the
  // ring says "settled" where a bare dot says "indicator".
  if (state === 'done') {
    return (
      <span
        className={clsx(css.done, className)}
        data-state="done"
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        <IconLucideCircleDot />
      </span>
    )
  }
  if (state === 'ongoing') {
    return (
      <span
        className={clsx(css.ongoing, className)}
        data-state="ongoing"
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        <Spinner className={css.ongoingSpinner} />
      </span>
    )
  }
  return (
    <span
      className={clsx(css.dot, className)}
      data-state={state}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  )
}
