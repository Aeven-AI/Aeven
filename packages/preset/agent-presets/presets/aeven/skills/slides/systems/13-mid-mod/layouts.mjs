/**
 * Mid Mod: flat mid-century colour blocks with no gradients or rounding. Olive title bands carry
 * a heavy extended display face with small extended-sans corner meta; pink note boxes hold small
 * serif copy; agendas stack full-width part bands (sky, olive, pink) with huge wide numerals;
 * section slides split into a coloured half (sky with a yellow square, or moss with two sky
 * semicircles) and a huge numeral half; metrics sit right-aligned on thick black rules; key
 * points are full-height colour columns. Corner meta sits at the quarter points of the footer.
 * Measured from the 16 frames of Figma's "Mid Mod" Slides template (Figma Community).
 *
 * Colour rhythm: the nth slide of a kind takes the nth entry of that kind's colour list.
 */

/** How many earlier slides in the deck share this slide's kind. */
const nth = (kind, ctx) => ctx.deck.slides.slice(0, ctx.index - 1).filter((s) => s.kind === kind).length

/** Column, band and cell fields in the order the source deck uses them. */
const ROW = ['sky', 'olive', 'pink', 'yellow', 'cream', 'orange']
const SQUARES = ['yellow', 'red', 'pink', 'sky']
const GRID = ['sky', 'cream', 'olive', 'yellow', 'pink', 'orange']
const QUAD = ['sky', 'olive', 'yellow', 'pink']

/**
 * A font size that keeps `text` within `lines` lines of `width` px, assuming an average advance
 * of `em` × size per character, clamped to [min, max].
 */
function fit(text, { width, lines, max, min, em }) {
  const str = String(text)
  const byLines = ((width * lines) / (Math.max(str.length, 1) * em)) * 0.86
  const word = Math.max(1, ...str.split(/\s+/).map((w) => w.length))
  const byWord = width / (word * em * 1.12)
  return Math.round(Math.max(min, Math.min(max, byLines, byWord)))
}

/** Section numbers print without leading zeros, as in the source ("01" → "1"). */
const numeral = (value) => (/^\d+$/.test(String(value)) ? String(Number(value)) : String(value))

/** Footer meta at the quarter points: deck title left, date right, an optional label centred. */
const foot = (ctx, centre = '') => {
  const { title, date } = ctx.deck
  return `<div class="foot">${title ? `<span class="meta q1">${ctx.esc(title)}</span>` : ''}${centre ? `<span class="meta q2">${ctx.esc(centre)}</span>` : ''}${date ? `<span class="meta q3">${ctx.esc(date)}</span>` : ''}</div>`
}

/** A top-centred caps label, as above the source's metric and insight slides. */
const label = (text, ctx) => (text ? `<span class="meta top">${ctx.esc(text)}</span>` : '')

/** The olive title band with corner meta: the source's cover header, reused as the content-slide title. */
const band = (title, ctx, { left, right, cls = '' } = {}) => `<header class="band ${cls}">
    <div class="corners">${left ? `<span class="meta">${ctx.esc(left)}</span>` : '<span></span>'}${right ? `<span class="meta">${ctx.esc(right)}</span>` : ''}</div>
    <h2 class="wide" style="font-size:${fit(title, { width: 1160, lines: 2, max: 72, min: 40, em: 0.92 })}px">${ctx.esc(title)}</h2></header>`

/**
 * A user picture, or a flat placeholder in the system's shapes: `arch` is a moss field with a sky
 * semicircle rising from the bottom edge, `square` a sky field with a yellow square.
 */
function picture(image, ctx, cls, variant = 'arch') {
  const src = ctx.image(image)
  return src
    ? `<img class="${cls}" src="${ctx.esc(src)}" alt="${ctx.esc(image.alt ?? '')}">`
    : `<div class="${cls} ph ph-${variant}" role="img" aria-label="${ctx.esc(image?.alt ?? '')}"><i></i></div>`
}

