/**
 * Moodboard: white, pale sky-blue and violet-black slides set in bold Inter with tight tracking;
 * huge centred section titles filled with pastel gradients and a short rule with the section
 * number above their right end; the date and company in the footer corners; pastel holographic
 * ribbons sweeping across sky fields and lilac panels; frosted white cards; gradient pill badges;
 * rounded image-led moodboard grids. An en-dash signs off the closing title ("Contact –").
 * Measured from the preview images of "Mood – Moodboard Template (Figma Slides)" (Figma Community).
 *
 * The ribbons are drawn here, not copied: each is a conic gradient on an ellipse with its centre
 * painted in the field colour, so the band thickens and thins around the ellipse as if it twisted.
 * Gradient type colours each letter along the gradient: background-clip and blend overlays print as
 * rectangles in the PDF, and solid letter colours carry into the PPTX text boxes.
 */

/** Gradient fills for display type, in the order the source's section titles use them. */
const FILLS = ['violet', 'ember', 'coral', 'holo']

/** Neutral placeholder tones for image slots, rotated through a grid. */
const TONES = ['lilac', 'sky', 'stone', 'blush']

/** A ribbon: `tone` picks the colours, `cls` places and sizes it. */
const ribbon = (tone, cls) => `<div class="rclip" aria-hidden="true"><div class="ribbon r-${tone} ${cls}"><i></i></div></div>`

/** A user picture, or a neutral tone field with a soft ribbon when the slot has none. */
function picture(image, ctx, cls, tone = 'lilac') {
  const src = ctx.image(image)
  return src
    ? `<img class="${cls} pic" src="${ctx.esc(src)}" alt="${ctx.esc(image.alt)}">`
    : `<div class="${cls} pic ph t-${tone}" role="img" aria-label="${ctx.esc(image?.alt ?? '')}">${ribbon('mist', 'rb-ph')}</div>`
}

/** Footer: the deck date bottom-left and the presenter or company bottom-right. */
const foot = (ctx) => `<footer class="foot"><span>${ctx.esc(ctx.deck.date ?? '')}</span><span>${ctx.esc(ctx.deck.presenter ?? '')}</span></footer>`

/** The small label set above a title ("Project name" in the source). */
const label = (text, ctx) => (text ? `<span class="label">${ctx.esc(text)}</span>` : '')

/** `#rrggbb` at `t` (0–1) along evenly spaced `stops`. */
function along(stops, t) {
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const x = Math.min(Math.max(t, 0), 1) * (stops.length - 1)
  const i = Math.min(Math.floor(x), stops.length - 2)
  const [a, b] = [rgb(stops[i]), rgb(stops[i + 1])]
  return `#${a.map((v, k) => Math.round(v + (b[k] - v) * (x - i)).toString(16).padStart(2, '0')).join('')}`
}

/** `text` with each letter coloured along the gradient named `name` in system.json `gradients`. */
function grad(text, name, ctx) {
  const chars = [...String(text)]
  const stops = ctx.system.gradients[name]
  return chars.map((c, i) => (c.trim() ? `<span style="color:${along(stops, i / Math.max(chars.length - 1, 1))}">${ctx.esc(c)}</span>` : c)).join('')
}

const pill = (text, ctx) => `<span class="pill">${ctx.esc(text)}</span>`

/** The count of earlier slides of this kind in the deck. */
const nth = (kind, ctx) => ctx.deck.slides.slice(0, ctx.index - 1).filter((s) => s.kind === kind).length

/**
 * A font size that keeps `text` on at most `lines` lines of `width` px, from an average advance
 * of `em` × size per character, clamped to [min, max].
 */
function fit(text, { width, lines = 1, max, min, em = 0.6 }) {
  const str = String(text)
  const byLines = (width * lines) / (Math.max(str.length, 1) * em) * (lines > 1 ? 0.85 : 1)
  const word = Math.max(1, ...str.split(/\s+/).map((w) => w.length))
  const byWord = width / (word * em)
  return Math.round(Math.max(min, Math.min(max, byLines, byWord)))
}

