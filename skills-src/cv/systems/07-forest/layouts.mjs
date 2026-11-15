/**
 * Forest: a deep green side column down every page, opening on a large round photo, the name and
 * the role, then details, skills as thin white bars, languages and extras; the white main column
 * carries the profile and the timelines with green organisation lines.
 */
import { BASE, esc, photo, standardParts } from '../../scripts/blocks.mjs'

export function css() {
  return BASE + `
.page { background: var(--c-page); color: var(--c-text); font-size: 10.5px; line-height: 1.6; }
.cols { flex: 1 1 auto; }
.side { width: 250px; flex: none; background: var(--c-side); color: var(--c-side-text); }
.side .flow { padding: 44px 30px 36px; }
.main { flex: 1 1 auto; }
.main .flow { padding: 48px 42px 36px; }
.who { text-align: center; padding-bottom: 8px; }
.ph { width: 150px; height: 150px; margin: 0 auto; border-radius: 50%; object-fit: cover; box-shadow: 0 0 0 5px rgba(255, 255, 255, .18); }
.no-photo { background: rgba(255, 255, 255, .15); color: #fff; font-size: 40px; font-weight: 700; }
.name { margin-top: 18px; font-size: 21px; font-weight: 700; line-height: 1.2; color: #fff; }
.role { margin-top: 3px; font-size: 11px; color: var(--c-side-muted); }
.slab { margin-bottom: 9px; font-size: 12.5px; font-weight: 700; color: #fff; }
.side-sec { padding-top: 24px; }
.ct-row { margin-bottom: 7px; }
.ct-label { font-size: 9px; color: var(--c-side-muted); }
.ct-value { color: #fff; overflow-wrap: anywhere; }
.sk-bars .sk-item + .sk-item { margin-top: 9px; }
.sk-name { color: #fff; }
.sk-level { display: none; }
.sk-bar, .lg-bar { height: 3px; margin-top: 5px; background: rgba(255, 255, 255, .18); }
.sk-bar span, .lg-bar span { background: #fff; }
.lg-bars .lg-item + .lg-item { margin-top: 9px; }
.lg-name { color: #fff; }
.lg-level { font-size: 9px; color: var(--c-side-muted); }
.side .tags { gap: 5px; }
.side .tags li { padding: 2px 9px; border-radius: 3px; background: rgba(255, 255, 255, .12); color: #fff; font-size: 9.5px; }
.side .li-title { color: #fff; font-weight: 600; }
.side .li-meta, .side .li-text { color: var(--c-side-muted); }
.mlab { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; font-size: 15px; font-weight: 700; color: var(--c-ink); }
.mlab::before { content: ""; width: 14px; height: 3px; background: var(--c-accent); }
.sec-head, .main .sec-whole { padding-top: 22px; }
.main .flow > :first-child { padding-top: 0; }
.sec-item { padding-bottom: 14px; }
.e-title { font-size: 12.5px; font-weight: 700; color: var(--c-ink); }
.e-org { font-size: 11px; font-weight: 500; color: var(--c-accent); }
.e-dates { flex: none; font-size: 9.5px; color: var(--c-muted); }
.e-text { margin-top: 4px; }
.e-points { margin-top: 4px; }
.li-title { font-size: 11.5px; font-weight: 700; color: var(--c-ink); }
.li-meta { font-size: 9.5px; color: var(--c-muted); }
.s-text { color: var(--c-text); }
.main .tags { gap: 5px; }
.main .tags li { padding: 2px 9px; border: 1px solid var(--c-rule); border-radius: 3px; }
`
}

export function pages(cv, ctx) {
  const sideHeading = (t) => `<div class="slab">${esc(t)}</div>`
  const mainHeading = (t) => `<div class="mlab">${esc(t)}</div>`
  const { side, main } = standardParts(cv, ctx, { sideHeading, mainHeading, skillsLook: 'bars', languagesLook: 'bars' })
  const who = `<div class="who" data-block>${photo(ctx, cv, 'ph')}<div class="name">${esc(cv.name)}</div>${cv.role ? `<div class="role">${esc(cv.role)}</div>` : ''}</div>`
  const page = (kind, s, m) => `<section class="page ${kind}"><div class="cols"><aside class="side" data-col="side"><div class="flow">${s}</div></aside><main class="main" data-col="main"><div class="flow">${m}</div></main></div></section>`
  return { first: page('page-first', who + side.join(''), main.join('')), continuation: page('page-cont', '', '') }
}
