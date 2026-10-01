/**
 * The overlay's entire visual surface: injected stylesheet plus the cursor
 * geometry constants.
 *
 * Geometry, colors, the glow, and the rotation are the Codex desktop app's
 * browser-overlay values, read out of its extracted bundle. These are that
 * design's numbers, not approximations: a 24x24 cursor box holding a 23x24
 * sprite, nudged to (12, -2.5), rotated 44deg with the transform origin at the
 * box centre, wrapped in a two-stop glow. The sprite itself lives in
 * `cursor-asset.ts`.
 * @module
 */

/**
 * The sprite's resting rotation, in degrees.
 *
 * Zero, because the artwork is authored in the orientation it should be seen in:
 * the arrow already points up-left as drawn. The reference carries a -44 here and
 * then normalizes the composed angle back into [0, 360), which lands the sprite at
 * its authored orientation anyway — so a non-zero resting angle in this
 * implementation only ever produces a sideways cursor.
 *
 * The motion model still leans the sprite while travelling; this is where it rests.
 */
export const BASE_ROTATION_DEG = 0

/** Accent used for selection boxes, labels, and the cursor's glow. */
export const ACCENT = '#0069FB'

/** The square cursor box, in CSS pixels. */
export const CURSOR_BOX = 24

/**
 * The sprite's rendered size in CSS pixels.
 *
 * The source PNG is 46x48, so this is a clean 2x downsample on a Retina display
 * rather than a resample.
 */
export const CURSOR_SPRITE = { width: 23, height: 24 } as const

/**
 * Nudge from the box's top-left to the sprite's top-left.
 *
 * The reference nudges by (12, -2.5) because its sprite carries asymmetric
 * padding. Ours does not: with no resting rotation the sprite fills its box, so
 * the offset that centres it is the half-difference of the two sizes, and the
 * sprite's centre lands on the box centre exactly.
 */
export const CURSOR_NUDGE = { x: (CURSOR_BOX - CURSOR_SPRITE.width) / 2, y: (CURSOR_BOX - CURSOR_SPRITE.height) / 2 } as const

/**
 * The cursor's glow, matching the reference's two-stop drop shadow.
 *
 * A page cannot be assumed to define the glow variable, so a fallback is baked
 * into the filter. A host may override `--aeven-browser-overlay-glow` on the
 * overlay root to re-tint it.
 */
export const CURSOR_GLOW_FILTER =
  'drop-shadow(0 0 6px color-mix(in srgb, var(--aeven-browser-overlay-glow, #0069FB) 90%, transparent)) '
  + 'drop-shadow(0 0 15px color-mix(in srgb, var(--aeven-browser-overlay-glow, #0069FB) 48%, transparent))'

/**
 * Distance at or above which a move uses the long-range path, in CSS pixels.
 *
 * The reference switches behavior at this threshold: short hops slide, longer
 * ones travel a curve. The overlay only needs the number to pick its easing.
 */
export const CURSOR_LONG_MOVE_PX = 196

/**
 * Namespacing hook: every generated class carries this prefix so the overlay
 * cannot collide with page styles and can be removed by prefix if a page's own
 * teardown fails.
 */
export const CLASS_PREFIX = 'aeven-browser-overlay'

/**
 * Deterministic class name for a suffix.
 * @param suffix - the element's role, such as `cursor` or `ripple`.
 * @returns the prefixed class name.
 */
export function cls(suffix: string): string {
  return `${CLASS_PREFIX}-${suffix}`
}

/**
 * The injected stylesheet.
 *
 * Every rule is scoped under the overlay root so a page can never be affected by
 * the overlay's presence, and every animated element is a child of that root.
 * Selection boxes use the same blue family as the cursor's glow so a hover, a
 * click, and the pointer read as one system rather than three unrelated
 * highlights.
 * @returns the stylesheet text, ready for a `<style>` element's `textContent`.
 */
