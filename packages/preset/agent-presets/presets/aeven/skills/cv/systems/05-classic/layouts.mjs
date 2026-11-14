/**
 * Classic: a white A4 page under a heavy black top rule. The name in bold Inter with the role
 * beneath, the photo in a circle on a yellow ring at the top right; experience and education in the
 * wide left column under small spaced labels, contact, skills and languages in the narrow right one.
 */
import { BASE, esc, photo, standardParts, twoColumnPages } from '../../scripts/blocks.mjs'

export function css() {
  return BASE + `
.page { background: var(--c-page); color: var(--c-text); border-top: 7px solid var(--c-rule); font-size: 10.5px; line-height: 1.55; }
.head { display: flex; justify-content: space-between; align-items: center; padding: 44px 56px 6px; }
.name { font-size: 32px; font-weight: 700; line-height: 1.1; letter-spacing: -.02em; color: var(--c-ink); }
.role { margin-top: 6px; font-size: 17px; font-weight: 400; color: var(--c-ink); }
.ph { width: 118px; height: 118px; border-radius: 50%; object-fit: cover; box-shadow: 0 0 0 7px var(--c-accent); margin-right: 7px; }
.no-photo { background: var(--c-accent); color: var(--c-ink); font-size: 34px; font-weight: 700; }
.cols { flex-direction: row-reverse; padding: 18px 56px 40px; gap: 44px; }
.page-cont .cols { padding-top: 46px; }
.main { flex: 1 1 auto; }
.side { width: 182px; flex: none; }
.lab { font-size: 8px; font-weight: 600; letter-spacing: .22em; text-transform: uppercase; color: var(--c-muted); }
.sec-head, .main .sec-whole { padding-top: 20px; }
.main .flow > :first-child { padding-top: 0; }
.sec-head .lab, .main .sec-whole .lab { margin-bottom: 8px; }
.sec-item { padding-bottom: 14px; }
.e-head { display: block; }
.e-title { font-size: 11.5px; font-weight: 700; color: var(--c-ink); }
.e-org { font-size: 11px; color: var(--c-ink); }
.e-dates { margin-top: 1px; font-size: 9px; color: var(--c-muted); }
.e-text { margin-top: 4px; }
.e-points { margin-top: 3px; }
.li-title { font-size: 11px; font-weight: 700; color: var(--c-ink); }
.li-meta { font-size: 9px; color: var(--c-muted); }
.s-text { color: var(--c-text); }
.side-sec { padding-bottom: 18px; }
.side-sec .lab { margin-bottom: 6px; color: var(--c-ink); letter-spacing: .02em; text-transform: none; font-size: 10.5px; font-weight: 700; }
.ct-row { margin-bottom: 3px; }
.ct-label { display: none; }
.ct-value { color: var(--c-text); overflow-wrap: anywhere; }
.sk-item { color: var(--c-text); }
.sk-note { display: none; }
.lg-item { color: var(--c-text); }
.lg-level { color: var(--c-muted); }
.tags { flex-direction: column; }
.tags li { color: var(--c-text); }
`
}

export function pages(cv, ctx) {
  const heading = (title) => `<div class="lab">${esc(title)}</div>`
  const { side, main } = standardParts(cv, ctx, { sideHeading: heading, mainHeading: heading, skillsLook: 'list', languagesLook: 'lines', educationSide: false })
  const header = `<header class="head"><div><h1 class="name">${esc(cv.name)}</h1>${cv.role ? `<div class="role">${esc(cv.role)}</div>` : ''}</div>${photo(ctx, cv, 'ph', cv.photo?.zoom ?? 1.9)}</header>`
  return twoColumnPages({ header, side, main })
}
