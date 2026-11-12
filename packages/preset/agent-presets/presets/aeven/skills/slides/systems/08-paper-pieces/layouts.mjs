/**
 * Paper Pieces: torn and cut paper pieces (blobby flowers, jagged polygons, torn strips) in
 * butter, lavender, peach, khaki and pale grey on grey, black or khaki pages; titles set at a
 * slant inside the pieces in a grotesque; typewriter meta, lists and body copy; a hand-drawn
 * arrow, oval and wobbly rules. Measured and traced from the 16 frames of Figma's "Paper Pieces"
 * (Figma Community, CC BY 4.0). The pieces live in `pieces.mjs`.
 */
import { PIECES } from './pieces.mjs'

let clipSeq = 0

/**
 * One paper piece as an absolutely placed SVG, stretched to `w`×`h`. With `img` the picture is
 * clipped into the piece; `line` draws the black cut outline the light pages use.
 */
function piece(name, { x = 0, y = 0, w, h, fill = 'none', line = false, rot = 0, img, alt = '' }, ctx) {
  const p = PIECES[name]
  w ??= p.w; h ??= p.h
  const t = `scale(${(w / p.w).toFixed(4)} ${(h / p.h).toFixed(4)})`
  const stroke = 'stroke="var(--outline)" stroke-width="2.4" stroke-linejoin="round" vector-effect="non-scaling-stroke"'
  let body = `<path transform="${t}" d="${p.d}" fill="${fill}"${line ? ` ${stroke}` : ''}/>`
  if (img) {
    const id = `pp-clip-${++clipSeq}`
    body = `<clipPath id="${id}"><path transform="${t}" d="${p.d}"/></clipPath>`
      + `<image href="${ctx.esc(img)}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})"/>`
      + (line ? `<path transform="${t}" d="${p.d}" fill="none" ${stroke}/>` : '')
  }
  const role = alt ? ` role="img" aria-label="${ctx.esc(alt)}"` : ' aria-hidden="true"'
  return `<svg class="piece" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px${rot ? `;transform:rotate(${rot}deg)` : ''}" viewBox="0 0 ${w} ${h}"${role}>${body}</svg>`
}

/** An edge piece in slide coordinates, running past the slide edges. */
const edge = (name, fill, line, ctx, w = 1280) => piece(name, { w, h: 720, fill, line }, ctx)

/** A picture slot: the user's picture clipped into a piece, or the bare piece as the placeholder. */
function picture(image, name, box, fill, ctx) {
  const src = image && ctx.image(image)
  return piece(name, { ...box, fill, img: src, alt: image?.alt ?? '' }, ctx)
}

const pts = (list) => list.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')

/** A hand-drawn loop: one stroke going round once, overshooting its start into a tail. */
function oval({ x, y, w, h, color }) {
  const cx = w / 2, cy = h / 2, rx = w / 2 - 12, ry = h / 2 - 12
  const a0 = -0.5, turn = Math.PI * 2 + 0.55, n = 90
  const list = []
  for (let i = 0; i <= n; i++) {
    const a = a0 - (turn * i) / n
    const k = 0.95 + 0.07 * (i / n) + 0.015 * Math.sin(a * 3)
    list.push([cx + rx * k * Math.cos(a), cy + ry * k * Math.sin(a)])
  }
  const [px, py] = list[n - 1], [ex, ey] = list[n]
  const len = Math.hypot(ex - px, ey - py)
  list.push([ex + ((ex - px) / len) * w * 0.16, ey + ((ey - py) / len) * w * 0.16])
  return `<svg class="piece" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${pts(list)}" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
}

/** A hand-drawn rule: a slightly wavering marker line. */
function wobble({ x, y, w, color }) {
  const list = []
  for (let i = 0, n = Math.round(w / 28); i <= n; i++) {
    list.push([(w * i) / n, 10 + 2.6 * Math.sin(i * 0.55) + 1.6 * Math.sin(i * 1.7 + 1)])
  }
  return `<svg class="piece" style="left:${x}px;top:${y - 10}px;width:${w}px;height:20px" viewBox="0 0 ${w} 20" aria-hidden="true"><path d="${pts(list)}" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
}

