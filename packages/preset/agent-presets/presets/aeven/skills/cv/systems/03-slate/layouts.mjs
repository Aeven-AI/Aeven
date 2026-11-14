/**
 * Slate: a one-page portfolio site on dark slate with mint accents, stitched into A4 pages.
 *
 * Page 1 is the cover: the photo across the top of the page with a curved lower edge, a slate
 * circle rising into it that holds the name in heavy Poppins, the role in mint caps beneath, and a
 * pill with the first contact line, under the header bar: a round monogram and the name. The
 * pages after it carry no header or page number, so the exported pages read as one scroll. The
 * content pages run the sections between full-width hairlines, each opening on a heavy
 * title with a mint caps subtitle: About (profile and a two-column table of mint labels), Skills
 * as thin mint bars with their percentage, timelines two to a row with the dates running up the
 * left of each entry, languages rated in ten dots, and the remaining sections.
 *
 * Blocks (`data-block`) are what pagination moves; two-column rows move as one block. `data-keep`
 * keeps a heading with the block after it.
 */

/** The stylesheet; colours come from the palette as `--c-<name>`. */
export function css() {
  return `
.page { display: flex; flex-direction: column; background: var(--c-page); color: var(--c-text); font-size: 12.5px; line-height: 1.85; }

/* Header bar: monogram and the name on two lines. */
.bar { flex: none; display: flex; align-items: center; gap: 18px; height: 74px; padding: 0 40px; background: var(--c-bar); }
.mono { position: relative; flex: none; width: 34px; height: 34px; border-radius: 50%; background: var(--c-ink); color: var(--c-page); font-family: var(--display-font); font-size: 17px; font-weight: 800; line-height: 34px; text-align: center; }
.mono::after { content: ""; position: absolute; right: -2px; bottom: -2px; width: 12px; height: 12px; border-radius: 50%; background: var(--c-accent); border: 2px solid var(--c-bar); }
.bar-name { font-family: var(--display-font); font-size: 15px; font-weight: 700; line-height: 1.3; color: var(--c-ink); }

/* Cover. */
.page-cover { position: relative; overflow: hidden; }
.page-cover .bar { position: absolute; z-index: 2; inset: 0 0 auto 0; background: none; }
.page-cover .bar-name { text-shadow: 0 1px 12px rgba(0, 0, 0, .35); }
.cover-photo { position: absolute; top: 0; left: 0; width: 100%; height: 74%; object-fit: cover; object-position: var(--cover-x, 50%) var(--cover-y, 25%); clip-path: ellipse(82% 100% at 50% 0%); }
.cover-blank { position: absolute; top: 0; left: 0; width: 100%; height: 74%; background: radial-gradient(90% 80% at 50% 20%, #4a4f56, var(--c-page)); clip-path: ellipse(82% 100% at 50% 0%); }
.cover-circle { position: absolute; left: 50%; top: 652px; width: 470px; height: 470px; margin-left: -235px; border-radius: 50%; background: var(--c-page); }
.cover-text { position: absolute; left: 60px; right: 60px; top: 712px; text-align: center; }
.cover-name { font-family: var(--display-font); font-size: 62px; font-weight: 800; line-height: 1.12; letter-spacing: -.01em; color: var(--c-ink); }
.cover-role { margin-top: 26px; font-size: 13px; font-weight: 600; line-height: 1.3; text-transform: uppercase; color: var(--c-accent); }
.cover-pill { display: inline-block; margin-top: 30px; padding: 15px 30px; border: 1px solid var(--c-rule); border-radius: 40px; font-size: 11.5px; font-weight: 700; letter-spacing: .04em; line-height: 1; text-transform: uppercase; color: var(--c-ink); }

/* Content pages. */
.main { position: relative; display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
.flow { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; overflow: hidden; }
.flow > * { flex: none; padding: 0 40px; }
.flow > .sec-start { padding-top: 40px; border-top: 1px solid var(--c-rule); }
.flow > :first-child { padding-top: 36px; border-top: 0; }
.flow > .sec-end { padding-bottom: 38px; }

.title { font-family: var(--display-font); font-size: 48px; font-weight: 800; line-height: 1.1; letter-spacing: -.01em; color: var(--c-ink); }
.sub { margin-top: 6px; font-size: 12px; font-weight: 600; line-height: 1.3; text-transform: uppercase; color: var(--c-accent); }
.head-gap { height: 30px; }
.text { color: var(--c-text); }

.two { display: grid; grid-template-columns: 1fr 1fr; column-gap: 40px; }
.row { padding-bottom: 28px; }

.facts { display: grid; grid-template-columns: 1fr 1fr; column-gap: 40px; row-gap: 4px; margin-top: 22px; }
.fact { display: flex; gap: 12px; line-height: 1.6; }
.fact-label { flex: none; width: 92px; font-weight: 600; text-transform: uppercase; color: var(--c-accent); }
.fact-value { min-width: 0; font-weight: 600; color: var(--c-ink); overflow-wrap: anywhere; }

.entry { display: flex; gap: 16px; }
.entry-date { flex: none; writing-mode: vertical-rl; transform: rotate(180deg); align-self: flex-start; font-size: 10.5px; font-weight: 600; line-height: 1; letter-spacing: .02em; color: var(--c-accent); white-space: nowrap; }
.entry-title { font-family: var(--display-font); font-size: 16.5px; font-weight: 700; line-height: 1.5; color: var(--c-ink); }
.entry-text { margin-top: 14px; color: var(--c-text); }
.entry-points { margin-top: 8px; list-style: none; }
.entry-points li { position: relative; padding-left: 14px; line-height: 1.7; }
.entry-points li::before { content: ""; position: absolute; left: 0; top: .72em; width: 5px; height: 5px; border-radius: 50%; background: var(--c-accent); }

.skill-name { font-family: var(--display-font); font-size: 15.5px; font-weight: 700; line-height: 1.4; color: var(--c-ink); }
.skill-note { margin-top: 10px; color: var(--c-text); }
.meter { position: relative; height: 2px; margin-top: 30px; background: var(--c-track); }
.meter span { position: absolute; left: 0; top: 0; height: 2px; background: var(--c-accent); }
.meter b { position: absolute; bottom: 7px; transform: translateX(-100%); font-size: 10px; font-weight: 600; line-height: 1; color: var(--c-accent); }

.dots { display: flex; justify-content: space-between; margin-top: 18px; }
.dots i { width: 11px; height: 11px; border-radius: 50%; background: var(--c-track); }
.dots i.on { background: var(--c-accent); }
.dots i.half { background: linear-gradient(90deg, var(--c-accent) 50%, var(--c-track) 50%); }
.lang-level { margin-top: 8px; color: var(--c-text); }

.checks { display: grid; grid-template-columns: repeat(3, 1fr); column-gap: 24px; row-gap: 6px; list-style: none; }
.checks li { position: relative; padding-left: 22px; font-weight: 500; color: var(--c-ink); }
.checks li::before { content: ""; position: absolute; left: 0; top: .5em; width: 10px; height: 10px; border-radius: 50%; border: 2px solid var(--c-accent); }

.award { display: flex; gap: 16px; }
.award-icon { flex: none; width: 34px; height: 34px; color: var(--c-accent); stroke-width: 2; }
.award-title { font-family: var(--display-font); font-size: 16px; font-weight: 700; line-height: 1.45; color: var(--c-ink); }
.award-meta { font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--c-accent); }
.award-text { margin-top: 6px; color: var(--c-text); }
`
}

