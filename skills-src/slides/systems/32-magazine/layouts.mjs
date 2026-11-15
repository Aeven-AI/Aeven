/**
 * Magazine: strict black and white editorial pages. Enormous condensed caps headlines sit on the
 * slide edges (top-left, bottom-left, split left|right or bottom-right), hairline grids divide the
 * page into a narrow side column and ruled content cells, circled letters and numerals index the
 * entries, and photo blocks are high-contrast grey fields. Section, two-column, quote and closing
 * slides turn black, like the source's About Me and Institution pages.
 * Recreated from DuoZhuaMiao's "No.134 Magazine Style Black and White Large Headline Slides"
 * (Figma Community), measured from its 12-frame collage.
 */

/** Anton advance widths in em, measured from the font's hmtx table. */
const ADV = {
  A: 0.485, B: 0.479, C: 0.474, D: 0.493, E: 0.412, F: 0.399, G: 0.485, H: 0.499, I: 0.227, J: 0.466, K: 0.472,
  L: 0.397, M: 0.746, N: 0.498, O: 0.486, P: 0.472, Q: 0.494, R: 0.477, S: 0.461, T: 0.396, U: 0.474, V: 0.469,
  W: 0.712, X: 0.484, Y: 0.446, Z: 0.41, 1: 0.331, ' ': 0.234, '%': 1.057, '×': 0.347, '.': 0.229, ',': 0.236,
  "'": 0.214, '’': 0.214, '-': 0.311, ':': 0.229, '!': 0.25, '?': 0.45,
}
const advance = (c) => ADV[c] ?? (/[0-9]/.test(c) ? 0.494 : c.codePointAt(0) > 0x2e80 ? 1 : 0.5)
const emWidth = (word) => [...word].reduce((w, c) => w + advance(c), 0)

/**
 * The largest headline size (px, even) at which `text` in Anton caps wraps into at most `lines`
 * lines of `w` px and, when `h` is given, stays within `h` px at line-height `lh`.
 */
function fit(text, { w, max, min = 28, lines = 1, h = Infinity, lh = 0.9 }) {
  const words = String(text).toUpperCase().split(/\s+/).filter(Boolean)
  for (let size = max; size > min; size -= 2) {
    const limit = (w * 0.96) / size
    let count = 1
    let line = 0
    for (const word of words) {
      const ww = emWidth(word)
      if (ww > limit) { count = Infinity; break }
      if (line && line + ADV[' '] + ww > limit) { count += 1; line = ww } else line += (line ? ADV[' '] : 0) + ww
    }
    if (count <= lines && count * size * lh <= h) return size
  }
  return min
}

const pad = (n) => String(n).padStart(2, '0')

/** A headline in Anton caps at a fitted size. */
const hl = (text, size, ctx, tag = 'h2', cls = '') => `<${tag} class="hl ${cls}" style="font-size:${size}px">${ctx.esc(text)}</${tag}>`

/** The running head the source sets on its top row: page number, deck title, page count. */
const folio = (ctx, cls = '') => `<div class="folio ${cls}"><span>${pad(ctx.index)}</span><span>${ctx.esc(ctx.deck.title)}</span><span>${pad(ctx.total)}</span></div>`

/** A thin circle holding one index letter or numeral. */
const ring = (mark, ctx, cls = '') => `<span class="ring ${cls}">${ctx.esc(mark)}</span>`

const label = (text, ctx, cls = '') => `<span class="label ${cls}">${ctx.esc(text)}</span>`

/** The first letter of a word, for ring marks. */
const initial = (text) => [...String(text ?? '').trim()][0]?.toUpperCase() ?? 'A'

/** A user picture, or a grey photo block (tone a light, b dark, c mid, d split) when the slot has none. */
function photo(image, ctx, cls = '', tone = 'a') {
  const src = image && ctx.image(image)
  return src
    ? `<img class="photo ${cls}" src="${ctx.esc(src)}" alt="${ctx.esc(image.alt ?? '')}">`
    : `<div class="photo ph ph-${tone} ${cls}" role="img" aria-label="${ctx.esc(image?.alt ?? '')}"></div>`
}

