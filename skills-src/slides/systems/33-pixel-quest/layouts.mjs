/**
 * Pixel Quest: warm amber stages, white and near-black slides with a pixel-caps tab bar along the
 * top, dark brown game-UI panels with amber stepped borders, amber number tiles, navy-bordered
 * cards, and pixel-block scenes (an autumn clearing, pine groves, a cactus pot, coin blocks)
 * drawn here from rects. Recreated from "Presentation Template Kit – Pixel Art Theme" (Figma
 * Community), whose one collage shows its light, dark and scenic slides.
 */

/** A small seeded PRNG so every scene draws the same on every render. */
function random(seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A grid of pixel cells that paints into an SVG of merged horizontal runs. */
class Grid {
  constructor(w, h, fill) { this.w = w; this.h = h; this.cells = new Array(w * h).fill(fill ?? null) }
  set(x, y, c) { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.cells[y * this.w + x] = c }
  rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c) }
  svg(cls, align = 'xMidYMid slice') {
    const out = []
    for (let y = 0; y < this.h; y++) {
      let x = 0
      while (x < this.w) {
        const c = this.cells[y * this.w + x]
        let e = x + 1
        while (e < this.w && this.cells[y * this.w + e] === c) e++
        if (c) out.push(`<rect x="${x}" y="${y}" width="${e - x}" height="1" fill="${c}"/>`)
        x = e
      }
    }
    return `<svg class="${cls}" viewBox="0 0 ${this.w} ${this.h}" preserveAspectRatio="${align}" shape-rendering="crispEdges" aria-hidden="true">${out.join('')}</svg>`
  }
}

/** A leafy canopy: a noisy ellipse of mixed tones, darker toward its lower edge. */
function canopy(g, rnd, cx, cy, rx, ry, tones) {
  for (let y = Math.floor(cy - ry - 1); y <= cy + ry + 1; y++) {
    for (let x = Math.floor(cx - rx - 1); x <= cx + rx + 1; x++) {
      const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
      if (d > 0.85 + rnd() * 0.4) continue
      const low = (y - cy) / ry > 0.35 ? 2 : 0
      g.set(x, y, tones[Math.min(tones.length - 1, Math.floor(rnd() * 3) + low)])
    }
  }
}

/** A trunk with a lit left column and a shaded right column, flaring at its foot. */
function trunk(g, x, top, bottom, [lit, mid, dark]) {
  for (let y = top; y <= bottom; y++) {
    const flare = y > bottom - 4 ? 2 : 0
    g.rect(x - flare, y, 2, 1, lit); g.rect(x + 2 - flare, y, 4 + flare, 1, mid); g.rect(x + 6, y, 2 + flare, 1, dark)
  }
}

