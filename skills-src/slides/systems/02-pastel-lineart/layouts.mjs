/**
 * Pastel Lineart: lime, salmon, lilac, purple and yellow fields split into flat panels, Poppins
 * SemiBold titles over Poppins Light body, white circles and black hexagon outlines as crops,
 * tinted blobs under white line-art shapes, orange scallop arcs and rust or violet leaves.
 * Measured from the 20 frames of "Presentation Template with Yuppies Illustrations" (Figma
 * Community) at 1920×1080 and drawn at 1280×720. The source's Yuppies characters are licensed
 * art: every slot that holds one draws the user's picture in the same crop, or abstract
 * placeholder shapes in the palette.
 */

const STROKE = 'stroke="#000" stroke-width="3" vector-effect="non-scaling-stroke"'
const BLOB = [
  'M50,2 C72,0 96,14 98,38 C100,60 88,70 92,84 C96,98 70,102 52,96 C36,91 22,100 10,88 C-2,76 4,60 3,46 C2,30 22,4 50,2 Z',
  'M30,6 C52,-4 70,10 84,8 C98,6 102,30 96,48 C90,66 100,80 86,92 C70,104 46,92 30,96 C12,100 -2,84 2,64 C5,48 -2,36 6,22 C10,12 18,10 30,6 Z',
  'M8,30 C14,8 40,4 60,10 C80,16 100,24 98,46 C96,64 76,62 70,78 C64,94 40,100 24,90 C8,80 18,64 10,54 C2,44 4,40 8,30 Z',
]

/** SVG primitives, in the coordinates of the scene that draws them. */
const blob = (x, y, w, h, fill, v = 0) => `<path d="${BLOB[v]}" fill="${fill}" transform="translate(${x} ${y}) scale(${w / 100} ${h / 100})"/>`
const ring = (cx, cy, r, stroke = '#000', fill = '#fff') => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="3" vector-effect="non-scaling-stroke"/>`
const pill = (x, y, w, h, fill = '#fff', rot = 0) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.min(w, h) / 2}" fill="${fill}" ${STROKE}${rot ? ` transform="rotate(${rot} ${x + w / 2} ${y + h / 2})"` : ''}/>`
const shadow = (cx, cy, rx, ry, p) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${p.shadow}"/>`
const leaf = (x, y, l, rot, fill) => `<path d="M0 0C${l * 0.3} ${-l * 0.34} ${l * 0.74} ${-l * 0.3} ${l} 0C${l * 0.7} ${l * 0.28} ${l * 0.28} ${l * 0.3} 0 0Z" fill="${fill}" transform="translate(${x} ${y}) rotate(${rot})"/>`
const dashes = (x, y, rot, color) => `<g transform="translate(${x} ${y}) rotate(${rot})" stroke="${color}" stroke-width="5" stroke-linecap="round" fill="none"><path d="M0 0h26M6 15h30M0 30h24"/></g>`
const defs = (id) => `<defs><pattern id="dots${id}" width="16" height="14" patternUnits="userSpaceOnUse"><ellipse cx="4" cy="4" rx="3.2" ry="2.2" fill="#000"/><ellipse cx="12" cy="10" rx="2.4" ry="1.7" fill="#000"/></pattern><pattern id="polka${id}" width="56" height="56" patternUnits="userSpaceOnUse"><circle cx="16" cy="16" r="11" fill="none" stroke="#000" stroke-width="2.5"/><circle cx="44" cy="44" r="11" fill="none" stroke="#000" stroke-width="2.5"/></pattern></defs>`

/** A hill of overlapping arcs, like the orange scallop fields behind the source's characters. */
function scallops(cx, cy, rx, ry, r, color) {
  let d = ''
  let k = 0
  for (let row = Math.floor(ry / (r * 0.8)); row >= 0; row--) {
    const y = cy - row * r * 0.8
    for (let x = cx - rx + (row % 2 ? r : 0); x <= cx + rx; x += r * 1.9) {
      if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 > 1) continue
      const a = r * (0.85 + ((k++ * 37) % 10) / 30)
      d += `M${x - a} ${y}A${a} ${a} 0 0 1 ${x + a} ${y}M${x - a * 0.52} ${y}A${a * 0.52} ${a * 0.52} 0 0 1 ${x + a * 0.52} ${y}`
    }
  }
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="4.5" stroke-linecap="round"/>`
}

/**
 * The stand-in for a character: a white circle crop with a black outline holding a tinted
 * blob and a small accent disc. `key` makes its clip id unique in the deck.
 */
const figure = (key, cx, cy, r, tint, dot) => `<clipPath id="f${key}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath><circle cx="${cx}" cy="${cy}" r="${r}" fill="#fff"/>`
  + `<g clip-path="url(#f${key})">${blob(cx - r * 1.15, cy - r * 0.1, r * 2.3, r * 1.4, tint, 1)}<circle cx="${cx + r * 0.3}" cy="${cy - r * 0.36}" r="${r * 0.24}" fill="${dot}"/></g>`
  + `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" ${STROKE}/>`

