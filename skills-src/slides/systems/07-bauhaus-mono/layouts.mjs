/**
 * Bauhaus Mono: white paper, black and three neutral greys, Jost throughout. Every slide is a
 * 16 × 9 CSS grid of 80px modules; text blocks and shapes (circle, square, quarter circle,
 * half disc, bars) occupy whole modules, and a hairline footer on row 9 carries the deck title
 * and slide number. Original design by Aeven.
 */

const M = 80

/** CSS grid placement in modules: column and row are 1-based, so column 2 starts at x = 80. */
const at = (c, r, w, h) => `grid-area:${r} / ${c} / span ${h} / span ${w}`

/** A geometric primitive filling its grid area: circle, square, q-tl/q-tr/q-bl/q-br (the rounded corner), half-t/b/l/r (the dome side). */
const shape = (kind, tone, c, r, w, h) => `<i class="sh ${kind} ${tone}" style="${at(c, r, w, h)}" aria-hidden="true"></i>`

const pad = (n) => String(n).padStart(2, '0')

/** A content-slide title in `w` modules; titles too long for two lines at 56px drop to 44px. */
const isLong = (text, w) => [...text].length > w * 4.6
const title = (text, ctx, c, r, w, h) => `<h2 class="t-m${isLong(text, w) ? ' long' : ''}" style="${at(c, r, w, h)}">${ctx.esc(text)}</h2>`

/** Row 9: hairline at y = 640, deck title (or `left`) at the left, slide number at the right. */
function foot(ctx, { c = 2, w = 14, left } = {}) {
  return `<div class="foot" style="${at(c, 9, w, 1)}"><span class="meta">${ctx.esc(left ?? ctx.deck.title)}</span><span class="meta num">${pad(ctx.index)} / ${pad(ctx.total)}</span></div>`
}

/**
 * The image placeholder: a grey field with a module-aligned composition, drawn for a slot of
 * `w` × `h` pixels so its shapes keep whole-module sizes at any slot size.
 */
function field(w, h, variant = 0) {
  const d = Math.max(M, Math.floor((Math.min(w, h) * 0.6) / M) * M)
  const r = Math.max(M / 2, Math.floor((Math.min(w, h) * 0.4) / M) * M)
  const flip = variant % 2 === 1
  const cx = w - (flip ? 2 * M : M) - d / 2
  const cy = flip ? Math.round(h / 2 / M) * M : 2 * M + d / 2
  const corner = flip ? `M ${w} ${h} L ${w - r} ${h} A ${r} ${r} 0 0 1 ${w} ${h - r} Z` : `M 0 ${h} L 0 ${h - r} A ${r} ${r} 0 0 1 ${r} ${h} Z`
  return `<svg class="field" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <rect width="${w}" height="${h}" fill="var(--g1)"/>
    <circle cx="${cx}" cy="${cy}" r="${d / 2}" fill="var(--g2)"/>
    <rect x="${M}" y="${cy - 1}" width="${Math.max(0, cx - d / 2 - M)}" height="2" fill="var(--ink)"/>
    <path d="${corner}" fill="var(--ink)"/>
    <rect x="${M}" y="${M}" width="${M}" height="${M}" fill="var(--g3)"/>
  </svg>`
}

/** A user picture shown in greyscale, or the geometric placeholder with its alt text as a caption. */
function picture(image, ctx, w, h, variant = 0) {
  const src = ctx.image(image)
  if (src) return `<img class="pic" src="${ctx.esc(src)}" alt="${ctx.esc(image.alt)}">`
  const label = image?.alt ? `<span class="meta field-label">${ctx.esc(image.alt)}</span>` : ''
  return `<div class="pic placeholder" role="img" aria-label="${ctx.esc(image?.alt ?? '')}">${field(w, h, variant)}${label}</div>`
}

/** An 80px mark for a list item: circle, square or half disc. */
function mark(kind, tone) {
  const fill = `var(--${tone})`
  const body = {
    circle: `<circle cx="40" cy="40" r="40" fill="${fill}"/>`,
    square: `<rect width="80" height="80" fill="${fill}"/>`,
    half: `<path d="M0 80 A40 40 0 0 1 80 80 Z" fill="${fill}"/>`,
    quarter: `<path d="M0 80 L0 0 A80 80 0 0 1 80 80 Z" fill="${fill}"/>`,
  }[kind]
  return `<svg class="mark" viewBox="0 0 80 80" aria-hidden="true">${body}</svg>`
}