/** The square icon tiles of the source's feature cards, drawn with shapes. */
const ICONS = ['dots', 'ring', 'diamond']
const icon = (i) => `<span class="ico ico-${ICONS[i % ICONS.length]}" aria-hidden="true"><i></i><i></i><i></i><i></i></span>`

export function css(system) {
  const { surface: s, ink, gradients: g, ribbons: r, geometry: geo } = system
  return `
:root { --white: ${s.white}; --night: ${s.night}; --sky: ${s.sky}; --lilac: ${s.lilac}; --frost: ${s.frost};
  --ink: ${ink.primary}; --muted: ${ink.muted}; --label: ${ink.label}; --rule: ${system.palette.rule};
  --m: ${geo.margin}px; --r: ${geo.radius}px; --cr: ${geo.cardRadius}px;
  --g-pill: linear-gradient(100deg, ${g.pill[0]} 0%, #B240A8 34%, #D98BBE 50%, #CF5E92 64%, ${g.pill[1]} 100%); }
.slide { background: var(--white); color: var(--ink); padding: var(--m); display: flex; flex-direction: column; font-size: 17px; line-height: 1.5; letter-spacing: -.005em; }
.slide.night { background: var(--night); color: #fff; }
.slide.sky { background: var(--sky); --bg: var(--sky); }
h1, h2, h3 { font-weight: 700; letter-spacing: -.04em; line-height: 1.02; position: relative; }
.t-xl { font-size: 156px; line-height: 1; } .t-l { font-size: 64px; } .t-m { font-size: 44px; letter-spacing: -.03em; line-height: 1.08; }
.label { position: relative; display: block; font-size: 20px; letter-spacing: -.01em; color: var(--label); margin-bottom: 6px; }
.night .label { color: #B79BFF; }
.muted { color: var(--muted); }
.pill { position: relative; display: inline-flex; align-items: center; align-self: flex-start; height: 44px; padding: 0 22px; border-radius: 999px; background: var(--g-pill); color: #fff; font-size: 19px; font-weight: 600; letter-spacing: -.02em; white-space: nowrap; }
.foot { position: absolute; left: var(--m); right: var(--m); bottom: 36px; display: flex; justify-content: space-between; font-size: 13px; letter-spacing: 0; color: var(--ink); }
.night .foot { color: #fff; }
.head { position: relative; display: flex; flex-direction: column; }

/* Ribbons: a conic gradient under a radial gradient that paints the field colour (--bg) inside the
   inner ellipse (--in) and outside the outer one, leaving a band that thickens and thins around the
   ellipse. Each placement sets the box and where the colours start (--from). No border-radius: the
   PDF printer flattens the curve of very large rounded boxes. A text-free layer clips each one. */
.rclip { position: absolute; inset: 0; overflow: hidden; clip-path: inset(0 round var(--rad, 0)); pointer-events: none; }
.ribbon { position: absolute; pointer-events: none; }
.ribbon i { position: absolute; inset: 0; --edge: radial-gradient(farthest-side, var(--bg) var(--in), transparent calc(var(--in) + .3%), transparent 99.6%, var(--bg) 100%); }
.r-aqua i { background: var(--edge), conic-gradient(from var(--from), transparent 0, ${r.aqua[0]} 2%, ${r.aqua[1]} 6%, #ffffff 8.5%, ${r.aqua[2]} 11%, ${r.aqua[1]} 14%, ${r.aqua[3]} 18%, #eef5ff 20%, ${r.aqua[3]} 23%, ${r.aqua[2]} 26%, transparent 29% 100%); }
.r-magenta i { background: var(--edge), conic-gradient(from var(--from), transparent 0, #f2a3b4 2%, ${r.magenta[2]} 5%, ${r.magenta[3]} 7.5%, ${r.magenta[1]} 10%, #a23ad8 14%, ${r.magenta[0]} 17%, #b77de6 20%, transparent 22% 100%); }
.r-mist i { background: var(--edge), conic-gradient(from var(--from), transparent 0, #ffffffaa 4%, #ffffff44 10%, #ffffffbb 16%, #ffffff33 22%, transparent 27% 100%); }

/* Image slots and placeholders. */
.pic { position: relative; display: block; width: 100%; height: 100%; border-radius: var(--r); object-fit: cover; }
img.pic { overflow: hidden; }
.ph.t-lilac { --bg: var(--lilac); } .ph.t-sky { --bg: var(--sky); } .ph.t-stone { --bg: #DAD9D4; } .ph.t-blush { --bg: #EFD9E2; }
.ph { background: var(--bg); --rad: var(--r); }
.rb-ph { left: -150%; top: 34%; width: 260%; height: 210%; --from: 340deg; --in: 91%; }

/* Cover: sky field, aqua ribbon, label over a huge title, corner meta. */
.cover { justify-content: center; padding-left: 205px; }
.rb-cover { left: -1500px; top: 0; width: 2700px; height: 2500px; --from: 0deg; --in: 86.5%; }
.cover h1 { margin-top: 2px; }
.cover .label { color: var(--ink); font-size: 21px; }
.cover .sub { position: relative; margin-top: 18px; max-width: 600px; font-size: 21px; line-height: 1.4; }

/* Agenda: huge title left, rule-and-number rows right. */
.agenda { display: grid; grid-template-columns: 460px 1fr; gap: 40px; align-items: center; padding-bottom: 90px; }
.agenda h2 { font-size: 112px; line-height: 1; }
.agenda ol { list-style: none; display: flex; flex-direction: column; }
.agenda li { display: grid; grid-template-columns: 112px 1fr; align-items: center; padding: 15px 0; font-size: 30px; font-weight: 600; letter-spacing: -.025em; line-height: 1.2; }
.idx { display: flex; align-items: center; gap: 12px; font-size: 13px; font-weight: 400; letter-spacing: 0; }
.idx::before { content: ""; width: 64px; border-top: 1px solid currentColor; opacity: .55; }

/* Section: a centred gradient title with the rule-and-number at its upper right. */
.section { align-items: center; justify-content: center; text-align: center; padding-bottom: 70px; }
.section .wrap { position: relative; display: flex; flex-direction: column; align-items: center; max-width: 1172px; }
.section .idx { align-self: flex-end; margin: 0 6px 14px 0; }
.section .sub { margin-top: 18px; font-size: 21px; color: var(--muted); }
.night.section .sub { color: #BDB8C8; }

/* Statement. */
.statement { align-items: center; justify-content: center; text-align: center; gap: 34px; padding-bottom: 90px; }
.statement .pill { align-self: center; }
.statement p { font-size: 62px; font-weight: 700; letter-spacing: -.04em; line-height: 1.08; max-width: 1080px; text-wrap: balance; }

/* Text: a lilac ribbon panel over a gradient title and the body. */
.panel { position: relative; border-radius: 40px; background: var(--lilac); --bg: var(--lilac); --rad: 40px; }
.text .panel { height: 330px; flex: none; }
.rb-panel { left: -2500px; top: -2600px; width: 4400px; height: 2900px; --from: 112deg; --in: 92%; }
.text .lower { flex: 1; display: grid; grid-template-columns: 1fr 584px; gap: 40px; align-items: center; padding-bottom: 46px; }
.text .lower p, .copy { font-size: 17px; line-height: 1.6; color: #1d1a24; }

/* Points: sky field, frosted cards with icon tiles. */
.points .head { max-width: 760px; }
.rb-points { left: -850px; top: -100px; width: 2200px; height: 1900px; --from: 26deg; --in: 88%; }
.cards { position: relative; margin-top: auto; display: grid; grid-template-columns: repeat(3, 1fr); gap: 22px; }
.card { background: var(--frost); border: 1px solid rgba(255,255,255,.8); border-radius: var(--cr); padding: 40px 30px 42px; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 10px; backdrop-filter: blur(14px); }
.card b { margin-top: 18px; font-size: 25px; font-weight: 600; letter-spacing: -.03em; line-height: 1.2; }
.card span { font-size: 17px; line-height: 1.5; color: #2a2733; }
.ico { position: relative; width: 52px; height: 52px; border-radius: 12px; background: var(--ink); box-shadow: 6px 4px 0 rgba(8,1,18,.12); }
.ico i { position: absolute; background: #fff; }
.ico-dots i { width: 10px; height: 10px; border-radius: 50%; }
.ico-dots i:nth-child(1) { left: 14px; top: 14px; } .ico-dots i:nth-child(2) { right: 14px; top: 14px; }
.ico-dots i:nth-child(3) { left: 14px; bottom: 14px; } .ico-dots i:nth-child(4) { right: 14px; bottom: 14px; }
.ico-ring i:nth-child(1) { left: 13px; top: 15px; width: 26px; height: 22px; border-radius: 50%; background: none; border: 6px solid #fff; }
.ico-ring i:not(:first-child) { display: none; }
.ico-diamond i { width: 11px; height: 11px; border-radius: 2px; transform: rotate(45deg); }
.ico-diamond i:nth-child(1) { left: 20.5px; top: 11px; } .ico-diamond i:nth-child(2) { left: 11px; top: 20.5px; }
.ico-diamond i:nth-child(3) { left: 30px; top: 20.5px; } .ico-diamond i:nth-child(4) { left: 20.5px; top: 30px; }

/* Image and text. */
.image-text { display: grid; grid-template-columns: 532px 1fr; gap: 48px; align-items: center; padding-right: 60px; }
.image-text .pic { height: 606px; border-radius: 40px; --rad: 40px; }
.image-text .col { display: flex; flex-direction: column; gap: 30px; padding-bottom: 20px; }

/* Metrics: pale blue panels. */
.tiles { margin-top: auto; margin-bottom: 52px; display: grid; grid-template-columns: repeat(var(--n), 1fr); gap: 20px; }
.tile { background: var(--sky); border-radius: var(--cr); padding: 34px 28px 30px; display: flex; flex-direction: column; justify-content: space-between; gap: 50px; min-height: 290px; }
.tile b { font-size: 84px; font-weight: 700; letter-spacing: -.05em; line-height: 1; font-variant-numeric: tabular-nums; }
.tile > span { font-size: 18px; line-height: 1.4; }
.tile b { color: #6F25C9; }

/* Two columns: two rounded image panels with captions. */
.duo { margin-top: 28px; margin-bottom: 44px; flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 22px; }
.duo .col { display: flex; flex-direction: column; gap: 8px; min-height: 0; }
.duo .pic { flex: 1; min-height: 0; margin-bottom: 18px; }
.duo b { font-size: 22px; font-weight: 600; letter-spacing: -.02em; }
.duo p { font-size: 16px; line-height: 1.55; color: #2a2733; max-width: 480px; }

/* Timeline: rule-and-dot track, gradient pills. */
.track { margin: auto 0; position: relative; display: grid; grid-template-columns: repeat(var(--n), 1fr); gap: 22px; }
.track::before { content: ""; position: absolute; left: 0; right: 0; top: 22px; border-top: 1px solid var(--rule); }
.step { position: relative; display: flex; flex-direction: column; gap: 10px; }
.step .pill { margin-bottom: 30px; }
.step b { font-size: 30px; font-weight: 700; letter-spacing: -.035em; line-height: 1.1; }
.step > span:not(.pill) { font-size: 17px; color: var(--muted); }

/* Quote: sky field, aqua ribbon, a frosted card. */
.quote { align-items: center; justify-content: center; }
.rb-quote { left: 0; top: -1600px; width: 3000px; height: 2600px; --from: 212deg; --in: 91%; }
.qcard { position: relative; width: 900px; background: var(--frost); border: 1px solid rgba(255,255,255,.8); border-radius: 32px; padding: 56px 72px 52px; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 30px; backdrop-filter: blur(14px); }
.qcard p { font-size: 40px; font-weight: 600; letter-spacing: -.035em; line-height: 1.18; text-wrap: balance; }
.qby { display: flex; flex-direction: column; gap: 2px; }
.qby b { font-size: 19px; font-weight: 600; } .qby span { font-size: 16px; color: var(--muted); }

/* Table. */
table { margin: auto 0; width: 100%; border-collapse: separate; border-spacing: 0; font-size: 21px; }
th { text-align: left; font-size: 15px; font-weight: 600; padding: 16px 24px; background: var(--lilac); }
th:first-child { border-radius: 16px 0 0 16px; } th:last-child { border-radius: 0 16px 16px 0; }
td { padding: 22px 24px; border-bottom: 1px solid var(--rule); font-variant-numeric: tabular-nums; }
td:first-child { font-weight: 600; letter-spacing: -.02em; }

/* Big number: night field, holographic numeral. */
.big { display: grid; grid-template-columns: auto 1fr; gap: 64px; align-items: center; padding-left: 90px; padding-bottom: 80px; }
.big .num { font-size: 330px; font-weight: 700; letter-spacing: -.06em; line-height: 1; }
.big .what { display: flex; flex-direction: column; gap: 18px; max-width: 470px; }
.big .what p { font-size: 20px; line-height: 1.5; color: #CFCAD8; }

/* Bullets: gradient swatches beside each line, as on the colour pages. */
.swatches { margin: auto 0; display: grid; grid-template-columns: 1fr 1fr; gap: 34px 56px; list-style: none; }
.swatches li { display: flex; align-items: center; gap: 24px; font-size: 25px; font-weight: 500; letter-spacing: -.02em; line-height: 1.3; }
.sw { flex: none; width: 84px; height: 84px; border-radius: 16px; }
.sw-0 { background: linear-gradient(135deg, #E25CB4, #8220D0); } .sw-1 { background: linear-gradient(135deg, #F09A4A, #E0544C); }
.sw-2 { background: linear-gradient(135deg, #8FD9F0, #3F7CE6); } .sw-3 { background: linear-gradient(135deg, #F6C6DA, #B79BFF); }
.sw-4 { background: linear-gradient(135deg, #CDEB6A, #4FB548); } .sw-5 { background: linear-gradient(135deg, #E9E5EF, #BAD7E3); }

/* Team: a moodboard row of tall rounded tiles. */
.grid { margin-top: 28px; margin-bottom: 46px; flex: 1; display: grid; grid-template-columns: repeat(var(--n), 1fr); gap: 20px; min-height: 0; }
.person { display: flex; flex-direction: column; gap: 4px; min-height: 0; }
.person .pic { flex: 1; min-height: 0; margin-bottom: 14px; }
.person .init { position: absolute; left: 22px; bottom: 16px; font-size: 44px; font-weight: 700; letter-spacing: -.04em; color: #fff; }
.person b { font-size: 21px; font-weight: 600; letter-spacing: -.02em; } .person > span { font-size: 16px; color: var(--muted); }

/* Full image: one rounded panel with a caption line below. */
.image .pic { flex: 1; min-height: 0; }
.image .cap { margin-top: 18px; margin-bottom: 30px; font-size: 16px; }

/* Framed slides (chart, custom). */
.framed .avn-body { margin-top: 26px; margin-bottom: 44px; }

/* Closing: the "Contact –" page. */
.closing { align-items: center; justify-content: center; text-align: center; padding-bottom: 70px; }
.closing .top { position: absolute; top: 46px; left: 0; right: 0; font-size: 15px; }
.closing h2 { white-space: nowrap; }
`
}

