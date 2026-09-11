// The toolbar icons, as markup rather than components: each is injected with
// dangerouslySetInnerHTML into a button whose stylesheet targets the svg class.

/**
 * The copy-to-clipboard glyph: two rounded rectangles, the front one hollow.
 * Default for `IconMap.copy`, on the copy button of a code block or table.
 */
export const ICON_COPY =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="copy-icon copy"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>'

/**
 * The expand glyph for entering full screen: two arrows pointing at opposite
 * corners. Default for `IconMap.maximize`.
 */
export const ICON_MAXIMIZE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="maximize2-icon maximize-2"><path d="M15 3h6v6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/><path d="M9 21H3v-6"/></svg>'

/**
 * The collapse glyph shown once a block is expanded: the same two arrows
 * turned inward. Default for `IconMap.minimize`.
 */
export const ICON_MINIMIZE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="minimize2-icon minimize-2"><path d="m14 10 7-7"/><path d="M20 10h-6V4"/><path d="m3 21 7-7"/><path d="M4 14h6v6"/></svg>'

/**
 * A play triangle inside a circle: the preview button on a code block, which
 * opens the code's HTML output. Default for `IconMap.run`.
 */
export const ICON_RUN =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="circle-play-icon circle-play"><path d="M9 9.003a1 1 0 0 1 1.517-.859l4.997 2.997a1 1 0 0 1 0 1.718l-4.997 2.997A1 1 0 0 1 9 14.996z"/><circle cx="12" cy="12" r="10"/></svg>'

/**
 * A magnifying glass with a plus: zoom a diagram in. Default for
 * `IconMap.zoomIn`, shown only when the diagram's `panZoom` is on.
 */
export const ICON_ZOOM_IN =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="zoom-in-icon zoom-in"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6"/><path d="M8 11h6"/></svg>'

/**
 * The same magnifying glass with a minus: zoom a diagram out. Default for
 * `IconMap.zoomOut`.
 */
export const ICON_ZOOM_OUT =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="zoom-out-icon zoom-out"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M8 11h6"/></svg>'

/**
 * A counter-clockwise arrow: put a diagram back to its original zoom and pan.
 * Default for `IconMap.resetView`.
 */
export const ICON_RESET_VIEW =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="rotate-ccw-icon rotate-ccw"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>'

/**
 * A downward chevron: the disclosure arrow that expands and collapses a
 * reasoning block. Default for `IconMap.chevron`.
 */
export const ICON_CHEVRON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="chevron-icon chevron-down"><path d="m6 9 6 6 6-6"/></svg>'