/** The autumn clearing: cream sky, peach streaks, mint hills, pink-leaved trees, a pale stream. */
function autumn(seed = 1) {
  const W = 160, H = 90, rnd = random(seed)
  const g = new Grid(W, H, '#FBF6DD')
  g.rect(0, 0, W, 10, '#FDFAEB')
  for (let i = 0; i < 26; i++) g.rect(Math.floor(rnd() * W) - 8, 10 + Math.floor(rnd() * 34), 10 + Math.floor(rnd() * 32), 1 + (rnd() > 0.6 ? 1 : 0), rnd() > 0.5 ? '#F5DDBA' : '#F7E6C8')
  for (let x = 0; x < W; x++) {
    const top = 42 + Math.round(5 * Math.sin(x / 14 + seed) + 3 * Math.sin(x / 6.2))
    g.rect(x, top, 1, 60 - top, '#C3DEC0'); g.rect(x, top + 6, 1, 54 - top, '#AECFB0')
    const bush = 52 + Math.round(2.4 * Math.sin(x / 4.6 + seed) + 2 * rnd())
    g.rect(x, bush, 1, 60 - bush, rnd() > 0.3 ? '#AAB39D' : '#9BA88F')
  }
  g.rect(0, 60, W, H - 60, '#EFCDA5')
  for (let i = 0; i < 46; i++) g.rect(Math.floor(rnd() * W) - 6, 60 + Math.floor(rnd() * 18), 8 + Math.floor(rnd() * 24), 1 + (rnd() > 0.5 ? 1 : 0), ['#F4D9B6', '#E8BD91', '#F2D2AA'][i % 3])
  g.rect(0, 78, W, H - 78, '#EAF0E2')
  for (let i = 0; i < 22; i++) g.rect(Math.floor(rnd() * W) - 6, 78 + Math.floor(rnd() * 12), 10 + Math.floor(rnd() * 20), 1, '#D5E3D6')
  for (let i = 0; i < 70; i++) {
    const x = Math.floor(rnd() * W), h = 2 + Math.floor(rnd() * 7), base = 80 + Math.floor(rnd() * 10)
    g.rect(x, base - h, 1, h, rnd() > 0.5 ? '#A3B39C' : '#8E9F8A')
    if (rnd() > 0.6) g.set(x + 1, base - h + 1, '#A3B39C')
  }
  const leaves = ['#F0C49A', '#E9B7A2', '#DDA196', '#D48C83', '#C97B76']
  const bark = ['#D8B5A6', '#C9A193', '#B38778']
  trunk(g, 15, 16, 75, bark); trunk(g, 129, 12, 67, bark)
  g.rect(23, 36, 6, 2, bark[1]); g.rect(27, 33, 4, 3, bark[1]); g.rect(123, 31, 6, 2, bark[1]); g.rect(119, 28, 4, 3, bark[1])
  canopy(g, rnd, 18, 10, 26, 16, leaves); canopy(g, rnd, 44, 16, 12, 8, leaves)
  canopy(g, rnd, 136, 8, 24, 14, leaves); canopy(g, rnd, 116, 26, 8, 6, leaves); canopy(g, rnd, 156, 24, 10, 8, leaves)
  canopy(g, rnd, 8, 56, 6, 4, ['#E9B7A2', '#DDA196', '#D48C83', '#D48C83', '#C97B76'])
  canopy(g, rnd, 112, 56, 6, 4, ['#F0C49A', '#E9B7A2', '#DDA196', '#DDA196', '#D48C83'])
  for (let i = 0; i < 22; i++) g.set(Math.floor(rnd() * W), 28 + Math.floor(rnd() * 44), leaves[3])
  return g
}

/** A stepped pine: four tiers, lit on the left and shaded on the right, trunk showing through. */
function pine(g, cx, top, bottom, [lit, mid, dark], wood) {
  const tiers = 4, th = (bottom - top) / tiers
  for (let t = 0; t < tiers; t++) {
    const y0 = Math.round(top + t * th * 0.9), rows = Math.round(th * 1.25), base = 2 + t * 1.6 + th * 0.35
    for (let r = 0; r < rows; r++) {
      const half = Math.round(((r + 1) / rows) * base)
      for (let x = cx - half; x <= cx + half; x++) g.set(x, y0 + r, x < cx - half / 3 ? lit : x <= cx + half / 3 ? mid : dark)
      if (r === rows - 1) { g.set(cx - half - 1, y0 + r, lit); g.set(cx + half + 1, y0 + r, dark) }
    }
  }
  for (let y = top + 2; y < bottom + 4; y += 1) if (y % 5 !== 0 || y > bottom) g.set(cx, y, wood)
  g.rect(cx, bottom, 1, 4, wood)
}

/** A grove of pines on a mossy mound, for the dark slides (anchored bottom right). */
function grove(seed = 3) {
  const W = 80, H = 90, rnd = random(seed)
  const g = new Grid(W, H)
  pine(g, 28, 20, 68, ['#33502D', '#2C4627', '#253B21'], '#3A2C1C')
  pine(g, 66, 26, 72, ['#33502D', '#2C4627', '#253B21'], '#3A2C1C')
  pine(g, 16, 40, 76, ['#4B7A3A', '#3E6A33', '#33592C'], '#4A2E1C')
  pine(g, 48, 10, 72, ['#90C548', '#6CB043', '#4E9440'], '#6B3A22')
  for (let y = 76; y < H; y++) {
    const half = Math.round(18 + (y - 76) * 3.2)
    for (let x = 48 - half; x <= 48 + half; x++) g.set(x, y, rnd() > 0.8 ? '#90C548' : y < 79 ? '#6CB043' : '#5BA649')
  }
  return g
}

/** Pastel pine and cactus pot that sit faintly in the corners of the white slides. */
function pastelPine() {
  const g = new Grid(44, 68)
  pine(g, 22, 2, 56, ['#E6F0D6', '#D6E7C1', '#C6DCAE'], '#DCCBBE')
  return g
}

