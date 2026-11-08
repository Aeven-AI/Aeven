/**
 * One agent pointer per sidebar column, shared by every pane in it: the browser,
 * a terminal, and the column's own pills, so the pointer the reader watches is a
 * single cursor that travels between them.
 * @module
 */

import { BrowserOverlay, type Point } from './overlay.ts'

/** A pane's handle on its column's pointer. */
export interface ColumnPointer {
  /** The shared overlay. */
  readonly overlay: BrowserOverlay
  /** The fixed layer over the column the overlay draws in; points are relative to it. */
  readonly layer: HTMLElement
  /**
   * The point the pointer's tip takes for an element: its centre, in layer coordinates.
   * @param element - the element aimed at.
   * @returns the point.
   */
  aim(element: Element): Point
  /**
   * Glide the pointer onto an element, show the press, wait for it to arrive, then click the element.
   * @param element - the element pressed.
   * @param signal - cancels the gesture before the click.
   */
  press(element: HTMLElement, signal?: AbortSignal): Promise<void>
  /** Release this pane's hold on the pointer; the last release removes it. */
  release(): void
}

/** A column's live pointer and how many panes hold it. */
interface PointerEntry { overlay: BrowserOverlay; layer: HTMLDivElement; users: number; dispose: () => void }

/**
 * Where a column keeps its pointer: on the element itself, under a key from the
 * global symbol registry, because each plugin bundle inlines its own copy of this
 * module and a module-level map would give each plugin its own pointer.
 */
const POINTER_KEY = Symbol.for('aeven.sidebar.column-pointer')

/** The column's pointer entry, when one is live. */
function entryOf(column: Element): PointerEntry | undefined {
  return (column as unknown as Record<symbol, PointerEntry | undefined>)[POINTER_KEY]
}

/** Store or clear the column's pointer entry. */
function setEntry(column: Element, entry: PointerEntry | undefined): void {
  (column as unknown as Record<symbol, PointerEntry | undefined>)[POINTER_KEY] = entry
}

/**
 * Hold the pointer of a sidebar column, creating it on first use.
 *
 * The layer is fixed over the column and follows its box on resize and scroll,
 * stacked at 1300 so the pointer stays above the column's portaled menus. The
 * pointer hides while the column has no box, such as when it is closed.
 * @param column - the column element the pointer draws over.
 * @param idleHideMs - idle fade for a newly created pointer; `0` keeps it shown.
 * @returns this pane's handle.
 */
export function acquireColumnPointer(column: HTMLElement, idleHideMs: number): ColumnPointer {
  let entry = entryOf(column)
  if (entry === undefined) {
    const layer = document.createElement('div')
    layer.setAttribute('aria-hidden', 'true')
    layer.style.position = 'fixed'
    layer.style.overflow = 'hidden'
    layer.style.pointerEvents = 'none'
    layer.style.zIndex = '1300'
    document.body.append(layer)
    const overlay = new BrowserOverlay().attach({ container: layer, idleHideMs, decorations: false })
    const place = (): void => {
      const box = column.getBoundingClientRect()
      layer.style.left = `${String(box.left)}px`
      layer.style.top = `${String(box.top)}px`
      layer.style.width = `${String(box.width)}px`
      layer.style.height = `${String(box.height)}px`
      if (box.width === 0 || box.height === 0) overlay.hide({ immediate: true })
    }
    place()
    const resizes = new ResizeObserver(place)
    resizes.observe(column)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    const created = {
      overlay, layer, users: 0,
      dispose: () => {
        resizes.disconnect()
        window.removeEventListener('resize', place)
        window.removeEventListener('scroll', place, true)
        overlay.destroy()
        layer.remove()
      },
    }
    setEntry(column, created)
    entry = created
  }
  const held = entry
  held.users += 1
  let released = false
  const aim = (element: Element): Point => {
    const box = element.getBoundingClientRect()
    const panel = held.layer.getBoundingClientRect()
    return { x: box.x - panel.x + box.width / 2, y: box.y - panel.y + box.height / 2 }
  }
  return {
    overlay: held.overlay,
    layer: held.layer,
    aim,
    async press(element, signal) {
      held.overlay.click(aim(element))
      await held.overlay.arrived(signal)
      signal?.throwIfAborted()
      element.click()
    },
    release() {
      if (released) return
      released = true
      held.users -= 1
      if (held.users > 0) return
      held.dispose()
      setEntry(column, undefined)
    },
  }
}
