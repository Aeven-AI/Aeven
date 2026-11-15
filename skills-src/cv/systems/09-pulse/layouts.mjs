/**
 * Pulse: an electric blue-to-magenta page framing two cards. The glass side card holds a large
 * round photo, the first name light over the family name bold, the role, contact pills, languages
 * as dots and extras; the white main card runs the profile, timelines under dark label tabs with
 * a rule, and the skills as blue rings.
 */
import { BASE, esc, nameParts, photo, standardParts } from '../../scripts/blocks.mjs'

export function css() {
  return BASE + `
.page { background: linear-gradient(160deg, var(--c-page) 0%, #7B4FE0 55%, var(--c-page2) 100%); color: var(--c-text); font-size: 10px; line-height: 1.55; }
.cols { padding: 24px; gap: 16px; }
.side { width: 252px; flex: none; border-radius: 12px; background: rgba(255, 255, 255, .17); color: #fff; }
.side .flow { padding: 26px 20px 22px; }
.main { flex: 1 1 auto; border-radius: 12px; background: var(--c-card); }
.main .flow { padding: 26px 24px 22px; }
.who { text-align: center; }
.ph { width: 168px; height: 168px; margin: 0 auto; border-radius: 50%; object-fit: cover; border: 5px solid #fff; }
.no-photo { background: rgba(255, 255, 255, .25); color: #fff; font-size: 44px; font-weight: 700; }
.given { margin-top: 14px; font-size: 22px; font-weight: 300; line-height: 1.1; color: #fff; }
.family { font-size: 30px; font-weight: 600; line-height: 1.1; color: #fff; }
.role { margin-top: 4px; font-size: 12px; font-weight: 600; color: rgba(255, 255, 255, .82); }
.side-sec { margin-top: 14px; padding: 12px 14px; border-radius: 8px; background: rgba(255, 255, 255, .14); }
.side-sec.ctc { padding: 0; background: none; }
.slab { margin-bottom: 6px; font-size: 11.5px; font-weight: 600; color: #fff; }
.ctc .slab { display: none; }
.ct-row { margin-bottom: 6px; padding: 7px 12px; border-radius: 6px; background: rgba(255, 255, 255, .2); }
.ct-label { font-size: 7.5px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: rgba(255, 255, 255, .7); }
.ct-value { font-size: 10px; color: #fff; overflow-wrap: anywhere; }
.side .lg-item { color: #fff; }
.side .lg-pips i { background: #fff; width: 7px; height: 7px; }
.side .tags { flex-direction: column; }
.side .tags li { position: relative; padding-left: 10px; color: #fff; }
.side .tags li::before { content: ""; position: absolute; left: 0; top: .62em; width: 4px; height: 4px; border-radius: 50%; background: #fff; }
.side .li-title { color: #fff; font-weight: 600; }
.side .li-meta, .side .li-text { color: rgba(255, 255, 255, .75); }
.mlab { display: flex; align-items: center; gap: 0; margin-bottom: 10px; }
.mlab span { padding: 3px 20px; border-radius: 3px; background: var(--c-tab); font-size: 11.5px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: #fff; white-space: nowrap; }
.mlab::after { content: ""; flex: 1; height: 1px; background: var(--c-tab); }
.sec-head, .main .sec-whole { padding-top: 16px; }
.main .flow > :first-child { padding-top: 0; }
.sec-item { padding-bottom: 11px; }
.e-head { display: block; }
.e-org { font-size: 11.5px; font-weight: 700; color: var(--c-ink); }
.e-title { font-size: 10.5px; font-weight: 500; color: var(--c-text); }
.e-dates { font-size: 8.5px; font-weight: 600; color: var(--c-accent); }
.e-text { margin-top: 3px; }
.li-title { font-size: 11px; font-weight: 700; color: var(--c-ink); }
.li-meta { font-size: 8.5px; font-weight: 600; color: var(--c-accent); }
.s-text { color: var(--c-text); }
.sk-rings { display: grid; grid-template-columns: repeat(3, 1fr); row-gap: 14px; text-align: center; }
.sk-ring { margin: 0 auto; }
.sk-track { stroke: var(--c-track); }
.sk-fill { stroke: var(--c-accent); }
.sk-value { font-size: 12px; font-weight: 700; color: var(--c-ink); }
.sk-name { margin-top: 5px; font-size: 10.5px; font-weight: 600; color: var(--c-ink); }
.sk-note { font-size: 8.5px; color: var(--c-muted); }
`
}

export function pages(cv, ctx) {
  const { labels } = ctx
  const sideHeading = (t) => `<div class="slab">${esc(t)}</div>`
  const mainHeading = (t) => `<div class="mlab"><span>${esc(t)}</span></div>`
  const { given, family } = nameParts(cv)
  // Skills go to the main card as rings; the side card keeps contact, languages and extras.
  const { side, main } = standardParts({ ...cv, skills: [] }, ctx, { sideHeading, mainHeading, languagesLook: 'dots' })
  const sideBlocks = side.map((b, i) => (i === 0 && cv.contact?.length ? b.replace('class="side-sec', 'class="side-sec ctc') : b))
  const rings = cv.skills?.length ? [`<div class="sec sec-whole" data-block>${mainHeading(labels.skills)}${ringsHtml(cv.skills)}</div>`] : []
  const who = `<div class="who" data-block>${photo(ctx, cv, 'ph', cv.photo?.zoom ?? 1.4)}<div class="given">${esc(given)}</div><div class="family">${esc(family)}</div>${cv.role ? `<div class="role">${esc(cv.role)}</div>` : ''}</div>`
  const page = (kind, s, m) => `<section class="page ${kind}"><div class="cols"><aside class="side" data-col="side"><div class="flow">${s}</div></aside><main class="main" data-col="main"><div class="flow">${m}</div></main></div></section>`
  return { first: page('page-first', who + sideBlocks.join(''), [...main, ...rings].join('')), continuation: page('page-cont', '', '') }

  function ringsHtml(list) {
    const size = 66
    const r = (size - 6) / 2
    const c = 2 * Math.PI * r
    return `<div class="sk sk-rings">${list.map((s) => `<div class="sk-item"><div class="sk-ring" style="width:${size}px;height:${size}px"><svg viewBox="0 0 ${size} ${size}"><circle class="sk-track" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="6"/><circle class="sk-fill" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="6" stroke-linecap="round" stroke-dasharray="${(c * s.level / 100).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg><span class="sk-value">${Math.round(s.level)}%</span></div><div class="sk-name">${esc(s.name)}</div>${s.note ? `<div class="sk-note">${esc(s.note)}</div>` : ''}</div>`).join('')}</div>`
  }
}