/** A label/value row on a hairline, as on the cover's credits and the skills lists. */
const row = (k, v, ctx) => `<div class="kv"><span>${ctx.esc(k)}</span><span>${ctx.esc(v)}</span></div>`

/** A title split into its leading words (left) and last word (right), as VOLUNTEER … WORK sets it. */
function split(title, ctx, max = 120) {
  const words = String(title).trim().split(/\s+/)
  if (words.length < 2) return `<div class="split-head">${hl(title, fit(title, { w: 1216, max }), ctx)}</div>`
  const left = words.slice(0, -1).join(' ')
  const right = words.at(-1)
  const size = Math.min(fit(left, { w: 800, max }), fit(right, { w: 480, max }))
  return `<div class="split-head">${hl(left, size, ctx)}${hl(right, size, ctx, 'span', 'right')}</div>`
}

export function css(system) {
  const { surface, ink, rule, geometry } = system
  return `
:root { --paper: ${surface.paper}; --night: ${surface.night}; --ink: ${ink.primary}; --head: ${ink.headline}; --muted: ${ink.muted};
  --on-night: ${ink.onNight}; --muted-night: ${ink.mutedOnNight}; --rule: ${rule.paper}; --ring: ${rule.ring}; --rule-night: ${rule.night};
  --ph-1: ${surface.photo[0]}; --ph-2: ${surface.photo[1]}; --ph-3: ${surface.photo[2]}; --m: ${geometry.margin}px; --side: ${geometry.sideColumn}px; }
.slide { background: var(--paper); color: var(--ink); padding: var(--m); display: flex; flex-direction: column; font-size: 18px; line-height: 1.45; }
.slide.night { background: var(--night); color: var(--on-night); --head: var(--on-night); --muted: var(--muted-night); --rule: var(--rule-night); --ring: var(--rule-night); }
.hl { font-family: var(--display-font); font-weight: 400; text-transform: uppercase; line-height: .9; letter-spacing: 0; color: var(--head); text-wrap: balance; }
.label { font-size: 11px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); line-height: 1.3; }
.muted { color: var(--muted); }
.folio { flex: none; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; font-size: 12px; font-weight: 500; letter-spacing: .04em; color: var(--muted); padding-bottom: 10px; border-bottom: 1px solid var(--rule); }
.folio span:nth-child(2) { text-align: center; } .folio span:last-child { text-align: right; }
.ring { flex: none; display: inline-grid; place-items: center; width: 58px; height: 58px; border: 1px solid var(--ring); border-radius: 50%; font-family: var(--display-font); font-size: 27px; line-height: 1; color: var(--head); }
.ring.s { width: 46px; height: 46px; font-size: 21px; }
.kv { display: flex; justify-content: space-between; gap: 18px; padding: 9px 0; border-bottom: 1px solid var(--rule); font-size: 13px; }
.kv span:first-child { color: var(--muted); } .kv span:last-child { font-weight: 600; text-align: right; }

.photo { display: block; width: 100%; height: 100%; object-fit: cover; filter: grayscale(1) contrast(1.08); }
.ph { position: relative; overflow: hidden; filter: none; }
.ph::after { content: ""; position: absolute; }
.ph-a { background: linear-gradient(165deg, #EFEFEF 0%, var(--ph-1) 55%, #B5B5B5 100%); }
.ph-a::after { right: 14%; bottom: -12%; width: 38%; height: 82%; border-radius: 48% 48% 0 0; background: linear-gradient(180deg, #3A3A3A, #151515); }
.ph-b { background: linear-gradient(180deg, #3A3A3A 0%, var(--ph-3) 50%, #121212 100%); }
.ph-b::after { inset: 0; background: linear-gradient(104deg, transparent 0 40%, #6B6B6B 40%, #CFCFCF 47%, #8A8A8A 54%, transparent 54%); }
.ph-c { background: linear-gradient(200deg, #B8B8B8 0%, var(--ph-2) 50%, #5E5E5E 100%); }
.ph-c::after { left: 22%; bottom: -16%; width: 46%; height: 72%; border-radius: 50% 50% 0 0; background: linear-gradient(180deg, #E9E9E9, #BDBDBD); }
.ph-d { background: linear-gradient(115deg, #E4E4E4 0 46%, #161616 46% 100%); }
.ph-d::after { left: 30%; top: 22%; width: 34%; height: 90%; border-radius: 50% 50% 0 0; background: linear-gradient(180deg, #8F8F8F, #3B3B3B); }

/* cover */
.cover .grid { flex: 1; display: grid; grid-template-columns: 1fr 340px 300px; grid-template-rows: auto minmax(0, 1fr); min-height: 0; column-gap: 32px; padding-top: 22px; }
.cover h1 { grid-column: 1 / 4; align-self: start; }
.cover .shot { align-self: stretch; height: auto; margin-top: 26px; min-height: 160px; }
.cover .under { display: flex; gap: 22px; align-items: flex-end; padding-top: 26px; }
.cover .vert { writing-mode: vertical-rl; font-family: var(--display-font); font-size: 17px; letter-spacing: .16em; text-transform: uppercase; line-height: 1; color: var(--head); }
.cover .sub { max-width: 560px; font-size: 28px; font-weight: 600; line-height: 1.22; letter-spacing: -.01em; }
.cover .credits, .closing .credits { display: flex; flex-direction: column; justify-content: flex-end; padding-top: 26px; }
.credits .by { font-size: 14px; font-weight: 600; line-height: 1.5; margin-bottom: 14px; }
.credits .kv:first-of-type { border-top: 1px solid var(--rule); }

/* agenda */
.agenda .items { display: grid; grid-template-columns: repeat(var(--c), 1fr); column-gap: 36px; }
.agenda .item { display: grid; grid-template-columns: 64px 1fr; align-items: baseline; padding: 14px 0; border-bottom: 1px solid var(--rule); }
.agenda .item span:first-child { font-size: 13px; font-weight: 600; color: var(--muted); font-variant-numeric: tabular-nums; }
.agenda .item span:last-child { font-size: 20px; font-weight: 500; text-align: right; }
.agenda h2 { text-align: center; margin: 34px 0 26px; }
.agenda .band { flex: 1; min-height: 160px; }

/* section */
.section .top { display: grid; grid-template-columns: 560px 1fr 1fr; gap: 48px; }
.section .shot { height: 300px; }
.section .note { display: flex; flex-direction: column; gap: 12px; }
.section .note p { font-size: 18px; font-weight: 600; line-height: 1.35; }
.section .note .small { font-size: 14px; font-weight: 400; color: var(--muted); }
.section .foot { margin-top: auto; display: flex; justify-content: space-between; align-items: flex-end; gap: 40px; }

/* statement */
.statement .lead-row { display: flex; align-items: center; gap: 16px; padding-top: 18px; }
.statement h2 { margin-top: auto; }

/* text */
.text h2 { margin: 2px 0 26px; }
.sheet { flex: 1; display: grid; grid-template-columns: var(--side) 1fr; border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule); }
.sheet > .side { display: flex; flex-direction: column; gap: 16px; padding: 22px 24px 22px 0; border-right: 1px solid var(--rule); }
.sheet > .main { padding: 22px 0 22px 32px; display: flex; flex-direction: column; }
.sheet .lead { font-size: 30px; font-weight: 500; line-height: 1.3; letter-spacing: -.01em; max-width: 780px; margin-top: auto; }
.sheet .eyebrow { display: flex; align-items: center; gap: 16px; }

/* points */
.points .head-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 32px; margin-bottom: 26px; }
.cells { flex: 1; display: grid; grid-template-columns: repeat(var(--n), 1fr); grid-template-rows: auto auto 1fr; border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule); }
.cells > div { padding: 18px 22px; border-left: 1px solid var(--rule); border-bottom: 1px solid var(--rule); }
.cells > div:nth-child(-n + 3) { display: flex; justify-content: space-between; align-items: center; }
.cells > div:nth-child(3n + 1) { border-left: 0; padding-left: 0; }
.cells > div:nth-last-child(-n + 3) { border-bottom: 0; }
.cells .t { font-family: var(--display-font); font-size: 34px; line-height: 1.05; text-transform: uppercase; color: var(--head); }
.cells p { font-size: 18px; line-height: 1.45; }

/* image-text */
.image-text { flex-direction: row; gap: 40px; }
.image-text .left { width: 440px; flex: none; display: flex; flex-direction: column; gap: 18px; }
.image-text .left .photo { flex: 1; min-height: 0; }
.image-text .right { flex: 1; display: flex; flex-direction: column; }
.image-text .fig { margin-top: auto; display: flex; align-items: center; gap: 16px; padding-bottom: 18px; border-bottom: 1px solid var(--rule); }
.image-text .lead { padding: 22px 0 6px; font-size: 34px; font-weight: 500; line-height: 1.3; letter-spacing: -.01em; }

/* split headline */
.split-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 40px; }
.split-head .right { display: block; text-align: right; }

/* metrics */
.metrics .figs { margin-top: auto; display: grid; grid-template-columns: repeat(var(--n), 1fr); column-gap: 24px; }
.metrics .fig { display: flex; flex-direction: column; }
.metrics .fig .kv { font-size: 12px; }
.metrics .fig b { font-family: var(--display-font); font-weight: 400; line-height: .9; color: var(--head); padding: 30px 0 18px; font-variant-numeric: tabular-nums; }
.metrics .fig p { font-size: 17px; font-weight: 500; padding-top: 12px; border-top: 1px solid var(--ink); }

/* two-column */
.board { flex: 1; display: grid; grid-template-columns: 260px 1fr 1fr; grid-template-rows: auto 1fr auto; border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule); }
.board > * { border-left: 1px solid var(--rule); padding: 20px 26px; }
.board .meta { grid-row: 1 / 4; border-left: 0; padding-left: 0; display: flex; flex-direction: column; gap: 14px; }
.board .meta p { font-size: 14px; line-height: 1.45; }
.board .meta .small { margin-top: auto; }
.board .ct { display: flex; align-items: center; gap: 18px; border-bottom: 1px solid var(--rule); }
.board .ct h3 { font-family: var(--display-font); font-size: 40px; line-height: 1; text-transform: uppercase; color: var(--head); }
.board .cb p { font-size: 20px; line-height: 1.45; max-width: 400px; }
.board .bt { grid-column: 2 / 4; border-top: 1px solid var(--rule); text-align: right; padding: 18px 0 6px; }

/* timeline */
.timeline { flex-direction: row; gap: 40px; }
.timeline .left { width: 380px; flex: none; display: flex; flex-direction: column; }
.timeline .left .label { padding-bottom: 10px; border-bottom: 1px solid var(--rule); }
.timeline .left h2 { margin-top: auto; }
.timeline .right { flex: 1; display: flex; flex-direction: column; }
.timeline .steps { flex: 1; display: grid; grid-template-rows: repeat(var(--n), 1fr); }
.timeline .step { display: grid; grid-template-columns: 76px 210px 1fr; align-items: center; column-gap: 20px; border-bottom: 1px solid var(--rule); }
.timeline .when { font-family: var(--display-font); font-size: 36px; line-height: 1; text-transform: uppercase; color: var(--head); }
.timeline .step b { display: block; font-size: 15px; font-weight: 600; margin-top: 6px; }
.timeline .step p { font-size: 17px; line-height: 1.4; color: var(--muted); }

/* quote */
.quote h2 { margin: auto 0 30px; }
.quote .by { display: flex; align-items: center; gap: 18px; padding-top: 18px; border-top: 1px solid var(--rule); }
.quote .by b { font-family: var(--display-font); font-weight: 400; font-size: 30px; line-height: 1; text-transform: uppercase; }
.quote .by span:last-child { margin-left: auto; font-size: 14px; color: var(--muted); }

/* table */
.table h2 { margin: 2px 0 auto; }
table { width: 100%; border-collapse: collapse; margin-top: 30px; }
th { text-align: left; font-size: 11px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); padding: 0 16px 12px 0; border-bottom: 1px solid var(--ink); }
td { padding: 20px 16px 20px 0; border-bottom: 1px solid var(--rule); font-size: 20px; font-variant-numeric: tabular-nums; }
td:first-child { font-family: var(--display-font); font-size: 30px; line-height: 1; text-transform: uppercase; color: var(--head); width: 26%; }

/* big number */
.big .body { flex: 1; display: flex; align-items: flex-end; justify-content: space-between; gap: 40px; }
.big b { font-family: var(--display-font); font-weight: 400; line-height: .9; color: var(--head); margin-bottom: -6px; }
.big .what { width: 440px; flex: none; display: flex; flex-direction: column; gap: 18px; align-self: flex-start; padding-top: 36px; }
.big .what p { font-size: 20px; line-height: 1.45; padding-top: 16px; border-top: 1px solid var(--rule); }

/* bullets */
.bullets .head-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 32px; }
.bullets .head-row { margin-bottom: 26px; }
.bullets .list { display: grid; grid-template-rows: repeat(var(--n), 1fr); }
.bullets .list li { list-style: none; display: grid; grid-template-columns: 64px 1fr; align-items: center; border-bottom: 1px solid var(--rule); }
.bullets .list li:last-child { border-bottom: 0; }
.bullets .list li span:first-child { font-size: 13px; font-weight: 600; color: var(--muted); }
.bullets .list li span:last-child { font-size: 28px; font-weight: 500; line-height: 1.25; letter-spacing: -.01em; }
.bullets .sheet > .main { padding-top: 0; padding-bottom: 0; }

/* team */
.team .people { margin-top: auto; display: grid; grid-template-columns: repeat(var(--n), 1fr); column-gap: 22px; }
.team .person { display: flex; flex-direction: column; }
.team .person .kv:first-child { font-size: 12px; }
.team .person .name { padding: 10px 0; border-bottom: 1px solid var(--rule); font-size: 17px; font-weight: 600; margin-bottom: 18px; }
.team .person .photo { aspect-ratio: 1 / 1; height: auto; max-height: 420px; }

/* image */
.image .shot { flex: 1; min-height: 0; }
.image .cap { flex: none; display: flex; justify-content: space-between; align-items: baseline; gap: 32px; padding-top: 14px; }
.image .cap p { font-size: 17px; font-weight: 500; }

/* frame */
.framed .head-row { display: flex; justify-content: space-between; align-items: flex-end; gap: 32px; padding-bottom: 18px; border-bottom: 1px solid var(--rule); margin-bottom: 22px; }
.framed .head-row .label { padding-bottom: 6px; text-align: right; }

/* closing */
.closing .grid { flex: 1; display: grid; grid-template-columns: 1fr 360px; column-gap: 40px; align-content: space-between; padding-top: 22px; }
.closing h2 { grid-column: 1 / 3; }
.closing .sub { align-self: end; font-size: 28px; font-weight: 600; line-height: 1.22; }
`
}