export function css(system) {
  const c = system.colors
  return `
:root { --olive: ${c.olive}; --moss: ${c.moss}; --sky: ${c.sky}; --pink: ${c.pink}; --yellow: ${c.yellow};
  --cream: ${c.cream}; --red: ${c.red}; --orange: ${c.orange}; --black: ${c.black}; --m: ${system.geometry.margin}px;
  --rule: ${system.geometry.rule}px; --sans: "Unbounded", Arial, sans-serif; }
.slide { background: var(--cream); color: var(--black); font-size: ${system.type.body}px; line-height: 1.3; }
.f-sky { background: var(--sky); } .f-olive { background: var(--olive); } .f-pink { background: var(--pink); }
.f-yellow { background: var(--yellow); } .f-cream { background: var(--cream); } .f-orange { background: var(--orange); }
.f-moss { background: var(--moss); } .f-red { background: var(--red); } .f-black { background: var(--black); }

.meta { font-family: var(--sans); font-size: ${system.type.meta}px; font-weight: 400; text-transform: uppercase; letter-spacing: .01em; line-height: 1; white-space: nowrap; }
.foot { position: absolute; left: 0; right: 0; bottom: 0; height: 0; }
.foot .meta, .meta.top { position: absolute; transform: translateX(-50%); z-index: 2; }
.foot .meta { bottom: 22px; }
.q1 { left: 25%; } .q2 { left: 50%; } .q3 { left: 75%; }
.meta.top { top: 23px; left: 50%; }
.wide { font-family: var(--display-font); font-weight: 800; letter-spacing: -.035em; line-height: .9; }
.serif { font-weight: 400; letter-spacing: -.012em; line-height: 1.04; }
.num { font-family: var(--sans); font-weight: 500; line-height: 1; font-variant-numeric: lining-nums; }

.band { position: relative; flex: none; background: var(--olive); display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; padding: 58px 48px 34px; min-height: 200px; }
.corners { position: absolute; left: var(--m); right: var(--m); top: 23px; display: flex; justify-content: space-between; }
.band h2 { max-width: 1180px; }

.ph { position: relative; overflow: hidden; container-type: size; }
.ph i { position: absolute; left: 50%; }
.ph-arch { background: var(--moss); }
.ph-arch i { bottom: 0; width: min(62cqw, 150cqh); aspect-ratio: 1; border-radius: 50%; background: var(--sky); transform: translate(-50%, 50%); }
.ph-square { background: var(--sky); }
.ph-square i { top: 50%; width: min(42cqw, 62cqh); aspect-ratio: 1; background: var(--yellow); transform: translate(-50%, -50%); }
img.media, .media { width: 100%; height: 100%; object-fit: cover; }

/* cover and closing: olive header band over a picture and a pink note box */
.cover, .closing { display: flex; flex-direction: column; }
.cover .band, .closing .band { height: ${system.geometry.coverBand}px; padding-top: 52px; padding-bottom: 20px; }
.cover .band h1, .closing .band h2 { max-width: 1220px; line-height: .86; }
.lower { flex: 1; display: grid; grid-template-columns: 841px 1fr; min-height: 0; }
.closing .lower { grid-template-columns: 1fr 1fr; }
.note { padding: 46px 32px 32px; font-size: 23px; line-height: 1.3; }
.closing .note { font-size: 34px; line-height: 1.15; padding: 40px var(--m); }

/* agenda: stacked full-width part bands */
.agenda { display: flex; flex-direction: column; }
.agenda .part { flex: 1; position: relative; display: flex; justify-content: space-between; padding: 22px var(--m) 0; min-height: 0; }
.agenda .part h3 { font-family: var(--font); font-size: var(--lab); }
.agenda .part .num { position: absolute; right: var(--m); top: 0; font-size: var(--big); line-height: normal; }

/* section: coloured half with title and shape, numeral half */
.section { display: grid; grid-template-columns: 1fr 1fr; }
.section .half { position: relative; display: flex; flex-direction: column; align-items: center; text-align: center; }
.section .lead { position: relative; z-index: 1; padding: 22px var(--m) 0; display: flex; flex-direction: column; align-items: center; gap: 14px; }
.section h2 { font-family: var(--font); }
.section .sub { font-size: 24px; line-height: 1.25; max-width: 470px; }
.section .sq { margin-top: auto; margin-bottom: 57px; width: 400px; height: 400px; background: var(--yellow); flex: none; }
.section .has-sub .sq { width: 340px; height: 340px; }
.section .discs { background: radial-gradient(circle 307px at 50% 0, var(--sky) 99.7%, transparent 100%), radial-gradient(circle 307px at 50% 100%, var(--sky) 99.7%, transparent 100%), var(--moss); }
.section .big { justify-content: flex-start; }
.section .big .num { font-weight: 800; letter-spacing: -.04em; line-height: normal; }

/* statement and quote: one colour field, a large centred serif line */
.statement, .quote { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 60px 90px 70px; }
.statement p, .quote p { font-family: var(--font); line-height: 1.1; letter-spacing: -.012em; max-width: 1100px; text-wrap: balance; }
.quote .by { margin-top: 34px; display: flex; flex-direction: column; gap: 10px; align-items: center; }
.quote .by b { font-family: var(--sans); font-weight: 600; font-size: 18px; text-transform: uppercase; }
.quote .by span { font-size: 22px; }

/* split slides: text, metrics, big number */
.split { display: grid; grid-template-columns: 1fr 1fr; }
.split .half { position: relative; display: flex; flex-direction: column; padding: 102px var(--m) 70px; min-width: 0; }
.split h2 { font-family: var(--font); }
.split .copy { font-size: 28px; line-height: 1.3; }
.split .copy + .copy, .split h2 + .copy { margin-top: 26px; }
.rows { display: flex; flex-direction: column; flex: 1; margin-top: -28px; margin-bottom: 30px; }
.rows .row { flex: 1; display: flex; flex-direction: column; justify-content: space-between; border-bottom: var(--rule) solid currentColor; padding-top: 10px; min-height: 0; }
.rows .row span { font-family: var(--sans); font-weight: 600; font-size: 18px; }
.rows .row b { align-self: flex-end; font-family: var(--sans); font-weight: 800; letter-spacing: -.03em; line-height: .82; margin-bottom: 4px; white-space: nowrap; }
.dark { background: var(--black); color: var(--sky); }
.dark .half { background: var(--black); }
.bigvalue { margin-top: auto; align-self: stretch; text-align: right; border-bottom: var(--rule) solid currentColor; padding-bottom: 6px; }
.bigvalue b { font-family: var(--sans); font-weight: 800; letter-spacing: -.04em; line-height: .8; white-space: nowrap; }

/* points and bullets: full-height colour columns and cells */
.cols { display: grid; grid-template-columns: repeat(var(--cols), 1fr); grid-auto-rows: 1fr; }
.cell { position: relative; display: flex; flex-direction: column; align-items: center; text-align: center; padding: 79px 38px 60px; min-width: 0; min-height: 0; }
.cell .num { font-size: 20px; font-weight: 600; }
.cell h3 { font-family: var(--font); margin-top: 20px; min-height: 2.08em; display: flex; align-items: center; justify-content: center; }
.cell .tile { width: 224px; height: 224px; flex: none; margin-top: 22px; }
.cell .copy { margin-top: 24px; align-self: stretch; text-align: left; font-size: 22px; line-height: 1.28; }
.grid .cell { justify-content: center; padding: 52px 38px; }
.grid .cell .copy { text-align: center; font-size: var(--size); line-height: 1.15; margin-top: 16px; }

/* band slides: two-column, timeline, table, team, frame */
.banded { display: flex; flex-direction: column; }
.content { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 34px 64px 44px; }
.pair { flex: 1; display: grid; grid-template-columns: 1fr 1fr; min-height: 0; }
.pair .block { padding: 40px var(--m) 40px; display: flex; flex-direction: column; gap: 18px; }
.pair h3 { font-family: var(--font); font-size: 52px; }
.pair p { font-size: 26px; line-height: 1.3; max-width: 520px; }
.steps { flex: 1; display: grid; grid-template-columns: repeat(var(--n), 1fr); gap: 0 28px; align-content: center; }
.steps .step { display: flex; flex-direction: column; min-width: 0; }
.steps .when { font-family: var(--sans); font-weight: 800; font-size: 76px; letter-spacing: -.03em; line-height: .9; padding-bottom: 16px; border-bottom: var(--rule) solid var(--black); white-space: nowrap; }
.steps h3 { font-family: var(--font); font-size: 44px; margin-top: 22px; }
.steps p { font-size: 23px; margin-top: 8px; line-height: 1.28; }
table { width: 100%; border-collapse: collapse; margin: auto 0; }
th { font-family: var(--sans); font-weight: 600; font-size: 15px; text-transform: uppercase; text-align: left; padding: 0 16px 12px 0; border-bottom: var(--rule) solid var(--black); }
td { font-size: 26px; padding: 15px 16px 13px 0; border-bottom: var(--rule) solid var(--black); }
td:first-child { font-family: var(--sans); font-weight: 600; font-size: 18px; text-transform: uppercase; width: 22%; }
.people { flex: 1; display: grid; grid-template-columns: repeat(var(--n), 1fr); gap: 28px; align-items: center; }
.person { display: flex; flex-direction: column; align-items: center; text-align: center; min-width: 0; }
.person .face { width: min(100%, 236px); aspect-ratio: 1; object-fit: cover; }
.person b { font-weight: 400; font-size: 30px; margin-top: 16px; line-height: 1.1; }
.person span { font-family: var(--sans); font-size: 13px; text-transform: uppercase; margin-top: 10px; }

/* pictures */
.image-text { display: grid; grid-template-columns: 841px 1fr; }
.image-text .note { display: flex; flex-direction: column; gap: 20px; padding-top: 58px; }
.image-text h2 { font-family: var(--font); font-size: 48px; }
.image-text p { font-size: 23px; line-height: 1.3; }
.full .cap { position: absolute; right: 0; bottom: 0; width: 439px; background: var(--pink); padding: 28px 32px 32px; font-size: 23px; line-height: 1.3; }

.framed .content { padding-top: 30px; }
`
}

