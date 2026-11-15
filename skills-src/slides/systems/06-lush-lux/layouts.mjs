/**
 * Lush Lux: single saturated colour fields that change slide to slide (orchid pink, cream,
 * burnt orange, acid yellow, ochre, deep olive, blush, mint), large light high-contrast serif
 * caps titles, half-and-half colour splits for lists, centred corner meta pairs (small sans caps
 * label over a serif value) and a footer with the date and deck title at the quarter points.
 * Measured from the 16 frames of Figma's "Lush Lux" Slides template (Figma Community).
 *
 * Colour rhythm: every kind has a list of fields, and the nth slide of a kind in a deck takes
 * the nth entry, so repeated kinds (sections, text slides) keep rotating colour.
 */

/** Fields per kind; `name:title` picks a title tint, `[a, b]` is a left|right split. */
const FIELDS = {
  cover: ['pink', 'cream:gold', 'orange', 'yellow'],
  agenda: [['ochre', 'orange'], ['olive', 'cream'], ['cream', 'blush'], ['olive:pink', 'pink']],
  section: ['cream:gold', 'orange', 'olive:pink', 'yellow', 'pink'],
  statement: ['ochre', 'yellow', 'olive'],
  text: ['olive', 'yellow', 'cream', 'pink'],
  points: ['cream', 'olive'],
  'image-text': [['yellow', 'cream'], ['cream', 'mint']],
  metrics: ['cream', 'olive'],
  'two-column': [['olive:pink', 'pink'], ['cream', 'blush']],
  timeline: ['cream', 'olive'],
  quote: ['yellow', 'pink', 'cream'],
  table: ['blush', 'cream'],
  'big-number': ['orange', 'mint'],
  bullets: [['cream', 'blush'], ['olive', 'cream']],
  team: ['olive', 'cream'],
  image: ['cream', 'olive'],
  closing: ['pink', 'orange'],
  chart: ['cream', 'blush'],
  custom: ['blush', 'cream'],
}

/** Portrait and picture placeholder fields, in the order the source deck shows its colours. */
const SWATCHES = ['pink', 'orange', 'yellow', 'mint', 'ochre', 'blush']

/** The field for this slide: the nth entry of its kind's list, n = earlier slides of the kind. */
function field(kind, ctx) {
  const n = ctx.deck.slides.slice(0, ctx.index - 1).filter((s) => s.kind === kind).length
  const list = FIELDS[kind]
  return list[n % list.length]
}

/** Class names for one field token such as `cream:gold`. */
const fc = (token) => {
  const [name, tint] = token.split(':')
  return `f-${name}${tint ? ` t-${tint}` : ''}`
}

/**
 * A font size that keeps `text` within `lines` lines of `width` px, assuming an average
 * advance of `em` × size per character, clamped to [min, max].
 */
function fit(text, { width, lines, max, min, em = 0.54 }) {
  const str = String(text)
  const byLines = ((width * lines) / (Math.max(str.length, 1) * em)) * 0.86
  // The longest word must fit on one line; caps words run wider than the average advance.
  const word = Math.max(1, ...str.split(/\s+/).map((w) => w.length))
  const byWord = width / (word * em * 1.22)
  return Math.round(Math.max(min, Math.min(max, byLines, byWord)))
}

/** A corner meta pair: sans caps label over a serif value. */
const meta = (label, value, ctx, side) => (label || value)
  ? `<div class="corner ${side}">${label ? `<span class="m-label">${ctx.esc(label)}</span>` : ''}${value ? `<span class="m-value">${ctx.esc(value)}</span>` : ''}</div>`
  : ''

/** The footer: date (sans) centred on the left half, deck title (serif) centred on the right. */
const foot = (ctx) => `<div class="foot"><span class="f-date">${ctx.esc(ctx.deck.date ?? '')}</span><span class="f-title">${ctx.esc(ctx.deck.title ?? '')}</span></div>`

