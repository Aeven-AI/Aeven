/**
 * The Æven brand page: the one design every page outside the application shell
 * uses. A sign-in handoff, a finished sign-in, a connector consent and a billing
 * return each draw the same centred lockup on the same sheet, and differ only in
 * the line under the wordmark and in whether the page waits (the mark and the
 * spinner, then the wordmark) or reports (the wordmark at once).
 *
 * The face is inlined into every page, so a page served on a loopback port that
 * knows no asset routes still sets the wordmark in the product's own type, and
 * nothing in the document fetches from anywhere.
 *
 * Pages that run no script — a page behind a policy that refuses it — drop the
 * font gate: {@link brandPageHtml} can render with `scripted: false`, and the
 * stylesheet reveals the lockup with its entrance instead of waiting.
 * @module @aeven/brand-page
 */

import { readFileSync } from 'node:fs'

/** The face the wordmark is set in, shipped beside this module rather than fetched. */
const FONT_FILE = new URL('../assets/google-sans-flex-latin-wght-normal.woff2', import.meta.url)

/** How long a page waits for the face before it shows the lockup anyway. */
const FONT_GATE_TIMEOUT_MS = 3500

/** What the renderer puts in the `@font-face` source. The stylesheet states it verbatim. */
const FONT_TOKEN = '__AEVEN_PAGE_FONT__'

/**
 * The design: the coming-soon sheet, grain, cover and lockup, with one line of
 * message and one line of direction under the wordmark.
 *
 * `// <brand-page-css>` and `// </brand-page-css>` mark the block verbatim, so a
 * deployment that keeps its own copy of the stylesheet can be compared against
 * this one instead of drifting from it.
 */
// <brand-page-css>
export const BRAND_PAGE_CSS = `/* Æven brand page.
   One centred lockup on a plain sheet: the name, and the line that fits what
   just happened. The cover is the product's first paint, for pages that wait. */

@font-face {
  font-family: "Google Sans Flex";
  src: url("__AEVEN_PAGE_FONT__") format("woff2");
  font-weight: 1 1000;
  font-stretch: 100%;
  font-style: normal;
  font-display: block;
}

:root {
  --bg: #f2f2f2;
  --ink: #000000;
  --quiet: rgba(0, 0, 0, 0.62);
  --settle: cubic-bezier(0.2, 0.84, 0.24, 1);
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body {
  height: 100%;
}

body {
  margin: 0;
  overflow: hidden;
  background-color: var(--bg);
  color: var(--ink);
  font-family: "Google Sans Flex", system-ui, -apple-system, "Segoe UI", sans-serif;
  font-optical-sizing: auto;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

::selection {
  background-color: var(--ink);
  color: var(--bg);
}

/* ---------------------------------------------------------------- boot cover */

.cover {
  display: none;
  position: fixed;
  inset: 0;
  z-index: 3;
  width: 100vw;
  max-width: 100%;
  height: 100%;
  align-items: center;
  justify-content: center;
  background-color: var(--bg);
}

.cover__stack {
  display: flex;
  align-items: center;
  flex-direction: column;
}

.cover__mark {
  display: block;
  width: 50px;
  height: 50px;
  margin-bottom: 4px;
  color: var(--ink);
}

.cover__spinner {
  display: block;
  width: 18px;
  height: 18px;
  color: var(--ink);
  animation: spin 900ms linear infinite;
}

@keyframes cover-lift {
  to {
    opacity: 0;
    visibility: hidden;
  }
}

@keyframes cover-blur {
  to {
    filter: blur(1px);
  }
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

/* ------------------------------------------------------------------ the gate */

/* A page that waits marks itself fonts-loading before the first paint: the cover
   is what the reader sees while the face is in, and the lockup stays hidden
   until it is, so no glyph is ever drawn in a fallback. Swapping to fonts-ready
   is what starts the intro. A page with no script carries neither class, which
   is the resting state below: type, cover gone. */

html.page-waiting.fonts-loading .cover {
  display: flex;
}

html.page-waiting.fonts-loading .lockup {
  visibility: hidden;
}

/* ------------------------------------------------------------- paper texture */

.grain {
  position: fixed;
  inset: -60%;
  z-index: 2;
  width: 220%;
  height: 220%;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='240' height='240' filter='url(%23n)'/%3E%3C/svg%3E");
  opacity: 0.07;
  mix-blend-mode: multiply;
  pointer-events: none;
  animation: breathe 13s ease-in-out infinite alternate;
}

@keyframes breathe {
  from {
    opacity: 0.055;
  }
  to {
    opacity: 0.085;
  }
}

/* ------------------------------------------------------------------- lockup */

.lockup {
  display: flex;
  position: relative;
  z-index: 1;
  height: 100dvh;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  padding: clamp(24px, 4vw, 56px);
  text-align: center;
}

h1 {
  margin: 0;
  font-size: clamp(3.25rem, 11vw, 10rem);
  font-weight: 520;
  line-height: 0.94;
  letter-spacing: -0.035em;
}

.note {
  margin: clamp(18px, 2.6vh, 30px) 0 0;
  max-width: 26em;
  font-size: clamp(0.95rem, 1.15vw, 1.1rem);
  font-weight: 460;
  line-height: 1.4;
  letter-spacing: 0.005em;
  text-wrap: balance;
}

.hint {
  margin: 12px 0 0;
  max-width: 30em;
  color: var(--quiet);
  font-size: clamp(0.85rem, 1vw, 0.95rem);
  font-weight: 450;
  line-height: 1.45;
  letter-spacing: 0.005em;
  text-wrap: balance;
}

@keyframes settle {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

/* A page that waits holds its lockup behind the cover, then the cover lifts and
   the wordmark arrives on its heels. */

@media (prefers-reduced-motion: no-preference) {
  html.page-waiting.fonts-ready .cover {
    display: flex;
    animation: cover-lift 420ms linear 780ms forwards;
  }

  html.page-waiting.fonts-ready .cover__mark {
    animation: cover-blur 420ms ease-out 780ms forwards;
  }

  html.page-waiting:not(.fonts-loading) h1 {
    animation: settle 900ms var(--settle) 1000ms both;
  }

  html.page-waiting:not(.fonts-loading) .note {
    animation: settle 900ms var(--settle) 1110ms both;
  }

  html.page-waiting:not(.fonts-loading) .hint {
    animation: settle 900ms var(--settle) 1200ms both;
  }

  /* A page that reports has no cover to wait for, so the lockup arrives at once. */
  html.page-result:not(.fonts-loading) h1 {
    animation: settle 900ms var(--settle) both;
  }

  html.page-result:not(.fonts-loading) .note {
    animation: settle 900ms var(--settle) 110ms both;
  }

  html.page-result:not(.fonts-loading) .hint {
    animation: settle 900ms var(--settle) 190ms both;
  }
}

/* ------------------------------------------------------------ reduced motion */

@media (prefers-reduced-motion: reduce) {
  html.fonts-loading .cover,
  html.fonts-ready .cover,
  .grain {
    display: none;
  }

  html.fonts-loading .lockup,
  html.fonts-ready .lockup {
    visibility: visible;
  }
}
`
// </brand-page-css>

