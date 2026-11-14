/**
 * The portrait resume shared by Black and White: the screens of a one-page resume site, stitched
 * into A4 pages that the exports join into one scroll. Every page has the side column as a plain
 * strip in the side colour; page 1 holds the name block in the accent colour at its top, and no
 * page carries a menu, header or page number. Page 1 is the introduction: the photo fills the rest
 * of the page from the top, fading into the cover colour (black in Black, white in White), with
 * "Hello, I'm", the name and the role beneath it. The pages after it run the sections as
 * full-width bands that alternate the page and panel colours: About (the contact rows as a label
 * column beside the values, and the profile, beside a large second photo), Skills (rings, then
 * knowledge, languages and the other side sections), and the timelines of icon, organisation,
 * role and dates beside the description. Without a photo the introduction shows the initials,
 * outlined in the accent colour.
 *
 * Blocks (`data-block`) are the units pagination moves to the next page; `data-keep` keeps a
 * heading with the block after it; `data-band` names the band colour a block sits on.
 */

/** The stylesheet; colours come from the palette as `--c-<name>`. */
export function css() {
  return `
.page { display: grid; grid-template-columns: 185px 1fr; background: var(--c-page); color: var(--c-text); font-size: 12.5px; line-height: 1.6; }

/* Side column: a plain strip; on page 1 the name block sits at its top. */
.side { position: relative; display: flex; flex-direction: column; min-height: 0; padding: 28px 28px 24px; background: var(--c-side); }
.mark { flex: none; width: 129px; height: 129px; padding: 36px 14px 0 21px; background: var(--c-accent); color: var(--c-on-accent); }
.mark-name { font-family: var(--display-font); font-size: 27px; font-weight: 400; line-height: .98; text-transform: uppercase; overflow-wrap: anywhere; }

/* Introduction: the photo from the page's top and right edges down most of the page, fading into
   the cover colour, and the greeting on that colour beneath the face. */
.cover { position: relative; overflow: hidden; background: var(--c-cover-bg); }
.cover-photo { position: absolute; top: 0; left: 0; width: 100%; height: 78%; object-fit: cover; object-position: var(--cover-x, 30%) var(--cover-y, 20%); }
.cover-shade { position: absolute; top: 0; left: 0; width: 100%; height: 78%; background: linear-gradient(0deg, var(--c-cover-bg) 0%, color-mix(in srgb, var(--c-cover-bg) 70%, transparent) 14%, transparent 40%), linear-gradient(90deg, color-mix(in srgb, var(--c-cover-bg) 35%, transparent) 0%, transparent 30%); }
.cover-blank { position: absolute; inset: 0; background: radial-gradient(120% 80% at 75% 30%, color-mix(in srgb, var(--c-cover) 22%, var(--c-cover-bg)), var(--c-cover-bg) 70%); }
.cover-initials { position: absolute; right: -30px; top: 40px; font-family: var(--display-font); font-size: 440px; font-weight: 500; line-height: .9; text-transform: uppercase; color: transparent; -webkit-text-stroke: 1.4px var(--c-accent); opacity: .6; writing-mode: vertical-rl; }
.cover-text { position: absolute; left: 46px; right: 46px; bottom: 64px; }
.cover-greeting { font-family: var(--display-font); font-size: 42px; font-weight: 300; line-height: 1.1; text-transform: uppercase; color: var(--c-cover); }
.cover-name { font-family: var(--display-font); font-size: 46px; font-weight: 400; line-height: 1.05; text-transform: uppercase; color: var(--c-cover); max-width: 420px; }
.cover-role { display: inline-block; margin-top: 20px; padding: 12px 0 11px; border-top: 1px solid var(--c-cover-rule); border-bottom: 1px solid var(--c-cover-rule); font-size: 12.5px; letter-spacing: .07em; line-height: 1.3; text-transform: uppercase; color: var(--c-cover); }

/* Content pages: blocks span the column, so each band colour runs edge to edge; the space
   after the last block takes that block's band. */
.main { position: relative; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
.flow { position: relative; display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; overflow: hidden; background: var(--c-page); }
.flow[data-tail="panel"] { background: var(--c-panel); }
.flow > * { flex: none; position: relative; padding: 0 40px 0 46px; background: var(--c-page); }
.flow > [data-band="panel"] { background: var(--c-panel); }
.flow > .band-start, .flow > :first-child { padding-top: 40px; }
.flow > .band-end { padding-bottom: 34px; }

.m-title { font-family: var(--display-font); font-size: 38px; font-weight: 400; line-height: 1; text-transform: uppercase; color: var(--c-title); }
.m-title::after { content: ""; display: block; width: 65px; height: 4px; margin-top: 20px; background: var(--c-accent); }
.m-sub { margin-top: 26px; font-family: var(--display-font); font-size: 15px; font-weight: 400; line-height: 1.4; text-transform: uppercase; color: var(--c-title); }
.m-text { margin-top: 10px; color: var(--c-text); }

/* About: the contact rows and profile on the left, the second photo filling the band's right,
   faded into the band (Black) or as a column of its own (White: aboutMask none and the
   aboutPhotoWidth, aboutCopyWidth and aboutPhotoX palette values). */
.about { min-height: 540px; }
.about-copy { position: relative; width: var(--c-about-copy-width, 58%); }
.about-photo { position: absolute; top: 0; right: 0; bottom: 0; width: var(--c-about-photo-width, 64%); height: 100%; object-fit: cover; object-position: var(--backdrop-x, var(--c-about-photo-x, 0%)) 20%; -webkit-mask-image: var(--c-about-mask, linear-gradient(90deg, transparent 0%, #000 38%)); mask-image: var(--c-about-mask, linear-gradient(90deg, transparent 0%, #000 38%)); }
.facts { display: grid; grid-template-columns: auto 1fr; column-gap: 24px; margin-top: 26px; }
.fact { display: grid; grid-column: 1 / -1; grid-template-columns: subgrid; align-items: baseline; padding: 11px 0 12px; border-bottom: 1px solid var(--c-rule); line-height: 1.4; }
.fact:first-child { padding-top: 0; }
.fact-label { font-family: var(--display-font); font-size: 12.5px; font-weight: 400; letter-spacing: .04em; text-transform: uppercase; color: var(--c-title); }
.fact-value { min-width: 0; color: var(--c-text); overflow-wrap: anywhere; }

/* Skills: big rings two to a row, then the side sections under hairlines. */
.rings { display: grid; grid-template-columns: 1fr 1fr; gap: 20px 18px; margin-top: 28px; }
.skill { display: flex; align-items: center; gap: 14px; }
.ring { position: relative; flex: none; width: 104px; height: 104px; }
.ring svg { display: block; width: 104px; height: 104px; transform: rotate(-90deg); }
.ring-value { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-family: var(--display-font); font-size: 31px; font-weight: 400; color: var(--c-accent); }
.ring-value small { font-size: 25px; font-weight: 300; margin-left: 3px; }
.skill-name { font-family: var(--display-font); font-size: 22px; font-weight: 200; line-height: 1.2; text-transform: uppercase; color: var(--c-title); }
.skill-note { margin-top: 8px; font-size: 12px; line-height: 1.35; color: var(--c-text); }
.sub { padding-top: 0; }
.sub-inner { margin-top: 28px; padding-top: 26px; border-top: 1px solid var(--c-rule); }
.sub-inner > .m-sub { margin-top: 0; }
.checks { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px 14px; margin-top: 16px; list-style: none; }
.checks li { position: relative; padding-left: 20px; line-height: 1.45; }
.checks li::before { content: ""; position: absolute; left: 1px; top: 4px; width: 9px; height: 5px; border-left: 2.5px solid var(--c-text); border-bottom: 2.5px solid var(--c-text); transform: rotate(-45deg); }
.langs { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 28px; margin-top: 18px; }
.lang-head { display: flex; justify-content: space-between; gap: 8px; line-height: 1.3; }
.lang-name { font-family: var(--display-font); font-size: 15px; font-weight: 300; text-transform: uppercase; color: var(--c-title); }
.lang-level { font-size: 11.5px; color: var(--c-text); }
.lang-bar { height: 4px; margin-top: 8px; background: var(--c-ring-track); }
.lang-bar span { display: block; height: 100%; background: var(--c-accent); }

/* Timelines: icon, organisation, role and dates, then the description, between hairlines. */
.entry-row { display: grid; grid-template-columns: 50px 186px 1fr; column-gap: 22px; padding: 24px 0 24px; border-top: 1px solid var(--c-rule); }
.m-head + .entry .entry-row { margin-top: 26px; }
.entry-icon { width: 46px; height: 46px; margin-top: 2px; color: var(--c-accent); stroke-width: 2.1; }
.entry-org { font-family: var(--display-font); font-size: 16.5px; font-weight: 400; line-height: 1.25; text-transform: uppercase; color: var(--c-title); }
.entry-title { margin-top: 2px; font-family: var(--display-font); font-size: 23px; font-weight: 200; line-height: 1.1; text-transform: uppercase; color: var(--c-title); }
.entry-dates { margin-top: 3px; font-size: 13px; line-height: 1.35; color: var(--c-text); }
.entry-body { color: var(--c-text); padding-top: 1px; }
.entry-points { margin-top: 6px; list-style: none; }
.entry-points li { position: relative; padding-left: 13px; }
.entry-points li + li { margin-top: 3px; }
.entry-points li::before { content: ""; position: absolute; left: 0; top: .7em; width: 5px; height: 5px; background: var(--c-accent); }

.item-row { padding: 18px 0 19px; border-top: 1px solid var(--c-rule); }
.m-head + .item .item-row { margin-top: 26px; }
.item-head { display: flex; align-items: baseline; justify-content: space-between; gap: 14px; }
.item-title { font-family: var(--display-font); font-size: 20px; font-weight: 200; line-height: 1.2; text-transform: uppercase; color: var(--c-title); }
.item-meta { flex: none; font-family: var(--display-font); font-size: 14px; letter-spacing: .04em; color: var(--c-accent); }
.item-text { margin-top: 3px; color: var(--c-text); }
`
}