/**
 * The CV's pages.
 * @param {object} cv - validated CV.
 * @param {object} ctx - `{ esc, photo, icon, labels }` from the renderer.
 * @returns {{ first: string, continuation: string }} the cover and the first content page with
 *   every block, and an empty content page the pagination clones for what does not fit.
 */
export function pages(cv, ctx) {
  const { esc, labels, icon } = ctx
  const name = cv.name.trim()
  const [given, ...rest] = name.split(/\s+/)
  const blocks = []
  // A section is its heading block, then its body blocks; the first opens it under a hairline.
  const section = (title, sub, body, id) => {
    const parts = [`<div class="head" data-block data-keep${id ? ` data-id="${id}"` : ''}><h2 class="title">${esc(title)}</h2>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}<div class="head-gap"></div></div>`, ...body]
    parts.forEach((html, i) => {
      const cls = [i === 0 ? 'sec-start' : '', i === parts.length - 1 ? 'sec-end' : ''].filter(Boolean).join(' ')
      blocks.push(cls ? html.replace(/^<div class="/, `<div class="${cls} `) : html)
    })
  }
  // Two-column rows: each pair of items is one block.
  const rows = (items, draw) => {
    const out = []
    for (let i = 0; i < items.length; i += 2) out.push(`<div class="row two" data-block>${draw(items[i], i)}${items[i + 1] ? draw(items[i + 1], i + 1) : '<div></div>'}</div>`)
    return out
  }

  if (cv.profile || cv.contact?.length) {
    section(labels.about, labels.profile, [`<div class="about" data-block>${cv.profile ? `<p class="text">${esc(cv.profile)}</p>` : ''}${cv.contact?.length
      ? `<div class="facts">${cv.contact.map((row) => `<div class="fact"><span class="fact-label">${esc(row.label)}:</span><span class="fact-value">${esc(row.value)}</span></div>`).join('')}</div>` : ''}</div>`], 'about')
  }
  if (cv.skills?.length) {
    section(labels.skills, labels.skillsIntro, rows(cv.skills, (s) => {
      const level = Math.round(s.level)
      return `<div class="skill"><div class="skill-name">${esc(s.name)}</div>${s.note ? `<p class="skill-note">${esc(s.note)}</p>` : ''}<div class="meter"><span style="width:${level}%"></span><b style="left:${level}%">${level}%</b></div></div>`
    }), 'skills')
  }
  for (const [s, sec] of (cv.sections ?? []).entries()) section(sec.title, sec.intro, bodyOf(sec), `s${s}`)
  if (cv.languages?.length) {
    section(labels.languages, labels.languagesIntro, rows(cv.languages, (l) => {
      const v = (l.value ?? 100) / 10
      const dots = Array.from({ length: 10 }, (_, i) => `<i class="${i + 1 <= v ? 'on' : i < v ? 'half' : ''}"></i>`).join('')
      return `<div class="lang"><div class="skill-name">${esc(l.name)}</div>${l.level ? `<div class="lang-level">${esc(l.level)}</div>` : ''}<div class="dots">${dots}</div></div>`
    }), 'languages')
  }
  for (const [i, sec] of (cv.sidebar ?? []).entries()) section(sec.title, sec.intro, bodyOf(sec), `side${i}`)

  function bodyOf(sec) {
    if (sec.kind === 'text') return [`<div class="plain" data-block><p class="text">${esc(sec.text)}</p></div>`]
    if (sec.kind === 'tags') return [`<div class="tags" data-block><ul class="checks">${sec.items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>`]
    if (sec.kind === 'list') {
      return rows(sec.items, (it) => `<div class="award">${icon('award', 'award-icon')}<div>${it.meta ? `<div class="award-meta">${esc(it.meta)}</div>` : ''}<div class="award-title">${esc(it.title)}</div>${it.text ? `<p class="award-text">${esc(it.text)}</p>` : ''}</div></div>`)
    }
    return rows(sec.items, (it) => {
      const points = it.points?.length ? `<ul class="entry-points">${it.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''
      const place = it.place ? ` · ${esc(it.place)}` : ''
      return `<div class="entry">${it.dates ? `<div class="entry-date">${esc(it.dates)}</div>` : ''}<div><div class="entry-title">${esc(it.title)}${it.org ? `<br>${esc(it.org)}${place}` : ''}</div>${it.text ? `<p class="entry-text">${esc(it.text)}</p>` : ''}${points}</div></div>`
    })
  }

  const bar = `<header class="bar"><span class="mono">${esc(name[0].toUpperCase())}</span><span class="bar-name">${esc(given)}${rest.length ? `<br>${esc(rest.join(' '))}` : ''}</span></header>`
  const focus = Array.isArray(cv.photo?.focus) ? ` style="--cover-x:${Number(cv.photo.focus[0])}%;--cover-y:${Number(cv.photo.focus[1])}%"` : ''
  const pill = cv.contact?.find((c) => /mail/i.test(c.label))?.value ?? cv.contact?.[0]?.value
  const cover = `<section class="page page-cover"${focus}>${bar}${ctx.photo
    ? `<img class="cover-photo" src="${ctx.photo}" alt="${esc(cv.photo?.alt ?? name)}">`
    : '<span class="cover-blank"></span>'}<span class="cover-circle"></span>
    <div class="cover-text"><h1 class="cover-name">${esc(given)}${rest.length ? `<br>${esc(rest.join(' '))}` : ''}</h1>${cv.role ? `<div class="cover-role">${esc(cv.role)}</div>` : ''}${pill ? `<div class="cover-pill">${esc(pill)}</div>` : ''}</div></section>`
  const content = (cls, inner) => `<section class="page ${cls}"><main class="main" data-col="main"><div class="flow">${inner}</div></main></section>`
  return { first: cover + content('page-info', blocks.join('')), continuation: content('page-cont', '') }
}
