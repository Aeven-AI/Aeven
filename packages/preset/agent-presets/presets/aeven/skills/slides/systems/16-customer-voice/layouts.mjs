/**
 * Customer Voice: black report pages set in a clean white grotesque, a segmented pastel spectrum
 * bar along the foot (inset and rounded on cover-like slides, full-bleed on report pages), a thin
 * rainbow ring, pastel numbered process dots with bent corner arrows, coloured left rules on
 * insight rows, white table cards with striped rows, and a white side panel for key figures.
 * Measured from the 16 slides of Figma's "Voice of Customer Insights Report" (Figma Community).
 */
import { readFileSync } from 'node:fs'

const own = JSON.parse(readFileSync(new URL('system.json', import.meta.url), 'utf8'))

/** Spectrum entries without the leading grey, the order the process dots and rules use. */
const HUES = own.spectrum.filter((s) => s.name !== 'grey')
/** The process-dot order on the source's process slide: pink, peach, cyan, purple, then the rest. */
const DOTS = ['pink', 'peach', 'cyan', 'purple', 'blue', 'yellow', 'green', 'violet'].map((n) => HUES.find((h) => h.name === n))
/** The insight-row rule order on the data-sources slide: pink, peach, blue, purple. */
const RULES = ['pink', 'peach', 'blue', 'purple', 'cyan', 'yellow'].map((n) => HUES.find((h) => h.name === n))

const pick = (list, i) => list[((i % list.length) + list.length) % list.length]
const pad2 = (n) => String(n).padStart(2, '0')

/** The segmented spectrum bar: `inset` (rounded, cover slides) or `full` (flush with the foot). */
const bar = (kind) => `<div class="bar ${kind}" aria-hidden="true">${own.spectrum.map((s) => `<i style="flex:${s.units};background:${s.fill}"></i>`).join('')}</div>`

/** The thin rainbow ring from the goals slide. */
const ring = (inner = '') => `<div class="ring"><span class="ring-line" aria-hidden="true"></span>${inner}</div>`

/** A pastel process dot holding its step number in the deep shade of the same hue. */
const dot = (i) => {
  const h = pick(DOTS, i)
  return `<span class="dot" style="background:${h.fill};color:${h.deep}">${i + 1}</span>`
}

/** The two bent grey arrows in the corners of the process slide. */
const arrows = `<svg class="arrow tl" viewBox="0 0 100 56" aria-hidden="true"><path d="M2 54 V6 H92 M80 -6 L92 6 L80 18"/></svg>
<svg class="arrow br" viewBox="0 0 100 56" aria-hidden="true"><path d="M98 2 V50 H8 M20 38 L8 50 L20 62"/></svg>`

const eyebrow = (text, ctx, cls = '') => (text ? `<p class="eyebrow ${cls}">${ctx.esc(text)}</p>` : '')

/** Splits "48%" into the figure and its smaller trailing unit, as the stats slides set them. */
function figure(value, ctx) {
  const m = String(value).match(/^([^\d]*[\d.,]+)\s*(\D.*)?$/)
  if (!m || !m[2]) return `<b class="fig">${ctx.esc(value)}</b>`
  return `<b class="fig">${ctx.esc(m[1])}<small>${ctx.esc(m[2])}</small></b>`
}

/** A user picture, or the source's light checker tiles as the empty image slot. */
function picture(image, ctx, cls, tiles = 1) {
  const src = ctx.image(image)
  if (src) return `<img class="${cls}" src="${ctx.esc(src)}" alt="${ctx.esc(image.alt)}">`
  const label = `role="img" aria-label="${ctx.esc(image?.alt ?? '')}"`
  return tiles > 1
    ? `<div class="${cls} tiles" ${label}>${'<i class="check"></i>'.repeat(tiles)}</div>`
    : `<div class="${cls} check" ${label}></div>`
}

const initials = (name) => String(name).split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase()

