/**
 * Marketing Strategy: sage and pale-green pages; a light condensed serif in caps for cover and
 * section titles, with a bracketed light-italic grotesque number ("[1]"); underlined condensed
 * sans caps labels top left and a footer pair (deck title, company); content set in columns
 * split by hairline rules, with big light-italic "XX%" figures bottom right of each column.
 * Measured from the 15 frames of Figma's "Marketing Strategy" community template.
 */

/** The ▸ marker the source sets before the cover meta and intro paragraph. */
const tri = '<span class="tri" aria-hidden="true"></span>'

/** The longest line a greedy word wrap gives `text` at `chars` characters per line, in lines. */
function wrapLines(text, chars) {
  let lines = 1
  let used = 0
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    if (used && used + 1 + word.length > chars) { lines += 1; used = word.length } else used += (used ? 1 : 0) + word.length
    if (word.length > chars) return Infinity
  }
  return lines
}

/**
 * The largest size, at or under `max`, at which `text` wraps into `lines` lines of `width` px,
 * given the face's average advance per character in em.
 */
function fit(text, { max, min, width, lines, advance }) {
  for (let size = max; size > min; size -= 2) {
    if (wrapLines(text, Math.floor(width / (size * advance))) <= lines) return size
  }
  return min
}

/** Initials for a person's placeholder box. */
const initials = (name) => String(name).split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2)

/** A user picture, or the source's transparent-checker placeholder when the slot has none. */
function picture(image, ctx, cls) {
  const src = ctx.image(image)
  return src
    ? `<img class="${cls}" src="${ctx.esc(src)}" alt="${ctx.esc(image?.alt ?? '')}">`
    : `<div class="${cls} checker" role="img" aria-label="${ctx.esc(image?.alt ?? '')}"></div>`
}

/** The underlined caps label top left. */
const label = (text, ctx) => (text ? `<p class="lbl">${ctx.esc(text)}</p>` : '')

/** The footer pair: deck title left, presenter (the source's company name) right. */
const foot = (ctx) => `<footer class="foot"><span>${ctx.esc(ctx.deck.title ?? '')}</span><span>${ctx.esc(ctx.deck.presenter ?? '')}</span></footer>`

/** A content page: pale field, label, body, footer. */
const page = (cls, labelText, ctx, body) => `<section class="slide ms ${cls}">${label(labelText, ctx)}${body}${foot(ctx)}</section>`

/** "01" → "1": the source brackets bare numerals. */
const numeral = (n) => String(n).replace(/^0+(?=\d)/, '')

