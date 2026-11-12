/**
 * Clean Zine: pale mint pages with brown alternates, tall condensed serif caps titles, italic serif
 * labels with roman numerals, thin plus and dash marks, framed duotone pictures and quiet corner
 * meta (an italic section label top left, deck title and date top right).
 * Measured from the 16 thumbnails of "Clean Zine" (Figma Community).
 */

const ROMAN = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]

/** A positive integer as a roman numeral; anything else passes through unchanged. */
function roman(value) {
  let n = Number.parseInt(value, 10)
  if (!Number.isFinite(n) || n <= 0 || n > 3999) return String(value)
  let out = ''
  for (const [v, s] of ROMAN) while (n >= v) { out += s; n -= v }
  return out
}

/** The deck's sections up to and including this slide: how many, and the latest one. */
function sectionsSoFar(ctx) {
  const before = ctx.deck.slides.slice(0, ctx.index).filter((s) => s.kind === 'section')
  return { count: before.length, last: before.at(-1) }
}

/** "Section: II" for slides after a section slide, else the fallback. */
function sectionLabel(ctx, fallback = '') {
  const { last } = sectionsSoFar(ctx)
  return last ? `Section: ${roman(last.number)}` : fallback
}

/** The corner meta: an italic label top left, deck title and date top right. */
function meta(ctx, label) {
  const right = [ctx.deck.title, ctx.deck.date ?? ctx.deck.presenter].filter(Boolean)
  return `<header class="meta">${label ? `<span class="it label">${ctx.esc(label)}</span>` : '<span></span>'}
    <span class="corner">${right.map((t) => `<span>${ctx.esc(t)}</span>`).join('')}</span></header>`
}

const plus = '<span class="plus" aria-hidden="true"></span>'
const dash = '<span class="dash" aria-hidden="true"></span>'

/** A user picture in the duotone frame, or a neutral framed placeholder: a backdrop sweep, or the cover's disc. */
function picture(image, ctx, cls = '', variant = 'sweep') {
  const src = ctx.image(image)
  return src
    ? `<div class="pic duo ${cls}"><img src="${ctx.esc(src)}" alt="${ctx.esc(image.alt)}"></div>`
    : `<div class="pic ph ${variant} ${cls}" role="img" aria-label="${ctx.esc(image?.alt ?? '')}"><i></i></div>`
}

/** A titled heading in the slide-12 style: a dash before condensed caps. */
const dashTitle = (title, ctx) => `<div class="dash-head">${dash}<h2 class="caps t-m">${ctx.esc(title)}</h2></div>`

/** A titled heading in the slide-13 style: a plus before an italic serif title. */
const plusTitle = (title, ctx) => `<div class="plus-head">${plus}<h2 class="it t-it">${ctx.esc(title)}</h2></div>`