export function css(system) {
  const { surface, ink, geometry: g, ring: ringStops } = system
  return `
:root { --page: ${surface.page}; --panel: ${surface.panel}; --stripe: ${surface.stripe}; --tile: ${surface.tile}; --check: ${surface.check}; --arrow-c: ${surface.arrow};
  --ink: ${ink.primary}; --muted: ${ink.muted}; --dim: ${ink.dim}; --label: ${ink.label}; --on-panel: ${ink.onPanel}; --thead: ${ink.tableHead};
  --m: ${g.margin}px; --inset: ${g.coverInset}px; --panel-w: ${g.panel}px; }
.slide { background: var(--page); color: var(--ink); padding: 64px var(--m) 60px; display: flex; flex-direction: column; font-size: 19px; line-height: 1.32; letter-spacing: -.003em; }
h1, h2, h3 { font-weight: 600; letter-spacing: -.022em; line-height: 1.12; }
.t-cover { font-size: 92px; line-height: 1.04; letter-spacing: -.03em; }
.t-title { font-size: 46px; }
.t-head { font-size: 44px; line-height: 1.16; }
.t-sub { font-size: 36px; }
.eyebrow { font-size: 18px; letter-spacing: .07em; text-transform: uppercase; color: var(--muted); line-height: 1.2; }
.eyebrow.dim { color: var(--dim); }
.lead { font-size: 19px; line-height: 1.32; color: var(--ink); }
.muted { color: var(--muted); }

.bar { position: absolute; display: flex; overflow: hidden; }
.bar i { display: block; height: 100%; }
.bar.inset { left: var(--inset); right: var(--inset); bottom: 28px; height: ${g.barInset}px; border-radius: 999px; }
.bar.full { left: 0; right: 0; bottom: 0; height: ${g.barFull}px; }

.ring { position: relative; width: ${g.ringRadius * 2}px; height: ${g.ringRadius * 2}px; flex: none; display: grid; place-items: center; }
.ring-line { position: absolute; inset: 0; border-radius: 50%; background: conic-gradient(${ringStops.join(', ')});
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2.5px)); mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2.5px)); }
.ring b { position: relative; font-size: 128px; font-weight: 600; letter-spacing: -.04em; line-height: 1; font-variant-numeric: tabular-nums; }

.dot { flex: none; width: ${g.dot}px; height: ${g.dot}px; border-radius: 50%; display: grid; place-items: center; font-size: 26px; font-weight: 500; line-height: 1; }
.arrow { position: absolute; width: 100px; height: 56px; overflow: visible; fill: none; stroke: var(--arrow-c); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
.arrow.tl { left: var(--m); top: 190px; }
.arrow.br { right: 66px; bottom: 102px; }

.pill { display: inline-flex; align-self: flex-start; align-items: center; height: 34px; padding: 0 18px; border-radius: 999px; background: var(--ink); color: var(--on-panel); font-size: 21px; font-weight: 600; letter-spacing: -.01em; white-space: nowrap; }
.pill.dark { background: var(--on-panel); color: var(--ink); }

.check { background-color: var(--tile); background-image: conic-gradient(var(--check) 25%, transparent 0 50%, var(--check) 0 75%, transparent 0); background-size: 30px 30px; }

/* cover, statement, closing: the inset spectrum bar under left-aligned type */
.cover, .closing { padding: 0 var(--inset); justify-content: center; }
.cover .eyebrow { margin-bottom: 26px; }
.cover .sub, .closing .sub { margin-top: 30px; max-width: 760px; font-size: 22px; line-height: 1.32; color: var(--muted); }
.cover .by { margin-top: 26px; display: flex; flex-direction: column; font-size: 18px; line-height: 1.3; color: var(--muted); }
.closing .pill { margin-top: 34px; }

/* agenda: report contents */
.agenda { display: grid; grid-template-columns: 611px 1fr; align-items: center; padding-bottom: 80px; }
.agenda .left { display: flex; flex-direction: column; gap: 18px; align-self: stretch; justify-content: center; position: relative; }
.agenda .preface { position: absolute; left: 0; bottom: 0; font-size: 13px; line-height: 1.4; color: var(--ink); }
.contents { list-style: none; display: flex; flex-direction: column; gap: 24px; }
.contents li { font-size: 28px; line-height: 1.28; font-weight: 400; letter-spacing: -.01em; }

/* section: the ring with the number, title to its right */
.section { flex-direction: row; align-items: center; gap: 0; padding: 0 0 40px 132px; }
.section .copy { margin-left: 160px; display: flex; flex-direction: column; gap: 22px; max-width: 470px; }
.section .copy h2 { font-size: 52px; line-height: 1.1; }

.statement { padding: 0 var(--inset) 40px; justify-content: center; gap: 28px; }
.statement p.big { font-size: 60px; font-weight: 600; letter-spacing: -.028em; line-height: 1.1; max-width: 980px; text-wrap: balance; }

/* text: eyebrow + title over a two-column page */
.text .head { display: flex; flex-direction: column; gap: 12px; max-width: 760px; }
.text .body { margin: auto 0 60px 599px; font-size: 26px; line-height: 1.36; letter-spacing: -.012em; max-width: 560px; }

/* insight rows with coloured left rules (data-sources slide) */
.rule-item { border-left: 2px solid; padding: 2px 0 4px 14px; display: flex; flex-direction: column; gap: 8px; }
.rule-item h3 { font-size: 21px; font-weight: 600; letter-spacing: -.01em; }
.rule-item p { font-size: 19px; line-height: 1.32; }
.points { display: grid; grid-template-columns: 545px 1fr; column-gap: 54px; padding-bottom: 74px; }
.points .grid { align-self: center; display: flex; flex-direction: column; gap: 40px; padding-top: 40px; }
.points .rule-item h3 { font-size: 26px; }
.points .rule-item p { font-size: 22px; }

.image-text { display: grid; grid-template-columns: 545px 1fr; column-gap: 54px; padding-top: 64px; padding-bottom: 74px; }
.image-text .left { display: flex; flex-direction: column; gap: 52px; }
.image-text .media { width: 100%; height: 100%; min-height: 0; border-radius: 9px; object-fit: cover; }
.media.tiles { display: grid; grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(3, 1fr); gap: 27px; }
.media.tiles i { display: block; border-radius: 9px; }

/* metrics: stats grid on the right */
.metrics .head { display: flex; flex-direction: column; gap: 14px; max-width: 560px; }
.stats { margin: auto 0 64px 560px; display: grid; grid-template-columns: repeat(var(--cols), 1fr); column-gap: 40px; row-gap: 46px; }
.stat { display: flex; flex-direction: column; gap: 4px; }
.fig { font-size: 92px; font-weight: 600; letter-spacing: -.035em; line-height: 1; font-variant-numeric: tabular-nums; white-space: nowrap; }
.fig small { font-size: 38px; font-weight: 600; letter-spacing: 0; margin-left: 8px; }
.stat span { font-size: 24px; letter-spacing: -.01em; }

/* two-column and team: the producers slide (column heading, copy, hairline, small caps label over name) */
.cols { margin-top: 60px; display: grid; grid-template-columns: repeat(var(--n), 1fr); column-gap: 27px; }
.col { display: flex; flex-direction: column; gap: 14px; padding-bottom: 32px; border-bottom: 1px solid #7D7D7D; }
.col h3 { font-size: 26px; letter-spacing: -.015em; }
.col p { font-size: 20px; line-height: 1.3; }
.two-column .cols { margin-top: auto; margin-bottom: 120px; column-gap: 54px; }
.two-column .col { gap: 18px; padding-bottom: 40px; }
.two-column .col h3 { font-size: 34px; }
.two-column .col p { font-size: 24px; line-height: 1.34; color: var(--muted); }

.timeline .steps { margin: 170px 0 0; display: grid; grid-template-columns: repeat(var(--n), 1fr); column-gap: 30px; }
.step { display: flex; flex-direction: column; gap: 0; }
.step .when { margin-top: 26px; font-size: 15px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.step h3 { margin-top: 8px; font-size: 28px; letter-spacing: -.015em; }
.step p { margin-top: 10px; font-size: 19px; line-height: 1.32; }

/* split: black page with the white figures panel on the right third */
.split { padding-right: calc(var(--panel-w) + var(--m)); }
.split .panel { position: absolute; top: 0; right: 0; bottom: 0; width: var(--panel-w); background: var(--panel); color: var(--on-panel); padding: 84px 52px 60px; display: flex; flex-direction: column; }
.panel .eyebrow { color: var(--on-panel); font-weight: 400; }
.quote { justify-content: center; }
.quote blockquote { font-size: 44px; font-weight: 600; letter-spacing: -.024em; line-height: 1.18; text-wrap: balance; }
.quote .panel { justify-content: center; gap: 12px; }
.quote .panel b { font-size: 40px; font-weight: 600; letter-spacing: -.025em; line-height: 1.1; }
.quote .panel span { font-size: 19px; }
.big-number { justify-content: center; gap: 24px; }
.big-number .panel { justify-content: center; }
.big-number .panel .fig { line-height: .95; letter-spacing: -.045em; }
.big-number .panel .fig small { font-size: .4em; }

.table h2 { margin-bottom: 40px; }
.card { background: var(--panel); color: var(--on-panel); border-radius: 7px; overflow: hidden; }
.card table { width: 100%; border-collapse: collapse; font-size: 19px; }
.card th { text-align: left; font-size: 13px; font-weight: 400; color: var(--thead); padding: 14px 20px; border-bottom: 1px solid #E4E4E4; }
.card td { padding: 22px 20px; font-variant-numeric: tabular-nums; }
.card tbody tr:nth-child(odd) td { background: var(--stripe); }
.card td:first-child { font-weight: 600; }

.bullets .list { list-style: none; margin: auto 0 70px 599px; display: flex; flex-direction: column; gap: 26px; }
.bullets li { display: flex; align-items: baseline; gap: 22px; font-size: 28px; line-height: 1.28; letter-spacing: -.01em; }
.bullets li i { flex: none; width: 16px; height: 16px; border-radius: 50%; transform: translateY(-2px); }

.team .cols { margin-top: 48px; }
.person { display: flex; flex-direction: column; gap: 4px; }
.avatar { width: 100%; aspect-ratio: 1; border-radius: 9px; object-fit: cover; margin-bottom: 22px; display: grid; place-items: center; }
.avatar b { font-size: 64px; font-weight: 600; letter-spacing: -.03em; color: rgba(0,0,0,.55); }
.person .role { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--label); }
.person .name { font-size: 20px; font-weight: 500; }

.image { padding: 0; }
.image .media { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.image .pill { position: absolute; left: var(--m); bottom: 52px; max-width: calc(100% - 2 * var(--m)); overflow: hidden; text-overflow: ellipsis; }

.framed .head { display: flex; flex-direction: column; gap: 12px; }
.framed .avn-body { margin-top: 36px; }
`
}