/** A specks field, like the rust rain beside the source's light bulb. */
function specks(x, y, cols, rows, color) {
  let out = ''
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if ((r * 7 + c * 3) % 5 === 0) continue
    out += `<ellipse cx="${x + c * 18 + (r % 2) * 9}" cy="${y + r * 22}" rx="2.4" ry="6" fill="${color}" transform="rotate(18 ${x + c * 18 + (r % 2) * 9} ${y + r * 22})"/>`
  }
  return out
}

/** An absolutely placed decorative SVG; `box` is [left, top, width, height] in slide pixels. */
const svg = (box, view, body, cls = '') => `<svg class="art ${cls}" viewBox="0 0 ${view[0]} ${view[1]}" style="left:${box[0]}px;top:${box[1]}px;width:${box[2]}px;height:${box[3]}px" aria-hidden="true">${body}</svg>`

/**
 * Placeholder scenes for the slots where the source draws a character. Each returns
 * `[viewWidth, viewHeight, body]`; shapes are abstract (blobs, circle crops, rings, arcs, leaves).
 */
const scenes = {
  walk: (p, id, tint) => [600, 560, blob(10, 40, 580, 360, tint, 0) + shadow(300, 528, 270, 13, p)
    + scallops(300, 522, 280, 210, 42, p.orange)
    + ring(95, 100, 58) + ring(515, 110, 78, p.violet) + ring(70, 345, 50, p.violet) + dashes(148, 250, -32, p.violet)
    + figure(`${id}w`, 305, 300, 175, p.lilac, p.yellow)],
  windows: (p, id, tint) => [600, 560, defs(id) + blob(50, 90, 520, 400, tint, 1)
    + leaf(330, 300, 150, -72, p.rust) + blob(215, 40, 46, 80, p.orange, 2) + leaf(92, 150, 90, 78, p.violet)
    + `<rect x="110" y="200" width="220" height="230" fill="#fff" ${STROKE}/><path d="M110 224H330" ${STROKE}/>` + ring(220, 335, 55, '#000', p.lilac)
    + `<rect x="345" y="40" width="210" height="230" fill="#fff" ${STROKE}/><path d="M345 64H555" ${STROKE}/>` + ring(450, 175, 55, '#000', p.yellow)
    + leaf(372, 470, 150, -38, `url(#dots${id})`) + leaf(360, 488, 120, -6, '#231F20') + blob(470, 330, 56, 52, p.rust, 2) + leaf(90, 450, 120, -12, p.rust)],
  bulb: (p, id, tint) => [600, 560, blob(40, 60, 440, 380, tint, 2) + shadow(330, 520, 190, 11, p)
    + specks(200, 170, 8, 9, p.rust) + dashes(110, 150, 18, p.orange)
    + ring(420, 210, 108) + `<path d="M240 180C290 80 420 70 480 130S580 260 596 220" fill="none" stroke="${p.violet}" stroke-width="5" stroke-linecap="round"/>`
    + `<path d="M330 330C270 360 230 410 300 430C370 450 300 500 210 505" fill="none" stroke="#000" stroke-width="7" stroke-linecap="round"/>`],
  room: (p, id) => [740, 600, leaf(70, 70, 110, 120, p.rust) + leaf(60, 160, 120, 60, p.rust) + leaf(80, 250, 120, 125, p.rust) + leaf(55, 340, 130, 55, p.rust) + leaf(80, 430, 110, 130, p.rust)
    + `<rect x="250" y="70" width="130" height="150" fill="none" stroke="${p.violet}" stroke-width="4"/><rect x="264" y="84" width="102" height="122" fill="none" stroke="${p.violet}" stroke-width="2.5"/>`
    + `<rect x="440" y="40" width="230" height="250" fill="none" stroke="${p.orange}" stroke-width="4"/><path d="M455 165H655M555 55V275" stroke="${p.orange}" stroke-width="3"/>`
    + `<ellipse cx="420" cy="530" rx="330" ry="52" fill="none" stroke="${p.rust}" stroke-width="3"/>`
    + figure(`${id}r1`, 300, 400, 125, p.lilac, p.yellow) + figure(`${id}r2`, 540, 395, 125, p.yellow, p.violet)],
  sit: (p, id) => [480, 420, shadow(240, 405, 200, 11, p) + figure(`${id}s`, 240, 220, 180, p.lime, p.violet)],
  duo: (p, id) => [560, 440, blob(0, 20, 470, 270, p.stone, 1) + shadow(290, 420, 250, 12, p)
    + scallops(280, 404, 230, 180, 36, p.orange) + figure(`${id}d1`, 170, 270, 120, p.salmon, p.yellow) + figure(`${id}d2`, 390, 250, 120, p.lilac, p.orange)],
  kneel: (p, id) => [560, 600, shadow(280, 580, 230, 12, p) + figure(`${id}k`, 280, 320, 240, p.lilac, p.yellow) + dashes(470, 80, 30, p.orange)],
  desk: (p) => [600, 330, leaf(130, 260, 120, -100, '#000') + leaf(130, 200, 100, -140, '#000') + leaf(135, 190, 100, -40, '#000') + leaf(125, 130, 80, -120, '#000') + leaf(135, 130, 80, -60, '#000')
    + `<path d="M80 320C60 270 90 250 100 230H170C180 250 210 270 190 320Z" fill="#fff" ${STROKE}/>`
    + `<rect x="270" y="40" width="240" height="190" rx="8" fill="#fff" ${STROKE} transform="rotate(4 390 135)"/>`
    + pill(320, 230, 150, 90) + pill(470, 296, 120, 24) + `<path d="M40 322H590" ${STROKE}/>`],
  row: (p, id) => [1200, 330, [[130, 210, 110, p.salmon, p.yellow], [360, 240, 82, p.lime, p.violet], [600, 190, 130, p.yellow, p.orange], [840, 236, 86, p.purpleBlob, p.yellow], [1070, 205, 115, p.salmon, p.violet]]
    .map(([cx, cy, r, tint, dot], i) => shadow(cx, 322, r * 0.9, 7, p) + figure(`${id}q${i}`, cx, cy, r, tint, dot)).join('')],
  core: (p) => [300, 300, ring(150, 130, 78, '#000', p.lilac) + `<path d="M80 230A70 70 0 0 1 220 230Z" fill="${p.yellow}" ${STROKE}/>` + dashes(214, 50, 30, p.orange)],
}

