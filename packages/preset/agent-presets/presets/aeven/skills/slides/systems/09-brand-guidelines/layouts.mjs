/**
 * Brand Guidelines: lime and deep olive colour fields under a big italic serif display, stacked
 * rounded caps label blocks (black, olive, lime) that each hold one line, a round version badge,
 * and paper guideline pages: a lime section tag, a small bold caps heading and body copy in a
 * narrow left column, one large rounded panel (black, lime, grey or a colour-band split) on the
 * right, and the deck title in small italic serif in the bottom-left corner.
 * Measured from the 16 frames of Figma's "Brand Guidelines" (Figma Community).
 *
 * Every display line is set in the display family's italic; system.json asks the renderer to
 * embed it (`type.fonts.italic`).
 */
/** Average advance per character, in em, for the label caps and the italic serif. */
const CAPS_EM = 0.6
const SERIF_EM = 0.43

/**
 * A font size that keeps `text` within `lines` lines of `width` px, assuming an average advance
 * of `em` × size per character, clamped to [min, max].
 */
function fit(text, { width, lines = 1, max, min, em }) {
  const str = String(text)
  const byLines = ((width * lines) / (Math.max(str.length, 1) * em)) * 0.9
  const word = Math.max(1, ...str.split(/\s+/).map((w) => w.length))
  const byWord = width / (word * em * 1.1)
  return Math.round(Math.max(min, Math.min(max, byLines, byWord)))
}

/** Splits `text` into lines of at most `chars` characters, breaking at spaces. */
function wrap(text, chars) {
  const out = []
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const last = out[out.length - 1]
    if (last !== undefined && (last + ' ' + word).length <= chars) out[out.length - 1] = `${last} ${word}`
    else out.push(word)
  }
  return out
}

/**
 * Stacked caps label blocks: `text` broken into at most `maxLines` lines that each fit `width`,
 * one rounded block per line, the way the source stacks "BRAND" over "GUIDELINES".
 * @returns {{ size: number, lines: string[] }}
 */
function stack(text, { width, max, min, maxLines = 3 }) {
  for (let size = max; size >= min; size -= 2) {
    const chars = Math.floor((width - size * 0.9) / (size * CAPS_EM))
    const lines = wrap(text, chars)
    if (lines.length <= maxLines && lines.every((l) => l.length <= chars)) return { size, lines }
  }
  const chars = Math.floor((width - min * 0.9) / (min * CAPS_EM))
  return { size: min, lines: wrap(text, chars) }
}

/** One rounded label block. */
const block = (text, tone, ctx, extra = '') => `<span class="blk ${tone}"${extra}>${ctx.esc(text)}</span>`

/** A column of stacked blocks in one tone at one size. */
const blocks = ({ size, lines }, tone, ctx) => lines.map((line) => block(line, tone, ctx, ` style="font-size:${size}px"`)).join('')

/** The title of the section slide that precedes this slide, for the guideline-page tag. */
function sectionName(ctx) {
  for (let i = ctx.index - 2; i >= 0; i--) {
    if (ctx.deck.slides[i].kind === 'section') return ctx.deck.slides[i].title
  }
  return ''
}

/** The nth occurrence of this slide's kind in the deck, counting from 0. */
const nth = (kind, ctx) => ctx.deck.slides.slice(0, ctx.index - 1).filter((s) => s.kind === kind).length

const initials = (name) => String(name).split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 2)

/** The round monogram mark: deck initials in italic serif inside a circle. */
const mark = (text, ctx, cls = '') => `<div class="mark ${cls}" aria-hidden="true"><span>${ctx.esc(initials(text))}</span></div>`

/** A user picture, or the grey panel with the deck monogram when the slot has none. */
function picture(image, ctx, cls) {
  const src = ctx.image(image)
  return src
    ? `<img class="${cls} pic" src="${ctx.esc(src)}" alt="${ctx.esc(image.alt)}">`
    : `<div class="${cls} ph" role="img" aria-label="${ctx.esc(image?.alt ?? '')}">${mark(ctx.deck.title || 'Brand', ctx)}</div>`
}

/** The deck title in small italic serif, bottom-left on paper pages. */
const corner = (ctx, tone = '') => (ctx.deck.title ? `<span class="corner ${tone}">${ctx.esc(ctx.deck.title)}</span>` : '')

/**
 * A guideline page: lime tag, bold caps heading and body copy in the left column, the deck title
 * in the corner, and `panel` (an element with class `panel`) filling the right.
 */
