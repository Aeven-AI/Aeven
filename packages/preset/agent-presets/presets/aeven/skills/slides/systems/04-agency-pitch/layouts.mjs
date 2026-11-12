/**
 * Agency Pitch: cream frames holding colour cards with ring-binder tabs, heavy condensed caps
 * titles, wide serif caps headings, stencil serif numerals in an orange/teal/tan/pink/blue
 * cycle, organic number blobs, dashed rows with small coloured shapes, and corner meta text.
 * Measured from the 13 slides of Figma's "Agency Pitch" Slides template (Figma Community).
 *
 * Fonts: `type.fonts.text` and `display`, plus three `type.fonts.extra` families (wide serif,
 * stencil numerals, wide index numbers); the renderer embeds all of them.
 */
import { readFileSync } from 'node:fs'

const own = JSON.parse(readFileSync(new URL('system.json', import.meta.url), 'utf8'))

const CYCLE = own.accent.cycle
/** The accent colour variable for position `i` in the orange/teal/tan/pink/blue cycle. */
const tone = (i, cycle = CYCLE) => `var(--${cycle[((i % cycle.length) + cycle.length) % cycle.length]})`
const pad2 = (n) => String(n).padStart(2, '0')

/** Corner meta: deck title and page, top right, as on every content slide of the source. */
const meta = (ctx) => `<div class="meta"><span>${ctx.esc(ctx.deck.title)}</span><span>${pad2(ctx.index)} / ${pad2(ctx.total)}</span></div>`

/** The heavy condensed caps title in the top-left corner. */
const head = (text, ctx, color = '') => `<h2 class="hdr"${color ? ` style="color:${color}"` : ''}>${ctx.esc(text)}</h2>`

/** Three ring-binder tabs punched into the left edge of a card. */
const holes = '<span class="holes" aria-hidden="true"><i><b></b></i><i><b></b></i><i><b></b></i></span>'

/** Small coloured marks from the "what we do" rows. */
const MARKS = [
  ['teal', '<path d="M20 5 L37 34 H3 Z"/>'],
  ['orange', '<path d="M20 3 L38 16 L31 37 H9 L2 16 Z"/>'],
  ['blue', '<path d="M10 3 L20 13 L30 3 L37 10 L27 20 L37 30 L30 37 L20 27 L10 37 L3 30 L13 20 L3 10 Z"/>'],
  ['pink', '<path d="M4 4 L20 13 L36 4 V36 L20 27 L4 36 Z"/>'],
  ['tan', '<path d="M13 3 H27 L37 13 V27 L27 37 H13 L3 27 V13 Z"/>'],
  ['orange', '<path d="M20 3 L37 20 L20 37 L3 20 Z"/>'],
]
const mark = (i) => {
  const [c, path] = MARKS[i % MARKS.length]
  return `<svg class="mark" viewBox="0 0 40 40" aria-hidden="true" fill="var(--${c})" stroke="var(--${c})" stroke-width="2" stroke-linejoin="round">${path}</svg>`
}

/** The four organic agenda blobs (peanut, octagon, hourglass, notched square), 292×417. */
const BLOBS = [
  '<rect x="0" y="0" width="292" height="290" rx="140"/><rect x="0" y="127" width="292" height="290" rx="140"/>',
  '<path d="M90 6 H202 L286 94 V323 L202 411 H90 L6 323 V94 Z" stroke-width="12"/>',
  '<path d="M10 9 H282 L214 208 L282 408 H10 L78 208 Z" stroke-width="20"/>',
  '<path d="M38 0 H122 L146 34 L170 0 H254 Q292 0 292 38 V178 L264 208 L292 238 V379 Q292 417 254 417 H170 L146 383 L122 417 H38 Q0 417 0 379 V238 L28 208 L0 178 V38 Q0 0 38 0 Z" stroke-width="6"/>',
]
const blob = (i, color) => `<svg class="blob-shape" viewBox="0 0 292 417" aria-hidden="true" fill="${color}" stroke="${color}" stroke-linejoin="round">${BLOBS[i % BLOBS.length]}</svg>`