/** The Æven mark, drawn in `currentColor` so the page owns its ink. */
const MARK_SVG = '<svg class="cover__mark" viewBox="0 0 671 581" aria-hidden="true">'
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

/** The loading mark drawn under the Æven mark. */
const SPINNER_SVG = '<svg class="cover__spinner" viewBox="0 0 24 24" fill="none" aria-hidden="true">'
  + '<path d="M16 16L19 19M18 12H22M8 8L5 5M16 8L19 5M8 16L5 19M2 12H6M12 2V6M12 18V22"'
  + ' stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'

/** The mark alone, as the tab icon, so the page needs no request for it. */
const FAVICON = 'data:image/svg+xml,'
  + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 671 581">'
    + '<rect width="671" height="581" fill="#f2f2f2"/>'
    + '<g fill="#000" fill-rule="evenodd" transform="translate(84 41) scale(0.75)">'
    + '<path d="m225.301 0 305.5 529.142-43.301 25L182 25z"/>'
    + '<path d="M140 529.141 445.5 0l43.302 25-305.5 529.141z"/>'
    + '<path d="M167.901 530.059h335v50h-335z"/>'
    + '<path d="m43.302 264.5 167.5 290.119-43.302 25L0 289.5zM503.302 0l167.5 290.119-43.302 25L460 25z"/>'
    + '<path d="M460 554.618 627.5 264.5l43.301 25-167.5 290.118zM0 290.118 167.5 0 210.8 25l-167.5 290.118z"/>'
    + '<path d="M167.5 0h57.8v50h-57.8zM445.5 0h57.8v50h-57.8zM72.5 405.3 306.5 0l43.302 25-234 405.3z"/>'
    + '<path d="m364.301 0 234 405.3-43.3 25L321 25z"/>'
    + '<path d="M306.5 0h57.8v50h-57.8z"/>'
    + '</g></svg>')

