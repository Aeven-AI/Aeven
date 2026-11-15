/**
 * Folio: near-black designer-portfolio slides set in a medium geometric sans with tight display
 * tracking. A small gradient logo mark and wordmark sit top left, a dark pill label top right and a
 * tiny date bottom left. Index rows number "001…" on hairlines with right-aligned titles; section
 * slides fill with a black-to-violet-to-lilac gradient and a dark breadcrumb bar; statements and
 * one highlighted numeral run a peach-to-violet type gradient; picture slots are tall orange, sage
 * and amber colour tiles, with a blue and a cream tile for paired content.
 * Measured from the Figma Community collage "Folio — Presentation Template".
 */

/** Placeholder tiles in the order the source shows its photo colours. */
const TILES = ['orange', 'sage', 'amber', 'blue']

/**
 * A font size that keeps `text` within `lines` lines of `width` px, assuming an average advance
 * of `em` × size per character, clamped to [min, max].
 */
function fit(text, { width, lines, max, min, em = 0.56 }) {
  const str = String(text)
  const byLines = ((width * lines) / (Math.max(str.length, 1) * em)) * 0.88
  const word = Math.max(1, ...str.split(/\s+/).map((w) => w.length))
  const byWord = width / (word * em * 1.12)
  return Math.round(Math.max(min, Math.min(max, byLines, byWord)))
}

/** Two-digit "(01)" style counter. */
const nn = (i) => String(i + 1).padStart(2, '0')

/** The corner chrome: logo mark and wordmark, the pill label, and the date at the foot. */
function chrome(ctx, { pill, foot = true, brand = true } = {}) {
  const name = ctx.deck.presenter ?? ctx.deck.title ?? ''
  const label = pill === undefined ? ctx.deck.title : pill
  return `${brand ? `<div class="brand"><i class="mark" aria-hidden="true"></i><span>${ctx.esc(name)}</span></div>` : ''}${label ? `<span class="pill tr">${ctx.esc(label)}</span>` : ''}${foot && ctx.deck.date ? `<span class="foot">${ctx.esc(ctx.deck.date)}</span>` : ''}`
}

/** A user picture, or a colour tile in the slot when there is none. */
function picture(image, ctx, cls, tile) {
  const src = image && ctx.image(image)
  return src
    ? `<img class="${cls}" src="${ctx.esc(src)}" alt="${ctx.esc(image.alt ?? '')}">`
    : `<div class="${cls} t-${tile}" role="img" aria-label="${ctx.esc(image?.alt ?? '')}"></div>`
}

/** The tile for the nth picture slot in the deck, so repeated slots rotate colour. */
function tileFor(ctx, offset = 0) {
  const kinds = new Set(['image-text', 'image', 'quote'])
  const n = ctx.deck.slides.slice(0, ctx.index - 1).filter((s) => kinds.has(s.kind)).length
  return TILES[(n + offset) % TILES.length]
}

/** Peach, lilac and violet stops of the source's type gradient. */
const STOPS = [[0xF2, 0xC4, 0xA8], [0xC4, 0xA0, 0xE6], [0x8B, 0x63, 0xF0]]

/** The gradient colour at `t` in [0, 1]. */
function stop(t) {
  const x = Math.min(1, Math.max(0, t)) * (STOPS.length - 1)
  const i = Math.min(STOPS.length - 2, Math.floor(x))
  const f = x - i
  return `rgb(${STOPS[i].map((c, k) => Math.round(c + (STOPS[i + 1][k] - c) * f)).join(',')})`
}

/**
 * Text run through the peach-to-violet gradient as solid colours per word (or per character for
 * a short figure), so print output carries no clipped-background seams.
 */
function gradText(text, ctx, { chars = false } = {}) {
  const str = String(text)
  const parts = chars ? [...str] : str.split(/(\s+)/)
  const n = Math.max(1, str.length - 1)
  let at = 0
  return parts.map((part) => {
    const mid = at + (part.length - 1) / 2
    at += part.length
    return /^\s+$/.test(part) ? part : `<span style="color:${stop(mid / n)}">${ctx.esc(part)}</span>`
  }).join('')
}

