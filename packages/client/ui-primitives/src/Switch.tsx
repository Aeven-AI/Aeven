/** The on/off control for a boolean preference. */
import css from './Switch.module.css'

/** Props of {@link Switch}. */
export interface SwitchProps {
  /** Current value. */
  checked: boolean
  /**
   * Called with the value the reader chose.
   * @param checked - the new value.
   */
  onChange: (checked: boolean) => void
  /** Accessible name of the control. */
  label: string
  disabled?: boolean | undefined
  /** Tooltip; absent renders none. */
  title?: string | undefined
  /** Element id, for a visible `<label htmlFor>`; absent renders none. */
  id?: string | undefined
}

/**
 * Render a switch. The click does not propagate, so a switch inside a
 * clickable row changes only the value.
 * @param props - see {@link SwitchProps}.
 * @returns the `button` element with `role="switch"`.
 */
export function Switch({ checked, onChange, label, disabled, title, id }: SwitchProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={title}
      className={css.switch}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation()
        onChange(!checked)
      }}
    >
      <span className={css.thumb} />
    </button>
  )
}
