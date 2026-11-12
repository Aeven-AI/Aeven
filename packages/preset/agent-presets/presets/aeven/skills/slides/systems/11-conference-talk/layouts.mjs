/**
 * Conference Talk: flat pale-blue, olive-green and red-orange panels meeting on hard edges, a red
 * bar under the title band, checkerboard photo slots, a black agenda split by a white hairline,
 * wide grotesque caps titles, light serif statements and big serif numerals, and tracked caps
 * corner meta (section top left, talk title bottom left, date bottom right).
 * Measured from the 15 frames of "Conference Talk" (Figma Community).
 */

/** The section a slide sits in: the title of the nearest section slide at or before it. */
function sectionOf(ctx) {
  for (let i = ctx.index - 1; i >= 0; i--) {
    const slide = ctx.deck.slides[i]
    if (slide.kind === 'section') return slide.title
  }
  return ''
}

/** Corner meta: top left (section or eyebrow), bottom left (talk title), bottom right (date). */
function meta(ctx, { top, left, right } = {}) {
  const tl = top === undefined ? sectionOf(ctx) : top
  const bl = left === undefined ? ctx.deck.title : left
  const br = right === undefined ? ctx.deck.date : right
  return [
    tl ? `<span class="m m-tl">${ctx.esc(tl)}</span>` : '',
    bl ? `<span class="m m-bl">${ctx.esc(bl)}</span>` : '',
    br ? `<span class="m m-br">${ctx.esc(br)}</span>` : '',
  ].join('')
}

/** A user picture, or the checkerboard placeholder the source uses for empty image slots. */
function picture(image, ctx, cls) {
  const src = image && ctx.image(image)
  return src
    ? `<img class="${cls} pic" src="${ctx.esc(src)}" alt="${ctx.esc(image.alt ?? '')}">`
    : `<div class="${cls} ph" role="img" aria-label="${ctx.esc(image?.alt ?? '')}"></div>`
}