function cactus() {
  const g = new Grid(18, 28)
  g.rect(6, 3, 5, 15, '#AFD9BA'); g.rect(9, 3, 2, 15, '#98CBA6'); g.rect(7, 2, 3, 1, '#AFD9BA')
  g.rect(2, 7, 2, 7, '#AFD9BA'); g.rect(2, 13, 4, 2, '#AFD9BA'); g.rect(13, 5, 2, 6, '#98CBA6'); g.rect(11, 10, 4, 2, '#98CBA6')
  for (const [x, y] of [[7, 5], [9, 9], [7, 13], [2, 9], [14, 7], [8, 16]]) g.set(x, y, '#EBB9C6')
  g.rect(3, 18, 12, 3, '#EFD3A1'); g.rect(4, 21, 10, 7, '#E6C38C'); g.rect(11, 21, 3, 7, '#D9B37A'); g.rect(3, 18, 12, 1, '#F4DEB5')
  return g
}

/** A coin block: a pale amber square with a slot, scattered faintly on the card slides. */
function coin() {
  const g = new Grid(8, 8)
  g.rect(1, 0, 6, 8, '#F7DDB0'); g.rect(0, 1, 8, 6, '#F7DDB0'); g.rect(3, 2, 2, 4, '#FCF0D8')
  return g
}

/** A pixel cross, the faint corner mark of the framed-panel slides. */
function cross() {
  const g = new Grid(9, 9)
  g.rect(3, 0, 3, 9, '#F7EBD3'); g.rect(0, 3, 9, 3, '#F7EBD3'); g.rect(4, 1, 1, 7, '#F3E1C0')
  return g
}

/** A pixel quote mark (two blocks with tails). */
function quoteMark() {
  const g = new Grid(13, 7)
  for (const x of [0, 7]) { g.rect(x, 0, 6, 4, '#E39B2F'); g.rect(x + 3, 4, 3, 2, '#E39B2F'); g.rect(x + 2, 6, 2, 1, '#E39B2F') }
  return g
}

/** The grass-and-earth strip along the foot of the amber slides, with two small pines. */
function ground(seed = 5) {
  const W = 80, H = 12, rnd = random(seed)
  const g = new Grid(W, H)
  for (let x = 0; x < W; x++) {
    const tuft = rnd() > 0.7 ? 1 : 0
    g.rect(x, 5 - tuft, 1, 1 + tuft, '#90C548'); g.rect(x, 6, 1, 1, '#5BA649')
    for (let y = 7; y < H; y++) g.set(x, y, (Math.floor(x / 4) + Math.floor((y - 7) / 2)) % 2 ? '#9B6E2D' : '#87602A')
  }
  for (let i = 0; i < 18; i++) g.set(Math.floor(rnd() * W), 8 + Math.floor(rnd() * 4), '#B3843E')
  return g
}

function groundPines() {
  const g = new Grid(60, 52)
  pine(g, 18, 4, 42, ['#90C548', '#6CB043', '#4E9440'], '#6B3A22')
  pine(g, 44, 16, 44, ['#6CB043', '#5BA649', '#3F7D3A'], '#6B3A22')
  return g
}

/** A pixel bust for team placeholders; hair and shirt vary by position. */
function bust(i) {
  const hair = ['#213257', '#6B3A22', '#2A2216', '#C9705F'][i % 4]
  const shirt = ['#E39B2F', '#5BA649', '#C9705F', '#5F6E8C'][i % 4]
  const g = new Grid(16, 16, '#F6E6C8')
  g.rect(0, 12, 16, 4, '#EFD8B0')
  g.rect(5, 3, 6, 6, '#F0C49A'); g.rect(4, 4, 1, 4, '#F0C49A'); g.rect(11, 4, 1, 4, '#F0C49A')
  g.rect(4, 2, 8, 2, hair); g.rect(4, 4, 1, 2, hair); g.rect(11, 4, 1, 2, hair); g.rect(5, 1, 6, 1, hair)
  g.set(6, 6, '#2A2216'); g.set(9, 6, '#2A2216'); g.rect(7, 8, 2, 1, '#D48C83')
  g.rect(7, 9, 2, 1, '#E3B184')
  g.rect(3, 10, 10, 6, shirt); g.rect(2, 11, 1, 5, shirt); g.rect(13, 11, 1, 5, shirt); g.rect(7, 10, 2, 2, '#FFFEFB')
  return g
}

const scene = (seed, cls = 'scene', align) => autumn(seed).svg(cls, align)
const PINE = pastelPine().svg('deco deco-pine', 'xMinYMax meet')
const CACTUS = cactus().svg('deco deco-cactus', 'xMaxYMax meet')
const COIN = coin().svg('coin', 'xMidYMid meet')
const CROSS = cross().svg('deco deco-cross', 'xMidYMid meet')
const QUOTE = quoteMark().svg('qmark', 'xMinYMin meet')
const GROVE = grove().svg('grove', 'xMaxYMax meet')
const GROVE_L = grove(9).svg('grove grove-l', 'xMaxYMax meet')
const GROUND = `<div class="ground">${groundPines().svg('ground-pines', 'xMidYMax meet')}${ground().svg('ground-strip', 'none')}</div>`

