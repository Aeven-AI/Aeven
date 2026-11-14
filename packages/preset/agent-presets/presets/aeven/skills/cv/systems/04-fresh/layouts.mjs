/**
 * Fresh: a light one-page portfolio site with fresh green accents, stitched into A4 pages.
 *
 * Page 1 carries the header, the initial with a green dot; the pages after it carry no header or
 * page number, so the exported pages read as one scroll. Page 1 opens on the hero: "Hello, I'm" and the name in Montserrat on the left, "I'm a" and the role in green,
 * the profile and a green contact button, and on the right a slanted mint shape with a rounded foot
 * holding the photo, its white background blended into the mint. About follows on the same page:
 * the second photo in a grey frame beside the profile and a Basic Info table. The sections after it
 * sit on bands that alternate white and pale blue, each under a centred title and intro: skills as
 * a row of counters with line icons, timelines and lists as white cards two to a row, languages as
 * green bars, and tags as filter chips.
 *
 * Blocks (`data-block`) are what pagination moves; a row of two cards moves as one block.
 * `data-keep` keeps a heading with the block after it; `data-band` names a block's band colour.
 */

/** The stylesheet; colours come from the palette as `--c-<name>`. */
export function css() {
  return `
.page { position: relative; display: flex; flex-direction: column; background: var(--c-page); color: var(--c-text); font-size: 13.5px; line-height: 1.65; }

/* Header on page 1: the initial and its green dot. */
.head-bar { position: absolute; z-index: 3; inset: 0 0 auto 0; display: flex; align-items: center; height: 72px; padding: 0 78px; }
.logo { font-family: var(--display-font); font-size: 40px; font-weight: 800; line-height: 1; letter-spacing: -.02em; color: var(--c-ink); }
.logo i { display: inline-block; width: 10px; height: 10px; margin-left: 3px; border-radius: 50%; background: var(--c-accent); }

.main { position: relative; display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
.flow { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; overflow: hidden; padding-top: 72px; background: var(--c-page); }
.flow[data-tail="panel"] { background: var(--c-panel); }
.flow > * { flex: none; position: relative; padding: 0 78px; background: var(--c-page); }
.flow > [data-band="panel"] { background: var(--c-panel); }
.flow > .sec-start { padding-top: 44px; }
.flow > .sec-end { padding-bottom: 40px; }
.flow > :first-child:not(.hero) { padding-top: 30px; }
.page-cont .flow { padding-top: 0; }
.page-cont .flow > :first-child { padding-top: 44px; }

/* Hero: text on the left, the photo in the slanted mint shape on the right. */
.hero { height: 470px; margin-top: -72px; }
.hero-shape { position: absolute; top: 0; right: 0; width: 402px; height: 470px; background: var(--c-shape); clip-path: path('M74 0H402V470H96C34 470 -4 430 8 368Z'); overflow: hidden; }
.hero-photo { position: absolute; inset: 0 0 0 30px; width: calc(100% - 30px); height: 100%; object-fit: cover; object-position: var(--cover-x, 50%) var(--cover-y, 18%); mix-blend-mode: multiply; }
.hero-copy { position: absolute; left: 78px; top: 116px; width: 330px; }
.hero-name { font-family: var(--display-font); font-size: 44px; font-weight: 700; line-height: 1.25; color: var(--c-ink); }
.hero-role { margin-top: 18px; font-family: var(--display-font); font-size: 20px; font-weight: 400; line-height: 1.35; color: var(--c-ink); }
.hero-role span { color: var(--c-accent); }
.button { display: inline-block; margin-top: 24px; padding: 13px 30px; background: var(--c-accent); color: var(--c-on-accent); font-size: 14.5px; line-height: 1.5; }

/* About on the first page: the framed photo beside the profile and Basic Info. */
.about { display: grid; grid-template-columns: 210px 1fr; column-gap: 30px; padding-top: 70px; padding-bottom: 56px; }
.frame { align-self: start; padding: 10px; background: var(--c-frame); }
.frame img { width: 190px; height: 200px; object-fit: cover; object-position: center 15%; }
.about-title { font-family: var(--display-font); font-size: 28px; font-weight: 700; line-height: 1.2; color: var(--c-ink); }
.about-text { margin-top: 12px; font-size: 14.5px; }
.about-rule { height: 1px; margin: 18px 0 16px; background: var(--c-rule); }
.info-title { font-family: var(--display-font); font-size: 17px; font-weight: 700; color: var(--c-ink); }
.info { margin-top: 10px; display: grid; grid-template-columns: 112px 1fr; row-gap: 9px; font-size: 14.5px; line-height: 1.45; }
.info dt { font-weight: 500; color: var(--c-ink); }
.info dd { color: var(--c-text); overflow-wrap: anywhere; }

/* Sections: a centred title and intro. */
.sec-head { text-align: center; }
.sec-title { font-family: var(--display-font); font-size: 30px; font-weight: 700; line-height: 1.25; color: var(--c-ink); }
.sec-intro { max-width: 470px; margin: 14px auto 0; font-size: 14.5px; }
.sec-gap { height: 30px; }

.counters { display: grid; grid-template-columns: repeat(4, 1fr); row-gap: 26px; text-align: center; }
.counter-icon { width: 40px; height: 40px; margin: 0 auto; color: var(--c-ink); stroke-width: 1.4; }
.counter-value { margin-top: 12px; font-family: var(--display-font); font-size: 27px; font-weight: 700; line-height: 1.2; color: var(--c-strong); }
.counter-name { margin-top: 4px; font-size: 14.5px; color: var(--c-ink); }

.cards { display: grid; grid-template-columns: 1fr 1fr; column-gap: 30px; padding-bottom: 24px; }
.card { padding: 24px 28px 26px; background: #fff; box-shadow: 0 2px 14px rgba(0, 0, 0, .08); }
.card-title { font-family: var(--display-font); font-size: 19px; font-weight: 600; line-height: 1.3; color: var(--c-ink); }
.card-meta { margin-top: 10px; font-size: 14.5px; line-height: 1.4; color: var(--c-text); }
.card-meta b { font-weight: 400; color: var(--c-accent); }
.card-rule { height: 1px; margin: 16px 0 14px; background: var(--c-rule); }
.card-text { font-size: 14px; }
.card-points { margin-top: 8px; list-style: none; }
.card-points li { position: relative; padding-left: 14px; }
.card-points li::before { content: ""; position: absolute; left: 0; top: .66em; width: 6px; height: 6px; border-radius: 50%; background: var(--c-accent); }

.langs { display: grid; grid-template-columns: 1fr 1fr; column-gap: 40px; row-gap: 20px; }
.lang-head { display: flex; justify-content: space-between; align-items: baseline; }
.lang-name { font-family: var(--display-font); font-size: 15px; font-weight: 600; color: var(--c-ink); }
.lang-level { font-size: 13px; color: var(--c-muted); }
.lang-bar { height: 5px; margin-top: 9px; background: var(--c-rule); }
.lang-bar span { display: block; height: 100%; background: var(--c-accent); }

.chips { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; }
.chip { padding: 6px 18px 7px; border: 1px solid #cfcfcf; font-size: 14.5px; line-height: 1.4; color: var(--c-muted); }
.chip:first-child { border-color: var(--c-accent); background: var(--c-accent); color: var(--c-on-accent); }
.plain-text { max-width: 560px; margin: 0 auto; text-align: center; font-size: 14.5px; }
`
}

