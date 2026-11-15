/**
 * UX Showcase: an electric-blue cover with a column of pale rounded shapes (circle, triangle,
 * square) on the right edge, near-white case-study slides with a bold blue heading over an
 * optional black title, a black footer bar carrying the circle-triangle-square mark and the deck
 * name, progress rings for numbers, a pale bar track for process steps, a three-circle diagram,
 * outlined feature pills, a blue half-panel for paired columns and phone mock-ups as the
 * picture placeholder. Measured from the 16 frames of "Finessing UI/UX Design Presentation
 * Template 2.0" by bright (Figma Community).
 */

/** Rounded triangle points: a polygon drawn with a thick round-joined stroke of its own fill. */
const tri = (cx, top, w, h, fill, round) =>
  `<polygon points="${cx},${top} ${cx - w / 2},${top + h} ${cx + w / 2},${top + h}" fill="${fill}" stroke="${fill}" stroke-width="${round}" stroke-linejoin="round"/>`

/** The circle, triangle and square brand mark, in `currentColor` or one colour per shape. */
const mark = (colors = ['currentColor', 'currentColor', 'currentColor']) =>
  `<svg class="mark" viewBox="0 0 72 22" aria-hidden="true"><circle cx="10" cy="11" r="10" fill="${colors[0]}"/>${tri(35, 3.5, 17, 15, colors[1], 4)}<rect x="50" y="1.5" width="19" height="19" rx="2" fill="${colors[2]}"/></svg>`

/** The column of large pale shapes along the right edge of blue slides. */
const column = () => `<svg class="column" viewBox="0 0 160 720" aria-hidden="true">
  <circle cx="80" cy="-3" r="64"/>${tri(80, 128, 104, 86, 'currentColor', 18)}
  <rect x="21" y="301" width="118" height="118" rx="10"/><circle cx="80" cy="540" r="64"/>${tri(80, 656, 104, 86, 'currentColor', 18)}</svg>`

/** The black footer bar: the white mark on the left, the deck name on the right. */
const footer = (ctx) => `<footer class="bar">${mark()}<span>${ctx.esc(ctx.deck.title)}</span></footer>`

/** A light content slide: `main` above the footer bar. */
const page = (cls, ctx, main) => `<section class="slide page ${cls}"><div class="main">${main}</div>${footer(ctx)}</section>`

/** The heading block: a blue eyebrow over a black title, or the title alone in blue. */
const head = (title, eyebrow, ctx) => `<div class="head">${eyebrow
  ? `<span class="heading">${ctx.esc(eyebrow)}</span>${title ? `<h2 class="title">${ctx.esc(title)}</h2>` : ''}`
  : title ? `<h2 class="heading">${ctx.esc(title)}</h2>` : ''}</div>`

/** The pale-cyan picture placeholder with its outlined picture icon. */
const placeholder = (cls, alt, ctx) => `<div class="${cls} ph" role="img" aria-label="${ctx.esc(alt ?? '')}">
  <svg class="ph-icon" viewBox="0 0 100 95" aria-hidden="true"><rect x="3" y="3" width="94" height="89" rx="6" fill="none" stroke="#fff" stroke-width="5"/>
  <circle cx="36" cy="33" r="9" fill="#fff"/><path d="M9 89 L33 52 L50 76 L68 44 L93 89 Z" fill="#fff"/></svg></div>`

/** A user picture, or the placeholder when the slot has none. */
function picture(image, ctx, cls) {
  const src = ctx.image(image)
  return src ? `<img class="${cls}" src="${ctx.esc(src)}" alt="${ctx.esc(image.alt)}">` : placeholder(cls, image?.alt, ctx)
}

/**
 * A field of tilted phone mock-ups, the source's screen placeholder without its labels, drawn as
 * one SVG so print rasterises it whole; it covers a box up to 1054×476.
 */