/** The typewriter running head: deck title and date, top right. */
const meta = (ctx) => `<p class="meta">${ctx.esc(ctx.deck.title)}${ctx.deck.date ? ` / ${ctx.esc(ctx.deck.date)}` : ''}</p>`

/** Text slanted inside a piece: a box centred on its own middle, turned by `rot` degrees. */
const slant = ({ x, y, w, h, rot }, inner) => `<div class="slant" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;transform:rotate(${rot}deg)">${inner}</div>`

/** The first size whose length limit the text fits under. */
const fit = (text, steps) => (steps.find(([max]) => String(text).length <= max) ?? steps[steps.length - 1])[1]

const WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve']
const word = (number) => WORDS[Number.parseInt(number, 10)] ?? number

const initials = (name) => name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2)

export function css(system) {
  const { surface, paper, ink } = system
  return `
:root { --page: ${surface.page}; --dark: ${surface.dark}; --ink: ${ink.primary}; --on-dark: ${ink.onDark}; --outline: ${ink.outline};
  --butter: ${paper.butter}; --lavender: ${paper.lavender}; --peach: ${paper.peach}; --khaki: ${paper.khaki}; --grey: ${paper.grey}; }
.slide { background: var(--page); color: var(--ink); font-size: 18px; line-height: 1.45; letter-spacing: .04em; font-weight: 400; }
.slide.dark { background: var(--dark); color: var(--on-dark); }
.slide.khaki { background: var(--khaki); }
.slide.peach { background: var(--peach); }
.slide.lavender { background: var(--lavender); }
.piece { position: absolute; overflow: visible; display: block; }
.d { font-family: var(--display-font); letter-spacing: -.012em; line-height: 1.08; font-weight: 400; }
.meta { position: absolute; top: 30px; right: 46px; font-size: 13px; letter-spacing: .05em; white-space: nowrap; z-index: 2; }
.slant { position: absolute; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 14px; }
.abs { position: absolute; }
.center { text-align: center; }
.title { font-size: 46px; line-height: 1.16; }
.panel { position: absolute; left: 0; top: 0; bottom: 0; }

.cover-meta { left: 1032px; top: 200px; font-size: 15px; line-height: 1.45; letter-spacing: .05em; }
.cover-sub { left: 1032px; top: 290px; width: 200px; font-size: 15px; line-height: 1.45; letter-spacing: .05em; }

.agenda-title { left: 90px; top: 400px; width: 400px; height: 200px; display: flex; align-items: flex-end; text-transform: uppercase; line-height: 1; }
.agenda-list { left: 730px; right: 46px; top: 0; bottom: 0; list-style: none; display: flex; flex-direction: column; justify-content: center; font-size: 30px; line-height: 1.25; letter-spacing: .1em; }
.agenda-list li { display: grid; grid-template-columns: 62px 1fr; }

.sec-title { left: 590px; right: 56px; top: 90px; bottom: 90px; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; gap: 26px; }
.sec-title h2 { line-height: 1.04; }
.sec-title p { font-size: 17px; max-width: 520px; }

.stmt { left: 170px; right: 180px; top: 112px; height: 470px; display: flex; align-items: center; justify-content: center; text-align: center; }
.stmt p { font-size: 62px; line-height: 1.12; text-wrap: balance; }
.attr { left: 168px; width: 890px; top: 618px; text-align: center; font-size: 15px; }

.side { left: 710px; right: 70px; top: 80px; bottom: 60px; display: flex; flex-direction: column; justify-content: center; gap: 24px; }
.side .eyebrow { font-size: 14px; letter-spacing: .06em; }
.side .body { font-size: 21px; line-height: 1.55; }

.cols { display: grid; grid-template-columns: repeat(var(--n), 1fr); column-gap: 64px; }
.col { display: flex; flex-direction: column; gap: 14px; }
.col .num { font-size: 20px; }
.col h3 { font-size: 26px; line-height: 1.15; letter-spacing: -.01em; }
.col p { font-size: 17px; line-height: 1.55; letter-spacing: .05em; }

.scrap { position: absolute; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 10px; color: var(--ink); }
.scrap b { font-family: var(--display-font); font-weight: 400; font-size: 64px; line-height: 1; letter-spacing: -.02em; }
.scrap span { font-size: 14px; line-height: 1.35; max-width: 160px; }

.steps { left: 100px; right: 100px; display: grid; grid-template-columns: repeat(var(--n), 1fr); column-gap: 40px; }
.steps .when { font-size: 50px; line-height: 1; }
.steps h3 { font-size: 24px; line-height: 1.15; margin-bottom: 10px; }
.steps p { font-size: 16px; line-height: 1.5; }

.quote-text { left: 150px; right: 150px; top: 80px; height: 500px; display: flex; align-items: center; justify-content: center; text-align: center; }
.quote-text p { font-size: 62px; line-height: 1.12; text-wrap: balance; }
.by { left: 200px; right: 200px; top: 628px; text-align: center; font-size: 15px; line-height: 1.45; }

table { position: absolute; left: 170px; width: 940px; top: 250px; border-collapse: collapse; }
th { text-align: left; font-family: var(--display-font); font-weight: 400; font-size: 23px; letter-spacing: -.01em; padding: 0 16px 14px 0; }
td { font-size: 19px; padding: 20px 16px 20px 0; border-top: 1.5px solid var(--outline); letter-spacing: .05em; }
.tight td { padding: 12px 16px 12px 0; }

.big-value { left: 45px; top: 70px; width: 660px; height: 270px; display: flex; align-items: center; justify-content: center; font-size: 190px; line-height: 1; letter-spacing: -.03em; }
.big-label { left: 760px; right: 70px; top: 90px; height: 240px; display: flex; align-items: center; justify-content: center; text-align: center; font-size: 44px; line-height: 1.12; }
.big-body { left: 220px; right: 220px; top: 488px; text-align: center; font-size: 22px; line-height: 1.55; text-wrap: balance; }

.list { left: 700px; right: 70px; top: 80px; bottom: 60px; list-style: none; display: flex; flex-direction: column; justify-content: center; gap: 26px; }
.list li { display: grid; grid-template-columns: 52px 1fr; align-items: baseline; }
.list .num { font-size: 20px; }
.list span + span { font-family: var(--display-font); font-size: 28px; line-height: 1.2; letter-spacing: -.01em; }

.person { position: absolute; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 6px; }
.person h3 { font-size: 25px; line-height: 1.15; margin-top: 18px; letter-spacing: -.01em; }
.person p { font-size: 15px; }
.face { position: absolute; display: flex; align-items: center; justify-content: center; font-size: 58px; transform: rotate(-10deg); }

.caption { left: 120px; right: 120px; top: 652px; text-align: center; font-size: 16px; }

.close-title { text-transform: uppercase; line-height: 1; }
.framed { display: flex; flex-direction: column; padding: 92px 80px 52px; }
.framed .eyebrow { text-align: center; font-size: 14px; letter-spacing: .06em; margin-bottom: 10px; }
.framed .rule { position: relative; flex: none; height: 20px; margin: 16px 0 28px; }
.contact { left: 760px; width: 366px; top: 560px; text-align: center; font-size: 15px; line-height: 1.45; }
`
}

