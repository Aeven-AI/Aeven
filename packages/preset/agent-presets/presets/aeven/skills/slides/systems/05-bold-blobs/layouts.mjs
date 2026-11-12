/**
 * Bold Blobs: flat periwinkle, yellow, green, pink and black fields, heavy rounded condensed caps
 * titles with bold rounded arrows, butted rounded colour tiles that bleed off the slide edges, a
 * 3D bubble-blob picture panel, a light letter-spaced serif for body copy, small caps corner
 * meta on the cover and a centred company/date pair in the footer.
 * Measured from the 16 frames of Figma's "Bold Blobs" Slides template (Figma Community); the
 * blob art is drawn here as SVG shapes, not taken from the source photograph.
 *
 * Colour rhythm: every kind has a list of fields, and the nth slide of a kind in a deck takes the
 * nth entry, so repeated kinds (sections) keep rotating colour.
 */

/** Fields per kind, in the order repeated slides of that kind take them. */
const FIELDS = {
  cover: ['periwinkle', 'yellow'],
  agenda: ['paper'],
  section: ['yellow', 'green', 'periwinkle', 'pink'],
  statement: ['green', 'pink', 'yellow'],
  text: ['paper'],
  points: ['paper'],
  'image-text': ['periwinkle', 'paper'],
  metrics: ['black', 'tan'],
  'two-column': ['paper'],
  timeline: ['paper'],
  quote: ['pink', 'green'],
  table: ['paper'],
  'big-number': ['yellow', 'green'],
  bullets: ['paper'],
  team: ['paper'],
  image: ['green', 'periwinkle'],
  closing: ['periwinkle', 'yellow'],
  frame: ['paper'],
}

/** Tile colours in the order the source's six-insight and metric grids show them. */
const TILES = ['pink', 'yellow', 'green', 'green', 'tan', 'periwinkle']
const METRIC_TILES = ['paper', 'yellow', 'green', 'pink', 'periwinkle']
const DISCS = ['yellow', 'periwinkle', 'green', 'pink']

/** The field for this slide: the nth entry of its kind's list, n = earlier slides of the kind. */
function field(kind, ctx) {
  const n = ctx.deck.slides.slice(0, ctx.index - 1).filter((s) => s.kind === kind).length
  const list = FIELDS[kind]
  return list[n % list.length]
}

/**
 * A font size that keeps `text` within `lines` lines of `width` px, assuming an average advance
 * of `em` × size per character, clamped to [min, max].
 */
function fit(text, { width, lines, max, min, em = 0.53 }) {
  const str = String(text)
  const byLines = ((width * lines) / (Math.max(str.length, 1) * em)) * 0.86
  const word = Math.max(1, ...str.split(/\s+/).map((w) => w.length))
  const byWord = width / (word * em * 1.15)
  return Math.round(Math.max(min, Math.min(max, byLines, byWord)))
}

/** A bold rounded arrow pointing `dir` (right, down, up), sized by the surrounding font. */
const ROTATE = { right: 0, down: 90, up: -90 }
const arrow = (dir, cls = '') => `<svg class="arw ${cls}" viewBox="0 0 40 40" aria-hidden="true"><path transform="rotate(${ROTATE[dir]} 20 20)" d="M5 20H33M22 8.5L33.5 20L22 31.5" fill="none" stroke="currentColor" stroke-width="7.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`

let blobId = 0
/** Spheres of the blob art as [cx, cy, r] in a 1000×400 field. */
const SPHERES = [
  [520, 220, 132], [318, 150, 70], [706, 118, 60], [752, 282, 50], [246, 292, 40], [410, 322, 30],
  [640, 340, 26], [864, 178, 26], [176, 178, 20], [296, 56, 18], [566, 52, 22], [904, 316, 16],
  [116, 318, 14], [452, 84, 12], [820, 66, 11],
]
const SPECKS = [[90, 60], [150, 240], [210, 110], [380, 380], [470, 30], [610, 180], [690, 380], [780, 210], [930, 90], [960, 250], [60, 370], [340, 250], [880, 380], [40, 150]]

