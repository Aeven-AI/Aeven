/**
 * The rectangle that drags the desktop window.
 *
 * Chromium reads `-webkit-app-region` from elements and ignores it on
 * pseudo-elements, so a band drawn with `body::before` — or any other
 * `::before`/`::after` — never becomes a draggable region however it is styled.
 * The band is therefore a real element the shell installs, and it takes no
 * pointer events so every control under it keeps its clicks.
 * @module @aeven/desktop/window-drag-band
 */

/** Attribute naming the one band a document carries. */
export const DRAG_BAND_ATTRIBUTE = 'data-avn-drag-band'

/**
 * The declarations the band carries. `-webkit-app-region: drag` is the whole
 * point: it must sit on this element, never on a stylesheet rule for a
 * pseudo-element, because Chromium reads draggable regions from elements.
 */
export const DRAG_BAND_DECLARATIONS = 'position:fixed;top:0;left:0;right:0;'
  + 'z-index:2147483647;pointer-events:none;-webkit-app-region:drag'

/** Where one window puts its drag band. */
export interface DragBandOptions {
  /** Band height in CSS pixels. */
  readonly height: number
  /** Band fill; undefined leaves the band transparent. */
  readonly background?: string | undefined
}

/**
 * Install the document's drag band, or update the one it already carries.
 * @param doc - document to install into.
 * @param options - the band's height and fill.
 * @returns the band element.
 */
export function installDragBand(doc: Document, options: DragBandOptions): HTMLElement {
  const band = doc.querySelector<HTMLElement>(`[${DRAG_BAND_ATTRIBUTE}]`) ?? doc.createElement('div')
  band.setAttribute(DRAG_BAND_ATTRIBUTE, '')
  band.style.cssText = `${DRAG_BAND_DECLARATIONS};height:${String(options.height)}px`
    + (options.background === undefined ? '' : `;background:${options.background}`)
  // A band appended before the parser creates <body> stays a child of <html>;
  // fixed positioning paints it correctly either way, and the document body
  // takes it over once it exists.
  const parent = doc.body ?? doc.documentElement
  if (band.parentElement !== parent) parent.append(band)
  return band
}