export function css(system) {
  const { field, ink, rule, arrow, checker, geometry: g } = system
  return `
:root { --sage: ${field.sage}; --mint: ${field.mint}; --pale: ${field.pale}; --soft: ${field.soft}; --stone: ${field.stone};
  --ink: ${ink.primary}; --figure: ${ink.figure}; --ph: ${ink.placeholder}; --on-sage: ${ink.onSage}; --lbl-sage: ${ink.labelOnSage};
  --rule: ${rule}; --arrow: ${arrow}; --ck-a: ${checker[0]}; --ck-b: ${checker[1]};
  --m: ${g.margin}px; --gut: ${g.columnGutter}px; --ctop: ${g.columnTop}px; --cbot: ${g.columnBottom}px;
  --serif: var(--display-font); --sans: var(--font); --fig: "Roboto", Arial, sans-serif; }
.ms { background: var(--pale); color: var(--ink); font-family: var(--sans); }
.ms.mint { background: var(--mint); }
.ms.sage { background: var(--sage); color: var(--on-sage); }
.serif { font-family: var(--serif); font-weight: 450; }
.fig { font-family: var(--fig); font-style: italic; font-weight: 400; letter-spacing: -.01em; }
.caps { font-family: var(--serif); font-weight: 400; text-transform: uppercase; line-height: .874; letter-spacing: .05em; }

.lbl { position: absolute; left: var(--m); top: ${g.labelTop}px; max-width: calc(1280px - 2 * var(--m)); font-size: 24px; line-height: 24px; text-transform: uppercase; text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 3px; white-space: nowrap; }
.sage .lbl { color: var(--lbl-sage); }
.foot { position: absolute; left: var(--m); right: var(--m); top: ${g.footerTop}px; display: flex; justify-content: space-between; gap: 40px; font-size: 24px; line-height: 24px; text-transform: uppercase; white-space: nowrap; }
.sage .foot { color: var(--on-sage); }
.tri { flex: none; width: 0; height: 0; border-top: 8px solid transparent; border-bottom: 8px solid transparent; border-left: 12px solid currentColor; }

/* Cover and closing: sage, serif caps top left, ▸ meta bottom left, italic period bottom right. */
.cover h1, .closing h2 { position: absolute; left: 56px; top: 44px; width: 1170px; color: var(--mint); }
.cover .sub, .closing .sub { position: absolute; left: 62px; width: 620px; font-size: 34px; line-height: 38px; color: var(--mint); }
.meta { position: absolute; left: 60px; bottom: 50px; display: flex; gap: 12px; align-items: flex-start; font-size: 33px; line-height: 40px; text-transform: uppercase; max-width: 560px; }
.meta .tri { margin-top: 12px; border-top-width: 9px; border-bottom-width: 9px; border-left-width: 13px; }
.meta div { display: flex; flex-direction: column; }
.period { position: absolute; right: 50px; bottom: 44px; line-height: .78; white-space: nowrap; color: var(--mint); }

/* Section: bracketed italic numeral hanging left of the serif caps title. */
.section .num { position: absolute; left: 50px; top: 53px; font-size: 169px; line-height: .86; font-weight: 300; color: var(--mint); white-space: nowrap; }
.section .title { position: absolute; left: 248px; top: 44px; width: 975px; display: flex; flex-direction: column; gap: 40px; }
.section h2 { color: var(--mint); }
.section .sub { font-size: 34px; line-height: 38px; max-width: 760px; }

/* Intro paragraph (mint), headline + body. */
.lead { position: absolute; left: var(--m); top: 156px; width: 780px; display: flex; gap: 14px; }
.lead .tri { margin-top: 12px; color: var(--ink); }
.lead .copy { display: flex; flex-direction: column; gap: 22px; }
.lead h2 { font-size: 48px; line-height: 50px; }
.lead p { font-size: 26px; line-height: 32px; max-width: 700px; }
.no-label .lead { top: 52px; }

/* Columns split by hairline rules, the source's grid for numbers, objectives and competitors. */
.cols { position: absolute; left: var(--m); right: var(--m); top: var(--ctop); height: calc(var(--cbot) - var(--ctop)); display: grid; grid-template-columns: repeat(var(--n), 1fr); }
.col { position: relative; min-width: 0; display: flex; flex-direction: column; justify-content: space-between; padding-right: var(--gut); }
.col + .col { border-left: 2px solid var(--rule); padding-left: var(--gut); }
.col .desc { font-family: var(--serif); font-weight: 450; font-size: var(--ds, 37px); line-height: 1.08; }
.col .big { align-self: flex-end; font-size: var(--fs, 122px); line-height: .75; color: var(--figure); white-space: nowrap; margin-right: 6px; }
.col .n { font-size: 118px; line-height: .75; color: var(--ink); white-space: nowrap; margin-top: -1px; }
.col .foot-copy { display: flex; flex-direction: column; gap: 12px; }
.col .foot-copy b { font-family: var(--serif); font-weight: 450; font-size: 37px; line-height: 40px; }
.col .foot-copy span { font-size: 22px; line-height: 27px; }
.box { flex: none; width: 160px; height: 110px; border-radius: 6px; background: var(--soft); color: var(--ph); display: grid; place-items: center; font-size: 24px; text-transform: uppercase; overflow: hidden; }
.box.face { width: 160px; height: 160px; object-fit: cover; }

/* Statement: centred serif. */
.statement .say { position: absolute; left: 120px; right: 120px; top: 100px; bottom: 100px; display: flex; align-items: center; justify-content: center; text-align: center; }
.statement .say p { font-family: var(--serif); font-weight: 450; font-size: var(--ss, 64px); line-height: 1.12; text-wrap: balance; }

/* Agenda and bullets: serif lines with italic bracketed numbers or ▸ markers. */
.list { position: absolute; left: var(--m); top: 150px; width: 1000px; list-style: none; display: flex; flex-direction: column; gap: var(--lg, 22px); }
.list li { display: flex; align-items: baseline; gap: 22px; font-family: var(--serif); font-weight: 450; font-size: var(--ls, 44px); line-height: 1.1; }
.list .k { flex: none; width: 92px; font-family: var(--fig); font-style: italic; font-weight: 400; font-size: .9em; color: var(--figure); }
.list .tri { align-self: center; color: var(--ink); }

/* Image and text, image, checker placeholder. */
.checker { background-color: var(--ck-a); background-image: linear-gradient(45deg, var(--ck-b) 25%, transparent 25%, transparent 75%, var(--ck-b) 75%), linear-gradient(45deg, var(--ck-b) 25%, transparent 25%, transparent 75%, var(--ck-b) 75%); background-size: 46px 46px; background-position: 0 0, 23px 23px; }
.pic { display: block; border-radius: 8px; object-fit: cover; overflow: hidden; }
.it .copy { position: absolute; left: var(--m); top: 120px; width: 360px; font-family: var(--serif); font-weight: 450; font-size: 32px; line-height: 1.1; }
.it .pic { position: absolute; left: 463px; top: 52px; width: calc(1280px - 463px - var(--m)); height: 575px; }
.full .pic { position: absolute; left: var(--m); top: 100px; width: calc(1280px - 2 * var(--m)); height: 498px; }
.full .note { position: absolute; left: var(--m); top: 610px; font-size: 18px; line-height: 22px; text-transform: uppercase; max-width: 1172px; }
.full.no-label .pic { top: 52px; height: 546px; }

/* Two columns: underlined headers, centred serif, a long arrow from one side to the other. */
.pair { position: absolute; left: var(--m); right: var(--m); top: 200px; display: grid; grid-template-columns: 1fr 300px 1fr; align-items: start; }
.pair .side { display: flex; flex-direction: column; align-items: center; gap: 26px; text-align: center; }
.pair .side h3 { font-family: var(--sans); font-size: 24px; line-height: 24px; text-transform: uppercase; text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 3px; text-wrap: nowrap; }
.pair .side p { font-family: var(--serif); font-weight: 450; font-size: 37px; line-height: 1.12; max-width: 400px; }
.arrow { position: relative; height: 2px; background: var(--arrow); margin: 0 6px; }
.pair .arrow { margin-top: 74px; }
.arrow::after { content: ""; position: absolute; right: -2px; top: -4px; border-top: 5px solid transparent; border-bottom: 5px solid transparent; border-left: 9px solid var(--arrow); }

/* Timeline: one long arrow, italic periods above, serif steps below. */
.line { position: absolute; left: var(--m); right: var(--m); top: 300px; }
.line .arrow { margin: 0; }
.steps { position: absolute; left: var(--m); right: var(--m); top: 196px; display: grid; grid-template-columns: repeat(var(--n), 1fr); gap: 0; }
.steps .s { display: flex; flex-direction: column; padding-right: var(--gut); min-width: 0; }
.steps .when { height: 104px; font-size: var(--ws, 64px); line-height: .78; color: var(--figure); white-space: nowrap; }
.steps b { margin-top: 32px; font-family: var(--serif); font-weight: 450; font-size: 37px; line-height: 40px; }
.steps span { margin-top: 10px; font-size: 22px; line-height: 27px; }

/* Quote: big serif with hanging open quote, dash and caps name. */
.quote .q { position: absolute; left: 77px; top: 130px; width: 1000px; display: flex; flex-direction: column; gap: 40px; }
.quote blockquote { font-family: var(--serif); font-weight: 450; font-size: var(--qs, 66px); line-height: 1.08; text-indent: -.36em; }
.quote cite { font-style: normal; font-size: 24px; line-height: 24px; text-transform: uppercase; }

/* Table: serif cells in columns split by hairline rules. */
.grid { position: absolute; left: var(--m); width: calc(1280px - 2 * var(--m)); top: var(--ctop); border-collapse: collapse; table-layout: fixed; }
.grid th { text-align: left; font-weight: 400; font-size: 24px; line-height: 24px; text-transform: uppercase; padding: 0 var(--gut) 26px; }
.grid td { font-family: var(--serif); font-weight: 450; font-size: 34px; line-height: 1.1; padding: 0 var(--gut) 30px; vertical-align: top; }
.grid th + th, .grid td + td { border-left: 2px solid var(--rule); }
.grid th:first-child, .grid td:first-child { padding-left: 0; }
.grid td:first-child { font-family: var(--sans); font-size: 24px; line-height: 36px; text-transform: uppercase; }
.grid tr:last-child td { padding-bottom: 0; }

/* Big number: one column of the figures slide, at full width. */
.bignum .desc { position: absolute; left: var(--m); top: var(--ctop); width: 560px; font-family: var(--serif); font-weight: 450; font-size: 44px; line-height: 1.08; }
.bignum .big { position: absolute; right: 66px; bottom: 147px; font-size: var(--fs, 380px); line-height: .75; color: var(--figure); white-space: nowrap; }

/* Framed slide: label, optional serif headline, body. */
.framed .inner { position: absolute; left: var(--m); right: var(--m); top: 110px; bottom: 82px; display: flex; flex-direction: column; gap: 22px; }
.framed.no-label .inner { top: 52px; }
.framed .inner h2 { flex: none; font-size: 44px; line-height: 1.05; }
.framed .avn-body { color: var(--ink); }
.framed .avn-caption { font-size: 18px; text-transform: uppercase; color: var(--ink); }
`
}

