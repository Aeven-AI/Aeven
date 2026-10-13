/**
 * The text and password field the Aeven authentication screens use.
 *
 * Aeven's Input dispatches on an `inputType` prop across selects, numeric
 * fields and text areas; these screens use `inputText` and the six-box
 * `inputNumbers` code field. Both branches are reproduced exactly — the
 * caller's `cssClass` on a wrapping `div` around bare `input`s — so the ported
 * stylesheet applies unchanged.
 * @module
 */

import {
  createRef, forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState,
  type ChangeEvent, type ClipboardEvent, type KeyboardEvent, type RefObject,
} from 'react'

/** How many boxes the code field holds; Aeven's codes are six digits. */
const CODE_LENGTH = 6

/** Props the sign-in and sign-up forms pass. */
export interface InputProps {
  /** Selects the variant: `inputText`, or `inputNumbers` for the six-box code field. */
  inputType?: string
  /** The native input type, such as `text` or `password`. */
  type?: string
  /** The complete wrapper class, such as `input-text large square`. */
  cssClass?: string
  placeholder?: string
  defaultValue?: string
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void
  /** Suppresses iOS Safari's automatic capitalization of the first letter. */
  autoCapitalize?: string
  /** Suppresses iOS Safari's autocorrection of what is typed. */
  autoCorrect?: string
  /** Suppresses spell-check underlining on fields holding no prose. */
  spellCheck?: boolean
  /** Selects the on-screen keyboard, such as `email`. */
  inputMode?: 'text' | 'email' | 'numeric' | 'tel'
  /** The browser's autofill category, such as `email` or `current-password`. */
  autoComplete?: string
}

/** What a screen holding this field can read and do. */
export interface InputHandle {
  /** What has been typed, which the forms collect when they submit; the code field joins its digits. */
  readonly value: string
  /** Move focus here, as the forms do after a failed submission. */
  focus(): void
  /** Empty the field, as the verification step does between attempts. */
  clear(): void
}

/**
 * The six single-digit boxes a verification or reset code is typed into.
 *
 * A typed digit moves focus to the next box, clearing a box moves it back, the
 * arrow keys move between boxes, and a pasted code is spread across them.
 */
const InputNumbers = forwardRef<InputHandle, InputProps>(function InputNumbers(props, ref) {
  const { cssClass, placeholder, autoComplete } = props
  const [digits, setDigits] = useState<readonly string[]>(() => Array<string>(CODE_LENGTH).fill(''))
  const boxes = useMemo<RefObject<HTMLInputElement>[]>(
    () => Array.from({ length: CODE_LENGTH }, () => createRef<HTMLInputElement>()), [])

  useImperativeHandle(ref, () => ({
    get value() { return digits.join('') },
    focus: () => { boxes[0]?.current?.focus() },
    clear: () => { setDigits(Array<string>(CODE_LENGTH).fill('')) },
  }), [digits, boxes])

  const focusBox = (index: number): void => { boxes[index]?.current?.focus() }

  const onChange = (event: ChangeEvent<HTMLInputElement>, index: number): void => {
    // The box may hold its old digit beside the new one; the one just typed wins.
    const digit = event.target.value.replace(/\D/g, '').slice(-1)
    setDigits(current => current.map((value, i) => (i === index ? digit : value)))
    if (digit === '') {
      if (index > 0) focusBox(index - 1)
    } else if (index < CODE_LENGTH - 1) {
      focusBox(index + 1)
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>, index: number): void => {
    if (event.key === 'ArrowLeft' && index > 0) focusBox(index - 1)
    if (event.key === 'ArrowRight' && index < CODE_LENGTH - 1) focusBox(index + 1)
    // An empty box raises no change on Backspace, so the move back happens here.
    if (event.key === 'Backspace' && digits[index] === '' && index > 0) focusBox(index - 1)
  }

  const onPaste = (event: ClipboardEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const pasted = event.clipboardData.getData('Text').replace(/\D/g, '').slice(0, CODE_LENGTH)
    setDigits(Array.from({ length: CODE_LENGTH }, (_, i) => pasted[i] ?? ''))
    focusBox(Math.min(pasted.length, CODE_LENGTH - 1))
  }

  return (
    <div className={cssClass ?? 'input-numbers'} onPaste={onPaste}>
      {digits.map((digit, index) => (
        <input
          // The boxes are positional and never reorder.
          key={index}
          ref={boxes[index]}
          id={`n${index}`}
          name={`n${index}`}
          inputMode="numeric"
          autoComplete={index === 0 ? autoComplete : 'off'}
          value={digit}
          placeholder={placeholder ?? ''}
          onChange={(event) => { onChange(event, index) }}
          onKeyDown={(event) => { onKeyDown(event, index) }}
        />
      ))}
    </div>
  )
})

export const Input = forwardRef<InputHandle, InputProps>(function Input(props, ref) {
  if (props.inputType === 'inputNumbers') return <InputNumbers ref={ref} {...props} />
  return <InputText ref={ref} {...props} />
})

/** The single text or password field. */
const InputText = forwardRef<InputHandle, InputProps>(function InputText(props, ref) {
  const {
    inputType, type, cssClass, placeholder, defaultValue, onChange,
    autoCapitalize, autoCorrect, spellCheck, inputMode, autoComplete,
  } = props
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
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        spellCheck={spellCheck}
        inputMode={inputMode}
        autoComplete={autoComplete}
        onChange={(event) => {
          setValue(event.target.value)
          onChange?.(event)
        }}
      />
    </div>
  )
})

export default Input
