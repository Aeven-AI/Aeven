/**
 * Checkerboard: warm off-white and charcoal slides in DM Sans, a black checkerboard block, an acid
 * lime disc, purple eight-ray asterisks, an outlined lime wave, colour swatches hanging from the top
 * edge, thin orbit rings, and a full-width footer rule with the company left and the page number
 * right. Recreated from the "Minimalist Simple Slide Deck Presentation Template" collage (Figma
 * Community).
 */

const TAU = Math.PI * 2

/** A closed SVG path through `n` points of a polar function `(t) => [x, y]`. */
function closedPath(n, point) {
  const pts = Array.from({ length: n }, (_, i) => point((i / n) * TAU).map((v) => v.toFixed(1)).join(' '))
  return `M${pts.join('L')}Z`
}

/** The outlined lime wave: a squircle whose edge ripples, as in the source's points slide. */
const WAVE = closedPath(240, (t) => {
  const c = Math.cos(t), s = Math.sin(t)
  const x = Math.sign(c) * Math.abs(c) ** 0.4, y = Math.sign(s) * Math.abs(s) ** 0.4
  const len = Math.hypot(x, y)
  const ripple = 6 * Math.sin(10 * t)
  return [110 + x * 96 + (x / len) * ripple, 65 + y * 48 + (y / len) * ripple]
})

/** The soft purple blob that bleeds off a slide edge. */
const BLOB = closedPath(180, (t) => {
  const r = 82 * (1 + 0.14 * Math.sin(3 * t + 0.6) + 0.07 * Math.sin(5 * t + 2.1))
  return [100 + r * Math.cos(t), 100 + r * Math.sin(t)]
})

const svg = (cls, viewBox, inner) => `<svg class="${cls}" viewBox="${viewBox}" aria-hidden="true">${inner}</svg>`

/** The eight-ray asterisk with square ends; colour comes from `currentColor`. */
const asterisk = (cls = '') => svg(`ast ${cls}`, '0 0 100 100',
  '<g stroke="currentColor" stroke-width="10"><path d="M50 2V98M2 50H98M16 16L84 84M84 16L16 84"/></g>')

const wave = (cls = '') => svg(`wave ${cls}`, '0 0 220 130', `<path d="${WAVE}" fill="var(--lime)" stroke="var(--ink)" stroke-width="2.5"/>`)
const blob = (cls = '') => svg(`blob ${cls}`, '0 0 200 200', `<path d="${BLOB}" fill="var(--purple)"/>`)
const halfDisc = (cls = '') => svg(`half ${cls}`, '0 0 200 100', '<path d="M0 100A100 100 0 0 1 200 100Z" fill="currentColor"/>')

/** Thin offset ellipses, the wire rings on the source's dark title slide. */
const orbits = (cls = '') => svg(`orbits ${cls}`, '0 0 440 300',
  [0, 1, 2, 3, 4].map((i) => `<ellipse cx="${212 + i * 5}" cy="${138 + i * 8}" rx="${178 - i * 5}" ry="${60 + i * 4}" transform="rotate(${14 + i * 6} 220 150)"/>`).join(''))

/** The stepped corner mark: two lime squares, outlined, meeting at one corner. */
const stepMark = () => svg('step-mark', '0 0 52 52', '<path d="M26 1.5H50.5V26H26ZM1.5 26H26V50.5H1.5Z" fill="var(--lime)" stroke="var(--ink)" stroke-width="2.5"/>')

/** A checkerboard block of `cols`×`rows` cells, dark where row+col is odd. */
const checker = (cols, rows, cls) => `<div class="checker ${cls}" style="--cols:${cols};--rows:${rows}" aria-hidden="true">${Array.from({ length: cols * rows }, (_, i) => `<i${(Math.floor(i / cols) + (i % cols)) % 2 ? ' class="on"' : ''}></i>`).join('')}</div>`

const swatches = (cls = '') => `<div class="swatches ${cls}" aria-hidden="true"><i></i><i></i><i></i></div>`

const pageNo = (ctx) => String(ctx.index).padStart(2, '0')

/** The full-width footer rule with the company on the left and the page number on the right. */
const foot = (ctx, cls = '', left = ctx.deck.title) => `<footer class="foot ${cls}"><span>${ctx.esc(left ?? '')}</span><span>${pageNo(ctx)}</span></footer>`