/** A footer line inside one half of a split slide: `date` (sans) or `title` (serif). */
const halfFoot = (which, ctx) => {
  const text = which === 'date' ? ctx.deck.date : ctx.deck.title
  return text ? `<span class="hfoot f-${which}">${ctx.esc(text)}</span>` : ''
}

/** A user picture, or a flat colour field in the slot when there is none. */
function picture(image, ctx, cls, swatch) {
  const src = ctx.image(image)
  return src
    ? `<img class="${cls}" src="${ctx.esc(src)}" alt="${ctx.esc(image.alt)}">`
    : `<div class="${cls} ph" style="background:var(--${swatch})" role="img" aria-label="${ctx.esc(image?.alt ?? '')}"></div>`
}

const initials = (name) => name.split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 2)

/** Cover-style composition: corner metas, big caps title at the top, sans line at 526px. */
function titleSlide(kind, d, ctx, { title, sub, left, right }) {
  const size = fit(title, { width: 760, lines: 3, max: 134, min: 64, em: 0.56 })
  return `<section class="slide cover ${fc(field(kind, ctx))}">
    ${meta(left?.[0], left?.[1], ctx, 'left')}${meta(right?.[0], right?.[1], ctx, 'right')}
    <h1 class="caps" style="font-size:${size}px">${ctx.esc(title)}</h1>
    ${sub ? `<p class="sub">${ctx.esc(sub)}</p>` : ''}</section>`
}

/** Contents-style split: big caps title on the left field, centred serif list on the right. */
function listSplit(kind, d, ctx, items, listSize) {
  const [a, b] = field(kind, ctx)
  const size = fit(d.title, { width: 590, lines: 3, max: 120, min: 44, em: 0.62 })
  const longest = Math.max(...items.map((i) => i.length))
  const item = fit(items.find((i) => i.length === longest), { width: 560, lines: longest > 26 ? 1.35 : 1, max: listSize, min: 28, em: 0.44 })
  return `<section class="slide split">
    <div class="half ${fc(a)}"><h2 class="caps contents" style="font-size:${size}px">${ctx.esc(d.title)}</h2>${halfFoot('date', ctx)}</div>
    <div class="half ${fc(b)}"><ol class="list" style="font-size:${Math.round(item)}px">${items.map((i) => `<li>${ctx.esc(i)}</li>`).join('')}</ol>${halfFoot('title', ctx)}</div></section>`
}