export const slides = {
  cover: (d, ctx) => `<section class="slide sky cover">${ribbon('aqua', 'rb-cover')}
    <div class="head">${label(d.eyebrow, ctx)}<h1 class="t-xl" style="font-size:${fit(d.title, { width: 940, lines: 2, max: 156, min: 80, em: 0.62 })}px">${ctx.esc(d.title)}</h1>
    ${d.subtitle ? `<p class="sub">${ctx.esc(d.subtitle)}</p>` : ''}</div>${foot(ctx)}</section>`,

  agenda: (d, ctx) => `<section class="slide agenda"><h2>${ctx.esc(d.title)}</h2>
    <ol>${d.items.map((item, i) => `<li><span class="idx">${String(i + 1).padStart(2, '0')}</span><span>${ctx.esc(item)}</span></li>`).join('')}</ol>${foot(ctx)}</section>`,

  section: (d, ctx) => {
    const n = nth('section', ctx)
    const night = n % 2 === 1
    const fill = FILLS[Math.floor(n / 2) % FILLS.length]
    const size = fit(d.title, { width: 1150, lines: 2, max: 156, min: 84, em: 0.6 })
    return `<section class="slide section${night ? ' night' : ''}"><div class="wrap"><span class="idx">${ctx.esc(d.number)}</span>
      <h2 class="t-xl" style="font-size:${size}px">${night ? ctx.esc(d.title) : grad(d.title, fill, ctx)}</h2></div>
      ${d.subtitle ? `<p class="sub">${ctx.esc(d.subtitle)}</p>` : ''}${foot(ctx)}</section>`
  },

  statement: (d, ctx) => `<section class="slide statement">${d.attribution ? pill(d.attribution, ctx) : ''}<p>${ctx.esc(d.text)}</p>${foot(ctx)}</section>`,

  text: (d, ctx) => `<section class="slide text"><div class="panel">${ribbon('magenta', 'rb-panel')}</div>
    <div class="lower"><div class="head">${label(d.eyebrow, ctx)}<h2 class="t-m">${grad(d.title, 'title', ctx)}</h2></div><p>${ctx.esc(d.body)}</p></div></section>`,

  points: (d, ctx) => `<section class="slide sky points">${ribbon('aqua', 'rb-points')}
    <div class="head"><h2 class="t-l">${ctx.esc(d.title)}</h2></div>
    <div class="cards">${d.items.map((item, i) => `<div class="card">${icon(i)}<b>${ctx.esc(item.title)}</b><span>${ctx.esc(item.body)}</span></div>`).join('')}</div></section>`,

  'image-text': (d, ctx) => `<section class="slide image-text">${picture(d.image, ctx, 'media', 'sky')}
    <div class="col"><h2 class="t-m">${ctx.esc(d.title)}</h2><p class="copy">${ctx.esc(d.body)}</p></div></section>`,

  metrics: (d, ctx) => `<section class="slide"><div class="head"><h2 class="t-l">${ctx.esc(d.title)}</h2></div>
    <div class="tiles" style="--n:${d.items.length}">${d.items.map((m) => `<div class="tile"><b>${ctx.esc(m.value)}</b><span>${ctx.esc(m.label)}</span></div>`).join('')}</div>${foot(ctx)}</section>`,

  'two-column': (d, ctx) => `<section class="slide"><div class="head"><h2 class="t-m">${ctx.esc(d.title)}</h2></div>
    <div class="duo">${d.columns.map((c, i) => `<div class="col">${picture(undefined, ctx, 'media', ['lilac', 'sky'][i % 2])}<b>${ctx.esc(c.title)}</b><p>${ctx.esc(c.body)}</p></div>`).join('')}</div>${foot(ctx)}</section>`,

  timeline: (d, ctx) => `<section class="slide"><div class="head"><h2 class="t-l">${ctx.esc(d.title)}</h2></div>
    <div class="track" style="--n:${d.steps.length}">${d.steps.map((s) => `<div class="step">${pill(s.when, ctx)}<b>${ctx.esc(s.title)}</b>${s.body ? `<span>${ctx.esc(s.body)}</span>` : ''}</div>`).join('')}</div>${foot(ctx)}</section>`,

  quote: (d, ctx) => `<section class="slide sky quote">${ribbon('aqua', 'rb-quote')}<div class="qcard"><p>${ctx.esc(d.text)}</p>
    <div class="qby"><b>${ctx.esc(d.name)}</b>${d.role ? `<span>${ctx.esc(d.role)}</span>` : ''}</div></div></section>`,

  table: (d, ctx) => `<section class="slide"><div class="head"><h2 class="t-l">${ctx.esc(d.title)}</h2></div>
    <table><thead><tr>${d.columns.map((c) => `<th>${ctx.esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${d.rows.map((r) => `<tr>${r.map((c) => `<td>${ctx.esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>${foot(ctx)}</section>`,

  'big-number': (d, ctx) => `<section class="slide night big"><b class="num" style="font-size:${fit(d.value, { width: 560, max: 330, min: 140, em: 0.62 })}px">${grad(d.value, 'holo', ctx)}</b>
    <div class="what"><h2 class="t-m">${ctx.esc(d.label)}</h2>${d.body ? `<p>${ctx.esc(d.body)}</p>` : ''}</div>${foot(ctx)}</section>`,

  bullets: (d, ctx) => `<section class="slide"><div class="head"><h2 class="t-l">${ctx.esc(d.title)}</h2></div>
    <ul class="swatches">${d.items.map((item, i) => `<li><span class="sw sw-${i % 6}" aria-hidden="true"></span><span>${ctx.esc(item)}</span></li>`).join('')}</ul>${foot(ctx)}</section>`,

  team: (d, ctx) => `<section class="slide"><div class="head"><h2 class="t-m">${ctx.esc(d.title)}</h2></div>
    <div class="grid" style="--n:${d.people.length}">${d.people.map((p, i) => {
      const src = p.image && ctx.image(p.image)
      const face = src
        ? `<img class="pic" src="${ctx.esc(src)}" alt="${ctx.esc(p.name)}">`
        : `<div class="pic ph t-${TONES[i % TONES.length]}" role="img" aria-label="${ctx.esc(p.name)}">${ribbon('mist', 'rb-ph')}<span class="init">${ctx.esc(p.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2))}</span></div>`
      return `<div class="person">${face}<b>${ctx.esc(p.name)}</b><span>${ctx.esc(p.role)}</span></div>`
    }).join('')}</div>${foot(ctx)}</section>`,

  image: (d, ctx) => `<section class="slide image">${picture(d.image, ctx, 'media', 'lilac')}${d.caption ? `<p class="cap">${ctx.esc(d.caption)}</p>` : ''}${foot(ctx)}</section>`,

  /** The titled content slide that `chart` and `custom` slides are drawn in. */
  frame: ({ title, eyebrow }, ctx, body) => `<section class="slide framed"><div class="head">${label(eyebrow, ctx)}${title ? `<h2 class="t-l">${ctx.esc(title)}</h2>` : ''}</div>${body}${foot(ctx)}</section>`,

  closing: (d, ctx) => `<section class="slide closing">${d.subtitle ? `<span class="top">${ctx.esc(d.subtitle)}</span>` : ''}
    <h2 class="t-xl" style="font-size:${fit(`${d.title} –`, { width: 1150, max: 156, min: 72, em: 0.6 })}px">${grad(`${d.title} –`, 'sky', ctx)}</h2>
    <footer class="foot"><span>${ctx.esc(d.contact ?? '')}</span><span>${ctx.esc(ctx.deck.presenter ?? '')}</span></footer></section>`,
}