/** The image-slot placeholder: a charcoal field with the lime disc and a lime asterisk. */
const placeholder = (cls, alt, ctx) => `<div class="${cls} ph" role="img" aria-label="${ctx.esc(alt ?? '')}"><i class="ph-disc"></i>${asterisk('ph-ast')}</div>`

/** A user picture, or the placeholder when the slot has none. */
function picture(image, ctx, cls) {
  const src = ctx.image(image)
  return src ? `<img class="${cls}" src="${ctx.esc(src)}" alt="${ctx.esc(image.alt)}">` : placeholder(cls, image?.alt, ctx)
}

/** Team placeholders cycle through the family's shapes on its three surfaces. */
const faces = [
  () => `<div class="face f-dark">${halfDisc('face-half')}</div>`,
  () => `<div class="face f-lime">${asterisk('face-ast')}</div>`,
  () => `<div class="face f-paper">${wave('face-wave')}</div>`,
  () => `<div class="face f-check">${checker(2, 2, 'face-checker')}</div>`,
]

export function css(system) {
  const { surface: s, ink, geometry: g } = system
  return `
:root { --paper: ${s.paper}; --char: ${s.charcoal}; --checker: ${s.checker}; --lime: ${s.lime}; --purple: ${s.purple};
  --ink: ${ink.primary}; --muted: ${ink.muted}; --on-dark: ${ink.onDark}; --muted-dark: ${ink.mutedOnDark};
  --m: ${g.margin}px; --rule-y: ${g.footerRule}px; }
.slide { background: var(--paper); color: var(--ink); font-size: 20px; line-height: 1.4; }
.slide.dark { background: var(--char); color: var(--on-dark); }
.slide.lime { background: var(--lime); }
.slide svg { display: block; }

.foot { position: absolute; left: 0; right: 0; top: var(--rule-y); bottom: 0; border-top: 1.5px solid currentColor; display: flex; align-items: center; justify-content: space-between; padding: 0 var(--m); font-size: 14px; line-height: 1; }
.foot.band { border-top: 0; background: var(--char); color: var(--lime); }
.foot.band.paper { color: var(--on-dark); }

.main { position: absolute; left: var(--m); right: var(--m); top: 56px; bottom: 120px; display: flex; flex-direction: column; }
.t { font-size: 64px; font-weight: 700; letter-spacing: -.02em; line-height: 1.04; }
.dark .t { font-weight: 500; }
.lead { font-size: 24px; line-height: 1.45; }
.muted { color: var(--muted); }
.dark .muted { color: var(--muted-dark); }
.step-mark { position: absolute; top: 56px; right: var(--m); width: 52px; height: 52px; }
.ast { flex: none; }
.checker { display: grid; grid-template-columns: repeat(var(--cols), var(--cell)); grid-template-rows: repeat(var(--rows), var(--cell)); }
.checker i.on { background: var(--checker); }

/* cover: the source's dark title slide */
.swatches { display: flex; gap: 26px; }
.swatches i { width: 76px; height: 60px; background: var(--purple); }
.swatches i:nth-child(2) { background: var(--lime); }
.swatches i:nth-child(3) { background: var(--on-dark); }
.cover .swatches { position: absolute; top: 0; left: var(--m); }
.orbits { fill: none; stroke: var(--on-dark); stroke-width: 1.4; }
.cover .orbits { position: absolute; top: -56px; left: 650px; width: 490px; height: 334px; }
.cover .by { position: absolute; top: var(--m); right: 34px; writing-mode: vertical-rl; font-size: 16px; letter-spacing: .02em; }
.cover .intro { position: absolute; top: 118px; left: var(--m); width: 470px; display: flex; flex-direction: column; gap: 14px; }
.cover .eyebrow { font-size: 16px; font-weight: 600; color: var(--lime); }
.cover .sub { font-size: 22px; line-height: 1.45; color: var(--muted-dark); }
.cover h1 { position: absolute; left: calc(var(--m) - 6px); right: var(--m); bottom: 112px; font-size: 136px; font-weight: 500; letter-spacing: -.025em; line-height: .98; }

/* agenda */
.agenda .main { flex-direction: row; gap: 64px; }
.agenda .left { flex: 0 0 440px; display: flex; flex-direction: column; justify-content: space-between; }
.agenda .t { font-size: 96px; }
.agenda .checker { --cell: 52px; }
.agenda ol { flex: 1; list-style: none; display: flex; flex-direction: column; justify-content: center; }
.agenda li { display: flex; align-items: baseline; gap: 28px; padding: 18px 0; border-top: 1.5px solid var(--ink); font-size: 30px; font-weight: 500; letter-spacing: -.01em; line-height: 1.2; }
.agenda li:last-child { border-bottom: 1.5px solid var(--ink); }
.agenda li b { flex: none; width: 40px; font-size: 16px; font-weight: 700; font-variant-numeric: tabular-nums; }

/* section: charcoal with the lime disc */
.section .disc { position: absolute; width: 960px; height: 960px; left: 470px; top: -640px; border-radius: 50%; background: var(--lime); }
.section .num { position: absolute; top: 40px; right: var(--m); font-size: 150px; font-weight: 700; letter-spacing: -.04em; line-height: 1; color: var(--char); font-variant-numeric: tabular-nums; }
.section .body { position: absolute; left: var(--m); right: var(--m); bottom: 112px; display: flex; flex-direction: column; gap: 22px; }
.section .ast { width: 64px; height: 64px; color: var(--lime); margin-bottom: 6px; }
.section h2 { font-size: 112px; font-weight: 600; letter-spacing: -.025em; line-height: 1; color: var(--lime); }
.section .lead { color: var(--on-dark); }

/* statement: the lime slide with a charcoal footer band */
.statement .main { justify-content: center; gap: 30px; bottom: 80px; }
.statement p { font-size: 60px; font-weight: 600; letter-spacing: -.025em; line-height: 1.1; max-width: 1080px; text-wrap: balance; }
.statement .attr { display: flex; align-items: center; gap: 14px; font-size: 20px; font-weight: 600; }
.statement .attr .ast { width: 26px; height: 26px; color: var(--char); }

/* text */
.text .t { font-size: 80px; max-width: 1000px; }
.text .eyebrow { font-size: 18px; font-weight: 600; margin-bottom: 18px; color: var(--purple); }
.text .blob { position: absolute; left: -96px; top: 380px; width: 300px; height: 300px; }
.text .copy { margin-top: auto; margin-left: 560px; font-size: 28px; line-height: 1.4; }

/* points */
.points .t { text-align: center; }
.points .cols { flex: 1; display: grid; grid-template-columns: repeat(3, 1fr); gap: 48px; align-items: center; }
.point { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 14px; }
.point .icon { height: 140px; display: flex; align-items: center; justify-content: center; margin-bottom: 14px; }
.point .ast { width: 120px; height: 120px; color: var(--purple); }
.point .wave { width: 190px; height: 112px; }
.point .half { width: 160px; height: 80px; color: var(--char); }
.point h3 { font-size: 32px; font-weight: 700; letter-spacing: -.015em; line-height: 1.1; }
.point p { font-size: 19px; line-height: 1.4; max-width: 280px; }

/* images */
.ph { position: relative; overflow: hidden; background: var(--char); }
.ph-disc { position: absolute; width: 130%; aspect-ratio: 1; left: 30%; top: -95%; border-radius: 50%; background: var(--lime); }
.ph-ast { position: absolute; left: 9%; bottom: 10%; width: 12%; aspect-ratio: 1; height: auto; color: var(--lime); }
.image-text .main { flex-direction: row; gap: 64px; align-items: stretch; }
.image-text .media { flex: 0 0 600px; width: 600px; height: 544px; object-fit: cover; }
.image-text .copy { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; gap: 24px; }
.full .media { position: absolute; left: 0; top: 0; width: 100%; height: var(--rule-y); object-fit: cover; }
.full .ph-disc { width: 82%; left: 46%; top: -88%; }
.full .ph-ast { width: 6%; left: var(--m); bottom: 64px; }
.full .orbits { position: absolute; left: 110px; top: 90px; width: 490px; height: 334px; }

/* metrics: a checkerboard strip */
.metrics .cells { margin-top: auto; display: grid; grid-template-columns: repeat(var(--n), 1fr); height: 260px; }
.metric { display: flex; flex-direction: column; justify-content: space-between; padding: 28px 30px 30px; }
.metric:nth-child(odd) { background: var(--char); color: var(--on-dark); }
.metric b { font-size: 92px; font-weight: 700; letter-spacing: -.035em; line-height: 1; font-variant-numeric: tabular-nums; }
.metric span { font-size: 19px; line-height: 1.3; }

/* two-column on charcoal */
.two .cols { margin-top: auto; display: grid; grid-template-columns: 1fr 1fr; }
.two .col { display: flex; flex-direction: column; gap: 18px; padding-right: 56px; }
.two .col + .col { padding: 0 0 0 56px; border-left: 1.5px solid var(--on-dark); }
.two .sw { width: 76px; height: 26px; background: var(--purple); }
.two .col + .col .sw { background: var(--lime); }
.two h3 { font-size: 36px; font-weight: 600; letter-spacing: -.015em; line-height: 1.1; }

/* timeline */
.timeline .track { margin: auto 0; position: relative; display: grid; grid-template-columns: repeat(var(--n), 1fr); gap: 32px; }
.timeline .track::before { content: ""; position: absolute; left: 0; right: 0; top: 72px; border-top: 1.5px solid var(--ink); }
.tstep { position: relative; display: flex; flex-direction: column; gap: 10px; }
.tstep .when { height: 44px; font-size: 34px; font-weight: 700; letter-spacing: -.02em; line-height: 1; }
.tstep .mark { width: 30px; height: 30px; margin: 0 0 14px; background: var(--lime); border: 2.5px solid var(--ink); }
.tstep h3 { font-size: 26px; font-weight: 700; line-height: 1.15; }
.tstep p { font-size: 18px; line-height: 1.4; }

/* quote on charcoal */
.quote .main { justify-content: center; gap: 30px; }
.quote .ast { width: 80px; height: 80px; color: var(--purple); }
.quote p { font-size: 46px; font-weight: 500; letter-spacing: -.02em; line-height: 1.18; max-width: 1060px; }
.quote .by { display: flex; flex-direction: column; gap: 4px; font-size: 18px; }
.quote .by b { font-size: 22px; font-weight: 700; color: var(--lime); }

/* table */
.table table { margin: auto 0; width: 100%; border-collapse: collapse; font-size: 22px; }
.table th { text-align: left; padding: 16px 20px; font-size: 18px; font-weight: 600; background: var(--char); color: var(--on-dark); }
.table td { padding: 20px; border-bottom: 1.5px solid var(--ink); font-variant-numeric: tabular-nums; }
.table td:first-child { font-weight: 700; }

/* big number: the figure on the lime disc */
.big .main { flex-direction: row; align-items: center; gap: 72px; }
.big .disc { flex: 0 0 470px; height: 470px; border-radius: 50%; background: var(--lime); display: flex; align-items: center; justify-content: center; }
.big .disc b { font-size: 230px; font-weight: 700; letter-spacing: -.05em; line-height: 1; }
.big .what { flex: 1; display: flex; flex-direction: column; gap: 22px; }
.big .what .t { font-size: 60px; }

/* bullets */
.bullets ul { margin: auto 0; list-style: none; display: grid; grid-template-columns: 1fr 1fr; column-gap: 64px; }
.bullets li { display: flex; align-items: center; gap: 22px; padding: 26px 0; border-top: 1.5px solid var(--ink); font-size: 28px; font-weight: 500; letter-spacing: -.01em; line-height: 1.2; }
.bullets li:nth-last-child(-n+2) { border-bottom: 1.5px solid var(--ink); }
.bullets li .ast { width: 30px; height: 30px; color: var(--purple); }

/* team */
.team .people { margin-top: auto; display: grid; grid-template-columns: repeat(var(--n), 1fr); gap: 32px; }
.person { display: flex; flex-direction: column; gap: 6px; }
.person .face, .person img { width: 100%; height: 270px; margin-bottom: 14px; object-fit: cover; }
.face { position: relative; overflow: hidden; display: flex; align-items: center; justify-content: center; border: 1.5px solid var(--ink); }
.f-dark { background: var(--char); color: var(--lime); }
.f-dark .face-half { width: 62%; height: auto; position: absolute; bottom: 0; }
.f-lime { background: var(--lime); }
.f-lime .face-ast { width: 44%; height: auto; color: var(--purple); }
.f-paper .face-wave { width: 72%; height: auto; }
.f-check { align-items: stretch; justify-content: stretch; }
.f-check .face-checker { flex: 1; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }
.person b { font-size: 24px; font-weight: 700; line-height: 1.2; }
.person span { font-size: 18px; }

/* the titled frame for chart and custom slides */
.framed .avn-body { margin-top: 28px; }
.eyebrow-s { font-size: 18px; font-weight: 600; margin-bottom: 12px; color: var(--purple); }

/* closing: the source's checkerboard thank-you slide */
.closing .checker { --cell: 133px; position: absolute; left: var(--m); top: -8px; }
.closing .right { position: absolute; left: 720px; right: var(--m); top: 120px; display: flex; flex-direction: column; gap: 26px; }
.closing h2 { font-size: 150px; font-weight: 700; letter-spacing: -.03em; line-height: .96; }
.closing .lead { font-size: 28px; }
.closing .contact { font-size: 18px; }
`
}

