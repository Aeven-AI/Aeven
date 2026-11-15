/**
 * Glow: warm paper with a grainy orange glow rising from the lower left. The name and role as one
 * wide Unbounded headline; numbered section labels over hairlines; contact, photo, skills and
 * languages in the narrow left column, experience and the rest on the right.
 */
import { BASE, esc, photo, standardParts, twoColumnPages } from '../../scripts/blocks.mjs'

const GRAIN = "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .55 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")"

export function css() {
  return BASE + `
.page { position: relative; overflow: hidden; background: var(--c-page); color: var(--c-text); font-size: 10px; line-height: 1.55; }
.page::before { content: ""; position: absolute; left: -260px; bottom: -300px; width: 820px; height: 820px; border-radius: 50%; background: radial-gradient(circle, var(--c-glow) 0%, var(--c-glow2) 26%, rgba(255, 201, 74, .35) 45%, rgba(237, 236, 233, 0) 68%); filter: blur(8px); }
.page::after { content: ""; position: absolute; inset: 0; background-image: ${GRAIN}; opacity: .22; mix-blend-mode: multiply; pointer-events: none; }
.page > * { position: relative; z-index: 1; }
.head { display: flex; gap: 34px; padding: 48px 48px 26px; }
.head-side { width: 176px; flex: none; }
.ph { width: 176px; height: 220px; object-fit: cover; border-radius: 3px; }
.no-photo { background: var(--c-glow); color: var(--c-ink); font-family: var(--display-font); font-size: 44px; }
.name { font-family: var(--display-font); font-size: 34px; font-weight: 600; line-height: 1.08; letter-spacing: -.01em; color: var(--c-ink); }
.head-main { display: flex; flex-direction: column; justify-content: space-between; }
.summary { margin-top: 18px; max-width: 360px; font-size: 10.5px; color: var(--c-text); }
.cols { padding: 0 48px 40px; gap: 34px; }
.page-cont .cols { padding-top: 48px; }
.side { width: 176px; flex: none; }
.main { flex: 1 1 auto; }
.lab { display: flex; justify-content: space-between; padding-bottom: 5px; margin-bottom: 9px; border-bottom: 1px solid var(--c-rule); font-size: 8.5px; font-weight: 600; letter-spacing: .07em; text-transform: uppercase; color: var(--c-ink); }
.lab b { font-weight: 500; color: var(--c-muted); }
.sec-head, .main .sec-whole { padding-top: 18px; }
.main .flow > :first-child, .side .flow > :first-child { padding-top: 0; }
.side-sec { padding-top: 18px; }
.sec-item { padding-bottom: 13px; }
.e-dates { font-size: 8.5px; letter-spacing: .03em; color: var(--c-muted); }
.e-head { display: block; }
.e-title { font-size: 11px; font-weight: 700; color: var(--c-ink); }
.e-org { font-size: 10px; color: var(--c-text); }
.e-text { margin-top: 4px; }
.li-title { font-size: 10.5px; font-weight: 700; color: var(--c-ink); }
.li-meta { font-size: 8.5px; color: var(--c-muted); }
.ct-row { margin-bottom: 4px; }
.ct-label { font-size: 7.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--c-muted); }
.ct-value { font-size: 9.5px; font-weight: 500; color: var(--c-ink); overflow-wrap: anywhere; }
.sk-bars .sk-item + .sk-item { margin-top: 7px; }
.sk-name { color: var(--c-ink); }
.sk-level { font-size: 8.5px; color: var(--c-muted); }
.sk-bar { height: 2px; margin-top: 4px; background: var(--c-rule); }
.sk-bar span { background: var(--c-ink); }
.lg-item { padding: 3px 0; border-bottom: 1px solid rgba(0, 0, 0, .06); }
.lg-name { color: var(--c-ink); }
.lg-level { color: var(--c-muted); }
.tags { gap: 4px; }
.tags li { padding: 2px 8px; border: 1px solid var(--c-rule); border-radius: 20px; font-size: 9px; color: var(--c-ink); }
`
}

export function pages(cv, ctx) {
  let n = 0
  const heading = (title) => `<div class="lab"><span>${esc(title)}</span><b>${String(++n).padStart(2, '0')}</b></div>`
  const { side, main } = standardParts(cv, ctx, { sideHeading: heading, mainHeading: heading, skillsLook: 'bars', languagesLook: 'lines', profileSide: false })
  // The profile sits under the headline instead of in the main column.
  const body = cv.profile ? main.slice(1) : main
  const header = `<header class="head"><div class="head-side">${photo(ctx, cv, 'ph')}</div><div class="head-main"><h1 class="name">${esc(cv.name)},<br>${esc(cv.role ?? '')}</h1>${cv.profile ? `<p class="summary">${esc(cv.profile)}</p>` : ''}</div></header>`
  return twoColumnPages({ header, side, main: body })
}