/** A user picture, or a flat colour field with one blob shape when the slot has none. */
function picture(image, ctx, cls, i = 0, shape = i) {
  const src = ctx.image(image)
  return src
    ? `<img class="${cls}" src="${ctx.esc(src)}" alt="${ctx.esc(image.alt)}">`
    : `<div class="${cls} ph" role="img" aria-label="${ctx.esc(image?.alt ?? '')}" style="background:${tone(i + 1)}">${blob(shape, tone(i + 3))}</div>`
}

/** Splits a cover title into staggered lines: one word per line up to two words, else balanced lines. */
function coverLines(title) {
  const words = String(title).trim().split(/\s+/)
  if (words.length <= 2) return words
  const target = words.length > 4 || title.length > 26 ? 3 : 2
  const lines = []
  let rest = words
  for (let n = target; n > 1; n--) {
    const want = rest.join(' ').length / n
    let line = rest[0]
    let k = 1
    while (k < rest.length - (n - 1) && Math.abs(`${line} ${rest[k]}`.length - want) < Math.abs(line.length - want)) line += ` ${rest[k++]}`
    lines.push(line)
    rest = rest.slice(k)
  }
  lines.push(rest.join(' '))
  return lines
}

/** Barlow Condensed Bold caps advance widths in em, measured in Chrome. */
const CAP_EM = { A: .48, B: .47, C: .46, D: .48, E: .44, F: .42, G: .47, H: .48, I: .23, J: .45, K: .49, L: .43, M: .55, N: .51, O: .47, P: .47, Q: .46, R: .47, S: .44, T: .47, U: .48, V: .49, W: .69, X: .48, Y: .47, Z: .41, 1: .28, 4: .48, 7: .41, ' ': .2, '&': .6, '.': .22, ',': .21, '-': .33, '’': .19, "'": .19, '!': .28 }
/** The width of a caps line in em; unlisted glyphs count as .5em. */
const capsWidth = (text) => [...String(text).toUpperCase()].reduce((w, ch) => w + (CAP_EM[ch] ?? (/[0-9]/.test(ch) ? .44 : .5)), 0) * 1.03

/** The orange cover card: staggered heavy caps, a date top right, dash lines bottom left. */
function coverCard(cls, title, dashLines, date, ctx) {
  const lines = coverLines(title)
  // The first line stops short of the date; later lines start right of the dash list.
  const widths = lines.map((l, i) => (lines.length === 1 ? 860 : i ? 640 : 690) / Math.max(0.5, capsWidth(l)))
  const size = Math.round(Math.min(325, 600 / (lines.length * 0.82), ...widths))
  return `<section class="slide frame ${cls}"><div class="card cover-card${lines.length > 2 ? ' many' : ''}" style="background:var(--orange)">${holes}
    ${date ? `<span class="date">${ctx.esc(date)}</span>` : ''}
    <h1 class="cover-title" style="font-size:${size}px">${lines.map((l) => `<span>${ctx.esc(l)}</span>`).join('')}</h1>
    ${dashLines.length ? `<ul class="dash">${dashLines.map((l) => `<li><span aria-hidden="true">–</span>${ctx.esc(l)}</li>`).join('')}</ul>` : ''}
  </div></section>`
}

/** The cream-framed colour card with a wide serif heading and large body, as "Our mission". */
function messageCard(color, heading, inner, ctx, eyebrow) {
  return `<section class="slide frame">${eyebrow ? `<span class="eyebrow">${ctx.esc(eyebrow)}</span>` : ''}${meta(ctx)}
    <div class="card msg-card" style="background:${color}">${holes}<div class="msg">${heading}${inner}</div></div></section>`
}

/** Stencil value size inside a blob: 84px, smaller for long values so the hourglass waist clears them. */
function valueSize(value) {
  const size = Math.min(84, Math.floor(200 / (String(value).length * 0.6)))
  return `font-size:${size}px;top:${100 + Math.round((84 - size) / 2)}px`
}

const initials = (name) => name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()