/** The bubble-blob picture: neutral 3D spheres on a pale lilac field, drawn as SVG shapes. */
function blobArt() {
  const id = `bb${++blobId}`
  const spheres = SPHERES.map(([cx, cy, r]) => `<ellipse cx="${cx - r * 0.28}" cy="${cy + r * 0.32}" rx="${r * 1.04}" ry="${r * 0.98}" fill="#8F8CAE" opacity=".42" filter="url(#${id}s)"/>`
    + `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${id}b)"/>`).join('')
  const specks = SPECKS.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${1.6 + (i % 3)}" fill="#9C9AB4" opacity=".55"/>`).join('')
  return `<svg class="blobs" viewBox="0 0 1000 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs><linearGradient id="${id}g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F1F0EE"/><stop offset=".55" stop-color="#E7E6EE"/><stop offset="1" stop-color="#D9DAF1"/></linearGradient>
    <radialGradient id="${id}b" cx=".42" cy=".36" r=".7" fx=".36" fy=".28"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".38" stop-color="#F3F2EE"/><stop offset=".78" stop-color="#D5D4DD"/><stop offset="1" stop-color="#B2B1C3"/></radialGradient>
    <filter id="${id}s" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9"/></filter>
    <filter id="${id}m" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="26"/></filter></defs>
    <rect width="1000" height="400" fill="url(#${id}g)"/>
    <g filter="url(#${id}m)" opacity=".55"><ellipse cx="160" cy="250" rx="170" ry="46" fill="#BDBFEF" transform="rotate(-18 160 250)"/><ellipse cx="860" cy="130" rx="150" ry="40" fill="#C7C2EC" transform="rotate(14 860 130)"/><ellipse cx="620" cy="390" rx="220" ry="34" fill="#C9CBEF"/></g>
    ${specks}${spheres}</svg>`
}

/** A user picture, or the blob art in the slot when there is none. */
function picture(image, ctx, cls) {
  const src = ctx.image(image)
  return src
    ? `<img class="${cls}" src="${ctx.esc(src)}" alt="${ctx.esc(image.alt)}">`
    : `<div class="${cls} ph" role="img" aria-label="${ctx.esc(image?.alt ?? '')}">${blobArt()}</div>`
}

/** The footer pair: company (presenter) and date, centred at the bottom. */
const foot = (ctx) => (ctx.deck.presenter || ctx.deck.date)
  ? `<div class="foot">${ctx.deck.presenter ? `<span>${ctx.esc(ctx.deck.presenter)}</span>` : ''}${ctx.deck.date ? `<span>${ctx.esc(ctx.deck.date)}</span>` : ''}</div>`
  : ''

/** The titled head: caps title, optionally followed by a down arrow. */
const head = (title, ctx, { down = true } = {}) => `<div class="head"><h2 class="t title">${ctx.esc(title)}</h2>${down ? arrow('down') : ''}</div>`

/** Small caps meta in the top-right corner. */
const corner = (text, ctx) => (text ? `<span class="corner tr">${ctx.esc(text)}</span>` : '')

const slide = (kind, ctx, cls, inner) => `<section class="slide f-${field(kind, ctx)} ${cls}">${inner}</section>`

