/**
 * Pure concession-chain column solver for the three-column AppFrame.
 * Chain order is fixed by contract: keep center >= CENTER_MIN by shrinking
 * details, then auto-closing it (derived zero width — preferred width
 * preferences are never rewritten, so widening the window restores them).
 * The sidebar never concedes: its rendered width is always the drag
 * preference, and center absorbs any remaining
 * deficit as the last resort. Inputs are the layout store's plain width
 * preferences (0 = closed); a closed sidebar resolves to the fixed
 * zero width while closed details also resolve to zero width.
 * The SIDEBAR_AUTO_COLLAPSE breakpoint is consumed by AppFrame, which decides
 * the effective sidebar preference before solving; the solver itself stays
 * breakpoint-free.
 */

/** Resolved widths for one frame; center may drop below CENTER_MIN only at the final fallback. */
export interface Columns { sidebar: number; center: number; details: number }

// Contract-frozen geometry: the three-column concession chain's fixed points.
/** Center column floor; only the final fallback may go below it. */
export const CENTER_MIN = 640
/** Sidebar drag clamp floor. */
export const SIDEBAR_MIN = 264
/** Sidebar drag clamp ceiling. */
export const SIDEBAR_MAX = 420
/** Sidebar width before any user drag. */
export const SIDEBAR_DEFAULT = 280
/** Closed sidebar width; its hamburger is an overlay and does not shift content. */
export const SIDEBAR_COLLAPSED = 0
/** Viewport width below which the sidebar auto-collapses (Aeven
 * LG breakpoint); a manual toggle below it re-expands over the squeezed center
 * (stores.ts narrowExpanded). */
export const SIDEBAR_AUTO_COLLAPSE = 1024
/** Details drag clamp floor. */
export const DETAILS_MIN = 300
/** Details drag clamp ceiling. */
export const DETAILS_MAX = 520
/** Details width before any user drag. */
export const DETAILS_DEFAULT = 360
/** Right sidebar drag clamp floor. */
export const RIGHTBAR_MIN = 360
/**
 * Right sidebar ceiling as a fraction of the frame. A fraction rather than a
 * fixed px ceiling: the panel is a reading column whose useful width scales
 * with the display, where the details column inspects one tool call and does
 * not.
 */
export const RIGHTBAR_MAX_RATIO = 0.7
/**
 * Right sidebar width on first opening. A fixed width rather than a fraction:
 * the panel is a reading column, so what it should open at is a width that
 * reads well, not a share of whatever display it lands on. Frames too narrow
 * to give it this scale it back through {@link clampRightbar}, whose ceiling
 * is a fraction of the frame.
 */
export const RIGHTBAR_DEFAULT = 600

/**
 * Clamp a panel width into its contract range.
 * @param px - requested width.
 * @param min - range lower bound.
 * @param max - range upper bound.
 * @returns the clamped width.
 */
export function clampWidth(px: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(px)))
}

/**
 * Clamp a right sidebar width against the frame it is drawn in. The ceiling is
 * a fraction of the frame, so it is never below the floor on a narrow frame:
 * the floor wins there and the center concedes, which keeps a dragged edge
 * tracking the pointer instead of sticking at an inverted range.
 * @param px - requested width.
 * @param viewport - available frame width in px.
 * @returns the clamped width.
 */
export function clampRightbar(px: number, viewport: number): number {
  return clampWidth(px, RIGHTBAR_MIN, Math.max(RIGHTBAR_MIN, viewport * RIGHTBAR_MAX_RATIO))
}

/**
 * The width a right sidebar opens at when it has no remembered preference.
 * @param viewport - available frame width in px.
 * @returns the first-open width in px, clamped into the frame's range.
 */
export function defaultRightbar(viewport: number): number {
  return clampRightbar(RIGHTBAR_DEFAULT, viewport)
}

/**
 * Solve the three column widths for one viewport frame. Pure: no hysteresis —
 * the output is a function of (viewport, preferences) only, so recovery on
 * re-widening is automatic. Preferences re-clamp here because they cross the
 * store boundary and callers may still supply stale ranges.
 * @param viewport - available frame width in px.
 * @param sidebar - sidebar width preference in px (0 = closed).
 * @param details - details width preference in px (0 = closed).
 * @returns resolved widths; zero means visually closed for either side column.
 */
export function computeColumns(viewport: number, sidebar: number, details: number): Columns {
  // The sidebar is fixed at its preference or closes completely.
  const s = sidebar === 0 ? SIDEBAR_COLLAPSED : clampWidth(sidebar, SIDEBAR_MIN, SIDEBAR_MAX)
  const d0 = details === 0 ? 0 : clampWidth(details, DETAILS_MIN, DETAILS_MAX)

  // Step 1: everything fits at preferred widths.
  if (s + d0 + CENTER_MIN <= viewport) return { sidebar: s, center: viewport - s - d0, details: d0 }

  // Step 2: shrink details toward its minimum.
  const d1 = d0 === 0 ? 0 : Math.max(DETAILS_MIN, viewport - s - CENTER_MIN)
  if (s + d1 + CENTER_MIN <= viewport) return { sidebar: s, center: CENTER_MIN, details: d1 }

  // Step 3: auto-close details (derived — preferences untouched); center
  // absorbs any remaining deficit (may drop below CENTER_MIN).
  return { sidebar: s, center: Math.max(0, viewport - s), details: 0 }
}