function page(ctx, { tag, heading, body, panel, extra = '' }) {
  return `<section class="slide guide ${extra}"><div class="side">
    ${tag ? `<span class="tag">${ctx.esc(tag)}</span>` : ''}
    <div class="side-text">${heading ? `<h2 class="heading">${ctx.esc(heading)}</h2>` : ''}${body ? `<p class="copy">${ctx.esc(body)}</p>` : ''}</div>
    ${corner(ctx)}</div>${panel}</section>`
}

/** A small caps row label such as "01: FIRST POINT". */
const label = (i, text, ctx) => `<span class="lbl">${String(i + 1).padStart(2, '0')}${text ? `: ${ctx.esc(text)}` : ''}</span>`

/** Band tones for split panels, in the order of the source's logo-palette slide. */
const BANDS = ['lime', 'olive', 'black', 'grey']

/** Agenda block tones, in the order of the source's coloured contents slide. */
const AGENDA = ['black', 'olive', 'lime', 'black', 'olive', 'lime', 'olive', 'black']

/** The largest agenda block size whose wrapped rows fit the area. */
function agendaSize(items, width, height) {
  for (let size = 108; size > 40; size -= 2) {
    const widths = items.map((t) => t.length * size * CAPS_EM + size * 1.05)
    if (Math.max(...widths) > width) continue
    let rows = 1
    let x = 0
    for (const w of widths) {
      if (x > 0 && x + 13 + w > width) { rows++; x = w } else x += (x > 0 ? 13 : 0) + w
    }
    if (rows * size * 1.4 + (rows - 1) * 13 <= height) return size
  }
  return 40
}

/** Display-title composition on a colour field: big italic serif at the top, blocks at the bottom. */
function fieldTitle(text, ctx, { width = 1232, max = 200 } = {}) {
  const one = fit(text, { width, lines: 1, max, min: 72, em: SERIF_EM })
  const size = one >= 120 ? one : fit(text, { width, lines: 2, max: 150, min: 72, em: SERIF_EM })
  return `<h1 class="display" style="font-size:${size}px">${ctx.esc(text)}</h1>`
}

/** Soft diagonal shadow bands across the olive cover field. */
const shadows = '<div class="shadows" aria-hidden="true"><i></i><i></i><i></i></div>'