const scene = (name, p, id, box, tint) => {
  const [w, h, body] = scenes[name](p, id, tint)
  return svg(box, [w, h], body)
}

/** A user picture in a crop shape, or the placeholder scene inside the same box. */
function slot(image, ctx, box, crop, placeholder) {
  const src = image && ctx.image(image)
  if (!src) return placeholder()
  return `<img class="crop ${crop}" src="${ctx.esc(src)}" alt="${ctx.esc(image.alt)}" style="left:${box[0]}px;top:${box[1]}px;width:${box[2]}px;height:${box[3]}px">`
}

const HEX = 'polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%)'
const hexOutline = (box, fill = 'none') => svg(box, [400, 346], `<polygon points="100,2 300,2 398,173 300,344 100,344 2,173" fill="${fill}" stroke="#000" stroke-width="4" vector-effect="non-scaling-stroke"/>`)
const paragraphs = (body, ctx) => body.split(/\n+/).map((t) => `<p>${ctx.esc(t)}</p>`).join('')
const tag = (text, ctx, cls = '') => (text ? `<p class="tag ${cls}">${ctx.esc(text)}</p>` : '')
/** Which occurrence of its kind a slide is, so repeated kinds alternate between source frames. */
const nth = (ctx, kind) => ctx.deck.slides.slice(0, ctx.index - 1).filter((s) => s.kind === kind).length