const phones = () => {
  const cells = [0, -210, 60, -160, 100, -120, 20].flatMap((offset, i) => [0, 1, 2, 3].map((j) => {
    const x = i * 241
    const y = offset + j * 450
    return `<rect x="${x}" y="${y}" width="205" height="410" rx="30" fill="var(--bezel)"/><rect x="${x + 10}" y="${y + 10}" width="185" height="390" rx="21" fill="var(--screen)"/>`
  }))
  return `<svg class="phones" viewBox="0 0 1054 476" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><g transform="rotate(-16 527 238) translate(-298 -692)">${cells.join('')}</g></svg>`
}

/**
 * A progress ring around a value: a percentage draws its share of the ring, any other value a
 * full ring.
 */
function ring(value, ctx, cls = '') {
  const pct = /^\s*(\d+(?:\.\d+)?)\s*%\s*$/.exec(String(value))
  const share = pct ? Math.min(100, Number(pct[1])) : 100
  return `<div class="ring ${cls}"><svg viewBox="0 0 200 200" aria-hidden="true"><circle class="track" cx="100" cy="100" r="92"/>
    <circle class="arc" cx="100" cy="100" r="92" pathLength="100" stroke-dasharray="${share} 100" transform="rotate(-90 100 100)"/></svg>
    <b>${ctx.esc(value)}</b></div>`
}

const initials = (name) => name.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase()

