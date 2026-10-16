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
 * Styles the window's own scheme and ink: the colours the client's preloader
 * paints as soon as it replaces this page.
 */
function startPageStyles(): string {
  return 'html{color-scheme:light dark}'
    + ':root{--avn-start-bg:rgb(242,242,242);--avn-start-ink:#000000}'
    + '@media (prefers-color-scheme:dark){:root{--avn-start-bg:#111111;--avn-start-ink:rgb(249,250,251)}}'
    + 'html,body{margin:0;height:100%;background:var(--avn-start-bg);color:var(--avn-start-ink)}'
    + 'body{display:flex;align-items:center;justify-content:center}'
    + loadingFaceStyles()
    + '.logo,.spinner{color:var(--avn-start-ink)}'
}

/**
 * Build the start screen document.
 * @returns a complete HTML document for the start screen window.
 */
export function startPageDocument(): string {
  return brandDocumentHead('light dark', `<style>${startPageStyles()}</style>`)
    + `<body>${loadingFace()}</body></html>`
}
