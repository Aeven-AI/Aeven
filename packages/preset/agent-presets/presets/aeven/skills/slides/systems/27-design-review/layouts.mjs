/**
 * Design Review: flat black, white, sage and stone pages; light grotesque caps titles; hairline
 * rules carrying small caps meta rows (deck title left, date right); serif caps title bands over
 * structured grids; checkerboard image slots; orange, sage and stone goal cards.
 * Measured from the 16 frames of "Design Review" (Figma Community).
 */

/** Initials for a team placeholder's accessible label. */
const initials = (name) => name.split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 2)

/** A user picture, or the checkerboard placeholder when the slot has none. */
function picture(image, ctx, cls) {
  const src = ctx.image(image)
  return src
    ? `<img class="${cls}" src="${ctx.esc(src)}" alt="${ctx.esc(image?.alt ?? '')}">`
    : `<div class="${cls} checker" role="img" aria-label="${ctx.esc(image?.alt ?? '')}"></div>`
}

/** The top meta row: deck title left, date right, over a full-width hairline. */
const meta = (ctx) => `<header class="meta"><span>${ctx.esc(ctx.deck.title)}</span><span>${ctx.esc(ctx.deck.date ?? '')}</span></header>`

/** The serif caps title band under the meta row. */
const band = (title, ctx, eyebrow) => `<div class="band">${eyebrow ? `<span class="eyebrow">${ctx.esc(eyebrow)}</span>` : ''}<h2 class="serif-caps">${ctx.esc(title)}</h2></div>`

/** Light caps display size that keeps a title within the cover or section area. */
function displaySize(text, sizes) {
  const n = String(text).length
  return n <= 14 ? sizes[0] : n <= 30 ? sizes[1] : sizes[2]
}

const two = (n) => String(n).padStart(2, '0')

