/**
 * Blush: flat pastel walls (cream, blush, sky, aqua, pink) over a saturated full-width floor band
 * (teal, cobalt, coral, salmon), bold geometric titles, regular subtitles over medium body copy,
 * pink blob counters on a sky-blue line, half-and-half colour splits and playful flat shapes
 * standing on the floor with a soft shadow ellipse.
 * Measured from the 22 frames of "Presentation Template by Blush" (Figma Community), 1920×1080
 * scaled by 2/3. The source's character illustrations are licensed artwork and are not
 * reproduced: each illustration slot keeps its place in the composition and is drawn here as
 * abstract shapes (blobs, capsules, circles, slabs) in the template's palette.
 */

/** Organic blob outlines in a 100×100 box, the shape of the source's number counters and backdrops. */
const BLOBS = [
  'M52 2C76 2 94 20 92 46C90 72 70 98 44 98C20 98 4 74 4 50C4 24 26 2 52 2Z',
  'M40 3C63 0 87 26 95 52C101 77 83 97 55 98C27 99 6 84 3 58C1 33 17 6 40 3Z',
  'M50 5C77 3 99 16 98 39C97 63 73 93 49 97C28 100 5 73 2 49C0 24 23 7 50 5Z',
  'M29 4C52 0 81 8 94 30C104 51 90 81 66 94C43 104 17 92 7 70C-2 46 7 8 29 4Z',
]

/** One blob path scaled into the box (x, y, w, h). */
const blob = (i, x, y, w, h, fill) => `<path d="${BLOBS[i % BLOBS.length]}" fill="${fill}" transform="translate(${x} ${y}) scale(${w / 100} ${h / 100})"/>`
const rect = (x, y, w, h, r, fill) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"/>`
const circle = (cx, cy, r, fill) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`
const shadow = (cx, cy, rx, ry, fill) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}"/>`

/** A full-slide SVG layer behind the text, in slide pixels. */
const art = (shapes, cls = '') => `<svg class="art ${cls}" viewBox="0 0 1280 720" preserveAspectRatio="none" aria-hidden="true">${shapes}</svg>`

/**
 * The standing group that replaces a character illustration: a soft backdrop blob, a standing
 * capsule with a circle above it and a slab lying in front, on a shadow ellipse. The box
 * (x, y, w, h) has its foot (the floor line) at y + h; `flip` mirrors it.
 */
function group(x, y, w, h, t, flip = false) {
  const shapes = [
    shadow(x + w / 2, y + h, w * 0.5, Math.max(6, h * 0.022), t.shadow),
    blob(t.blob ?? 1, x + w * 0.32, y, w * 0.6, h * 0.72, t.back),
    rect(x + w * 0.26, y + h * 0.34, w * 0.15, h * 0.66, w * 0.075, t.a),
    circle(x + w * 0.335, y + h * 0.24, w * 0.085, t.b),
    rect(x + w * 0.46, y + h * 0.8, w * 0.46, h * 0.2, h * 0.1, t.c),
    circle(x + w * 0.72, y + h * 0.68, w * 0.06, t.d ?? t.b),
  ].join('')
  return flip ? `<g transform="translate(${2 * x + w} 0) scale(-1 1)">${shapes}</g>` : shapes
}

/** A floor band across the slide foot, from `top` down. */
const floor = (top, colour) => `<div class="floor" style="top:${top}px;background:var(--c-${colour})"></div>`

/** Slide classes for a wall colour; `dark` walls take white type. */
const wall = (colour) => `wall" style="background:var(--c-${colour})`

/**
 * A font size that keeps `text` within `lines` lines of `width` px, assuming an average
 * advance of `em` × size per character, clamped to [min, max].
 */
function fit(text, { width, lines, max, min, em = 0.6 }) {
  const str = String(text)
  const byLines = ((width * lines) / (Math.max(str.length, 1) * em)) * 0.88
  const word = Math.max(1, ...str.split(/\s+/).map((w) => w.length))
  const byWord = width / (word * em * 1.15)
  return Math.round(Math.max(min, Math.min(max, byLines, byWord)))
}

/** How many earlier slides in the deck share this kind (picks the variant). */
const nth = (kind, ctx) => ctx.deck.slides.slice(0, ctx.index - 1).filter((s) => s.kind === kind).length

