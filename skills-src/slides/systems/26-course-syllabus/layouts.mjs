/**
 * Course Syllabus: flat charcoal slides, large white Playfair Display titles, numbered serif
 * lists and hanging-quote serif quotes, one coloured dot in the top-right corner that changes
 * colour from slide to slide, a row of five overlapping dots on the cover, and small Inter
 * footer meta (deck | presenter | date, then the page number) at the bottom right.
 * Measured from the 16 frames of Figma's "University Course Syllabus" (Figma Community).
 */

/** Single-dot colours in deck order; slide n takes entry (n - 2) so the first content slide is green. */
const CYCLE = ['green', 'pink', 'yellow', 'purple', 'orange', 'blue']

/** The cover's overlapping row, left to right; each dot sits over the one before it. */
const ROW = ['orange', 'purple', 'pink', 'yellow', 'green']

const dot = (ctx) => `<span class="dot d-${CYCLE[(ctx.index + CYCLE.length - 2) % CYCLE.length]}" aria-hidden="true"></span>`

const row = (cls = '') => `<span class="row ${cls}" aria-hidden="true">${ROW.map((c) => `<i class="d-${c}"></i>`).join('')}</span>`

/** Footer meta: deck title, presenter and date, then the page number. */
function footer(ctx) {
  const meta = [ctx.deck.title, ctx.deck.presenter, ctx.deck.date].filter(Boolean).map((t) => ctx.esc(t)).join(' | ')
  return `<footer class="foot"><span>${meta}</span><span class="pg">${ctx.index}</span></footer>`
}

/** A content slide: the corner dot, the body, the footer. */
const slide = (cls, ctx, body) => `<section class="slide ${cls}">${dot(ctx)}${body}${footer(ctx)}</section>`

/**
 * A font size that keeps `text` within `lines` lines of `width` px at Playfair's average advance
 * (`em` × size per character), clamped to [min, max].
 */
function fit(text, { width, lines, max, min, em = 0.43 }) {
  const str = String(text)
  const byLines = ((width * lines) / (Math.max(str.length, 1) * em)) * 0.88
  const word = Math.max(1, ...str.split(/\s+/).map((w) => w.length))
  const byWord = width / (word * em * 1.15)
  return Math.round(Math.max(min, Math.min(max, byLines, byWord)))
}

/** A user picture, or the neutral field with the dot row when the slot has none. */
function picture(image, ctx, cls) {
  const src = ctx.image(image)
  return src
    ? `<img class="${cls}" src="${ctx.esc(src)}" alt="${ctx.esc(image.alt)}">`
    : `<div class="${cls} ph" role="img" aria-label="${ctx.esc(image?.alt ?? '')}">${row('small')}</div>`
}

const initials = (name) => name.split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase()