/** A user picture, or the autumn clearing as its placeholder. */
function picture(image, ctx, cls, seed = 1, align) {
  const src = ctx.image(image)
  return src
    ? `<img class="${cls}" src="${ctx.esc(src)}" alt="${ctx.esc(image.alt)}">`
    : `<div class="${cls} placeholder" role="img" aria-label="${ctx.esc(image?.alt ?? '')}">${scene(seed, 'scene', align)}</div>`
}

const clip = (text, n = 22) => (text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text)

/** The pixel tab bar: the deck title, then its section titles; the current section is lit. */
function nav(ctx, cls = '') {
  const sections = ctx.deck.slides.map((s, i) => ({ s, i })).filter(({ s }) => s.kind === 'section').slice(0, 5)
  let active = 0
  sections.forEach(({ i }, k) => { if (i < ctx.index) active = k + 1 })
  const items = [ctx.deck.title, ...sections.map(({ s }) => s.title)]
  return `<nav class="nav ${cls}">${items.map((t, k) => `<span${k === active ? ' class="on"' : ''}>${ctx.esc(clip(t))}</span>`).join('')}</nav>`
}

const two = (i) => String(i + 1).padStart(2, '0')
const tile = (text, ctx, cls = '') => `<span class="tile ${cls}">${ctx.esc(text)}</span>`

