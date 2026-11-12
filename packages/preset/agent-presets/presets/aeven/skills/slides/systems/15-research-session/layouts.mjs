/**
 * Research Session: stark black, sage off-white and white slides; medium Work Sans caps titles
 * set bottom-left on covers and top-left on content slides; thin hand-drawn line art (an
 * eight-ray star, radial sunbursts, a black disc of white rays on a fine checker); typewriter
 * corner meta (deck title top-left, presenter bottom-left, date bottom-right); full-bleed grey
 * hairline rows; black stages that hold pictures; a grey checkerboard as the empty image slot.
 * Measured from the 16 frames of Figma's "User Research Session" template (Figma Community).
 */

const S = 2.5

/** A point on a circle, rounded for compact SVG. */
const at = (cx, cy, r, a) => [+(cx + r * Math.cos(a)).toFixed(1), +(cy + r * Math.sin(a)).toFixed(1)]

/** The eight-ray line star of the cover and section slides (four strokes through the centre). */
function star(cls, size) {
  const c = size / 2
  const r = c - S
  const lines = [0, 1, 2, 3].map((i) => {
    const a = (i * Math.PI) / 4
    const [x1, y1] = at(c, c, r, a)
    const [x2, y2] = at(c, c, r, a + Math.PI)
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`
  }).join('')
  return `<svg class="${cls}" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true"><g stroke="currentColor" stroke-width="${S}">${lines}</g></svg>`
}

/** A radial sunburst of `n` short rays between two radii (the agenda and question slides). */
function burst(cls, size, n, inner, width = S) {
  const c = size / 2
  const outer = c - width
  const rays = Array.from({ length: n }, (_, i) => {
    const a = (i * 2 * Math.PI) / n - Math.PI / 2
    const [x1, y1] = at(c, c, inner, a)
    const [x2, y2] = at(c, c, outer, a)
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`
  }).join('')
  return `<svg class="${cls}" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true"><g stroke="currentColor" stroke-width="${width}" stroke-linecap="butt">${rays}</g></svg>`
}

/** The black disc with 36 white rays that sits on the fine checker (the project slide). */
function disc(size) {
  const c = size / 2
  const rays = Array.from({ length: 36 }, (_, i) => {
    const a = (i * 2 * Math.PI) / 36 - Math.PI / 2
    const [x1, y1] = at(c, c, c * 0.39, a)
    const [x2, y2] = at(c, c, c * 0.93, a)
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`
  }).join('')
  return `<svg class="disc" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true"><circle cx="${c}" cy="${c}" r="${c}" fill="#000"/><g stroke="#fff" stroke-width="3">${rays}</g></svg>`
}

/** The typewriter corner meta: deck title top-left, presenter bottom-left, date bottom-right. */
function meta(ctx, { tl = ctx.deck.title, bl = ctx.deck.presenter, br = ctx.deck.date } = {}) {
  return [['tl', tl], ['bl', bl], ['br', br]]
    .filter(([, text]) => text)
    .map(([pos, text]) => `<span class="meta ${pos}">${ctx.esc(text)}</span>`).join('')
}

/** A user picture, or the grey checkerboard the source uses for an empty image slot. */
function picture(image, ctx, cls) {
  const src = image && ctx.image(image)
  return src
    ? `<img class="${cls}" src="${ctx.esc(src)}" alt="${ctx.esc(image.alt ?? '')}">`
    : `<div class="${cls} checker" role="img" aria-label="${ctx.esc(image?.alt ?? '')}"></div>`
}

const title = (text, ctx) => `<h2 class="t">${ctx.esc(text)}</h2>`

export function css(system) {
  const { surface, ink, geometry: g } = system
  return `
:root { --black: ${surface.black}; --sage: ${surface.sage}; --white: ${surface.white}; --ck-a: ${surface.checkerLight}; --ck-b: ${surface.checkerDark};
  --ink: ${ink.primary}; --on-black: ${ink.onBlack}; --hair: ${ink.rule}; --m: ${g.margin}px; --mi: ${g.metaInset}px; --indent: ${g.listIndent}px; }
.slide { background: var(--white); color: var(--ink); font-size: 17px; line-height: 1.32; padding: ${g.titleTop}px var(--m) 70px; display: flex; flex-direction: column; }
.slide.sage { background: var(--sage); }
.slide.dark { background: var(--black); color: var(--on-black); }
.meta { position: absolute; font-family: "Cutive Mono", "Courier New", monospace; font-size: 14px; line-height: 1; letter-spacing: .14em; text-transform: uppercase; white-space: nowrap; max-width: 560px; overflow: hidden; text-overflow: ellipsis; }
.meta.tl { left: var(--m); top: var(--mi); } .meta.bl { left: var(--m); bottom: var(--mi); } .meta.br { right: var(--m); bottom: var(--mi); }
.mono { font-family: "Cutive Mono", "Courier New", monospace; font-size: 14px; letter-spacing: .14em; text-transform: uppercase; line-height: 1.3; }
.t { flex: none; font-size: 48px; font-weight: 500; line-height: 1.05; text-transform: uppercase; letter-spacing: -.004em; max-width: 760px; text-wrap: balance; }
.xl { font-size: 106px; font-weight: 500; line-height: .84; text-transform: uppercase; letter-spacing: -.012em; text-wrap: balance; }
.lab { font-size: 20px; font-weight: 500; line-height: 1.15; text-transform: uppercase; }
.lead { font-size: 36px; font-weight: 400; line-height: 1.12; letter-spacing: -.005em; text-wrap: pretty; }
.checker { background-color: var(--ck-a); background-image: repeating-conic-gradient(var(--ck-b) 0 25%, transparent 0 50%); background-size: 154px 154px; background-position: -10px -20px; }
img.checker, img { object-fit: cover; }

.star { position: absolute; right: 26px; top: 37px; }
.hero { position: absolute; left: var(--m); bottom: 80px; width: 700px; display: flex; flex-direction: column; gap: 26px; }
.hero .sub { font-size: 20px; line-height: 1.35; max-width: 520px; }
.hero .contact { margin-top: -8px; }
.hero .num { display: block; }
.section .hero { width: 800px; }

.agenda .burst { position: absolute; right: 26px; top: 34px; }
.agenda ol { list-style: none; margin: auto 0 auto calc(var(--indent) - var(--m)); font-size: 42px; line-height: 1.02; letter-spacing: -.008em; }
.agenda li { white-space: nowrap; }

.statement { align-items: center; justify-content: center; text-align: center; gap: 30px; }
.statement .say { font-size: 46px; font-weight: 500; line-height: 1.05; text-transform: uppercase; max-width: 780px; text-wrap: balance; }
.statement .burst, .quote .burst { position: absolute; right: 22px; top: 18px; }

.text .side { margin: auto 0 auto calc(684px - var(--m)); max-width: 560px; display: flex; flex-direction: column; gap: 22px; }

.rows { margin: auto calc(-1 * var(--m)) 0; display: flex; flex-direction: column; border-bottom: 1px solid var(--hair); }
.row { display: grid; grid-template-columns: 166px 1fr 392px; align-items: center; column-gap: 0; padding: 0 var(--m); border-top: 1px solid var(--hair); min-height: 148px; }
.row .rt { font-size: 40px; font-weight: 500; line-height: 1.05; text-transform: uppercase; padding-right: 24px; }
.row p { font-size: 17px; }

.metrics-grid { margin: auto calc(-1 * var(--m)) 0; display: grid; grid-template-columns: repeat(var(--n), 1fr); border-top: 1px solid var(--hair); border-bottom: 1px solid var(--hair); }
.metric { padding: 36px var(--m) 34px; display: flex; flex-direction: column; gap: 22px; min-width: 0; }
.metric + .metric { border-left: 1px solid var(--hair); }
.metric b { font-size: 100px; font-weight: 400; line-height: .86; letter-spacing: -.03em; font-variant-numeric: tabular-nums; white-space: nowrap; }

.cols { margin-top: auto; display: grid; grid-template-columns: repeat(var(--n), 1fr); column-gap: 44px; }
.col { display: flex; flex-direction: column; gap: 12px; }
.col p { max-width: 420px; }
.two-col .burst { position: absolute; right: 26px; top: 34px; }

.timeline .track { position: relative; margin: auto 64px; height: 300px; }
.timeline .line { position: absolute; left: 0; right: 0; top: 150px; border-top: 1.5px solid var(--ink); }
.timeline .line::before, .timeline .line::after { content: ""; position: absolute; top: -4.5px; width: 7px; height: 7px; border-radius: 50%; background: var(--ink); }
.timeline .line::before { left: -3px; } .timeline .line::after { right: -3px; }
.tstep { position: absolute; top: 0; height: 300px; width: var(--w); margin-left: calc(var(--w) / -2); display: flex; flex-direction: column; align-items: center; text-align: center; }
.tstep .dot { position: absolute; top: 124px; left: 50%; margin-left: -26px; width: 52px; height: 52px; border-radius: 50%; background: var(--white); }
.tstep .copy { position: absolute; left: 0; right: 0; display: flex; flex-direction: column; align-items: center; gap: 6px; }
.tstep.up .copy { bottom: 196px; } .tstep.down .copy { top: 196px; }
.tstep .copy p { font-size: 15px; max-width: 200px; }

.quote .side { margin: auto 0 auto calc(var(--indent) - var(--m)); max-width: 820px; display: flex; flex-direction: column; gap: 30px; }
.quote .by { display: flex; flex-direction: column; gap: 8px; }

.tbl { margin: auto calc(-1 * var(--m)) 0; width: calc(100% + 2 * var(--m)); border-collapse: collapse; }
.tbl th { text-align: left; font-weight: 400; padding: 0 var(--m) 16px; }
.tbl td { padding: 0 var(--m); height: 92px; border-top: 1px solid var(--hair); font-size: 19px; font-variant-numeric: tabular-nums; }
.tbl tr:last-child td { border-bottom: 1px solid var(--hair); }
.tbl td:first-child { font-size: 30px; font-weight: 500; text-transform: uppercase; }

.big { padding: 0; }
.big .half { position: absolute; left: 0; top: 0; bottom: 0; width: 644px; background-color: #fff; background-image: repeating-conic-gradient(#000 0 25%, transparent 0 50%); background-size: 16px 16px; }
.big .disc { position: absolute; left: 26px; top: 76px; }
.big .val { position: absolute; left: 210px; top: 260px; width: 200px; height: 200px; display: grid; place-items: center; color: #fff; font-weight: 500; letter-spacing: -.03em; line-height: 1; white-space: nowrap; }
.big .side { position: absolute; left: 684px; right: 60px; top: 0; bottom: 0; display: flex; flex-direction: column; justify-content: center; gap: 22px; }
.big .side .t { font-size: 40px; }

.bullets ul { list-style: none; margin: auto 0 auto calc(var(--indent) - var(--m)); border-bottom: 1px solid var(--hair); }
.bullets li { display: grid; grid-template-columns: 80px 1fr; align-items: baseline; padding: 18px 0; border-top: 1px solid var(--hair); font-size: 30px; line-height: 1.12; }

.people { margin-top: auto; display: grid; grid-template-columns: repeat(var(--n), 1fr); gap: 24px; }
.person { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.person .face { width: 100%; height: 300px; margin-bottom: 14px; background-size: 104px 104px; }

.image { padding-top: 73px; }
.image .band { flex: 1 1 auto; min-height: 0; width: 100%; }
.image .lab { margin-top: 24px; }

.stage { position: absolute; left: ${g.stage.left}px; top: ${g.stage.top}px; right: ${g.stage.right}px; bottom: ${g.stage.bottom}px; background: var(--black); display: grid; place-items: center; overflow: hidden; }
.stage img { width: 100%; height: 100%; }
.stage .screen { width: 66%; aspect-ratio: 16 / 10; border: 10px solid #1d1f22; border-radius: 16px; background-size: 72px 72px; }
.image-text .left { flex: 1 1 auto; width: 360px; display: flex; flex-direction: column; justify-content: space-between; }
.image-text .left .t { font-size: 44px; }
.image-text .left p { max-width: 340px; }

.framed .head { flex: none; display: flex; align-items: flex-start; justify-content: space-between; gap: 40px; }
.framed .head .mono { margin-top: 18px; text-align: right; max-width: 360px; }
.framed .avn-body { margin-top: 28px; }
`
}

export const slides = {
  cover: (d, ctx) => `<section class="slide dark cover">${meta(ctx, { tl: d.eyebrow ?? ctx.deck.title })}${star('star', 528)}
    <div class="hero"><h1 class="xl">${ctx.esc(d.title)}</h1>${d.subtitle ? `<p class="sub">${ctx.esc(d.subtitle)}</p>` : ''}</div></section>`,

  agenda: (d, ctx) => `<section class="slide agenda">${meta(ctx)}${burst('burst', 246, 20, 48)}${title(d.title, ctx)}
    <ol>${d.items.map((item, i) => `<li>${String(i + 1).padStart(2, '0')}—${ctx.esc(item)}</li>`).join('')}</ol></section>`,

  section: (d, ctx) => `<section class="slide sage section">${meta(ctx)}${star('star', 528)}
    <div class="hero"><h2 class="xl"><span class="num">${ctx.esc(d.number)}</span>${ctx.esc(d.title)}</h2>${d.subtitle ? `<p class="sub">${ctx.esc(d.subtitle)}</p>` : ''}</div></section>`,

  statement: (d, ctx) => `<section class="slide sage statement">${meta(ctx)}${burst('burst', 84, 20, 16)}
    <p class="say">${ctx.esc(d.text)}</p>${d.attribution ? `<span class="mono">${ctx.esc(d.attribution)}</span>` : ''}</section>`,

  text: (d, ctx) => `<section class="slide text">${meta(ctx)}${title(d.title, ctx)}
    <div class="side">${d.eyebrow ? `<span class="mono">${ctx.esc(d.eyebrow)}</span>` : ''}<p class="lead">${ctx.esc(d.body)}</p></div></section>`,

  points: (d, ctx) => `<section class="slide points">${meta(ctx)}${title(d.title, ctx)}
    <div class="rows">${d.items.map((item, i) => `<div class="row"><span class="mono">${String(i + 1).padStart(2, '0')}</span><h3 class="rt">${ctx.esc(item.title)}</h3><p>${ctx.esc(item.body)}</p></div>`).join('')}</div></section>`,

  'image-text': (d, ctx) => `<section class="slide image-text">${meta(ctx)}
    <div class="left">${title(d.title, ctx)}<p>${ctx.esc(d.body)}</p></div>
    <div class="stage">${ctx.image(d.image) ? picture(d.image, ctx, 'shot') : picture(d.image, ctx, 'screen')}</div></section>`,

  metrics: (d, ctx) => `<section class="slide metrics">${meta(ctx)}${title(d.title, ctx)}
    <div class="metrics-grid" style="--n:${d.items.length}">${d.items.map((m) => `<div class="metric"><b>${ctx.esc(m.value)}</b><span class="mono">${ctx.esc(m.label)}</span></div>`).join('')}</div></section>`,

  'two-column': (d, ctx) => `<section class="slide two-col">${meta(ctx)}${burst('burst', 246, 20, 48)}${title(d.title, ctx)}
    <div class="cols" style="--n:${d.columns.length}">${d.columns.map((c) => `<div class="col"><h3 class="lab">${ctx.esc(c.title)}</h3><p>${ctx.esc(c.body)}</p></div>`).join('')}</div></section>`,

  timeline: (d, ctx) => {
    const n = d.steps.length
    return `<section class="slide sage timeline">${meta(ctx)}${title(d.title, ctx)}
    <div class="track" style="--w:${Math.floor(1020 / n)}px"><div class="line"></div>${d.steps.map((s, i) => `<div class="tstep ${i % 2 ? 'down' : 'up'}" style="left:${((i + 0.5) / n) * 100}%"><span class="dot"></span>
      <div class="copy"><span class="mono">${ctx.esc(s.when)}</span><h3 class="lab">${ctx.esc(s.title)}</h3>${s.body ? `<p>${ctx.esc(s.body)}</p>` : ''}</div></div>`).join('')}</div></section>`
  },

  quote: (d, ctx) => `<section class="slide quote">${meta(ctx)}${burst('burst', 84, 20, 16)}
    <div class="side"><p class="lead">${ctx.esc(d.text)}</p><div class="by"><span class="lab">${ctx.esc(d.name)}</span>${d.role ? `<span class="mono">${ctx.esc(d.role)}</span>` : ''}</div></div></section>`,

  table: (d, ctx) => `<section class="slide table">${meta(ctx)}${title(d.title, ctx)}
    <table class="tbl"><thead><tr>${d.columns.map((c) => `<th class="mono">${ctx.esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${d.rows.map((r) => `<tr>${r.map((c) => `<td>${ctx.esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></section>`,

  'big-number': (d, ctx) => {
    const len = [...String(d.value)].length
    const size = len <= 2 ? 120 : len <= 3 ? 92 : len <= 4 ? 70 : 54
    return `<section class="slide big">${meta(ctx, { tl: null, bl: null })}<div class="half"></div>${disc(568)}
    <span class="val" style="font-size:${size}px">${ctx.esc(d.value)}</span>
    <div class="side"><h2 class="t">${ctx.esc(d.label)}</h2>${d.body ? `<p>${ctx.esc(d.body)}</p>` : ''}</div></section>`
  },

  bullets: (d, ctx) => `<section class="slide bullets">${meta(ctx)}${title(d.title, ctx)}
    <ul>${d.items.map((item, i) => `<li><span class="mono">${String(i + 1).padStart(2, '0')}</span><span>${ctx.esc(item)}</span></li>`).join('')}</ul></section>`,

  team: (d, ctx) => `<section class="slide team">${meta(ctx)}${title(d.title, ctx)}
    <div class="people" style="--n:${d.people.length}">${d.people.map((p) => `<div class="person">${picture(p.image ?? { alt: p.name }, ctx, 'face')}<h3 class="lab">${ctx.esc(p.name)}</h3><p>${ctx.esc(p.role)}</p></div>`).join('')}</div></section>`,

  image: (d, ctx) => `<section class="slide image">${meta(ctx)}${picture(d.image, ctx, 'band')}${d.caption ? `<p class="lab">${ctx.esc(d.caption)}</p>` : ''}</section>`,

  /** The titled content slide that `chart` and `custom` slides are drawn in. */
  frame: ({ title: t, eyebrow }, ctx, body) => `<section class="slide framed">${meta(ctx)}<div class="head">${t ? title(t, ctx) : '<span></span>'}${eyebrow ? `<span class="mono">${ctx.esc(eyebrow)}</span>` : ''}</div>${body}</section>`,

  closing: (d, ctx) => `<section class="slide dark closing">${meta(ctx)}${star('star', 528)}
    <div class="hero"><h2 class="xl">${ctx.esc(d.title)}</h2>${d.subtitle ? `<p class="sub">${ctx.esc(d.subtitle)}</p>` : ''}${d.contact ? `<span class="mono contact">${ctx.esc(d.contact)}</span>` : ''}</div></section>`,
}