export const slides = {
  cover: (d, ctx) => `<section class="slide dark cover">${swatches()}${orbits()}
    ${ctx.deck.presenter ? `<span class="by">By ${ctx.esc(ctx.deck.presenter)}</span>` : ''}
    <div class="intro">${d.eyebrow ? `<span class="eyebrow">${ctx.esc(d.eyebrow)}</span>` : ''}${d.subtitle ? `<p class="sub">${ctx.esc(d.subtitle)}</p>` : ''}</div>
    <h1>${ctx.esc(d.title)}</h1>${foot(ctx, '', ctx.deck.date ?? ctx.deck.title)}</section>`,

  agenda: (d, ctx) => `<section class="slide agenda"><div class="main"><div class="left"><h2 class="t">${ctx.esc(d.title)}</h2>${checker(3, 2, '')}</div>
    <ol>${d.items.map((item, i) => `<li><b>${String(i + 1).padStart(2, '0')}</b><span>${ctx.esc(item)}</span></li>`).join('')}</ol></div>${foot(ctx)}</section>`,

  section: (d, ctx) => `<section class="slide dark section"><i class="disc"></i><span class="num">${ctx.esc(d.number)}</span>
    <div class="body">${asterisk()}<h2>${ctx.esc(d.title)}</h2>${d.subtitle ? `<p class="lead">${ctx.esc(d.subtitle)}</p>` : ''}</div>${foot(ctx)}</section>`,

  statement: (d, ctx) => `<section class="slide lime statement"><div class="main"><p>${ctx.esc(d.text)}</p>
    ${d.attribution ? `<span class="attr">${asterisk()}<span>${ctx.esc(d.attribution)}</span></span>` : ''}</div>${foot(ctx, 'band')}</section>`,

  text: (d, ctx) => `<section class="slide text">${blob()}<div class="main">${d.eyebrow ? `<span class="eyebrow">${ctx.esc(d.eyebrow)}</span>` : ''}<h2 class="t">${ctx.esc(d.title)}</h2>
    <p class="lead copy">${ctx.esc(d.body)}</p></div>${stepMark()}${foot(ctx)}</section>`,

  points: (d, ctx) => {
    const icons = [() => asterisk(), () => wave(), () => halfDisc()]
    return `<section class="slide points"><div class="main"><h2 class="t">${ctx.esc(d.title)}</h2>
    <div class="cols">${d.items.map((item, i) => `<div class="point"><div class="icon">${icons[i % 3]()}</div><h3>${ctx.esc(item.title)}</h3><p>${ctx.esc(item.body)}</p></div>`).join('')}</div></div>${foot(ctx)}</section>`
  },

  'image-text': (d, ctx) => `<section class="slide image-text"><div class="main">${picture(d.image, ctx, 'media')}
    <div class="copy"><h2 class="t">${ctx.esc(d.title)}</h2><p class="lead">${ctx.esc(d.body)}</p></div></div>${foot(ctx)}</section>`,

  metrics: (d, ctx) => `<section class="slide metrics"><div class="main"><h2 class="t">${ctx.esc(d.title)}</h2>
    <div class="cells" style="--n:${d.items.length}">${d.items.map((m) => `<div class="metric"><b>${ctx.esc(m.value)}</b><span>${ctx.esc(m.label)}</span></div>`).join('')}</div></div>${stepMark()}${foot(ctx)}</section>`,

  'two-column': (d, ctx) => `<section class="slide dark two"><div class="main"><h2 class="t">${ctx.esc(d.title)}</h2>
    <div class="cols">${d.columns.map((c) => `<div class="col"><i class="sw"></i><h3>${ctx.esc(c.title)}</h3><p class="lead">${ctx.esc(c.body)}</p></div>`).join('')}</div></div>${foot(ctx)}</section>`,

  timeline: (d, ctx) => `<section class="slide timeline"><div class="main"><h2 class="t">${ctx.esc(d.title)}</h2>
    <div class="track" style="--n:${d.steps.length}">${d.steps.map((s) => `<div class="tstep"><span class="when">${ctx.esc(s.when)}</span><i class="mark"></i><h3>${ctx.esc(s.title)}</h3>${s.body ? `<p class="muted">${ctx.esc(s.body)}</p>` : ''}</div>`).join('')}</div></div>${stepMark()}${foot(ctx)}</section>`,

  quote: (d, ctx) => `<section class="slide dark quote"><div class="main">${asterisk()}<p>${ctx.esc(d.text)}</p>
    <span class="by"><b>${ctx.esc(d.name)}</b>${d.role ? `<span class="muted">${ctx.esc(d.role)}</span>` : ''}</span></div>${foot(ctx)}</section>`,

  table: (d, ctx) => `<section class="slide table"><div class="main"><h2 class="t">${ctx.esc(d.title)}</h2>
    <table><thead><tr>${d.columns.map((c) => `<th>${ctx.esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${d.rows.map((r) => `<tr>${r.map((c) => `<td>${ctx.esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${stepMark()}${foot(ctx)}</section>`,

  'big-number': (d, ctx) => `<section class="slide big"><div class="main"><div class="disc"><b>${ctx.esc(d.value)}</b></div>
    <div class="what"><h2 class="t">${ctx.esc(d.label)}</h2>${d.body ? `<p class="lead">${ctx.esc(d.body)}</p>` : ''}</div></div>${foot(ctx)}</section>`,

  bullets: (d, ctx) => `<section class="slide bullets"><div class="main"><h2 class="t">${ctx.esc(d.title)}</h2>
    <ul>${d.items.map((item) => `<li>${asterisk()}<span>${ctx.esc(item)}</span></li>`).join('')}</ul></div>${stepMark()}${foot(ctx)}</section>`,

  team: (d, ctx) => `<section class="slide team"><div class="main"><h2 class="t">${ctx.esc(d.title)}</h2>
    <div class="people" style="--n:${d.people.length}">${d.people.map((p, i) => {
      const src = p.image && ctx.image(p.image)
      const face = src ? `<img src="${ctx.esc(src)}" alt="${ctx.esc(p.name)}">` : faces[i % faces.length]()
      return `<div class="person">${face}<b>${ctx.esc(p.name)}</b><span class="muted">${ctx.esc(p.role)}</span></div>`
    }).join('')}</div></div>${stepMark()}${foot(ctx)}</section>`,

  image: (d, ctx) => {
    const src = ctx.image(d.image)
    const media = src
      ? `<img class="media" src="${ctx.esc(src)}" alt="${ctx.esc(d.image.alt)}">`
      : `<div class="media ph" role="img" aria-label="${ctx.esc(d.image.alt ?? '')}"><i class="ph-disc"></i>${orbits()}${asterisk('ph-ast')}</div>`
    return `<section class="slide full">${media}${foot(ctx, 'band paper', d.caption ?? ctx.deck.title)}</section>`
  },

  /** The titled content slide that `chart` and `custom` slides are drawn in. */
  frame: ({ title, eyebrow }, ctx, body) => `<section class="slide framed"><div class="main">${eyebrow ? `<span class="eyebrow-s">${ctx.esc(eyebrow)}</span>` : ''}${title ? `<h2 class="t">${ctx.esc(title)}</h2>` : ''}${body}</div>${stepMark()}${foot(ctx)}</section>`,

  closing: (d, ctx) => `<section class="slide closing">${checker(4, 4, '')}
    <div class="right"><h2>${ctx.esc(d.title)}</h2>${d.subtitle ? `<p class="lead">${ctx.esc(d.subtitle)}</p>` : ''}${d.contact ? `<span class="contact muted">${ctx.esc(d.contact)}</span>` : ''}</div>${foot(ctx)}</section>`,
}
