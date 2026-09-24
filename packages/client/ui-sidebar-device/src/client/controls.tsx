/**
 * The small controls the device pane is built from, styled by
 * DevicePane.module.css: a tooltip icon button, the settings pages' switch, a
 * segmented choice, a menu-backed choice, and an input with a submit chip.
 */
import type { FormEvent, ReactNode } from 'react'
import { useState } from 'react'
import { Menu, Tooltip, type MenuEntry } from '@aeven/client-ui-primitives'
import type { TranslateNS } from '@aeven/client-ui-slots'
import { ChevronDown } from './icons.tsx'
import css from './DevicePane.module.css'

/** The device dictionary's translator. */
export type DeviceTranslate = TranslateNS<'sidebarDevice'>

/**
 * A round icon button with a tooltip.
 * @param props - label, icon, and state.
 * @returns the button.
 */
export function IconButton(props: {
  readonly label: string
  readonly onClick: () => void
  readonly children: ReactNode
  readonly disabled?: boolean
  readonly pressed?: boolean
  readonly danger?: boolean
}): ReactNode {
  return (
    <Tooltip label={props.label} side="bottom">
      <button
        type="button"
        className={css.iconButton}
        aria-label={props.label}
        aria-pressed={props.pressed}
        data-danger={props.danger === true || undefined}
        disabled={props.disabled}
        onClick={props.onClick}
      >
        {props.children}
      </button>
    </Tooltip>
  )
}

/**
 * An on/off switch. An unread value renders off and disabled.
 * @param props - label, value, and change handler.
 * @returns the switch.
 */
export function Switch(props: {
  readonly label: string
  readonly checked: boolean | undefined
  readonly disabled?: boolean
  readonly onChange: (checked: boolean) => void
}): ReactNode {
  return (
    <button
      type="button"
      role="switch"
      className={css.switch}
      aria-label={props.label}
      aria-checked={props.checked === true}
      disabled={props.disabled === true || props.checked === undefined}
      onClick={() => { props.onChange(props.checked !== true) }}
    >
      <span className={css.thumb} />
    </button>
  )
}

/**
 * A labelled row holding one switch.
 * @param props - label, value, and change handler.
 * @returns the row.
 */
export function SwitchRow(props: {
  readonly label: string
  readonly checked: boolean | undefined
  readonly disabled: boolean
  readonly onChange: (checked: boolean) => void
}): ReactNode {
  return (
    <Field label={props.label}>
      <Switch label={props.label} checked={props.checked} disabled={props.disabled} onChange={props.onChange} />
    </Field>
  )
}

/**
 * A label on the left and a control on the right.
 * @param props - the label and the control.
 * @returns the row.
 */
export function Field(props: { readonly label: string; readonly children: ReactNode }): ReactNode {
  return (
    <div className={css.fieldRow}>
      <span className={css.fieldLabel}>{props.label}</span>
      <div className={css.fieldValue}>{props.children}</div>
    </div>
  )
}

/** One option of a choice control. */
export interface ChoiceOption<V extends string> {
  readonly value: V
  readonly label: string
}

/**
 * Two or three options side by side, one pressed.
 * @param props - options, the current value, and change handler.
 * @returns the segmented control.
 */
export function Segmented<V extends string>(props: {
  readonly label: string
  readonly value: V | undefined
  readonly options: readonly ChoiceOption<V>[]
  readonly disabled: boolean
  readonly onChange: (value: V) => void
}): ReactNode {
  return (
    <div className={css.segmented} role="group" aria-label={props.label}>
      {props.options.map(option => (
        <button
          key={option.value}
          type="button"
          className={css.segment}
          aria-pressed={option.value === props.value}
          disabled={props.disabled}
          onClick={() => { if (option.value !== props.value) props.onChange(option.value) }}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/**
 * A chip that opens a menu of options.
 * @param props - options, the current value, placeholder, and change handler.
 * @returns the chip and its menu.
 */
export function Choice<V extends string>(props: {
  readonly label: string
  readonly value: V | undefined
  readonly options: readonly ChoiceOption<V>[]
  readonly placeholder: string
  readonly disabled: boolean
  readonly onChange: (value: V) => void
}): ReactNode {
  const [open, setOpen] = useState(false)
  const current = props.options.find(option => option.value === props.value)
  const items: MenuEntry[] = props.options.map(option => ({ id: option.value, label: option.label }))
  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      items={items}
      selectedId={props.value}
      align="end"
      portal
      compact
      onSelect={(id) => {
        setOpen(false)
        if (id !== props.value) props.onChange(id as V)
      }}
      anchor={(
        <button
          type="button"
          className={css.chip}
          aria-label={props.label}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={props.disabled}
          onClick={() => { setOpen(value => !value) }}
        >
          {current === undefined ? <span className={css.chipMuted}>{props.placeholder}</span> : current.label}
          <ChevronDown />
        </button>
      )}
    />
  )
}

/**
 * A text input with a submit chip; clears after a successful submit.
 * @param props - placeholder, chip label, and submit handler.
 * @returns the form.
 */
export function SubmitRow(props: {
  readonly placeholder: string
  readonly action: string
  readonly disabled: boolean
  readonly onSubmit: (value: string) => Promise<boolean>
}): ReactNode {
  const [value, setValue] = useState('')
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    const trimmed = value.trim()
    if (trimmed === '') return
    void props.onSubmit(trimmed).then((ok) => { if (ok) setValue('') })
  }
  return (
    <form className={css.inline} onSubmit={submit}>
      <input
        className={css.textInput}
        placeholder={props.placeholder}
        aria-label={props.placeholder}
        value={value}
        disabled={props.disabled}
        onChange={(event) => { setValue(event.target.value) }}
      />
      <button type="submit" className={css.chip} disabled={props.disabled || value.trim() === ''}>{props.action}</button>
    </form>
  )
}
