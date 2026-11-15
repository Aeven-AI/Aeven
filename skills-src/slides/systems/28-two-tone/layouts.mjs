/**
 * Two Tone: flat grey pages split against one acid yellow, rust or mint field; huge semibold
 * grotesque titles and numerals; regular caps headings top left; hairline-ruled rows anchored to
 * a bottom rule; a small company name and date footer on a two-column grid.
 * Measured from the 16 frames of "Two Tone" (Figma Community).
 */

/** The field colours the colour panels cycle through, in the source's cover order. */
const TONES = ['yellow', 'rust', 'mint']

/** A section number as the source sets it: "01" draws as "1". */
const numeral = (n) => (/^\d+$/.test(String(n)) ? String(Number(n)) : String(n))

/** Initials for a team placeholder. */
const initials = (name) => name.split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase()

/** Rows anchored to the bottom rule: full 164px rows up to three, then the rows area shared. */
function rowsBox(n, g) {
  const span = g.rowsBottom - g.rowsTop
  const row = n <= 3 ? g.row : span / n
  return { row, top: g.rowsBottom - row * n }
}

/** Numeral size that fills a ruled row, cap height leaving 11px above and below. */
const rowNumeral = (row, max) => Math.round(Math.min(max, (row - 22) / 0.727))

/** Font size at which `text` fits `width` in Inter caps, capped at `max`. */
const capsFit = (text, width, max) => Math.floor(Math.min(max, width / (Math.max(1, String(text).length) * 0.68)))

/** A user picture, or the neutral grey slot when there is none. */
function picture(image, ctx, cls) {
  const src = ctx.image(image)
  return src
    ? `<div class="${cls}"><img class="fill" src="${ctx.esc(src)}" alt="${ctx.esc(image?.alt ?? '')}"></div>`
    : `<div class="${cls} slot" role="img" aria-label="${ctx.esc(image?.alt ?? '')}"></div>`
}

/** Company name left, date on the half grid line, along the bottom. */
const foot = (ctx, { date = true } = {}) => `<footer class="foot"><span>${ctx.esc(ctx.deck.title)}</span>${date && ctx.deck.date ? `<span>${ctx.esc(ctx.deck.date)}</span>` : ''}</footer>`

/** The regular caps heading in the top-left corner. */
const heading = (title, ctx) => `<h2 class="heading">${ctx.esc(title)}</h2>`

/**
 * The short line on the half grid line beside a heading; under the heading when the heading's
 * caps run past the half grid line.
 */
const lede = (text, ctx, title = '') => (text ? `<p class="lede${String(title).length * 0.68 * 63 > 600 ? ' under' : ''}">${ctx.esc(text)}</p>` : '')

/** Cover and closing: grey upper field with the huge title, coloured lower band with caps lines. */
function split(tone, title, lines, aside, ctx) {
  const n = String(title).length
  const size = n <= 9 ? 190 : n <= 16 ? 150 : 112
  const shown = lines.filter(Boolean)
  const meta = Math.min(...shown.map((l) => capsFit(l, 1232, 81)), 81)
  return `<section class="slide split t-${tone}"><div class="upper"><h1 class="hero" style="font-size:${size}px">${ctx.esc(title)}</h1>${aside ? `<p class="aside">${ctx.esc(aside)}</p>` : ''}</div>
    <div class="band"><div class="meta" style="font-size:${meta}px">${shown.map((l) => `<p${/@|\.\w{2,}$/.test(l) && !/\s/.test(l) ? ' class="plain"' : ''}>${ctx.esc(l)}</p>`).join('')}</div></div></section>`
}