export function css(system) {
  const f = system.field
  const ink = system.ink
  return `
:root { --olive: ${ink.primary}; --gold: ${ink.gold}; --cream-ink: ${ink.onOlive}; --title-on-olive: ${ink.titleOnOlive}; --rule: ${system.rule};
  --pink: ${f.pink}; --cream: ${f.cream}; --orange: ${f.orange}; --yellow: ${f.yellow}; --ochre: ${f.ochre}; --oliveF: ${f.olive}; --blush: ${f.blush}; --mint: ${f.mint}; }
.slide { --bg: var(--cream); --ink: var(--olive); --title: var(--ink); background: var(--bg); color: var(--ink); font-size: 17px; line-height: 1.4; }
.f-pink { --bg: var(--pink); } .f-cream { --bg: var(--cream); } .f-orange { --bg: var(--orange); } .f-yellow { --bg: var(--yellow); }
.f-ochre { --bg: var(--ochre); } .f-blush { --bg: var(--blush); } .f-mint { --bg: var(--mint); }
.f-olive { --bg: var(--oliveF); --ink: var(--cream-ink); --title: var(--title-on-olive); }
.t-gold { --ink: var(--gold); --title: var(--gold); } .t-pink { --title: var(--pink); }
[class*="f-"] { background: var(--bg); color: var(--ink); }

.slide { font-variant-numeric: lining-nums; }
.caps { font-family: var(--display-font); font-weight: 300; text-transform: uppercase; letter-spacing: -.008em; line-height: .82; color: var(--title); }
.serif { font-family: var(--display-font); }
.label { position: absolute; left: 29px; top: 32px; font-family: var(--font); font-size: 31px; font-weight: 400; letter-spacing: -.01em; line-height: 1.2; }
.heading { font-family: var(--display-font); font-weight: 400; font-size: 61px; line-height: 1.02; letter-spacing: -.01em; color: var(--title); }
.tag { font-size: 15px; font-weight: 400; text-transform: uppercase; letter-spacing: .01em; line-height: 1.3; }
.small { font-family: var(--display-font); font-size: 18px; line-height: 1.32; }

.corner { position: absolute; top: 40px; width: 220px; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 1px; }
.corner.left { left: 23px; } .corner.right { right: 23px; }
.m-label { font-size: 15.5px; text-transform: uppercase; letter-spacing: .01em; }
.m-value { font-family: var(--display-font); font-size: 18px; line-height: 1.2; }
.foot { position: absolute; left: 0; right: 0; bottom: 22px; display: grid; grid-template-columns: 1fr 1fr; text-align: center; align-items: baseline; pointer-events: none; }
.foot span { padding: 0 40px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.f-date { font-size: 15px; } .f-title { font-family: var(--display-font); font-size: 16px; }
.hfoot { position: absolute; left: 40px; right: 40px; bottom: 22px; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* cover, section, closing, big number */
.cover { display: flex; flex-direction: column; align-items: center; text-align: center; }
.cover h1 { margin-top: 30px; max-width: 790px; }
.cover .sub { position: absolute; left: 140px; right: 140px; top: 504px; font-size: 31px; line-height: 1.25; letter-spacing: -.005em; }
.cover .sub.serif { font-family: var(--display-font); }

/* splits */
.split { display: grid; grid-template-columns: 1fr 1fr; }
.half { position: relative; height: 720px; overflow: hidden; }
.contents { position: absolute; left: 24px; right: 24px; top: 36px; }
.list { list-style: none; position: absolute; inset: 70px 40px 70px; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: .5em; text-align: center; font-family: var(--display-font); line-height: 1.08; }

.two .colhead { position: absolute; left: 29px; right: 29px; top: 150px; }
.two .colbody { position: absolute; left: 29px; right: 60px; top: 360px; font-family: var(--display-font); font-size: 31px; line-height: 1.26; }

/* insights family: label top left, serif heading, columns */
.insight { padding: 0 29px; }
.insight .heading { position: absolute; left: 29px; top: 160px; max-width: 620px; }
.cols { position: absolute; left: 29px; right: 29px; display: grid; grid-template-columns: repeat(var(--n), 1fr); gap: 24px; text-align: center; }
.col { display: flex; flex-direction: column; align-items: center; gap: 12px; }
.col .small { max-width: 260px; }
.numeral { font-family: var(--display-font); font-weight: 300; font-size: 112px; line-height: .9; letter-spacing: -.01em; color: var(--title); margin-bottom: 14px; }

/* text */
.text .body { position: absolute; left: 29px; top: 320px; width: 860px; font-family: var(--display-font); font-size: 31px; line-height: 1.26; }

/* statement and quote */
.say { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 30px 50px 90px; }
.say p.caps { line-height: .95; letter-spacing: -.01em; }
.who { margin-top: 30px; display: flex; flex-direction: column; align-items: center; gap: 1px; }

/* image + text */
.media { display: block; width: 100%; height: 100%; object-fit: cover; }
.it .left { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 0 60px 60px; }
.it .left h2 { font-family: var(--display-font); font-weight: 400; line-height: 1.12; color: var(--title); }
.it .frame { position: absolute; left: 0; top: 138px; bottom: 0; width: 404px; }
.it .note { position: absolute; left: 422px; right: 22px; top: 140px; font-size: 15px; line-height: 1.38; }

/* timeline */
.tl-line { position: absolute; left: 96px; right: 96px; top: 429px; border-top: 2px solid var(--rule); }
.f-olive .tl-line { border-color: var(--ochre); }
.step { position: absolute; width: 220px; }
.step .when { position: absolute; left: 0; transform: translateX(-50%); font-size: 29px; line-height: 1; white-space: nowrap; }
.step .stem { position: absolute; left: -1px; width: 1px; height: 76px; background: var(--rule); }
.f-olive .step .stem { background: var(--ochre); }
.step .dot { position: absolute; left: -4px; width: 8px; height: 8px; border-radius: 50%; }
.step .txt { position: absolute; left: -2px; width: 210px; display: flex; flex-direction: column; gap: 6px; }
.step .txt .tag { font-size: 16.5px; }
.step .txt p { font-size: 16px; line-height: 1.36; }
.step.down .when { bottom: 302px; } .step.down .stem { top: 430px; } .step.down .dot { top: 502px; } .step.down .txt { top: 522px; }
.step.up .when { top: 444px; } .step.up .stem { top: 354px; } .step.up .dot { top: 350px; } .step.up .txt { bottom: 386px; }

/* table */
.tbl { position: absolute; left: 29px; top: 300px; width: 1222px; border-collapse: collapse; table-layout: fixed; }
.tbl th:first-child, .tbl td:first-child { width: 28%; }
.tbl th { text-align: left; font-size: 15px; font-weight: 400; text-transform: uppercase; letter-spacing: .01em; padding: 0 16px 14px 0; vertical-align: bottom; }
.tbl td { font-family: var(--display-font); font-size: 30px; line-height: 1.15; padding: 22px 16px 22px 0; border-top: 1px solid var(--rule); font-variant-numeric: lining-nums; }
.tbl tr:last-child td { border-bottom: 1px solid var(--rule); }
.tbl td:first-child { font-family: var(--font); font-size: 15px; text-transform: uppercase; letter-spacing: .01em; }

/* big number */
.big b { display: block; margin-top: 64px; font-family: var(--display-font); font-weight: 400; line-height: .8; letter-spacing: -.02em; color: var(--title); }
.big h2 { margin-top: 34px; }

/* team */
.people { position: absolute; left: 29px; right: 29px; top: 111px; display: grid; grid-template-columns: repeat(var(--n), 1fr); gap: 22px; }
.person { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 2px; }
.portrait { position: relative; width: 100%; height: 380px; overflow: hidden; margin-bottom: 18px; color: var(--olive); }
.portrait .ini { position: absolute; inset: 0; display: grid; place-items: center; font-family: var(--display-font); font-size: 120px; line-height: 1; text-transform: uppercase; color: var(--olive); }
.person .m-value { font-size: 19px; }

/* full image */
.framed .frame-in { position: absolute; left: 29px; right: 29px; top: 112px; bottom: 66px; display: flex; flex-direction: column; }
.framed .frame-in .heading { flex: none; margin-bottom: 26px; }
.framed .avn-caption { color: var(--ink); font-size: 15px; }
.full .frame { position: absolute; left: 29px; right: 29px; top: 111px; bottom: 76px; overflow: hidden; }
.full.nocap .frame { top: 29px; }
`
}

