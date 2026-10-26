/**
 * The button the Aeven authentication screens use.
 *
 * Aeven's Button dispatches on a `type` prop across eleven variants; these
 * screens use two. Both are reproduced exactly — the same element tree, the
 * same class composition, and the same inline loader mark — so the ported
 * stylesheet applies unchanged.
 * @module
 */

import {
  forwardRef, useEffect, useImperativeHandle, useState,
  type MouseEvent,
} from 'react'

/**
 * The loader mark, inlined exactly as Aeven inlines it. The stylesheet spins
 * it; this only has to be the same markup underneath.
 */
const LOADER_SVG =
  '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M16 16L19 19M18 12H22M8 8L5 5M16 8L19 5M8 16L5 19M2 12H6M12 2V6M12 18V22" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>'

/** Props the screens pass. */
export interface ButtonProps {
  /** Which variant to render; an unknown one renders nothing, as in Aeven. */
  type?: string
  /** Base class the stylesheet keys on, such as `loader-button large center`. */
  cssClass?: string
  label?: string
  /** Raw SVG markup for the icon variant; the screens pass provider marks. */
  icon?: string
  /** Initial progress state; later changes come through the handle. */
  loading?: boolean
  /**
   * Keep taking clicks while showing progress. For a wait the reader may have
   * abandoned elsewhere, such as a provider sign-in in another window, where
   * pressing again starts over.
   */
  interruptible?: boolean
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void
}

/** What a screen holding this button can do. */
export interface ButtonHandle {
  /**
   * Show or clear the progress state. The forms call this when they send a
   * request and again when it settles.
   * @param loading - whether a request is in flight.
   */
  loadingStatus(loading: boolean): void
}

export const Button = forwardRef<ButtonHandle, ButtonProps>(function Button(props, ref) {
  const { type, cssClass, label, icon, loading, interruptible, onClick } = props
  const [busy, setBusy] = useState(loading ?? false)

  useEffect(() => { setBusy(loading ?? false) }, [loading])
  useImperativeHandle(ref, () => ({ loadingStatus: setBusy }), [])

  if (type !== 'loaderButton' && type !== 'loaderButtonIcon') return null
  return (
    <button
      className={busy ? `${cssClass ?? ''} active disabled` : cssClass ?? ''}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        // A button showing progress ignores further clicks, so a second
        // request cannot be raised while the first is open.
        if (!busy || interruptible === true) onClick?.(event)
      }}
    >
      <span className="container">
        {type === 'loaderButtonIcon'
          ? <span className="icon" dangerouslySetInnerHTML={{ __html: icon ?? '' }} />
          : null}
        <span className="txt">{label}</span>
      </span>
      <span className="loader" dangerouslySetInnerHTML={{ __html: LOADER_SVG }} />
    </button>
  )
})

export default Button