/** A user picture filling its slot, or `fallback` (an abstract shape layer) when there is none. */
function picture(image, ctx, cls, fallback) {
  const src = ctx.image(image)
  return src
    ? `<img class="${cls}" src="${ctx.esc(src)}" alt="${ctx.esc(image.alt)}">`
    : `<div class="${cls} ph" role="img" aria-label="${ctx.esc(image?.alt ?? '')}">${fallback}</div>`
}

const initials = (name) => name.split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 2)

const title = (text, ctx, cls = '') => `<h2 class="title ${cls}">${ctx.esc(text)}</h2>`

export function css(system) {
  const c = system.colors
  return `
:root { ${Object.entries(c).map(([k, v]) => `--c-${k}: ${v};`).join(' ')} --m: 133px; }
.slide { background: var(--c-white); color: var(--c-ink); font-size: 20px; line-height: 1.45; font-weight: 500; }
.art { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.floor { position: absolute; left: 0; right: 0; bottom: 0; }
.layer { position: absolute; inset: 0; }
.on-dark { color: #fff; }

.title { font-weight: 700; font-size: 52px; line-height: 1.1; letter-spacing: -.005em; }
.top-title { position: absolute; left: var(--m); top: 128px; right: var(--m); }
.big-title { font-weight: 700; line-height: 1.1; letter-spacing: -.01em; text-wrap: balance; }
.tag { font-weight: 400; font-size: 30px; line-height: 1.25; }
.sub { font-weight: 400; font-size: 29px; line-height: 1.25; }
.body { font-weight: 500; font-size: 20px; line-height: 1.45; }
.light { font-weight: 400; }

/* cover */
.cover .text { position: absolute; left: 128px; top: 0; width: 560px; height: 580px; display: flex; flex-direction: column; justify-content: center; padding-bottom: 30px; }
.cover h1 { font-weight: 700; line-height: 1.06; letter-spacing: -.01em; margin-top: 10px; }
.cover .lead { margin-top: 22px; font-weight: 400; font-size: 22px; line-height: 1.45; max-width: 500px; }
.cover .contact { position: absolute; left: 122px; top: 580px; height: 140px; display: flex; align-items: center; color: #fff; font-weight: 500; font-size: 23px; }

/* agenda: blob counters on a sky-blue line */
.order { position: absolute; left: 60px; right: 60px; top: 300px; display: grid; grid-template-columns: repeat(var(--n), 1fr); }
.order::before { content: ""; position: absolute; top: 61px; height: 6px; left: calc(50% / var(--n)); right: calc(50% / var(--n)); background: var(--c-azure); }
.order li { position: relative; list-style: none; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 30px; }
.counter { position: relative; width: 112px; height: 124px; display: grid; place-items: center; }
.counter svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.counter b { position: relative; font-size: 50px; font-weight: 700; line-height: 1; }
.order span { font-size: 20px; font-weight: 500; line-height: 1.3; padding: 0 10px; }

/* section */
.section .stack { position: absolute; left: 80px; right: 80px; top: 58px; display: flex; flex-direction: column; align-items: center; text-align: center; }
.section .counter { width: 66px; height: 72px; margin-bottom: 10px; }
.section .counter b { font-size: 28px; }
.section h2 { font-weight: 700; line-height: 1.1; letter-spacing: -.01em; }
.section .sub { margin-top: 8px; font-size: 24px; }
.section.hill .stack { left: var(--m); right: auto; top: 0; bottom: 0; width: 560px; align-items: flex-start; text-align: left; justify-content: center; color: #fff; }
.section.hill .num { font-size: 28px; font-weight: 400; margin-bottom: 6px; }

/* statement: big centred white type on cyan */
.statement .stack { position: absolute; left: 100px; right: 100px; top: 200px; bottom: 200px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; color: #fff; }
.statement p.big-title { max-width: 1080px; }
.statement .by { margin-top: 26px; font-size: 24px; font-weight: 400; }

/* split slides: a colour half and a text half */
.half { position: absolute; top: 0; bottom: 0; width: 640px; }
.half.l { left: 0; } .half.r { right: 0; }
.half .copy { position: absolute; inset: 0 70px 0 var(--m); display: flex; flex-direction: column; justify-content: center; }
.half.r .copy { left: 130px; right: 90px; }
.copy .tag { font-size: 22px; margin-bottom: 12px; }
.copy .body { margin-top: 24px; font-size: 21px; line-height: 1.5; }
.text .copy .body { font-weight: 400; font-size: 22px; }
.media { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.ph { overflow: hidden; }

/* points: subtitle + body groups in a right column */
.groups { position: absolute; left: 773px; right: 110px; top: 186px; bottom: 186px; display: flex; flex-direction: column; justify-content: space-between; }
.group .body { margin-top: 10px; font-size: 19px; line-height: 1.38; }

/* metrics */
.figures { position: absolute; left: var(--m); right: var(--m); top: 286px; display: grid; grid-template-columns: repeat(var(--n), 1fr); gap: 36px; }
.figures b { display: block; font-size: 72px; font-weight: 700; line-height: 1; letter-spacing: -.02em; font-variant-numeric: lining-nums; }
.figures span { display: block; margin-top: 18px; font-size: 20px; line-height: 1.35; max-width: 220px; }

/* two-column: stacked subtitle groups on the left, shapes on the right */
.stacked { position: absolute; left: var(--m); width: 420px; top: 222px; display: flex; flex-direction: column; gap: 46px; }

/* timeline: numbered columns */
.steps { position: absolute; left: 190px; right: 170px; top: 282px; display: grid; grid-template-columns: repeat(var(--n), 1fr); gap: 34px; }
.steps b { display: block; font-size: 48px; font-weight: 700; line-height: 1; }
.steps strong { display: block; margin-top: 22px; font-size: 22px; font-weight: 600; line-height: 1.3; }
.steps span { display: block; margin-top: 8px; font-size: 19px; line-height: 1.45; }

/* quote: white type over a wave field */
.field { position: absolute; left: 93px; top: 77px; width: 1080px; height: 563px; overflow: hidden; }
.field svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.quote .stack { position: absolute; left: 150px; right: 150px; top: 77px; height: 563px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; color: #fff; }
.quote .by { margin-top: 22px; font-size: 25px; font-weight: 400; }

/* table */
.table { position: absolute; left: var(--m); top: 236px; width: 1014px; table-layout: fixed; border-collapse: collapse; font-size: 20px; }
.table th { text-align: left; font-weight: 700; padding: 0 16px 14px 0; }
.table td { padding: 15px 16px 15px 0; border-top: 2px solid var(--c-lilac); font-weight: 500; }
.table td:first-child { font-weight: 700; }

/* big number */
.big-number .stack { position: absolute; left: 160px; right: 160px; top: 0; height: 589px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding-bottom: 20px; }
.big-number b { font-size: 190px; font-weight: 700; line-height: .95; letter-spacing: -.02em; }
.big-number .sub { margin-top: 26px; font-size: 29px; }
.big-number .body { margin-top: 12px; max-width: 620px; color: #2c3a52; }

/* bullets: dash list on the white half */
.dashes { position: absolute; left: var(--m); right: 40px; top: 228px; bottom: 90px; display: flex; flex-direction: column; justify-content: center; gap: var(--gap); list-style: none; }
.dashes li { display: flex; gap: 12px; font-size: var(--size); font-weight: 400; line-height: 1.25; }

/* team */
.people { position: absolute; left: var(--m); right: var(--m); top: 226px; display: grid; grid-template-columns: repeat(var(--n), 1fr); gap: 28px; }
.person { display: flex; flex-direction: column; align-items: center; text-align: center; }
.avatar { position: relative; width: 180px; height: 192px; display: grid; place-items: center; }
.avatar svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.avatar img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; border-radius: 52% 48% 46% 54% / 46% 52% 48% 54%; }
.avatar i { position: relative; font-style: normal; font-size: 46px; font-weight: 700; }
.person b { margin-top: 18px; font-size: 22px; font-weight: 600; line-height: 1.3; }
.person span { font-size: 18px; font-weight: 400; }

/* full image with a floor caption */
.image .shot { position: absolute; left: 0; top: 0; width: 1280px; height: 600px; object-fit: cover; }
.image .cap { position: absolute; left: var(--m); right: var(--m); top: 600px; height: 120px; display: flex; align-items: center; color: #fff; font-size: 23px; font-weight: 500; }

/* frame for chart and custom slides */
.framed { display: flex; flex-direction: column; padding: 64px var(--m) 104px; }
.framed .title { flex: none; }
.framed .eyebrow { flex: none; font-size: 22px; font-weight: 400; margin-bottom: 6px; }
.framed .avn-body { margin-top: 26px; }

/* closing */
.closing .stack { position: absolute; left: 330px; right: 330px; top: 0; height: 580px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding-bottom: 20px; }
.closing .lines { margin-top: 40px; font-size: 21px; line-height: 1.62; font-weight: 500; }
`
}