export function css(system) {
  const c = system.colors
  const g = system.geometry
  const t = system.type
  return `
:root { --lime: ${c.lime}; --olive: ${c.olive}; --field: ${c.field}; --shade: ${c.shadow}; --black: ${c.black}; --paper: ${c.paper}; --grey: ${c.grey};
  --muted: ${system.palette.muted}; --m: ${g.margin}px; --side: ${g.sideWidth}px; --panel-left: ${g.panelLeft}px; --pr: ${g.panelRadius}px; --br: ${g.blockRadius}px; --gap: ${g.blockGap}px;
  --label-font: "${t.fonts.extra[0]}", Arial, sans-serif; }
.slide { background: var(--paper); color: var(--black); font-size: ${t.body}px; line-height: 1.3; }
.display, .serif { font-family: var(--display-font); font-style: italic; font-weight: 500; letter-spacing: -.025em; line-height: .98; }
.display { text-wrap: balance; }

/* label blocks */
.blk { display: inline-flex; align-items: center; align-self: flex-start; font-family: var(--label-font); font-weight: 400; text-transform: uppercase; letter-spacing: -.012em; line-height: 1; padding: .21em .42em .19em; border-radius: var(--br); white-space: nowrap; }
.blk.black { background: var(--black); color: #fff; } .blk.olive { background: var(--olive); color: #fff; } .blk.lime { background: var(--lime); color: var(--black); }
.blk.num { font-family: var(--display-font); font-style: italic; font-weight: 500; text-transform: none; letter-spacing: -.02em; padding: .08em .34em .1em; }
.stack { display: flex; flex-direction: column; gap: var(--gap); align-items: flex-start; }
.badge { position: absolute; right: 26px; bottom: 26px; width: ${g.badge}px; height: ${g.badge}px; border-radius: 50%; display: grid; place-items: center; text-align: center; padding: 18px; font-family: var(--label-font); font-size: 13px; font-weight: 600; letter-spacing: .02em; text-transform: uppercase; line-height: 1.2; }
.badge.lime { background: var(--lime); color: var(--black); } .badge.black { background: var(--black); color: var(--lime); }

/* colour fields */
.field { padding: 0 var(--m) var(--m); display: flex; flex-direction: column; }
.field .display { margin-top: 6px; text-align: center; }
.field .stack { margin-top: auto; position: relative; }
.f-olive { background: var(--field); color: var(--lime); }
.f-lime { background: var(--lime); color: var(--black); }
.shadows { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
.shadows i { position: absolute; height: 46px; width: 1900px; left: -360px; background: var(--shade); opacity: .42; filter: blur(14px); transform-origin: 0 50%; border-radius: 40px; }
.shadows i:nth-child(1) { top: 640px; transform: rotate(-38deg); }
.shadows i:nth-child(2) { top: 690px; height: 22px; transform: rotate(-38deg); opacity: .34; }
.shadows i:nth-child(3) { top: 1010px; left: 380px; height: 30px; transform: rotate(-29deg); opacity: .36; }
.field > *:not(.shadows) { position: relative; }
.field .badge { position: absolute; }

.cover .sub { max-width: 940px; font-size: 28px; letter-spacing: -.01em; text-transform: none; white-space: normal; line-height: 1.12; padding: .3em .55em .32em; }
.sec .row { display: flex; gap: var(--gap); align-items: flex-start; }
.statement .display { text-align: left; margin-top: 40px; max-width: 1180px; }
.quote .display { text-align: left; margin-top: 44px; max-width: 1180px; }

/* agenda */
.agenda { padding: var(--m); display: flex; flex-direction: column; }
.agenda .tag { margin-bottom: 18px; }
.chips { display: flex; flex-wrap: wrap; gap: var(--gap); align-content: flex-start; }
.chip { display: inline-flex; align-items: flex-start; font-family: var(--label-font); font-weight: 400; text-transform: uppercase; letter-spacing: -.015em; line-height: 1; padding: .2em .45em .2em .3em; border-radius: var(--br); white-space: nowrap; }
.chip.black { background: var(--black); color: #fff; } .chip.olive { background: var(--olive); color: #fff; } .chip.lime { background: var(--lime); color: var(--black); }
.chip .no { font-size: 12px; letter-spacing: 0; margin: .25em .55em 0 0; }

/* guideline pages */
.guide { display: flex; padding: var(--m); gap: calc(var(--panel-left) - var(--side) - var(--m)); }
.side { position: relative; flex: none; width: var(--side); display: flex; flex-direction: column; }
.tag { align-self: flex-start; display: inline-flex; align-items: center; height: 24px; padding: 1px 9px 0; border-radius: 999px; background: var(--lime); color: var(--black); font-size: ${t.tag}px; text-transform: uppercase; letter-spacing: .01em; white-space: nowrap; }
.side-text { margin-top: 76px; display: flex; flex-direction: column; gap: 18px; }
.heading { font-family: var(--font); font-size: ${t.heading}px; font-weight: 600; text-transform: uppercase; letter-spacing: .005em; line-height: 1.15; text-wrap: balance; }
.copy { font-size: ${t.body}px; line-height: 1.3; }
.corner { position: absolute; left: 0; bottom: -2px; max-width: var(--side); font-family: var(--display-font); font-style: italic; font-size: ${t.meta}px; letter-spacing: -.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.panel { position: relative; flex: 1 1 auto; min-width: 0; border-radius: var(--pr); overflow: hidden; display: flex; flex-direction: column; }
.p-black { background: var(--black); color: #fff; } .p-lime { background: var(--lime); } .p-grey { background: var(--grey); } .p-plain { overflow: visible; }
.lbl { font-family: var(--label-font); font-size: 14px; text-transform: uppercase; letter-spacing: .01em; line-height: 1.2; }

.mark { width: 210px; height: 210px; border-radius: 50%; background: var(--black); color: #fff; display: grid; place-items: center; }
.mark span { font-family: var(--display-font); font-style: italic; font-weight: 600; font-size: 104px; letter-spacing: -.06em; line-height: 1; padding-right: .06em; }
.ph { background: var(--grey); display: grid; place-items: center; }
.pic { object-fit: cover; width: 100%; height: 100%; }
.panel > .media { flex: 1 1 auto; min-height: 0; }

/* text */
.textp { justify-content: space-between; padding: 44px 48px 48px; }
.textp .display { color: var(--lime); }
.textp p { max-width: 740px; font-size: 28px; line-height: 1.34; color: #e6e6e6; }

/* points: three labelled rows */
.rows3 { padding: 18px 20px 24px; }
.rows3 .r { flex: 1; display: flex; flex-direction: column; }
.rows3 .r p { flex: 1; display: flex; align-items: center; justify-content: center; text-align: center; padding: 0 40px; }

/* split bands */
.bands { flex-direction: row; }
.band { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 22px; padding: 28px 18px; text-align: center; }
.b-lime { background: var(--lime); color: var(--black); } .b-olive { background: var(--olive); color: var(--lime); }
.b-black { background: var(--black); color: var(--lime); } .b-grey { background: var(--grey); color: var(--black); }
.band b { font-weight: 500; }
.band .lbl { max-width: 190px; font-size: 15px; }
.halves .band { align-items: flex-start; justify-content: flex-start; text-align: left; padding: 22px 26px 32px; }
.halves .band p { flex: 1; display: flex; align-items: center; padding: 0 22px; }

/* timeline: lime grid on black */
.tl { padding: 48px 40px; justify-content: center; }
.tl-grid { display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); grid-template-rows: 84px 1fr auto; min-height: 420px; border-top: 1px solid var(--lime); border-left: 1px solid var(--lime); }
.tl-grid > * { border-right: 1px solid var(--lime); border-bottom: 1px solid var(--lime); }
.tl-when { display: flex; align-items: center; padding: 0 18px; background: #34432a; color: var(--lime); }
.tl-when .lbl { font-size: 18px; }
.tl-title { display: flex; align-items: flex-end; padding: 34px 20px 18px; color: #fff; }
.tl-body { padding: 0 20px 34px; font-size: 18px; color: #cfcfcf; border-bottom: 1px solid var(--lime); }
.tl-grid .tl-title { border-bottom: 0; }

/* table */
.tbl { padding: 40px 44px; justify-content: center; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; font-family: var(--label-font); font-weight: 400; font-size: 14px; text-transform: uppercase; letter-spacing: .01em; padding: 0 12px 16px 0; }
td { padding: 20px 12px 20px 0; border-top: 1px solid rgba(0,0,0,.22); font-size: 22px; font-variant-numeric: tabular-nums; }
td:first-child { font-family: var(--display-font); font-style: italic; font-weight: 500; font-size: 34px; letter-spacing: -.02em; line-height: 1; }

/* big number */
.bigp { align-items: center; justify-content: center; padding: 40px; }
.bigp b { color: var(--lime); font-weight: 500; line-height: .9; white-space: nowrap; }

/* bullets */
.list { padding: 30px 44px; justify-content: center; }
.list ol { list-style: none; display: flex; flex-direction: column; }
.list li { display: flex; align-items: baseline; gap: 26px; padding: 20px 0; border-top: 1px solid rgba(0,0,0,.22); }
.list li:first-child { border-top: 0; }
.list li .t { font-size: 32px; line-height: 1.2; letter-spacing: -.01em; }

/* team */
.people { flex-direction: row; align-items: center; justify-content: space-evenly; padding: 30px 20px; }
.person { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 8px; }
.person .mark, .person .face { width: 156px; height: 156px; margin-bottom: 14px; }
.person .face { border-radius: 50%; object-fit: cover; }
.person .mark span { font-size: 74px; }
.person b { font-size: 15px; font-weight: 600; text-transform: uppercase; letter-spacing: .01em; }
.person span.role { font-size: 15px; color: var(--muted); }

/* image */
.full { padding: 0; }
.full .media { position: absolute; inset: 0; width: 100%; height: 100%; }
.full .mark { width: 260px; height: 260px; } .full .mark span { font-size: 128px; }
.full .cap { position: absolute; left: var(--m); bottom: var(--m); max-width: 900px; font-size: 30px; text-transform: none; white-space: normal; line-height: 1.15; padding: .32em .55em .34em; }

/* frame */
.p-plain .avn-body { flex: 1 1 auto; padding-top: 4px; }
.p-plain .avn-caption { color: var(--muted); }
`
}

