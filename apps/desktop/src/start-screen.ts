/**
 * The screen the shell shows in its window while the backend boots, so a launch
 * paints something immediately instead of nothing at all.
 *
 * The window renders this page from the shell's own `avn-app://shell` origin
 * before the deployment is read, the login shell is queried, or a Host is
 * started, and it is replaced by the application's own address once the backend
 * is ready. It draws nothing but the shared loading face, on the colours the
 * client's preloader paints next, so the handover moves no pixel.
 * @module @aeven/desktop/start-screen
 */

import { brandDocumentHead, loadingFace, loadingFaceStyles } from './brand-page.ts'

/** Path of the start screen on the shell's own origin. */
export const START_PAGE_PATH = '/start.html'

/** Address the shell loads the start screen from. */
export function startPageUrl(): string {
  return `avn-app://shell${START_PAGE_PATH}`
}

/**
 * The macOS window's drag area: full width, because this page has no controls
 * and nothing but the window to move. It is an element in the document, since
 * Chromium reads `-webkit-app-region` from elements and ignores pseudo-elements.
 */
const DRAG_BAND = '<div class="avn-drag-band" aria-hidden="true"></div>'

/**
 * Styles the window's own scheme and ink: the colours the client's preloader
 * paints as soon as it replaces this page.
 * @param platform - host platform, which decides whether this page drags the window.
 */
function startPageStyles(platform: NodeJS.Platform): string {
  return 'html{color-scheme:light dark}'
    + ':root{--avn-start-bg:rgb(242,242,242);--avn-start-ink:#000000}'
    + '@media (prefers-color-scheme:dark){:root{--avn-start-bg:#111111;--avn-start-ink:rgb(249,250,251)}}'
    + 'html,body{margin:0;height:100%;background:var(--avn-start-bg);color:var(--avn-start-ink)}'
    + 'body{display:flex;align-items:center;justify-content:center}'
    + (platform === 'darwin'
      ? 'body{user-select:none;-webkit-app-region:drag}.avn-drag-band{position:fixed;top:0;left:0;right:0;height:calc(8px + var(--dsw-aeven-control-size,40px));z-index:2001;user-select:none;-webkit-app-region:drag}'
      : '')
    + loadingFaceStyles()
    + '.logo,.spinner{color:var(--avn-start-ink)}'
    // Positioned out of flow, so a line appearing never moves the mark and spinner the client's preloader repaints.
    + 'main{position:relative}'
    + '.avn-start-status{position:absolute;top:100%;left:50%;transform:translateX(-50%);width:min(80vw,440px);'
    + 'margin:20px 0 0;text-align:center;font:13px/1.45 -apple-system,system-ui,sans-serif;'
    + 'color:var(--avn-start-ink);opacity:.7}'
}

/**
 * The line under the spinner the shell writes while a launch does visible work,
 * such as installing an update; empty otherwise.
 */
const STATUS_LINE = '<p class="avn-start-status" role="status" aria-live="polite"></p>'

/**
 * Build the start screen document.
 * @param platform - host platform, which decides whether this page drags the window.
 * @returns a complete HTML document for the start screen window.
 */
export function startPageDocument(platform: NodeJS.Platform): string {
  return brandDocumentHead('light dark', `<style>${startPageStyles(platform)}</style>`)
    + `<body>${platform === 'darwin' ? DRAG_BAND : ''}${loadingFace(undefined, STATUS_LINE)}</body></html>`
}