export function css(system) {
  const { surface, rule, geometry: g, type } = system
  return `
:root { --black: ${surface.black}; --white: ${surface.white}; --sage: ${surface.sage}; --stone: ${surface.stone}; --orange: ${surface.orange};
  --chk-a: ${surface.checker[0]}; --chk-b: ${surface.checker[1]}; --chk: ${g.checker}px;
  --rule-light: ${rule.onLight}; --rule-dark: ${rule.onDark};
  --m: ${g.margin}px; --meta: ${g.meta}px; --band: ${g.band}px; --serif: "Lora", Georgia, serif; }
.slide { display: flex; flex-direction: column; background: var(--bg); color: var(--fg); font-size: ${type.body}px; line-height: 1.32; font-weight: 400; }
.t-black { --bg: var(--black); --fg: #fff; --line: var(--rule-dark); --sub: rgba(255,255,255,.72); }
.t-white { --bg: var(--white); --fg: #000; --line: var(--rule-light); --sub: rgba(0,0,0,.66); }
.t-sage { --bg: var(--sage); --fg: #000; --line: var(--rule-light); --sub: rgba(0,0,0,.66); }
.t-stone { --bg: var(--stone); --fg: #000; --line: var(--rule-light); --sub: rgba(0,0,0,.66); }
.t-orange { --bg: var(--orange); --fg: #000; --line: rgba(0,0,0,.85); --sub: rgba(0,0,0,.72); }

.caps { text-transform: uppercase; }
.light-caps { font-family: var(--display-font); font-weight: 300; text-transform: uppercase; letter-spacing: -.005em; line-height: .96; }
.serif-caps { font-family: var(--serif); font-weight: 400; text-transform: uppercase; letter-spacing: .005em; line-height: 1.05; }
.small-caps { font-size: ${type.meta}px; text-transform: uppercase; letter-spacing: .02em; line-height: 1.2; }

.meta { flex: none; height: var(--meta); display: flex; justify-content: space-between; align-items: center; gap: 40px; padding: 2px var(--m) 0; border-bottom: 1px solid var(--line); font-size: ${type.meta}px; text-transform: uppercase; letter-spacing: .02em; white-space: nowrap; }
.meta span { overflow: hidden; text-overflow: ellipsis; }
.band { flex: none; height: var(--band); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; padding: 0 var(--m); border-bottom: 1px solid var(--line); text-align: center; }
.band h2 { font-size: ${type.band}px; }
.eyebrow { font-size: 13px; text-transform: uppercase; letter-spacing: .08em; color: var(--sub); }
.band:has(.eyebrow) h2 { font-size: 48px; }

.checker { background-color: var(--chk-a); background-image: conic-gradient(var(--chk-b) 25%, var(--chk-a) 0 50%, var(--chk-b) 0 75%, var(--chk-a) 0); background-size: calc(var(--chk) * 2) calc(var(--chk) * 2); background-position: center; }
.fill { width: 100%; height: 100%; object-fit: cover; }

/* Cover and closing: a full-width ruled stack */
.cover-top { flex: none; height: var(--meta); border-bottom: 1px solid var(--line); }
.cover-title { flex: 1 1 auto; min-height: 0; display: flex; align-items: flex-start; justify-content: center; padding: 72px var(--m) 0; text-align: center; }
.cover-row { flex: none; min-height: ${g.coverRow}px; display: flex; flex-wrap: wrap; justify-content: center; gap: 4px 130px; align-items: center; padding: 8px var(--m); border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); font-size: 25px; text-transform: uppercase; line-height: 1.1; text-align: center; }
.cover-row .plain { text-transform: none; }
.cover-block { flex: none; min-height: ${g.coverBlock}px; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 10px 140px; border-bottom: 1px solid var(--line); font-size: 25px; line-height: 1.24; text-transform: uppercase; text-align: center; text-wrap: balance; }
.cover-block p { text-wrap: balance; }
.cover-foot { flex: none; height: 34px; }

/* Section */
.center { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 26px; padding: 0 var(--m) var(--meta); text-align: center; }
.center .num { font-size: 25px; font-weight: 300; }
.center .sub { font-size: 25px; text-transform: uppercase; color: var(--sub); max-width: 900px; }

/* Statement and quote */
.say { font-family: var(--serif); font-size: ${type.quote}px; line-height: 1.04; max-width: 880px; text-wrap: balance; }
.by { font-size: 17px; color: var(--sub); }
.by.caps { font-size: ${type.meta}px; letter-spacing: .02em; }

/* Ruled rows (agenda) */
.rows { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; list-style: none; }
.rows li { flex: 1 1 0; display: grid; grid-template-columns: 300px 1fr; align-items: center; padding: 0 var(--m); border-top: 1px solid var(--line); }
.rows li:first-child { border-top: 0; }
.rows .k { font-size: 30px; font-weight: 300; }
.rows .v { font-size: 30px; text-transform: uppercase; font-weight: 300; }

/* Halves split by a hairline */
.halves { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: 1fr 1fr; }
.halves > * + * { border-left: 1px solid var(--line); }
.cell { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 20px; padding: 40px 56px; text-align: center; }
.cell h2 { font-size: 52px; }
.cell .lead { font-size: 26px; line-height: 1.36; text-align: left; max-width: 460px; }
.stack { display: flex; flex-direction: column; min-height: 0; }
.stack .cell:first-child { flex: 1.35 1 0; }
.stack .cell + .cell { flex: 1 1 0; border-top: 1px solid var(--line); align-items: flex-start; }
.stack .cell + .cell p { font-size: 22px; line-height: 1.4; text-align: left; }
.media-cell { padding: 40px 56px; min-height: 0; }

/* Centred columns (points, two-column, team) */
.cols { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: repeat(var(--n), 1fr); }
.cols.ruled > * + * { border-left: 1px solid var(--line); }
.col { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; padding: 24px 40px 56px; text-align: center; }
.col .no { font-size: 54px; font-weight: 300; line-height: 1; margin-bottom: 14px; }
.col h3 { font-family: var(--font); font-size: 26px; font-weight: 400; text-transform: uppercase; line-height: 1.15; }
.col p { font-size: 22px; line-height: 1.4; max-width: 330px; }
.cols.two .col p { max-width: 440px; }
.cols.two .col h3 { font-size: 30px; font-weight: 300; }
.avatar { --chk: 14px; width: 147px; height: 147px; border-radius: 50%; overflow: hidden; flex: none; margin-bottom: 18px; }
.team .col { gap: 12px; padding: 24px 24px 48px; }
.team .col p { font-size: 17px; color: var(--sub); }

/* Goal cards (metrics) */
.cards { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: repeat(var(--n), 1fr); gap: 35px; padding: 58px var(--m) 0; }
.card { display: flex; flex-direction: column; padding: 30px 28px 40px; color: #000; }
.card:nth-child(1) { background: var(--orange); } .card:nth-child(2) { background: var(--sage); }
.card:nth-child(3) { background: var(--stone); } .card:nth-child(4) { background: var(--black); color: #fff; }
.card b { font-family: var(--display-font); font-size: 72px; font-weight: 300; line-height: .96; letter-spacing: -.01em; font-variant-numeric: tabular-nums; }
.card span { margin: auto 0; font-size: 24px; line-height: 1.36; text-align: center; padding: 0 6px; }

/* Timeline grid */
.tl { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: repeat(var(--n), 1fr); grid-template-rows: 1fr auto 1.25fr; }
.tl .when, .tl .what { padding: 0 32px; }
.tl .when { grid-row: 1; display: flex; align-items: flex-end; padding-bottom: 26px; font-size: 54px; font-weight: 300; line-height: 1; text-transform: uppercase; }
.tl .line { grid-row: 2; border-top: 1px solid var(--line); }
.tl .what { grid-row: 3; padding-top: 26px; display: flex; flex-direction: column; gap: 10px; }
.tl .what h3 { font-family: var(--font); font-size: 24px; font-weight: 400; text-transform: uppercase; line-height: 1.15; }
.tl .what p { font-size: 19px; line-height: 1.4; color: var(--sub); }
.tl .rule-v { border-left: 1px solid var(--line); }

/* Table */
.table-wrap { flex: 1 1 auto; min-height: 0; display: flex; padding: 0 var(--m) 28px; }
table { width: 100%; height: 100%; border-collapse: collapse; table-layout: fixed; }
th { height: 64px; text-align: left; vertical-align: middle; font-size: ${type.meta}px; font-weight: 400; text-transform: uppercase; letter-spacing: .02em; color: var(--sub); padding-right: 20px; }
td { border-top: 1px solid var(--line); padding-right: 20px; font-size: 24px; vertical-align: middle; font-variant-numeric: tabular-nums; }
td:first-child { font-size: 30px; font-weight: 300; text-transform: uppercase; }

/* Big number */
.big .value { font-family: var(--display-font); font-size: 280px; font-weight: 300; line-height: .82; letter-spacing: -.02em; }
.big .label { font-size: 30px; text-transform: uppercase; }
.big .center { gap: 22px; }
.big .center p { font-size: 22px; max-width: 620px; line-height: 1.4; }

/* Bullets grid */
.grid { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: 1fr 1fr; grid-auto-rows: 1fr; }
.grid .g { display: flex; flex-direction: column; justify-content: center; gap: 12px; padding: 24px 56px; border-top: 1px solid var(--line); }
.grid .g:nth-child(-n+2) { border-top: 0; }
.grid .g:nth-child(even) { border-left: 1px solid var(--line); }
.grid .g span { font-size: ${type.meta}px; letter-spacing: .02em; color: var(--sub); }
.grid .g p { font-size: 28px; line-height: 1.3; }

/* Full image */
.shot { flex: 1 1 auto; min-height: 0; padding: 30px var(--m); }
.cap-row { flex: none; height: 64px; display: flex; align-items: center; justify-content: center; padding: 0 var(--m); border-top: 1px solid var(--line); font-size: 22px; text-transform: uppercase; text-align: center; }

/* Frame (chart, custom) */
.frame-body { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; padding: 32px var(--m) 34px; }
.avn-chart rect { rx: 0; ry: 0; }
`
}

