/**
 * Contrast: pale grey paper. A black-and-white portrait set over a yellow block, the first name in
 * heavy spaced caps over the family name in light grey caps, and a short yellow rule; the left
 * column lists contact, skills and extras on small yellow squares, the right column runs the
 * timelines along a yellow line with the dates on its left. A yellow square marks each page's
 * lower right corner.
 */
import { BASE, esc, nameParts, photo, standardParts, twoColumnPages } from '../../scripts/blocks.mjs'

export function css() {
  return BASE + `
.page { position: relative; background: var(--c-page); color: var(--c-text); font-size: 10px; line-height: 1.6; }
.page::after { content: ""; position: absolute; right: 26px; bottom: 26px; width: 22px; height: 22px; background: var(--c-accent); }
.head { display: flex; align-items: flex-end; gap: 36px; padding: 44px 48px 30px; }
.ph-wrap { position: relative; flex: none; width: 196px; height: 228px; }
.ph-wrap::before { content: ""; position: absolute; left: 0; top: 0; width: 170px; height: 170px; background: var(--c-accent); }
.ph { position: absolute; left: 22px; top: 22px; width: 174px; height: 206px; object-fit: cover; filter: grayscale(1) contrast(1.05); }
.no-photo { background: #ddd; color: var(--c-ink); font-family: var(--display-font); font-size: 40px; font-weight: 800; }
.given { font-family: var(--display-font); font-size: 36px; font-weight: 800; line-height: 1; letter-spacing: .14em; text-transform: uppercase; color: var(--c-ink); }
.family { margin-top: 6px; font-family: var(--display-font); font-size: 22px; font-weight: 300; letter-spacing: .3em; text-transform: uppercase; color: var(--c-muted); }
.role { margin-top: 14px; font-size: 10px; font-weight: 500; letter-spacing: .22em; text-transform: uppercase; color: var(--c-ink); }
.role::after { content: ""; display: block; width: 44px; height: 3px; margin-top: 12px; background: var(--c-accent); }
.cols { padding: 6px 48px 48px; gap: 30px; }
.page-cont .cols { padding-top: 48px; }
.side { width: 196px; flex: none; }
.main { flex: 1 1 auto; }
.lab { display: flex; align-items: center; gap: 8px; margin-bottom: 9px; font-family: var(--display-font); font-size: 10px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; color: var(--c-ink); }
.lab::before { content: ""; width: 10px; height: 10px; background: var(--c-accent); }
.side-sec { padding-top: 20px; }
.sec-head, .main .sec-whole { padding-top: 20px; }
.flow > :first-child { padding-top: 0; }
.ct-row { margin-bottom: 5px; padding-left: 18px; position: relative; }
.ct-row::before { content: ""; position: absolute; left: 0; top: 4px; width: 9px; height: 9px; border: 1.5px solid var(--c-accent); }
.ct-label { font-size: 8px; letter-spacing: .1em; text-transform: uppercase; color: var(--c-muted); }
.ct-value { color: var(--c-ink); overflow-wrap: anywhere; }
.sk-list .sk-item { position: relative; display: block; padding: 3px 0 3px 18px; border-bottom: 1px dashed var(--c-rule); }
.sk-list .sk-item::before { content: ""; position: absolute; left: 0; top: 7px; width: 9px; height: 9px; background: var(--c-accent); }
.sk-name { color: var(--c-ink); }
.sk-note { display: block; font-size: 8.5px; color: var(--c-muted); }
.tags { gap: 4px; }
.tags li { padding: 2px 8px; border: 1px solid var(--c-accent); font-size: 9px; color: var(--c-ink); }
.lg-item { padding: 2px 0; }
.lg-name { color: var(--c-ink); }
.lg-level { color: var(--c-muted); }
.main .sec-item { position: relative; padding: 0 0 16px 104px; }
.main .sec-item::before { content: ""; position: absolute; left: 88px; top: 0; bottom: 0; width: 2px; background: var(--c-accent); }
.main .sec-item::after { content: ""; position: absolute; left: 84px; top: 4px; width: 10px; height: 10px; background: var(--c-accent); }
.main .e-dates { position: absolute; left: 0; top: 1px; width: 76px; text-align: right; font-size: 9px; font-weight: 500; color: var(--c-muted); }
.e-head { display: block; }
.e-title { font-family: var(--display-font); font-size: 11.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--c-ink); }
.e-org { font-size: 10px; color: var(--c-muted); }
.e-text { margin-top: 4px; }
.li-title { font-family: var(--display-font); font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; color: var(--c-ink); }
.main .li-meta { position: absolute; left: 0; top: 1px; width: 76px; text-align: right; font-size: 9px; color: var(--c-muted); }
.main .li-head { display: block; }
.s-text { color: var(--c-text); }
`
}

export function pages(cv, ctx) {
  const heading = (t) => `<div class="lab">${esc(t)}</div>`
  const { side, main } = standardParts(cv, ctx, { sideHeading: heading, mainHeading: heading, skillsLook: 'list', languagesLook: 'lines' })
  const { given, family } = nameParts(cv)
  const header = `<header class="head"><div class="ph-wrap">${photo(ctx, cv, 'ph')}</div><div><div class="given">${esc(given)}</div><div class="family">${esc(family)}</div>${cv.role ? `<div class="role">${esc(cv.role)}</div>` : ''}</div></header>`
  return twoColumnPages({ header, side, main })
}
