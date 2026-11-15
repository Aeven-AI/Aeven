/**
 * Resume archetypes for design systems 15 onwards, built on `blocks.mjs`: a system picks one,
 * passes its header markup and options, and supplies its own stylesheet.
 *
 * - `sidebarResume`: a side column (contact, skills, languages, extras) beside a main column
 *   (profile and sections), both paginated; optional full-width header on the first page.
 * - `labelResume`: one column of rows, each section's label in a narrow left column beside its
 *   entries; a long section breaks between entries.
 * - `stackResume`: one column of stacked sections under headings; `cards` keeps each section in
 *   one card block.
 *
 * `hx` holds small header pieces (name, role, photo, contact row) every header reuses.
 */
import { BASE, contact, entry, esc, languages, listItem, oneColumnPages, photo, sectionBlocks, skills, standardParts, tags, twoColumnPages, whole } from './blocks.mjs'

/** Header pieces. */
export const hx = {
  name: (cv, cls = 'name') => `<h1 class="${cls}">${esc(cv.name)}</h1>`,
  role: (cv, cls = 'role') => (cv.role ? `<div class="${cls}">${esc(cv.role)}</div>` : ''),
  photo: (cv, ctx, cls = 'ph', zoom) => photo(ctx, cv, cls, zoom ?? cv.photo?.zoom ?? 1),
  crow: (cv, cls = 'crow') => (cv.contact?.length ? `<div class="${cls}">${cv.contact.map((c) => `<span>${esc(c.value)}</span>`).join('')}</div>` : ''),
  profile: (cv, cls = 'intro') => (cv.profile ? `<p class="${cls}">${esc(cv.profile)}</p>` : ''),
  esc,
}

/** Rules every archetype relies on, after `BASE`. */
export const KIT = BASE + `
.page { position: relative; overflow: hidden; background: var(--c-page); color: var(--c-text); }
.ph { display: block; object-fit: cover; }
.no-photo { background: var(--c-accent); color: #fff; font-family: var(--display-font); font-weight: 700; font-size: 32px; }
.crow { display: flex; flex-wrap: wrap; gap: 3px 16px; }
.side-right .cols { flex-direction: row-reverse; }
.lrow { display: grid; grid-template-columns: var(--label-w, 140px) minmax(0, 1fr); column-gap: var(--label-gap, 24px); }
.lg-inline { display: flex; flex-wrap: wrap; gap: 4px 14px; }
.lg-inline .lg-item { display: inline-flex; gap: 5px; }
.lg-inline .lg-level::before { content: "·"; margin-right: 5px; opacity: .6; }
.sk-chips { gap: 5px; }
.page { font-size: 10.5px; line-height: 1.55; }
.flow > :first-child { padding-top: 0; }
.sec-head, .sec-whole, .side-sec { padding-top: 18px; }
.sec-item { padding-bottom: 12px; }
.e-title { font-weight: 700; color: var(--c-ink); font-size: 11.5px; }
.e-org { color: var(--c-text); font-size: 10.5px; }
.e-dates { flex: none; color: var(--c-muted); font-size: 9.5px; }
.e-text { margin-top: 4px; }
.e-points { margin-top: 3px; }
.li-title { font-weight: 700; color: var(--c-ink); }
.li-meta { color: var(--c-muted); font-size: 9.5px; }
.li-text { color: var(--c-text); }
.s-text { color: var(--c-text); }
.ct-row { margin-bottom: 5px; }
.ct-label { font-size: 8.5px; color: var(--c-muted); }
.ct-value { color: var(--c-ink); overflow-wrap: anywhere; }
.sk-bars .sk-item + .sk-item, .lg-bars .lg-item + .lg-item { margin-top: 7px; }
.sk-name, .lg-name { color: var(--c-ink); }
.sk-level, .lg-level, .sk-note { font-size: 9px; color: var(--c-muted); }
.sk-bar, .lg-bar { height: 4px; margin-top: 4px; border-radius: 4px; background: var(--c-rule); }
.sk-bar span, .lg-bar span { border-radius: 4px; background: var(--c-accent); }
.sk-list .sk-item { display: flex; justify-content: space-between; gap: 8px; padding: 2px 0; }
.lg-lines .lg-item { padding: 2px 0; }
.tags li { padding: 2px 9px; border-radius: 20px; background: var(--c-chip, var(--c-rule)); color: var(--c-ink); font-size: 9.5px; }
`

/** A whole section in one block: heading and every entry, for card designs. */
function sectionWhole(s, heading, o) {
  const body = s.kind === 'timeline' ? s.items.map((it) => entry(it, o.entryOpts)).join('')
    : s.kind === 'list' ? s.items.map(listItem).join('')
      : s.kind === 'text' ? `<p class="s-text">${esc(s.text)}</p>` : tags(s.items)
  return `<div class="sec sec-whole card" data-block>${heading(s.title, s.intro)}${body}</div>`
}

/**
 * Side column and main column.
 * @param {object} o - `header(cv, ctx)`, `contHeader`, `sideTop(cv, ctx)`, `mainTop(cv, ctx)`,
 *   `sideHeading(t)`, `mainHeading(t, intro)`, `right` (side on the right), and the
 *   `standardParts` options (`skillsLook`, `languagesLook`, `educationSide`, `profileSide`,
 *   `contactSide`, `icons`, `entryOpts`).
 */