export const slides = {
  cover: (d, ctx) => {
    const eyebrow = d.eyebrow ? stack(d.eyebrow, { width: 1040, max: 84, min: 44, maxLines: 2 }) : null
    return `<section class="slide field f-olive cover">${shadows}
    ${fieldTitle(d.title, ctx, { max: 196 })}
    <div class="stack">${eyebrow ? blocks(eyebrow, 'black', ctx) : ''}${d.subtitle ? block(d.subtitle, 'lime sub', ctx) : ''}</div>
    ${ctx.deck.date ? `<span class="badge lime">${ctx.esc(ctx.deck.date)}</span>` : ''}</section>`
  },

  agenda: (d, ctx) => {
    const size = agendaSize(d.items, 1232, 720 - 66 - 24)
    return `<section class="slide agenda"><span class="tag">${ctx.esc(d.title)}</span>
    <div class="chips" style="font-size:${size}px">${d.items.map((item, i) => `<span class="chip ${AGENDA[i % AGENDA.length]}"><span class="no">${String(i + 1).padStart(2, '0')}</span>${ctx.esc(item)}</span>`).join('')}</div></section>`
  },

  section: (d, ctx) => {
    const olive = nth('section', ctx) % 2 === 1
    const sub = d.subtitle ? stack(d.subtitle, { width: 860, max: 104, min: 52, maxLines: 2 }) : null
    const first = sub ? sub.lines[0] : ''
    return `<section class="slide field sec ${olive ? 'f-olive' : 'f-lime'}">
    ${fieldTitle(d.title, ctx, { max: 196 })}
    <div class="stack">${sub
      ? `<div class="row">${block(first, olive ? 'lime' : 'olive', ctx, ` style="font-size:${sub.size}px"`)}<span class="blk num black" style="font-size:${sub.size}px">${ctx.esc(d.number)}</span></div>${blocks({ size: sub.size, lines: sub.lines.slice(1) }, olive ? 'lime' : 'olive', ctx)}`
      : `<span class="blk num black" style="font-size:104px">${ctx.esc(d.number)}</span>`}</div></section>`
  },

  statement: (d, ctx) => `<section class="slide field f-olive statement">
    <p class="display" style="font-size:${fit(d.text, { width: 1180, lines: 3, max: 112, min: 54, em: SERIF_EM })}px">${ctx.esc(d.text)}</p>
    ${d.attribution ? `<div class="stack">${block(d.attribution, 'black', ctx, ' style="font-size:48px"')}</div>` : ''}</section>`,

  text: (d, ctx) => page(ctx, {
    tag: sectionName(ctx) || d.eyebrow,
    heading: sectionName(ctx) ? d.eyebrow : '',
    panel: `<div class="panel p-black textp"><h2 class="display" style="font-size:${fit(d.title, { width: 820, lines: 2, max: 128, min: 56, em: SERIF_EM })}px">${ctx.esc(d.title)}</h2><p>${ctx.esc(d.body)}</p></div>`,
  }),

  points: (d, ctx) => {
    const longest = d.items.reduce((a, p) => (p.body.length > a.length ? p.body : a), '')
    const size = fit(longest, { width: 760, lines: 1.6, max: 58, min: 30, em: SERIF_EM })
    return page(ctx, {
      tag: sectionName(ctx), heading: d.title,
      panel: `<div class="panel p-lime rows3">${d.items.map((p, i) => `<div class="r">${label(i, p.title, ctx)}<p class="serif" style="font-size:${size}px">${ctx.esc(p.body)}</p></div>`).join('')}</div>`,
    })
  },

  'image-text': (d, ctx) => page(ctx, {
    tag: sectionName(ctx), heading: d.title, body: d.body,
    panel: `<div class="panel p-grey">${picture(d.image, ctx, 'media')}</div>`,
  }),

  metrics: (d, ctx) => {
    const bandWidth = 921 / d.items.length - 36
    const longest = d.items.reduce((a, m) => (m.value.length > a.length ? m.value : a), '')
    const size = fit(longest, { width: bandWidth, lines: 1, max: 132, min: 48, em: 0.5 })
    return page(ctx, {
      tag: sectionName(ctx), heading: d.title,
      panel: `<div class="panel bands">${d.items.map((m, i) => `<div class="band b-${BANDS[i % BANDS.length]}"><b class="serif" style="font-size:${size}px">${ctx.esc(m.value)}</b><span class="lbl">${ctx.esc(m.label)}</span></div>`).join('')}</div>`,
    })
  },

  'two-column': (d, ctx) => {
    const longest = d.columns.reduce((a, c) => (c.body.length > a.length ? c.body : a), '')
    const size = fit(longest, { width: 360, lines: 3, max: 54, min: 28, em: SERIF_EM })
    return page(ctx, {
      tag: sectionName(ctx), heading: d.title,
      panel: `<div class="panel bands halves">${d.columns.map((c, i) => `<div class="band b-${['lime', 'olive'][i % 2]}">${label(i, c.title, ctx)}<p class="serif" style="font-size:${size}px">${ctx.esc(c.body)}</p></div>`).join('')}</div>`,
    })
  },

  timeline: (d, ctx) => {
    const n = d.steps.length
    const title = fit(d.steps.reduce((a, s) => (s.title.length > a.length ? s.title : a), ''), { width: 830 / n - 44, lines: 1, max: 64, min: 28, em: 0.5 })
    return page(ctx, {
      tag: sectionName(ctx), heading: d.title,
      panel: `<div class="panel p-black tl"><div class="tl-grid" style="--n:${n}">
        ${d.steps.map((s) => `<div class="tl-when"><span class="lbl">${ctx.esc(s.when)}</span></div>`).join('')}
        ${d.steps.map((s) => `<div class="tl-title serif" style="font-size:${title}px">${ctx.esc(s.title)}</div>`).join('')}
        ${d.steps.map((s) => `<div class="tl-body">${ctx.esc(s.body ?? '')}</div>`).join('')}</div></div>`,
    })
  },

  quote: (d, ctx) => `<section class="slide field f-lime quote">
    <p class="display" style="font-size:${fit(d.text, { width: 1180, lines: 3, max: 104, min: 50, em: SERIF_EM })}px">${ctx.esc(d.text)}</p>
    <div class="stack">${block(d.name, 'black', ctx, ' style="font-size:60px"')}${d.role ? block(d.role, 'olive', ctx, ' style="font-size:60px"') : ''}</div></section>`,

  table: (d, ctx) => page(ctx, {
    tag: sectionName(ctx), heading: d.title,
    panel: `<div class="panel p-grey tbl"><table><thead><tr>${d.columns.map((c) => `<th>${ctx.esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${d.rows.map((r) => `<tr>${r.map((c) => `<td>${ctx.esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`,
  }),

  'big-number': (d, ctx) => page(ctx, {
    tag: sectionName(ctx), heading: d.label, body: d.body,
    panel: `<div class="panel p-black bigp"><b class="serif" style="font-size:${fit(d.value, { width: 800, lines: 1, max: 380, min: 120, em: 0.5 })}px">${ctx.esc(d.value)}</b></div>`,
  }),

  bullets: (d, ctx) => page(ctx, {
    tag: sectionName(ctx), heading: d.title,
    panel: `<div class="panel p-lime list"><ol>${d.items.map((item, i) => `<li>${label(i, '', ctx)}<span class="t">${ctx.esc(item)}</span></li>`).join('')}</ol></div>`,
  }),

  team: (d, ctx) => page(ctx, {
    tag: sectionName(ctx), heading: d.title,
    panel: `<div class="panel p-grey people">${d.people.map((p) => {
      const src = p.image && ctx.image(p.image)
      const face = src ? `<img class="face" src="${ctx.esc(src)}" alt="${ctx.esc(p.name)}">` : mark(p.name, ctx)
      return `<div class="person">${face}<b>${ctx.esc(p.name)}</b><span class="role">${ctx.esc(p.role)}</span></div>`
    }).join('')}</div>`,
  }),

  image: (d, ctx) => `<section class="slide full">${picture(d.image, ctx, 'media')}${d.caption ? block(d.caption, 'black cap', ctx) : ''}</section>`,

  /** The guideline page that `chart` and `custom` slides are drawn in: `body` fills the right panel area. */
  frame: ({ title, eyebrow }, ctx, body) => page(ctx, {
    tag: eyebrow || sectionName(ctx), heading: title,
    panel: `<div class="panel p-plain">${body}</div>`,
  }),

  closing: (d, ctx) => {
    const sub = d.subtitle ? stack(d.subtitle, { width: 860, max: 96, min: 48, maxLines: 2 }) : null
    return `<section class="slide field f-lime closing">
    ${fieldTitle(d.title, ctx, { max: 220 })}
    <div class="stack">${sub ? blocks(sub, 'olive', ctx) : ''}${d.contact ? block(d.contact, 'black contact', ctx, ' style="font-size:44px;text-transform:none"') : ''}</div>
    ${ctx.deck.date ? `<span class="badge black">${ctx.esc(ctx.deck.date)}</span>` : ''}</section>`
  },
}
