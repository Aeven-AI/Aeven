/**
 * Sage: a soft sage-to-mint header band with "Name | Role" in Inter and a large serif hello beside
 * a black-and-white portrait; below it two calm columns, experience on the left as "Company |
 * Role" with small dates, education, skills, languages and extras on the right under small orange
 * labels.
 */
import { BASE, esc, photo, standardParts, twoColumnPages } from '../../scripts/blocks.mjs'

export function css() {
  return BASE + `
.page { background: var(--c-page); color: var(--c-text); font-size: 10.5px; line-height: 1.6; }
.band { display: flex; gap: 34px; align-items: flex-end; padding: 40px 52px 28px; background: linear-gradient(120deg, var(--c-band) 0%, #F3F5EE 55%, var(--c-band2) 100%); }
.band-copy { flex: 1; }
.id { font-size: 15px; font-weight: 700; color: var(--c-ink); }
.id span { margin: 0 8px; font-weight: 300; color: var(--c-muted); }
.id em { font-style: normal; font-weight: 400; color: var(--c-muted); }
.hello { margin-top: 22px; font-family: var(--display-font); font-size: 31px; font-weight: 400; line-height: 1.18; letter-spacing: -.01em; color: var(--c-ink); }
.site { margin-top: 18px; font-family: var(--display-font); font-size: 12px; color: var(--c-ink); }
.ph { width: 190px; height: 244px; border-radius: 6px; object-fit: cover; filter: grayscale(1); }
.no-photo { background: #fff; color: var(--c-ink); font-family: var(--display-font); font-size: 46px; }
.cols { padding: 26px 52px 32px; gap: 40px; }
.page-cont .cols { padding-top: 50px; }
.main { flex: 1 1 auto; }
.side { width: 200px; flex: none; }
.lab { margin-bottom: 10px; padding-bottom: 7px; border-bottom: 1px solid var(--c-rule); font-size: 11px; font-weight: 500; color: var(--c-accent); }
.sec-head, .sec-whole, .side-sec { padding-top: 16px; }
.flow > :first-child { padding-top: 0; }
.sec-item { padding-bottom: 11px; }
.e-head { display: block; }
.e-name { display: flex; flex-wrap: wrap; align-items: baseline; }
.e-org { order: -1; font-size: 12px; font-weight: 700; color: var(--c-ink); }
.e-org::after { content: "|"; margin: 0 7px; font-weight: 300; color: var(--c-muted); }
.e-title { font-size: 12px; font-weight: 400; color: var(--c-ink); }
.e-dates { margin-top: 2px; font-size: 8.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--c-muted); }
.e-text { margin-top: 5px; }
.side .e-org, .side .e-title { font-size: 11px; }
.side .e-org::after { display: none; }
.side .e-name { display: block; }
.li-title { font-size: 11px; font-weight: 700; color: var(--c-ink); }
.li-meta { font-size: 9px; color: var(--c-muted); }
.ct-row { margin-bottom: 6px; }
.ct-label { font-size: 8.5px; color: var(--c-muted); }
.ct-value { color: var(--c-ink); overflow-wrap: anywhere; }
.sk-list .sk-item { display: flex; justify-content: space-between; gap: 8px; padding: 3px 0; border-bottom: 1px solid var(--c-rule); }
.sk-name { color: var(--c-ink); }
.sk-note { font-size: 9px; color: var(--c-muted); text-align: right; }
.lg-item { padding: 3px 0; }
.lg-name { color: var(--c-ink); }
.lg-level { color: var(--c-muted); }
.tags { gap: 5px; }
.tags li { padding: 2px 9px; border-radius: 20px; background: var(--c-band); color: var(--c-ink); font-size: 9.5px; }
`
}

export function pages(cv, ctx) {
  const heading = (t) => `<div class="lab">${esc(t)}</div>`
  // The profile lives in the band as the hello when the CV has no greeting of its own.
  const { side, main } = standardParts({ ...cv, profile: cv.greeting ? cv.profile : undefined }, ctx, { sideHeading: heading, mainHeading: heading, skillsLook: 'list', languagesLook: 'lines', educationSide: false })
  const hello = cv.greeting || cv.profile || ''
  const site = cv.contact?.find((c) => /web|site|portfolio/i.test(c.label))?.value
  const header = `<header class="band"><div class="band-copy"><div class="id">${esc(cv.name)}${cv.role ? `<span>|</span><em>${esc(cv.role)}</em>` : ''}</div>${hello ? `<p class="hello">${esc(hello)}</p>` : ''}${site ? `<div class="site">${esc(site)}</div>` : ''}</div>${photo(ctx, cv, 'ph')}</header>`
  return twoColumnPages({ header, side, main })
}
