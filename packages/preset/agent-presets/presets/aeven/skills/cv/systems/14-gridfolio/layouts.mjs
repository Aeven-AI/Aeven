/**
 * Gridfolio: a warm cream page with a soft amber glow. The left column opens on a white rounded
 * card with a large photo, the name, the role in orange and the contact lines; skills and interests
 * follow as two-column lists. The right column carries About me and the timelines, each title in
 * orange as "Role @ Company".
 */
import { BASE, esc, photo, standardParts, twoColumnPages } from '../../scripts/blocks.mjs'

export function css() {
  return BASE + `
.page { position: relative; overflow: hidden; background: var(--c-page); color: var(--c-text); font-size: 10.5px; line-height: 1.6; }
.page::before { content: ""; position: absolute; left: -200px; top: -220px; width: 760px; height: 620px; background: radial-gradient(closest-side, var(--c-glow), rgba(253, 227, 188, 0)); }
.cols { position: relative; padding: 46px 46px 40px; gap: 34px; }
.side { width: 244px; flex: none; }
.main { flex: 1 1 auto; padding-top: 4px; }
.card { padding: 14px 14px 18px; border-radius: 20px; background: var(--c-card); box-shadow: 0 10px 30px rgba(120, 90, 30, .08); }
.ph { width: 100%; height: 250px; border-radius: 14px; object-fit: cover; }
.no-photo { background: var(--c-glow); color: var(--c-ink); font-size: 48px; font-weight: 700; }
.name { margin-top: 14px; padding: 0 4px; font-size: 19px; font-weight: 700; line-height: 1.2; color: var(--c-ink); }
.role { padding: 0 4px; font-size: 12px; font-weight: 500; color: var(--c-accent); }
.card .ct { margin-top: 10px; padding: 0 4px; }
.ct-row { margin-bottom: 3px; }
.ct-label { display: none; }
.ct-value { color: var(--c-text); overflow-wrap: anywhere; }
.slab, .mlab { font-size: 15px; font-weight: 700; color: var(--c-ink); }
.slab { margin-bottom: 8px; }
.side-sec { padding-top: 22px; }
.sk-list, .side .tags { display: grid; grid-template-columns: 1fr 1fr; column-gap: 12px; row-gap: 3px; }
.sk-list .sk-item, .side .tags li { color: var(--c-text); }
.sk-note { display: none; }
.lg-item { padding: 2px 0; }
.lg-name { color: var(--c-ink); }
.lg-level { color: var(--c-muted); }
.mlab { margin-bottom: 8px; }
.sec-head, .main .sec-whole { padding-top: 22px; }
.flow > :first-child { padding-top: 0; }
.sec-item { padding-bottom: 14px; }
.e-head { display: block; }
.e-name { display: flex; flex-wrap: wrap; font-size: 12.5px; font-weight: 600; color: var(--c-accent); }
.e-title::after { content: " @ "; white-space: pre; }
.e-org { font-weight: 600; }
.e-dates { margin-top: 1px; font-size: 9.5px; color: var(--c-muted); }
.e-text { margin-top: 4px; }
.li-title { font-size: 12px; font-weight: 600; color: var(--c-accent); }
.li-meta { font-size: 9.5px; color: var(--c-muted); }
.s-text { color: var(--c-text); }
`
}

export function pages(cv, ctx) {
  const sideHeading = (t) => `<div class="slab">${esc(t)}</div>`
  const mainHeading = (t) => `<div class="mlab">${esc(t)}</div>`
  const { side, main } = standardParts(cv, ctx, { sideHeading, mainHeading, skillsLook: 'list', languagesLook: 'lines', contactSide: false })
  const contact = cv.contact?.length ? `<div class="ct">${cv.contact.map((r) => `<div class="ct-row"><span class="ct-value">${esc(r.value)}</span></div>`).join('')}</div>` : ''
  const card = `<div class="card" data-block>${photo(ctx, cv, 'ph')}<div class="name">${esc(cv.name)}</div>${cv.role ? `<div class="role">${esc(cv.role)}</div>` : ''}${contact}</div>`
  return twoColumnPages({ side: [card, ...side], main })
}