/**
 * The CV's pages.
 * @param {object} cv - validated CV.
 * @param {object} ctx - `{ esc, photo, backdrop, icon, labels, timelineIcons }` from the renderer.
 * @returns {{ first: string, continuation: string }} the introduction and the first content page
 *   with every block, and an empty content page the pagination clones for what does not fit.
 */
export function pages(cv, ctx) {
  const { esc, labels } = ctx
  const name = cv.name.trim()
  const initials = name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('')
  const [given, ...rest] = name.split(/\s+/)
  const blocks = []
  let band = 'page'
  // One section: its blocks share a band; the first opens it, the last closes it, and the next
  // section takes the other band colour.
  const section = (parts) => {
    parts.forEach((html, i) => {
      const cls = [i === 0 ? 'band-start' : '', i === parts.length - 1 ? 'band-end' : ''].filter(Boolean).join(' ')
      blocks.push(html.replace(/^<(\w+) class="/, `<$1 data-band="${band}" class="${cls} `))
    })
    band = band === 'page' ? 'panel' : 'page'
  }

  if (cv.profile || cv.contact?.length) {
    section([`<section class="about" data-block data-id="about">${ctx.backdrop ? `<img class="about-photo" src="${ctx.backdrop}" alt="">` : ''}<div class="about-copy"><h2 class="m-title">${esc(labels.about)}</h2>${cv.contact?.length
      ? `<div class="facts">${cv.contact.map((row) => `<div class="fact"><span class="fact-label">${esc(row.label)}</span><span class="fact-value">${esc(row.value)}</span></div>`).join('')}</div>` : ''}${cv.profile
      ? `<h3 class="m-sub">${esc(labels.profile)}</h3><p class="m-text">${esc(cv.profile)}</p>` : ''}</div></section>`])
  }

  // Skills, then knowledge, languages and the other side sections, on one band.
  const subs = []
  for (const s of cv.sidebar ?? []) subs.push(`<div class="sub" data-block><div class="sub-inner"><h3 class="m-sub">${esc(s.title)}</h3>${sideBody(s, esc)}</div></div>`)
  if (cv.languages?.length) {
    subs.push(`<div class="sub" data-block data-id="languages"><div class="sub-inner"><h3 class="m-sub">${esc(labels.languages)}</h3><div class="langs">${cv.languages.map((l) =>
      `<div class="lang"><div class="lang-head"><span class="lang-name">${esc(l.name)}</span>${l.level ? `<span class="lang-level">${esc(l.level)}</span>` : ''}</div>${l.value !== undefined ? `<div class="lang-bar"><span style="width:${l.value}%"></span></div>` : ''}</div>`).join('')}</div></div></div>`)
  }
  if (cv.skills?.length || subs.length) {
    const head = cv.skills?.length
      ? [`<section class="skills" data-block data-id="skills"><h2 class="m-title">${esc(labels.skills)}</h2><div class="rings">${cv.skills.map((s) => skillRing(s, esc)).join('')}</div></section>`]
      : []
    if (!head.length) subs[0] = subs[0].replace('<div class="sub-inner">', '<div class="sub-inner" style="margin-top:0;padding-top:0;border-top:0">')
    section([...head, ...subs])
  }

  for (const [s, sec] of (cv.sections ?? []).entries()) {
    section(sectionBlocks(sec, `s${s}`, ctx))
  }

  const mark = `<aside class="side"><div class="mark"><div class="mark-name">${esc(given)}${rest.length ? `<br>${esc(rest.join(' '))}` : ''}</div></div></aside>`
  const side = '<aside class="side"></aside>'

  const focus = Array.isArray(cv.photo?.focus) ? `--cover-x:${Number(cv.photo.focus[0])}%;--cover-y:${Number(cv.photo.focus[1])}%;` : ''
  const backdropFocus = Array.isArray(cv.backdrop?.focus) ? `--backdrop-x:${Number(cv.backdrop.focus[0])}%;` : ''
  const style = focus || backdropFocus ? ` style="${focus}${backdropFocus}"` : ''
  const cover = `<section class="page page-cover"${style}>${mark}<div class="cover" data-id="cover">${ctx.photo
    ? `<img class="cover-photo" src="${ctx.photo}" alt="${esc(cv.photo?.alt ?? name)}"><span class="cover-shade"></span>`
    : `<span class="cover-blank"></span><span class="cover-initials" aria-hidden="true">${esc(initials)}</span>`}
    <div class="cover-text">${cv.greeting === '' ? '' : `<div class="cover-greeting">${esc(cv.greeting ?? "Hello, I'm")}</div>`}<h1 class="cover-name">${esc(name)}</h1>${cv.role ? `<div class="cover-role">${esc(cv.role)}</div>` : ''}</div></div></section>`

  const content = (cls, inner) => `<section class="page ${cls}"${style}>${side}<main class="main" data-col="main"><div class="flow">${inner}</div></main></section>`
  return { first: cover + content('page-info', blocks.join('')), continuation: content('page-cont', '') }
}

function sectionBlocks(sec, id, ctx) {
  const { esc } = ctx
  if (sec.kind === 'timeline' || sec.kind === 'list') {
    const head = `<div class="m-head" data-block data-keep data-id="${id}-head"><h2 class="m-title">${esc(sec.title)}</h2>${sec.intro ? `<h3 class="m-sub">${esc(sec.intro)}</h3>` : ''}</div>`
    if (sec.kind === 'list') return [head, ...sec.items.map((item, i) => listItem(item, esc, `${id}-${i}`))]
    const icons = ctx.timelineIcons(sec)
    return [head, ...sec.items.map((item, i) => entry(item, icons[i], ctx, `${id}-${i}`))]
  }
  const body = sec.kind === 'text' ? `<p class="m-text" style="margin-top:24px">${esc(sec.text)}</p>` : `<ul class="checks" style="margin-top:24px">${sec.items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`
  return [`<section class="plain" data-block data-id="${id}"><h2 class="m-title">${esc(sec.title)}</h2>${body}</section>`]
}

function sideBody(sec, esc) {
  if (sec.kind === 'text') return `<p class="m-text">${esc(sec.text)}</p>`
  if (sec.kind === 'tags') return `<ul class="checks">${sec.items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`
  return sec.items.map((item) => `<div class="item-row" style="padding:10px 0;border-top:0"><div class="item-head"><span class="item-title" style="font-size:16px">${esc(item.title)}</span>${item.meta ? `<span class="item-meta">${esc(item.meta)}</span>` : ''}</div>${item.text ? `<div class="item-text">${esc(item.text)}</div>` : ''}</div>`).join('')
}

function skillRing(skill, esc) {
  const r = 55
  const c = 2 * Math.PI * r
  const level = Math.round(skill.level)
  return `<div class="skill"><div class="ring"><svg viewBox="0 0 116 116" aria-hidden="true"><circle cx="58" cy="58" r="${r}" fill="none" stroke="var(--c-ring-track)" stroke-width="5"/><circle cx="58" cy="58" r="${r}" fill="none" stroke="var(--c-ring)" stroke-width="5" stroke-dasharray="${(c * level / 100).toFixed(2)} ${c.toFixed(2)}"/></svg><span class="ring-value">${level}<small>%</small></span></div><div><div class="skill-name">${esc(skill.name)}</div>${skill.note ? `<div class="skill-note">${esc(skill.note)}</div>` : ''}</div></div>`
}

function entry(item, iconName, { esc, icon }, id) {
  const dates = [item.dates, item.place].filter(Boolean).map(esc).join(' · ')
  const points = item.points?.length ? `<ul class="entry-points">${item.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''
  return `<article class="entry" data-block data-id="${id}"><div class="entry-row">${icon(iconName, 'entry-icon')}<div class="entry-meta">${item.org ? `<div class="entry-org">${esc(item.org)}</div>` : ''}<div class="entry-title">${esc(item.title)}</div>${dates ? `<div class="entry-dates">${dates}</div>` : ''}</div><div class="entry-body">${item.text ? `<p>${esc(item.text)}</p>` : ''}${points}</div></div></article>`
}

function listItem(item, esc, id) {
  return `<div class="item" data-block data-id="${id}"><div class="item-row"><div class="item-head"><span class="item-title">${esc(item.title)}</span>${item.meta ? `<span class="item-meta">${esc(item.meta)}</span>` : ''}</div>${item.text ? `<div class="item-text">${esc(item.text)}</div>` : ''}</div></div>`
}
