/**
 * Shared content markup for design systems: one function per kind of CV content, each returning
 * HTML with stable class names (`e-*` timeline entries, `li-*` list items, `sk-*` skills, `lg-*`
 * languages, `ct-*` contact rows, `tags`) that a system's stylesheet styles. Systems arrange the
 * pieces and draw everything around them; Black, White, Slate and Fresh predate this module and
 * write their own markup.
 *
 * Pagination units: `sectionBlocks` returns a section as blocks (`data-block`), a heading block
 * that keeps with the next one (`data-keep`) and one block per entry, so a long section breaks
 * between entries.
 */

/** HTML-escape a value. */
export const esc = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** First name and the rest, for designs that set them apart. */
export function nameParts(cv) {
  const [given, ...rest] = cv.name.trim().split(/\s+/)
  return { given, family: rest.join(' '), initials: cv.name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() }
}

/** One timeline entry. `opts.icon` draws the item's icon first; `opts.datesFirst` puts the dates above the title. */
export function entry(item, { icon, iconName, datesFirst = false, orgFirst = false } = {}) {
  const dates = item.dates ? `<div class="e-dates">${esc(item.dates)}</div>` : ''
  const org = [item.org, item.place].filter(Boolean).map(esc).join(' · ')
  const title = `<div class="e-title">${esc(item.title)}</div>`
  const orgLine = org ? `<div class="e-org">${org}</div>` : ''
  const head = orgFirst ? `${orgLine}${title}` : `${title}${orgLine}`
  const points = item.points?.length ? `<ul class="e-points">${item.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''
  return `<div class="e">${icon && iconName ? icon(iconName, 'e-icon') : ''}<div class="e-main">${datesFirst ? dates : ''}<div class="e-head"><div class="e-name">${head}</div>${datesFirst ? '' : dates}</div>${item.text ? `<p class="e-text">${esc(item.text)}</p>` : ''}${points}</div></div>`
}

/** One list item: title, meta (year) and text. */
export function listItem(item) {
  return `<div class="li"><div class="li-head"><span class="li-title">${esc(item.title)}</span>${item.meta ? `<span class="li-meta">${esc(item.meta)}</span>` : ''}</div>${item.text ? `<p class="li-text">${esc(item.text)}</p>` : ''}</div>`
}

/** Tags as a list. */
export const tags = (items) => `<ul class="tags">${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`

/** Contact rows: each label in a column beside its value, the column as wide as the longest label. */
export const contact = (rows) => `<div class="ct">${rows.map((r) => `<div class="ct-row"><span class="ct-label">${esc(r.label)}</span><span class="ct-value">${esc(r.value)}</span></div>`).join('')}</div>`

/**
 * Skills in one of four looks.
 * @param {object[]} skills - the CV's skills.
 * @param {'bars'|'rings'|'dots'|'list'|'chips'} look - bars with the level, rings with the percentage,
 *   five dots, names with notes, or name chips.
 * @param {{ ringSize?: number, stroke?: number }} [opts] - ring geometry.
 */
export function skills(skills, look, { ringSize = 64, stroke = 5 } = {}) {
  if (look === 'rings') {
    const r = (ringSize - stroke) / 2
    const c = 2 * Math.PI * r
    return `<div class="sk sk-rings">${skills.map((s) => {
      const level = Math.round(s.level)
      return `<div class="sk-item"><div class="sk-ring" style="width:${ringSize}px;height:${ringSize}px"><svg viewBox="0 0 ${ringSize} ${ringSize}"><circle class="sk-track" cx="${ringSize / 2}" cy="${ringSize / 2}" r="${r}" fill="none" stroke-width="${stroke}"/><circle class="sk-fill" cx="${ringSize / 2}" cy="${ringSize / 2}" r="${r}" fill="none" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${(c * level / 100).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 ${ringSize / 2} ${ringSize / 2})"/></svg><span class="sk-value">${level}%</span></div><div class="sk-name">${esc(s.name)}</div>${s.note ? `<div class="sk-note">${esc(s.note)}</div>` : ''}</div>`
    }).join('')}</div>`
  }
  if (look === 'dots') {
    return `<div class="sk sk-dots">${skills.map((s) => {
      const on = Math.round(s.level / 20)
      return `<div class="sk-item"><span class="sk-name">${esc(s.name)}</span><span class="sk-pips">${Array.from({ length: 5 }, (_, i) => `<i class="${i < on ? 'on' : ''}"></i>`).join('')}</span></div>`
    }).join('')}</div>`
  }
  if (look === 'chips') return `<ul class="tags sk-chips">${skills.map((s) => `<li>${esc(s.name)}</li>`).join('')}</ul>`
  if (look === 'list') return `<div class="sk sk-list">${skills.map((s) => `<div class="sk-item"><span class="sk-name">${esc(s.name)}</span>${s.note ? `<span class="sk-note">${esc(s.note)}</span>` : ''}</div>`).join('')}</div>`
  return `<div class="sk sk-bars">${skills.map((s) => `<div class="sk-item"><div class="sk-head"><span class="sk-name">${esc(s.name)}</span><span class="sk-level">${Math.round(s.level)}%</span></div><div class="sk-bar"><span style="width:${Math.round(s.level)}%"></span></div></div>`).join('')}</div>`
}

/** Languages as bars, five dots, name and level lines, or one inline run. */
export function languages(langs, look = 'lines') {
  if (look === 'bars') return `<div class="lg lg-bars">${langs.map((l) => `<div class="lg-item"><div class="lg-head"><span class="lg-name">${esc(l.name)}</span>${l.level ? `<span class="lg-level">${esc(l.level)}</span>` : ''}</div><div class="lg-bar"><span style="width:${l.value ?? 100}%"></span></div></div>`).join('')}</div>`
  if (look === 'dots') return `<div class="lg lg-dots">${langs.map((l) => `<div class="lg-item"><span class="lg-name">${esc(l.name)}</span><span class="lg-pips">${Array.from({ length: 5 }, (_, i) => `<i class="${i < Math.round((l.value ?? 100) / 20) ? 'on' : ''}"></i>`).join('')}</span></div>`).join('')}</div>`
  if (look === 'inline') return `<div class="lg lg-inline">${langs.map((l) => `<span class="lg-item"><span class="lg-name">${esc(l.name)}</span>${l.level ? `<span class="lg-level">${esc(l.level)}</span>` : ''}</span>`).join('')}</div>`
  return `<div class="lg lg-lines">${langs.map((l) => `<div class="lg-item"><span class="lg-name">${esc(l.name)}</span>${l.level ? `<span class="lg-level">${esc(l.level)}</span>` : ''}</div>`).join('')}</div>`
}

/**
 * A section as pagination blocks: the heading block, then one block per entry (timeline, list) or
 * one body block (text, tags).
 * @param {object} section - a CV section.
 * @param {(title: string, intro?: string) => string} heading - the system's heading markup.
 * @param {{ icon?: Function, timelineIcons?: Function, entryOpts?: object, cls?: string }} [opts]
 * @returns {string[]} blocks.
 */
export function sectionBlocks(section, heading, { icon, timelineIcons, entryOpts = {}, cls = 'sec' } = {}) {
  const head = `<div class="${cls} sec-head" data-block data-keep>${heading(section.title, section.intro)}</div>`
  if (section.kind === 'timeline') {
    const icons = timelineIcons ? timelineIcons(section) : []
    return [head, ...section.items.map((item, i) => `<div class="${cls} sec-item" data-block>${entry(item, { ...entryOpts, icon, iconName: icons[i] })}</div>`)]
  }
  if (section.kind === 'list') return [head, ...section.items.map((item) => `<div class="${cls} sec-item" data-block>${listItem(item)}</div>`)]
  const body = section.kind === 'text' ? `<p class="s-text">${esc(section.text)}</p>` : tags(section.items)
  return [`<div class="${cls} sec-whole" data-block>${heading(section.title, section.intro)}${body}</div>`]
}

/** A small block (heading and body) that moves as one. */
export const whole = (headingHtml, body, cls = 'sec') => `<div class="${cls} sec-whole" data-block>${headingHtml}${body}</div>`

/** The photo, or a block of initials when the CV has none. */
export function photo(ctx, cv, cls, zoom = cv.photo?.zoom ?? 1) {
  if (!ctx.photo) return `<div class="${cls} no-photo">${esc(nameParts(cv).initials)}</div>`
  const [fx, fy] = cv.photo?.focus ? cv.photo.focus.map(Number) : [50, 25]
  // A zoom crops into the focus point: the view box keeps 1/zoom of each side, centred on it.
  let view = ''
  let [px, py] = [fx, fy]
  if (zoom > 1) {
    const keep = 100 / zoom
    const left = Math.min(Math.max(fx - keep / 2, 0), 100 - keep)
    const top = Math.min(Math.max(fy - keep / 2, 0), 100 - keep)
    view = `object-view-box:inset(${top.toFixed(1)}% ${(100 - keep - left).toFixed(1)}% ${(100 - keep - top).toFixed(1)}% ${left.toFixed(1)}%);`
    // Inside the view box, the focus sits where it falls within that box.
    ;[px, py] = [((fx - left) / keep) * 100, ((fy - top) / keep) * 100].map((v) => Math.min(Math.max(v, 0), 100).toFixed(1))
  }
  return `<img class="${cls}" src="${ctx.photo}" alt="${esc(cv.photo?.alt ?? cv.name)}" style="object-position:${px}% ${py}%;${view}">`
}

/** A two-column page: the header (first page only), a side column and a main column, both paginated. */
export function twoColumnPages({ header = '', contHeader = '', side = [], main = [], cls = '' }) {
  const page = (kind, head, s, m) => `<section class="page ${cls} ${kind}">${head}<div class="cols"><aside class="side" data-col="side"><div class="flow">${s}</div></aside><main class="main" data-col="main"><div class="flow">${m}</div></main></div></section>`
  return { first: page('page-first', header, side.join(''), main.join('')), continuation: page('page-cont', contHeader, '', '') }
}

/** A one-column page: the header (first page only) and one paginated column. */
export function oneColumnPages({ header = '', contHeader = '', main = [], cls = '' }) {
  const page = (kind, head, m) => `<section class="page ${cls} ${kind}">${head}<main class="main" data-col="main"><div class="flow">${m}</div></main></section>`
  return { first: page('page-first', header, main.join('')), continuation: page('page-cont', contHeader, '') }
}

/** Shared base rules for layouts built on these blocks: flex columns that pagination measures. */
export const BASE = `
.page { display: flex; flex-direction: column; }
.cols { display: flex; flex: 1 1 auto; min-height: 0; }
.side, .main { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
.flow { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; overflow: hidden; }
.flow > * { flex: none; }
.e-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
.e-name { min-width: 0; }
.e-points { list-style: none; }
.e-points li { position: relative; padding-left: 12px; }
.e-points li::before { content: ""; position: absolute; left: 0; top: .65em; width: 4px; height: 4px; border-radius: 50%; background: currentColor; opacity: .7; }
.li-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
.tags { list-style: none; display: flex; flex-wrap: wrap; }
.ct { display: grid; grid-template-columns: auto 1fr; column-gap: 10px; }
.ct-row { display: grid; grid-column: 1 / -1; grid-template-columns: subgrid; align-items: baseline; }
.ct-value { min-width: 0; }
.sk-head, .lg-head, .lg-item { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.sk-dots .sk-item { display: flex; justify-content: space-between; align-items: center; }
.sk-pips, .lg-pips { display: inline-flex; gap: 4px; }
.sk-pips i, .lg-pips i { width: 7px; height: 7px; border-radius: 50%; background: currentColor; opacity: .25; }
.sk-pips i.on, .lg-pips i.on { opacity: 1; }
.sk-bar, .lg-bar { position: relative; overflow: hidden; }
.sk-bar span, .lg-bar span { display: block; height: 100%; }
.sk-ring { position: relative; flex: none; }
.sk-ring svg { display: block; width: 100%; height: 100%; }
.sk-value { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
.no-photo { display: flex; align-items: center; justify-content: center; }
`

/**
 * The usual split of a CV into a side column and a main column, as pagination blocks.
 * Side: contact, skills, languages, the CV's side sections (and education when `educationSide`).
 * Main: the profile, then the sections in order.
 * @param {object} cv - validated CV.
 * @param {object} ctx - the renderer's context (`labels`, `icon`, `timelineIcons`).
 * @param {object} o - `sideHeading(title)`, `mainHeading(title, intro)`, `skillsLook`,
 *   `languagesLook`, `ringSize`, `entryOpts`, `icons` (draw timeline icons), `educationSide`,
 *   `profileSide`, `contactSide` (default true).
 * @returns {{ side: string[], main: string[] }} blocks per column.
 */
export function standardParts(cv, ctx, o) {
  const { labels } = ctx
  const side = []
  const main = []
  const isEducation = (s) => /educat|school|studies|formation|estudio|学|教育/i.test(s.title)
  if (o.profileSide && cv.profile) side.push(whole(o.sideHeading(labels.about), `<p class="s-text">${esc(cv.profile)}</p>`, 'side-sec'))
  if (o.contactSide !== false && cv.contact?.length) side.push(whole(o.sideHeading(labels.contact), contact(cv.contact), 'side-sec'))
  if (cv.skills?.length) side.push(whole(o.sideHeading(labels.skills), skills(cv.skills, o.skillsLook ?? 'bars', { ringSize: o.ringSize ?? 64 }), 'side-sec'))
  if (cv.languages?.length) side.push(whole(o.sideHeading(labels.languages), languages(cv.languages, o.languagesLook ?? 'lines'), 'side-sec'))
  for (const s of cv.sidebar ?? []) side.push(...sectionBlocks(s, (t) => o.sideHeading(t), { cls: 'side-sec' }))
  if (!o.profileSide && cv.profile) main.push(whole(o.mainHeading(labels.about), `<p class="s-text">${esc(cv.profile)}</p>`))
  for (const s of cv.sections ?? []) {
    const target = o.educationSide && isEducation(s) ? side : main
    const heading = target === side ? (t) => o.sideHeading(t) : o.mainHeading
    target.push(...sectionBlocks(s, heading, { cls: target === side ? 'side-sec' : 'sec', entryOpts: o.entryOpts, icon: o.icons ? ctx.icon : undefined, timelineIcons: o.icons ? ctx.timelineIcons : undefined }))
  }
  return { side, main }
}
