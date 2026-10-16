/**
 * The loading face and document head the Electron shell's own pages share: the
 * sign-in round trip in the reader's browser and the start screen the
 * application shows while its backend boots.
 *
 * Both draw the same mark above the same spinner with the same geometry as the
 * Web client's own preloader, so the product's first frames read as one screen.
 * Only the page background, the ink, and the copy differ: a browser tab takes
 * its own white, while an application window follows the system scheme the
 * client's preloader follows too.
 * @module @aeven/desktop/brand-page
 */

/** The Æven mark, drawn in `currentColor` so each page owns its ink. */
const LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 671 581" aria-hidden="true">'
  + '<g fill="currentColor" fill-rule="evenodd">'
  + '<path d="m225.301 0 305.5 529.142-43.301 25L182 25z"/>'
  + '<path d="M140 529.141 445.5 0l43.302 25-305.5 529.141z"/>'
  + '<path d="M167.901 530.059h335v50h-335z"/>'
  + '<path d="m43.302 264.5 167.5 290.119-43.302 25L0 289.5zM503.302 0l167.5 290.119-43.302 25L460 25z"/>'
  + '<path d="M460 554.618 627.5 264.5l43.301 25-167.5 290.118zM0 290.118 167.5 0 210.8 25l-167.5 290.118z"/>'
  + '<path d="M167.5 0h57.8v50h-57.8zM445.5 0h57.8v50h-57.8zM72.5 405.3 306.5 0l43.302 25-234 405.3z"/>'
  + '<path d="m364.301 0 234 405.3-43.3 25L321 25z"/>'
  + '<path d="M306.5 0h57.8v50h-57.8z"/>'
  + '</g></svg>'

/** The spinner glyph drawn under the mark. */
const SPINNER_SVG = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
  + '<path d="M16 16L19 19M18 12H22M8 8L5 5M16 8L19 5M8 16L5 19M2 12H6M12 2V6M12 18V22"'
  + ' stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'

/**
 * Side of the square the mark is drawn in, matching `#avn-preloader .logo` in
 * the Web client's first-paint stylesheet.
 */
const MARK_PX = 50

/** Space between the mark and the spinner, matching that same stylesheet. */
const MARK_GAP_PX = 4

/**
 * Side of the square the spinner is drawn in by default, matching
 * `--dsw-aeven-loading-mark-size` and `#avn-preloader .spinner`.
 */
export const SPINNER_PX = 18

/** Length of one spinner turn, matching that same stylesheet. */
const SPINNER_TURN_MS = 900

/**
 * Escapes text for HTML text content or a double-quoted attribute value.
 * @param text - unescaped text.
 * @returns the text with `&`, `<`, `>`, `"`, and `'` as numeric references.
 */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/gu, character => `&#${String(character.charCodeAt(0))};`)
}

/**
 * Geometry and motion of the loading face, without its colours: a page states
 * its own ink, because a white tab and a window that follows the system scheme
 * do not share one.
 * @returns the declaration block, for one page's stylesheet.
 */
export function loadingFaceStyles(): string {
  return 'main{display:flex;flex-direction:column;align-items:center}'
    + `.logo{width:${String(MARK_PX)}px;height:${String(MARK_PX)}px;margin:0 0 ${String(MARK_GAP_PX)}px}`
    + `.logo svg{display:block;width:${String(MARK_PX)}px;height:${String(MARK_PX)}px}`
    + `.spinner{width:${String(SPINNER_PX)}px;height:${String(SPINNER_PX)}px;`
    + `animation:loader-spin ${String(SPINNER_TURN_MS)}ms linear infinite}`
    + `.spinner svg{display:block;width:${String(SPINNER_PX)}px;height:${String(SPINNER_PX)}px}`
    + '@keyframes loader-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}'
    + '@media (prefers-reduced-motion:reduce){.spinner{animation:none}}'
}

/**
 * The mark above the spinner.
 * @param label - accessible name of the face. A page that draws it as a
 * decoration omits the name, which leaves the region unnamed rather than
 * announcing the product twice.
 * @param extra - markup the page adds under the spinner.
 * @returns the face's `main` element.
 */
export function loadingFace(label?: string, extra = ''): string {
  return `<main${label === undefined ? '' : ` aria-label="${escapeHtml(label)}"`}>`
    + `<div class="logo" aria-hidden="true">${LOGO_SVG}</div>`
    + `<div class="spinner" aria-hidden="true">${SPINNER_SVG}</div>`
    + extra
    + '</main>'
}

/**
 * Document head every shell-owned page starts from.
 * @param scheme - the page's `color-scheme`: `light` for a page that is always
 * white, `light dark` for one that follows the system scheme.
 * @param extra - further head markup, appended after the title.
 * @returns the doctype through the title.
 */
export function brandDocumentHead(scheme: 'light' | 'light dark', extra = ''): string {
  return '<!doctype html><html><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + `<meta name="color-scheme" content="${scheme}"><title>Æven</title>`
    + extra
}
