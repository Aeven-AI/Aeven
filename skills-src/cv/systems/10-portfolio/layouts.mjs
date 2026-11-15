/**
 * Portfolio: charcoal pages in Poppins. Page 1 opens on the hero: three small dots, "I'm" and the
 * name large in white, the role in spaced caps and a blue-to-cyan pill with the email, beside the
 * photo in an offset grey frame. Then About, skills as gradient rings, languages as gradient bars,
 * and the timelines as dark cards with gradient icon discs.
 */
import { BASE, esc, languages, photo, sectionBlocks, oneColumnPages } from '../../scripts/blocks.mjs'

export function css() {
  return BASE + `
.page { background: var(--c-page); color: var(--c-text); font-size: 10.5px; line-height: 1.65; }
.main { flex: 1 1 auto; }
.main .flow { padding: 0 54px 40px; }
.page-cont .main .flow { padding-top: 54px; }
.hero { display: flex; justify-content: space-between; align-items: center; height: 430px; }
.dots { display: flex; gap: 7px; margin-bottom: 18px; }
.dots i { width: 13px; height: 13px; border-radius: 50%; background: var(--c-from); }
.dots i:nth-child(2) { background: var(--c-frame); }
.dots i:nth-child(3) { background: #fff; }
.hi { font-size: 22px; font-weight: 400; color: var(--c-ink); }
.name { font-size: 46px; font-weight: 600; line-height: 1.05; color: var(--c-ink); max-width: 320px; }
.role { margin-top: 12px; font-size: 9.5px; letter-spacing: .32em; text-transform: uppercase; color: var(--c-muted); }
.pill { display: inline-block; margin-top: 26px; padding: 10px 24px; border-radius: 30px; background: linear-gradient(90deg, var(--c-from), var(--c-to)); font-size: 10.5px; font-weight: 500; color: #fff; }
.frame { position: relative; width: 250px; height: 320px; margin-right: 14px; }
.frame::before { content: ""; position: absolute; left: -18px; top: -18px; width: 100%; height: 100%; background: var(--c-frame); }
.ph { position: relative; width: 100%; height: 100%; object-fit: cover; }
.no-photo { background: var(--c-card); color: #fff; font-size: 50px; font-weight: 600; }
.title { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; font-size: 24px; font-weight: 600; color: var(--c-ink); }
.title::after { content: ""; flex: 1; height: 1px; background: var(--c-rule); }
.sec-head, .sec-whole { padding-top: 26px; }
.main .flow > :first-child:not(.hero) { padding-top: 0; }
.s-text { color: var(--c-text); max-width: 600px; }
.rings { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; text-align: center; }
.ring { position: relative; width: 92px; height: 92px; margin: 0 auto; }
.ring svg { display: block; width: 100%; height: 100%; }
.ring b { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 17px; font-weight: 600; color: #fff; }
.ring-name { margin-top: 8px; font-size: 10px; color: var(--c-text); }
.lg-bars { display: grid; grid-template-columns: 1fr 1fr; column-gap: 34px; row-gap: 12px; }
.lg-name { color: var(--c-ink); font-weight: 500; }
.lg-level { font-size: 9px; color: var(--c-muted); }
.lg-bar { height: 6px; margin-top: 6px; border-radius: 6px; background: var(--c-card); }
.lg-bar span { border-radius: 6px; background: linear-gradient(90deg, var(--c-from), var(--c-to)); }
.sec-item { padding-bottom: 10px; }
.e { display: flex; gap: 14px; padding: 16px 18px; border-radius: 10px; background: var(--c-card); }
.e-icon { flex: none; width: 34px; height: 34px; padding: 8px; border-radius: 50%; background: linear-gradient(135deg, var(--c-from), var(--c-to)); color: #fff; stroke-width: 2; }
.e-main { flex: 1; min-width: 0; }
.e-title { font-size: 12.5px; font-weight: 600; color: var(--c-ink); }
.e-org { font-size: 10px; color: var(--c-muted); }
.e-dates { flex: none; font-size: 9.5px; color: var(--c-to); }
.e-text { margin-top: 5px; color: var(--c-text); }
.li { padding: 12px 18px; border-radius: 10px; background: var(--c-card); }
.li-title { font-size: 11.5px; font-weight: 600; color: var(--c-ink); }
.li-meta { font-size: 9.5px; color: var(--c-to); }
.li-text { color: var(--c-text); }
.tags { gap: 6px; }
.tags li { padding: 4px 12px; border-radius: 20px; background: var(--c-card); font-size: 10px; color: var(--c-ink); }
`
}

export function pages(cv, ctx) {
  const { labels } = ctx
  const heading = (t) => `<div class="title">${esc(t)}</div>`
  const blocks = []
  const email = cv.contact?.find((c) => /mail/i.test(c.label))?.value ?? cv.contact?.[0]?.value
  blocks.push(`<div class="hero" data-block><div><div class="dots"><i></i><i></i><i></i></div><div class="hi">${esc(labels.greetingShort ?? "I'm")}</div><h1 class="name">${esc(cv.name)}</h1>${cv.role ? `<div class="role">${esc(cv.role)}</div>` : ''}${email ? `<div class="pill">${esc(email)}</div>` : ''}</div><div class="frame">${photo(ctx, cv, 'ph')}</div></div>`)
  if (cv.profile) blocks.push(`<div class="sec-whole" data-block>${heading(labels.about)}<p class="s-text">${esc(cv.profile)}</p></div>`)
  if (cv.skills?.length) {
    const r = 40
    const c = 2 * Math.PI * r
    blocks.push(`<div class="sec-whole" data-block>${heading(labels.skills)}<svg width="0" height="0" style="position:absolute"><defs><linearGradient id="pf-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--c-to)"/><stop offset="1" stop-color="var(--c-from)"/></linearGradient></defs></svg><div class="rings">${cv.skills.map((s) =>
      `<div><div class="ring"><svg viewBox="0 0 92 92"><circle cx="46" cy="46" r="${r}" fill="none" stroke="var(--c-card)" stroke-width="9"/><circle cx="46" cy="46" r="${r}" fill="none" stroke="url(#pf-grad)" stroke-width="9" stroke-linecap="round" stroke-dasharray="${(c * s.level / 100).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 46 46)"/></svg><b>${Math.round(s.level)}%</b></div><div class="ring-name">${esc(s.name)}</div></div>`).join('')}</div></div>`)
  }
  if (cv.languages?.length) blocks.push(`<div class="sec-whole" data-block>${heading(labels.languages)}${languages(cv.languages, 'bars')}</div>`)
  for (const s of [...(cv.sections ?? []), ...(cv.sidebar ?? [])]) blocks.push(...sectionBlocks(s, heading, { icon: ctx.icon, timelineIcons: ctx.timelineIcons, cls: 'sec' }))
  if (cv.contact?.length) {
    blocks.push(`<div class="sec-whole" data-block>${heading(labels.contact)}<ul class="tags">${cv.contact.map((r) => `<li>${esc(r.value)}</li>`).join('')}</ul></div>`)
  }
  return oneColumnPages({ main: blocks })
}