/** Cover and closing share the ruled stack: top rule, title, two-cell row, centred block. */
function ruledStack(cls, title, rowCells, blockLines, ctx) {
  const size = displaySize(title, [124, 100, 76])
  const cells = rowCells.filter(Boolean).map((c) => ({ text: c, plain: /@|\w\.\w{2,}$/.test(c) && !/\s/.test(c) }))
  return `<section class="slide t-black ${cls}"><div class="cover-top"></div>
    <div class="cover-title"><h1 class="light-caps" style="font-size:${size}px">${ctx.esc(title)}</h1></div>
    <div class="cover-row">${cells.map((c) => `<span${c.plain ? ' class="plain"' : ''}>${ctx.esc(c.text)}</span>`).join('')}</div>
    <div class="cover-block">${blockLines.filter(Boolean).map((l) => `<p>${ctx.esc(l)}</p>`).join('')}</div>
    <div class="cover-foot"></div></section>`
}

export const slides = {
  cover: (d, ctx) => ruledStack('cover', d.title, [d.eyebrow, ctx.deck.date], [d.subtitle, ctx.deck.presenter], ctx),

  agenda: (d, ctx) => `<section class="slide t-white">${meta(ctx)}${band(d.title, ctx)}
    <ol class="rows">${d.items.map((item, i) => `<li><span class="k">${two(i + 1)}</span><span class="v">${ctx.esc(item)}</span></li>`).join('')}</ol></section>`,

  section: (d, ctx) => `<section class="slide t-sage">${meta(ctx)}<div class="center">
    <span class="num">${ctx.esc(d.number)}</span>
    <h2 class="light-caps" style="font-size:${displaySize(d.title, [124, 96, 72])}px">${ctx.esc(d.title)}</h2>
    ${d.subtitle ? `<p class="sub">${ctx.esc(d.subtitle)}</p>` : ''}</div></section>`,

  statement: (d, ctx) => `<section class="slide t-orange">${meta(ctx)}<div class="center">
    <p class="say">${ctx.esc(d.text)}</p>${d.attribution ? `<span class="by caps">${ctx.esc(d.attribution)}</span>` : ''}</div></section>`,

  text: (d, ctx) => `<section class="slide t-white">${meta(ctx)}<div class="halves">
    <div class="cell">${d.eyebrow ? `<span class="small-caps">${ctx.esc(d.eyebrow)}</span>` : ''}<h2 class="light-caps">${ctx.esc(d.title)}</h2></div>
    <div class="cell"><p class="lead">${ctx.esc(d.body)}</p></div></div></section>`,

  points: (d, ctx) => `<section class="slide t-black">${meta(ctx)}${band(d.title, ctx)}
    <div class="cols" style="--n:${d.items.length}">${d.items.map((item, i) => `<div class="col"><span class="no">${two(i + 1)}</span><h3>${ctx.esc(item.title)}</h3><p>${ctx.esc(item.body)}</p></div>`).join('')}</div></section>`,

  'image-text': (d, ctx) => `<section class="slide t-white">${meta(ctx)}<div class="halves">
    <div class="media-cell">${picture(d.image, ctx, 'fill')}</div>
    <div class="stack"><div class="cell"><h2 class="light-caps">${ctx.esc(d.title)}</h2></div><div class="cell"><p>${ctx.esc(d.body)}</p></div></div></div></section>`,

  metrics: (d, ctx) => `<section class="slide t-white">${meta(ctx)}${band(d.title, ctx)}
    <div class="cards" style="--n:${d.items.length}">${d.items.map((m) => `<div class="card"><b>${ctx.esc(m.value)}</b><span>${ctx.esc(m.label)}</span></div>`).join('')}</div></section>`,

  'two-column': (d, ctx) => `<section class="slide t-black">${meta(ctx)}${band(d.title, ctx)}
    <div class="cols ruled two" style="--n:${d.columns.length}">${d.columns.map((c) => `<div class="col"><h3>${ctx.esc(c.title)}</h3><p>${ctx.esc(c.body)}</p></div>`).join('')}</div></section>`,

  timeline: (d, ctx) => `<section class="slide t-sage">${meta(ctx)}${band(d.title, ctx)}
    <div class="tl" style="--n:${d.steps.length}">${d.steps.map((s, i) => {
      const col = `grid-column:${i + 1}`
      const v = i ? ' rule-v' : ''
      return `<span class="when${v}" style="${col}">${ctx.esc(s.when)}</span><i class="line${v}" style="${col}"></i>`
        + `<div class="what${v}" style="${col}"><h3>${ctx.esc(s.title)}</h3>${s.body ? `<p>${ctx.esc(s.body)}</p>` : ''}</div>`
    }).join('')}</div></section>`,

  quote: (d, ctx) => `<section class="slide t-stone">${meta(ctx)}<div class="center">
    <p class="say">“${ctx.esc(d.text)}”</p><span class="by">${ctx.esc(d.name)}${d.role ? ` · ${ctx.esc(d.role)}` : ''}</span></div></section>`,

  table: (d, ctx) => `<section class="slide t-stone">${meta(ctx)}${band(d.title, ctx)}<div class="table-wrap">
    <table><thead><tr>${d.columns.map((c) => `<th>${ctx.esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${d.rows.map((r) => `<tr>${r.map((c) => `<td>${ctx.esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`,

  'big-number': (d, ctx) => `<section class="slide t-orange big">${meta(ctx)}<div class="center">
    <b class="value">${ctx.esc(d.value)}</b><span class="label">${ctx.esc(d.label)}</span>${d.body ? `<p>${ctx.esc(d.body)}</p>` : ''}</div></section>`,

  bullets: (d, ctx) => `<section class="slide t-sage">${meta(ctx)}${band(d.title, ctx)}
    <div class="grid">${d.items.map((item, i) => `<div class="g"><span>${two(i + 1)}</span><p>${ctx.esc(item)}</p></div>`).join('')}</div></section>`,

  team: (d, ctx) => `<section class="slide t-black team">${meta(ctx)}${band(d.title, ctx)}
    <div class="cols ruled" style="--n:${d.people.length}">${d.people.map((p) => {
      const src = p.image && ctx.image(p.image)
      const face = src
        ? `<img class="avatar fill" src="${ctx.esc(src)}" alt="${ctx.esc(p.name)}">`
        : `<div class="avatar checker" role="img" aria-label="${ctx.esc(initials(p.name))}"></div>`
      return `<div class="col">${face}<h3>${ctx.esc(p.name)}</h3><p>${ctx.esc(p.role)}</p></div>`
    }).join('')}</div></section>`,

  image: (d, ctx) => `<section class="slide t-stone">${meta(ctx)}<div class="shot">${picture(d.image, ctx, 'fill')}</div>
    ${d.caption ? `<div class="cap-row"><span>${ctx.esc(d.caption)}</span></div>` : ''}</section>`,

  /** The titled content slide that `chart` and `custom` slides are drawn in. */
  frame: ({ title, eyebrow }, ctx, body) => `<section class="slide t-white">${meta(ctx)}${title ? band(title, ctx, eyebrow) : ''}
    <div class="frame-body">${body}</div></section>`,

  closing: (d, ctx) => ruledStack('closing', d.title, [d.subtitle, d.contact], [ctx.deck.title, ctx.deck.presenter, ctx.deck.date], ctx),
}
