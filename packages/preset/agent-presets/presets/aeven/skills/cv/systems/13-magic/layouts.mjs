/**
 * Magic: a near-black page under a violet and blue aurora. A large avatar in a gradient ring beside
 * the name, the role and contact items on coloured dots; the summary; then compact sections under
 * small accent squares: experience with the role in violet and the dates on the right, skills in a
 * three-column grid, languages and extras in rows.
 */
import { BASE, esc, photo, sectionBlocks, oneColumnPages } from '../../scripts/blocks.mjs'

const DOTS = ['accent', 'blue', 'green', 'orange']

export function css() {
  return BASE + `
.page { position: relative; overflow: hidden; background: var(--c-page); color: var(--c-text); font-size: 10.5px; line-height: 1.6; }
.page-first::before { content: ""; position: absolute; inset: 0 0 auto 0; height: 420px; background: radial-gradient(60% 90% at 18% 0%, rgba(169, 139, 255, .55), transparent 70%), radial-gradient(55% 80% at 85% 0%, rgba(78, 139, 255, .5), transparent 70%), radial-gradient(40% 50% at 55% 10%, rgba(63, 214, 164, .18), transparent 70%); }
.main { position: relative; flex: 1 1 auto; }
.main .flow { padding: 0 56px 44px; }
.page-cont .main .flow { padding-top: 54px; }
.hero { display: flex; align-items: center; gap: 28px; padding: 60px 0 26px; }
.ring { flex: none; width: 150px; height: 150px; padding: 4px; border-radius: 50%; background: conic-gradient(from 200deg, var(--c-accent), var(--c-blue), var(--c-green), var(--c-accent)); }
.ph { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; border: 4px solid var(--c-page); }
.no-photo { background: #1b1d25; color: #fff; font-size: 40px; font-weight: 600; }
.name { font-size: 34px; font-weight: 600; line-height: 1.1; letter-spacing: -.02em; color: var(--c-ink); }
.role { margin-top: 4px; font-size: 14px; color: var(--c-muted); }
.links { display: flex; flex-wrap: wrap; gap: 6px 16px; margin-top: 14px; }
.links span { display: inline-flex; align-items: center; gap: 6px; font-size: 10px; color: var(--c-text); }
.links i { width: 7px; height: 7px; border-radius: 50%; }
.summary { padding-bottom: 6px; color: var(--c-text); max-width: 620px; }
.lab { display: flex; align-items: center; gap: 9px; margin-bottom: 10px; padding-bottom: 8px; border-bottom: 1px solid var(--c-rule); font-size: 13px; font-weight: 600; color: var(--c-ink); }
.lab::before { content: ""; width: 9px; height: 9px; border-radius: 2px; background: var(--c-accent); }
.sec-head, .sec-whole { padding-top: 22px; }
.main .flow > :first-child:not(.hero) { padding-top: 0; }
.sec-item { padding-bottom: 12px; }
.e-name { display: flex; flex-direction: column-reverse; }
.e-org { font-size: 12px; font-weight: 600; color: var(--c-ink); }
.e-title { font-size: 10.5px; font-weight: 500; color: var(--c-accent); }
.e-dates { flex: none; font-size: 9.5px; color: var(--c-muted); }
.e-text { margin-top: 4px; }
.e-points { margin-top: 3px; color: var(--c-text); }
.li-title { font-size: 11.5px; font-weight: 600; color: var(--c-ink); }
.li-meta { font-size: 9.5px; color: var(--c-muted); }
.li-text { color: var(--c-text); }
.grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.cell { padding: 10px 12px; border: 1px solid var(--c-rule); border-radius: 8px; background: rgba(255, 255, 255, .02); }
.cell b { display: block; font-size: 11px; font-weight: 600; color: var(--c-ink); }
.cell small { font-size: 9px; color: var(--c-muted); }
.meter { height: 3px; margin-top: 7px; border-radius: 3px; background: var(--c-rule); }
.meter span { display: block; height: 100%; border-radius: 3px; background: linear-gradient(90deg, var(--c-accent), var(--c-blue)); }
.tags { gap: 6px; }
.tags li { padding: 3px 10px; border: 1px solid var(--c-rule); border-radius: 20px; font-size: 9.5px; color: var(--c-ink); }
.s-text { color: var(--c-text); }
`
}

export function pages(cv, ctx) {
  const { labels } = ctx
  const heading = (t) => `<div class="lab">${esc(t)}</div>`
  const blocks = []
  const links = (cv.contact ?? []).map((c, i) => `<span><i style="background:var(--c-${DOTS[i % DOTS.length]})"></i>${esc(c.value)}</span>`).join('')
  blocks.push(`<div class="hero" data-block><div class="ring">${photo(ctx, cv, 'ph', cv.photo?.zoom ?? 1.5)}</div><div><h1 class="name">${esc(cv.name)}</h1>${cv.role ? `<div class="role">${esc(cv.role)}</div>` : ''}${links ? `<div class="links">${links}</div>` : ''}</div></div>`)
  if (cv.profile) blocks.push(`<div class="summary" data-block><p>${esc(cv.profile)}</p></div>`)
  for (const s of cv.sections ?? []) blocks.push(...sectionBlocks(s, heading, { cls: 'sec' }))
  if (cv.skills?.length) {
    blocks.push(`<div class="sec-whole" data-block>${heading(labels.skills)}<div class="grid3">${cv.skills.map((s) => `<div class="cell"><b>${esc(s.name)}</b>${s.note ? `<small>${esc(s.note)}</small>` : ''}<div class="meter"><span style="width:${Math.round(s.level)}%"></span></div></div>`).join('')}</div></div>`)
  }
  if (cv.languages?.length) {
    blocks.push(`<div class="sec-whole" data-block>${heading(labels.languages)}<div class="grid3">${cv.languages.map((l) => `<div class="cell"><b>${esc(l.name)}</b>${l.level ? `<small>${esc(l.level)}</small>` : ''}</div>`).join('')}</div></div>`)
  }
  for (const s of cv.sidebar ?? []) blocks.push(...sectionBlocks(s, heading, { cls: 'sec' }))
  return oneColumnPages({ main: blocks })
}
