/**
 * Line icons for timeline items, drawn on a 24×24 grid with round 1.6px strokes in `currentColor`,
 * so a system colours them with CSS. Names match `ICONS` in `cv.mjs`.
 */
const PATHS = {
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M3 12.5h18"/><path d="M10.5 12.5v2h3v-2"/>',
  plane: '<path d="M21.5 3 2.5 10.5l7 2.5 2.5 7z"/><path d="M21.5 3 9.5 13"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  pen: '<path d="M4 20l1.2-4.6L15.6 5a2 2 0 0 1 2.8 0l.6.6a2 2 0 0 1 0 2.8L8.6 18.8z"/><path d="m13.5 7 3.5 3.5"/>',
  code: '<path d="m8 7-5 5 5 5"/><path d="m16 7 5 5-5 5"/><path d="m13.5 4-3 16"/>',
  chart: '<path d="M3 20h18"/><rect x="5" y="11" width="3" height="6"/><rect x="10.5" y="7" width="3" height="10"/><rect x="16" y="4" width="3" height="13"/>',
  megaphone: '<path d="M3 10v4h3l8 5V5L6 10z"/><path d="M17.5 9a4 4 0 0 1 0 6"/><path d="M6 14l1.5 6h2.5l-1-6"/>',
  camera: '<path d="M3 8.5A1.5 1.5 0 0 1 4.5 7H7l1.5-2.5h7L17 7h2.5A1.5 1.5 0 0 1 21 8.5v10a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/><circle cx="12" cy="13" r="3.8"/>',
  cap: '<path d="M2 9.5 12 5l10 4.5-10 4.5z"/><path d="M6 11.3V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-4.7"/><path d="M22 9.5V15"/>',
  book: '<path d="M12 6.5C10 5 7 4.5 3 5v13.5c4-.5 7 0 9 1.5 2-1.5 5-2 9-1.5V5c-4-.5-7 0-9 1.5z"/><path d="M12 6.5V20"/>',
  laptop: '<rect x="4.5" y="5" width="15" height="10.5" rx="1.2"/><path d="M2 19h20l-1.5-3.5h-17z"/>',
  award: '<circle cx="12" cy="9" r="5.5"/><path d="m8.5 13.3-1.5 7.2 5-2.5 5 2.5-1.5-7.2"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
  heart: '<path d="M12 20s-8-4.8-8-10.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5C20 15.2 12 20 12 20z"/>',
  flask: '<path d="M9 3h6"/><path d="M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3"/><path d="M7.5 14h9"/>',
  building: '<path d="M4 21V5l8-2v18"/><path d="M12 8h8v13"/><path d="M2.5 21h19"/><path d="M7 8h2M7 12h2M7 16h2M15 12h2M15 16h2"/>',
}

/**
 * One icon as inline SVG.
 * @param {string} name - an icon from `ICONS`.
 * @param {string} [className] - class on the `<svg>`.
 * @returns {string} SVG markup.
 */
export function icon(name, className = '') {
  const paths = PATHS[name]
  if (!paths) throw new Error(`no icon "${name}"`)
  return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`
}

/** Every icon name this module draws. */
export const ICON_NAMES = Object.keys(PATHS)