export function css(system) {
  const p = system.palette
  return `
:root { --lime: ${p.lime}; --salmon: ${p.salmon}; --lilac: ${p.lilac}; --purple: ${p.purple}; --yellow: ${p.yellow};
  --stone: ${p.stone}; --ink: ${p.ink}; --violet: ${p.violet}; --shadow: ${p.shadow}; --m: ${system.geometry.margin}px; }
.slide { background: #fff; color: var(--ink); font-size: 21px; line-height: 32px; font-weight: 300; }
.slide > * { position: absolute; }
.art { overflow: visible; }
.crop { object-fit: cover; }
.crop.circle { border-radius: 50%; }
.crop.blob { border-radius: 58% 42% 46% 54% / 52% 58% 42% 48%; }
.crop.hex { clip-path: ${HEX}; }
h1, h2, h3 { font-weight: 600; letter-spacing: -.005em; }
.t-xl { font-size: 80px; line-height: 1.14; }
.t-l { font-size: 50px; line-height: 1.3; }
.t-m { font-size: 36px; line-height: 1.3; }
.tag { font-size: 18px; line-height: 1.45; }
.copy p + p { margin-top: 32px; }
.col { display: flex; flex-direction: column; justify-content: center; }
.panel { top: 0; bottom: 0; }
.white { color: #fff; }

.cover { background: var(--lime); }
.cover .text { left: 115px; top: 128px; width: 500px; }
.cover h1.long { font-size: 64px; }
.cover h1 { margin-top: 10px; }
.cover .lead { margin-top: 22px; font-size: 24px; line-height: 1.45; }
.cover .foot { left: 120px; bottom: 82px; font-size: 30px; line-height: 1.2; }

.agenda .title { left: 200px; top: 0; bottom: 60px; width: 360px; }
.agenda ol { left: 723px; top: 0; bottom: 30px; right: 60px; list-style: none; counter-reset: a; display: flex; flex-direction: column; justify-content: center; }
.agenda li { counter-increment: a; font-size: 32px; line-height: 60px; }
.agenda li::before { content: counter(a) ". "; }

.section { background: var(--lilac); }
.section .head { left: 80px; right: 80px; top: 78px; text-align: center; }
.section .num { font-size: 20px; font-weight: 600; letter-spacing: .04em; }
.section h2 { font-size: 72px; line-height: 1.15; margin-top: 4px; }
.section .sub { margin-top: 10px; font-size: 22px; }

.phrase .field { inset: 0; background: var(--yellow); clip-path: polygon(63px 0, 100% 0, 100% 100%, 783px 100%); }
.phrase .text { right: 175px; top: 0; bottom: 0; width: 480px; text-align: right; }
.phrase .text p.big { font-size: 46px; line-height: 65px; font-weight: 600; text-wrap: balance; }
.phrase .text p.big.long { font-size: 38px; line-height: 54px; }
.phrase .tag { margin-bottom: 14px; }

.important { background: var(--purple); color: #fff; }
.important .disc { left: 149px; top: 146px; width: 428px; height: 428px; border-radius: 50%; background: #fff; }
.important .text { left: 650px; right: 80px; top: 0; bottom: 0; }
.important p.big { font-size: 80px; line-height: 91px; font-weight: 600; }
.important .tag { margin-top: 18px; }

.text-a .panel { left: 0; width: 615px; background: var(--salmon); }
.text-a .text { left: 765px; width: 400px; top: 0; bottom: 0; }
.text-b .panel { left: 640px; right: 0; background: var(--lime); }
.text-b .text { left: 120px; width: 430px; top: 0; bottom: 0; }
.text-a h2, .text-b h2 { margin: 4px 0 36px; }

.points .band { left: 0; right: 0; top: 360px; bottom: 0; background: var(--lime); }
.points h2 { left: 120px; top: 103px; width: 540px; line-height: 65px; }
.points .cols { left: 105px; right: 105px; top: 452px; display: grid; grid-template-columns: repeat(3, 1fr); grid-template-rows: auto auto; grid-auto-flow: column; column-gap: 60px; row-gap: 14px; }
.points h3 { font-size: 30px; line-height: 1.25; align-self: end; }

.intro .panel { left: 642px; right: 0; background: var(--salmon); }
.intro .text { left: 118px; width: 400px; top: 0; bottom: 0; }
.intro h2 { margin-bottom: 30px; }

.metrics .band { left: 0; right: 0; top: 0; height: 311px; background: var(--lime); }
.metrics h2 { left: 120px; top: 0; height: 311px; width: 640px; display: flex; align-items: center; padding-bottom: 40px; }
.metrics .grid { left: 120px; right: 120px; top: 400px; display: grid; grid-template-columns: repeat(var(--n), 1fr); column-gap: 32px; text-align: center; }
.metrics b { display: block; font-size: 80px; line-height: 1; font-weight: 600; letter-spacing: -.01em; }
.metrics span { display: block; margin: 22px auto 0; max-width: 240px; font-size: 20px; }

.twocol .panel { left: 640px; right: 0; background: var(--salmon); }
.twocol .text { left: 120px; width: 440px; top: 0; bottom: 0; }
.twocol h2 { margin-bottom: 40px; }
.twocol h3 + p { margin-top: 8px; }
.twocol p + h3 { margin-top: 40px; }

.process { background: var(--lilac); }
.process .disc { left: -207px; top: -73px; width: 892px; height: 892px; border-radius: 50%; background: #fff; }
.process h2 { left: 120px; top: 105px; width: 440px; }
.process ol { left: 808px; right: 80px; top: 0; bottom: 0; list-style: none; display: flex; flex-direction: column; justify-content: center; gap: 30px; }
.process.n5 ol { gap: 16px; }
.process .when { display: block; font-size: 44px; line-height: 1.1; font-weight: 600; margin-bottom: 8px; }
.process.n5 .when { font-size: 36px; margin-bottom: 2px; }
.process li b { font-weight: 600; }

.quote { background: var(--lilac); }
.quote .text { left: 125px; width: 540px; top: 0; bottom: 0; }
.quote .tag { margin-bottom: 26px; }
.quote blockquote { font-size: 46px; line-height: 65px; font-weight: 600; }
.quote blockquote.long { font-size: 38px; line-height: 54px; }

.table { background: var(--purple); color: #fff; }
.table h2 { left: 120px; top: 105px; right: 120px; }
.table table { left: 120px; right: 120px; top: 250px; width: 1040px; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.table th { text-align: left; font-size: 24px; font-weight: 600; padding: 0 20px 16px 0; }
.table td { padding: 18px 20px 18px 0; border-top: 1.5px solid rgba(255,255,255,.55); font-size: 21px; }
.table td:first-child { font-weight: 600; }

.percent .disc { left: 548px; top: -305px; width: 904px; height: 904px; border-radius: 50%; background: var(--purple); }
.percent .text { left: 680px; width: 546px; top: 168px; color: #fff; text-align: center; }
.percent b { display: block; font-size: 140px; line-height: 1; font-weight: 600; letter-spacing: -.01em; }
.percent .label { margin-top: 18px; font-family: "Jost", var(--font); font-size: 34px; line-height: 1.3; font-weight: 300; }
.percent .body { margin: 22px auto 0; max-width: 420px; font-size: 20px; line-height: 30px; }

.icons h2 { left: 117px; top: 105px; right: 120px; }
.icons .grid { left: 200px; right: 120px; top: 250px; bottom: 70px; display: grid; grid-template-columns: repeat(var(--c), 1fr); align-content: center; row-gap: 48px; column-gap: 48px; }
.icons .item { display: grid; grid-template-columns: 120px 1fr; column-gap: 34px; align-items: center; }
.icons .item svg { position: static; width: 120px; height: 110px; }
.icons .item p { font-size: 20px; }
.icons.c3 .grid { left: 110px; right: 80px; }
.icons.c3 .item { grid-template-columns: 96px 1fr; column-gap: 24px; }
.icons.c3 .item svg { width: 96px; height: 88px; }

.team h2 { left: 120px; top: 105px; right: 120px; }
.team .people { left: 120px; right: 120px; top: 250px; display: grid; grid-template-columns: repeat(var(--n), minmax(0, 300px)); column-gap: 40px; }
.team .person { position: relative; display: flex; flex-direction: column; align-items: flex-start; }
.team .hex { position: relative; width: 230px; height: 200px; }
.team .hex > * { position: absolute; inset: 0; width: 100%; height: 100%; }
.team .link { width: 160px; height: 16px; margin: 26px 0 10px; }
.team b { font-size: 30px; line-height: 1.25; font-weight: 600; }
.team span { font-size: 19px; line-height: 1.5; }

.mention { background: var(--salmon); }
.mention .text { left: 700px; right: 90px; top: 0; bottom: 0; }
.mention p.big { font-size: 76px; line-height: 92px; font-weight: 600; }
.mention p.big.long { font-size: 50px; line-height: 66px; }

.thanks .panel { left: 628px; right: 0; background: var(--yellow); }
.thanks .text { left: 750px; right: 70px; top: 190px; }
.thanks .lines { margin-top: 125px; font-size: 28px; line-height: 1.45; }
.thanks .lines p + p { margin-top: 18px; }

.framed { background: var(--avn-paper); display: flex; flex-direction: column; padding: 105px var(--m) 70px; }
.framed > * { position: relative; }
.framed .head { flex: none; }
.framed .avn-body { margin-top: 34px; }
.questions { background: var(--lilac); }
.questions .disc { left: 347px; top: 67px; width: 586px; height: 586px; border-radius: 50%; background: #fff; }
.questions .text { left: 387px; width: 506px; top: 67px; height: 586px; text-align: center; align-items: center; }
.questions h2 { font-size: 72px; line-height: 1.15; }
.questions .lines { margin-top: 16px; font-size: 20px; line-height: 1.5; }
`
}