/** A 40px progress disc for timeline step `i` of `n`: the black sector grows step by step. */
function pie(i, n) {
  const f = (i + 1) / n
  const r = 19
  if (f >= 1) return `<svg class="pie" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="${r}" fill="var(--ink)" stroke="var(--ink)" stroke-width="2"/></svg>`
  const a = f * 2 * Math.PI
  const x = 20 + r * Math.sin(a)
  const y = 20 - r * Math.cos(a)
  return `<svg class="pie" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="${r}" fill="var(--paper)" stroke="var(--ink)" stroke-width="2"/>
    <path d="M20 20 L20 ${20 - r} A${r} ${r} 0 ${f > 0.5 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)} Z" fill="var(--ink)"/></svg>`
}

/** A portrait placeholder: head circle over a half-disc shoulder line, tones rotating per person. */
function figure(i) {
  const [bg, fg] = [['g1', 'ink'], ['g2', 'ink'], ['ink', 'g1'], ['g1', 'g3']][i % 4]
  return `<svg class="field" viewBox="0 0 240 240" aria-hidden="true"><rect width="240" height="240" fill="var(--${bg})"/>
    <circle cx="120" cy="100" r="40" fill="var(--${fg})"/><path d="M40 240 A80 80 0 0 1 200 240 Z" fill="var(--${fg})"/></svg>`
}

/** Font size for a big-number value so longer values still fit their six-module field. */
const bigSize = (value) => {
  const n = [...String(value)].length
  return n <= 2 ? 280 : n <= 3 ? 220 : n <= 4 ? 176 : 132
}