export function css(system) {
  const f = system.field
  return `
:root { --paper: ${f.paper}; --peri: ${f.periwinkle}; --yellow: ${f.yellow}; --green: ${f.green}; --pink: ${f.pink};
  --tan: ${f.tan}; --black: ${f.black}; --pill: ${f.pill}; --ink: ${system.ink.primary}; --on-black: ${system.ink.onBlack};
  --tick: ${system.ink.tick}; --m: ${system.geometry.margin}px; --tile-r: ${system.geometry.tileRadius}px; --panel-r: ${system.geometry.panelRadius}px; }
.slide { background: var(--paper); color: var(--ink); font-size: 22px; line-height: 1.5; letter-spacing: .035em; word-spacing: .14em; }
.f-paper { background: var(--paper); } .f-periwinkle { background: var(--peri); } .f-yellow { background: var(--yellow); }
.f-green { background: var(--green); } .f-pink { background: var(--pink); } .f-tan { background: var(--tan); }
.f-black { background: var(--black); color: var(--paper); }
.t { font-family: var(--display-font); font-weight: 800; text-transform: uppercase; letter-spacing: .04em; word-spacing: .02em; line-height: .9; }
.arw { flex: none; display: block; width: .56em; height: .56em; }
.head { position: absolute; left: var(--m); right: var(--m); top: 44px; display: flex; align-items: center; gap: .42em; font-size: 80px; }
.title { font-size: inherit; }
.f-black .head { color: var(--on-black); }
.foot { position: absolute; left: 0; right: 0; bottom: 24px; display: flex; justify-content: center; gap: 80px; font-family: var(--display-font); font-weight: 700; font-size: 13px; letter-spacing: .02em; line-height: 1.2; }
.corner { position: absolute; font-family: var(--display-font); font-weight: 800; font-size: 22px; letter-spacing: .04em; text-transform: uppercase; line-height: 1.1; }
.corner.tr { top: 60px; right: var(--m); font-size: 20px; }
.serif { font-family: var(--font); }
.num { display: block; font-family: var(--display-font); font-weight: 800; font-size: 32px; letter-spacing: .02em; line-height: 1; }

.ph { position: relative; overflow: hidden; background: #E7E6EE; }
.blobs { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
img.panel, img.media, img.disc { object-fit: cover; }

.cover { padding: 30px 54px 0; display: flex; flex-direction: column; }
.cover-h { display: flex; justify-content: space-between; gap: 0 .3em; flex-wrap: wrap; font-size: var(--size); }
.cover .panel { flex: none; margin: 30px 0 0; height: 332px; border-radius: var(--panel-r); width: 100%; }
.cover .row { flex: 1; display: grid; grid-template-columns: 1fr 700px 1fr; align-items: center; }
.cover .row .corner { position: static; font-size: 22px; }
.cover .row .corner:last-child { text-align: right; }
.cover .sub { text-align: center; font-size: var(--sub); line-height: .98; text-wrap: balance; }

.agenda ol { position: absolute; left: 448px; right: var(--m); top: 150px; bottom: 70px; list-style: none; display: flex; flex-direction: column; justify-content: center; gap: var(--gap); font-size: var(--size); }
.agenda li { display: flex; gap: .4em; }
.agenda li .n { min-width: 1.05em; text-align: right; }

.section { padding: 56px; }
.section .sec-h { font-size: var(--size); line-height: .9; }
.section .lead, .closing .lead { margin: 44px 0 0 304px; display: flex; align-items: center; gap: .3em; font-size: var(--sub); line-height: .98; }
.section .lead .arw, .closing .lead .arw { width: .9em; height: .9em; }
.section.v-b .up { display: block; margin: 16px 0 0 -6px; width: 112px; height: 112px; }
.section.v-b .lead { margin: -42px 0 0 497px; }

.statement { padding: 60px 56px; }
.statement .say { font-size: var(--size); line-height: 1.02; max-width: 1110px; }
.statement .by { margin-top: 36px; display: flex; align-items: center; gap: .35em; font-size: 30px; }

.text .tile { position: absolute; left: 0; top: 210px; width: 960px; height: 360px; border-radius: 0 var(--tile-r) var(--tile-r) 0; background: var(--pink); padding: 60px 90px 60px var(--m); display: flex; flex-direction: column; justify-content: center; gap: 26px; }
.text .tile p { font-size: 31px; line-height: 1.55; }

.points .cols { position: absolute; left: 90px; right: 90px; top: 200px; display: grid; grid-template-columns: repeat(var(--n), 1fr); gap: 50px; }
.points .col { display: flex; flex-direction: column; align-items: center; text-align: center; }
.points .col .num { align-self: flex-start; margin-left: 50px; }
.disc { width: 184px; height: 184px; border-radius: 50%; border: 1.5px solid #3A3A3A; padding: 10px; margin: 24px 0 26px; background-clip: content-box; }
.disc.f-yellow { background-color: var(--yellow); } .disc.f-periwinkle { background-color: var(--peri); }
.disc.f-green { background-color: var(--green); } .disc.f-pink { background-color: var(--pink); }
.points h3 { font-size: 34px; margin-bottom: 12px; }
.points p { font-size: 23px; line-height: 1.55; max-width: 300px; }

.image-text .panel { position: absolute; left: var(--m); right: var(--m); top: 140px; height: 364px; border-radius: var(--panel-r); }
.image-text .copy { position: absolute; left: 88px; right: 300px; top: 538px; font-size: 24px; line-height: 1.55; }
.image-text .copy .arw { display: inline-block; vertical-align: -.08em; width: .8em; height: .8em; margin-right: .5em; }

.metrics .tile { position: absolute; width: 427px; height: 262px; border-radius: var(--tile-r); color: var(--ink); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; text-align: center; }
.metrics .tile.f-paper { background: var(--paper); }
.metrics .tile b { font-family: var(--display-font); font-weight: 800; font-size: 86px; letter-spacing: .04em; line-height: .9; }
.metrics .tile span { font-size: 25px; line-height: 1.3; text-transform: uppercase; letter-spacing: 0; word-spacing: 0; max-width: 270px; }
.metrics.f-tan .tile.f-tan { background: var(--paper); }

.two-column .tile { position: absolute; top: 210px; height: 510px; width: 640px; border-radius: var(--tile-r) var(--tile-r) 0 0; padding: 56px 70px 0 var(--m); display: flex; flex-direction: column; gap: 24px; }
.two-column .tile + .tile { padding-left: 70px; }
.two-column h3 { font-size: 54px; }
.two-column p { font-size: 30px; line-height: 1.55; }

.timeline .track { position: absolute; left: 102px; right: 78px; top: 414px; height: 11px; display: flex; }
.timeline .seg { flex: 1; height: 11px; }
.timeline .seg:first-child { border-radius: 6px 0 0 6px; } .timeline .seg:last-child { border-radius: 0 6px 6px 0; }
.timeline .seg + .seg { border-left: 10px solid #6E5233; }
.timeline .seg.f-paper { background: var(--tan); }
.timeline .step { position: absolute; width: 300px; margin-left: -150px; display: flex; flex-direction: column; align-items: center; text-align: center; }
.timeline .step.above { bottom: calc(720px - 414px); }
.timeline .step.below { top: 425px; flex-direction: column-reverse; }
.timeline .tick { width: 3px; height: var(--tick); background: repeating-linear-gradient(var(--tick-c) 0 2px, transparent 2px 4px); }
.timeline .step { --tick-c: #C9BBA3; }
.timeline .block { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 12px 0; }
.timeline .when { padding: 8px 26px 6px; border-radius: 999px; background: var(--pill); font-size: 30px; }
.timeline .when.on { background: var(--black); color: var(--paper); }
.timeline h3 { font-size: 25px; }
.timeline p { font-size: 19px; line-height: 1.5; max-width: 260px; }

.quote { padding: 60px 56px; }
.quote .say { font-size: var(--size); line-height: 1.02; max-width: 1120px; }
.quote .by { margin-top: 40px; display: flex; align-items: center; gap: .4em; font-size: 30px; }
.quote .by .role { font-family: var(--font); font-weight: 400; text-transform: none; font-size: 24px; letter-spacing: .035em; }

.table table { position: absolute; left: 124px; width: 1032px; top: 166px; border-collapse: separate; border-spacing: 22px 0; table-layout: fixed; }
.table th { height: 80px; border-radius: 14px 14px 0 0; font-size: 32px; text-align: center; vertical-align: middle; padding: 6px 12px 0; }
.table th.blank { background: transparent; }
.table th.f-yellow { background: var(--yellow); } .table th.f-pink { background: var(--pink); }
.table th.f-periwinkle { background: var(--peri); } .table th.f-green { background: var(--green); }
.table td { height: 78px; background: var(--tan); border-top: 1.5px solid #000; padding: 0 24px; font-size: 21px; vertical-align: middle; }
.table td.lab { font-family: var(--display-font); font-weight: 800; text-transform: uppercase; font-size: 24px; letter-spacing: .04em; }
.table tr:last-child td { border-radius: 0 0 14px 14px; }
.table thead + tbody tr:first-child td.lab { border-top-left-radius: 14px; border-top-right-radius: 14px; border-top: 0; }

.big-number .val { position: absolute; left: 50px; top: 50%; transform: translateY(-54%); font-size: var(--size); line-height: 1; }
.big-number .what { position: absolute; left: 640px; right: 80px; top: 110px; bottom: 110px; display: flex; flex-direction: column; justify-content: center; gap: 28px; }
.big-number h2 { display: flex; align-items: center; gap: .3em; font-size: var(--lsize); line-height: .95; }
.big-number h2 .arw { width: .9em; height: .9em; }
.big-number p { font-size: 28px; line-height: 1.55; }

.bullets .tile { position: absolute; border-radius: var(--tile-r); padding: 46px 60px 0 60px; display: flex; flex-direction: column; gap: 22px; }
.bullets .tile.f-paper { background: var(--tan); }
.bullets .tile p { font-size: 29px; line-height: 1.5; max-width: 500px; }

.team .people { position: absolute; left: 70px; right: 70px; top: 196px; display: grid; grid-template-columns: repeat(var(--n), 1fr); gap: 40px; }
.team .person { display: flex; flex-direction: column; align-items: center; text-align: center; }
.team .disc { width: 220px; height: 220px; margin: 0 0 26px; display: grid; place-items: center; }
.team .disc .ini { font-size: 56px; line-height: 1; }
.team img.disc { padding: 0; border: 0; box-shadow: 0 0 0 10px var(--paper), 0 0 0 11.5px #3A3A3A; }
.team h3 { font-size: 30px; margin-bottom: 8px; }
.team p { font-size: 21px; }

.image .media { position: absolute; left: 36px; right: 36px; top: 36px; height: 556px; border-radius: var(--panel-r); width: calc(100% - 72px); }
.image .cap { position: absolute; left: var(--m); right: 300px; bottom: 40px; display: flex; align-items: center; gap: .4em; font-size: 30px; line-height: 1; }
.image .cap .arw { width: 1.3em; height: 1.3em; }
.image .corner.br { right: var(--m); bottom: 44px; }

.frame .avn-body { position: absolute; left: var(--m); right: var(--m); top: 170px; bottom: 70px; }
.frame .avn-caption { font-family: var(--font); color: var(--ink); font-size: 18px; }

.closing { padding: 56px; }
.closing .sec-h { font-size: var(--size); line-height: .9; }
.closing .corner.bl { left: var(--m); bottom: 50px; text-transform: none; letter-spacing: .02em; }
.closing .corner.br { right: var(--m); bottom: 50px; }
`
}