const SECTION_LOOKS = [
  { page: '', panel: 'var(--peach)', star: 'var(--grey)' },
  { page: 'dark', panel: 'var(--khaki)', star: 'var(--butter)' },
  { page: '', panel: 'var(--lavender)', star: 'var(--peach)' },
]

const SCRAPS = [
  { name: 'flower', fill: 'var(--butter)', rot: -8 },
  { name: 'gem', fill: 'var(--lavender)', rot: 5 },
  { name: 'star', fill: 'var(--peach)', rot: -5 },
  { name: 'tornBottom', fill: 'var(--khaki)', rot: 4, lift: -16 },
]

const FACES = [
  { name: 'flower', fill: 'var(--butter)' },
  { name: 'shard', fill: 'var(--grey)' },
  { name: 'star', fill: 'var(--peach)' },
  { name: 'gem', fill: 'var(--lavender)' },
]

export const slides = {
  cover: (d, ctx) => `<section class="slide cover">
    ${edge('flowerBig', 'var(--butter)', true, ctx)}${edge('strip', 'var(--lavender)', true, ctx)}
    ${slant({ x: 130, y: 150, w: 680, h: 420, rot: -13 }, `<h1 class="d" style="max-width:560px;font-size:${fit(d.title, [[14, 108], [24, 88], [40, 70], [999, 56]])}px">${ctx.esc(d.title)}</h1>`)}
    <div class="abs cover-meta">${d.eyebrow ? `<p>${ctx.esc(d.eyebrow)}</p>` : ''}${ctx.deck.date ? `<p>Date: ${ctx.esc(ctx.deck.date)}</p>` : ''}</div>
    ${d.subtitle ? `<p class="abs cover-sub">${ctx.esc(d.subtitle)}</p>` : ''}</section>`,

  agenda: (d, ctx) => `<section class="slide agenda"><div class="panel" style="width:586px;background:var(--peach)"></div>
    ${piece('shard', { x: 4, y: 5, fill: 'var(--grey)', line: true }, ctx)}${piece('arrow', { x: 314, y: 195, fill: 'var(--ink)' }, ctx)}
    <h2 class="d abs agenda-title" style="font-size:${fit(d.title, [[8, 84], [16, 64], [999, 48]])}px">${ctx.esc(d.title)}</h2>${meta(ctx)}
    <ol class="abs agenda-list" style="gap:${d.items.length > 4 ? 30 : 46}px">${d.items.map((item, i) => `<li><span>${i + 1}.</span><span>${ctx.esc(item)}</span></li>`).join('')}</ol></section>`,

  section: (d, ctx) => {
    const look = SECTION_LOOKS[(Math.max(1, Number.parseInt(d.number, 10) || 1) - 1) % SECTION_LOOKS.length]
    return `<section class="slide ${look.page}">${piece('tearV', { w: 1075, h: 720, fill: look.panel }, ctx)}
    ${piece('star2', { x: 0, y: 4, fill: look.star }, ctx)}
    ${slant({ x: 70, y: 290, w: 340, h: 160, rot: -30 }, `<p class="d" style="font-size:66px;color:var(--ink)">${ctx.esc(word(d.number))}</p>`)}
    ${meta(ctx)}<div class="abs sec-title"><h2 class="d" style="font-size:${fit(d.title, [[14, 96], [26, 80], [999, 60]])}px">${ctx.esc(d.title)}</h2>
    ${d.subtitle ? `<p>${ctx.esc(d.subtitle)}</p>` : ''}</div></section>`
  },

  statement: (d, ctx) => `<section class="slide">${piece('gem', { x: 68, y: 52, fill: 'var(--butter)', line: true }, ctx)}${meta(ctx)}
    <div class="abs stmt"><p class="d" style="font-size:${fit(d.text, [[90, 62], [140, 52], [999, 42]])}px">${ctx.esc(d.text)}</p></div>
    ${d.attribution ? `<p class="abs attr">${ctx.esc(d.attribution)}</p>` : ''}</section>`,

  text: (d, ctx) => `<section class="slide">${edge('tearV', 'var(--peach)', false, ctx)}
    ${slant({ x: 90, y: 190, w: 440, h: 340, rot: -34 }, `<h2 class="d" style="font-size:${fit(d.title, [[16, 78], [28, 60], [999, 46]])}px">${ctx.esc(d.title)}</h2>`)}
    ${meta(ctx)}<div class="abs side">${d.eyebrow ? `<p class="eyebrow">${ctx.esc(d.eyebrow)}</p>` : ''}<p class="body">${ctx.esc(d.body)}</p></div></section>`,

  points: (d, ctx) => `<section class="slide">${edge('bandTop', 'var(--lavender)', false, ctx)}${meta(ctx)}
    <h2 class="d abs title center" style="left:170px;right:170px;top:104px">${ctx.esc(d.title)}</h2>
    <div class="abs cols" style="--n:${d.items.length};left:62px;right:62px;top:396px">${d.items.map((item, i) => `<div class="col"><span class="num">${i + 1}</span><h3 class="d">${ctx.esc(item.title)}</h3><p>${ctx.esc(item.body)}</p></div>`).join('')}</div></section>`,

  'image-text': (d, ctx) => `<section class="slide">${picture(d.image, 'tornBottom', { x: 64, y: 150, w: 620, h: 410, rot: -3, line: true }, 'var(--lavender)', ctx)}
    ${meta(ctx)}<div class="abs side" style="left:760px"><h2 class="d title">${ctx.esc(d.title)}</h2><p class="body" style="font-size:19px">${ctx.esc(d.body)}</p></div></section>`,

  metrics: (d, ctx) => {
    const n = d.items.length, slot = (1280 - 120) / n, w = Math.min(280, slot - 20), h = 236
    return `<section class="slide dark">${meta(ctx)}<h2 class="d abs title center" style="left:160px;right:160px;top:96px">${ctx.esc(d.title)}</h2>
    ${d.items.map((m, i) => {
      const s = SCRAPS[i % SCRAPS.length], x = Math.round(60 + slot * i + (slot - w) / 2), y = i % 2 ? 318 : 290
      return piece(s.name, { x, y, w, h, fill: s.fill }, ctx)
        + `<div class="scrap" style="left:${x}px;top:${y + (s.lift ?? 0)}px;width:${w}px;height:${h}px;transform:rotate(${s.rot}deg)"><b style="font-size:${fit(m.value, [[4, 64], [5, 54], [999, 44]])}px">${ctx.esc(m.value)}</b><span>${ctx.esc(m.label)}</span></div>`
    }).join('')}</section>`
  },

  'two-column': (d, ctx) => `<section class="slide peach">${edge('ridge', 'var(--grey)', false, ctx)}${meta(ctx)}
    <h2 class="d abs title center" style="left:170px;right:170px;top:112px">${ctx.esc(d.title)}</h2>
    <div class="abs cols" style="--n:2;left:96px;right:96px;top:330px;column-gap:120px">${d.columns.map((c, i) => `<div class="col"><span class="num">${i + 1}</span><h3 class="d" style="font-size:30px">${ctx.esc(c.title)}</h3><p style="font-size:19px">${ctx.esc(c.body)}</p></div>`).join('')}</div></section>`,

  timeline: (d, ctx) => `<section class="slide">${meta(ctx)}<h2 class="d abs title center" style="left:170px;right:170px;top:104px">${ctx.esc(d.title)}</h2>
    <div class="abs steps" style="--n:${d.steps.length};top:322px">${d.steps.map((s) => `<span class="d when">${ctx.esc(s.when)}</span>`).join('')}</div>
    ${wobble({ x: 110, y: 414, w: 1070, color: 'var(--lavender)' })}
    <div class="abs steps" style="--n:${d.steps.length};top:458px">${d.steps.map((s) => `<div><h3 class="d">${ctx.esc(s.title)}</h3>${s.body ? `<p>${ctx.esc(s.body)}</p>` : ''}</div>`).join('')}</div></section>`,

  quote: (d, ctx) => `<section class="slide lavender">${meta(ctx)}
    <div class="abs quote-text"><p class="d" style="font-size:${fit(d.text, [[90, 62], [140, 52], [999, 42]])}px">“${ctx.esc(d.text)}”</p></div>
    <div class="abs by"><p>${ctx.esc(d.name)}</p>${d.role ? `<p>${ctx.esc(d.role)}</p>` : ''}</div></section>`,

  table: (d, ctx) => `<section class="slide">${meta(ctx)}<h2 class="d abs title center" style="left:170px;right:170px;top:78px">${ctx.esc(d.title)}</h2>
    ${piece('tornBottom', { x: 90, y: 178, w: 1100, h: 500, fill: 'var(--butter)', line: true, rot: -1 }, ctx)}
    <table class="${d.rows.length > 3 ? 'tight' : ''}"><thead><tr>${d.columns.map((c) => `<th>${ctx.esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${d.rows.map((r) => `<tr>${r.map((c) => `<td>${ctx.esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></section>`,

  'big-number': (d, ctx) => `<section class="slide">${meta(ctx)}${oval({ x: 45, y: 70, w: 660, h: 270, color: 'var(--peach)' })}
    <b class="d abs big-value" style="font-size:${fit(d.value, [[3, 190], [5, 150], [999, 110]])}px">${ctx.esc(d.value)}</b>
    <h2 class="d abs big-label">${ctx.esc(d.label)}</h2>
    ${wobble({ x: 92, y: 428, w: 1066, color: 'var(--peach)' })}
    ${d.body ? `<p class="abs big-body">${ctx.esc(d.body)}</p>` : ''}</section>`,

  bullets: (d, ctx) => `<section class="slide dark">${piece('star', { x: 51, y: 8, fill: 'var(--peach)' }, ctx)}
    ${piece('tornBottom', { x: 91, y: 413, w: 526, h: 292, fill: 'var(--lavender)' }, ctx)}
    ${slant({ x: 130, y: 110, w: 340, h: 210, rot: -30 }, `<h2 class="d" style="font-size:${fit(d.title, [[16, 54], [24, 40], [999, 32]])}px;color:var(--ink)">${ctx.esc(d.title)}</h2>`)}
    ${meta(ctx)}<ol class="abs list">${d.items.map((item, i) => `<li><span class="num">${i + 1}</span><span>${ctx.esc(item)}</span></li>`).join('')}</ol></section>`,

  team: (d, ctx) => {
    const n = d.people.length, slot = (1280 - 120) / n, w = Math.min(250, slot - 40), h = 230
    return `<section class="slide khaki">${meta(ctx)}<h2 class="d abs title center" style="left:160px;right:160px;top:92px">${ctx.esc(d.title)}</h2>
    ${d.people.map((p, i) => {
      const f = FACES[i % FACES.length], x = Math.round(60 + slot * i + (slot - w) / 2), y = 250
      const src = p.image && ctx.image(p.image)
      return piece(f.name, { x, y, w, h, fill: f.fill, line: true, img: src, alt: src ? p.name : '' }, ctx)
        + (src ? '' : `<span class="d face" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px">${ctx.esc(initials(p.name))}</span>`)
        + `<div class="person" style="left:${Math.round(60 + slot * i)}px;width:${Math.round(slot)}px;top:${y + h}px"><h3 class="d">${ctx.esc(p.name)}</h3><p>${ctx.esc(p.role)}</p></div>`
    }).join('')}</section>`
  },

  image: (d, ctx) => `<section class="slide dark">${picture(d.image, 'gem', { x: 95, y: 34, w: 1090, h: 596 }, 'var(--lavender)', ctx)}
    ${d.caption ? `<p class="abs caption">${ctx.esc(d.caption)}</p>` : ''}</section>`,

  frame: ({ title, eyebrow }, ctx, body) => `<section class="slide framed">${meta(ctx)}
    ${eyebrow ? `<p class="eyebrow">${ctx.esc(eyebrow)}</p>` : ''}${title ? `<h2 class="d title center">${ctx.esc(title)}</h2>
    <div class="rule">${wobble({ x: 0, y: 10, w: 1120, color: 'var(--lavender)' })}</div>` : ''}${body}</section>`,

  closing: (d, ctx) => `<section class="slide khaki">
    ${piece('flower', { x: 46, y: 0, fill: 'var(--butter)', line: true }, ctx)}
    ${piece('tornBottom', { x: 590, y: 46, fill: 'var(--lavender)', line: true }, ctx)}
    ${edge('tornLeft', 'var(--peach)', true, ctx)}
    ${piece('gem', { x: 643, y: 380, w: 610, h: 400, fill: 'var(--grey)', line: true }, ctx)}
    ${d.subtitle ? slant({ x: 110, y: 90, w: 400, h: 250, rot: -22 }, `<p class="d" style="font-size:${fit(d.subtitle, [[30, 40], [60, 32], [999, 26]])}px">${ctx.esc(d.subtitle)}</p>`) : ''}
    ${slant({ x: 610, y: 66, w: 590, h: 260, rot: 0 }, `<h2 class="d close-title" style="font-size:${fit(d.title, [[10, 84], [18, 64], [999, 46]])}px">${ctx.esc(d.title)}</h2>`)}
    <div class="abs contact">${ctx.deck.presenter ? `<p>${ctx.esc(ctx.deck.presenter)}</p>` : ''}${d.contact ? `<p>${ctx.esc(d.contact)}</p>` : ''}</div></section>`,
}