/** A blob counter: the number in a real text node over a pink blob. */
const counter = (n, i, ctx, fill = 'var(--c-petal)') => `<div class="counter"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="${BLOBS[i % BLOBS.length]}" fill="${fill}"/></svg><b>${ctx.esc(n)}</b></div>`

/** The cover's illustration slot: a pale ring with standing shapes inside, on the teal floor. */
const coverArt = () => art([
  shadow(885, 638, 250, 8, '#86B7BC'),
  `<circle cx="877" cy="331" r="146" fill="none" stroke="var(--c-shell)" stroke-width="28"/>`,
  blob(2, 770, 236, 170, 156, 'var(--c-yellow)'),
  rect(902, 340, 58, 298, 29, 'var(--c-cobalt)'),
  circle(1012, 556, 44, 'var(--c-cyan)'),
  `<rect x="955" y="598" width="290" height="40" rx="20" fill="var(--c-coral)" transform="rotate(-5 1100 618)"/>`,
  blob(3, 1160, 470, 70, 70, 'var(--c-lilac)'),
].join(''))

/** Section scenes: a row of cabinets and a window over the coral floor, an office row over the blue floor. */
const SCENES = [
  () => art([
    rect(178, 325, 172, 360, 8, 'var(--c-red)'),
    rect(350, 500, 777, 185, 4, 'var(--c-lilac)'),
    rect(410, 540, 126, 110, 8, 'var(--c-mauve)'),
    rect(570, 540, 126, 110, 8, 'var(--c-mauve)'),
    rect(730, 540, 126, 110, 8, 'var(--c-mauve)'),
    rect(890, 540, 126, 110, 8, 'var(--c-mauve)'),
    rect(410, 300, 150, 70, 35, 'var(--c-azure)'),
    rect(616, 398, 200, 10, 5, 'var(--c-lilac)'),
    rect(640, 336, 34, 62, 17, 'var(--c-cyan)'),
    circle(730, 372, 26, 'var(--c-coral)'),
    rect(866, 268, 254, 178, 20, '#BFDAF1'),
    blob(3, 900, 286, 190, 150, 'var(--c-teal)'),
    rect(1180, 340, 28, 345, 14, 'var(--c-cobalt)'),
    circle(1194, 318, 30, 'var(--c-yellow)'),
  ].join('')),
  () => art([
    rect(0, 318, 170, 274, 0, 'var(--c-peach)'),
    rect(188, 318, 252, 274, 0, 'var(--c-peach)'),
    rect(777, 316, 254, 276, 0, 'var(--c-peach)'),
    rect(1050, 316, 230, 276, 0, 'var(--c-peach)'),
    rect(0, 462, 360, 130, 0, 'var(--c-red)'),
    rect(800, 462, 480, 130, 0, 'var(--c-red)'),
    rect(0, 518, 360, 10, 0, 'var(--c-deep)'),
    rect(860, 518, 420, 10, 0, 'var(--c-deep)'),
    rect(70, 420, 128, 82, 6, 'var(--c-cobalt)'),
    rect(930, 420, 128, 82, 6, 'var(--c-cobalt)'),
    blob(1, 452, 412, 150, 168, 'var(--c-green)'),
    blob(0, 640, 450, 100, 130, 'var(--c-cyan)'),
    rect(487, 575, 96, 90, 0, 'var(--c-rosewood)'),
    `<path d="M638 577h97v52a36 36 0 0 1-36 36h-25a36 36 0 0 1-36-36z" fill="var(--c-rosewood)"/>`,
    rect(330, 420, 46, 210, 23, 'var(--c-coral)'),
    circle(353, 400, 22, 'var(--c-deep)'),
    rect(1200, 420, 46, 210, 23, 'var(--c-deep)'),
    circle(1223, 400, 22, 'var(--c-coral)'),
  ].join('')),
]