export const slides = {
  cover: (d, ctx) => titleSlide('cover', d, ctx, {
    title: d.title, sub: d.subtitle,
    left: ctx.deck.presenter ? ['Presented by', ctx.deck.presenter] : null,
    right: (d.eyebrow || ctx.deck.date) ? [d.eyebrow ?? 'Date', ctx.deck.date] : null,
  }),

  agenda: (d, ctx) => listSplit('agenda', d, ctx, d.items, 54),

  section: (d, ctx) => titleSlide('section', d, ctx, {
    title: d.title, sub: d.subtitle,
    left: ['Section', d.number],
    right: [ctx.deck.title, ctx.deck.date],
  }),

  statement: (d, ctx) => {
    const size = fit(d.text, { width: 1160, lines: 3.6, max: 112, min: 52, em: 0.62 })
    return `<section class="slide say ${fc(field('statement', ctx))}"><p class="caps" style="font-size:${size}px">${ctx.esc(d.text)}</p>
      ${d.attribution ? `<div class="who"><span class="m-label">${ctx.esc(d.attribution)}</span></div>` : ''}${foot(ctx)}</section>`
  },

  text: (d, ctx) => `<section class="slide insight text ${fc(field('text', ctx))}">${d.eyebrow ? `<h3 class="label">${ctx.esc(d.eyebrow)}</h3>` : ''}
    <h2 class="heading">${ctx.esc(d.title)}</h2><p class="body">${ctx.esc(d.body)}</p>${foot(ctx)}</section>`,

  points: (d, ctx) => `<section class="slide insight ${fc(field('points', ctx))}"><h3 class="label">Insights</h3>
    <h2 class="heading">${ctx.esc(d.title)}</h2>
    <div class="cols" style="--n:${d.items.length}; top:372px">${d.items.map((p, i) => `<div class="col"><span class="numeral">${String(i + 1).padStart(2, '0')}</span>
      <span class="tag">${ctx.esc(p.title)}</span><p class="small">${ctx.esc(p.body)}</p></div>`).join('')}</div>${foot(ctx)}</section>`,

  'image-text': (d, ctx) => {
    const [a, b] = field('image-text', ctx)
    const size = fit(d.title, { width: 500, lines: 4, max: 62, min: 40, em: 0.42 })
    return `<section class="slide split it">
      <div class="half left ${fc(a)}"><h2 style="font-size:${size}px">${ctx.esc(d.title)}</h2>${halfFoot('date', ctx)}</div>
      <div class="half ${fc(b)}"><div class="frame">${picture(d.image, ctx, 'media', 'oliveF')}</div><p class="note">${ctx.esc(d.body)}</p></div></section>`
  },

  metrics: (d, ctx) => {
    const longest = Math.max(...d.items.map((m) => m.value.length))
    const size = Math.min(110, Math.round(1000 / d.items.length / Math.max(longest, 2) / 0.5))
    return `<section class="slide insight ${fc(field('metrics', ctx))}"><h3 class="label">Key numbers</h3>
    <h2 class="heading">${ctx.esc(d.title)}</h2>
    <div class="cols" style="--n:${d.items.length}; top:380px">${d.items.map((m) => `<div class="col"><span class="numeral" style="font-size:${size}px">${ctx.esc(m.value)}</span>
      <span class="tag">${ctx.esc(m.label)}</span></div>`).join('')}</div>${foot(ctx)}</section>`
  },

  'two-column': (d, ctx) => {
    const [a, b] = field('two-column', ctx)
    const tsize = Math.min(...d.columns.map((c) => fit(c.title, { width: 560, lines: 2, max: 84, min: 50, em: 0.6 })))
    return `<section class="slide split two">${d.columns.map((c, i) => `<div class="half ${fc(i ? b : a)}">
      ${i === 0 ? `<h2 class="label">${ctx.esc(d.title)}</h2>` : ''}
      <h3 class="caps colhead" style="font-size:${tsize}px">${ctx.esc(c.title)}</h3><p class="colbody">${ctx.esc(c.body)}</p>${halfFoot(i ? 'title' : 'date', ctx)}</div>`).join('')}</section>`
  },

  timeline: (d, ctx) => {
    const n = d.steps.length
    const span = 1088 / n
    const dots = ['mint', 'oliveF', 'orange', 'pink', 'ochre']
    return `<section class="slide insight tl ${fc(field('timeline', ctx))}"><h3 class="label">Timeline</h3>
    <h2 class="heading" style="top:106px; max-width:${n > 4 ? 560 : 640}px">${ctx.esc(d.title)}</h2><div class="tl-line"></div>
    ${d.steps.map((s, i) => `<div class="step ${i % 2 ? 'up' : 'down'}" style="left:${Math.round(150 + i * span)}px; top:0; height:720px">
      <span class="when">${ctx.esc(s.when)}</span><span class="stem"></span><span class="dot" style="background:var(--${dots[i % dots.length]})"></span>
      <div class="txt"><span class="tag">${ctx.esc(s.title)}</span>${s.body ? `<p>${ctx.esc(s.body)}</p>` : ''}</div></div>`).join('')}
    ${foot(ctx)}</section>`
  },

  quote: (d, ctx) => {
    const text = `“${d.text}”`
    const size = fit(text, { width: 1160, lines: 3.8, max: 112, min: 52, em: 0.62 })
    return `<section class="slide say ${fc(field('quote', ctx))}"><p class="caps" style="font-size:${size}px">${ctx.esc(text)}</p>
      <div class="who"><span class="m-label">${ctx.esc(d.name)}</span>${d.role ? `<span class="m-value">${ctx.esc(d.role)}</span>` : ''}</div>${foot(ctx)}</section>`
  },

  table: (d, ctx) => `<section class="slide insight ${fc(field('table', ctx))}"><h3 class="label">Comparison</h3>
    <h2 class="heading" style="top:120px">${ctx.esc(d.title)}</h2>
    <table class="tbl"><thead><tr>${d.columns.map((c) => `<th>${ctx.esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${d.rows.map((r) => `<tr>${r.map((c) => `<td>${ctx.esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>${foot(ctx)}</section>`,

  'big-number': (d, ctx) => {
    const size = Math.min(300, Math.round(900 / Math.max(d.value.length, 1) / 0.62))
    return `<section class="slide cover big ${fc(field('big-number', ctx))}">
    <b style="font-size:${size}px">${ctx.esc(d.value)}</b>
    <h2 class="caps" style="font-size:${fit(d.label, { width: 1000, lines: 1, max: 80, min: 48, em: 0.6 })}px">${ctx.esc(d.label)}</h2>
    ${d.body ? `<p class="sub">${ctx.esc(d.body)}</p>` : ''}${foot(ctx)}</section>`
  },

  bullets: (d, ctx) => listSplit('bullets', d, ctx, d.items, 40),

  team: (d, ctx) => `<section class="slide insight ${fc(field('team', ctx))}"><h2 class="label">${ctx.esc(d.title)}</h2>
    <div class="people" style="--n:${d.people.length}">${d.people.map((p, i) => {
      const src = p.image && ctx.image(p.image)
      const face = src
        ? `<img class="portrait media" src="${ctx.esc(src)}" alt="${ctx.esc(p.name)}">`
        : `<div class="portrait f-${SWATCHES[i % SWATCHES.length]}" role="img" aria-label="${ctx.esc(p.name)}"><span class="ini">${ctx.esc(initials(p.name))}</span></div>`
      return `<div class="person">${face}<span class="m-label">${ctx.esc(p.name)}</span><span class="m-value">${ctx.esc(p.role)}</span></div>`
    }).join('')}</div>${foot(ctx)}</section>`,

  image: (d, ctx) => {
    const f = field('image', ctx)
    return `<section class="slide insight full ${d.caption ? '' : 'nocap'} ${fc(f)}">${d.caption ? `<h2 class="label">${ctx.esc(d.caption)}</h2>` : ''}
    <div class="frame">${picture(d.image, ctx, 'media', f === 'olive' ? 'ochre' : 'blush')}</div>${foot(ctx)}</section>`
  },

  frame: ({ title, eyebrow }, ctx, body) => {
    const kind = ctx.deck.slides[ctx.index - 1]?.kind
    return `<section class="slide framed ${fc(field(FIELDS[kind] ? kind : 'chart', ctx))}">${eyebrow ? `<h3 class="label">${ctx.esc(eyebrow)}</h3>` : ''}
    <div class="frame-in">${title ? `<h2 class="heading">${ctx.esc(title)}</h2>` : ''}${body}</div>${foot(ctx)}</section>`
  },

  closing: (d, ctx) => titleSlide('closing', d, ctx, {
    title: d.title, sub: d.subtitle,
    left: ctx.deck.presenter ? ['Presented by', ctx.deck.presenter] : null,
    right: d.contact ? ['Contact', d.contact] : null,
  }),
}