const TONES = ['a', 'b', 'c', 'd']

export const slides = {
  cover: (d, ctx) => {
    const size = fit(d.title, { w: 1216, max: 330, lines: 2, h: 440 })
    return `<section class="slide cover">${folio(ctx)}<div class="grid">
      ${hl(d.title, size, ctx, 'h1')}
      <div class="under">${d.eyebrow ? `<span class="vert">${ctx.esc(d.eyebrow)}</span>` : ''}${d.subtitle ? `<p class="sub">${ctx.esc(d.subtitle)}</p>` : ''}</div>
      <div class="credits">${ctx.deck.presenter ? `<p class="by">Created by ${ctx.esc(ctx.deck.presenter)}</p>` : ''}
        ${ctx.deck.presenter ? row('Presenter', ctx.deck.presenter, ctx) : ''}${ctx.deck.date ? row('Date', ctx.deck.date, ctx) : ''}${row('Pages', pad(ctx.total), ctx)}</div>
      ${photo(undefined, ctx, 'shot', 'b')}
    </div></section>`
  },

  agenda: (d, ctx) => {
    const n = d.items.length
    const cols = n === 4 ? 2 : Math.min(n, 3)
    return `<section class="slide agenda"><div class="items" style="--c:${cols}">${d.items.map((item, i) => `<div class="item"><span>${pad(i + 1)}</span><span>${ctx.esc(item)}</span></div>`).join('')}</div>
      ${hl(d.title, fit(d.title, { w: 640, max: 132 }), ctx)}${photo(undefined, ctx, 'band', 'd')}</section>`
  },

  section: (d, ctx) => {
    const size = fit(d.title, { w: 1000, max: 132, lines: 1 })
    return `<section class="slide night section"><div class="top">${photo(undefined, ctx, 'shot', 'a')}
      <div class="note">${label(`Section ${d.number}`, ctx)}${d.subtitle ? `<p>${ctx.esc(d.subtitle)}</p>` : ''}</div>
      <div class="note">${label(ctx.deck.title, ctx)}${ctx.deck.presenter ? `<p class="small">${ctx.esc(ctx.deck.presenter)}</p>` : ''}${ctx.deck.date ? `<p class="small">${ctx.esc(ctx.deck.date)}</p>` : ''}</div></div>
      <div class="foot">${hl(d.title, size, ctx)}${hl(d.number, size, ctx, 'span')}</div></section>`
  },

  statement: (d, ctx) => `<section class="slide statement">${folio(ctx)}
    ${d.attribution ? `<div class="lead-row">${ring(initial(d.attribution), ctx, 's')}${label(d.attribution, ctx)}</div>` : ''}
    ${hl(d.text, fit(d.text, { w: 1216, max: 132, lines: 4, h: 500 }), ctx)}</section>`,

  text: (d, ctx) => `<section class="slide text">${hl(d.title, fit(d.title, { w: 960, max: 128, lines: 2, h: 240 }), ctx)}
    <div class="sheet"><div class="side"><div class="eyebrow">${ring(initial(d.eyebrow ?? d.title), ctx)}${d.eyebrow ? label(d.eyebrow, ctx) : ''}</div>
      <span class="label" style="margin-top:auto">${pad(ctx.index)} / ${pad(ctx.total)}</span></div>
    <div class="main"><p class="lead">${ctx.esc(d.body)}</p></div></div></section>`,

  points: (d, ctx) => `<section class="slide points"><div class="head-row">${hl(d.title, fit(d.title, { w: 1000, max: 128 }), ctx)}${label(`${pad(ctx.index)} / ${pad(ctx.total)}`, ctx)}</div>
    <div class="cells" style="--n:${d.items.length}">
      ${d.items.map((_, i) => `<div>${label(`Point`, ctx)}${ring(String(i + 1), ctx)}</div>`).join('')}
      ${d.items.map((it) => `<div><span class="t">${ctx.esc(it.title)}</span></div>`).join('')}
      ${d.items.map((it) => `<div><p>${ctx.esc(it.body)}</p></div>`).join('')}
    </div></section>`,

  'image-text': (d, ctx) => `<section class="slide image-text"><div class="left">${photo(d.image, ctx, '', 'c')}
    ${hl(d.title, fit(d.title, { w: 440, max: 104, lines: 2, h: 200 }), ctx)}</div>
    <div class="right">${folio(ctx)}<div class="fig">${ring(pad(ctx.index), ctx, 's')}${label(d.image?.alt ?? 'Figure', ctx)}</div>
    <p class="lead">${ctx.esc(d.body)}</p></div></section>`,

  metrics: (d, ctx) => {
    const n = d.items.length
    const colW = (1216 - (n - 1) * 24) / n
    const size = Math.min(...d.items.map((m) => fit(m.value, { w: colW, max: 170 })))
    return `<section class="slide metrics">${split(d.title, ctx)}
      <div class="figs" style="--n:${n}">${d.items.map((m, i) => `<div class="fig">${row('No.', pad(i + 1), ctx)}<b style="font-size:${size}px">${ctx.esc(m.value)}</b><p>${ctx.esc(m.label)}</p></div>`).join('')}</div></section>`
  },

  'two-column': (d, ctx) => `<section class="slide night two-col"><div class="board">
    <div class="meta">${label(`No. ${pad(ctx.index)}`, ctx)}<p>${ctx.esc(ctx.deck.title)}</p>${ctx.deck.date ? `<p class="small muted">${ctx.esc(ctx.deck.date)}</p>` : ''}</div>
    ${d.columns.map((c, i) => `<div class="ct">${ring(String.fromCharCode(65 + i), ctx)}<h3>${ctx.esc(c.title)}</h3></div>`).join('')}
    ${d.columns.map((c) => `<div class="cb"><p>${ctx.esc(c.body)}</p></div>`).join('')}
    <div class="bt">${hl(d.title, fit(d.title, { w: 900, max: 120 }), ctx)}</div></div></section>`,

  timeline: (d, ctx) => `<section class="slide timeline"><div class="left">${label(`${d.steps.length} steps`, ctx)}
    ${hl(d.title, fit(d.title, { w: 380, max: 120, lines: 3, h: 330 }), ctx)}</div>
    <div class="right">${folio(ctx)}<div class="steps" style="--n:${d.steps.length}">${d.steps.map((s, i) => `<div class="step">${ring(String(i + 1), ctx)}
      <div><span class="when">${ctx.esc(s.when)}</span><b>${ctx.esc(s.title)}</b></div><p>${ctx.esc(s.body ?? '')}</p></div>`).join('')}</div></div></section>`,

  quote: (d, ctx) => `<section class="slide night quote">${folio(ctx)}
    ${hl(`“${d.text}”`, fit(`“${d.text}”`, { w: 1216, max: 104, lines: 4, h: 420 }), ctx)}
    <div class="by">${ring(initial(d.name), ctx)}<b>${ctx.esc(d.name)}</b>${d.role ? `<span>${ctx.esc(d.role)}</span>` : ''}</div></section>`,

  table: (d, ctx) => `<section class="slide table">${hl(d.title, fit(d.title, { w: 1100, max: 128 }), ctx)}
    <table><thead><tr>${d.columns.map((c) => `<th>${ctx.esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${d.rows.map((r) => `<tr>${r.map((c) => `<td>${ctx.esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></section>`,

  'big-number': (d, ctx) => `<section class="slide big">${folio(ctx)}<div class="body">
    <b style="font-size:${fit(d.value, { w: 700, max: 470 })}px">${ctx.esc(d.value)}</b>
    <div class="what">${hl(d.label, fit(d.label, { w: 440, max: 92, lines: 2, h: 170 }), ctx)}${d.body ? `<p>${ctx.esc(d.body)}</p>` : ''}</div></div></section>`,

  bullets: (d, ctx) => `<section class="slide bullets"><div class="head-row">${hl(d.title, fit(d.title, { w: 1000, max: 128 }), ctx)}${ring(initial(d.title), ctx)}</div>
    <div class="sheet"><div class="side">${label(`${d.items.length} points`, ctx)}<span class="label" style="margin-top:auto">${pad(ctx.index)} / ${pad(ctx.total)}</span></div>
    <ul class="main list" style="--n:${d.items.length}">${d.items.map((item, i) => `<li><span>${pad(i + 1)}</span><span>${ctx.esc(item)}</span></li>`).join('')}</ul></div></section>`,

  team: (d, ctx) => `<section class="slide team">${split(d.title, ctx)}
    <div class="people" style="--n:${d.people.length}">${d.people.map((p, i) => `<div class="person">${row(p.role, pad(i + 1), ctx)}<span class="name">${ctx.esc(p.name)}</span>
      ${photo(p.image, ctx, '', TONES[i % TONES.length])}</div>`).join('')}</div></section>`,

  image: (d, ctx) => `<section class="slide image">${photo(d.image, ctx, 'shot', 'd')}
    <div class="cap"><p>${ctx.esc(d.caption ?? '')}</p>${label(`${pad(ctx.index)} / ${pad(ctx.total)}`, ctx)}</div></section>`,

  /** The titled content slide that `chart` and `custom` slides are drawn in. */
  frame: ({ title, eyebrow }, ctx, body) => `<section class="slide framed"><div class="head-row">${title ? hl(title, fit(title, { w: 960, max: 96 }), ctx) : '<span></span>'}
    ${label(eyebrow ?? `${pad(ctx.index)} / ${pad(ctx.total)}`, ctx)}</div>${body}</section>`,

  closing: (d, ctx) => `<section class="slide night closing">${folio(ctx)}<div class="grid">
    ${hl(d.title, fit(d.title, { w: 1216, max: 280, lines: 2, h: 400 }), ctx)}
    ${d.subtitle ? `<p class="sub">${ctx.esc(d.subtitle)}</p>` : '<span></span>'}
    <div class="credits">${d.contact ? row('Contact', d.contact, ctx) : ''}${ctx.deck.presenter ? row('Presenter', ctx.deck.presenter, ctx) : ''}${ctx.deck.date ? row('Date', ctx.deck.date, ctx) : ''}</div>
  </div></section>`,
}