export function css(system) {
  const { surface, ink, accent } = system
  return `
:root { --frame: ${surface.frame}; --black: ${surface.page}; --cream: ${ink.onDark}; --ink: ${ink.onLight};
  --rule: ${ink.rule}; --rule-light: ${ink.ruleOnLight};
  --orange: ${accent.orange}; --teal: ${accent.teal}; --tan: ${accent.tan}; --pink: ${accent.pink}; --blue: ${accent.blue};
  --serif: "Stint Ultra Expanded", Georgia, serif; --stencil: "Stardos Stencil", Georgia, serif; --wide: "Syncopate", var(--font);
  --m: 47px; }
.slide { background: var(--frame); color: var(--ink); font-size: 19px; line-height: 1.3; }
.dark { background: var(--black); color: var(--cream); }
.hdr { position: absolute; left: var(--m); top: 27px; max-width: 760px; font-weight: 700; font-size: 46px; line-height: .98; text-transform: uppercase; letter-spacing: .004em; }
.meta { position: absolute; top: 29px; right: var(--m); display: flex; gap: 104px; font-size: 13px; line-height: 1.2; letter-spacing: .01em; }
.meta span:first-child { max-width: 300px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.eyebrow { position: absolute; top: 29px; left: var(--m); font-size: 13px; line-height: 1.2; letter-spacing: .01em; }
.serif { font-family: var(--serif); text-transform: uppercase; font-weight: 400; letter-spacing: .03em; }

/* Cards on the cream frame, with binder tabs */
.card { position: absolute; left: var(--m); right: var(--m); bottom: 35px; border-radius: 13px; }
.holes i { position: absolute; left: 0; width: 66px; height: 42px; transform: translateY(-50%); }
.holes i:nth-child(1) { top: 20.5%; } .holes i:nth-child(2) { top: 50%; } .holes i:nth-child(3) { top: 79.5%; }
.holes i::before { content: ""; position: absolute; left: -1px; top: 14px; width: 30px; height: 14px; background: var(--frame); }
.holes b { position: absolute; left: 21px; top: 0; width: 45px; height: 42px; border-radius: 8px; background: var(--frame); }

.cover-card { top: 35px; color: var(--ink); }
.cover-title { position: absolute; left: 196px; right: 119px; top: 0; bottom: 0; display: flex; flex-direction: column; justify-content: center; font-weight: 700; text-transform: uppercase; line-height: .82; letter-spacing: -.005em; }
.cover-title span { display: block; white-space: nowrap; }
.cover-title span:first-child { text-align: left; padding-right: 177px; }
.cover-title span + span { text-align: right; padding-left: 227px; }
.cover-title span:only-child { padding: 0; }
.date { position: absolute; left: 909px; top: 128px; max-width: 250px; font-family: var(--display-font); font-weight: 700; font-size: 22px; line-height: 1; letter-spacing: .03em; text-transform: uppercase; }
.dash { position: absolute; left: 103px; bottom: 132px; max-width: 300px; list-style: none; display: flex; flex-direction: column; gap: 22px; font-family: var(--display-font); font-weight: 700; font-size: 23px; line-height: 1.05; letter-spacing: .035em; text-transform: uppercase; }
.dash li { display: flex; gap: 12px; }
.many .dash { bottom: 60px; }

.msg-card { top: 68px; color: var(--ink); display: grid; place-items: center; padding: 60px 150px; }
.msg { display: flex; flex-direction: column; align-items: center; gap: 86px; text-align: center; max-width: 820px; }
.msg h2 { font-family: var(--serif); text-transform: uppercase; font-size: 30px; line-height: 1.15; letter-spacing: .035em; }
.msg p { font-size: 38px; line-height: 1.17; letter-spacing: -.005em; text-wrap: balance; }
.msg p.long { font-size: 31px; }
.msg .who { display: flex; flex-direction: column; align-items: center; gap: 12px; }
.msg .who span { font-size: 18px; }

/* Agenda: stencil numerals */
.ag-item { position: absolute; display: flex; align-items: center; gap: 30px; }
.ag-item b { font-family: var(--stencil); font-weight: 700; line-height: .8; }
.ag-item span { font-family: var(--serif); text-transform: uppercase; font-size: 17px; line-height: 1.35; letter-spacing: .06em; }

/* Section: big stencil number with a serif title */
.sect { position: absolute; inset: 120px 110px 70px 96px; display: flex; align-items: center; gap: 64px; }
.sect b { flex: none; font-family: var(--stencil); font-weight: 700; font-size: 400px; line-height: .78; letter-spacing: -.02em; }
.sect .txt { display: flex; flex-direction: column; gap: 30px; }
.sect h2 { font-family: var(--serif); text-transform: uppercase; font-size: 44px; line-height: 1.32; letter-spacing: .03em; }
.sect p { font-size: 26px; line-height: 1.3; max-width: 520px; }

/* Statement */
.stmt { position: absolute; left: 68px; right: 120px; top: 200px; font-family: var(--serif); text-transform: uppercase; font-size: 35px; line-height: 1.68; letter-spacing: .035em; }

/* Principle cards */
.pcards { position: absolute; left: var(--m); right: var(--m); top: 163px; bottom: 34px; display: grid; grid-template-columns: repeat(var(--n), 1fr); gap: 27px; }
.pcard { border-radius: 32px; padding: 54px 40px 40px; display: grid; grid-template-rows: auto 1fr auto auto; color: var(--ink); }
.pcard b { font-family: var(--stencil); font-weight: 700; font-size: 250px; line-height: .78; }
.pcard h3 { grid-row: 3; min-height: 2.4em; font-family: var(--serif); text-transform: uppercase; font-size: 20px; line-height: 1.2; letter-spacing: .05em; }
.pcard p { grid-row: 4; margin-top: 16px; min-height: 3.96em; font-size: 19px; line-height: 1.32; }

/* Image + text */
.it-media { position: absolute; left: var(--m); top: 150px; width: 640px; bottom: 47px; border-radius: 13px; overflow: hidden; object-fit: cover; }
.it-body { position: absolute; left: 744px; right: var(--m); top: 150px; bottom: 47px; display: flex; flex-direction: column; justify-content: center; gap: 34px; }
.it-body p { font-size: 30px; line-height: 1.3; }
.it-body .rule { border-top: 1.5px dashed var(--rule-light); }
.ph { overflow: hidden; display: grid; place-items: center; }
.ph .blob-shape { position: relative; inset: auto; width: 36%; height: auto; max-height: 70%; }

/* Metrics: agenda blobs */
.blobs { position: absolute; left: 19px; right: 19px; top: 205px; height: 417px; display: flex; justify-content: center; gap: 30px; }
.blob { position: relative; width: 292px; height: 417px; color: var(--ink); text-align: center; }
.blob-shape { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.blob .idx { position: absolute; top: 44px; left: 0; right: 0; font-family: var(--wide); font-weight: 700; font-size: 17px; letter-spacing: .04em; }
.blob .val { position: absolute; top: 100px; left: 0; right: 0; font-family: var(--stencil); font-weight: 700; font-size: 84px; line-height: 1; white-space: nowrap; }
.blob .lab { position: absolute; left: 56px; right: 56px; bottom: 50px; font-family: var(--display-font); font-weight: 700; font-size: 24px; line-height: 1.12; letter-spacing: .05em; text-transform: uppercase; }

/* Dashed rows with marks */
.rows { position: absolute; left: var(--m); right: var(--m); top: 169px; list-style: none; border-top: 1.5px dashed var(--rule); }
.rows li { display: flex; align-items: center; gap: 0; border-bottom: 1.5px dashed var(--rule); height: var(--h); }
.rows .mark { flex: none; width: 48px; height: 48px; margin: 0 76px 0 52px; }
.rows span { font-size: var(--fs); line-height: 1.12; letter-spacing: -.005em; }

/* Two columns */
.cols { position: absolute; left: var(--m); right: var(--m); top: 169px; bottom: 70px; display: grid; grid-template-columns: 1fr 1fr; border-top: 1.5px dashed var(--rule); border-bottom: 1.5px dashed var(--rule); }
.col { padding: 52px 56px 40px 0; display: flex; flex-direction: column; gap: 30px; }
.col + .col { padding-left: 56px; border-left: 1.5px dashed var(--rule); }
.col .mark { width: 52px; height: 52px; }
.col h3 { font-family: var(--serif); text-transform: uppercase; font-size: 26px; line-height: 1.2; letter-spacing: .04em; }
.col p { font-size: 30px; line-height: 1.25; }

/* Process bar */
.bar { position: absolute; left: var(--m); right: var(--m); top: 205px; display: grid; grid-template-columns: repeat(var(--n), 1fr); }
.seg { height: 49px; display: flex; align-items: center; gap: 22px; padding: 0 20px 0 27px; color: var(--ink); white-space: nowrap; overflow: hidden; }
.seg:first-child { border-radius: 25px 0 0 25px; color: var(--cream); }
.seg:last-child { border-radius: 0 25px 25px 0; }
.seg em { font-style: normal; font-family: var(--wide); font-weight: 700; font-size: 15px; letter-spacing: .03em; }
.seg strong { font-family: var(--display-font); font-weight: 700; font-size: 19px; letter-spacing: .07em; text-transform: uppercase; overflow: hidden; text-overflow: ellipsis; }
.seg-body { position: absolute; top: 280px; left: var(--m); right: var(--m); display: grid; grid-template-columns: repeat(var(--n), 1fr); }
.seg-body p { padding: 0 34px 0 27px; font-size: 20px; line-height: 1.3; }

/* Table */
.tbl { position: absolute; left: var(--m); width: calc(100% - 2 * var(--m)); top: 180px; border-collapse: collapse; }
.tbl th { padding: 0 0 26px; text-align: left; vertical-align: bottom; }
.tbl th span { display: inline-flex; align-items: center; height: 50px; padding: 0 24px; border-radius: 6px; color: var(--cream); font-family: var(--display-font); font-weight: 700; font-size: 25px; letter-spacing: .06em; text-transform: uppercase; }
.tbl td { padding: 26px 20px 26px 0; border-top: 1.5px dashed var(--rule-light); font-size: 26px; line-height: 1.2; }
.tbl tr:last-child td { border-bottom: 1.5px dashed var(--rule-light); }
.tbl td:first-child { font-family: var(--serif); text-transform: uppercase; font-size: 17px; letter-spacing: .05em; width: 30%; }

/* Big number */
.bign { position: absolute; inset: 110px 96px 60px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 30px; }
.bign b { font-family: var(--stencil); font-weight: 700; font-size: 330px; line-height: .8; letter-spacing: -.01em; color: var(--orange); }
.bign h2 { font-family: var(--serif); text-transform: uppercase; font-size: 36px; line-height: 1.2; letter-spacing: .04em; }
.bign p { font-size: 24px; line-height: 1.3; max-width: 680px; }

/* Team */
.team { position: absolute; left: var(--m); right: var(--m); top: 192px; display: grid; grid-template-columns: repeat(var(--n), 1fr); gap: 27px; }
.person h3 { font-family: var(--serif); text-transform: uppercase; font-size: 19px; line-height: 1.2; letter-spacing: .05em; height: 24px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.face { width: 100%; height: 300px; margin-top: 22px; border-radius: 13px; object-fit: cover; overflow: hidden; }
.face.ph span { font-family: var(--stencil); font-weight: 700; font-size: 150px; line-height: 1; color: var(--ink); }
.person p { margin-top: 40px; font-size: 20px; line-height: 1.3; }

/* Frame: the titled cream content slide that chart and custom slides draw into */
.framed { display: flex; flex-direction: column; padding: 27px var(--m) 44px; }
.fhead { flex: none; display: flex; flex-direction: column; gap: 10px; max-width: 760px; }
.fhead .hdr { position: static; }
.fhead .feyebrow { font-size: 13px; line-height: 1.2; letter-spacing: .01em; }
.framed .avn-body { margin-top: 40px; }
.framed .avn-caption { margin-top: 16px; padding-top: 12px; border-top: 1.5px dashed var(--rule-light); font-family: var(--serif); text-transform: uppercase; font-size: 14px; letter-spacing: .05em; color: var(--ink); }

/* Full image */
.full { padding: 0; }
.full .media { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.full .media.ph { background: #C3C5C0 !important; }
.full .media.ph .blob-shape { position: absolute; inset: auto; width: 230px; height: auto; left: 560px; top: 200px; }
.full .cap { position: absolute; left: 140px; right: 140px; top: 50%; transform: translateY(-50%); text-align: center; color: var(--ink); font-size: 36px; line-height: 1.3; letter-spacing: .04em; }
`
}