/** Wave field behind the quote: coral sky with teal and cyan hills. */
const waves = () => `<svg viewBox="0 0 1080 563" preserveAspectRatio="none" aria-hidden="true">
  <rect width="1080" height="563" fill="var(--c-coral)"/>
  <path d="M0 190C160 168 360 182 520 226C680 270 860 206 1080 150V563H0Z" fill="var(--c-green)"/>
  <path d="M560 563C700 400 860 330 1080 300V563Z" fill="var(--c-deep)"/>
  <path d="M170 315C380 300 560 345 760 318C900 300 1000 318 1080 330V392C900 420 700 470 440 530Z" fill="var(--c-cyan)"/>
  <path d="M0 250C200 290 380 380 560 563H0Z" fill="var(--c-deep)"/>
  <path d="M380 563C520 470 700 404 840 408C960 412 1040 470 1080 540V563Z" fill="var(--c-green)"/>
</svg>`

/** Shelves in two corners of the statement slide: blocks and a circle on a rounded bar. */
const shelves = () => art([
  rect(100, 182, 198, 18, 7, 'var(--c-lilac)'),
  rect(116, 125, 54, 57, 3, 'var(--c-shell)'),
  rect(190, 84, 58, 98, 6, '#F6CBC3'),
  rect(197, 140, 44, 26, 2, 'var(--c-deep)'),
  circle(219, 72, 8, '#F6CBC3'),
  rect(997, 617, 198, 18, 7, 'var(--c-shell)'),
  `<path d="M1036 545h50v52a20 20 0 0 1-20 20h-10a20 20 0 0 1-20-20z" fill="#F6CBC3"/>`,
  rect(1120, 571, 50, 10, 3, 'var(--c-lilac)'),
  rect(1120, 584, 50, 10, 3, '#F6CBC3'),
  rect(1120, 597, 50, 10, 3, 'var(--c-lilac)'),
  rect(1120, 607, 50, 10, 3, '#F6CBC3'),
].join(''))