export function css(system) {
  const { surface, ink, dots, geometry: g } = system
  return `
:root { --paper: ${surface.page}; --ph: ${surface.placeholder}; --ink: ${ink.primary}; --soft: ${ink.soft};
  ${Object.entries(dots).map(([k, v]) => `--${k}: ${v};`).join(' ')}
  --m: ${g.margin}px; --dot: ${g.dot}px; --dot-top: ${g.dotTop}px; }
.slide { background: var(--paper); color: var(--ink); padding: 71px var(--m) 0; display: flex; flex-direction: column; font-size: 19px; line-height: 1.3; font-variant-numeric: lining-nums; }
.d-orange { background: var(--orange); } .d-purple { background: var(--purple); } .d-pink { background: var(--pink); }
.d-yellow { background: var(--yellow); } .d-green { background: var(--green); } .d-blue { background: var(--blue); }
.dot { position: absolute; top: var(--dot-top); right: var(--m); width: var(--dot); height: var(--dot); border-radius: 50%; }
.row { display: flex; }
.row i { display: block; width: var(--dot); height: var(--dot); border-radius: 50%; }
.row i + i { margin-left: -32px; }
.row.small i { width: 56px; height: 56px; } .row.small i + i { margin-left: -22px; }
.foot { position: absolute; right: var(--m); bottom: 36px; display: flex; gap: 44px; font-family: var(--font); font-size: 13px; line-height: 16px; letter-spacing: .01em; color: var(--ink); }
.foot .pg { min-width: 8px; text-align: right; font-variant-numeric: tabular-nums; }

.serif { font-family: var(--display-font); }
.h { font-family: var(--display-font); font-size: 94px; line-height: 1.05; letter-spacing: -.005em; max-width: 1000px; }
.label { font-family: var(--display-font); font-size: 38px; line-height: 1.22; }
.copy { font-size: 19px; line-height: 1.32; }
.small { font-size: 15px; line-height: 1.38; }
.lead { font-family: var(--display-font); font-size: 38px; line-height: 1.28; max-width: 1024px; }
.eyebrow { font-family: var(--display-font); font-size: 30px; line-height: 1.2; margin-bottom: 6px; }

/* cover */
.cover { padding: 0 var(--m); justify-content: flex-end; }
.cover .meta { position: absolute; top: 88px; left: var(--m); right: var(--m); display: flex; justify-content: space-between; gap: 40px; font-family: var(--display-font); font-size: 40px; line-height: 1.1; }
.cover .uni { font-family: var(--display-font); font-size: 40px; line-height: 1.1; margin-bottom: 16px; }
.cover h1 { max-width: 840px; line-height: .96; letter-spacing: -.01em; text-wrap: balance; }
.cover .sub { font-family: var(--display-font); font-size: 26px; line-height: 1.3; max-width: 820px; margin-top: 30px; }
.cover .body { padding-bottom: 66px; }
.cover .row { position: absolute; right: var(--m); bottom: 81px; }

/* agenda: a numbered serif list */
.agenda .label { margin-bottom: 18px; }
.agenda ol { list-style: none; display: grid; grid-template-columns: auto 1fr; column-gap: .3em; font-family: var(--display-font); line-height: 1.03; margin-left: 16px; }
.agenda li { display: contents; }
.agenda .n { text-align: right; font-variant-numeric: lining-nums; }

/* section: number over a bottom-set title */
.section { justify-content: flex-end; padding-bottom: 92px; }
.section .num { font-family: var(--display-font); font-size: 46px; line-height: 1; margin-bottom: 20px; }
.section .h { font-size: 120px; line-height: 1.02; max-width: 1040px; }
.section .lead { margin-top: 16px; }

/* statement: title text only */
.statement { justify-content: center; padding-bottom: 40px; }
.statement p { font-family: var(--display-font); line-height: 1.0; letter-spacing: -.01em; max-width: 1060px; }
.statement .by { margin-top: 30px; font-family: var(--display-font); font-size: 38px; line-height: 1.2; }

/* text */
.text .lead { margin-top: 110px; }

/* columns: points, two-column, metrics, timeline, team */
.cols { display: grid; grid-template-columns: repeat(var(--n), 1fr); column-gap: 56px; margin-top: 52px; }
.cols.wide { column-gap: 96px; }
.cols.four { column-gap: 36px; }
.cols.four .metric b { font-size: 96px; }
.col { display: flex; flex-direction: column; min-width: 0; }
.col .label + .label { margin-top: 0; }
.col .copy, .col .small { margin-top: 14px; }
.points .col .small { margin-top: 18px; }
.two .col .copy { max-width: 470px; font-size: 22px; }

.metrics .cols { margin-top: auto; margin-bottom: 118px; }
.metric b { font-family: var(--display-font); font-weight: 400; font-size: 110px; white-space: nowrap; line-height: 1; letter-spacing: -.01em; font-variant-numeric: lining-nums; }

.timeline .cols { margin-top: auto; margin-bottom: 110px; }
.step .tick { width: 30px; height: 30px; border-radius: 50%; margin-bottom: 22px; }
.step .label { font-size: 34px; }
.step h3.label { margin-top: 6px; }

/* quote: hanging opening mark */
.quote { justify-content: flex-end; padding-bottom: 100px; }
.quote blockquote { font-family: var(--display-font); line-height: 1.1; letter-spacing: -.005em; max-width: 1010px; text-indent: -.4em; }
.quote .by { margin-top: 34px; font-family: var(--display-font); font-size: 38px; line-height: 1.2; }

/* table */
table { width: 100%; border-collapse: collapse; margin-top: 46px; }
th { font-family: var(--display-font); font-weight: 400; font-size: 34px; line-height: 1.2; text-align: left; padding: 0 24px 14px 0; }
td { font-size: 20px; line-height: 1.3; padding: 15px 24px 15px 0; border-top: 1px solid var(--avn-rule); font-variant-numeric: tabular-nums; }
td:first-child { font-family: var(--display-font); font-size: 26px; }

/* big number */
.big { justify-content: center; padding-bottom: 40px; }
.big .wrap { display: grid; grid-template-columns: auto 1fr; column-gap: 64px; align-items: end; }
.big b { font-family: var(--display-font); font-weight: 400; font-size: 300px; line-height: .86; letter-spacing: -.02em; font-variant-numeric: lining-nums; }
.big .what { padding-bottom: 22px; max-width: 520px; }
.big .what .copy { margin-top: 16px; }

/* bullets */
.bullets ul { list-style: none; margin-top: 44px; display: grid; grid-template-columns: auto 1fr; column-gap: .55em; row-gap: 6px; font-family: var(--display-font); font-size: 44px; line-height: 1.18; max-width: 1000px; }
.bullets li { display: contents; }

/* image-text */
.it { flex-direction: row; gap: 64px; padding-top: 79px; }
.it .media { flex: none; width: 600px; height: 520px; border-radius: 10px; object-fit: cover; }
.it .side { display: flex; flex-direction: column; min-width: 0; padding-top: 130px; }
.it .h { font-size: 64px; line-height: 1.08; }
.it .copy { margin-top: 22px; font-size: 21px; max-width: 420px; }
.ph { background: var(--ph); display: grid; place-items: center; }

/* image */
.image { padding: 0; }
.image .media { width: 100%; height: 541px; flex: none; border-radius: 0 0 10px 10px; object-fit: cover; }
.image .cap { margin: 44px var(--m) 0; font-family: var(--display-font); font-size: 38px; line-height: 1.1; max-width: 760px; }

/* team: a coloured dot per person */
.face { width: 150px; height: 150px; border-radius: 50%; object-fit: cover; display: grid; place-items: center; margin-bottom: 26px; }
.face span { font-family: var(--display-font); font-size: 50px; line-height: 1; color: var(--paper); }
.team .cols { margin-top: auto; margin-bottom: 110px; }

/* closing */
.closing .h { font-size: 190px; line-height: 1; letter-spacing: -.01em; }
.closing .contact { margin-top: 34px; margin-left: 96px; display: grid; grid-template-columns: auto 1fr; column-gap: .5em; font-family: var(--display-font); font-size: 38px; line-height: 1.24; }
.closing .contact .who { grid-column: 2; }

/* frame: chart and custom */
.framed .h { font-size: 72px; }
.framed .avn-body { margin: 30px 0 96px; }
`
}