export const slides = {
  cover: (d, ctx) => coverCard('cover', d.title,
    [d.eyebrow && d.eyebrow !== d.title ? d.eyebrow : null, d.subtitle, ctx.deck.presenter].filter(Boolean),
    ctx.deck.date, ctx),

  agenda: (d, ctx) => {
    const n = d.items.length
    const cols = n <= 4 ? 2 : 3
    const second = n - cols
    const pos = cols === 2
      ? { x: [[250, 650], second === 1 ? [450] : [370, 770]], y: [180, 448], size: 250, label: 230 }
      : { x: [[100, 470, 840], second === 2 ? [285, 655] : [170, 540, 910]], y: [180, 448], size: 220, label: 180 }
    const tones = ['orange', 'teal', 'tan', 'pink', 'blue', 'orange']
    return `<section class="slide dark">${head(d.title, ctx)}
      ${d.items.map((item, i) => {
        const row = i < cols ? 0 : 1
        const x = pos.x[row][row ? i - cols : i]
        return `<div class="ag-item" style="left:${x}px;top:${pos.y[row]}px"><b style="font-size:${pos.size}px;color:var(--${tones[i]})">${i + 1}</b><span style="max-width:${pos.label}px">${ctx.esc(item)}</span></div>`
      }).join('')}</section>`
  },

  section: (d, ctx) => {
    const i = Math.max(0, (parseInt(d.number, 10) || 1) - 1)
    return `<section class="slide dark">${meta(ctx)}<div class="sect"><b style="color:${tone(i, ['teal', 'blue', 'pink', 'tan', 'orange'])}">${ctx.esc(d.number)}</b>
      <div class="txt"><h2>${ctx.esc(d.title)}</h2>${d.subtitle ? `<p>${ctx.esc(d.subtitle)}</p>` : ''}</div></div></section>`
  },

  statement: (d, ctx) => `<section class="slide dark">${d.attribution ? head(d.attribution, ctx, 'var(--orange)') : ''}${meta(ctx)}
    <p class="stmt">${ctx.esc(d.text)}</p></section>`,

  text: (d, ctx) => messageCard('var(--blue)', `<h2>${ctx.esc(d.title)}</h2>`,
    `<p${d.body.length > 240 ? ' class="long"' : ''}>${ctx.esc(d.body)}</p>`, ctx, d.eyebrow),

  points: (d, ctx) => `<section class="slide">${head(d.title, ctx)}${meta(ctx)}
    <div class="pcards" style="--n:${d.items.length}">${d.items.map((item, i) => `<div class="pcard" style="background:${tone(i, ['tan', 'pink', 'orange', 'teal'])}">
      <b>${i + 1}</b><h3>${ctx.esc(item.title)}</h3><p>${ctx.esc(item.body)}</p></div>`).join('')}</div></section>`,

  'image-text': (d, ctx) => `<section class="slide">${head(d.title, ctx)}${meta(ctx)}${picture(d.image, ctx, 'it-media', 0)}
    <div class="it-body"><span class="rule"></span><p>${ctx.esc(d.body)}</p><span class="rule"></span></div></section>`,

  metrics: (d, ctx) => `<section class="slide dark">${head(d.title, ctx)}${meta(ctx)}
    <div class="blobs">${d.items.map((m, i) => `<div class="blob">${blob(i, tone(i, ['orange', 'teal', 'blue', 'tan']))}
      <span class="idx">${pad2(i + 1)}</span><b class="val" style="${valueSize(m.value)}">${ctx.esc(m.value)}</b><span class="lab">${ctx.esc(m.label)}</span></div>`).join('')}</div></section>`,

  'two-column': (d, ctx) => `<section class="slide dark">${head(d.title, ctx, 'var(--tan)')}${meta(ctx)}
    <div class="cols">${d.columns.map((c, i) => `<div class="col">${mark(i)}<h3>${ctx.esc(c.title)}</h3><p>${ctx.esc(c.body)}</p></div>`).join('')}</div></section>`,

  timeline: (d, ctx) => {
    const tones = ['orange', 'blue', 'pink', 'teal', 'tan']
    return `<section class="slide">${head(d.title, ctx)}${meta(ctx)}
      <div class="bar" style="--n:${d.steps.length}">${d.steps.map((s, i) => `<div class="seg" style="background:var(--${tones[i % 5]})"><em>${ctx.esc(s.when)}</em><strong>${ctx.esc(s.title)}</strong></div>`).join('')}</div>
      <div class="seg-body" style="--n:${d.steps.length}">${d.steps.map((s) => `<p>${ctx.esc(s.body ?? '')}</p>`).join('')}</div></section>`
  },

  quote: (d, ctx) => messageCard('var(--tan)',
    `<div class="who"><h2>${ctx.esc(d.name)}</h2>${d.role ? `<span>${ctx.esc(d.role)}</span>` : ''}</div>`,
    `<p${d.text.length > 200 ? ' class="long"' : ''}>“${ctx.esc(d.text)}”</p>`, ctx),

  table: (d, ctx) => `<section class="slide">${head(d.title, ctx)}${meta(ctx)}
    <table class="tbl"><thead><tr>${d.columns.map((c, i) => `<th>${c ? `<span style="background:${tone(i - 1, ['orange', 'teal', 'pink', 'blue'])}">${ctx.esc(c)}</span>` : ''}</th>`).join('')}</tr></thead>
    <tbody>${d.rows.map((r) => `<tr>${r.map((c) => `<td>${ctx.esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></section>`,

  'big-number': (d, ctx) => `<section class="slide dark">${meta(ctx)}<div class="bign"><b>${ctx.esc(d.value)}</b>
    <h2>${ctx.esc(d.label)}</h2>${d.body ? `<p>${ctx.esc(d.body)}</p>` : ''}</div></section>`,

  bullets: (d, ctx) => {
    const n = d.items.length
    const h = Math.min(115, Math.floor(510 / n))
    const fs = n <= 4 ? 40 : n === 5 ? 36 : 32
    return `<section class="slide dark">${head(d.title, ctx, 'var(--tan)')}${meta(ctx)}
      <ul class="rows" style="--h:${h}px;--fs:${fs}px">${d.items.map((item, i) => `<li>${mark(i)}<span>${ctx.esc(item)}</span></li>`).join('')}</ul></section>`
  },

  team: (d, ctx) => `<section class="slide">${head(d.title, ctx)}${meta(ctx)}
    <div class="team" style="--n:${d.people.length}">${d.people.map((p, i) => {
      const src = p.image && ctx.image(p.image)
      const face = src
        ? `<img class="face" src="${ctx.esc(src)}" alt="${ctx.esc(p.name)}">`
        : `<div class="face ph" role="img" aria-label="${ctx.esc(p.name)}" style="background:${tone(i, ['orange', 'teal', 'pink', 'blue'])}"><span>${ctx.esc(initials(p.name))}</span></div>`
      return `<div class="person"><h3>${ctx.esc(p.name)}</h3>${face}<p>${ctx.esc(p.role)}</p></div>`
    }).join('')}</div></section>`,

  image: (d, ctx) => `<section class="slide full">${picture(d.image, ctx, 'media', 2, 0)}${d.caption ? `<p class="cap serif">${ctx.esc(d.caption)}</p>` : ''}</section>`,

  frame: ({ title, eyebrow }, ctx, body) => `<section class="slide framed">${meta(ctx)}<div class="fhead">${eyebrow ? `<span class="feyebrow">${ctx.esc(eyebrow)}</span>` : ''}${title ? `<h2 class="hdr">${ctx.esc(title)}</h2>` : ''}</div>${body}</section>`,

  closing: (d, ctx) => coverCard('closing', d.title, [d.subtitle, d.contact].filter(Boolean), ctx.deck.date, ctx),
}
