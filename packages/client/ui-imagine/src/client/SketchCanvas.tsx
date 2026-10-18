/**
 * The Sketch sheet: a blank page the reader draws on, handed to the composer as
 * an image. Choosing the Sketch starter prompt opens this instead of the usual
 * popup, because the picture starts as a drawing rather than as a description.
 */
import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { Button, IconCloseOutline16, Modal } from '@aeven/client-ui-primitives'
import type { InputActions } from '@aeven/client-ui-conversation/client'
import type { TranslateNS } from '@aeven/client-ui-slots'
import type {} from './locales.ts'
import css from './SketchCanvas.module.css'

/** The inks the sheet offers, black first. */
const INKS = ['#000000', '#ff5a5f', '#ff9500', '#ffd60a', '#30d158', '#00c7be', '#4a5cff', '#bf5af2'] as const

/** One drawn line: its ink, its width and every point it passed through. */
interface Stroke {
  readonly ink: string
  readonly width: number
  readonly points: readonly (readonly [number, number])[]
}

/** The pen width a new stroke takes, in canvas pixels. */
const PEN_WIDTH = 4

/**
 * Render the Sketch sheet.
 * @param props.inputActions - the Session's composer input face.
 * @param props.t - the Imagine translator.
 * @param props.onClose - dismiss the sheet.
 * @returns the sheet, its tools and its palette.
 */
export function SketchCanvas({ inputActions, t, onClose }: {
  inputActions: InputActions
  t: TranslateNS<'imagine'>
  onClose: () => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const strokes = useRef<Stroke[]>([])
  const current = useRef<Stroke | null>(null)
  const [ink, setInk] = useState<string>(INKS[0])
  const [drawn, setDrawn] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  /** Paint every committed stroke, then the one in progress, onto a blank sheet. */
  const repaint = (): void => {
    const element = canvas.current
    const context = element?.getContext('2d')
    if (element === null || context === null || context === undefined) return
    context.clearRect(0, 0, element.width, element.height)
    for (const stroke of [...strokes.current, ...current.current === null ? [] : [current.current]]) {
      paintStroke(context, stroke)
    }
  }

  /** Size the backing store to the sheet's box on screen, in device pixels. */
  useEffect(() => {
    const element = canvas.current
    if (element === null) return
    const fit = (): void => {
      const box = element.getBoundingClientRect()
      const ratio = window.devicePixelRatio || 1
      element.width = Math.max(1, Math.round(box.width * ratio))
      element.height = Math.max(1, Math.round(box.height * ratio))
      repaint()
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [])

  /**
   * The sheet-local, canvas-pixel position of one pointer event.
   * @param event - the pointer event on the sheet.
   * @param element - the sheet element.
   * @returns the point, in the canvas backing store's coordinates.
   */
  const pointOf = (event: ReactPointerEvent<HTMLCanvasElement>, element: HTMLCanvasElement): readonly [number, number] => {
    const box = element.getBoundingClientRect()
    return [
      (event.clientX - box.left) * (element.width / box.width),
      (event.clientY - box.top) * (element.height / box.height),
    ]
  }

  /** Start a stroke at the press point. */
  const begin = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const element = canvas.current
    if (element === null) return
    element.setPointerCapture(event.pointerId)
    const ratio = element.width / element.getBoundingClientRect().width
    current.current = { ink, width: PEN_WIDTH * ratio, points: [pointOf(event, element)] }
    setNotice(null)
  }

  /** Extend the stroke to the pointer's current point. */
  const extend = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const element = canvas.current
    const stroke = current.current
    if (element === null || stroke === null) return
    current.current = { ...stroke, points: [...stroke.points, pointOf(event, element)] }
    repaint()
  }

  /** Commit the stroke, or drop a tap that never moved. */
  const end = (): void => {
    const stroke = current.current
    current.current = null
    if (stroke === null) return
    if (stroke.points.length < 2) return
    strokes.current = [...strokes.current, stroke]
    setDrawn(true)
  }

  /** Drop the last stroke. */
  const undo = (): void => {
    strokes.current = strokes.current.slice(0, -1)
    setDrawn(strokes.current.length > 0)
    repaint()
  }

  /** Empty the sheet. */
  const clear = (): void => {
    strokes.current = []
    current.current = null
    setDrawn(false)
    repaint()
  }

  /** Hand the drawing to the composer as a PNG, or say why it cannot go. */
  const done = (): void => {
    const element = canvas.current
    if (element === null) return
    if (!drawn) {
      setNotice(t('sketch.empty'))
      return
    }
    element.toBlob((blob) => {
      if (blob === null) return
      const refused = inputActions.addImageFiles([new File([blob], 'sketch.png', { type: 'image/png' })])
      if (refused !== null) {
        setNotice(refused)
        return
      }
      onClose()
    }, 'image/png')
  }

  return (
    <Modal open headless onClose={onClose} title={t('sketch.title')} className={css.dialog as string}>
      <div className={css.head}>
        <h2 className={css.title}>{t('sketch.title')}</h2>
        <span className={css.tools}>
          <button type="button" className={css.tool} disabled={!drawn} onClick={undo}>{t('sketch.undo')}</button>
          <button type="button" className={css.tool} disabled={!drawn} onClick={clear}>{t('sketch.clear')}</button>
          <button type="button" className={css.close} aria-label={t('dialog.close')} onClick={onClose}>
            <IconCloseOutline16 size={14} />
          </button>
        </span>
      </div>
      <div className={css.sheet}>
        <canvas
          ref={canvas}
          className={css.canvas}
          data-sketch-canvas=""
          onPointerDown={begin}
          onPointerMove={extend}
          onPointerUp={end}
          onPointerCancel={end}
        />
      </div>
      <div className={css.foot}>
        {notice !== null && <p className={css.notice} role="alert">{notice}</p>}
        <div className={css.palette} role="group" aria-label={t('sketch.inks')}>
          {INKS.map(colour => (
            <button
              key={colour}
              type="button"
              className={css.ink}
              style={{ backgroundColor: colour }}
              aria-label={colour}
              aria-pressed={colour === ink}
              onClick={() => { setInk(colour) }}
            />
          ))}
        </div>
        <Button variant="primary" className={css.done} onClick={done}>{t('sketch.done')}</Button>
      </div>
    </Modal>
  )
}

/**
 * Paint one stroke with round caps and joins.
 * @param context - the sheet's 2D context.
 * @param stroke - the stroke to paint.
 */
function paintStroke(context: CanvasRenderingContext2D, stroke: Stroke): void {
  if (stroke.points.length === 0) return
  context.strokeStyle = stroke.ink
  context.lineWidth = stroke.width
  context.lineCap = 'round'
  context.lineJoin = 'round'
  const start = stroke.points[0]
  if (start === undefined) return
  context.beginPath()
  context.moveTo(start[0], start[1])
  for (const [x, y] of stroke.points.slice(1)) context.lineTo(x, y)
  context.stroke()
}