const h = (tag, text, ctx, cls = 'h') => `<${tag} class="${cls}">${ctx.esc(text)}</${tag}>`

export const slides = {
  cover: (d, ctx) => {
    const size = fit(d.title, { width: 840, lines: 2, max: 176, min: 104, em: 0.41 })
    return `<section class="slide cover">
    <div class="meta">${ctx.deck.presenter ? `<span>${ctx.esc(ctx.deck.presenter)}</span>` : '<span></span>'}${ctx.deck.date ? `<span>${ctx.esc(ctx.deck.date)}</span>` : ''}</div>
    <div class="body">${d.eyebrow ? `<p class="uni">${ctx.esc(d.eyebrow)}</p>` : ''}<h1 class="h" style="font-size:${size}px">${ctx.esc(d.title)}</h1>
    ${d.subtitle ? `<p class="sub">${ctx.esc(d.subtitle)}</p>` : ''}</div>${row()}</section>`
  },

  agenda: (d, ctx) => {
    const size = d.items.length > 5 ? 78 : 92
    return slide('agenda', ctx, `${h('h2', d.title, ctx, 'label')}<ol style="font-size:${size}px">${d.items.map((item, i) => `<li><span class="n">${i + 1}.</span><span>${ctx.esc(item)}</span></li>`).join('')}</ol>`)
  },

  section: (d, ctx) => slide('section', ctx, `<span class="num">${ctx.esc(d.number)}</span>${h('h2', d.title, ctx)}${d.subtitle ? `<p class="lead">${ctx.esc(d.subtitle)}</p>` : ''}`),

  statement: (d, ctx) => {
    const size = fit(d.text, { width: 1060, lines: 3, max: 190, min: 72 })
    return slide('statement', ctx, `<p style="font-size:${size}px">${ctx.esc(d.text)}</p>${d.attribution ? `<p class="by">— ${ctx.esc(d.attribution)}</p>` : ''}`)
  },

  text: (d, ctx) => slide('text', ctx, `${d.eyebrow ? h('p', d.eyebrow, ctx, 'eyebrow') : ''}${h('h2', d.title, ctx)}<p class="lead">${ctx.esc(d.body)}</p>`),

  points: (d, ctx) => slide('points', ctx, `${h('h2', d.title, ctx)}<div class="cols" style="--n:${d.items.length}">${d.items.map((item, i) => `<div class="col">
    <span class="label">${String(i + 1).padStart(2, '0')}</span><h3 class="label" style="margin-top:20px">${ctx.esc(item.title)}</h3><p class="small">${ctx.esc(item.body)}</p></div>`).join('')}</div>`),

  'image-text': (d, ctx) => slide('it', ctx, `${picture(d.image, ctx, 'media')}<div class="side">${h('h2', d.title, ctx)}<p class="copy">${ctx.esc(d.body)}</p></div>`),

  metrics: (d, ctx) => slide('metrics', ctx, `${h('h2', d.title, ctx)}<div class="cols${d.items.length > 3 ? ' four' : ''}" style="--n:${d.items.length}">${d.items.map((m) => `<div class="col metric">
    <b>${ctx.esc(m.value)}</b><p class="copy">${ctx.esc(m.label)}</p></div>`).join('')}</div>`),

  'two-column': (d, ctx) => slide('two', ctx, `${h('h2', d.title, ctx)}<div class="cols wide" style="--n:2">${d.columns.map((c) => `<div class="col">
    ${h('h3', c.title, ctx, 'label')}<p class="copy">${ctx.esc(c.body)}</p></div>`).join('')}</div>`),

  timeline: (d, ctx) => slide('timeline', ctx, `${h('h2', d.title, ctx)}<div class="cols${d.steps.length > 3 ? ' four' : ''}" style="--n:${d.steps.length}">${d.steps.map((s, i) => `<div class="col step">
    <span class="tick d-${CYCLE[i % CYCLE.length]}" aria-hidden="true"></span><span class="label">${ctx.esc(s.when)}</span><h3 class="label">${ctx.esc(s.title)}</h3>${s.body ? `<p class="small">${ctx.esc(s.body)}</p>` : ''}</div>`).join('')}</div>`),

  quote: (d, ctx) => {
    const size = fit(d.text, { width: 1010, lines: 3, max: 90, min: 52 })
    return slide('quote', ctx, `<blockquote style="font-size:${size}px">“${ctx.esc(d.text)}”</blockquote><p class="by">— ${ctx.esc(d.name)}${d.role ? `, ${ctx.esc(d.role)}` : ''}</p>`)
  },

  table: (d, ctx) => slide('tbl', ctx, `${h('h2', d.title, ctx)}<table><thead><tr>${d.columns.map((c) => `<th>${ctx.esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${d.rows.map((r) => `<tr>${r.map((c) => `<td>${ctx.esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`),

  'big-number': (d, ctx) => slide('big', ctx, `<div class="wrap"><b>${ctx.esc(d.value)}</b><div class="what">${h('h2', d.label, ctx, 'label')}${d.body ? `<p class="copy">${ctx.esc(d.body)}</p>` : ''}</div></div>`),

  bullets: (d, ctx) => slide('bullets', ctx, `${h('h2', d.title, ctx)}<ul>${d.items.map((item) => `<li><span>•</span><span>${ctx.esc(item)}</span></li>`).join('')}</ul>`),

  team: (d, ctx) => slide('team', ctx, `${h('h2', d.title, ctx)}<div class="cols${d.people.length > 3 ? ' four' : ''}" style="--n:${d.people.length}">${d.people.map((p, i) => {
    const src = p.image && ctx.image(p.image)
    const face = src
      ? `<img class="face" src="${ctx.esc(src)}" alt="${ctx.esc(p.name)}">`
      : `<div class="face d-${CYCLE[i % CYCLE.length]}"><span>${ctx.esc(initials(p.name))}</span></div>`
    return `<div class="col">${face}${h('h3', p.name, ctx, 'label')}<p class="small">${ctx.esc(p.role)}</p></div>`
  }).join('')}</div>`),

  image: (d, ctx) => `<section class="slide image">${picture(d.image, ctx, 'media')}${d.caption ? `<p class="cap">${ctx.esc(d.caption)}</p>` : ''}${footer(ctx)}</section>`,

  /** The titled content slide that `chart` and `custom` slides are drawn in. */
  frame: ({ title, eyebrow }, ctx, body) => slide('framed', ctx, `${eyebrow ? h('p', eyebrow, ctx, 'eyebrow') : ''}${title ? h('h2', title, ctx) : ''}${body}`),

  closing: (d, ctx) => {
    const lines = [ctx.deck.presenter, d.contact].filter(Boolean)
    return slide('closing', ctx, `${h('h2', d.title, ctx)}<div class="contact">${d.subtitle ? `<span class="who">${ctx.esc(d.subtitle)}</span>` : ''}${lines.map((l) => `<span>•</span><span>${ctx.esc(l)}</span>`).join('')}</div>`)
  },
}