export const slides = {
  cover: (d, ctx) => `<section class="slide cover">
    <header class="band"><div class="corners"><span class="meta">${ctx.esc(d.eyebrow ?? ctx.deck.presenter ?? '')}</span><span class="meta">${ctx.esc(ctx.deck.date ?? '')}</span></div>
    <h1 class="wide" style="font-size:${fit(d.title, { width: 1200, lines: 2, max: 176, min: 72, em: 0.92 })}px">${ctx.esc(d.title)}</h1></header>
    <div class="lower">${picture(null, ctx, 'media', 'arch')}<div class="note f-pink">${d.subtitle ? `<p>${ctx.esc(d.subtitle)}</p>` : ''}</div></div></section>`,

  agenda: (d, ctx) => {
    const h = 720 / d.items.length
    return `<section class="slide agenda" style="--lab:${Math.round(Math.min(50, h * 0.36))}px;--big:${Math.floor(h / 1.24)}px">${d.items.map((item, i) => `<div class="part f-${ROW[i % ROW.length]}"><h3 class="serif">${ctx.esc(item)}</h3><span class="num">${i + 1}</span></div>`).join('')}
    ${foot(ctx, d.title)}</section>`
  },

  section: (d, ctx) => {
    const n = numeral(d.number)
    const size = Math.floor(Math.min(718 / 1.24, 860 / Math.max(n.length, 1.4)))
    const title = `<h2 class="serif" style="font-size:${fit(d.title, { width: 580, lines: 1, max: 96, min: 52, em: 0.56 })}px">${ctx.esc(d.title)}</h2>${d.subtitle ? `<p class="sub">${ctx.esc(d.subtitle)}</p>` : ''}`
    const big = (field) => `<div class="half big f-${field}"><span class="num" style="font-size:${size}px">${ctx.esc(n)}</span><span class="foot"><span class="meta" style="left:50%;bottom:22px;position:absolute;transform:translateX(-50%)">${ctx.esc(ctx.deck.date ?? '')}</span></span></div>`
    const leftFoot = `<span class="meta" style="left:50%;bottom:22px;position:absolute;transform:translateX(-50%);z-index:2">${ctx.esc(ctx.deck.title ?? '')}</span>`
    return nth('section', ctx) % 2 === 0
      ? `<section class="slide section"><div class="half f-sky${d.subtitle ? ' has-sub' : ''}"><div class="lead">${title}</div><div class="sq"></div>${leftFoot}</div>${big('cream')}</section>`
      : `<section class="slide section"><div class="half discs"><div class="lead">${title}</div>${leftFoot}</div>${big('yellow')}</section>`
  },

  statement: (d, ctx) => `<section class="slide statement f-pink">${label(d.attribution, ctx)}
    <p style="font-size:${fit(d.text, { width: 1100, lines: 4, max: 84, min: 44, em: 0.47 })}px">${ctx.esc(d.text)}</p>${foot(ctx)}</section>`,

  text: (d, ctx) => `<section class="slide split"><div class="half f-sky">${label(d.eyebrow, ctx)}
    <h2 class="serif" style="font-size:${fit(d.title, { width: 590, lines: 3, max: 76, min: 44, em: 0.5 })}px">${ctx.esc(d.title)}</h2></div>
    <div class="half f-pink"><p class="copy">${ctx.esc(d.body)}</p></div>${foot(ctx)}</section>`,

  points: (d, ctx) => `<section class="slide cols" style="--cols:${d.items.length}">${d.items.map((item, i) => `<div class="cell f-${GRID[i % GRID.length]}">
    ${i === Math.floor(d.items.length / 2) ? label(d.title, ctx) : ''}
    <span class="num">${i + 1}</span><h3 class="serif" style="font-size:${fit(item.title, { width: 270, lines: 2, max: 56, min: 34, em: 0.47 })}px;max-width:230px">${ctx.esc(item.title)}</h3>
    <div class="tile f-${SQUARES[i % SQUARES.length]}"></div><p class="copy">${ctx.esc(item.body)}</p></div>`).join('')}${foot(ctx)}</section>`,

  'image-text': (d, ctx) => `<section class="slide image-text">${picture(d.image, ctx, 'media', 'square')}
    <div class="note f-pink"><h2 class="serif">${ctx.esc(d.title)}</h2><p>${ctx.esc(d.body)}</p></div></section>`,

  metrics: (d, ctx) => {
    const dark = nth('metrics', ctx) % 2 === 1
    const widest = Math.max(...d.items.map((m) => String(m.value).length))
    const size = Math.round(Math.min(96, 560 / (widest * 0.86), 470 / d.items.length * 0.62))
    return `<section class="slide split${dark ? ' dark' : ''}"><div class="half${dark ? '' : ' f-sky'}">
    <h2 class="serif" style="font-size:${fit(d.title, { width: 590, lines: 3, max: 76, min: 44, em: 0.5 })}px">${ctx.esc(d.title)}</h2></div>
    <div class="half${dark ? '' : ' f-cream'}"><div class="rows">${d.items.map((m) => `<div class="row"><span>${ctx.esc(m.label)}</span><b style="font-size:${size}px">${ctx.esc(m.value)}</b></div>`).join('')}</div></div>${foot(ctx)}</section>`
  },

  'two-column': (d, ctx) => `<section class="slide banded">${band(d.title, ctx, { left: ctx.deck.title, right: ctx.deck.date })}
    <div class="pair">${d.columns.map((c, i) => `<div class="block f-${['sky', 'pink'][i % 2]}"><h3 class="serif">${ctx.esc(c.title)}</h3><p>${ctx.esc(c.body)}</p></div>`).join('')}</div></section>`,

  timeline: (d, ctx) => `<section class="slide banded">${band(d.title, ctx, { left: ctx.deck.title, right: ctx.deck.date })}
    <div class="content"><div class="steps" style="--n:${d.steps.length}">${d.steps.map((s) => `<div class="step"><span class="when">${ctx.esc(s.when)}</span><h3 class="serif">${ctx.esc(s.title)}</h3>${s.body ? `<p>${ctx.esc(s.body)}</p>` : ''}</div>`).join('')}</div></div></section>`,

  quote: (d, ctx) => `<section class="slide quote f-sky">${label(d.role, ctx)}
    <p style="font-size:${fit(d.text, { width: 1100, lines: 4, max: 68, min: 40, em: 0.47 })}px">“${ctx.esc(d.text)}”</p>
    <div class="by"><b>${ctx.esc(d.name)}</b></div>${foot(ctx)}</section>`,

  table: (d, ctx) => `<section class="slide banded">${band(d.title, ctx, { left: ctx.deck.title, right: ctx.deck.date })}
    <div class="content"><table><thead><tr>${d.columns.map((c) => `<th>${ctx.esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${d.rows.map((r) => `<tr>${r.map((c) => `<td>${ctx.esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`,

  'big-number': (d, ctx) => {
    const size = Math.round(Math.min(330, 560 / (String(d.value).length * 0.8)))
    return `<section class="slide split dark"><div class="half">
    <h2 class="serif" style="font-size:${fit(d.label, { width: 590, lines: 3, max: 76, min: 44, em: 0.5 })}px">${ctx.esc(d.label)}</h2>${d.body ? `<p class="copy">${ctx.esc(d.body)}</p>` : ''}</div>
    <div class="half"><div class="bigvalue"><b style="font-size:${size}px">${ctx.esc(d.value)}</b></div></div>${foot(ctx)}</section>`
  },

  bullets: (d, ctx) => {
    const n = d.items.length
    const cols = n <= 3 ? n : n === 4 ? 2 : 3
    const cells = Math.ceil(n / cols) * cols
    const labelAt = cols % 2 ? Math.floor(cols / 2) : 0
    const size = cols === 2 ? 40 : 34
    return `<section class="slide cols grid" style="--cols:${cols};--size:${size}px">${Array.from({ length: cells }, (_, i) => `<div class="cell f-${(cols === 2 ? QUAD : GRID)[i % (cols === 2 ? QUAD : GRID).length]}">
    ${i === labelAt ? label(d.title, ctx) : ''}${i < n ? `<span class="num">${i + 1}</span><p class="copy">${ctx.esc(d.items[i])}</p>` : ''}</div>`).join('')}${foot(ctx)}</section>`
  },

  team: (d, ctx) => `<section class="slide banded">${band(d.title, ctx, { left: ctx.deck.title, right: ctx.deck.date })}
    <div class="content"><div class="people" style="--n:${d.people.length}">${d.people.map((p, i) => {
      const src = p.image && ctx.image(p.image)
      const face = src
        ? `<img class="face" src="${ctx.esc(src)}" alt="${ctx.esc(p.name)}">`
        : `<div class="face f-${SQUARES[i % SQUARES.length]}" role="img" aria-label="${ctx.esc(p.name)}"></div>`
      return `<div class="person">${face}<b>${ctx.esc(p.name)}</b><span>${ctx.esc(p.role)}</span></div>`
    }).join('')}</div></div></section>`,

  image: (d, ctx) => `<section class="slide full">${picture(d.image, ctx, 'media', 'arch')}${d.caption ? `<p class="cap">${ctx.esc(d.caption)}</p>` : ''}</section>`,

  /** The titled content slide that `chart` and `custom` slides are drawn in: the olive band over a cream field. */
  frame: ({ title, eyebrow }, ctx, body) => `<section class="slide banded framed">${title
    ? band(title, ctx, { left: eyebrow ?? ctx.deck.title, right: ctx.deck.date })
    : `<header class="band" style="min-height:0;padding:22px var(--m)"><div class="corners" style="position:static;width:100%"><span class="meta">${ctx.esc(eyebrow ?? ctx.deck.title ?? '')}</span><span class="meta">${ctx.esc(ctx.deck.date ?? '')}</span></div></header>`}
    <div class="content">${body}</div></section>`,

  closing: (d, ctx) => `<section class="slide closing">
    <header class="band"><div class="corners"><span class="meta">${ctx.esc(ctx.deck.title ?? '')}</span><span class="meta">${ctx.esc(ctx.deck.date ?? '')}</span></div>
    <h2 class="wide" style="font-size:${fit(d.title, { width: 1200, lines: 2, max: 176, min: 72, em: 0.92 })}px">${ctx.esc(d.title)}</h2></header>
    <div class="lower"><div class="note f-pink">${d.subtitle ? `<p>${ctx.esc(d.subtitle)}</p>` : ''}</div><div class="note f-sky">${d.contact ? `<p>${ctx.esc(d.contact)}</p>` : ''}</div></div></section>`,
}