export function css(system) {
  const { paper, ink } = system
  return `
:root { --paper: ${paper.light}; --night: ${paper.dark}; --ink: ${ink.black}; --g1: ${ink.grey1}; --g2: ${ink.grey2}; --g3: ${ink.grey3}; --white: ${ink.white};
  --text: var(--ink); --soft: var(--g3); --rule: ${ink.rule}; }
.slide { display: grid; grid-template-columns: repeat(16, ${M}px); grid-template-rows: repeat(9, ${M}px);
  background: var(--paper); color: var(--text); font-size: 20px; line-height: 1.5; font-weight: 400;
  font-variant-numeric: lining-nums tabular-nums; }
.slide > * { min-width: 0; min-height: 0; }
.slide.dark { background: var(--night); --text: var(--white); --soft: var(--g2); --rule: rgba(255,255,255,.24); }

.sh { display: block; width: 100%; height: 100%; }
.sh.ink { background: var(--ink); } .sh.white { background: var(--white); }
.sh.g1 { background: var(--g1); } .sh.g2 { background: var(--g2); } .sh.g3 { background: var(--g3); }
.circle { border-radius: 50%; }
.q-tl { border-top-left-radius: 100%; } .q-tr { border-top-right-radius: 100%; }
.q-bl { border-bottom-left-radius: 100%; } .q-br { border-bottom-right-radius: 100%; }
.half-t { border-radius: 9999px 9999px 0 0; } .half-b { border-radius: 0 0 9999px 9999px; }
.half-l { border-radius: 9999px 0 0 9999px; }
.bubble { border-radius: 50% 50% 50% 0; } .half-r { border-radius: 0 9999px 9999px 0; }
.bar { height: 4px; background: var(--ink); align-self: start; }

.meta { font-size: 12px; font-weight: 500; letter-spacing: .16em; text-transform: uppercase; line-height: 1.3; }
.soft { color: var(--soft); }
.num { font-variant-numeric: tabular-nums lining-nums; }
.foot { display: flex; justify-content: space-between; align-items: flex-start; gap: 40px; padding-top: 26px; border-top: 1px solid var(--rule); color: var(--soft);
  background: repeating-linear-gradient(to right, var(--rule) 0 1px, transparent 1px ${M}px) left top / 100% 6px no-repeat, linear-gradient(var(--rule), var(--rule)) right top / 1px 6px no-repeat; }
.foot .meta:first-child { min-width: 0; }
.foot .num { flex: none; }

.t-xl, .t-l, .t-m { font-weight: 500; letter-spacing: -.03em; }
.t-xl { font-size: 116px; line-height: .94; letter-spacing: -.04em; }
.t-l { font-size: 84px; line-height: .98; letter-spacing: -.035em; }
.t-m { font-size: 56px; line-height: 1.04; }
.t-m.long { font-size: 44px; line-height: 1.08; }
.lead { font-size: 26px; line-height: 1.38; }
.body { font-size: 21px; line-height: 1.5; }
.stack { display: flex; flex-direction: column; }

.pic { width: 100%; height: 100%; object-fit: cover; filter: grayscale(1); }
.placeholder { position: relative; overflow: hidden; }
.field { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.field-label { position: absolute; left: ${M}px; top: ${2 * M + 24}px; color: var(--ink); }
.mark { display: block; width: 80px; height: 80px; }
.points .mark { width: ${2 * M}px; height: ${2 * M}px; }

.cover .group { justify-content: flex-end; gap: 28px; }
.cover .sub { color: var(--soft); max-width: 560px; }

.rows { list-style: none; border-bottom: 1px solid var(--rule); }
.rows li { display: flex; align-items: center; gap: 0; min-height: ${M}px; border-top: 1px solid var(--rule); }
.rows .n { flex: none; width: ${M}px; color: var(--soft); }
.agenda .rows li { font-size: 30px; line-height: 1.2; font-weight: 400; }
.bullets .rows li { font-size: 24px; line-height: 1.3; padding: 18px 0; }
.bullets .rows .dot { flex: none; width: 12px; height: 12px; background: var(--ink); margin: 0 ${M - 12}px 0 0; }
.bullets .rows .dot.round { border-radius: 50%; }

.section .group { justify-content: space-between; }
.section .big-n { font-size: 140px; font-weight: 400; line-height: .8; letter-spacing: -.04em; color: var(--g3); }
.section .sub { color: var(--soft); margin-top: 24px; max-width: 640px; }

.statement .group { justify-content: center; gap: 36px; }
.statement .say { font-size: 58px; line-height: 1.14; font-weight: 400; letter-spacing: -.025em; text-wrap: balance; }
.statement .by { display: flex; align-items: center; gap: 20px; color: var(--soft); }
.statement .by::before { content: ""; width: 40px; height: 2px; background: var(--ink); }

.text .group { gap: 28px; }
.text .copy { margin-top: -8px; }
.over { align-self: end; padding-bottom: 18px; }

.points .item { gap: 0; }
.points .item .meta { margin: 28px 0 10px; color: var(--soft); }
.points .item h3 { font-size: 26px; line-height: 1.2; font-weight: 500; letter-spacing: -.01em; margin-bottom: 10px; }
.points .item p { font-size: 20px; line-height: 1.45; color: var(--soft); }

.image-text .group { justify-content: flex-start; gap: 32px; }
.image-text .copy { color: var(--soft); }

.metrics .band { display: grid; grid-template-columns: repeat(var(--n), 1fr); column-gap: 40px; }
.metric { display: flex; flex-direction: column; gap: 18px; padding: 28px 24px 0 0; border-top: 4px solid var(--ink); }
.metric b { font-size: 84px; line-height: .9; font-weight: 400; letter-spacing: -.04em; }
.metric span { color: var(--soft); max-width: 220px; }

.two-column .col { gap: 18px; }
.two-column .col .hd { display: flex; align-items: center; gap: 20px; padding-bottom: 20px; border-bottom: 1px solid var(--rule); }
.two-column .col .hd svg { flex: none; width: 20px; height: 40px; }
.two-column .col h3 { font-size: 28px; line-height: 1.15; font-weight: 500; letter-spacing: -.01em; }
.two-column .col p { color: var(--soft); font-size: 24px; line-height: 1.42; }

.timeline .track { position: relative; display: grid; grid-template-columns: repeat(var(--n), 1fr); }
.timeline .track::before { content: ""; position: absolute; left: 0; right: 0; top: ${2 * M}px; height: 2px; margin-top: -1px; background: var(--ink); }
.step { position: relative; padding-right: 32px; }
.step .when { position: absolute; left: 0; top: ${2 * M - 40 - 36}px; font-size: 40px; line-height: 1; font-weight: 500; letter-spacing: -.02em; }
.step .pie { position: absolute; left: 0; top: ${2 * M - 20}px; width: 40px; height: 40px; }
.step .what { position: absolute; left: 0; right: 32px; top: ${2 * M + 44}px; }
.step h3 { font-size: 26px; line-height: 1.2; font-weight: 500; letter-spacing: -.01em; margin-bottom: 6px; }
.step p { font-size: 19px; line-height: 1.4; color: var(--soft); }

.quote .say { font-size: 44px; line-height: 1.28; font-weight: 400; letter-spacing: -.015em; text-wrap: pretty; }
.quote .group { justify-content: space-between; }
.quote .by { display: flex; flex-direction: column; gap: 8px; padding-top: 22px; border-top: 1px solid var(--rule); }
.quote .by b { font-size: 22px; font-weight: 500; }

.table table { width: 100%; border-collapse: collapse; table-layout: fixed; align-self: start; }
.table th { text-align: left; font-size: 12px; font-weight: 500; letter-spacing: .16em; text-transform: uppercase; color: var(--soft); padding: 0 24px 18px 0; border-bottom: 2px solid var(--ink); }
.table td { font-size: 22px; line-height: 1.25; padding: 22px 24px 22px 0; border-bottom: 1px solid var(--rule); vertical-align: top; }
.table td:first-child { font-weight: 500; }
.table td:not(:first-child) { color: var(--soft); }
.table col.first { width: 34%; }

.big-number .value { display: flex; align-items: center; justify-content: center; font-weight: 500; letter-spacing: -.05em; line-height: 1; white-space: nowrap; }
.big-number .group { justify-content: center; gap: 28px; }
.big-number .copy { color: var(--soft); }

.team .people { display: grid; grid-template-columns: repeat(var(--n), var(--cw)); column-gap: var(--gap); }
.person { display: flex; flex-direction: column; }
.person .face { position: relative; width: ${3 * M}px; height: ${3 * M}px; overflow: hidden; }
.person b { margin-top: 24px; font-size: 24px; line-height: 1.2; font-weight: 500; letter-spacing: -.01em; }
.person span { margin-top: 8px; color: var(--soft); }

.image .cap { font-size: 12px; }

.framed .frame-body { display: flex; flex-direction: column; min-height: 0; padding-bottom: 24px; }
.framed .frame-body.after-short { padding-top: 40px; }
.framed .avn-chart svg { width: auto; max-width: 100%; height: 100%; }
.framed .avn-caption { margin-top: 16px; font-size: 12px; font-weight: 500; letter-spacing: .16em; text-transform: uppercase; line-height: 1.3; color: var(--soft); }

.closing .group { justify-content: flex-end; gap: 28px; }
.closing .sub { color: var(--soft); max-width: 560px; }
`
}