const title = (text, ctx, cls = 'h') => `<h2 class="${cls}">${ctx.esc(text)}</h2>`

export function css(system) {
  const { surface: s, ink, gradient: g, tiles: t } = system
  return `
:root { --page: ${s.page}; --pill: ${s.pill}; --pill-line: ${s.pillLine}; --card: ${s.card}; --glow: ${s.glow};
  --ink: ${ink.primary}; --muted: ${ink.muted}; --soft: ${ink.soft}; --dark: ${ink.dark};
  --peach: ${g.peach}; --violet: ${g.violet}; --deep: ${g.deep}; --lilac: ${g.lilac};
  --orange: ${t.orange}; --orange-deep: ${t.orangeDeep}; --amber: ${t.amber}; --sage-l: ${t.sageLight}; --sage: ${t.sage}; --sage-d: ${t.sageDeep};
  --blue: ${t.blue}; --cream: ${t.cream}; --hair: ${system.geometry.hairline}; --m: ${system.geometry.margin}px; }
.slide { background: var(--page); color: var(--ink); font-size: 18px; line-height: 1.45; font-weight: 400; }
.slide > * { position: absolute; }

.brand { left: var(--m); top: 32px; display: flex; align-items: center; gap: 9px; font-size: 19px; font-weight: 500; letter-spacing: -.02em; line-height: 1; z-index: 2; }
.mark { width: 22px; height: 22px; border-radius: 6px; background: linear-gradient(135deg, var(--peach) 0%, #B98FE6 50%, var(--violet) 100%); box-shadow: inset 0 0 0 1px rgba(255,255,255,.25); }
.pill { display: inline-flex; align-items: center; height: 34px; padding: 0 16px; border-radius: 999px; background: var(--pill); box-shadow: inset 0 0 0 1px var(--pill-line); color: var(--ink); font-size: 12px; font-weight: 500; white-space: nowrap; line-height: 1; }
.pill.tr { right: var(--m); top: 26px; z-index: 2; }
.foot { left: var(--m); bottom: 22px; font-size: 11px; color: var(--muted); line-height: 1; }

.h { font-weight: 500; letter-spacing: -.035em; line-height: 1.04; }
.lbl { font-size: 13px; color: var(--muted); line-height: 1.3; }
.lbl b { font-weight: 500; color: var(--soft); margin-right: 10px; }

.t-orange { background: linear-gradient(172deg, #F08A5C 0%, var(--orange) 45%, var(--orange-deep) 100%); }
.t-sage { background: linear-gradient(180deg, var(--sage-l) 0%, #B9BEA2 30%, var(--sage) 62%, var(--sage-d) 100%); }
.t-amber { background: linear-gradient(176deg, #F3A251 0%, var(--amber) 50%, #E86E2E 100%); }
.t-blue { background: var(--blue); }
.t-cream { background: var(--cream); }
img.media, img.tile { object-fit: cover; }

/* cover: case-study opener */
.cover .glow { left: 0; right: 0; top: 160px; height: 560px; background: radial-gradient(58% 40% at 50% 58%, rgba(140,104,232,.95) 0%, rgba(100,70,180,.62) 30%, rgba(60,38,110,.3) 58%, transparent 84%); }
.cover .band { left: 110px; right: 110px; top: 486px; bottom: -40px; }
.cover .body { left: 80px; right: 80px; top: 112px; height: 360px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 12px; }
.cover .eyebrow { font-size: 15px; color: var(--soft); }
.cover h1 { font-weight: 500; letter-spacing: -.055em; line-height: .92; max-width: 1100px; }
.cover .sub { margin-top: 10px; font-size: 20px; color: var(--soft); max-width: 760px; text-wrap: balance; }

/* agenda: the index */
.index .rows { left: 222px; right: var(--m); top: 134px; list-style: none; }
.index li { display: flex; justify-content: space-between; align-items: flex-start; gap: 40px; border-top: 1px solid var(--hair); padding-top: 18px; }
.index .no { font-size: 18px; font-weight: 500; font-variant-numeric: tabular-nums; }
.index .it { font-size: 26px; font-weight: 500; letter-spacing: -.02em; text-align: right; line-height: 1.2; }

/* section: gradient field */
.section { background: linear-gradient(62deg, #000 16%, #1c1240 30%, var(--deep) 52%, #8466D6 70%, var(--lilac) 100%); }
.section .body { left: 80px; right: 80px; top: 0; bottom: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 22px; }
.section h2 { font-weight: 500; letter-spacing: -.045em; line-height: .98; }
.section .sub { font-size: 20px; color: rgba(255,255,255,.82); margin-top: -6px; }
.crumbs { display: flex; align-items: center; height: 34px; padding: 0 6px; border-radius: 999px; background: rgba(0,0,0,.82); box-shadow: inset 0 0 0 1px var(--pill-line); font-size: 12px; line-height: 1; }
.crumbs span { padding: 0 14px; color: var(--muted); white-space: nowrap; }
.crumbs span + span { border-left: 1px solid rgba(255,255,255,.18); }
.crumbs span.on { color: var(--ink); font-weight: 500; }
.section .pill.tr { background: #000; }

/* statement: gradient type set from the top left */
.statement .say { left: 48px; right: 160px; top: 40px; font-weight: 500; letter-spacing: -.035em; line-height: 1.08; }
.statement .attr { left: 48px; bottom: 56px; font-size: 18px; color: var(--soft); }

/* text */
.text .lead { left: var(--m); top: 124px; width: 900px; display: flex; flex-direction: column; gap: 18px; }
.text .lead .h { font-size: 88px; letter-spacing: -.045em; line-height: .98; }
.text .copy { right: var(--m); bottom: 72px; width: 520px; font-size: 22px; line-height: 1.5; color: var(--soft); }

/* points */
.points .h, .framed .h, .timeline .h, .table .h { left: var(--m); top: 96px; right: 240px; font-size: 60px; }
.points .cards { left: var(--m); right: var(--m); top: 222px; bottom: 64px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
.card { display: flex; flex-direction: column; gap: 12px; min-height: 0; }
.card .tile { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; padding: 26px; font-size: 21px; line-height: 1.35; font-weight: 500; letter-spacing: -.01em; }
.card .t-orange, .card .t-amber, .card .t-cream { color: var(--dark); }

/* image-text and quote: tall portrait tile on the left */
.portrait { left: 200px; top: 44px; width: 480px; height: 632px; }
.side { left: 760px; right: 64px; top: 0; bottom: 0; display: flex; flex-direction: column; justify-content: center; gap: 22px; }
.side .h { font-size: 54px; }
.side p { font-size: 19px; color: var(--soft); line-height: 1.5; }
.meta { display: flex; align-items: center; gap: 12px; font-size: 12px; color: var(--soft); }
.meta i { width: 44px; border-top: 1px solid rgba(255,255,255,.35); }
.meta span + i + span { color: var(--muted); }
.side blockquote { font-weight: 500; letter-spacing: -.025em; line-height: 1.16; }

/* metrics */
.metrics .wrap { left: 0; right: 0; top: 0; bottom: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.metrics .inner { display: flex; flex-direction: column; gap: 52px; }
.metrics .h { font-size: 34px; color: var(--soft); }
.nums { display: grid; grid-template-columns: repeat(var(--n), 248px); }
.num { display: flex; flex-direction: column; padding-right: 28px; }
.num b { font-size: 92px; font-weight: 500; letter-spacing: -.04em; line-height: 1; font-variant-numeric: tabular-nums; padding-bottom: 22px; border-bottom: 1px solid var(--hair); }
.num > span { padding-top: 18px; font-size: 15px; color: var(--soft); line-height: 1.4; max-width: 170px; }

/* two-column: logo-variant tiles */
.pair .left { left: var(--m); top: 124px; width: 300px; display: flex; flex-direction: column; gap: 14px; }
.pair .left .h { font-size: 46px; }
.pair .tiles { left: 404px; right: var(--m); top: 124px; bottom: 72px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.pair .tile { display: flex; flex-direction: column; padding: 30px; }
.pair .tile h3 { margin: auto 0; text-align: center; font-size: 46px; font-weight: 500; letter-spacing: -.04em; line-height: 1; }
.pair .tile p { font-size: 18px; line-height: 1.45; }
.pair .t-blue { color: #fff; } .pair .t-blue p { color: rgba(255,255,255,.82); }
.pair .t-cream { color: var(--dark); } .pair .t-cream p { color: #3d3d42; }

/* timeline */
.steps { left: var(--m); right: var(--m); top: 330px; display: grid; grid-template-columns: repeat(var(--n), 1fr); }
.st { display: flex; flex-direction: column; padding-right: 28px; }
.st .when { font-size: 64px; font-weight: 500; letter-spacing: -.04em; line-height: 1; padding-bottom: 24px; }
.st .line { position: relative; border-top: 1px solid var(--hair); margin-right: -28px; }
.st .line::before { content: ""; position: absolute; left: 0; top: -4px; width: 7px; height: 7px; border-radius: 50%; background: var(--ink); }
.st:last-child .line { margin-right: 0; }
.st b { padding-top: 22px; font-size: 22px; font-weight: 500; letter-spacing: -.015em; }
.st span { padding-top: 6px; font-size: 15px; color: var(--muted); }

/* table */
.table table { left: var(--m); right: var(--m); width: calc(100% - 2 * var(--m)); top: 250px; border-collapse: collapse; }
.table th { font-size: 13px; font-weight: 400; color: var(--muted); text-align: right; padding: 0 0 16px; }
.table th + th, .table td + td { padding-left: 24px; }
.table th:first-child { width: 34%; }
.table td { border-top: 1px solid var(--hair); padding: 20px 0 22px; font-size: 22px; color: var(--soft); text-align: right; letter-spacing: -.01em; font-variant-numeric: tabular-nums; }
.table th:first-child, .table td:first-child { text-align: left; }
.table td:first-child { color: var(--ink); font-weight: 500; }

/* big number */
.big .n { left: 60px; top: 0; bottom: 0; display: flex; align-items: center; font-size: 360px; font-weight: 500; letter-spacing: -.06em; line-height: 1; padding-right: 30px; }
.big .what { left: 700px; right: 80px; top: 0; bottom: 0; display: flex; flex-direction: column; justify-content: center; gap: 20px; }
.big .h { font-size: 52px; }
.big p { font-size: 20px; color: var(--soft); line-height: 1.5; }

/* bullets */
.bullets .h { left: var(--m); top: 124px; width: 420px; font-size: 64px; }
.bullets .rows { left: 520px; right: var(--m); top: 128px; list-style: none; }
.bullets li { display: flex; gap: 40px; align-items: baseline; border-top: 1px solid var(--hair); padding: 22px 0 30px; }
.bullets .no { flex: none; width: 52px; font-size: 16px; font-weight: 500; font-variant-numeric: tabular-nums; color: var(--muted); }
.bullets .it { font-size: 24px; font-weight: 500; letter-spacing: -.02em; line-height: 1.25; }

/* team: portrait tiles with numbered labels */
.team .people { left: var(--m); right: var(--m); top: 96px; bottom: 64px; display: grid; grid-template-columns: repeat(var(--n), 1fr); gap: 16px; }
.person { display: flex; flex-direction: column; gap: 10px; min-height: 0; }
.person .tile { flex: 1; min-height: 0; width: 100%; }
.person .role { font-size: 14px; color: var(--muted); line-height: 1.2; }

/* image */
.image .media { left: var(--m); right: var(--m); top: 92px; bottom: 68px; width: calc(100% - 2 * var(--m)); height: calc(100% - 160px); }
.image .cap { left: var(--m); bottom: 30px; font-size: 14px; color: var(--soft); }

/* frame */
.framed .avn-body { position: absolute; left: var(--m); right: var(--m); top: 186px; bottom: 60px; }

/* closing */
.closing .glow { left: 0; right: 0; bottom: 0; height: 100%; background: radial-gradient(75% 62% at 50% 112%, rgba(242,196,168,.75) 0%, rgba(139,99,240,.62) 30%, rgba(74,51,120,.32) 56%, transparent 80%); }
.closing .body { left: 80px; right: 80px; top: 0; bottom: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 26px; text-align: center; }
.closing h2 { font-weight: 500; letter-spacing: -.055em; line-height: .92; }
.closing .pill { position: static; }
.closing .contact { font-size: 20px; color: var(--soft); }
`
}