export function css(system) {
  const { surface: s, ink, accent: a } = system
  return `
:root { --amber: ${s.amber}; --light: ${s.light}; --cream: ${s.cream}; --dark: ${s.dark}; --panel: ${s.panel};
  --navy: ${ink.navy}; --body: ${ink.body}; --muted: ${ink.muted}; --cream-ink: ${ink.cream}; --on-dark: ${ink.onDark};
  --muted-dark: ${ink.mutedDark}; --on-amber: ${ink.onAmber}; --body-amber: ${ink.bodyAmber};
  --border: ${a.border}; --tile: ${a.tile}; --line: ${a.line}; --m: 64px; --pixel: "Pixelify Sans", var(--display-font); }
.slide { font-size: 20px; line-height: 1.45; color: var(--body); background: var(--light); }
.slide.dark { background: var(--dark); color: var(--on-dark); }
.slide.amber { background: var(--amber); color: var(--body-amber); }
svg { display: block; }
.px { clip-path: polygon(0 var(--n,4px), var(--n,4px) var(--n,4px), var(--n,4px) 0, calc(100% - var(--n,4px)) 0, calc(100% - var(--n,4px)) var(--n,4px), 100% var(--n,4px), 100% calc(100% - var(--n,4px)), calc(100% - var(--n,4px)) calc(100% - var(--n,4px)), calc(100% - var(--n,4px)) 100%, var(--n,4px) 100%, var(--n,4px) calc(100% - var(--n,4px)), 0 calc(100% - var(--n,4px))); }

.nav { position: absolute; top: 34px; left: var(--m); right: var(--m); display: flex; gap: 30px; font-family: var(--display-font); font-size: 11px; line-height: 1.4; letter-spacing: .04em; text-transform: uppercase; white-space: nowrap; color: #A5A8B3; z-index: 2; }
.nav .on { color: var(--navy); font-weight: 700; }
.dark .nav { color: #6E6A61; } .dark .nav .on { color: var(--cream-ink); }
.nav.center { justify-content: center; }
.wrap { position: absolute; inset: 104px var(--m) 60px; display: flex; flex-direction: column; z-index: 1; }

.t { font-family: var(--display-font); font-weight: 700; text-transform: uppercase; font-size: 44px; line-height: 1.12; letter-spacing: -.03em; color: var(--navy); }
.dark .t { color: var(--cream-ink); }
.amber .t { color: var(--on-amber); }
.t.c { text-align: center; }
.eyebrow { font-family: var(--display-font); font-size: 13px; letter-spacing: .06em; text-transform: uppercase; color: var(--border); margin-bottom: 14px; }
.lead { font-size: 21px; line-height: 1.55; color: var(--body); }
.dark .lead { color: var(--on-dark); }
.tile { flex: none; display: inline-grid; place-items: center; min-width: 40px; height: 40px; padding: 0 8px; background: var(--tile); color: var(--on-amber); font-family: var(--display-font); font-weight: 700; font-size: 14px; line-height: 1; }
.dash { background: repeating-linear-gradient(90deg, var(--line) 0 8px, transparent 8px 16px) left bottom / 100% 4px no-repeat; }

.deco { position: absolute; z-index: 0; }
.deco-pine { left: -10px; bottom: 0; height: 300px; width: 200px; }
.deco-cactus { right: 34px; bottom: 26px; height: 190px; width: 124px; }
.deco-cross { right: -40px; top: -40px; width: 170px; height: 170px; }
.spot { position: absolute; z-index: 0; } .coin { width: 56px; height: 56px; }
.scene { position: absolute; inset: 0; width: 100%; height: 100%; }
.grove { position: absolute; right: 0; bottom: 0; height: 100%; width: 640px; z-index: 0; }
.grove-l { right: auto; left: 0; transform: scaleX(-1); }

.box { position: relative; background: var(--light); border: 4px solid var(--navy); box-shadow: inset -6px -6px 0 #EDE6D2; }
.panel { position: relative; background: var(--panel); border: 4px solid var(--border); }

/* cover and scenic slides */
.cover, .full { display: grid; place-items: center; }
.cover .box { z-index: 1; max-width: 840px; padding: 30px 56px 34px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 12px; }
.cover .eyebrow { margin: 0; color: #5F6E8C; }
.cover h1 { font-family: var(--display-font); font-weight: 700; text-transform: uppercase; font-size: 50px; line-height: 1.15; color: var(--navy); }
.cover .sub { max-width: 600px; font-size: 18px; line-height: 1.5; color: var(--body); }
.full { place-items: end start; }
.full .media { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.full .box { margin: 0 0 48px 56px; max-width: 640px; padding: 16px 26px 18px; font-size: 18px; line-height: 1.45; color: var(--navy); font-weight: 500; }

/* agenda */
.agenda .wrap { display: grid; grid-template-columns: 1fr 1.25fr; gap: 64px; }
.agenda .t { padding-top: 40px; }
.agenda ol { list-style: none; display: flex; flex-direction: column; justify-content: center; }
.agenda li { display: flex; align-items: center; gap: 22px; padding: 16px 0 20px; font-size: 24px; font-weight: 500; color: var(--navy); }
.agenda li:last-child { background: none; }

/* amber stage: section and big number */
.amber .ground { position: absolute; left: 0; right: 0; bottom: 0; height: 200px; }
.ground-strip { position: absolute; left: 0; right: 0; bottom: 0; width: 100%; height: 96px; }
.ground-pines { position: absolute; right: 90px; bottom: 76px; width: 150px; height: 130px; }
.section .wrap { justify-content: center; bottom: 180px; gap: 26px; }
.section .panel { align-self: flex-start; --n: 4px; padding: 14px 30px 12px; font-family: var(--pixel); font-weight: 700; font-size: 64px; line-height: 1.1; color: var(--cream-ink); }
.section .t { font-size: 76px; line-height: 1.08; max-width: 1000px; }
.section .sub { font-size: 24px; color: var(--body-amber); max-width: 760px; }
.big .wrap { flex-direction: row; align-items: center; gap: 64px; bottom: 170px; }
.big b { flex: none; font-family: var(--pixel); font-weight: 700; font-size: 250px; line-height: 1; color: var(--on-amber); }
.big .what { display: flex; flex-direction: column; gap: 18px; max-width: 520px; }
.big .t { font-size: 40px; }
.big p { font-size: 22px; line-height: 1.5; color: var(--body-amber); }

/* dark statement, quote, closing */
.statement .wrap, .closing .wrap { align-items: center; justify-content: center; text-align: center; gap: 28px; }
.statement .grove { width: 300px; height: 340px; }
.statement .grove-l { width: 300px; height: 340px; }
.statement p { font-family: var(--pixel); font-weight: 500; font-size: 48px; line-height: 1.25; color: var(--cream-ink); max-width: 940px; text-wrap: balance; }
.quote .wrap { right: 640px; justify-content: center; gap: 26px; }
.qmark { width: 104px; height: 56px; }
.quote blockquote { font-family: var(--pixel); font-size: 34px; line-height: 1.35; color: var(--cream-ink); }
.quote .by { display: flex; flex-direction: column; gap: 6px; }
.quote .by b { font-family: var(--display-font); font-weight: 700; font-size: 16px; letter-spacing: .04em; text-transform: uppercase; color: var(--border); }
.quote .by span { font-size: 16px; color: var(--muted-dark); }
.closing .grove { width: 420px; } .closing .grove-l { width: 420px; }
.closing .panel { z-index: 1; --n: 4px; max-width: 700px; padding: 40px 64px 44px; display: flex; flex-direction: column; align-items: center; gap: 16px; }
.closing .t { font-size: 60px; }
.closing .sub { font-size: 22px; color: var(--on-dark); }
.closing .contact { font-family: var(--display-font); font-size: 15px; letter-spacing: .04em; color: var(--border); }

/* white text slides */
.text .wrap { justify-content: center; right: 520px; }
.text .t { margin-bottom: 26px; }
.text .deco-pine { left: auto; right: 220px; height: 420px; width: 280px; }
.points .wrap { align-items: center; padding: 38px 0 120px; }
.points .cols { margin: auto 0; display: grid; grid-template-columns: repeat(3, 300px); gap: 72px; }
.points .tile, .cols2 .tile { min-width: 52px; height: 52px; font-size: 18px; }
.points .col { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 16px; }
.points h3, .cols2 h3 { font-weight: 700; font-size: 24px; line-height: 1.3; text-transform: uppercase; color: var(--navy); }
.points p { font-size: 20px; line-height: 1.5; }
.it .wrap { left: 664px; justify-content: center; }
.it .nav { left: 664px; }
.it .media { position: absolute; left: 0; top: 0; bottom: 0; width: 600px; object-fit: cover; overflow: hidden; }
.it .t { margin-bottom: 26px; }

/* framed panel: two columns */
.tc .frame { position: absolute; inset: 92px 48px 48px; background: var(--cream); border: 4px solid var(--border); }
.tc .wrap { inset: 132px 104px 92px; }
.cols2 { margin-top: auto; margin-bottom: auto; display: grid; grid-template-columns: 1fr 1fr; gap: 0; }
.cols2 .col { display: flex; flex-direction: column; align-items: flex-start; gap: 16px; padding-right: 56px; }
.cols2 .col + .col { padding: 0 0 0 56px; background: repeating-linear-gradient(180deg, var(--line) 0 8px, transparent 8px 16px) left top / 4px 100% no-repeat; }
.cols2 p { font-size: 22px; line-height: 1.55; }
.cols2 h3 { font-size: 26px; }

/* timeline as climbing platforms */
.timeline { flex: 1; margin-top: 18px; display: grid; grid-template-columns: repeat(var(--n), 1fr); gap: 28px; align-items: end; }
.step { display: flex; flex-direction: column; gap: 10px; }
.step h3 { font-weight: 700; font-size: 20px; line-height: 1.3; text-transform: uppercase; color: var(--navy); }
.step p { font-size: 17px; line-height: 1.45; color: var(--body); min-height: 23px; }
.step .tile { align-self: flex-start; font-size: 16px; height: 44px; padding: 0 12px; }
.pillar { margin-top: 8px; height: calc(72px + var(--i) * 62px); background-color: var(--tile);
  background-image: linear-gradient(#90C548 0 6px, #5BA649 6px 12px, transparent 12px), repeating-linear-gradient(180deg, transparent 0 20px, #C57F25 20px 24px), repeating-linear-gradient(90deg, transparent 0 44px, #C57F25 44px 48px); }

/* dark metrics, table, bullets */
.metrics .wrap { align-items: center; }
.metrics .grid { flex: 1; width: 100%; margin-top: 30px; display: grid; grid-template-columns: repeat(var(--c), 1fr); gap: 22px 28px; align-content: center; }
.metric { display: flex; flex-direction: column; }
.metric b { display: block; padding: 18px 20px 12px; text-align: center; font-family: var(--pixel); font-weight: 700; font-size: 60px; line-height: 1.1; color: var(--cream-ink); }
.metric span { display: block; padding: 12px 20px 14px; border-top: 4px solid var(--border); text-align: center; font-size: 18px; color: var(--on-dark); }
.tbl { margin-top: 34px; padding: 6px 32px 10px; }
table { width: 100%; border-collapse: collapse; font-size: 19px; }
th { text-align: left; padding: 16px 16px 14px 0; font-family: var(--display-font); font-weight: 700; font-size: 13px; letter-spacing: .06em; text-transform: uppercase; color: var(--border); }
td { padding: 16px 16px 16px 0; color: var(--on-dark); background: repeating-linear-gradient(90deg, #5A4A2E 0 8px, transparent 8px 16px) left top / 100% 3px no-repeat; }
td:first-child { color: var(--cream-ink); font-weight: 700; }
.bullets .wrap { right: 340px; }
.bullets .grove { width: 420px; }
.bullets ol { list-style: none; margin: auto 0; display: grid; grid-template-columns: 1fr 1fr; gap: 48px 56px; align-content: center; }
.bullets li { display: flex; align-items: flex-start; gap: 18px; font-family: var(--display-font); font-size: 19px; line-height: 1.55; text-transform: uppercase; color: var(--cream-ink); }
.bullets li .tile { margin-top: -6px; }

/* team cards */
.team .wrap { align-items: center; padding-top: 30px; }
.people { margin-top: auto; margin-bottom: auto; width: 100%; display: grid; grid-template-columns: repeat(var(--n), minmax(0, 260px)); justify-content: center; gap: 32px; }
.card { --n: 4px; background: var(--light); border: 4px solid var(--navy); padding: 14px 14px 18px; display: flex; flex-direction: column; gap: 6px; }
.avatar { position: relative; width: 100%; aspect-ratio: 1; object-fit: cover; overflow: hidden; margin-bottom: 10px; }
.avatar svg { width: 100%; height: 100%; }
.card b { font-family: var(--display-font); font-weight: 700; font-size: 16px; line-height: 1.3; text-transform: uppercase; color: var(--navy); }
.card span { font-family: var(--display-font); font-size: 11px; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); }

/* frame (chart, custom) */
.framed .wrap { bottom: 52px; }
.framed .t { margin-bottom: 26px; }
`
}