export const slides = {
  cover: (d, ctx) => {
    const size = fit(d.title, { width: 560, lines: 2, max: 85, min: 54, em: 0.66 })
    const contact = [ctx.deck.presenter, ctx.deck.date].filter(Boolean).join(' · ')
    return `<section class="slide cover ${wall('cream')}">${floor(580, 'teal')}${coverArt()}
    <div class="text">${d.eyebrow ? `<p class="tag">${ctx.esc(d.eyebrow)}</p>` : ''}
      <h1 style="font-size:${size}px">${ctx.esc(d.title)}</h1>
      ${d.subtitle ? `<p class="lead">${ctx.esc(d.subtitle)}</p>` : ''}</div>
    ${contact ? `<p class="contact">${ctx.esc(contact)}</p>` : ''}</section>`
  },

  agenda: (d, ctx) => `<section class="slide agenda ${wall('white')}">${floor(602, 'cream')}${art([
    shadow(168, 678, 112, 8, '#E5D597'),
    blob(3, 86, 566, 170, 112, 'var(--c-azure)'),
    circle(232, 552, 24, 'var(--c-cobalt)'),
    rect(110, 650, 60, 28, 14, 'var(--c-red)'),
  ].join(''))}
    ${title(d.title, ctx, 'top-title')}
    <ol class="order" style="--n:${d.items.length}">${d.items.map((item, i) => `<li>${counter(String(i + 1), i, ctx)}<span>${ctx.esc(item)}</span></li>`).join('')}</ol></section>`,

  section: (d, ctx) => {
    const v = nth('section', ctx) % 3
    if (v === 2) {
      const size = fit(d.title, { width: 520, lines: 3, max: 81, min: 52, em: 0.64 })
      return `<section class="slide section hill ${wall('peri')}">${art([
        `<path d="M0 720V700C150 640 380 650 530 600C680 550 760 420 1000 405C1130 398 1220 410 1280 420V720Z" fill="var(--c-salmon)"/>`,
        blob(1, 760, 170, 330, 340, 'var(--c-yellow)'),
        rect(860, 470, 130, 250, 0, 'var(--c-ink)'),
        circle(925, 150, 62, 'var(--c-deep)'),
      ].join(''))}
      <div class="stack"><p class="num">${ctx.esc(d.number)}</p><h2 style="font-size:${size}px">${ctx.esc(d.title)}</h2>${d.subtitle ? `<p class="sub">${ctx.esc(d.subtitle)}</p>` : ''}</div></section>`
    }
    const size = fit(d.title, { width: 1080, lines: 1, max: 85, min: 52, em: 0.64 })
    return `<section class="slide section ${wall(v ? 'blush' : 'cream')}">${floor(v ? 630 : 633, v ? 'blue' : 'coral')}${SCENES[v]()}
    <div class="stack">${counter(d.number, v + 1, ctx, v ? 'var(--c-pink)' : 'var(--c-petal)')}<h2 style="font-size:${size}px">${ctx.esc(d.title)}</h2>${d.subtitle ? `<p class="sub">${ctx.esc(d.subtitle)}</p>` : ''}</div></section>`
  },

  statement: (d, ctx) => {
    const size = fit(d.text, { width: 1060, lines: 3, max: 81, min: 44, em: 0.64 })
    return `<section class="slide statement ${wall('cyan')}">${shelves()}
    <div class="stack"><p class="big-title" style="font-size:${size}px">${ctx.esc(d.text)}</p>${d.attribution ? `<p class="by">${ctx.esc(d.attribution)}</p>` : ''}</div></section>`
  },

  text: (d, ctx) => `<section class="slide text ${wall('white')}">
    <div class="half l on-dark" style="background:var(--c-cobalt)"><div class="copy">${d.eyebrow ? `<p class="tag">${ctx.esc(d.eyebrow)}</p>` : ''}${title(d.title, ctx)}<p class="body">${ctx.esc(d.body)}</p></div></div>
    ${art(group(730, 160, 470, 440, { back: 'var(--c-petal)', a: 'var(--c-coral)', b: 'var(--c-cobalt)', c: 'var(--c-yellow)', d: 'var(--c-red)', shadow: '#EFE6EA', blob: 3 }, true))}</section>`,

  points: (d, ctx) => `<section class="slide points ${wall('white')}">${floor(607, 'fog')}${art(group(150, 210, 520, 440, { back: 'var(--c-lilac)', a: 'var(--c-cobalt)', b: 'var(--c-yellow)', c: 'var(--c-azure)', d: 'var(--c-cyan)', shadow: '#D2C8D0', blob: 0 }))}
    ${title(d.title, ctx, 'top-title')}
    <div class="groups">${d.items.map((it) => `<div class="group"><p class="sub">${ctx.esc(it.title)}</p><p class="body">${ctx.esc(it.body)}</p></div>`).join('')}</div></section>`,

  'image-text': (d, ctx) => `<section class="slide image-text ${wall('white')}">
    <div class="half l" style="background:var(--c-aqua)">${picture(d.image, ctx, 'media', art(group(80, 150, 500, 400, { back: 'var(--c-mist)', a: 'var(--c-ink)', b: 'var(--c-rosewood)', c: 'var(--c-rosewood)', d: 'var(--c-green)', shadow: '#B3E8F0', blob: 2 }) .replace(/1280 720/, '640 720')))}</div>
    <div class="half r"><div class="copy">${title(d.title, ctx)}<p class="body">${ctx.esc(d.body)}</p></div></div></section>`,

  metrics: (d, ctx) => `<section class="slide metrics ${wall('pink')}">${floor(580, 'salmon')}${art(group(1010, 400, 220, 180, { back: 'var(--c-lilac)', a: 'var(--c-deep)', b: 'var(--c-yellow)', c: 'var(--c-cyan)', shadow: '#E4886C', blob: 3 }))}
    ${title(d.title, ctx, 'top-title')}
    <div class="figures" style="--n:${d.items.length}">${d.items.map((m) => `<div><b>${ctx.esc(m.value)}</b><span>${ctx.esc(m.label)}</span></div>`).join('')}</div></section>`,

  'two-column': (d, ctx) => `<section class="slide two-column ${wall('cream')}">${floor(633, 'sea')}${art(group(640, 180, 560, 495, { back: 'var(--c-shell)', a: 'var(--c-green)', b: 'var(--c-cyan)', c: 'var(--c-lilac)', d: 'var(--c-red)', shadow: '#9CC4C6', blob: 1 }))}
    ${title(d.title, ctx, 'top-title')}
    <div class="stacked">${d.columns.map((c) => `<div class="group"><p class="sub">${ctx.esc(c.title)}</p><p class="body">${ctx.esc(c.body)}</p></div>`).join('')}</div></section>`,

  timeline: (d, ctx) => `<section class="slide timeline ${wall('pool')}">${floor(622, 'salmon')}${art([
    shadow(60, 672, 150, 26, '#E4886C'),
    rect(14, 300, 104, 372, 52, 'var(--c-ink)'),
    circle(66, 262, 38, 'var(--c-lilac)'),
    shadow(1220, 672, 150, 26, '#E4886C'),
    rect(1168, 300, 104, 372, 52, 'var(--c-cobalt)'),
    rect(1160, 330, 120, 120, 30, 'var(--c-red)'),
    circle(1220, 262, 38, 'var(--c-ink)'),
  ].join(''))}
    ${title(d.title, ctx, 'top-title')}
    <div class="steps" style="--n:${d.steps.length}">${d.steps.map((s) => `<div><b>${ctx.esc(s.when)}</b><strong>${ctx.esc(s.title)}</strong>${s.body ? `<span>${ctx.esc(s.body)}</span>` : ''}</div>`).join('')}</div></section>`,

  quote: (d, ctx) => {
    const size = fit(`“${d.text}”`, { width: 980, lines: 3, max: 52, min: 34, em: 0.64 })
    return `<section class="slide quote ${wall('white')}"><div class="field">${waves()}</div>
    <div class="stack"><p class="big-title" style="font-size:${size}px">“${ctx.esc(d.text)}”</p><p class="by">${ctx.esc(d.name)}${d.role ? `, ${ctx.esc(d.role)}` : ''}</p></div></section>`
  },

  table: (d, ctx) => `<section class="slide ${wall('blush')}">${floor(630, 'blue')}
    ${title(d.title, ctx, 'top-title')}
    <table class="table"><thead><tr>${d.columns.map((c) => `<th>${ctx.esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${d.rows.map((r) => `<tr>${r.map((c) => `<td>${ctx.esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></section>`,

  'big-number': (d, ctx) => `<section class="slide big-number ${wall('sky')}">${floor(589, 'blue')}${art([
    shadow(192, 607, 156, 14, '#2B58B4'),
    blob(3, 92, 510, 220, 104, 'var(--c-lilac)'),
    circle(286, 584, 18, 'var(--c-shell)'),
    shadow(1090, 620, 44, 8, '#2B58B4'),
    blob(1, 1004, 362, 96, 124, 'var(--c-green)'),
    blob(0, 1060, 372, 92, 118, 'var(--c-yellow)'),
    `<path d="M1050 538h76v50a38 38 0 0 1-76 0z" fill="var(--c-cobalt)"/>`,
    shadow(1180, 622, 30, 6, '#2B58B4'),
    rect(1168, 510, 22, 82, 11, 'var(--c-green)'),
    rect(1160, 589, 40, 33, 2, '#F9DE4A'),
  ].join(''))}
    <div class="stack"><b>${ctx.esc(d.value)}</b><p class="sub">${ctx.esc(d.label)}</p>${d.body ? `<p class="body">${ctx.esc(d.body)}</p>` : ''}</div></section>`,

  bullets: (d, ctx) => {
    const v = nth('bullets', ctx) % 2
    const n = d.items.length
    const size = n > 4 ? 26 : 30
    const gap = Math.round(Math.min(40, (380 - n * size * 1.25 * 1.4) / Math.max(1, n - 1)))
    return `<section class="slide bullets ${wall('white')}">
    <div class="half r" style="background:var(--c-${v ? 'rose' : 'cream'})"></div>${art([
      shadow(960, 570, 330, 8, v ? '#F2C6CA' : '#EDE0AE'),
      rect(840, 190, 270, 380, 8, 'var(--c-mauve)'),
      rect(854, 210, 242, 346, 4, 'var(--c-shell)'),
      rect(915, 166, 120, 40, 12, 'var(--c-lilac)'),
      circle(975, 160, 24, 'var(--c-lilac)'),
      ...[0, 1, 2, 3, 4, 5].map((i) => rect(880, 250 + i * 46, 190, 6, 3, 'var(--c-lilac)')),
      `<rect x="770" y="230" width="34" height="340" rx="17" fill="var(--c-lilac)" transform="rotate(10 787 400)"/>`,
      rect(1060, 300, 60, 270, 30, 'var(--c-cobalt)'),
      circle(1090, 266, 26, 'var(--c-azure)'),
    ].join(''))}
    ${title(d.title, ctx, 'top-title')}
    <ul class="dashes" style="--size:${size}px;--gap:${gap}px">${d.items.map((it) => `<li><span>-</span><span>${ctx.esc(it)}</span></li>`).join('')}</ul></section>`
  },

  team: (d, ctx) => {
    const fills = ['var(--c-petal)', 'var(--c-aqua)', 'var(--c-cream)', 'var(--c-lilac)']
    return `<section class="slide team ${wall('white')}">${floor(602, 'cream')}
    ${title(d.title, ctx, 'top-title')}
    <div class="people" style="--n:${d.people.length}">${d.people.map((p, i) => {
      const src = p.image && ctx.image(p.image)
      const face = src
        ? `<div class="avatar"><img src="${ctx.esc(src)}" alt="${ctx.esc(p.name)}"></div>`
        : `<div class="avatar"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="${BLOBS[i % BLOBS.length]}" fill="${fills[i % fills.length]}"/></svg><i>${ctx.esc(initials(p.name))}</i></div>`
      return `<div class="person">${face}<b>${ctx.esc(p.name)}</b><span>${ctx.esc(p.role)}</span></div>`
    }).join('')}</div></section>`
  },

  image: (d, ctx) => `<section class="slide image ${wall('cream')}">${floor(600, 'teal')}${picture(d.image, ctx, 'shot', art([
    group(250, 150, 360, 450, { back: 'var(--c-shell)', a: 'var(--c-cobalt)', b: 'var(--c-coral)', c: 'var(--c-yellow)', d: 'var(--c-cyan)', shadow: '#E8D79A', blob: 3 }),
    group(700, 230, 300, 370, { back: 'var(--c-petal)', a: 'var(--c-coral)', b: 'var(--c-deep)', c: 'var(--c-azure)', d: 'var(--c-red)', shadow: '#E8D79A', blob: 0 }, true),
  ].join('')).replace(/1280 720/, '1280 600'))}
    ${d.caption ? `<p class="cap">${ctx.esc(d.caption)}</p>` : ''}</section>`,

  /** The titled content slide that `chart` and `custom` slides are drawn in: cream wall, teal floor. */
  frame: ({ title: t, eyebrow }, ctx, body) => `<section class="slide framed ${wall('cream')}">${floor(648, 'teal')}
    ${eyebrow ? `<p class="eyebrow">${ctx.esc(eyebrow)}</p>` : ''}${t ? title(t, ctx) : ''}${body}</section>`,

  closing: (d, ctx) => {
    const size = fit(d.title, { width: 620, lines: 2, max: 81, min: 48, em: 0.66 })
    return `<section class="slide closing ${wall('cream')}">${floor(580, 'salmon')}${art([
      blob(1, -60, 360, 400, 420, 'var(--c-coral)'),
      rect(90, 640, 210, 80, 0, 'var(--c-red)'),
      circle(200, 300, 74, 'var(--c-deep)'),
      blob(2, 905, 380, 330, 400, 'var(--c-cyan)'),
      rect(1150, 452, 130, 110, 10, 'var(--c-red)'),
      rect(1140, 554, 140, 12, 6, 'var(--c-azure)'),
      circle(1010, 330, 70, '#7A451C'),
    ].join(''))}
    <div class="stack"><h2 class="big-title" style="font-size:${size}px">${ctx.esc(d.title)}</h2>
      ${d.subtitle || d.contact ? `<p class="lines">${d.subtitle ? `<span>${ctx.esc(d.subtitle)}</span>` : ''}${d.subtitle && d.contact ? '<br>' : ''}${d.contact ? `<span>${ctx.esc(d.contact)}</span>` : ''}</p>` : ''}</div></section>`
  },
}