export function overlayStyles(): string {
  const root = `.${CLASS_PREFIX}`
  return `
${root} {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  pointer-events: none;
  /* NOT contain: strict — paint containment would anchor fixed descendants here. */
  contain: layout style;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 13px;
  line-height: 1.25;
  color: rgb(15, 23, 42);
}

/*
 * Attached inside a caller's layer, the overlay fills that layer rather than the
 * window, and its own overflow is what keeps the pointer inside the panel. The
 * layer is the drawing region, so nothing has to clip it from outside.
 */
${root}[data-mount="container"] {
  position: absolute;
  overflow: hidden;
}

/* The cursor layer is the only element that ever animates position. */
${root} .${cls('cursor-layer')} {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

/*
 * The cursor box. Transform origin is the box centre, which is what the 44deg
 * sprite rotation is calibrated against — moving it would swing the arrow's tip
 * away from the point it is supposed to be pointing at.
 */
${root} .${cls('cursor')} {
  position: absolute;
  top: 0;
  left: 0;
  width: ${CURSOR_BOX}px;
  height: ${CURSOR_BOX}px;
  /* Motion is applied by the wrapper inside, so this box only positions. */
  will-change: transform;
  pointer-events: none;
}

${root} .${cls('cursor')}[data-visible="false"] {
  opacity: 0;
}

/*
 * The nudge lives on an inner wrapper, and the sprite inside it carries the
 * sprite's own base rotation. The wrapper's transform is owned entirely by the
 * motion model, so nothing here competes with it.
 */
${root} .${cls('cursor-sprite')} {
  display: block;
  position: absolute;
  left: 0;
  top: 0;
  transform: translate3d(${CURSOR_NUDGE.x}px, ${CURSOR_NUDGE.y}px, 0);
}

${root} .${cls('cursor-sprite')} img {
  display: block;
  /* Pin against a page's global img (max-width/box-sizing) rules. */
  box-sizing: content-box;
  max-width: none;
  max-height: none;
  width: ${CURSOR_SPRITE.width}px !important;
  height: ${CURSOR_SPRITE.height}px !important;
  /*
   * No rotation here on purpose. The sprite is authored already pointing up-left,
   * and the motion model's settled rotation is what holds it there, so rotating
   * here too would double the angle. Verified by measurement: with this left at
   * none, the rendered tip sits on the requested coordinate.
   */
  transform-origin: 0 0;
  filter: ${CURSOR_GLOW_FILTER};
  -webkit-user-drag: none;
  user-select: none;
}

/* Target highlight: a 2px accent ring with a barely-there wash of accent. */
${root} .${cls('box')} {
  position: absolute;
  box-sizing: border-box;
  border: 2px solid ${ACCENT};
  border-radius: 0;
  background: color-mix(in srgb, ${ACCENT} 3%, transparent);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.28);
  pointer-events: none;
  transform-origin: center;
}

${root} .${cls('box')}[data-kind="hover"] {
  border-style: solid;
}

/* A region drag reads as provisional, so it stays dashed. */
${root} .${cls('box')}[data-kind="region"] {
  border-style: dashed;
}

/* Text selections keep a flat wash; a ring around each line would be noise. */
${root} .${cls('box')}[data-kind="text"] {
  border-color: transparent;
  background: #128dff66;
  box-shadow: none;
}

/* The label chip names the action in flight, e.g. "click". */
${root} .${cls('label')} {
  position: absolute;
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 4px 8px;
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.92);
  color: rgb(248, 250, 252);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.01em;
  pointer-events: none;
  opacity: 0;
  transition: opacity 120ms ease-out;
}

${root} .${cls('label')}[data-visible="true"] {
  opacity: 1;
}

/* A click lands as an expanding ring plus a core flash. */
${root} .${cls('ripple')} {
  position: absolute;
  width: 14px;
  height: 14px;
  margin: -7px 0 0 -7px;
  border-radius: 50%;
  border: 2px solid ${ACCENT};
  pointer-events: none;
  animation: ${cls('ripple')} 620ms cubic-bezier(0.22, 0.61, 0.36, 1) forwards;
}

@keyframes ${cls('ripple')} {
  0% { opacity: 0.85; transform: scale(0.35); }
  100% { opacity: 0; transform: scale(2.6); }
}

${root} .${cls('flash')} {
  position: absolute;
  width: 22px;
  height: 22px;
  margin: -11px 0 0 -11px;
  border-radius: 50%;
  background: radial-gradient(circle, color-mix(in srgb, ${ACCENT} 55%, transparent) 0%, transparent 70%);
  pointer-events: none;
  animation: ${cls('flash')} 380ms ease-out forwards;
}

@keyframes ${cls('flash')} {
  0% { opacity: 0.95; transform: scale(0.4); }
  100% { opacity: 0; transform: scale(1.5); }
}

/*
 * Typing shows a caret pulse at the caret's point rather than a ring, so a click
 * and a keystroke never look alike.
 */
${root} .${cls('caret')} {
  position: absolute;
  width: 2px;
  height: 16px;
  margin: -8px 0 0 -1px;
  background: ${ACCENT};
  pointer-events: none;
  animation: ${cls('caret')} 900ms steps(2, end) infinite;
}

@keyframes ${cls('caret')} {
  0%, 49% { opacity: 1; }
  50%, 100% { opacity: 0.15; }
}

/* Respect a page or OS that asks for less motion: state stays visible, motion stops. */
@media (prefers-reduced-motion: reduce) {
${root} .${cls('ripple')}, ${root} .${cls('flash')}, ${root} .${cls('caret')} {
  animation: none;
}
${root} .${cls('ripple')} { opacity: 0.5; transform: scale(1.6); }
${root} .${cls('flash')} { opacity: 0.35; }
${root} .${cls('caret')} { opacity: 0.9; }
}
`
}