export const slides = {
  cover: (d, ctx) => `<section class="slide cover">${scene(2)}<div class="box px">
    ${d.eyebrow ? `<p class="eyebrow">${ctx.esc(d.eyebrow)}</p>` : ''}<h1>${ctx.esc(d.title)}</h1>
    ${d.subtitle ? `<p class="sub">${ctx.esc(d.subtitle)}</p>` : ''}</div></section>`,

  agenda: (d, ctx) => `<section class="slide agenda">${nav(ctx)}${PINE}<div class="wrap"><h2 class="t">${ctx.esc(d.title)}</h2>
    <ol>${d.items.map((item, i) => `<li class="dash">${tile(two(i), ctx)}<span>${ctx.esc(item)}</span></li>`).join('')}</ol></div></section>`,

  section: (d, ctx) => `<section class="slide amber section">${GROUND}<div class="wrap"><span class="panel px">${ctx.esc(d.number)}</span>
    <h2 class="t">${ctx.esc(d.title)}</h2>${d.subtitle ? `<p class="sub">${ctx.esc(d.subtitle)}</p>` : ''}</div></section>`,

  statement: (d, ctx) => `<section class="slide dark statement">${nav(ctx)}${GROVE_L}${GROVE}<div class="wrap">
    ${d.attribution ? tile(d.attribution, ctx) : ''}<p>${ctx.esc(d.text)}</p></div></section>`,

  text: (d, ctx) => `<section class="slide text">${nav(ctx)}${PINE}${CACTUS}<div class="wrap">
    ${d.eyebrow ? `<p class="eyebrow">${ctx.esc(d.eyebrow)}</p>` : ''}<h2 class="t">${ctx.esc(d.title)}</h2><p class="lead">${ctx.esc(d.body)}</p></div></section>`,

  points: (d, ctx) => `<section class="slide points">${nav(ctx, 'center')}${PINE}${CACTUS}<div class="wrap"><h2 class="t c">${ctx.esc(d.title)}</h2>
    <div class="cols">${d.items.map((item, i) => `<div class="col">${tile(two(i), ctx)}<h3>${ctx.esc(item.title)}</h3><p>${ctx.esc(item.body)}</p></div>`).join('')}</div></div></section>`,

  'image-text': (d, ctx) => `<section class="slide it">${picture(d.image, ctx, 'media', 4, 'xMinYMid slice')}${nav(ctx)}<div class="wrap">
    <h2 class="t">${ctx.esc(d.title)}</h2><p class="lead">${ctx.esc(d.body)}</p></div></section>`,

  metrics: (d, ctx) => `<section class="slide dark metrics">${nav(ctx, 'center')}<div class="wrap"><h2 class="t c">${ctx.esc(d.title)}</h2>
    <div class="grid" style="--c:${d.items.length === 4 ? 2 : 1}">${d.items.map((m) => `<div class="metric panel px"><b>${ctx.esc(m.value)}</b><span>${ctx.esc(m.label)}</span></div>`).join('')}</div></div></section>`,

  'two-column': (d, ctx) => `<section class="slide tc">${nav(ctx)}${CROSS}<div class="frame"></div><div class="wrap"><h2 class="t">${ctx.esc(d.title)}</h2>
    <div class="cols2">${d.columns.map((c, i) => `<div class="col">${tile(two(i), ctx)}<h3>${ctx.esc(c.title)}</h3><p>${ctx.esc(c.body)}</p></div>`).join('')}</div></div></section>`,

  timeline: (d, ctx) => `<section class="slide">${nav(ctx)}<div class="wrap"><h2 class="t">${ctx.esc(d.title)}</h2>
    <div class="timeline" style="--n:${d.steps.length}">${d.steps.map((s, i) => `<div class="step" style="--i:${i}">${tile(s.when, ctx)}<h3>${ctx.esc(s.title)}</h3><p>${ctx.esc(s.body ?? '')}</p><div class="pillar"></div></div>`).join('')}</div></div></section>`,

  quote: (d, ctx) => `<section class="slide dark quote">${nav(ctx)}${GROVE}<div class="wrap">${QUOTE}
    <blockquote>${ctx.esc(d.text)}</blockquote><div class="by"><b>${ctx.esc(d.name)}</b>${d.role ? `<span>${ctx.esc(d.role)}</span>` : ''}</div></div></section>`,

  table: (d, ctx) => `<section class="slide dark">${nav(ctx)}<div class="wrap"><h2 class="t">${ctx.esc(d.title)}</h2>
    <div class="tbl panel px"><table><thead><tr>${d.columns.map((c) => `<th>${ctx.esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${d.rows.map((r) => `<tr>${r.map((c) => `<td>${ctx.esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div></section>`,

  'big-number': (d, ctx) => `<section class="slide amber big">${GROUND}<div class="wrap"><b>${ctx.esc(d.value)}</b>
    <div class="what"><h2 class="t">${ctx.esc(d.label)}</h2>${d.body ? `<p>${ctx.esc(d.body)}</p>` : ''}</div></div></section>`,

  bullets: (d, ctx) => `<section class="slide dark bullets">${nav(ctx)}${GROVE}<div class="wrap"><h2 class="t">${ctx.esc(d.title)}</h2>
    <ol>${d.items.map((item, i) => `<li>${tile(two(i), ctx)}<span>${ctx.esc(item)}</span></li>`).join('')}</ol></div></section>`,

  team: (d, ctx) => `<section class="slide team">${nav(ctx, 'center')}
    <i class="spot" style="left:58px;top:70px">${COIN}</i><i class="spot" style="right:110px;top:60px">${COIN}</i><i class="spot" style="left:610px;bottom:80px">${COIN}</i>
    <div class="wrap"><h2 class="t c">${ctx.esc(d.title)}</h2>
    <div class="people" style="--n:${d.people.length}">${d.people.map((p, i) => {
      const src = p.image && ctx.image(p.image)
      const face = src ? `<img class="avatar" src="${ctx.esc(src)}" alt="${ctx.esc(p.name)}">` : `<div class="avatar" role="img" aria-label="${ctx.esc(p.name)}">${bust(i).svg('', 'none')}</div>`
      return `<div class="card px">${face}<b>${ctx.esc(p.name)}</b><span>${ctx.esc(p.role)}</span></div>`
    }).join('')}</div></div></section>`,

  image: (d, ctx) => `<section class="slide full">${picture(d.image, ctx, 'media', 7)}${d.caption ? `<p class="box px">${ctx.esc(d.caption)}</p>` : ''}</section>`,

  /** The white titled slide that `chart` and `custom` slides are drawn in. */
  frame: ({ title, eyebrow }, ctx, body) => `<section class="slide framed">${nav(ctx)}<div class="wrap">${eyebrow ? `<p class="eyebrow">${ctx.esc(eyebrow)}</p>` : ''}${title ? `<h2 class="t">${ctx.esc(title)}</h2>` : ''}${body}</div></section>`,

  closing: (d, ctx) => `<section class="slide dark closing">${GROVE_L}${GROVE}<div class="wrap"><div class="panel px">
    <h2 class="t">${ctx.esc(d.title)}</h2>${d.subtitle ? `<p class="sub">${ctx.esc(d.subtitle)}</p>` : ''}${d.contact ? `<p class="contact">${ctx.esc(d.contact)}</p>` : ''}</div></div></section>`,
}