export function css(system) {
  const { surface: s, rule, geometry: g, type: t } = system
  return `
:root { --grey: ${s.grey}; --yellow: ${s.yellow}; --rust: ${s.rust}; --mint: ${s.mint}; --slot: ${s.slot};
  --hair: ${rule.hair}; --thick: ${rule.thick}; --m: ${g.margin}px; --half: ${g.half}px; }
.slide { background: var(--grey); color: #000; font-size: ${t.body}px; line-height: 1.2; font-weight: 400; }
.t-yellow { --tone: var(--yellow); } .t-rust { --tone: var(--rust); } .t-mint { --tone: var(--mint); }
.fill { width: 100%; height: 100%; object-fit: cover; }
.slot { background: var(--slot); }

.foot { position: absolute; left: var(--m); right: var(--m); bottom: 22px; display: grid; grid-template-columns: calc(var(--half) - var(--m)) 1fr; font-size: ${t.meta}px; line-height: 1; white-space: nowrap; }
.heading { position: absolute; left: var(--m); right: var(--m); top: 14px; font-family: var(--font); font-size: ${t.title}px; line-height: 1; text-transform: uppercase; letter-spacing: -.005em; }
.lede { position: absolute; left: var(--half); right: var(--m); top: 20px; font-size: ${t.lede}px; line-height: 1.16; }
.lede.under { left: var(--m); top: 98px; }
.say { position: absolute; left: var(--m); top: 14px; max-width: 1010px; font-size: ${t.statement}px; line-height: 1.02; letter-spacing: -.01em; text-wrap: pretty; }
.note { position: absolute; left: var(--half); right: var(--m); top: 522px; font-size: 25px; line-height: 1.24; }
.label { font-size: ${t.label}px; font-weight: 500; line-height: 1.15; letter-spacing: -.005em; }
.small { font-size: ${t.body}px; line-height: 1.22; }
.num { font-family: var(--display-font); font-weight: 600; line-height: .76; letter-spacing: -.02em; }

/* Cover, closing, big number: grey upper field over a coloured band */
.split .upper { position: absolute; left: 0; right: 0; top: 0; height: ${g.split}px; }
.split .band { position: absolute; left: 0; right: 0; top: ${g.split}px; bottom: 0; background: var(--tone); }
.hero { position: absolute; left: 20px; right: var(--m); top: 10px; font-family: var(--display-font); font-weight: 600; line-height: .87; letter-spacing: -.012em; }
.aside { position: absolute; left: var(--half); right: var(--m); bottom: 26px; font-size: 25px; line-height: 1.24; }
.meta { position: absolute; left: var(--m); right: var(--m); bottom: 50px; line-height: 1.01; text-transform: uppercase; letter-spacing: -.005em; }
.meta .plain { text-transform: none; }
.split .value { position: absolute; left: 14px; top: 6px; font-size: var(--size); line-height: .8; }
.split .band .meta { white-space: nowrap; }

/* Section: colour panel with caps title and a huge numeral, grey to the right */
.panel { position: absolute; left: 0; top: 0; bottom: 0; width: ${g.panel}px; background: var(--tone); }
.panel .ptitle { position: absolute; left: var(--m); right: var(--m); top: 14px; font-family: var(--font); font-size: ${t.sectionTitle}px; line-height: 1; text-transform: uppercase; letter-spacing: -.008em; }
.panel .big { position: absolute; right: 22px; bottom: 18px; font-size: 594px; line-height: .75; }
.panel .foot { right: auto; }
.t-rust .panel .foot { color: #fff; }
.side { position: absolute; left: calc(${g.panel}px + var(--m)); right: var(--m); top: 20px; font-size: ${t.lede}px; line-height: 1.16; }

/* Ruled rows (agenda, metrics, bullets) */
.rows { position: absolute; right: var(--m); bottom: calc(720px - ${g.rowsBottom}px); list-style: none; display: grid; border-bottom: 1px solid var(--hair); }
.rows > * { border-top: 1px solid var(--hair); min-height: 0; }
.agenda .rows { left: 439px; }
.agenda li { display: grid; grid-template-columns: 215px 1fr; align-items: start; padding-top: 9px; }
.agenda li .num { padding-left: 12px; }
.agenda li span:last-child { line-height: 1; text-transform: uppercase; letter-spacing: -.005em; padding-top: 1px; }

.metrics .rows { left: var(--m); }
.metrics li { display: flex; justify-content: space-between; align-items: start; gap: 40px; padding-top: 9px; }
.metrics li .label { padding-top: 6px; max-width: 420px; }
.metrics li .num { white-space: nowrap; margin-right: -4px; }

.bullets .rows { left: var(--m); border-bottom: 0; grid-template-columns: calc(var(--half) - var(--m) - 16px) 1fr; column-gap: 16px; }
.bullets li.last { border-bottom: 1px solid var(--hair); }
.bullets li { display: grid; grid-template-columns: 219px 1fr; align-items: start; padding-top: 9px; }
.bullets li .num { padding-left: 12px; }
.bullets li p { font-size: 30px; line-height: 1.17; padding-top: 4px; padding-right: 8px; }

/* Columns with left hairlines (points, timeline, team) */
.cols { position: absolute; left: var(--m); right: var(--m); top: 188px; height: 388px; display: grid; grid-template-columns: repeat(var(--n), 1fr); }
.cols > * { display: flex; flex-direction: column; min-width: 0; }
.cols > * + * { border-left: 1px solid var(--hair); padding-left: 13px; }
.points .col .num { font-size: 193px; font-weight: 500; padding-left: 10px; margin-top: -2px; }
.points .col .txt { margin-top: auto; display: flex; flex-direction: column; gap: 8px; padding-right: 24px; }

.tl { position: absolute; left: var(--m); right: var(--m); top: 188px; height: 388px; display: grid; grid-template-columns: repeat(var(--n), 1fr); }
.tl::after { content: ""; position: absolute; left: 0; right: 0; top: 168px; border-top: 6px solid var(--thick); }
.tl .step { display: flex; flex-direction: column; border-left: 1px solid var(--hair); padding: 0 16px 0 17px; min-width: 0; }
.tl .top { height: 168px; display: flex; flex-direction: column; gap: 8px; }
.tl .when { margin-top: auto; font-size: 83px; line-height: 1; letter-spacing: -.01em; margin-bottom: -12px; }

.team .cols { height: auto; bottom: 52px; }
.team .cols > .person { border-left: 1px solid var(--hair); padding: 0 16px 0 17px; }
.team .face { position: relative; width: 100%; flex: 1 1 auto; min-height: 0; background: var(--tone, var(--slot)); display: flex; align-items: flex-end; justify-content: flex-end; }
.team .face .num { font-size: 132px; padding: 0 14px 12px 0; }
.team .face.t-rust .num { color: #000; }
.team .person .label { margin-top: 16px; }
.team .person .small { margin-top: 6px; }

/* Two columns: grey left, coloured right below the heading */
.halves { position: absolute; left: 0; right: 0; top: 175px; bottom: 0; display: grid; grid-template-columns: 640px 1fr; }
.halves > div { position: relative; }
.halves > div:first-child { margin-left: var(--m); border-top: 1px solid var(--hair); }
.halves > div:last-child { background: var(--yellow); }
.halves .ctitle { position: absolute; left: 0; right: 24px; top: 14px; font-size: ${t.title}px; line-height: 1; text-transform: uppercase; letter-spacing: -.005em; }
.halves > div:last-child .ctitle, .halves > div:last-child .cbody { left: var(--m); }
.halves .cbody { position: absolute; left: 0; right: 40px; bottom: 72px; font-size: 32px; line-height: 1.16; }
.halves .foot { position: absolute; left: 0; right: auto; }
.halves > div:last-child .foot { left: 8px; }

/* Table */
.tbl { position: absolute; left: var(--m); right: var(--m); top: 175px; bottom: 52px; }
.tbl table { width: 100%; height: 100%; border-collapse: collapse; table-layout: fixed; }
.tbl th { height: 64px; text-align: left; vertical-align: middle; font-size: ${t.label}px; font-weight: 500; padding-right: 20px; border-top: 1px solid var(--hair); }
.tbl td { border-top: 1px solid var(--hair); padding-right: 20px; font-size: 34px; line-height: 1.1; vertical-align: middle; font-variant-numeric: tabular-nums; }
.tbl tr:last-child td { border-bottom: 1px solid var(--hair); }
.tbl td:first-child { text-transform: uppercase; }

/* Image and text, full image */
.band-img { position: absolute; left: var(--m); right: var(--m); top: 383px; bottom: 25px; }
.side-note { position: absolute; left: var(--half); right: var(--m); top: 300px; font-size: ${t.body}px; line-height: 1.24; }
.shot { position: absolute; left: var(--m); right: var(--m); top: var(--m); bottom: 88px; }
.shot-cap { position: absolute; left: var(--m); right: var(--m); bottom: 30px; font-size: 25px; line-height: 1.2; }

/* Frame (chart, custom) */
.frame-body { position: absolute; left: var(--m); right: var(--m); top: 175px; bottom: 60px; display: flex; flex-direction: column; }
`
}