const group = (cls, c, r, w, h, inner) => `<div class="stack group ${cls}" style="${at(c, r, w, h)}">${inner}</div>`

/** The three section-divider compositions, chosen by section number so consecutive sections differ. */
const sectionArt = [
  () => shape('circle', 'white', 11, 2, 5, 5) + shape('square', 'g3', 10, 7, 1, 1),
  () => shape('half-t', 'white', 10, 6, 6, 3) + shape('circle', 'g3', 14, 2, 2, 2),
  () => shape('q-bl', 'g3', 11, 1, 6, 6) + shape('square', 'white', 10, 7, 1, 1),
]

export const slides = {
  cover: (d, ctx) => `<section class="slide cover">
    ${shape('square', 'g1', 12, 1, 4, 4)}${shape('circle', 'ink', 10, 3, 5, 5)}${shape('square', 'ink', 15, 7, 1, 1)}
    ${group('', 2, 2, 7, 6, `${d.eyebrow ? `<span class="meta soft">${ctx.esc(d.eyebrow)}</span>` : ''}<h1 class="t-xl">${ctx.esc(d.title)}</h1>${d.subtitle ? `<p class="lead sub">${ctx.esc(d.subtitle)}</p>` : ''}`)}
    ${foot(ctx, { left: [ctx.deck.presenter, ctx.deck.date].filter(Boolean).join(' · ') || ctx.deck.title })}</section>`,

  agenda: (d, ctx) => `<section class="slide agenda">
    <h2 class="t-l" style="${at(2, 2, 5, 3)}">${ctx.esc(d.title)}</h2>
    ${shape('q-tr', 'ink', 2, 6, 3, 3)}
    <ol class="rows" style="${at(8, 2, 8, d.items.length)}">${d.items.map((item, i) => `<li><span class="meta n">${pad(i + 1)}</span><span>${ctx.esc(item)}</span></li>`).join('')}</ol>
    ${foot(ctx)}</section>`,

  section: (d, ctx) => {
    const n = parseInt(d.number, 10) || ctx.index
    return `<section class="slide dark section">${sectionArt[(n - 1) % 3]()}
    ${group('', 2, 2, 7, 6, `<span class="big-n num">${ctx.esc(d.number)}</span><div><h2 class="t-l">${ctx.esc(d.title)}</h2>${d.subtitle ? `<p class="lead sub">${ctx.esc(d.subtitle)}</p>` : ''}</div>`)}
    ${foot(ctx)}</section>`
  },

  statement: (d, ctx) => `<section class="slide statement">
    ${shape('half-r', 'ink', 1, 3, 2, 4)}
    ${group('', 4, 2, 11, 6, `<p class="say">${ctx.esc(d.text)}</p>${d.attribution ? `<span class="meta by">${ctx.esc(d.attribution)}</span>` : ''}`)}
    ${foot(ctx)}</section>`,

  text: (d, ctx) => `<section class="slide text">
    ${d.eyebrow ? `<span class="meta soft over" style="${at(2, 1, 6, 1)}">${ctx.esc(d.eyebrow)}</span>` : ''}
    ${title(d.title, ctx, 2, 2, 6, 4)}
    ${shape('square', 'g1', 2, 6, 2, 2)}${shape('circle', 'ink', 3, 7, 2, 2)}
    <p class="lead copy" style="${at(9, 2, 6, 6)}">${ctx.esc(d.body)}</p>
    ${foot(ctx)}</section>`,

  points: (d, ctx) => {
    const marks = [['circle', 'ink'], ['square', 'g2'], ['half', 'ink']]
    return `<section class="slide points">
    ${title(d.title, ctx, 2, 2, 10, 2)}
    ${d.items.map((item, i) => `<div class="stack item" style="${at(2 + i * 5, 4, 4, 5)}">${mark(...marks[i % 3])}<span class="meta num">${pad(i + 1)}</span><h3>${ctx.esc(item.title)}</h3><p>${ctx.esc(item.body)}</p></div>`).join('')}
    ${foot(ctx)}</section>`
  },

  'image-text': (d, ctx) => `<section class="slide image-text">
    <div style="${at(1, 1, 8, 9)}">${picture(d.image, ctx, 8 * M, 9 * M, 0)}</div>
    ${group('', 10, 2, 6, 6, `<h2 class="t-m">${ctx.esc(d.title)}</h2><p class="lead copy">${ctx.esc(d.body)}</p>`)}
    ${foot(ctx, { c: 10, w: 6 })}</section>`,

  metrics: (d, ctx) => `<section class="slide metrics">
    ${shape('q-bl', 'ink', 13, 1, 4, 4)}
    ${title(d.title, ctx, 2, 2, 8, 2)}
    <div class="band n${d.items.length}" style="${at(2, 5, 14, 3)};--n:${d.items.length}">${d.items.map((m) => `<div class="metric"><b class="num">${ctx.esc(m.value)}</b><span class="meta">${ctx.esc(m.label)}</span></div>`).join('')}</div>
    ${foot(ctx)}</section>`,

  'two-column': (d, ctx) => {
    const halves = [['0 0 20 40', `<path d="M20 0 A20 20 0 0 0 20 40 Z" fill="var(--ink)"/>`], ['20 0 20 40', `<path d="M20 0 A20 20 0 0 1 20 40 Z" fill="var(--g2)"/>`]]
    return `<section class="slide two-column">
    ${title(d.title, ctx, 2, 2, 10, 2)}
    ${shape('half-l', 'ink', 14, 2, 1, 2)}${shape('half-r', 'g2', 15, 2, 1, 2)}
    ${d.columns.map((c, i) => `<div class="stack col" style="${at(i ? 10 : 2, 5, 6, 3)}"><div class="hd"><svg viewBox="${halves[i % 2][0]}" aria-hidden="true">${halves[i % 2][1]}</svg><h3>${ctx.esc(c.title)}</h3></div><p>${ctx.esc(c.body)}</p></div>`).join('')}
    ${foot(ctx)}</section>`
  },

  timeline: (d, ctx) => `<section class="slide timeline">
    ${title(d.title, ctx, 2, 2, 10, 2)}
    <div class="track" style="${at(2, 4, 14, 4)};--n:${d.steps.length}">${d.steps.map((s, i) => `<div class="step"><span class="when num">${ctx.esc(s.when)}</span>${pie(i, d.steps.length)}<div class="what"><h3>${ctx.esc(s.title)}</h3>${s.body ? `<p>${ctx.esc(s.body)}</p>` : ''}</div></div>`).join('')}</div>
    ${foot(ctx)}</section>`,

  quote: (d, ctx) => `<section class="slide quote">
    ${shape('square', 'g1', 2, 2, 4, 4)}${shape('bubble', 'ink', 3, 3, 3, 3)}
    ${group('', 7, 2, 9, 6, `<p class="say">${ctx.esc(d.text)}</p><div class="by"><b>${ctx.esc(d.name)}</b>${d.role ? `<span class="meta soft">${ctx.esc(d.role)}</span>` : ''}</div>`)}
    ${foot(ctx)}</section>`,

  table: (d, ctx) => `<section class="slide table">
    ${title(d.title, ctx, 2, 2, 10, 2)}
    ${shape('circle', 'ink', 14, 2, 1, 1)}${shape('square', 'g2', 15, 2, 1, 1)}
    <table style="${at(2, 4, 14, 5)}"><colgroup><col class="first">${d.columns.slice(1).map(() => '<col>').join('')}</colgroup>
    <thead><tr>${d.columns.map((c) => `<th>${ctx.esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${d.rows.map((r) => `<tr>${r.map((c) => `<td class="num">${ctx.esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>
    ${foot(ctx)}</section>`,

  'big-number': (d, ctx) => `<section class="slide big-number">
    ${shape('circle', 'g1', 2, 2, 6, 6)}
    <b class="value num" style="${at(2, 2, 7, 6)};font-size:${bigSize(d.value)}px">${ctx.esc(d.value)}</b>
    ${group('', 10, 2, 6, 6, `<h2 class="t-m">${ctx.esc(d.label)}</h2>${d.body ? `<p class="lead copy">${ctx.esc(d.body)}</p>` : ''}`)}
    ${foot(ctx)}</section>`,

  bullets: (d, ctx) => `<section class="slide bullets">
    ${title(d.title, ctx, 2, 2, 5, 3)}
    ${shape('half-t', 'ink', 2, 7, 4, 2)}
    <ul class="rows" style="${at(8, 2, 8, 6)};align-self:start">${d.items.map((item) => `<li><span class="dot"></span><span>${ctx.esc(item)}</span></li>`).join('')}</ul>
    ${foot(ctx)}</section>`,

  team: (d, ctx) => `<section class="slide team">
    ${title(d.title, ctx, 2, 2, 10, 2)}
    <div class="people" style="${at(2, 4, 14, 5)};--n:${d.people.length};--cw:${d.people.length > 3 ? 3.5 * M : 4 * M}px;--gap:${d.people.length > 3 ? 0 : M}px">${d.people.map((p, i) => {
      const src = p.image && ctx.image(p.image)
      const face = src ? `<img class="pic" src="${ctx.esc(src)}" alt="${ctx.esc(p.name)}">` : figure(i)
      return `<div class="person"><div class="face">${face}</div><b>${ctx.esc(p.name)}</b><span class="meta">${ctx.esc(p.role)}</span></div>`
    }).join('')}</div>
    ${foot(ctx)}</section>`,

  image: (d, ctx) => `<section class="slide image">
    <div style="${at(1, 1, 16, 8)}">${picture(d.image, ctx, 16 * M, 8 * M, 1)}</div>
    ${foot(ctx, { left: d.caption ?? ctx.deck.title })}</section>`,

  /** The titled content slide for chart and custom: title on row 2 (rows 2–3 when long), `body` from 40px below row 3 (row 4 after a long title, row 2 and no corner shapes without one) to the footer. */
  frame: ({ title: heading, eyebrow }, ctx, body) => `<section class="slide framed">
    ${eyebrow ? `<span class="meta soft over" style="${at(2, 1, 12, 1)}">${ctx.esc(eyebrow)}</span>` : ''}
    ${heading ? title(heading, ctx, 2, 2, 11, 2) : ''}
    ${heading ? shape('circle', 'ink', 14, 2, 1, 1) + shape('square', 'g2', 15, 2, 1, 1) : ''}
    <div class="frame-body${heading && !isLong(heading, 11) ? ' after-short' : ''}" style="${!heading ? at(2, 2, 14, 7) : isLong(heading, 11) ? at(2, 4, 14, 5) : at(2, 3, 14, 6)}">${body}</div>
    ${foot(ctx)}</section>`,

  closing: (d, ctx) => `<section class="slide dark closing">
    ${shape('square', 'g3', 12, 1, 4, 4)}${shape('circle', 'white', 10, 3, 5, 5)}${shape('square', 'white', 15, 7, 1, 1)}
    ${group('', 2, 2, 7, 6, `<h2 class="t-xl">${ctx.esc(d.title)}</h2>${d.subtitle ? `<p class="lead sub">${ctx.esc(d.subtitle)}</p>` : ''}${d.contact ? `<span class="meta">${ctx.esc(d.contact)}</span>` : ''}`)}
    ${foot(ctx)}</section>`,
}
