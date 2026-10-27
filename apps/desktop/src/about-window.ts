/**
 * The page **About Aeven** shows, drawn by the shell instead of handed to
 * AppKit's about panel.
 *
 * The system panel prints `Version <application version> (<build version>)`,
 * and the packaged Info.plist repeats the release in both keys, so it reads as
 * the same version twice; the panel also fixes its own type, sizes, and
 * spacing. This page prints one line per fact in one column, so the copy, the
 * type, and the rhythm are the shell's own.
 * @module @aeven/desktop/about-window
 */

import { brandMarkSvg, escapeHtml } from './brand-page.ts'

/** Size of the about window in CSS pixels. */
export const ABOUT_WINDOW_WIDTH = 340
export const ABOUT_WINDOW_HEIGHT = 285

/**
 * Height of the title strip the page draws under macOS's traffic lights, which
 * `titleBarStyle: 'hiddenInset'` leaves to the page.
 */
export const ABOUT_TITLE_BAR_HEIGHT = 38

/** What the column prints, already resolved to the reader's locale. */
export interface AboutPageContent {
  /** Strip title, the same words as the menu item that opens the window. */
  readonly title: string
  /** Product name, printed under the mark. */
  readonly name: string
  /** Running application version, as a `Version …` line. */
  readonly version: string
  /** Installed backend version; omitted before a first launch installs one. */
  readonly backend: string | undefined
  /** Electron's version, which a bug report needs. */
  readonly electron: string
  /** Copyright line, the last row of the column. */
  readonly copyright: string
}

/** The mark, drawn in the icon tile's ink. */
const ICON_MARK = brandMarkSvg()

/** Styles the page needs, for both schemes. */
function aboutPageStyles(platform: NodeJS.Platform): string {
  return ':root{color-scheme:light dark;--avn-about-bg:#ffffff;--avn-about-ink:#111111;'
    + '--avn-about-muted:#5a5a5a;--avn-about-faint:#6f6f6f;--avn-about-hairline:rgb(0 0 0 / 10%)}'
    + '@media (prefers-color-scheme:dark){:root{--avn-about-bg:#1f1f1f;--avn-about-ink:#f2f2f2;'
    + '--avn-about-muted:#b0b0b0;--avn-about-faint:#9a9a9a;--avn-about-hairline:rgb(255 255 255 / 10%)}}'
    + 'html,body{margin:0;height:100%;background:var(--avn-about-bg);color:var(--avn-about-ink);'
    + "font:12px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;"
    + '-webkit-font-smoothing:antialiased}'
    // One column and no controls: the text is read, never selected or dragged.
    + 'body{display:flex;flex-direction:column;overflow:hidden;user-select:none;cursor:default}'
    + `.avn-about-titlebar{flex:0 0 ${String(ABOUT_TITLE_BAR_HEIGHT)}px;display:flex;align-items:center;`
    + 'padding:0 16px 0 82px;border-bottom:1px solid var(--avn-about-hairline);-webkit-app-region:drag}'
    + '.avn-about-titlebar span{font-size:13px;font-weight:600}'
    + 'main{flex:1;display:flex;flex-direction:column;align-items:center;text-align:center;'
    + 'padding:26px 28px 22px;box-sizing:border-box}'
    // The application icon: the shipped tile gradient under the mark.
    + '.avn-about-icon{flex:none;width:56px;height:56px;border-radius:13px;'
    + 'display:flex;align-items:center;justify-content:center;'
    + 'background:linear-gradient(225deg,#ffffff 0%,#e6e6e6 100%);'
    + 'box-shadow:0 1px 3px rgb(0 0 0 / 10%),inset 0 0 0 0.5px rgb(0 0 0 / 5%)}'
    + '.avn-about-icon svg{display:block;width:32px;height:32px;color:#222222}'
    + 'h1{margin:14px 0 0;font-size:15px;font-weight:700;letter-spacing:-0.01em}'
    + '.avn-about-row{margin:0;font-size:12px;line-height:16px;color:var(--avn-about-muted)}'
    + 'h1+.avn-about-row{margin-top:12px}'
    + '.avn-about-row+.avn-about-row{margin-top:2px}'
    + '.avn-about-row+.avn-about-row:last-of-type{margin-top:12px}'
    + '.avn-about-copyright{margin:14px 0 0;font-size:11px;line-height:16px;color:var(--avn-about-faint)}'
    + (platform === 'darwin' ? '' : 'main{justify-content:center}')
}

/**
 * Build the about window's document.
 * @param platform - host platform, which decides whether the page draws its own title strip.
 * @param content - the rows the column prints, in the reader's locale.
 * @returns a complete HTML document for the about window.
 */
export function aboutPageDocument(platform: NodeJS.Platform, content: AboutPageContent): string {
  const rows = [content.version, content.backend, content.electron]
    .filter((line): line is string => line !== undefined)
    .map(line => `<p class="avn-about-row">${escapeHtml(line)}</p>`)
    .join('')
  const titleBar = platform === 'darwin'
    ? `<div class="avn-about-titlebar"><span>${escapeHtml(content.title)}</span></div>`
    : ''
  return '<!doctype html><html><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<meta name="color-scheme" content="light dark">'
    + `<title>${escapeHtml(content.title)}</title>`
    + `<style>${aboutPageStyles(platform)}</style></head><body>${titleBar}`
    + `<main><div class="avn-about-icon" aria-hidden="true">${ICON_MARK}</div>`
    + `<h1>${escapeHtml(content.name)}</h1>${rows}`
    + `<p class="avn-about-copyright">${escapeHtml(content.copyright)}</p>`
    + '</main></body></html>'
}