export function css(system) {
  const { surface: s, ink, accent: a, geometry: g } = system
  return `
:root { --paper: ${s.paper}; --blue: ${s.blue}; --shape: ${s.shape}; --foot: ${s.footer}; --pale: ${s.pale}; --track: ${s.track};
  --ph: ${s.placeholder}; --screen: ${s.screen}; --bezel: ${s.bezel}; --ink: ${ink.primary}; --body: ${ink.body}; --subtle: ${ink.subtle};
  --muted: ${ink.muted}; --rule: ${system.palette.rule}; --sky: ${a.sky}; --mustard: ${a.mustard}; --pink: ${a.pink}; --green: ${a.green};
  --mx: ${g.marginX}px; --top: ${g.top}px; --foot-h: ${g.footer}px; --r: ${g.radius}px; }
.slide { background: var(--paper); color: var(--ink); font-size: 23px; line-height: 1.5; }
.page { display: flex; flex-direction: column; }
.main { position: relative; flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; padding: var(--top) var(--mx) 40px; }
.bar { flex: none; height: var(--foot-h); background: var(--foot); color: #fff; display: flex; align-items: center; justify-content: space-between; padding: 0 44px 0 42px; font-size: 16px; }
.mark { display: block; width: 72px; height: 22px; }

.head { flex: none; display: flex; flex-direction: column; }
.heading { display: block; font-size: 32px; font-weight: 700; line-height: 1.25; color: var(--blue); letter-spacing: -.005em; }
.title { margin-top: 22px; font-size: 38px; font-weight: 600; line-height: 1.2; color: var(--ink); letter-spacing: -.01em; }
.lead { font-size: 23px; line-height: 1.55; color: var(--body); }
.small { font-size: 17px; line-height: 1.6; color: var(--subtle); }

/* Blue slides: cover, section, closing. */
.blue { background: var(--blue); color: #fff; }
.column { position: absolute; left: 1027px; top: 0; width: 160px; height: 720px; fill: var(--shape); color: var(--shape); }
.hero { position: relative; display: flex; flex-direction: column; padding: 228px var(--mx) 0; max-width: 900px; }
.eyebrow { font-size: 20px; line-height: 1.2; text-transform: uppercase; letter-spacing: .01em; }
.hero h1, .hero h2 { margin-top: 34px; font-size: 60px; font-weight: 700; line-height: 1.28; letter-spacing: -.012em; }
.hero .sub { margin-top: 18px; font-size: 22px; line-height: 1.5; color: rgba(255,255,255,.86); max-width: 680px; }
.byline { position: absolute; left: var(--mx); bottom: 86px; display: flex; flex-direction: column; gap: 10px; }
.byline b { font-size: 28px; font-weight: 700; line-height: 1.2; }
.byline span { font-size: 15px; line-height: 1.2; }
.section { display: flex; flex-direction: column; justify-content: center; padding: 0 var(--mx); }
.section .num { font-size: 28px; font-weight: 600; line-height: 1.2; }
.section h2 { margin-top: 40px; font-size: 60px; font-weight: 700; line-height: 1.22; letter-spacing: -.012em; max-width: 860px; }
.section .sub { margin-top: 22px; font-size: 23px; line-height: 1.5; color: rgba(255,255,255,.86); max-width: 720px; }
.section .mark, .split-blue .mark { position: absolute; left: var(--mx); bottom: 30px; color: #fff; }

/* Agenda: numbered rows on hairlines. */
.agenda ol { list-style: none; margin-top: 10px; width: 770px; }
.agenda li { display: flex; align-items: center; height: 88px; border-top: 1px solid var(--rule); font-size: 40px; font-weight: 500; letter-spacing: -.01em; }
.agenda li:first-child { border-top: 0; }
.agenda li .n { flex: none; width: 64px; text-align: center; color: var(--blue); margin-right: 13px; }

/* Statement: centred line under the coloured mark. */
.statement .main { align-items: center; justify-content: center; text-align: center; gap: 34px; }
.statement .mark { width: 96px; height: 29px; }
.statement p { font-size: 46px; font-weight: 600; line-height: 1.28; letter-spacing: -.015em; max-width: 1000px; text-wrap: balance; }
.statement .by { font-size: 23px; font-weight: 700; color: var(--blue); }

/* Text. */
.text .body { margin-top: 24px; max-width: 770px; }

/* Points: three methods beside a three-circle diagram. */
.points .main { display: grid; grid-template-columns: 470px 1fr; grid-template-rows: auto 1fr; column-gap: 40px; }
.points .head { grid-column: 1 / 3; }
.points .items { align-self: center; display: flex; flex-direction: column; gap: 30px; }
.points h3 { font-size: 28px; font-weight: 600; line-height: 1.3; }
.points .small { margin-top: 8px; }
.venn { position: relative; align-self: center; width: 560px; height: 400px; justify-self: end; }
.venn svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.venn circle { fill: none; stroke-width: 2.5; }
.venn span { position: absolute; font-size: 24px; font-weight: 500; line-height: 1.25; white-space: nowrap; }

/* Image and text. */
.image-text .main { display: grid; grid-template-columns: 460px 472px; justify-content: space-between; padding-right: 113px; }
.image-text .copy { display: flex; flex-direction: column; }
.image-text .copy .lead { margin-top: 26px; }
.image-text .media { width: 472px; height: 496px; border-radius: var(--r); object-fit: cover; }
.ph { background: var(--ph); display: grid; place-items: center; }
.ph-icon { width: 100px; height: 95px; }

/* Metrics: progress rings. */
.metrics .rings { flex: 1; display: grid; grid-template-columns: repeat(var(--n), 1fr); align-items: center; }
.metric { display: flex; flex-direction: column; align-items: center; gap: 26px; }
.ring { position: relative; width: 212px; height: 212px; display: grid; place-items: center; }
.ring svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.ring circle { fill: none; stroke-width: 12; }
.ring .track { stroke: var(--track); }
.ring .arc { stroke: var(--blue); stroke-linecap: round; }
.ring b { position: relative; font-size: 54px; font-weight: 700; line-height: 1; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.metric > span { font-size: 23px; line-height: 1.3; color: var(--body); text-align: center; max-width: 230px; }

/* Two columns: the blue half-panel with the title, two blocks on paper. */
.split-blue { display: grid; grid-template-columns: 584px 1fr; }
.split-blue .panel { position: relative; background: var(--blue); color: #fff; padding: 212px var(--mx) 0; }
.split-blue .panel h2 { font-size: 60px; font-weight: 700; line-height: 1.24; letter-spacing: -.012em; }
.split-blue .cols { display: flex; flex-direction: column; justify-content: center; gap: 44px; padding: 0 110px 40px 112px; }
.split-blue h3 { font-size: 26px; font-weight: 600; line-height: 1.3; }
.split-blue .lead { margin-top: 12px; }

/* Timeline: a pale bar track, the first step in blue with its bracket. */
.timeline .track-row { flex: 1; display: grid; grid-template-columns: repeat(var(--n), 1fr); column-gap: 19px; align-content: center; padding: 0 20px; }
.step { display: flex; flex-direction: column; align-items: center; text-align: center; }
.step .when { font-size: 17px; font-weight: 700; line-height: 1.2; color: var(--blue); letter-spacing: .02em; }
.step .name { margin-top: 8px; height: 34px; font-size: 23px; font-weight: 500; line-height: 34px; color: var(--body); }
.step .rail { margin-top: 16px; width: 100%; height: 28px; border-radius: 4px; background: var(--pale); }
.step .brace { margin-top: 12px; width: calc(100% - 12px); height: 20px; border: 2px solid var(--rule); border-top: 0; border-radius: 0 0 10px 10px; }
.step .stem { width: 2px; height: 52px; background: var(--rule); }
.step .what { margin-top: 18px; font-size: 21px; line-height: 1.4; color: var(--body); max-width: 220px; }
.step.now .name { font-size: 26px; font-weight: 600; color: var(--ink); }
.step.now .rail { background: var(--blue); }
.step.now .brace { border-color: var(--blue); }
.step.now .stem { background: var(--blue); }

/* Quote. */
.quote .main { justify-content: center; }
.quote .qmark { font-size: 150px; font-weight: 700; line-height: .7; height: 70px; color: var(--blue); }
.quote blockquote { margin-top: 26px; max-width: 960px; font-size: 38px; font-weight: 500; line-height: 1.38; letter-spacing: -.01em; text-wrap: pretty; }
.quote .who { margin-top: 38px; display: flex; flex-direction: column; gap: 4px; }
.quote .who b { font-size: 23px; font-weight: 700; line-height: 1.3; }
.quote .who span { font-size: 18px; line-height: 1.4; color: var(--muted); }

/* Table. */
.table table { margin-top: 44px; width: 100%; border-collapse: collapse; font-size: 22px; line-height: 1.3; }
.table th { text-align: left; font-size: 20px; font-weight: 700; color: var(--blue); background: var(--pale); padding: 16px 20px; }
.table th:first-child { border-radius: 10px 0 0 10px; } .table th:last-child { border-radius: 0 10px 10px 0; }
.table td { padding: 20px; border-bottom: 1px solid var(--rule); color: var(--body); font-variant-numeric: tabular-nums; }
.table td:first-child { color: var(--ink); font-weight: 600; }

/* Big number: words left, one large ring right. */
.big .main { display: grid; grid-template-columns: 1fr auto; align-items: center; column-gap: 60px; padding-right: 130px; }
.big .copy { display: flex; flex-direction: column; }
.big .copy .title { margin-top: 0; font-size: 48px; line-height: 1.18; }
.big .copy .lead { margin-top: 24px; max-width: 520px; }
.ring.huge { width: 400px; height: 400px; }
.ring.huge circle { stroke-width: 7; }
.ring.huge b { font-size: 150px; letter-spacing: -.04em; }

/* Bullets: outlined pills, centred. */
.bullets .head { align-items: center; text-align: center; }
.pills { flex: 1; list-style: none; display: flex; flex-wrap: wrap; justify-content: center; align-content: center; gap: 22px 26px; padding: 0 40px 20px; }
.pills li { display: flex; align-items: center; justify-content: center; min-width: 264px; height: 68px; padding: 0 44px; border: 1.5px solid var(--ink); border-radius: 999px; font-size: 23px; line-height: 1.2; color: var(--body); white-space: nowrap; }

/* Team. */
.team .people { flex: 1; display: grid; grid-template-columns: repeat(var(--n), 220px); justify-content: space-between; align-content: center; padding: 0 10px; }
.person { display: flex; flex-direction: column; }
.avatar { width: 220px; height: 220px; border-radius: var(--r); object-fit: cover; }
.avatar.ph { background: var(--ph); }
.avatar .ini { font-size: 64px; font-weight: 700; color: var(--blue); letter-spacing: -.02em; }
.person b { margin-top: 20px; font-size: 24px; font-weight: 600; line-height: 1.3; }
.person span { margin-top: 4px; font-size: 18px; line-height: 1.4; color: var(--muted); }

/* Full picture: the rounded frame under the caption heading; no footer bar. */
.picture { display: flex; flex-direction: column; padding: var(--top) var(--mx) 70px; }
.picture .frame { position: relative; flex: 1; margin-top: 36px; border-radius: var(--r); overflow: hidden; clip-path: inset(0 round var(--r)); }
.picture .frame.solo { margin-top: 0; }
.picture .frame img { width: 100%; height: 100%; object-fit: cover; }
.phones { position: absolute; inset: 0; width: 100%; height: 100%; display: block; background: var(--paper); }

/* Framed content (chart, custom). */
.framed .avn-body { margin-top: 30px; }
`
}