/** Icons for the skill counters, in turn. */
const COUNTER_ICONS = ['pen', 'compass', 'code', 'chart', 'camera', 'megaphone', 'book', 'globe']

/**
 * The CV's pages.
 * @param {object} cv - validated CV.
 * @param {object} ctx - `{ esc, photo, backdrop, icon, labels }` from the renderer.
 * @returns {{ first: string, continuation: string }} the first page with every block (hero and
 *   About lead), and an empty page the pagination clones for what does not fit.
 */
export function pages(cv, ctx) {
  const { esc, labels, icon } = ctx
  const name = cv.name.trim()
  const blocks = []
  let band = 'page'

  // The hero and About sit on the first page's white.
  const email = cv.contact?.find((c) => /mail/i.test(c.label))?.value
  blocks.push(`<div class="hero" data-block data-band="page">${ctx.photo ? `<div class="hero-shape"><img class="hero-photo" src="${ctx.photo}" alt="${esc(cv.photo?.alt ?? name)}"></div>` : '<div class="hero-shape"></div>'}
    <div class="hero-copy"><h1 class="hero-name">${cv.greeting === '' ? '' : `${esc(cv.greeting ?? "Hello, I'm")}<br>`}${esc(name)}</h1>${cv.role ? `<div class="hero-role">${esc(labels.roleLead)} <span>${esc(cv.role)}</span></div>` : ''}${email ? `<div class="button">${esc(email)}</div>` : ''}</div></div>`)
  if (cv.profile || cv.contact?.length) {
    blocks.push(`<section class="about" data-block data-band="page">${ctx.backdrop ? `<div class="frame"><img src="${ctx.backdrop}" alt=""></div>` : '<div></div>'}<div><h2 class="about-title">${esc(labels.about)}</h2>${cv.profile ? `<p class="about-text">${esc(cv.profile)}</p>` : ''}${cv.contact?.length
      ? `<div class="about-rule"></div><h3 class="info-title">${esc(labels.contact)}</h3><dl class="info">${cv.contact.map((row) => `<dt>${esc(row.label)}:</dt><dd>${esc(row.value)}</dd>`).join('')}</dl>` : ''}</div></section>`)
  }

  // A section: a centred heading block and its body blocks on one band; the next takes the other.
  const section = (title, intro, body) => {
    band = band === 'page' ? 'panel' : 'page'
    const parts = [`<div class="sec-head" data-block data-keep><h2 class="sec-title">${esc(title)}</h2>${intro ? `<p class="sec-intro">${esc(intro)}</p>` : ''}<div class="sec-gap"></div></div>`, ...body]
    parts.forEach((html, i) => {
      const cls = [i === 0 ? 'sec-start' : '', i === parts.length - 1 ? 'sec-end' : ''].filter(Boolean).join(' ')
      blocks.push(html.replace(/^<div class="/, `<div data-band="${band}" class="${cls} `))
    })
  }
  const cards = (items, draw) => {
    const out = []
    for (let i = 0; i < items.length; i += 2) out.push(`<div class="cards" data-block>${draw(items[i])}${items[i + 1] ? draw(items[i + 1]) : '<div></div>'}</div>`)
    return out
  }

  if (cv.skills?.length) {
    section(labels.skills, labels.skillsIntro, [`<div class="skills" data-block><div class="counters">${cv.skills.map((s, i) =>
      `<div class="counter">${icon(COUNTER_ICONS[i % COUNTER_ICONS.length], 'counter-icon')}<div class="counter-value">${Math.round(s.level)}%</div><div class="counter-name">${esc(s.name)}</div></div>`).join('')}</div></div>`])
  }
  for (const sec of cv.sections ?? []) section(sec.title, sec.intro, bodyOf(sec))
  if (cv.languages?.length) {
    section(labels.languages, labels.languagesIntro, [`<div class="languages" data-block><div class="langs">${cv.languages.map((l) =>
      `<div class="lang"><div class="lang-head"><span class="lang-name">${esc(l.name)}</span>${l.level ? `<span class="lang-level">${esc(l.level)}</span>` : ''}</div><div class="lang-bar"><span style="width:${l.value ?? 100}%"></span></div></div>`).join('')}</div></div>`])
  }
  for (const sec of cv.sidebar ?? []) section(sec.title, sec.intro, bodyOf(sec))

  function bodyOf(sec) {
    if (sec.kind === 'text') return [`<div class="plain" data-block><p class="plain-text">${esc(sec.text)}</p></div>`]
    if (sec.kind === 'tags') return [`<div class="tags" data-block><div class="chips">${sec.items.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div></div>`]
    if (sec.kind === 'list') {
      return cards(sec.items, (it) => `<div class="card"><div class="card-title">${esc(it.title)}</div>${it.meta ? `<div class="card-meta"><b>${esc(it.meta)}</b></div>` : ''}${it.text ? `<div class="card-rule"></div><p class="card-text">${esc(it.text)}</p>` : ''}</div>`)
    }
    return cards(sec.items, (it) => {
      const meta = [it.dates ? `<b>${esc(it.dates)}</b>` : '', [it.org, it.place].filter(Boolean).map(esc).join(', ')].filter(Boolean).join(' ')
      const points = it.points?.length ? `<ul class="card-points">${it.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''
      return `<div class="card"><div class="card-title">${esc(it.title)}</div>${meta ? `<div class="card-meta">${meta}</div>` : ''}${it.text || points ? `<div class="card-rule"></div>${it.text ? `<p class="card-text">${esc(it.text)}</p>` : ''}${points}` : ''}</div>`
    })
  }

  const focus = Array.isArray(cv.photo?.focus) ? ` style="--cover-x:${Number(cv.photo.focus[0])}%;--cover-y:${Number(cv.photo.focus[1])}%"` : ''
  const header = `<header class="head-bar"><span class="logo">${esc(name[0].toUpperCase())}<i></i></span></header>`
  const page = (cls, inner) => `<section class="page ${cls}"${focus}>${cls === 'page-first' ? header : ''}<main class="main" data-col="main"><div class="flow">${inner}</div></main></section>`
  return { first: page('page-first', blocks.join('')), continuation: page('page-cont', '') }
}