/** Width of a caps word in ems for the grotesque titles. */
const capsWidth = (word) => [...word].reduce((sum, c) => sum + (/[IJ1.,:;!'’|]/.test(c) ? 0.3 : /[MW]/.test(c) ? 0.88 : 0.66), 0)

/** The largest caps title size that keeps every word on a line and the title within `lines` lines. */
function capsSize(text, width, max, lines = 2) {
  const words = String(text).toUpperCase().split(/\s+/).filter(Boolean)
  const longest = Math.max(...words.map(capsWidth))
  const total = words.reduce((sum, w) => sum + capsWidth(w), 0) + 0.28 * (words.length - 1)
  return Math.floor(Math.min(max, width / longest, (width * lines * 0.88) / total))
}

/** A serif display size stepped down for longer text. */
const serifSize = (text, base) => {
  const n = String(text).length
  return Math.round(n <= 90 ? base : n <= 150 ? base * 0.8 : base * 0.64)
}

const caps = (tag, text, ctx, width, max, lines) =>
  `<${tag} class="caps" style="font-size:${capsSize(text, width, max, lines)}px">${ctx.esc(text)}</${tag}>`

export function css(system) {
  const { field: f, ink, rule, placeholder, geometry: g } = system
  return `
:root { --blue: ${f.blue}; --green: ${f.green}; --red: ${f.red}; --black: ${f.black}; --cream: ${f.cream}; --olive: ${f.olive};
  --card: ${f.card}; --row: ${f.row}; --ink: ${ink.primary}; --on-black: ${ink.onBlack}; --on-olive: ${ink.onOlive}; --muted: ${ink.muted};
  --rule: ${rule}; --ph-a: ${placeholder[0]}; --ph-b: ${placeholder[1]}; --m: ${g.margin}px; --split: ${g.coverSplit}px;
  --band: ${g.coverBand}px; --bar: ${g.bar}px; --sq: ${g.checker}px;
  --sans: var(--font); --serif: var(--display-font); }
.slide { background: var(--cream); color: var(--ink); font-family: var(--serif); font-size: 22px; line-height: 1.42; }
.slide.blue { background: var(--blue); } .slide.green { background: var(--green); } .slide.red { background: var(--red); }
.slide.dark { background: var(--black); color: var(--on-black); } .slide.olive { background: var(--olive); color: var(--on-olive); }
.panel { position: absolute; top: 0; bottom: 0; }
.panel.l { left: 0; width: var(--split); } .panel.r { left: var(--split); right: 0; }
.panel.blue { background: var(--blue); } .panel.green { background: var(--green); } .panel.red { background: var(--red); } .panel.cream { background: var(--cream); }

.m { position: absolute; z-index: 2; font: 500 13px/1 var(--sans); letter-spacing: .1em; text-transform: uppercase; white-space: nowrap; }
.m-tl { left: var(--m); top: 20px; } .m-bl { left: var(--m); bottom: 22px; } .m-br { right: var(--m); bottom: 22px; }
.tag { font: 500 13px/1.5 var(--sans); letter-spacing: .1em; text-transform: uppercase; }

.caps { font-family: var(--sans); font-weight: 400; text-transform: uppercase; letter-spacing: -.012em; line-height: .88; }
.serif-l { font-family: var(--serif); font-weight: 300; letter-spacing: -.012em; line-height: 1.1; }
.body { font-family: var(--serif); font-size: 22px; line-height: 1.42; }

.ph { background: repeating-conic-gradient(var(--ph-b) 0 25%, var(--ph-a) 0 50%) 0 0 / calc(var(--sq) * 2) calc(var(--sq) * 2); }
.ph.big { --sq: 77px; }
.pic { object-fit: cover; }

/* Title band: blue band, red bar, green lower field (cover, two-column, closing). */
.band, .bar, .lower { position: absolute; left: 0; }
.band { top: 0; height: var(--band); background: var(--blue); padding: 27px var(--m) 0; }
.bar { top: var(--band); height: var(--bar); background: var(--red); }
.lower { top: calc(var(--band) + var(--bar)); bottom: 0; background: var(--green); padding: 30px var(--m) 0; }
.full-w .band, .full-w .bar, .full-w .lower { right: 0; }
.cover .band, .cover .bar, .cover .lower { width: var(--split); }
.cover .shot { position: absolute; left: var(--split); top: 0; width: calc(1280px - var(--split)); height: 720px; }
.cover .m-br { right: calc(1280px - var(--split) + var(--m)); }
.speaker { font-size: 46px; font-weight: 300; line-height: 1.1; letter-spacing: -.01em; }
.cover .sub { margin-top: 26px; max-width: 520px; font-size: 20px; line-height: 1.5; }
.closing .lower p.speaker { max-width: 1000px; }
.closing .contact { margin-top: 22px; font-size: 22px; }

.agenda h2 { position: absolute; left: 0; top: 0; width: var(--split); height: 720px; display: grid; place-items: center; font-size: 66px; font-weight: 400; text-transform: uppercase; letter-spacing: .01em; line-height: 1; padding: 0 var(--m); text-align: center; }
.vr { position: absolute; left: var(--split); top: 0; bottom: 0; width: 1px; background: currentColor; }
.agenda ol { position: absolute; left: 733px; right: var(--m); top: 0; bottom: 0; list-style: none; display: flex; flex-direction: column; justify-content: center; gap: 26px; font: 400 18px/25px var(--sans); letter-spacing: .03em; }
.agenda li span { display: block; }

.section .num { position: absolute; left: 20px; top: 52px; font-size: 280px; font-weight: 300; line-height: .8; letter-spacing: -.03em; }
.section .foot { position: absolute; left: var(--m); right: 120px; bottom: 72px; }
.section h2 { font-size: 66px; }
.section .lead { margin-top: 18px; font-size: 24px; line-height: 1.4; }
.section.olive .head { position: absolute; left: var(--m); right: 120px; top: 64px; }
.section.olive .num { top: auto; bottom: 46px; font-size: 230px; }

.statement .wrap, .quote .wrap { position: absolute; left: var(--m); right: 120px; top: 0; bottom: 0; display: flex; flex-direction: column; justify-content: center; }
.statement .wrap .tag, .quote .wrap .tag { margin-top: 34px; }
.quote .wrap { left: 93px; }
.quote blockquote { text-indent: -.42em; }

.text h2, .points h2, .metrics h2, .timeline h2 { position: absolute; left: var(--m); right: var(--m); top: 52px; }
.text .body { position: absolute; left: var(--m); top: 400px; width: 640px; }

.cols { position: absolute; left: 0; right: 0; display: grid; grid-template-columns: repeat(var(--n), 1fr); }
.cols > div { padding: 0 32px 0 53px; border-left: 1px solid var(--rule); }
.cols > div:first-child { padding-left: var(--m); border-left: 0; }
.points .cols { top: 200px; bottom: 170px; }
.points .numeral { font-size: 100px; font-weight: 300; line-height: 1; letter-spacing: -.02em; }
.points h3 { margin-top: 26px; font-size: 33px; font-weight: 400; line-height: 1.3; }
.points p { margin-top: 10px; font-size: 21px; line-height: 1.45; color: var(--muted); }
.metrics .cols { top: 270px; bottom: 110px; }
.metrics .cols > div { border-color: rgba(0,0,0,.4); display: flex; flex-direction: column; justify-content: flex-end; }
.metrics .value { font-weight: 300; line-height: 1; letter-spacing: -.03em; white-space: nowrap; }
.metrics .label { margin-top: 18px; font-size: 24px; line-height: 1.3; }

.image-text .frame { position: absolute; left: 102px; top: 125px; width: 448px; height: 467px; }
.image-text .copy { position: absolute; left: 708px; right: 64px; top: 160px; }
.image-text h2 { font-size: 72px; line-height: 1.03; }
.image-text .body { margin-top: 44px; font-size: 20px; line-height: 1.6; }

.two-col .lower { display: grid; grid-template-columns: 1fr 1fr; gap: 53px; padding-top: 34px; }
.two-col h3 { font-size: 42px; }
.two-col .body { margin-top: 14px; max-width: 520px; }

.timeline .steps { position: absolute; left: var(--m); right: var(--m); top: 290px; display: grid; grid-template-columns: repeat(var(--n), 1fr); }
.timeline .when { font-size: 60px; font-weight: 300; line-height: 1; letter-spacing: -.02em; padding-bottom: 22px; }
.timeline .txt { border-top: 1px solid var(--ink); padding: 24px 32px 0 0; }
.timeline h3 { font-size: 28px; font-weight: 400; line-height: 1.25; }
.timeline .txt p { margin-top: 8px; font-size: 20px; color: var(--muted); }

.table h2 { position: absolute; left: 120px; right: 120px; top: 62px; text-align: center; font-size: 60px; }
.tablewrap { position: absolute; left: 237px; right: 237px; top: 170px; bottom: 60px; display: flex; flex-direction: column; justify-content: center; }
.card { background: var(--card); border-radius: 20px; padding: 30px 32px 32px; font-family: var(--sans); }
.card .tr { display: grid; grid-template-columns: 1.3fr repeat(calc(var(--n) - 1), 1fr); align-items: center; gap: 16px; padding: 0 16px; }
.card .th { font-size: 17px; font-weight: 600; padding-bottom: 6px; }
.card .row { min-height: 46px; margin-top: 14px; background: var(--row); border-radius: 5px; font-size: 16px; }
.card .row span:first-child { font-weight: 500; }
.card .row span:not(:first-child), .card .th span:not(:first-child) { text-align: right; }

.big .num { position: absolute; left: 0; top: 0; width: var(--split); height: 720px; display: grid; place-items: center; font-weight: 300; line-height: 1; letter-spacing: -.04em; white-space: nowrap; }
.big .what { position: absolute; left: 733px; right: 80px; top: 0; bottom: 0; display: flex; flex-direction: column; justify-content: center; }
.big h2 { font-size: 60px; }
.big .body { margin-top: 26px; }

.bullets h2 { position: absolute; left: var(--m); right: calc(1280px - var(--split) + 40px); top: 60px; font-size: 72px; line-height: 1.04; }
.bullets ol { position: absolute; left: 708px; right: 64px; top: 0; bottom: 0; list-style: none; display: flex; flex-direction: column; justify-content: center; }
.bullets li { display: grid; grid-template-columns: 52px 1fr; align-items: baseline; padding: var(--pad, 20px) 0; border-top: 1px solid var(--rule); line-height: 1.3; }
.bullets li:first-child { border-top: 0; }
.bullets li b { font: 400 15px/1 var(--sans); letter-spacing: .06em; }

.team h2 { position: absolute; left: var(--m); top: 56px; font-size: 58px; }
.people { position: absolute; display: grid; gap: 25px; }
.team .people { left: var(--m); right: var(--m); top: 156px; grid-template-columns: repeat(var(--n), 1fr); }
.team .face { width: 100%; height: 380px; display: block; }
.team.pair h2 { top: 64px; width: 380px; font-size: 66px; line-height: 1.06; }
.team.pair .people { left: 444px; right: var(--m); top: 67px; grid-template-columns: 1fr 1fr; }
.team.pair .face { height: 448px; }
.person b { display: block; margin-top: 14px; font-size: 22px; font-weight: 400; line-height: 1.2; }
.person span { display: block; margin-top: 6px; font: 400 17px/1.3 var(--sans); letter-spacing: .02em; }

.image .frame { position: absolute; left: var(--m); top: 64px; width: calc(1280px - 2 * var(--m)); height: 590px; }
.image .cap { position: absolute; left: 280px; right: 280px; bottom: 22px; text-align: center; font: 500 13px/1.4 var(--sans); letter-spacing: .1em; text-transform: uppercase; }

.framed { display: flex; flex-direction: column; padding: 52px var(--m) 70px; }
.framed .avn-body { margin-top: 30px; }
`
}

export const slides = {
  cover: (d, ctx) => {
    const lines = [ctx.deck.presenter, d.eyebrow].filter(Boolean)
    return `<section class="slide cover">
    <div class="band">${caps('h1', d.title, ctx, 586, 106, 3)}</div><div class="bar"></div>
    <div class="lower">${lines.length ? `<p class="speaker">${lines.map((l) => ctx.esc(l)).join('<br>')}</p>` : ''}${d.subtitle ? `<p class="sub">${ctx.esc(d.subtitle)}</p>` : ''}</div>
    ${picture({ alt: d.title }, ctx, 'shot ph big')}${meta(ctx, { top: '' })}</section>`
  },

  agenda: (d, ctx) => `<section class="slide dark agenda"><h2>${ctx.esc(d.title)}</h2><div class="vr"></div>
    <ol>${d.items.map((item, i) => `<li><span>${String(i + 1).padStart(2, '0')}</span><span>${ctx.esc(item)}</span></li>`).join('')}</ol>${meta(ctx, { top: '' })}</section>`,

  section: (d, ctx) => {
    const olive = Number.parseInt(d.number, 10) % 2 === 0
    const words = `<h2 class="serif-l" style="font-size:${serifSize(d.title, 66)}px">${ctx.esc(d.title)}</h2>${d.subtitle ? `<p class="lead">${ctx.esc(d.subtitle)}</p>` : ''}`
    return olive
      ? `<section class="slide olive section"><div class="head">${words}</div><span class="num">${ctx.esc(d.number)}</span>${meta(ctx, { top: '' })}</section>`
      : `<section class="slide blue section"><span class="num">${ctx.esc(d.number)}</span><div class="foot">${words}</div>${meta(ctx, { top: '' })}</section>`
  },

  statement: (d, ctx) => `<section class="slide red statement"><div class="wrap">
    <p class="serif-l" style="font-size:${serifSize(d.text, 66)}px">${ctx.esc(d.text)}</p>${d.attribution ? `<span class="tag">${ctx.esc(d.attribution)}</span>` : ''}</div>${meta(ctx)}</section>`,

  text: (d, ctx) => `<section class="slide text">${caps('h2', d.title, ctx, 1226, 104, 2)}
    <p class="body">${ctx.esc(d.body)}</p>${meta(ctx, d.eyebrow ? { top: d.eyebrow } : {})}</section>`,

  points: (d, ctx) => `<section class="slide points">${caps('h2', d.title, ctx, 1226, 64, 1)}
    <div class="cols" style="--n:${d.items.length}">${d.items.map((item, i) => `<div><span class="numeral">${i + 1}.</span><h3>${ctx.esc(item.title)}</h3><p>${ctx.esc(item.body)}</p></div>`).join('')}</div>${meta(ctx)}</section>`,

  'image-text': (d, ctx) => `<section class="slide image-text"><div class="panel l red">${picture(d.image, ctx, 'frame ph')}</div><div class="panel r blue"></div>
    <div class="copy"><h2 class="serif-l">${ctx.esc(d.title)}</h2><p class="body">${ctx.esc(d.body)}</p></div>${meta(ctx)}</section>`,

  metrics: (d, ctx) => {
    const n = d.items.length
    const col = 1226 / n - 60
    const longest = Math.max(...d.items.map((m) => String(m.value).length))
    const size = Math.floor(Math.min(130, col / (longest * 0.56)))
    return `<section class="slide green metrics">${caps('h2', d.title, ctx, 1226, 64, 1)}
    <div class="cols" style="--n:${n}">${d.items.map((m) => `<div><span class="value" style="font-size:${size}px">${ctx.esc(m.value)}</span><p class="label">${ctx.esc(m.label)}</p></div>`).join('')}</div>${meta(ctx)}</section>`
  },

  'two-column': (d, ctx) => `<section class="slide two-col full-w"><div class="band">${caps('h2', d.title, ctx, 1226, 106, 2)}</div><div class="bar"></div>
    <div class="lower">${d.columns.map((c) => `<div><h3 class="serif-l">${ctx.esc(c.title)}</h3><p class="body">${ctx.esc(c.body)}</p></div>`).join('')}</div>${meta(ctx)}</section>`,

  timeline: (d, ctx) => `<section class="slide timeline">${caps('h2', d.title, ctx, 1226, 64, 1)}
    <div class="steps" style="--n:${d.steps.length}">${d.steps.map((s) => `<div><span class="when">${ctx.esc(s.when)}</span><div class="txt"><h3>${ctx.esc(s.title)}</h3>${s.body ? `<p>${ctx.esc(s.body)}</p>` : ''}</div></div>`).join('')}</div>${meta(ctx)}</section>`,

  quote: (d, ctx) => `<section class="slide green quote"><div class="wrap">
    <blockquote class="serif-l" style="font-size:${serifSize(d.text, 64)}px">“${ctx.esc(d.text)}”</blockquote>
    <span class="tag">${ctx.esc(d.name)}${d.role ? ` · ${ctx.esc(d.role)}` : ''}</span></div>${meta(ctx)}</section>`,

  table: (d, ctx) => `<section class="slide blue table"><h2 class="serif-l">${ctx.esc(d.title)}</h2>
    <div class="tablewrap"><div class="card" style="--n:${d.columns.length}"><div class="tr th">${d.columns.map((c) => `<span>${ctx.esc(c)}</span>`).join('')}</div>
    ${d.rows.map((r) => `<div class="tr row">${r.map((c) => `<span>${ctx.esc(c)}</span>`).join('')}</div>`).join('')}</div></div>${meta(ctx)}</section>`,

  'big-number': (d, ctx) => {
    const size = Math.floor(Math.min(320, 540 / (String(d.value).length * 0.62)))
    return `<section class="slide dark big"><span class="num" style="font-size:${size}px">${ctx.esc(d.value)}</span><div class="vr"></div>
    <div class="what"><h2 class="serif-l">${ctx.esc(d.label)}</h2>${d.body ? `<p class="body">${ctx.esc(d.body)}</p>` : ''}</div>${meta(ctx)}</section>`
  },

  bullets: (d, ctx) => `<section class="slide bullets"><div class="panel l green"></div><h2 class="serif-l">${ctx.esc(d.title)}</h2>
    <ol style="${d.items.length > 4 ? 'font-size:23px;--pad:13px' : 'font-size:28px'}">${d.items.map((item, i) => `<li><b>${String(i + 1).padStart(2, '0')}</b><span>${ctx.esc(item)}</span></li>`).join('')}</ol>${meta(ctx)}</section>`,

  team: (d, ctx) => {
    const pair = d.people.length <= 2
    const people = d.people.map((p) => `<div class="person">${picture(p.image ?? { alt: p.name }, ctx, 'face ph')}<b>${ctx.esc(p.name)}</b><span>${ctx.esc(p.role)}</span></div>`).join('')
    return `<section class="slide ${pair ? 'green team pair' : 'blue team'}"><h2 class="serif-l">${ctx.esc(d.title)}</h2>
    <div class="people" style="--n:${d.people.length}">${people}</div>${meta(ctx)}</section>`
  },

  image: (d, ctx) => `<section class="slide red image">${picture(d.image, ctx, 'frame ph big')}
    ${d.caption ? `<p class="cap">${ctx.esc(d.caption)}</p>` : ''}${meta(ctx)}</section>`,

  /** The titled content slide that `chart` and `custom` slides are drawn in: cream, caps title, corner meta. */
  frame: ({ title, eyebrow }, ctx, body) => `<section class="slide framed">${title ? caps('h2', title, ctx, 1226, 88, 1) : ''}${body}${meta(ctx, eyebrow ? { top: eyebrow } : {})}</section>`,

  closing: (d, ctx) => `<section class="slide closing full-w"><div class="band">${caps('h2', d.title, ctx, 1226, 106, 2)}</div><div class="bar"></div>
    <div class="lower">${d.subtitle ? `<p class="speaker">${ctx.esc(d.subtitle)}</p>` : ''}${d.contact ? `<p class="contact">${ctx.esc(d.contact)}</p>` : ''}</div>${meta(ctx, { top: '' })}</section>`,
}