export const slides = {
  cover: (d, ctx) => `<section class="slide cover">${eyebrow(d.eyebrow, ctx)}<h1 class="t-cover">${ctx.esc(d.title)}</h1>
    ${d.subtitle ? `<p class="sub">${ctx.esc(d.subtitle)}</p>` : ''}
    ${ctx.deck.presenter || ctx.deck.date ? `<p class="by">${ctx.deck.presenter ? `<span>${ctx.esc(ctx.deck.presenter)}</span>` : ''}${ctx.deck.date ? `<span>${ctx.esc(ctx.deck.date)}</span>` : ''}</p>` : ''}
    ${bar('inset')}</section>`,

  agenda: (d, ctx) => `<section class="slide agenda"><div class="left"><h2 class="t-title">${ctx.esc(d.title)}</h2>
    ${ctx.deck.title ? `<p class="lead">${ctx.esc(ctx.deck.title)}</p>` : ''}
    ${ctx.deck.presenter || ctx.deck.date ? `<p class="preface">${[ctx.deck.presenter, ctx.deck.date].filter(Boolean).map((t) => ctx.esc(t)).join(',<br>')}</p>` : ''}</div>
    <ol class="contents">${d.items.map((item, i) => `<li>${pad2(i + 1)} ${ctx.esc(item)}</li>`).join('')}</ol>${bar('full')}</section>`,

  section: (d, ctx) => `<section class="slide section">${ring(`<b>${ctx.esc(d.number)}</b>`)}
    <div class="copy"><h2>${ctx.esc(d.title)}</h2>${d.subtitle ? `<p class="lead">${ctx.esc(d.subtitle)}</p>` : ''}</div>${bar('inset')}</section>`,

  statement: (d, ctx) => `<section class="slide statement">${eyebrow(d.attribution, ctx, 'dim')}<p class="big">${ctx.esc(d.text)}</p>${bar('inset')}</section>`,

  text: (d, ctx) => `<section class="slide text"><div class="head">${eyebrow(d.eyebrow, ctx)}<h2 class="t-title">${ctx.esc(d.title)}</h2></div>
    <p class="body">${ctx.esc(d.body)}</p>${bar('full')}</section>`,

  points: (d, ctx) => `<section class="slide points"><h2 class="t-title">${ctx.esc(d.title)}</h2>
    <div class="grid">${d.items.map((item, i) => `<div class="rule-item" style="border-color:${pick(RULES, i).fill}"><h3>${ctx.esc(item.title)}</h3><p>${ctx.esc(item.body)}</p></div>`).join('')}</div></section>`,

  'image-text': (d, ctx) => `<section class="slide image-text"><div class="left"><h2 class="t-head">${ctx.esc(d.title)}</h2>
    <div class="rule-item" style="border-color:${RULES[0].fill}"><p>${ctx.esc(d.body)}</p></div></div>${picture(d.image, ctx, 'media', 9)}</section>`,

  metrics: (d, ctx) => `<section class="slide metrics"><div class="head"><h2 class="t-title">${ctx.esc(d.title)}</h2></div>
    <div class="stats" style="--cols:${d.items.length === 4 ? 2 : Math.min(d.items.length, 3)}">${d.items.map((m) => `<div class="stat">${figure(m.value, ctx)}<span>${ctx.esc(m.label)}</span></div>`).join('')}</div>${bar('full')}</section>`,

  'two-column': (d, ctx) => `<section class="slide two-column"><h2 class="t-title">${ctx.esc(d.title)}</h2>
    <div class="cols" style="--n:${d.columns.length}">${d.columns.map((c) => `<div class="col"><h3>${ctx.esc(c.title)}</h3><p>${ctx.esc(c.body)}</p></div>`).join('')}</div>${bar('full')}</section>`,

  timeline: (d, ctx) => `<section class="slide timeline"><h2 class="t-title">${ctx.esc(d.title)}</h2>${arrows}
    <div class="steps" style="--n:${d.steps.length}">${d.steps.map((s, i) => `<div class="step">${dot(i)}<span class="when">${ctx.esc(s.when)}</span><h3>${ctx.esc(s.title)}</h3>${s.body ? `<p>${ctx.esc(s.body)}</p>` : ''}</div>`).join('')}</div></section>`,

  quote: (d, ctx) => `<section class="slide split quote"><blockquote>“${ctx.esc(d.text)}”</blockquote>
    <div class="panel"><b>${ctx.esc(d.name)}</b>${d.role ? `<span>${ctx.esc(d.role)}</span>` : ''}</div></section>`,

  table: (d, ctx) => `<section class="slide table"><h2 class="t-title">${ctx.esc(d.title)}</h2>
    <div class="card"><table><thead><tr>${d.columns.map((c) => `<th>${ctx.esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${d.rows.map((r) => `<tr>${r.map((c) => `<td>${ctx.esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`,

  'big-number': (d, ctx) => {
    const len = String(d.value).length
    const size = len <= 3 ? 220 : len <= 5 ? 150 : len <= 7 ? 108 : 80
    return `<section class="slide split big-number"><h2 class="t-head">${ctx.esc(d.label)}</h2>${d.body ? `<p class="lead">${ctx.esc(d.body)}</p>` : ''}
    <div class="panel"><div style="font-size:${size}px">${figure(d.value, ctx).replace('class="fig"', 'class="fig" style="font-size:1em"')}</div></div></section>`
  },

  bullets: (d, ctx) => `<section class="slide bullets"><h2 class="t-title">${ctx.esc(d.title)}</h2>
    <ul class="list">${d.items.map((item, i) => `<li><i style="background:${pick(DOTS, i).fill}"></i><span>${ctx.esc(item)}</span></li>`).join('')}</ul>${bar('full')}</section>`,

  team: (d, ctx) => `<section class="slide team"><h2 class="t-title">${ctx.esc(d.title)}</h2>
    <div class="cols" style="--n:${d.people.length}">${d.people.map((p, i) => {
      const src = p.image && ctx.image(p.image)
      const face = src
        ? `<img class="avatar" src="${ctx.esc(src)}" alt="${ctx.esc(p.name)}">`
        : `<div class="avatar" style="background:${pick(DOTS, i).fill}"><b>${ctx.esc(initials(p.name))}</b></div>`
      return `<div class="person">${face}<span class="role">${ctx.esc(p.role)}</span><span class="name">${ctx.esc(p.name)}</span></div>`
    }).join('')}</div>${bar('full')}</section>`,

  image: (d, ctx) => `<section class="slide image">${picture(d.image, ctx, 'media')}${d.caption ? `<span class="pill dark">${ctx.esc(d.caption)}</span>` : ''}</section>`,

  /** The titled content slide that `chart` and `custom` slides are drawn in. */
  frame: ({ title, eyebrow: kicker }, ctx, body) => `<section class="slide framed"><div class="head">${eyebrow(kicker, ctx)}${title ? `<h2 class="t-title">${ctx.esc(title)}</h2>` : ''}</div>${body}${bar('full')}</section>`,

  closing: (d, ctx) => `<section class="slide closing"><h2 class="t-cover">${ctx.esc(d.title)}</h2>
    ${d.subtitle ? `<p class="sub">${ctx.esc(d.subtitle)}</p>` : ''}${d.contact ? `<span class="pill">${ctx.esc(d.contact)}</span>` : ''}${bar('inset')}</section>`,
}