export const slides = {
  cover: (d, ctx) => `<section class="slide blue cover">${column()}<div class="hero">
    ${d.eyebrow ? `<span class="eyebrow">${ctx.esc(d.eyebrow)}</span>` : ''}<h1>${ctx.esc(d.title)}</h1>
    ${d.subtitle ? `<p class="sub">${ctx.esc(d.subtitle)}</p>` : ''}</div>
    ${ctx.deck.presenter || ctx.deck.date ? `<div class="byline">${ctx.deck.presenter ? `<b>${ctx.esc(ctx.deck.presenter)}</b>` : ''}${ctx.deck.date ? `<span>${ctx.esc(ctx.deck.date)}</span>` : ''}</div>` : ''}</section>`,

  agenda: (d, ctx) => page('agenda', ctx, `${head(d.title, '', ctx)}
    <ol>${d.items.map((item, i) => `<li><span class="n">${i + 1}</span><span>${ctx.esc(item)}</span></li>`).join('')}</ol>`),

  section: (d, ctx) => `<section class="slide blue section"><span class="num">${ctx.esc(d.number)}</span><h2>${ctx.esc(d.title)}</h2>
    ${d.subtitle ? `<p class="sub">${ctx.esc(d.subtitle)}</p>` : ''}${mark()}</section>`,

  statement: (d, ctx) => page('statement', ctx, `${mark(['var(--sky)', 'var(--blue)', 'var(--mustard)'])}<p>${ctx.esc(d.text)}</p>
    ${d.attribution ? `<span class="by">${ctx.esc(d.attribution)}</span>` : ''}`),

  text: (d, ctx) => page('text', ctx, `${head(d.title, d.eyebrow, ctx)}<p class="lead body">${ctx.esc(d.body)}</p>`),

  points: (d, ctx) => {
    const [a, b, c] = d.items
    return page('points', ctx, `${head(d.title, '', ctx)}
    <div class="items">${d.items.map((item) => `<div><h3>${ctx.esc(item.title)}</h3><p class="small">${ctx.esc(item.body)}</p></div>`).join('')}</div>
    <div class="venn"><svg viewBox="0 0 560 400" aria-hidden="true"><circle cx="218" cy="140" r="118" stroke="var(--mustard)"/>
      <circle cx="345" cy="140" r="118" stroke="var(--green)"/><circle cx="281" cy="262" r="118" stroke="var(--pink)"/></svg>
      ${a ? `<span style="right:378px;top:118px">${ctx.esc(a.title)}</span>` : ''}${b ? `<span style="left:372px;top:94px">${ctx.esc(b.title)}</span>` : ''}
      ${c ? `<span style="right:302px;top:310px">${ctx.esc(c.title)}</span>` : ''}</div>`)
  },

  'image-text': (d, ctx) => page('image-text', ctx, `<div class="copy">${head(d.title, '', ctx)}<p class="lead">${ctx.esc(d.body)}</p></div>
    ${picture(d.image, ctx, 'media')}`),

  metrics: (d, ctx) => page('metrics', ctx, `${head(d.title, '', ctx)}
    <div class="rings" style="--n:${d.items.length}">${d.items.map((m) => `<div class="metric">${ring(m.value, ctx)}<span>${ctx.esc(m.label)}</span></div>`).join('')}</div>`),

  'two-column': (d, ctx) => `<section class="slide split-blue"><div class="panel"><h2>${ctx.esc(d.title)}</h2>${mark()}</div>
    <div class="cols">${d.columns.map((c) => `<div><h3>${ctx.esc(c.title)}</h3><p class="lead">${ctx.esc(c.body)}</p></div>`).join('')}</div></section>`,

  timeline: (d, ctx) => page('timeline', ctx, `${head(d.title, '', ctx)}
    <div class="track-row" style="--n:${d.steps.length}">${d.steps.map((s, i) => `<div class="step${i === 0 ? ' now' : ''}">
      <span class="when">${ctx.esc(s.when)}</span><span class="name">${ctx.esc(s.title)}</span><i class="rail"></i><i class="brace"></i><i class="stem"></i>
      ${s.body ? `<p class="what">${ctx.esc(s.body)}</p>` : ''}</div>`).join('')}</div>`),

  quote: (d, ctx) => page('quote', ctx, `<span class="qmark" aria-hidden="true">“</span><blockquote>${ctx.esc(d.text)}</blockquote>
    <div class="who"><b>${ctx.esc(d.name)}</b>${d.role ? `<span>${ctx.esc(d.role)}</span>` : ''}</div>`),

  table: (d, ctx) => page('table', ctx, `${head(d.title, '', ctx)}
    <table><thead><tr>${d.columns.map((c) => `<th>${ctx.esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${d.rows.map((r) => `<tr>${r.map((c) => `<td>${ctx.esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`),

  'big-number': (d, ctx) => page('big', ctx, `<div class="copy"><h2 class="title">${ctx.esc(d.label)}</h2>${d.body ? `<p class="lead">${ctx.esc(d.body)}</p>` : ''}</div>
    ${ring(d.value, ctx, 'huge')}`),

  bullets: (d, ctx) => page('bullets', ctx, `${head(d.title, '', ctx)}<ul class="pills">${d.items.map((item) => `<li>${ctx.esc(item)}</li>`).join('')}</ul>`),

  team: (d, ctx) => page('team', ctx, `${head(d.title, '', ctx)}
    <div class="people" style="--n:${d.people.length}">${d.people.map((p) => {
      const src = p.image && ctx.image(p.image)
      const face = src
        ? `<img class="avatar" src="${ctx.esc(src)}" alt="${ctx.esc(p.name)}">`
        : `<div class="avatar ph" role="img" aria-label="${ctx.esc(p.name)}"><span class="ini">${ctx.esc(initials(p.name))}</span></div>`
      return `<div class="person">${face}<b>${ctx.esc(p.name)}</b><span>${ctx.esc(p.role)}</span></div>`
    }).join('')}</div>`),

  image: (d, ctx) => {
    const src = ctx.image(d.image)
    const inner = src ? `<img src="${ctx.esc(src)}" alt="${ctx.esc(d.image.alt)}">` : phones()
    return `<section class="slide picture">${d.caption ? `<h2 class="heading">${ctx.esc(d.caption)}</h2>` : ''}
      <div class="frame${d.caption ? '' : ' solo'}" role="img" aria-label="${ctx.esc(d.image.alt ?? '')}">${inner}</div></section>`
  },

  /** The titled content slide that `chart` and `custom` slides are drawn in. */
  frame: ({ title, eyebrow }, ctx, body) => page('framed', ctx, `${head(title, eyebrow, ctx)}${body}`),

  closing: (d, ctx) => `<section class="slide blue closing">${column()}<div class="hero">
    <h2>${ctx.esc(d.title)}</h2>${d.subtitle ? `<p class="sub">${ctx.esc(d.subtitle)}</p>` : ''}</div>
    ${d.contact ? `<div class="byline"><b>${ctx.esc(d.contact)}</b></div>` : ''}</section>`,
}