export function css(system) {
  const { tone } = system
  return `
:root { --mint: ${tone.mint}; --brown: ${tone.brown}; --olive: ${tone.olive}; --sage: ${tone.sage}; --sage-l: ${tone.sageLight};
  --fg: var(--brown); --bg: var(--mint); --hair: 1.5px; --italic: "Noto Serif", Georgia, serif; }
.slide { background: var(--bg); color: var(--fg); font-size: 19px; line-height: 1.42; }
.slide.brown { --bg: var(--brown); --fg: var(--mint); }
.it { font-family: var(--italic); font-style: italic; font-weight: 400; letter-spacing: .02em; }
.caps { font-family: var(--display-font); font-weight: 400; text-transform: uppercase; letter-spacing: -.005em; line-height: .88; }
.t-xl { font-size: 200px; } .t-l { font-size: 196px; } .t-m { font-size: 84px; }
.t-it { font-size: 38px; line-height: 1.3; text-transform: capitalize; text-wrap: balance; }

.meta { position: absolute; left: 46px; right: 105px; top: 26px; height: 46px; display: flex; align-items: center; justify-content: space-between; }
.meta .label { font-size: 37px; line-height: 1; }
.meta .corner { display: flex; gap: 59px; font-size: 18px; }

.plus { position: relative; flex: none; display: block; width: 49px; height: 49px; }
.plus::before, .plus::after { content: ""; position: absolute; background: currentColor; }
.plus::before { left: 24px; top: 0; width: var(--hair); height: 49px; }
.plus::after { top: 24px; left: 0; width: 49px; height: var(--hair); }
.dash { flex: none; display: block; width: 82px; height: var(--hair); background: currentColor; }

.pic { position: absolute; overflow: hidden; }
.pic img { width: 100%; height: 100%; object-fit: cover; }
.duo { background: var(--mint); isolation: isolate; }
.duo img { filter: grayscale(1) contrast(1.05); mix-blend-mode: multiply; }
.duo::after { content: ""; position: absolute; inset: 0; background: var(--brown); mix-blend-mode: lighten; }
.ph.sweep { background: linear-gradient(180deg, var(--sage-l) 0%, var(--sage) 66%, #9EAF89 66.4%, #A7B792 100%); }
.ph.sweep i { position: absolute; left: 50%; top: 66%; width: 46%; height: 9%; transform: translate(-50%, -50%); border-radius: 50%; background: radial-gradient(closest-side, rgba(118,102,71,.55), rgba(118,102,71,0)); }
.ph.disc { background: var(--olive); }
.ph.disc i { position: absolute; inset: 7%; border-radius: 50%; background: radial-gradient(circle at 42% 38%, var(--sage-l), var(--sage) 70%, #A2B48D); }

/* cover: source slide 1 */
.cover h1 { position: absolute; left: 46px; top: 52px; width: 560px; font-size: 118px; }
.cover .eyebrow { position: absolute; left: 221px; top: 318px; font-size: 26px; }
.cover .sub { position: absolute; left: 221px; top: 368px; width: 360px; font-size: 19px; }
.cover .date { position: absolute; left: 196px; bottom: 58px; font-size: 30px; }
.cover .pic { left: 628px; top: 68px; width: 582px; height: 582px; }

/* agenda: source slide 4 */
.agenda h2 { position: absolute; left: 100px; bottom: 150px; width: 680px; }
.agenda ol { position: absolute; left: 790px; right: 40px; bottom: 76px; list-style: none; display: flex; flex-direction: column; }
.agenda li { display: grid; grid-template-columns: 74px 1fr; align-items: baseline; min-height: var(--pitch); font-size: 36px; line-height: 1.1; }
.agenda li .n { font-size: 30px; }

/* section: source slides 6–8 */
.section .kicker { position: absolute; left: 132px; top: 148px; display: flex; align-items: baseline; gap: 40px; }
.section .kicker .it { font-size: 38px; }
.section .kicker .caps { font-size: 82px; line-height: 1; }
.section h2 { position: absolute; left: 448px; top: 200px; width: 760px; }
.section .sub { position: absolute; left: 452px; bottom: 96px; width: 700px; font-size: 30px; line-height: 1.3; }

/* statement and quote: source slides 15–16, the rotated condensed line */
.tilt { position: absolute; left: 60px; width: 1130px; transform: rotate(-2deg); transform-origin: 0 0; font-family: var(--display-font); line-height: 1.02; text-wrap: balance; }
.statement .tilt { top: 150px; font-size: 112px; text-transform: capitalize; }
.quote .tilt { top: 170px; font-size: 96px; }
.aside { position: absolute; left: 832px; right: 60px; bottom: 44px; font-size: 21px; line-height: 1.3; }
.quote .aside { bottom: 64px; }
.quote .aside b { display: block; font-weight: 400; font-size: 28px; }
.quote .aside span { display: block; font-family: var(--font); font-style: normal; letter-spacing: 0; font-size: 18px; margin-top: 4px; }

/* text: source slide 9 */
.text .eyebrow { position: absolute; left: 150px; top: 160px; font-size: 26px; }
.text h2 { position: absolute; left: 147px; top: 214px; width: 1000px; }
.text .plus { position: absolute; left: 247px; top: 384px; }
.text .body { position: absolute; left: 350px; top: 368px; width: 760px; font-size: 32px; line-height: 1.34; }

/* titled heads */
.dash-head { position: absolute; left: 129px; top: 115px; right: 84px; display: flex; align-items: flex-start; gap: 39px; }
.dash-head .dash { margin-top: 36px; }
.plus-head { position: absolute; left: 74px; top: 112px; width: 920px; display: flex; align-items: flex-start; gap: 54px; }
.plus-head .plus { margin-top: 18px; }

/* points and bullets: source slides 13–14 */
.cols { position: absolute; left: 83px; right: 84px; display: grid; grid-template-columns: repeat(var(--c), 1fr); column-gap: 76px; row-gap: 40px; }
.points .cols { bottom: 150px; }
.cols .n { display: block; font-size: 46px; line-height: 1; margin-bottom: 18px; }
.cols h3 { font-family: var(--display-font); text-transform: uppercase; font-size: 36px; line-height: 1; margin-bottom: 12px; }
.cols p { font-size: 21px; line-height: 1.42; max-width: 320px; }
.bullets .cols { top: 300px; }
.bullets .cols.two { left: 177px; right: 260px; }
.bullets .cols p { font-size: 23px; }

/* image-text: source slide 6 */
.image-text h2 { position: absolute; left: 132px; top: 210px; width: 560px; }
.image-text .plus { position: absolute; left: 132px; top: 438px; }
.image-text .body { position: absolute; left: 220px; top: 432px; width: 470px; font-size: 26px; line-height: 1.36; }
.image-text .pic { right: 47px; top: 160px; width: 470px; height: 400px; }

/* metrics: source slides 10 and 12 */
.metrics .lead { position: absolute; left: 84px; top: 182px; width: 340px; font-size: 38px; line-height: 1.26; text-transform: capitalize; }
.metrics .grid { position: absolute; left: 500px; right: 40px; top: 150px; bottom: 80px; display: grid; grid-template-columns: repeat(var(--c), 1fr); align-content: space-between; column-gap: 40px; row-gap: 40px; }
.metric b { display: block; font-family: var(--display-font); font-weight: 400; font-size: 128px; line-height: .86; letter-spacing: -.01em; white-space: nowrap; }
.metric span { display: block; margin-top: 26px; font-size: 32px; line-height: 1.15; max-width: 360px; }

/* two-column */
.two-column .cols { left: 250px; right: 84px; top: 330px; --c: 2; column-gap: 90px; }
.two-column .cols .n { font-size: 40px; margin-bottom: 20px; }
.two-column .cols p { font-size: 26px; max-width: 440px; }

/* timeline */
.timeline .track { position: absolute; left: 129px; right: 84px; top: 296px; display: grid; grid-template-columns: repeat(var(--c), 1fr); column-gap: 36px; }
.timeline .track::before { content: ""; position: absolute; left: 24px; right: 0; top: 154px; height: var(--hair); background: currentColor; }
.step .when { display: flex; align-items: flex-end; height: 106px; font-family: var(--display-font); font-size: 96px; line-height: .86; text-transform: uppercase; white-space: nowrap; }
.step .plus { margin: 24px 0 26px; }
.step b { display: block; font-weight: 400; font-size: 32px; line-height: 1.2; }
.step p { margin-top: 8px; font-size: 19px; max-width: 230px; }

/* table */
.table table { position: absolute; left: 250px; width: 946px; top: 300px; border-collapse: collapse; }
.table th { text-align: left; font-family: var(--italic); font-style: italic; font-weight: 400; font-size: 30px; letter-spacing: .02em; padding: 0 16px 14px 0; border-bottom: var(--hair) solid currentColor; }
.table td { padding: 18px 16px 18px 0; font-size: 23px; border-bottom: 1px solid var(--avn-rule); }
.table td:first-child { font-family: var(--italic); font-style: italic; font-size: 28px; letter-spacing: .02em; }

/* big number */
.big-number .value { position: absolute; left: 84px; bottom: 70px; max-width: 640px; font-family: var(--display-font); font-size: 400px; line-height: 1; white-space: nowrap; }
.big-number .what { position: absolute; left: 760px; right: 84px; bottom: 112px; }
.big-number .what h2 { font-family: var(--italic); font-style: italic; letter-spacing: .02em; font-size: 46px; line-height: 1.2; text-transform: capitalize; }
.big-number .what p { margin-top: 18px; font-size: 22px; }

/* team */
.people { position: absolute; left: 83px; right: 84px; top: 262px; display: grid; grid-template-columns: repeat(var(--c), minmax(0, 300px)); column-gap: 40px; }
.person .pic { position: relative; width: 100%; height: 230px; }
.person b { display: block; margin-top: 22px; font-weight: 400; font-size: 30px; line-height: 1.2; }
.person span { display: block; margin-top: 4px; font-size: 18px; }

/* full image */
.image .pic { left: 46px; right: 46px; top: 96px; bottom: 96px; }
.image .cap { position: absolute; left: 46px; right: 46px; bottom: 34px; font-size: 26px; line-height: 1.2; }

/* framed content (chart, custom) */
.framed .area { position: absolute; left: 129px; right: 84px; top: 250px; bottom: 56px; display: flex; flex-direction: column; }

/* closing: source slide 5 */
.closing h2 { position: absolute; left: 46px; bottom: 200px; width: 1100px; }
.closing .row { position: absolute; left: 46px; right: 105px; bottom: 82px; display: flex; justify-content: space-between; align-items: baseline; gap: 40px; font-size: 38px; }
.closing .row span:last-child { font-family: var(--font); font-style: normal; letter-spacing: 0; font-size: 20px; }
`
}

