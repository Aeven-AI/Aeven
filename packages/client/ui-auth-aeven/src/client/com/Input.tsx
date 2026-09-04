/**
 * The text and password field the Aeven authentication screens use.
 *
 * Aeven's Input dispatches on an `inputType` prop across selects, numeric
 * fields and text areas; these screens use `inputText`. That branch is
 * reproduced exactly — the caller's `cssClass` on a wrapping `div` around a
 * bare `input` — so the ported stylesheet applies unchanged.
 * @module
 */

import {
  forwardRef, useEffect, useImperativeHandle, useRef, useState,
  type ChangeEvent,
} from 'react'

/** Props the sign-in and sign-up forms pass. */
export interface InputProps {
  /** Selects the variant; these screens pass `inputText`. */
  inputType?: string
  /** The native input type, such as `text` or `password`. */
  type?: string
  /** The complete wrapper class, such as `input-text large square`. */
  cssClass?: string
  placeholder?: string
  defaultValue?: string
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void
}

/** What a screen holding this field can read and do. */
export interface InputHandle {
  /** What has been typed, which the forms collect when they submit. */
  readonly value: string
  /** Move focus here, as the forms do after a failed submission. */
  focus(): void
  /** Empty the field, as the verification step does between attempts. */
  clear(): void
}

export const Input = forwardRef<InputHandle, InputProps>(function Input(props, ref) {
  const { inputType, type, cssClass, placeholder, defaultValue, onChange } = props
  const [value, setValue] = useState(defaultValue ?? '')
  const element = useRef<HTMLInputElement>(null)

  // Aeven resets the field when the caller changes the default; the
  // verification step relies on that to clear the code between attempts.
  useEffect(() => { setValue(defaultValue ?? '') }, [defaultValue])

  useImperativeHandle(ref, () => ({
    get value() { return value },
    focus: () => { element.current?.focus() },
    clear: () => { setValue('') },
  }), [value])

  // An unrecognized variant renders nothing, as in the original.
  if (inputType !== 'inputText') return null
  return (
    <div className={cssClass ?? ''}>
      <input
        ref={element}
        type={type ?? 'text'}
        value={value}
        placeholder={placeholder ?? ''}
        onChange={(event) => {
          setValue(event.target.value)
          onChange?.(event)
        }}
      />
    </div>
  )
})

export default Input