export const slides = {
  cover: (d, ctx) => {
    const words = String(d.title).split(/\s+/).filter(Boolean)
    const split = words.length >= 2 && d.title.length <= 18
    const half = Math.ceil(words.length / 2)
    const parts = split ? [words.slice(0, half).join(' '), words.slice(half).join(' ')] : [d.title]
    const size = split ? fit(d.title, { width: 900, lines: 1, max: 172, min: 70 }) : fit(d.title, { width: 1160, lines: 1, max: 150, min: 64 })
    const sub = d.subtitle ? fit(d.subtitle, { width: 700, lines: 2, max: 44, min: 26 }) : 0
    return slide('cover', ctx, 'cover', `<h1 class="t cover-h" style="--size:${size}px">${parts.map((p) => `<span>${ctx.esc(p)}</span>`).join('')}</h1>
      ${picture(undefined, ctx, 'panel')}
      <div class="row"><span class="corner">${ctx.esc(d.eyebrow ?? '')}</span>${d.subtitle ? `<p class="t sub" style="--sub:${sub}px">${ctx.esc(d.subtitle)}</p>` : '<span></span>'}<span class="corner">${ctx.esc(ctx.deck.date ?? '')}</span></div>`)
  },

  agenda: (d, ctx) => {
    const n = d.items.length
    const size = Math.min(60, fit(d.items.reduce((a, b) => (a.length > b.length ? a : b)), { width: 700, lines: 1, max: 60, min: 34 }), Math.floor(440 / (n * 1.42)))
    return slide('agenda', ctx, 'agenda', `${head(d.title, ctx, { down: false })}
      <ol class="t" style="--size:${size}px;--gap:${Math.round(size * 0.48)}px">${d.items.map((item, i) => `<li><span class="n">${i + 1}.</span><span>${ctx.esc(item)}</span></li>`).join('')}</ol>${foot(ctx)}`)
  },

  section: (d, ctx) => {
    const variant = field('section', ctx) === 'yellow' || field('section', ctx) === 'periwinkle' ? 'a' : 'b'
    if (variant === 'a') {
      const size = fit(d.title, { width: 1150, lines: 1, max: 172, min: 80 })
      const sub = fit(d.subtitle ?? '', { width: 860, lines: 2, max: 76, min: 40 })
      return slide('section', ctx, 'section v-a', `<h2 class="t sec-h" style="--size:${size}px"><span>${ctx.esc(d.number)}</span><br><span>${ctx.esc(d.title)}</span></h2>
        ${d.subtitle ? `<p class="t lead" style="--sub:${sub}px">${arrow('right')}<span>${ctx.esc(d.subtitle)}</span></p>` : ''}${foot(ctx)}`)
    }
    const text = `${d.number} ${d.title}`
    const size = fit(text, { width: 1150, lines: 2, max: 172, min: 80 })
    const sub = fit(d.subtitle ?? '', { width: 670, lines: 2, max: 56, min: 30 })
    return slide('section', ctx, 'section v-b', `<h2 class="t sec-h" style="--size:${size}px">${ctx.esc(text)}</h2>
      ${arrow('up', 'up')}${d.subtitle ? `<p class="t lead" style="--sub:${sub}px">${ctx.esc(d.subtitle)}</p>` : ''}${foot(ctx)}`)
  },

  statement: (d, ctx) => {
    const size = fit(d.text, { width: 1110, lines: 5, max: 100, min: 44 })
    return slide('statement', ctx, 'statement', `<p class="t say" style="--size:${size}px">${ctx.esc(d.text)}</p>
      ${d.attribution ? `<p class="t by">${arrow('right')}<span>${ctx.esc(d.attribution)}</span></p>` : ''}${foot(ctx)}`)
  },

  text: (d, ctx) => slide('text', ctx, 'text', `${head(d.title, ctx)}${corner(d.eyebrow, ctx)}
    <div class="tile"><p class="serif">${ctx.esc(d.body)}</p></div>${foot(ctx)}`),

  points: (d, ctx) => slide('points', ctx, 'points', `${head(d.title, ctx, { down: false })}
    <div class="cols" style="--n:${d.items.length}">${d.items.map((item, i) => `<div class="col"><span class="num">${i + 1}.</span><div class="disc f-${DISCS[i % DISCS.length]}"></div>
      <h3 class="t">${ctx.esc(item.title)}</h3><p>${ctx.esc(item.body)}</p></div>`).join('')}</div>${foot(ctx)}`),

  'image-text': (d, ctx) => slide('image-text', ctx, 'image-text', `${head(d.title, ctx, { down: false })}${picture(d.image, ctx, 'panel')}
    <p class="copy">${arrow('up')}${ctx.esc(d.body)}</p>`),

  metrics: (d, ctx) => {
    const n = d.items.length
    const top = Math.floor(n / 2)
    const bottom = n - top
    const W = 1280 / 3
    const tiles = d.items.map((m, i) => {
      const upper = i < top
      const col = upper ? i : 3 - bottom + (i - top)
      const x = upper ? 18 + col * W : col * W
      const y = upper ? 200 : 460
      return `<div class="tile f-${METRIC_TILES[i % METRIC_TILES.length]}" style="left:${Math.round(x)}px;top:${y}px"><b>${ctx.esc(m.value)}</b><span>${ctx.esc(m.label)}</span></div>`
    })
    return slide('metrics', ctx, 'metrics', `${head(d.title, ctx)}${tiles.join('')}`)
  },

  'two-column': (d, ctx) => slide('two-column', ctx, 'two-column', `${head(d.title, ctx)}
    ${d.columns.map((c, i) => `<div class="tile f-${['yellow', 'green'][i % 2]}" style="left:${i * 640}px"><h3 class="t">${ctx.esc(c.title)}</h3><p>${ctx.esc(c.body)}</p></div>`).join('')}`),

  timeline: (d, ctx) => {
    const n = d.steps.length
    const segs = ['periwinkle', 'green', 'yellow', 'pink', 'paper']
    const left = 102
    const width = 1280 - 102 - 78
    const steps = d.steps.map((s, i) => {
      const above = i % 2 === 0
      const x = Math.round(left + ((i + 0.5) * width) / n)
      const tick = above ? [36, 96][(i / 2) % 2] : 48
      return `<div class="step ${above ? 'above' : 'below'}" style="left:${x}px">
        <div class="block"><span class="t when${i === 1 ? ' on' : ''}">${ctx.esc(s.when)}</span><h3 class="t">${ctx.esc(s.title)}</h3>${s.body ? `<p>${ctx.esc(s.body)}</p>` : ''}</div>
        <span class="tick" style="--tick:${tick}px"></span></div>`
    })
    return slide('timeline', ctx, 'timeline', `${head(d.title, ctx)}
      <div class="track">${d.steps.map((_, i) => `<span class="seg f-${segs[i % segs.length]}"></span>`).join('')}</div>${steps.join('')}`)
  },

  quote: (d, ctx) => {
    const size = fit(d.text, { width: 1120, lines: 5, max: 90, min: 40 })
    return slide('quote', ctx, 'quote', `<p class="t say" style="--size:${size}px">${ctx.esc(d.text)}</p>
      <p class="t by">${arrow('right')}<span>${ctx.esc(d.name)}</span>${d.role ? `<span class="role">${ctx.esc(d.role)}</span>` : ''}</p>${foot(ctx)}`)
  },

  table: (d, ctx) => {
    const heads = ['yellow', 'pink', 'periwinkle', 'green']
    const hasLabels = d.columns[0] === ''
    const rows = [...d.rows]
    while (rows.length < 5) rows.push(null)
    let h = 0
    const th = d.columns.map((c, i) => (c === '' && i === 0 ? '<th class="blank"></th>' : `<th class="t f-${heads[h++ % heads.length]}">${ctx.esc(c)}</th>`)).join('')
    const body = rows.map((r) => (r
      ? `<tr>${r.map((c, i) => `<td class="${hasLabels && i === 0 ? 'lab' : 'serif'}">${ctx.esc(c)}</td>`).join('')}</tr>`
      : `<tr aria-hidden="true">${d.columns.map((_, i) => `<td class="${hasLabels && i === 0 ? 'lab' : ''}"></td>`).join('')}</tr>`)).join('')
    return slide('table', ctx, 'table', `${head(d.title, ctx)}<table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>${foot(ctx)}`)
  },

  'big-number': (d, ctx) => {
    const size = fit(d.value, { width: 560, lines: 1, max: 420, min: 160, em: 0.6 })
    const lsize = fit(d.label, { width: 480, lines: 2, max: 80, min: 40 })
    return slide('big-number', ctx, 'big-number', `<b class="t val" style="--size:${size}px">${ctx.esc(d.value)}</b>
      <div class="what"><h2 class="t" style="--lsize:${lsize}px">${arrow('right')}<span>${ctx.esc(d.label)}</span></h2>${d.body ? `<p>${ctx.esc(d.body)}</p>` : ''}</div>${foot(ctx)}`)
  },

  bullets: (d, ctx) => {
    const n = d.items.length
    const cols = n === 4 ? 2 : 3
    const rows = Math.ceil(n / cols)
    const colors = cols === 2 ? ['pink', 'yellow', 'green', 'periwinkle'] : TILES
    const w = 1280 / cols
    const h = Math.round(520 / rows)
    return slide('bullets', ctx, 'bullets', `${head(d.title, ctx)}${d.items.map((item, i) => `<div class="tile f-${colors[i % colors.length]}" style="left:${Math.round((i % cols) * w)}px;top:${200 + Math.floor(i / cols) * h}px;width:${Math.round(w)}px;height:${h}px">
      <span class="num">${i + 1}.</span><p>${ctx.esc(item)}</p></div>`).join('')}`)
  },

  team: (d, ctx) => slide('team', ctx, 'team', `${head(d.title, ctx)}
    <div class="people" style="--n:${d.people.length}">${d.people.map((p, i) => {
      const src = p.image && ctx.image(p.image)
      const initials = p.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2)
      const face = src
        ? `<img class="disc" src="${ctx.esc(src)}" alt="${ctx.esc(p.name)}">`
        : `<div class="disc f-${DISCS[i % DISCS.length]}"><span class="t ini">${ctx.esc(initials)}</span></div>`
      return `<div class="person">${face}<h3 class="t">${ctx.esc(p.name)}</h3><p>${ctx.esc(p.role)}</p></div>`
    }).join('')}</div>${foot(ctx)}`),

  image: (d, ctx) => slide('image', ctx, 'image', `${picture(d.image, ctx, 'media')}
    ${d.caption ? `<p class="t cap">${arrow('up')}<span>${ctx.esc(d.caption)}</span></p>` : ''}<span class="corner br">${ctx.esc(ctx.deck.date ?? '')}</span>`),

  /** The titled content slide that `chart` and `custom` slides are drawn in. */
  frame: ({ title, eyebrow }, ctx, body) => slide('frame', ctx, 'frame', `${title ? head(title, ctx) : ''}${corner(eyebrow, ctx)}${body}${foot(ctx)}`),

  closing: (d, ctx) => {
    const size = fit(d.title, { width: 1150, lines: 1, max: 200, min: 80 })
    const sub = fit(d.subtitle ?? '', { width: 860, lines: 2, max: 76, min: 40 })
    return slide('closing', ctx, 'closing', `<h2 class="t sec-h" style="--size:${size}px">${ctx.esc(d.title)}</h2>
      ${d.subtitle ? `<p class="t lead" style="--sub:${sub}px">${arrow('right')}<span>${ctx.esc(d.subtitle)}</span></p>` : ''}
      ${d.contact ? `<span class="corner bl">${ctx.esc(d.contact)}</span>` : ''}<span class="corner br">${ctx.esc(ctx.deck.date ?? '')}</span>`)
  },
}