export const slides = {
  cover: (d, ctx) => `<section class="slide cover">
    <h1 class="caps">${ctx.esc(d.title)}</h1>
    ${d.eyebrow ? `<p class="it eyebrow">${ctx.esc(d.eyebrow)}</p>` : ''}
    ${d.subtitle ? `<p class="sub">${ctx.esc(d.subtitle)}</p>` : ''}
    ${ctx.deck.date ? `<p class="it date">${ctx.esc(ctx.deck.date)}</p>` : ''}
    ${picture(undefined, ctx, '', 'disc')}</section>`,

  agenda: (d, ctx) => `<section class="slide agenda">${meta(ctx, 'Agenda')}
    <h2 class="caps t-xl">${ctx.esc(d.title)}</h2>
    <ol style="--pitch:${Math.min(104, Math.floor(420 / d.items.length))}px">${d.items.map((item, i) => `<li class="it"><span class="n">${roman(i + 1)}</span><span>${ctx.esc(item)}</span></li>`).join('')}</ol></section>`,

  section: (d, ctx) => {
    const tone = sectionsSoFar(ctx).count % 2 === 0 ? ' brown' : ''
    return `<section class="slide section${tone}">${meta(ctx, '')}
    <div class="kicker"><span class="it">Section</span><span class="caps">${ctx.esc(roman(d.number))}</span></div>
    <h2 class="caps t-l">${ctx.esc(d.title)}</h2>
    ${d.subtitle ? `<p class="it sub">${ctx.esc(d.subtitle)}</p>` : ''}</section>`
  },

  statement: (d, ctx) => `<section class="slide statement brown">${meta(ctx, sectionLabel(ctx))}
    <p class="tilt">${ctx.esc(d.text)}</p>
    ${d.attribution ? `<p class="it aside">${ctx.esc(d.attribution)}</p>` : ''}</section>`,

  text: (d, ctx) => `<section class="slide text">${meta(ctx, sectionLabel(ctx))}
    ${d.eyebrow ? `<p class="it eyebrow">${ctx.esc(d.eyebrow)}</p>` : ''}
    <h2 class="caps t-m">${ctx.esc(d.title)}</h2>${plus}
    <p class="it body">${ctx.esc(d.body)}</p></section>`,

  points: (d, ctx) => `<section class="slide points">${meta(ctx, sectionLabel(ctx))}${plusTitle(d.title, ctx)}
    <div class="cols" style="--c:${d.items.length}">${d.items.map((item, i) => `<div><span class="it n">${roman(i + 1)}</span><h3>${ctx.esc(item.title)}</h3><p>${ctx.esc(item.body)}</p></div>`).join('')}</div></section>`,

  'image-text': (d, ctx) => `<section class="slide image-text">${meta(ctx, sectionLabel(ctx))}
    <h2 class="caps t-m">${ctx.esc(d.title)}</h2>${plus}<p class="it body">${ctx.esc(d.body)}</p>
    ${picture(d.image, ctx)}</section>`,

  metrics: (d, ctx) => `<section class="slide metrics">${meta(ctx, sectionLabel(ctx))}
    <h2 class="it lead">${ctx.esc(d.title)}</h2>
    <div class="grid" style="--c:${d.items.length <= 4 ? 2 : 3}">${d.items.map((m) => `<div class="metric"><b>${ctx.esc(m.value)}</b><span class="it">${ctx.esc(m.label)}</span></div>`).join('')}</div></section>`,

  'two-column': (d, ctx) => `<section class="slide two-column">${meta(ctx, sectionLabel(ctx))}${dashTitle(d.title, ctx)}
    <div class="cols">${d.columns.map((c) => `<div><span class="it n">${ctx.esc(c.title)}</span><p>${ctx.esc(c.body)}</p></div>`).join('')}</div></section>`,

  timeline: (d, ctx) => `<section class="slide timeline">${meta(ctx, sectionLabel(ctx))}${dashTitle(d.title, ctx)}
    <div class="track" style="--c:${d.steps.length}">${d.steps.map((s) => `<div class="step"><span class="when">${ctx.esc(s.when)}</span>${plus}<b class="it">${ctx.esc(s.title)}</b>${s.body ? `<p>${ctx.esc(s.body)}</p>` : ''}</div>`).join('')}</div></section>`,

  quote: (d, ctx) => `<section class="slide quote">${meta(ctx, sectionLabel(ctx))}
    <p class="tilt">“${ctx.esc(d.text)}”</p>
    <p class="it aside"><b>${ctx.esc(d.name)}</b>${d.role ? `<span>${ctx.esc(d.role)}</span>` : ''}</p></section>`,

  table: (d, ctx) => `<section class="slide table">${meta(ctx, sectionLabel(ctx))}${dashTitle(d.title, ctx)}
    <table><thead><tr>${d.columns.map((c) => `<th>${ctx.esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${d.rows.map((r) => `<tr>${r.map((c) => `<td>${ctx.esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></section>`,

  'big-number': (d, ctx) => `<section class="slide big-number brown">${meta(ctx, sectionLabel(ctx))}
    <p class="value">${ctx.esc(d.value)}</p>
    <div class="what"><h2>${ctx.esc(d.label)}</h2>${d.body ? `<p>${ctx.esc(d.body)}</p>` : ''}</div></section>`,

  bullets: (d, ctx) => {
    const c = d.items.length === 4 ? 2 : Math.min(3, d.items.length)
    return `<section class="slide bullets">${meta(ctx, sectionLabel(ctx))}${plusTitle(d.title, ctx)}
    <div class="cols${c === 2 ? ' two' : ''}" style="--c:${c}">${d.items.map((item, i) => `<div><span class="it n">${roman(i + 1)}</span><p>${ctx.esc(item)}</p></div>`).join('')}</div></section>`
  },

  team: (d, ctx) => `<section class="slide team">${meta(ctx, sectionLabel(ctx))}${plusTitle(d.title, ctx)}
    <div class="people" style="--c:${d.people.length}">${d.people.map((p) => `<div class="person">${picture(p.image ?? { alt: p.name }, ctx)}<b class="it">${ctx.esc(p.name)}</b><span>${ctx.esc(p.role)}</span></div>`).join('')}</div></section>`,

  image: (d, ctx) => `<section class="slide image">${meta(ctx, sectionLabel(ctx))}${picture(d.image, ctx)}
    ${d.caption ? `<p class="it cap">${ctx.esc(d.caption)}</p>` : ''}</section>`,

  /** The titled content slide that `chart` and `custom` slides are drawn in. */
  frame: ({ title, eyebrow }, ctx, body) => `<section class="slide framed">${meta(ctx, eyebrow ?? sectionLabel(ctx))}
    ${title ? dashTitle(title, ctx) : ''}<div class="area">${body}</div></section>`,

  closing: (d, ctx) => `<section class="slide closing brown">${meta(ctx, '')}
    <h2 class="caps t-xl">${ctx.esc(d.title)}</h2>
    <div class="row it">${d.subtitle ? `<span>${ctx.esc(d.subtitle)}</span>` : '<span></span>'}${d.contact ? `<span>${ctx.esc(d.contact)}</span>` : ''}</div></section>`,
}