/**
 * Cover and closing title size: the largest caps size at which the title (up to three lines) and
 * the serif subtitle under it end above the ▸ meta at the bottom left; returns the subtitle top.
 */
function titleBlock(title, subtitle) {
  const subLines = subtitle ? wrapLines(subtitle, Math.floor(620 / (34 * 0.42))) : 0
  for (let size = 167; size > 64; size -= 2) {
    const lines = wrapLines(title, Math.floor(1170 / (size * 0.66)))
    const bottom = 44 + lines * size * 0.874
    if (lines <= 3 && bottom + (subtitle ? 40 + subLines * 38 : 0) <= 575) return { size, subTop: Math.round(bottom + 40) }
  }
  return { size: 64, subTop: Math.round(44 + 3 * 64 * 0.874 + 40) }
}

/** Cover-scale serif caps sized so the title fits its block. */
const capsSize = (text, { max, width, lines }) => fit(text, { max, min: 64, width, lines, advance: 0.66 })

export const slides = {
  cover: (d, ctx) => {
    const { size, subTop } = titleBlock(d.title, d.subtitle)
    const period = ctx.deck.date ?? ''
    const periodSize = Math.min(160, Math.floor(600 / Math.max(1, period.length * 0.5)))
    const meta = [d.eyebrow, ctx.deck.presenter].filter(Boolean)
    return `<section class="slide ms sage cover"><h1 class="caps" style="font-size:${size}px">${ctx.esc(d.title)}</h1>
    ${d.subtitle ? `<p class="sub serif" style="top:${subTop}px">${ctx.esc(d.subtitle)}</p>` : ''}
    ${meta.length ? `<div class="meta">${tri}<div>${meta.map((m) => `<span>${ctx.esc(m)}</span>`).join('')}</div></div>` : ''}
    ${period ? `<p class="period fig" style="font-size:${periodSize}px">${ctx.esc(period)}</p>` : ''}</section>`
  },

  agenda: (d, ctx) => {
    const n = d.items.length
    const size = n > 5 ? 38 : 44
    return page('agenda', d.title, ctx, `<ol class="list" style="--ls:${size}px;--lg:${n > 5 ? 16 : 22}px">${d.items.map((item, i) => `<li><span class="k">[${i + 1}]</span><span>${ctx.esc(item)}</span></li>`).join('')}</ol>`)
  },

  section: (d, ctx) => {
    const size = capsSize(d.title, { max: 167, width: 975, lines: 3 })
    return `<section class="slide ms sage section"><span class="num fig">[${ctx.esc(numeral(d.number))}]</span>
    <div class="title"><h2 class="caps" style="font-size:${size}px">${ctx.esc(d.title)}</h2>${d.subtitle ? `<p class="sub serif">${ctx.esc(d.subtitle)}</p>` : ''}</div>${foot(ctx)}</section>`
  },

  statement: (d, ctx) => {
    const size = fit(d.text, { max: 64, min: 40, width: 1040, lines: 3, advance: 0.42 })
    return page('statement', d.attribution, ctx, `<div class="say"><p style="--ss:${size}px">${ctx.esc(d.text)}</p></div>`)
  },

  text: (d, ctx) => `<section class="slide ms mint ${d.eyebrow ? '' : 'no-label'}">${label(d.eyebrow, ctx)}
    <div class="lead">${tri}<div class="copy"><h2 class="serif">${ctx.esc(d.title)}</h2><p>${ctx.esc(d.body)}</p></div></div>${foot(ctx)}</section>`,

  points: (d, ctx) => page('points', d.title, ctx, `<div class="cols" style="--n:${d.items.length}">${d.items.map((item, i) => `<div class="col">
    <span class="n fig">${i + 1}</span><div class="foot-copy"><b>${ctx.esc(item.title)}</b><span>${ctx.esc(item.body)}</span></div></div>`).join('')}</div>`),

  'image-text': (d, ctx) => page('it', d.title, ctx, `<p class="copy">${ctx.esc(d.body)}</p>${picture(d.image, ctx, 'pic')}`),

  metrics: (d, ctx) => {
    const n = d.items.length
    const longest = Math.max(...d.items.map((m) => String(m.value).length))
    const colInner = 1172 / n - 2 * 27 - 8
    const fs = Math.min(122, Math.floor(colInner / (longest * 0.62)))
    return page('metrics', d.title, ctx, `<div class="cols" style="--n:${n};--fs:${fs}px;--ds:${n > 3 ? 32 : 37}px">${d.items.map((m) => `<div class="col">
    <p class="desc">${ctx.esc(m.label)}</p><span class="big fig">${ctx.esc(m.value)}</span></div>`).join('')}</div>`)
  },

  'two-column': (d, ctx) => page('two', d.title, ctx, `<div class="pair">${d.columns.map((c, i) => `${i ? '<span class="arrow" aria-hidden="true"></span>' : ''}<div class="side"><h3>${ctx.esc(c.title)}</h3><p>${ctx.esc(c.body)}</p></div>`).join('')}</div>`),

  timeline: (d, ctx) => {
    const longest = Math.max(...d.steps.map((s) => String(s.when).length))
    const ws = Math.min(64, Math.floor((1172 / d.steps.length - 27) / (longest * 0.56)))
    return page('timeline', d.title, ctx, `<div class="line"><div class="arrow" aria-hidden="true"></div></div>
    <div class="steps" style="--n:${d.steps.length};--ws:${ws}px">${d.steps.map((s) => `<div class="s"><span class="when fig">${ctx.esc(s.when)}</span><b>${ctx.esc(s.title)}</b>${s.body ? `<span>${ctx.esc(s.body)}</span>` : ''}</div>`).join('')}</div>`)
  },

  quote: (d, ctx) => {
    const size = fit(d.text, { max: 66, min: 40, width: 1000, lines: 4, advance: 0.42 })
    return page('quote', '', ctx, `<div class="q"><blockquote style="--qs:${size}px">“${ctx.esc(d.text)}”</blockquote>
    <cite>— ${ctx.esc(d.name)}${d.role ? `, ${ctx.esc(d.role)}` : ''}</cite></div>`)
  },

  table: (d, ctx) => page('table', d.title, ctx, `<table class="grid"><thead><tr>${d.columns.map((c) => `<th>${ctx.esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${d.rows.map((r) => `<tr>${r.map((c) => `<td>${ctx.esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`),

  'big-number': (d, ctx) => {
    const fs = Math.min(320, Math.floor(640 / (String(d.value).length * 0.62)))
    return page('bignum', d.label, ctx, `${d.body ? `<p class="desc">${ctx.esc(d.body)}</p>` : ''}<span class="big fig" style="--fs:${fs}px">${ctx.esc(d.value)}</span>`)
  },

  bullets: (d, ctx) => {
    const n = d.items.length
    return page('bullets', d.title, ctx, `<ul class="list" style="--ls:${n > 4 ? 38 : 44}px;--lg:${n > 4 ? 16 : 24}px">${d.items.map((item) => `<li>${tri}<span>${ctx.esc(item)}</span></li>`).join('')}</ul>`)
  },

  team: (d, ctx) => page('team', d.title, ctx, `<div class="cols" style="--n:${d.people.length}">${d.people.map((p) => {
    const src = p.image && ctx.image(p.image)
    const face = src
      ? `<img class="box face" src="${ctx.esc(src)}" alt="${ctx.esc(p.name)}">`
      : `<div class="box face" role="img" aria-label="${ctx.esc(p.name)}"><span>${ctx.esc(initials(p.name))}</span></div>`
    return `<div class="col">${face}<div class="foot-copy"><b>${ctx.esc(p.name)}</b><span>${ctx.esc(p.role)}</span></div></div>`
  }).join('')}</div>`),

  image: (d, ctx) => `<section class="slide ms full no-label">${picture(d.image, ctx, 'pic')}${d.caption ? `<p class="note">${ctx.esc(d.caption)}</p>` : ''}${foot(ctx)}</section>`,

  /** The titled content slide that `chart` and `custom` slides are drawn in. */
  frame: ({ title, eyebrow }, ctx, body) => {
    const lbl = eyebrow ?? title
    const head = eyebrow && title ? `<h2 class="serif">${ctx.esc(title)}</h2>` : ''
    return `<section class="slide ms framed ${lbl ? '' : 'no-label'}">${label(lbl, ctx)}<div class="inner">${head}${body}</div>${foot(ctx)}</section>`
  },

  closing: (d, ctx) => {
    const { size, subTop } = titleBlock(d.title, d.subtitle)
    return `<section class="slide ms sage closing"><h2 class="caps" style="font-size:${size}px">${ctx.esc(d.title)}</h2>
    ${d.subtitle ? `<p class="sub serif" style="top:${subTop}px">${ctx.esc(d.subtitle)}</p>` : ''}
    ${d.contact ? `<div class="meta">${tri}<div><span>${ctx.esc(d.contact)}</span></div></div>` : ''}</section>`
  },
}