export const slides = {
  cover: (d, ctx) => {
    const size = fit(d.title, { width: 1080, lines: d.title.length > 14 ? 2 : 1, max: 210, min: 84, em: 0.58 })
    return `<section class="slide cover"><div class="glow"></div><div class="band t-orange"></div>
    ${chrome(ctx, { pill: ctx.deck.date ?? '', foot: false })}
    <div class="body">${d.eyebrow ? `<span class="eyebrow">${ctx.esc(d.eyebrow)}</span>` : ''}<h1 style="font-size:${size}px">${ctx.esc(d.title)}</h1>
    ${d.subtitle ? `<p class="sub">${ctx.esc(d.subtitle)}</p>` : ''}</div></section>`
  },

  agenda: (d, ctx) => {
    const h = Math.min(98, Math.floor(486 / d.items.length))
    return `<section class="slide index">${chrome(ctx, { pill: d.title })}
    <ol class="rows">${d.items.map((item, i) => `<li style="height:${h}px"><span class="no">${String(i + 1).padStart(3, '0')}</span><span class="it">${ctx.esc(item)}</span></li>`).join('')}</ol></section>`
  },

  section: (d, ctx) => {
    const sections = ctx.deck.slides.map((s, i) => ({ s, i })).filter(({ s }) => s.kind === 'section')
    const crumbs = sections.length > 1
      ? `<nav class="crumbs">${sections.map(({ s, i }) => `<span class="${i === ctx.index - 1 ? 'on' : ''}">${ctx.esc(s.title)}</span>`).join('')}</nav>`
      : ''
    const size = fit(d.title, { width: 1100, lines: 2, max: 150, min: 72, em: 0.56 })
    return `<section class="slide section">${chrome(ctx, { pill: d.number })}
    <div class="body"><h2 style="font-size:${size}px">${ctx.esc(d.title)}</h2>${d.subtitle ? `<p class="sub">${ctx.esc(d.subtitle)}</p>` : ''}${crumbs}</div></section>`
  },

  statement: (d, ctx) => {
    const size = fit(d.text, { width: 1060, lines: 4, max: 86, min: 44, em: 0.52 })
    return `<section class="slide statement">${chrome(ctx, { brand: false, pill: '' })}
    <p class="say" style="font-size:${size}px">${gradText(d.text, ctx)}</p>
    ${d.attribution ? `<span class="attr">${ctx.esc(d.attribution)}</span>` : ''}</section>`
  },

  text: (d, ctx) => `<section class="slide text">${chrome(ctx)}
    <div class="lead">${d.eyebrow ? `<span class="lbl">${ctx.esc(d.eyebrow)}</span>` : ''}${title(d.title, ctx)}</div>
    <p class="copy">${ctx.esc(d.body)}</p></section>`,

  points: (d, ctx) => {
    const tiles = ['orange', 'sage', 'blue']
    return `<section class="slide points">${chrome(ctx)}${title(d.title, ctx)}
    <div class="cards">${d.items.map((item, i) => `<div class="card"><span class="lbl"><b>(${nn(i)})</b>${ctx.esc(item.title)}</span><div class="tile t-${tiles[i % 3]}">${ctx.esc(item.body)}</div></div>`).join('')}</div></section>`
  },

  'image-text': (d, ctx) => `<section class="slide image-text">${chrome(ctx)}${picture(d.image, ctx, 'portrait media', tileFor(ctx))}
    <div class="side">${title(d.title, ctx)}<p>${ctx.esc(d.body)}</p></div></section>`,

  metrics: (d, ctx) => `<section class="slide metrics">${chrome(ctx)}
    <div class="wrap"><div class="inner">${title(d.title, ctx)}<div class="nums" style="--n:${d.items.length}">${d.items.map((m, i) => `<div class="num"><b>${i === 2 ? gradText(m.value, ctx, { chars: true }) : ctx.esc(m.value)}</b><span>${ctx.esc(m.label)}</span></div>`).join('')}</div></div></div></section>`,

  'two-column': (d, ctx) => `<section class="slide pair">${chrome(ctx)}
    <div class="left">${title(d.title, ctx)}</div>
    <div class="tiles">${d.columns.map((c, i) => `<div class="tile ${i === 0 ? 't-blue' : 't-cream'}"><h3>${ctx.esc(c.title)}</h3><p>${ctx.esc(c.body)}</p></div>`).join('')}</div></section>`,

  timeline: (d, ctx) => `<section class="slide timeline">${chrome(ctx)}${title(d.title, ctx)}
    <div class="steps" style="--n:${d.steps.length}">${d.steps.map((s) => `<div class="st"><span class="when">${ctx.esc(s.when)}</span><i class="line"></i><b>${ctx.esc(s.title)}</b>${s.body ? `<span>${ctx.esc(s.body)}</span>` : ''}</div>`).join('')}</div></section>`,

  quote: (d, ctx) => {
    const size = fit(d.text, { width: 440, lines: 6, max: 46, min: 28, em: 0.5 })
    return `<section class="slide quote">${chrome(ctx)}<div class="portrait t-${tileFor(ctx)}" aria-hidden="true"></div>
    <div class="side"><div class="meta"><span>${ctx.esc(d.name)}</span>${d.role ? `<i></i><span>${ctx.esc(d.role)}</span>` : ''}</div>
    <blockquote style="font-size:${size}px">“${ctx.esc(d.text)}”</blockquote></div></section>`
  },

  table: (d, ctx) => `<section class="slide table">${chrome(ctx)}${title(d.title, ctx)}
    <table><thead><tr>${d.columns.map((c) => `<th>${ctx.esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${d.rows.map((r) => `<tr>${r.map((c) => `<td>${ctx.esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></section>`,

  'big-number': (d, ctx) => {
    const size = fit(d.value, { width: 600, lines: 1, max: 360, min: 140, em: 0.62 })
    return `<section class="slide big">${chrome(ctx)}<b class="n" style="font-size:${size}px">${gradText(d.value, ctx, { chars: true })}</b>
    <div class="what">${title(d.label, ctx)}${d.body ? `<p>${ctx.esc(d.body)}</p>` : ''}</div></section>`
  },

  bullets: (d, ctx) => `<section class="slide bullets">${chrome(ctx)}${title(d.title, ctx)}
    <ol class="rows">${d.items.map((item, i) => `<li><span class="no">${String(i + 1).padStart(3, '0')}</span><span class="it">${ctx.esc(item)}</span></li>`).join('')}</ol></section>`,

  team: (d, ctx) => `<section class="slide team">${chrome(ctx, { pill: d.title })}
    <div class="people" style="--n:${d.people.length}">${d.people.map((p, i) => `<div class="person"><span class="lbl"><b>(${nn(i)})</b>${ctx.esc(p.name)}</span>${picture(p.image, ctx, 'tile', TILES[i % TILES.length])}<span class="role">${ctx.esc(p.role)}</span></div>`).join('')}</div></section>`,

  image: (d, ctx) => `<section class="slide image">${chrome(ctx, { foot: false })}${picture(d.image, ctx, 'media', tileFor(ctx))}
    ${d.caption ? `<span class="cap">${ctx.esc(d.caption)}</span>` : ''}</section>`,

  /** The titled content slide that `chart` and `custom` slides are drawn in. */
  frame: ({ title: t, eyebrow }, ctx, body) => `<section class="slide framed">${chrome(ctx, eyebrow ? { pill: eyebrow } : {})}${t ? title(t, ctx) : ''}${body}</section>`,

  closing: (d, ctx) => {
    const size = fit(d.title, { width: 1100, lines: 2, max: 190, min: 80, em: 0.58 })
    return `<section class="slide closing"><div class="glow"></div>${chrome(ctx, { pill: '' })}
    <div class="body">${d.subtitle ? `<span class="pill">${ctx.esc(d.subtitle)}</span>` : ''}<h2 style="font-size:${size}px">${ctx.esc(d.title)}</h2>
    ${d.contact ? `<span class="contact">${ctx.esc(d.contact)}</span>` : ''}</div></section>`
  },
}