/** Line-art icons for the bullet grid: outline-only geometry, after the source's object drawings. */
const ICONS = [
  `<circle cx="60" cy="48" r="34"/><path d="M20 98H100"/>`,
  `<path d="M60 12L104 96H16Z"/><path d="M42 96L60 60L78 96"/>`,
  `<path d="M28 100V50A32 32 0 0 1 92 50V100Z"/><path d="M44 100V58A16 16 0 0 1 76 58V100"/>`,
  `<rect x="30" y="24" width="60" height="60" transform="rotate(45 60 54)"/><circle cx="60" cy="54" r="12"/>`,
  `<circle cx="46" cy="56" r="30"/><circle cx="76" cy="56" r="30"/>`,
  `<path d="M14 80A46 46 0 0 1 106 80Z"/><path d="M30 98H90"/>`,
]
const icon = (i) => `<svg viewBox="0 0 120 110" aria-hidden="true"><g fill="none" stroke="#000" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round">${ICONS[i % ICONS.length]}</g></svg>`

export const slides = {
  cover: (d, ctx) => {
    const p = ctx.system.palette
    const foot = [ctx.deck.presenter, ctx.deck.date].filter(Boolean).join(' · ')
    return `<section class="slide cover">${scene('walk', p, ctx.index, [610, 92, 660, 536], p.limeBlob)}
    <div class="text">${tag(d.eyebrow, ctx)}<h1 class="t-xl${d.title.length > 20 ? ' long' : ''}">${ctx.esc(d.title)}</h1>${d.subtitle ? `<p class="lead">${ctx.esc(d.subtitle)}</p>` : ''}</div>
    ${foot ? `<p class="foot">${ctx.esc(foot)}</p>` : ''}</section>`
  },

  agenda: (d, ctx) => {
    const p = ctx.system.palette
    const art = svg([0, 0, 1280, 720], [1280, 720], `<path d="M-20 52C130 40 300 90 420 160C530 225 565 330 563 420C561 520 610 610 650 720H-20Z" fill="${p.stone}"/>`
      + blob(68, 190, 72, 100, p.orange, 2) + leaf(395, 600, 230, -62, p.rust) + leaf(500, 550, 110, -48, p.violet) + leaf(540, 430, 120, -78, p.orange)
      + defs(ctx.index) + leaf(0, 430, 250, 32, `url(#dots${ctx.index})`) + leaf(-10, 420, 150, 52, '#231F20')
      + leaf(30, 560, 200, 36, p.rust) + leaf(20, 720, 150, -12, p.rust) + `<circle cx="125" cy="648" r="20" fill="${p.violet}"/>`
      + `<circle cx="573" cy="645" r="14" fill="${p.orange}"/>` + leaf(608, 700, 120, -80, p.violet) + `<circle cx="600" cy="378" r="20" fill="url(#dots${ctx.index})"/>`)
    return `<section class="slide agenda">${art}<div class="title col"><h2 class="t-l">${ctx.esc(d.title)}</h2></div>
    <ol>${d.items.map((item) => `<li>${ctx.esc(item)}</li>`).join('')}</ol></section>`
  },

  section: (d, ctx) => `<section class="slide section">${scene('row', ctx.system.palette, ctx.index, [40, 368, 1200, 330])}
    <div class="head"><p class="num">${ctx.esc(d.number)}</p><h2>${ctx.esc(d.title)}</h2>${d.subtitle ? `<p class="sub">${ctx.esc(d.subtitle)}</p>` : ''}</div></section>`,

  statement: (d, ctx) => {
    const p = ctx.system.palette
    if (d.text.length <= 40) {
      return `<section class="slide important"><div class="disc"></div>${scene('core', p, ctx.index, [213, 210, 300, 300])}
      <div class="text col"><p class="big">${ctx.esc(d.text)}</p>${tag(d.attribution, ctx)}</div></section>`
    }
    const id = ctx.index
    const art = svg([0, 0, 1280, 720], [1280, 720], `${defs(id)}<clipPath id="yc${id}"><polygon points="63,0 1280,0 1280,720 783,720"/></clipPath>`
      + blob(90, 140, 620, 380, p.stone, 1) + `<g clip-path="url(#yc${id})">${blob(90, 140, 620, 380, p.yellowBlob, 1)}</g>`
      + shadow(410, 600, 255, 11, p) + leaf(250, 560, 150, -78, p.rust) + leaf(250, 470, 130, -128, p.rust) + leaf(255, 400, 120, -52, p.rust) + leaf(250, 300, 100, -118, p.rust)
      + figure(`${id}p`, 430, 380, 165, p.salmon, p.violet)
      + ring(632, 232, 36, p.violet) + ring(178, 445, 34, p.violet)
      + [[560, 380], [590, 430], [530, 450], [610, 500], [575, 540]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="9" fill="${p.violet}"/>`).join(''))
    return `<section class="slide phrase"><div class="field"></div>${art}
    <div class="text col">${tag(d.attribution, ctx)}<p class="big${d.text.length > 110 ? ' long' : ''}">${ctx.esc(d.text)}</p></div></section>`
  },

  text: (d, ctx) => {
    const p = ctx.system.palette
    const text = `<div class="text col copy">${tag(d.eyebrow, ctx)}<h2 class="t-l">${ctx.esc(d.title)}</h2>${paragraphs(d.body, ctx)}</div>`
    if (nth(ctx, 'text') % 2 === 0) {
      return `<section class="slide text-a"><div class="panel"></div>${scene('walk', p, ctx.index, [10, 80, 600, 560], p.salmonBlob)}${text}</section>`
    }
    return `<section class="slide text-b"><div class="panel"></div>${scene('windows', p, ctx.index, [660, 100, 600, 560], p.limeBlob)}${text}</section>`
  },

  points: (d, ctx) => `<section class="slide points"><div class="band"></div>${scene('sit', ctx.system.palette, ctx.index, [690, 22, 480, 420])}
    <h2 class="t-l">${ctx.esc(d.title)}</h2>
    <div class="cols">${d.items.map((item) => `<h3>${ctx.esc(item.title)}</h3><p>${ctx.esc(item.body)}</p>`).join('')}</div></section>`,

  'image-text': (d, ctx) => {
    const p = ctx.system.palette
    const box = [690, 110, 545, 500]
    return `<section class="slide intro"><div class="panel"></div>${slot(d.image, ctx, box, 'blob', () => scene('bulb', p, ctx.index, box, p.salmonBlob))}
    <div class="text col copy"><h2 class="t-l">${ctx.esc(d.title)}</h2>${paragraphs(d.body, ctx)}</div></section>`
  },

  metrics: (d, ctx) => `<section class="slide metrics"><div class="band"></div>${scene('bulb', ctx.system.palette, ctx.index, [850, 14, 380, 300], ctx.system.palette.limeBlob)}
    <h2 class="t-l">${ctx.esc(d.title)}</h2>
    <div class="grid" style="--n:${d.items.length}">${d.items.map((m) => `<div><b>${ctx.esc(m.value)}</b><span>${ctx.esc(m.label)}</span></div>`).join('')}</div></section>`,

  'two-column': (d, ctx) => `<section class="slide twocol"><div class="panel"></div>${scene('room', ctx.system.palette, ctx.index, [548, 100, 720, 584])}
    <div class="text col"><h2 class="t-l">${ctx.esc(d.title)}</h2>${d.columns.map((c) => `<h3 class="t-m">${ctx.esc(c.title)}</h3><p>${ctx.esc(c.body)}</p>`).join('')}</div></section>`,

  timeline: (d, ctx) => `<section class="slide process${d.steps.length > 4 ? ' n5' : ''}"><div class="disc"></div>${scene('duo', ctx.system.palette, ctx.index, [50, 215, 560, 440])}
    <h2 class="t-l">${ctx.esc(d.title)}</h2>
    <ol>${d.steps.map((s) => `<li><span class="when">${ctx.esc(s.when)}</span><b>${ctx.esc(s.title)}</b>${s.body ? `<br>${ctx.esc(s.body)}` : ''}</li>`).join('')}</ol></section>`,

  quote: (d, ctx) => `<section class="slide quote">${scene('desk', ctx.system.palette, ctx.index, [665, 258, 590, 320])}
    <div class="text col">${tag([d.name, d.role].filter(Boolean).join(', '), ctx)}<blockquote${d.text.length > 100 ? ' class="long"' : ''}>“${ctx.esc(d.text)}”</blockquote></div></section>`,

  table: (d, ctx) => `<section class="slide table"><h2 class="t-l">${ctx.esc(d.title)}</h2>
    <table><thead><tr>${d.columns.map((c) => `<th>${ctx.esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${d.rows.map((r) => `<tr>${r.map((c) => `<td>${ctx.esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></section>`,

  'big-number': (d, ctx) => `<section class="slide percent"><div class="disc"></div>${scene('kneel', ctx.system.palette, ctx.index, [40, 90, 540, 590])}
    <div class="text"><b>${ctx.esc(d.value)}</b><p class="label">${ctx.esc(d.label)}</p>${d.body ? `<p class="body">${ctx.esc(d.body)}</p>` : ''}</div></section>`,

  bullets: (d, ctx) => {
    const c = d.items.length > 4 ? 3 : 2
    return `<section class="slide icons c${c}"><h2 class="t-l">${ctx.esc(d.title)}</h2>
    <div class="grid" style="--c:${c}">${d.items.map((item, i) => `<div class="item">${icon(i)}<p>${ctx.esc(item)}</p></div>`).join('')}</div></section>`
  },

  team: (d, ctx) => {
    const p = ctx.system.palette
    const tints = [p.lilac, p.salmon, p.lime, p.yellow]
    const link = `<svg class="link" viewBox="0 0 160 16" aria-hidden="true"><path d="M0 2H140L156 15" fill="none" stroke="${p.purple}" stroke-width="2.5"/></svg>`
    return `<section class="slide team"><h2 class="t-l">${ctx.esc(d.title)}</h2>
    <div class="people" style="--n:${d.people.length}">${d.people.map((person, i) => {
      const src = person.image && ctx.image(person.image)
      const inner = src
        ? `<img class="crop hex" src="${ctx.esc(src)}" alt="${ctx.esc(person.name)}">`
        : `<svg viewBox="0 0 400 346" aria-hidden="true"><clipPath id="hx${ctx.index}-${i}"><polygon points="100,2 300,2 398,173 300,344 100,344 2,173"/></clipPath><g clip-path="url(#hx${ctx.index}-${i})"><rect width="400" height="346" fill="#fff"/>${blob(30, 120, 340, 260, tints[i % tints.length], i % 3)}<circle cx="250" cy="110" r="46" fill="${p.yellow}"/></g></svg>`
      return `<div class="person"><div class="hex">${inner}${hexOutline([0, 0, 230, 200])}</div>${link}<b>${ctx.esc(person.name)}</b><span>${ctx.esc(person.role)}</span></div>`
    }).join('')}</div></section>`
  },

  image: (d, ctx) => {
    const p = ctx.system.palette
    const box = [90, 70, 560, 520]
    const caption = d.caption ?? ''
    return `<section class="slide mention">${svg([0, 0, 1280, 720], [1280, 720], shadow(389, 613, 308, 27, { shadow: 'rgba(120,80,80,.28)' }))}
    ${slot(d.image, ctx, box, 'blob', () => scene('kneel', p, ctx.index, box))}
    <div class="text col"><p class="big${caption.length > 30 ? ' long' : ''}">${ctx.esc(caption)}</p></div></section>`
  },

  frame: ({ title, eyebrow }, ctx, body) => `<section class="slide framed"><div class="head">${tag(eyebrow, ctx)}${title ? `<h2 class="t-l">${ctx.esc(title)}</h2>` : ''}</div>${body}</section>`,

  closing: (d, ctx) => {
    const p = ctx.system.palette
    const lines = [d.subtitle, d.contact].filter(Boolean).map((t) => `<p>${ctx.esc(t)}</p>`).join('')
    if (d.title.trim().endsWith('?')) {
      const art = svg([0, 0, 1280, 720], [1280, 720], defs(ctx.index) + blob(-80, 180, 760, 420, p.lilacBlob, 1) + blob(720, -60, 640, 200, p.lilacBlob, 2) + blob(460, 520, 900, 300, p.lilacBlob, 0)
        + leaf(270, 500, 330, -76, p.rust) + leaf(150, 280, 170, -72, p.orange) + leaf(90, 250, 170, 62, p.violet) + blob(930, -10, 100, 130, p.orange, 2)
        + leaf(880, 540, 260, -32, '#231F20') + leaf(860, 520, 200, -50, `url(#dots${ctx.index})`) + leaf(780, 740, 250, -62, p.rust) + leaf(950, 720, 300, -22, p.rust)
        + `<circle cx="40" cy="520" r="24" fill="${p.orange}"/><circle cx="775" cy="690" r="34" fill="${p.violet}"/>` + leaf(1180, 400, 170, 100, p.violet) + leaf(200, 560, 160, 35, `url(#dots${ctx.index})`))
      return `<section class="slide questions">${art}<div class="disc"></div>
      <div class="text col"><h2>${ctx.esc(d.title)}</h2>${lines ? `<div class="lines">${lines}</div>` : ''}</div></section>`
    }
    const art = svg([0, 0, 1280, 720], [1280, 720], `<polygon points="192,140 440,140 565,355 440,570 192,570 69,355" fill="#fff" stroke="#000" stroke-width="3"/>`
      + `<clipPath id="tc${ctx.index}"><polygon points="192,140 440,140 565,355 440,570 192,570 69,355"/></clipPath><g clip-path="url(#tc${ctx.index})">${blob(60, 330, 520, 300, p.lilac, 1)}<circle cx="390" cy="250" r="62" fill="${p.yellow}"/></g>`)
    return `<section class="slide thanks"><div class="panel"></div>${art}
    <div class="text"><h2 class="t-xl">${ctx.esc(d.title)}</h2>${lines ? `<div class="lines">${lines}</div>` : ''}</div></section>`
  },
}