/** The inlined face, read once. */
let fontSource: string | undefined

/**
 * The `@font-face` source: the shipped face as a data URI.
 * @returns the URL the stylesheet sets the wordmark in.
 */
function inlineFont(): string {
  fontSource ??= `data:font/woff2;base64,${readFileSync(FONT_FILE).toString('base64')}`
  return fontSource
}

/**
 * Escape text for HTML content or a double-quoted attribute value.
 * @param text - unescaped text.
 * @returns the text with markup-significant characters as references.
 */
export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/** What a page says, and how it arrives. */
export interface BrandPageOptions {
  /** Line under the wordmark: what just happened. */
  readonly note: string
  /** Second line, quieter: what the reader does next. */
  readonly hint?: string
  /**
   * `waiting` holds the mark and spinner while the page is on its way somewhere
   * else, then lifts the cover off the wordmark; `result` settles straight to
   * the wordmark. @default 'result'
   */
  readonly state?: 'waiting' | 'result'
  /** Tab line. @default 'Æven' */
  readonly title?: string
  /** The document's `lang`. @default 'en' */
  readonly lang?: string
  /** Leave for this URL as soon as the page paints, keeping this page as the referer. */
  readonly redirect?: string
  /**
   * Run the font gate and the redirect. A page served under a policy that
   * refuses script renders with `false`, and its stylesheet reveals the lockup
   * on the entrance alone. @default true
   */
  readonly scripted?: boolean
}

/**
 * The gate a scripted page runs: reveal the lockup once the face can render, or
 * when the budget expires.
 * @returns the inline script element body.
 */
function gateScript(): string {
  return '(function(){'
    + 'var root=document.documentElement,settled=false;'
    + 'function reveal(){if(settled)return;settled=true;root.classList.remove("fonts-loading");root.classList.add("fonts-ready")}'
    + `var timer=window.setTimeout(reveal,${String(FONT_GATE_TIMEOUT_MS)});`
    + 'if(!document.fonts||!document.fonts.load){reveal();return}'
    + 'Promise.all([document.fonts.load(\'520 16px "Google Sans Flex"\',"\u00c6ven"),'
    + 'document.fonts.load(\'460 16px "Google Sans Flex"\',"\u00c6ven")])'
    + '.then(function(){window.clearTimeout(timer);reveal()},function(){window.clearTimeout(timer);reveal()})'
    + '})();'
}

/**
 * Render one brand page.
 *
 * The document carries everything it needs: the stylesheet, the mark, the tab
 * icon and the face. Nothing is fetched from another origin, and a page with no
 * caller-supplied redirect runs no navigation of its own.
 * @param options - the message, the state, and the document's identity.
 * @returns the complete HTML document.
 */
export function brandPageHtml(options: BrandPageOptions): string {
  const state = options.state ?? 'result'
  const scripted = options.scripted ?? true
  const title = options.title ?? 'Æven'
  const lang = options.lang ?? 'en'
  const font = inlineFont()
  const html = [
    'page-' + state,
    ...scripted ? ['fonts-loading'] : [],
  ].join(' ')
  const cover = state === 'waiting' && scripted
    ? '<div class="cover" aria-hidden="true"><div class="cover__stack">'
      + MARK_SVG + SPINNER_SVG
      + '</div></div>'
    : ''
  const trailers = scripted
    ? (options.redirect === undefined
      ? ''
      : `<meta http-equiv="refresh" content="0; url=${escapeHtml(options.redirect)}">`
        + `<script>location.replace(${JSON.stringify(options.redirect)})</script>`)
      + `<script>${gateScript()}</script>`
    : ''
  return '<!doctype html>'
    + `<html lang="${escapeHtml(lang)}" class="${html}">`
    + '<head>'
    + '<meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
    + '<meta name="color-scheme" content="light">'
    + '<meta name="theme-color" content="#f2f2f2">'
    + `<title>${escapeHtml(title)}</title>`
    + `<link rel="icon" href="${FAVICON}">`
    + `<style>${BRAND_PAGE_CSS.replace(FONT_TOKEN, font)}</style>`
    + '</head>'
    + '<body>'
    + cover
    + '<div class="grain" aria-hidden="true"></div>'
    + '<main class="lockup">'
    + '<h1>Æven</h1>'
    + `<p class="note">${escapeHtml(options.note)}</p>`
    + (options.hint === undefined ? '' : `<p class="hint">${escapeHtml(options.hint)}</p>`)
    + '</main>'
    + trailers
    + '</body></html>'
}