export const slides = {
  cover: (d, ctx) => split('yellow', d.title, [d.eyebrow, ctx.deck.date], d.subtitle, ctx),

  agenda: (d, ctx) => {
    const g = ctx.system.geometry
    const { row, top } = rowsBox(d.items.length, g)
    const n = rowNumeral(row, 194)
    const width = 1256 - 439 - 215
    return `<section class="slide agenda">${heading(d.title, ctx)}
    <ol class="rows" style="top:${top}px;grid-template-rows:repeat(${d.items.length},1fr)">${d.items.map((item, i) => {
      const size = Math.min(Math.round(row * 0.49), capsFit(item, width, 81))
      return `<li><span class="num" style="font-size:${n}px">${i + 1}</span><span style="font-size:${size}px">${ctx.esc(item)}</span></li>`
    }).join('')}</ol>${foot(ctx)}</section>`
  },

  section: (d, ctx) => {
    const k = Number.parseInt(d.number, 10)
    const tone = TONES[((Number.isNaN(k) ? ctx.index : k) - 1 + TONES.length * 10) % TONES.length]
    return `<section class="slide section t-${tone}"><div class="panel"><h2 class="ptitle" style="font-size:${String(d.title).length <= 16 ? 83 : String(d.title).length <= 30 ? 63 : 50}px">${ctx.esc(d.title)}</h2>
    <span class="num big">${ctx.esc(numeral(d.number))}</span>${foot(ctx, { date: false })}</div>
    ${d.subtitle ? `<p class="side">${ctx.esc(d.subtitle)}</p>` : ''}</section>`
  },

  statement: (d, ctx) => `<section class="slide" style="background:var(--yellow)"><p class="say">${ctx.esc(d.text)}</p>
    ${d.attribution ? `<p class="note">${ctx.esc(d.attribution)}</p>` : ''}${foot(ctx)}</section>`,

  text: (d, ctx) => `<section class="slide">${heading(d.title, ctx)}${lede(d.eyebrow, ctx, d.title)}
    <div class="rows" style="left:var(--half);top:175px;border-bottom:0"><p style="padding-top:14px;font-size:32px;line-height:1.18">${ctx.esc(d.body)}</p></div>${foot(ctx)}</section>`,

  points: (d, ctx) => `<section class="slide points">${heading(d.title, ctx)}
    <div class="cols" style="--n:${d.items.length}">${d.items.map((item, i) => `<div class="col"><span class="num">${i + 1}</span>
      <div class="txt"><h3 class="label">${ctx.esc(item.title)}</h3><p class="small">${ctx.esc(item.body)}</p></div></div>`).join('')}</div>${foot(ctx)}</section>`,

  'image-text': (d, ctx) => `<section class="slide"><h2 class="say" style="font-family:var(--font)">${ctx.esc(d.title)}</h2>
    <p class="side-note">${ctx.esc(d.body)}</p>${picture(d.image, ctx, 'band-img')}</section>`,

  metrics: (d, ctx) => {
    const { row, top } = rowsBox(d.items.length, ctx.system.geometry)
    const longest = Math.max(...d.items.map((m) => String(m.value).length))
    const n = Math.min(rowNumeral(row, 200), Math.floor(700 / (longest * 0.62)))
    return `<section class="slide metrics">${heading(d.title, ctx)}
    <ul class="rows" style="top:${top}px;grid-template-rows:repeat(${d.items.length},1fr)">${d.items.map((m) => `<li><span class="label">${ctx.esc(m.label)}</span><span class="num" style="font-size:${n}px">${ctx.esc(m.value)}</span></li>`).join('')}</ul>${foot(ctx)}</section>`
  },

  'two-column': (d, ctx) => `<section class="slide">${heading(d.title, ctx)}
    <div class="halves">${d.columns.map((c, i) => `<div><h3 class="ctitle">${ctx.esc(c.title)}</h3><p class="cbody">${ctx.esc(c.body)}</p>
      <footer class="foot"><span>${ctx.esc(i === 0 ? ctx.deck.title : ctx.deck.date ?? '')}</span></footer></div>`).join('')}</div></section>`,

  timeline: (d, ctx) => `<section class="slide">${heading(d.title, ctx)}
    <div class="tl" style="--n:${d.steps.length}">${d.steps.map((s) => `<div class="step"><div class="top"><h3 class="label">${ctx.esc(s.title)}</h3>${s.body ? `<p class="small">${ctx.esc(s.body)}</p>` : ''}</div>
      <span class="when">${ctx.esc(s.when)}</span></div>`).join('')}</div>${foot(ctx)}</section>`,

  quote: (d, ctx) => `<section class="slide"><p class="say">“${ctx.esc(d.text)}”</p>
    <p class="note">${ctx.esc(d.name)}${d.role ? `<br>${ctx.esc(d.role)}` : ''}</p>${foot(ctx)}</section>`,

  table: (d, ctx) => `<section class="slide">${heading(d.title, ctx)}<div class="tbl">
    <table><thead><tr>${d.columns.map((c) => `<th>${ctx.esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${d.rows.map((r) => `<tr>${r.map((c) => `<td>${ctx.esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${foot(ctx)}</section>`,

  'big-number': (d, ctx) => {
    const size = Math.min(480, Math.floor(600 / (String(d.value).length * 0.62)))
    const meta = capsFit(d.label, 1232, 81)
    return `<section class="slide split t-rust"><div class="upper"><span class="num value" style="--size:${size}px">${ctx.esc(d.value)}</span>
    ${d.body ? `<p class="aside">${ctx.esc(d.body)}</p>` : ''}</div>
    <div class="band"><div class="meta" style="font-size:${meta}px"><p>${ctx.esc(d.label)}</p></div></div></section>`
  },

  bullets: (d, ctx) => {
    const rowsN = Math.ceil(d.items.length / 2)
    const { row, top } = rowsBox(rowsN, ctx.system.geometry)
    const n = rowNumeral(row, 194)
    return `<section class="slide bullets">${heading(d.title, ctx)}
    <ol class="rows" style="top:${top}px;grid-template-rows:repeat(${rowsN},1fr);grid-auto-flow:row">${d.items.map((item, i) => `<li${Math.floor(i / 2) === rowsN - 1 ? ' class="last"' : ''}><span class="num" style="font-size:${n}px">${i + 1}</span><p>${ctx.esc(item)}</p></li>`).join('')}</ol>${foot(ctx)}</section>`
  },

  team: (d, ctx) => {
    const fills = ['t-yellow', 't-rust', 't-mint', '']
    return `<section class="slide team">${heading(d.title, ctx)}
    <div class="cols" style="--n:${d.people.length}">${d.people.map((p, i) => {
      const src = p.image && ctx.image(p.image)
      const face = src
        ? `<div class="face"><img class="fill" src="${ctx.esc(src)}" alt="${ctx.esc(p.name)}"></div>`
        : `<div class="face ${fills[i % fills.length]}" role="img" aria-label="${ctx.esc(p.name)}"><span class="num">${ctx.esc(initials(p.name))}</span></div>`
      return `<div class="person">${face}<h3 class="label">${ctx.esc(p.name)}</h3><p class="small">${ctx.esc(p.role)}</p></div>`
    }).join('')}</div>${foot(ctx)}</section>`
  },

  image: (d, ctx) => `<section class="slide">${picture(d.image, ctx, 'shot')}${d.caption ? `<p class="shot-cap">${ctx.esc(d.caption)}</p>` : ''}</section>`,

  /** The titled content slide that `chart` and `custom` slides are drawn in. */
  frame: ({ title, eyebrow }, ctx, body) => `<section class="slide">${title ? heading(title, ctx) : ''}${lede(eyebrow, ctx, title)}
    <div class="frame-body">${body}</div>${foot(ctx)}</section>`,

  closing: (d, ctx) => split('mint', d.title, [d.subtitle, d.contact], null, ctx),
}