export function sidebarResume(cv, ctx, o = {}) {
  const sideHeading = o.sideHeading ?? ((t) => `<h2 class="sh">${esc(t)}</h2>`)
  const mainHeading = o.mainHeading ?? ((t) => `<h2 class="mh">${esc(t)}</h2>`)
  const { side, main } = standardParts(cv, ctx, { ...o, sideHeading, mainHeading, skillsLook: o.skillsLook ?? 'bars', languagesLook: o.languagesLook ?? 'lines' })
  const sideTop = o.sideTop ? [`<div class="side-top" data-block>${o.sideTop(cv, ctx)}</div>`] : []
  const mainTop = o.mainTop ? [`<div class="main-top" data-block>${o.mainTop(cv, ctx)}</div>`] : []
  return twoColumnPages({ header: o.header?.(cv, ctx) ?? '', contHeader: o.contHeader?.(cv, ctx) ?? '', side: [...sideTop, ...side], main: [...mainTop, ...main], cls: o.right ? 'side-right' : '' })
}

/**
 * Label column rows.
 * @param {object} o - `header(cv, ctx)`, `label(t, n)` (label markup), `numbered`,
 *   `profileInHeader`, `contact` (add a contact row), `skillsLook` (default chips),
 *   `languagesLook` (default inline), `entryOpts`.
 */
export function labelResume(cv, ctx, o = {}) {
  const { labels } = ctx
  let n = 0
  const rows = []
  const label = (t) => { n += 1; return o.label ? o.label(t, n) : `${o.numbered ? `<b>${String(n).padStart(2, '0')}</b> ` : ''}${esc(t)}` }
  const row = (t, bodies) => {
    const l = label(t)
    bodies.forEach((b, i) => rows.push(`<div class="lrow${i === 0 ? ' lrow-first' : ''}" data-block><div class="lrow-label">${i === 0 ? l : ''}</div><div class="lrow-body">${b}</div></div>`))
  }
  if (cv.profile && !o.profileInHeader) row(labels.about, [`<p class="s-text">${esc(cv.profile)}</p>`])
  for (const s of cv.sections ?? []) {
    if (s.kind === 'timeline') row(s.title, s.items.map((it) => entry(it, o.entryOpts)))
    else if (s.kind === 'list') row(s.title, s.items.map(listItem))
    else if (s.kind === 'text') row(s.title, [`<p class="s-text">${esc(s.text)}</p>`])
    else row(s.title, [tags(s.items)])
  }
  if (cv.skills?.length) row(labels.skills, [skills(cv.skills, o.skillsLook ?? 'chips')])
  if (cv.languages?.length) row(labels.languages, [languages(cv.languages, o.languagesLook ?? 'inline')])
  for (const s of cv.sidebar ?? []) row(s.title, [s.kind === 'tags' ? tags(s.items) : s.kind === 'text' ? `<p class="s-text">${esc(s.text)}</p>` : s.items.map(listItem).join('')])
  if (o.contact && cv.contact?.length) row(labels.contact, [contact(cv.contact)])
  return oneColumnPages({ header: o.header?.(cv, ctx) ?? '', main: rows })
}

/**
 * Stacked sections.
 * @param {object} o - `header(cv, ctx)`, `heading(t, intro)`, `cards`, `profileInHeader`,
 *   `contact` (add a contact section), `skillsLook`, `languagesLook`, `entryOpts`, `icons`.
 */
export function stackResume(cv, ctx, o = {}) {
  const { labels } = ctx
  const heading = o.heading ?? ((t) => `<h2 class="mh">${esc(t)}</h2>`)
  const cls = o.cards ? 'sec sec-whole card' : 'sec sec-whole'
  const blocks = []
  if (cv.profile && !o.profileInHeader) blocks.push(whole(heading(labels.about), `<p class="s-text">${esc(cv.profile)}</p>`, cls))
  for (const s of cv.sections ?? []) {
    blocks.push(...(o.cards ? [sectionWhole(s, heading, o)] : sectionBlocks(s, heading, { cls: 'sec', entryOpts: o.entryOpts, icon: o.icons ? ctx.icon : undefined, timelineIcons: o.icons ? ctx.timelineIcons : undefined })))
  }
  if (cv.skills?.length) blocks.push(whole(heading(labels.skills), skills(cv.skills, o.skillsLook ?? 'chips'), cls))
  if (cv.languages?.length) blocks.push(whole(heading(labels.languages), languages(cv.languages, o.languagesLook ?? 'inline'), cls))
  for (const s of cv.sidebar ?? []) blocks.push(o.cards ? sectionWhole(s, heading, o) : whole(heading(s.title), s.kind === 'tags' ? tags(s.items) : s.kind === 'text' ? `<p class="s-text">${esc(s.text)}</p>` : s.items.map(listItem).join(''), cls))
  if (o.contact && cv.contact?.length) blocks.push(whole(heading(labels.contact), contact(cv.contact), cls))
  return oneColumnPages({ header: o.header?.(cv, ctx) ?? '', main: blocks })
}
