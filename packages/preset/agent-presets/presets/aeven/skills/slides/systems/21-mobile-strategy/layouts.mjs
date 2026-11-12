/**
 * Mobile Strategy: a product-review deck. Cover, section and closing slides are black in the top
 * left corner and glow into a grainy multicolour gradient (blue and mauve, green and lime, teal
 * and mint, violet and ice blue) under a large light sans title. Content slides are white: a big
 * black title on the left beside a grey paragraph on the right, soft grey cards for pictures,
 * hairline-ruled agenda rows, and a tiny four-column footer (logo square, deck, date, slide label,
 * page number) along the bottom of every slide. Measured from the 16 frames of "Mobile Product
 * Review" (Figma Community, by @natasha).
 */

const pad = (n) => String(n).padStart(2, '0')

/** Display size for a title on a glow slide: long titles step down so they keep to three lines. */
const heroSize = (text, base) => {
  const n = String(text ?? '').length
  return n > 48 ? Math.round(base * 0.62) : n > 28 ? Math.round(base * 0.8) : base
}

/** Content title size: long titles step down so they stay within two lines of the left column. */
const titleSize = (text, base) => {
  const n = String(text ?? '').length
  return n > 44 ? Math.round(base * 0.72) : n > 30 ? Math.round(base * 0.86) : base
}

/** The footer meta row: logo square, deck title, presenter and date, slide label, page number. */
function footer(ctx, label, { number = true } = {}) {
  const { deck } = ctx
  const when = [deck.presenter, deck.date].filter(Boolean).join(' — ')
  return `<footer class="meta"><i class="logo" aria-hidden="true"></i><span class="m1">${ctx.esc(deck.title)}</span>
    <span class="m2">${ctx.esc(when)}</span><span class="m3">${ctx.esc(label ?? '')}</span>${number ? `<span class="m4">${ctx.index}</span>` : ''}</footer>`
}

/** A white content slide with the footer. */
const page = (ctx, { cls = '', label, body }) =>
  `<section class="slide ms ${cls}"><div class="content">${body}</div>${footer(ctx, label)}</section>`

/** A grainy gradient slide (cover, section, closing) in one of the system's glows. */
const glowPage = (ctx, { cls = '', glow, label, body, number = true }) =>
  `<section class="slide ms glow g-${glow} ${cls}"><div class="content">${body}</div>${footer(ctx, label, { number })}</section>`

/** The big black title used on white slides. */
const title = (text, ctx, base) => `<h2 class="title" style="--size:${titleSize(text, base)}px">${ctx.esc(text)}</h2>`

/** The small header of the source's picture slides: black label over a grey line. */
const head = (label, sub, ctx) => `<div class="head">${label ? `<h2 class="label">${ctx.esc(label)}</h2>` : ''}${sub ? `<p class="sub">${ctx.esc(sub)}</p>` : ''}</div>`

/** A user picture, or the source's plain grey card when the slot has none. */
function picture(image, ctx, cls) {
  const src = ctx.image(image)
  return src
    ? `<img class="${cls} pic" src="${ctx.esc(src)}" alt="${ctx.esc(image.alt ?? '')}">`
    : `<div class="${cls} pic card" role="img" aria-label="${ctx.esc(image?.alt ?? '')}"></div>`
}

/** The full-slide placeholder: a phone frame with a checkerboard screen on a grey field. */
const phoneField = (alt, ctx) => `<div class="media pic field" role="img" aria-label="${ctx.esc(alt ?? '')}">
  <div class="phone"><i class="island"></i></div></div>`

const glowCss = (name, g) => `.g-${name} { background: ${[...g.layers, g.base].join(', ')}; }`

export function css(system) {
  const { surface, ink, rule, glows, geometry: g, type: t } = system
  const [c1, c2, c3, c4] = g.footerCols
  const grain = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='260' height='260'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`)}")`
  return `
.ms { --ink: ${ink.primary}; --body: ${ink.body}; --sub: ${ink.sub}; --meta: ${ink.meta}; --meta-muted: ${ink.metaMuted};
  --card: ${surface.card}; --logo: ${surface.logo}; --rule: ${rule}; --m: ${g.margin}px; --r: ${g.radius}px; --gap: ${g.gap}px;
  background: ${surface.page}; color: var(--ink); font-size: ${t.lead}px; line-height: 1.28; letter-spacing: -.005em; }
.ms .content { position: absolute; left: var(--m); right: 68px; top: ${g.top}px; bottom: 102px; display: flex; flex-direction: column; min-height: 0; }

/* footer meta row */
.meta { position: absolute; left: 0; right: 0; top: ${g.footerY}px; height: 23px; font-size: ${t.meta}px; line-height: 23px; letter-spacing: 0; color: var(--meta-muted); white-space: nowrap; }
.meta > * { position: absolute; top: 0; }
.meta .logo { left: ${c1}px; width: 23px; height: 23px; border-radius: 2px; background: var(--logo); }
.meta .m1 { left: ${c2}px; color: var(--meta); font-weight: 500; max-width: 186px; overflow: hidden; text-overflow: ellipsis; }
.meta .m2 { left: ${c3}px; max-width: 206px; overflow: hidden; text-overflow: ellipsis; }
.meta .m3 { left: ${c4}px; max-width: 420px; overflow: hidden; text-overflow: ellipsis; }
.meta .m4 { right: ${g.footerRight}px; }

/* type */
.title { font-size: var(--size, ${t.title}px); font-weight: 400; line-height: 1.08; letter-spacing: -.012em; }
.lead { font-size: ${t.lead}px; line-height: 1.28; color: var(--body); }
.label { font-family: var(--font); font-size: ${t.label - 1}px; font-weight: 500; line-height: 1.25; letter-spacing: -.012em; color: var(--ink); text-wrap: balance; }
.sub { font-size: ${t.label + 1}px; line-height: 1.18; color: var(--body); }
.head { display: flex; flex-direction: column; gap: 4px; padding-top: 12px; max-width: 520px; }
.card { background: var(--card); border-radius: var(--r); }
.pic { display: block; width: 100%; height: 100%; object-fit: cover; border-radius: var(--r); }

/* white split: big title left, grey paragraph right */
.split { display: grid; grid-template-columns: minmax(0, 1fr) 446px; column-gap: 44px; align-items: start; }
.split .lead { margin-top: 9px; }

/* glow slides */
.glow { color: #fff; --meta: rgba(255,255,255,.92); --meta-muted: rgba(255,255,255,.62); --logo: rgba(255,255,255,.26); }
.glow::before { content: ""; position: absolute; inset: 0; background-image: ${grain}; background-size: 260px 260px; opacity: .5; mix-blend-mode: overlay; pointer-events: none; }
.glow > * { z-index: 1; }
${Object.entries(glows).map(([name, glow]) => glowCss(name, glow)).join('\n')}
.hero { font-size: var(--size); font-weight: 500; line-height: 1.02; letter-spacing: 0; max-width: 780px; }
.glow .hero-sub { margin-top: 26px; max-width: 620px; font-size: 26px; line-height: 1.3; color: rgba(255,255,255,.76); }
.glow .hero-note { margin-top: 10px; font-size: ${t.lead}px; color: rgba(255,255,255,.62); }
.section .hero { max-width: 1100px; }

/* agenda: hairline-ruled parts in the right half */
.agenda .content { display: grid; grid-template-columns: minmax(0, 1fr) 607px; column-gap: 40px; align-items: start; }
.parts { list-style: none; display: flex; flex-direction: column; gap: 30px; padding-top: 6px; }
.parts li { display: flex; justify-content: space-between; align-items: baseline; gap: 24px; padding-bottom: 14px; border-bottom: 1px solid var(--rule); font-size: 25px; line-height: 1.2; letter-spacing: -.012em; }
.parts li .part { flex: none; color: #444; }

/* statement and quote */
.statement .big, .quote .big { font-family: var(--display-font); }
.statement .big { font-size: var(--size); font-weight: 400; line-height: 1.1; letter-spacing: -.015em; max-width: 1080px; }
.statement .lead { margin-top: 30px; }
.quote .big { font-size: var(--size); font-weight: 400; line-height: 1.14; letter-spacing: -.012em; max-width: 1060px; }
.quote .by { margin-top: auto; }

/* points: three grey cards under the title */
.cards { margin-top: auto; display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); gap: var(--gap); height: 318px; }
.cards .card { display: flex; flex-direction: column; gap: 6px; padding: 26px 28px; min-width: 0; }
.cards .card .sub { font-size: ${t.lead}px; line-height: 1.25; }

/* image-text: grey picture on the left, label and copy on the right */
.image-text .content { left: 43px; top: 40px; bottom: 135px; display: grid; grid-template-columns: 721px minmax(0, 1fr); column-gap: 68px; }
.image-text .head { padding-top: 22px; gap: 6px; }
.image-text .label { font-size: 25px; }
.image-text .sub { font-size: 26px; line-height: 1.2; }

/* metrics, timeline, two-column: ruled columns along the bottom */
.ruled { margin-top: auto; display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); column-gap: 36px; }
.ruled > div { display: flex; flex-direction: column; min-width: 0; border-top: 1px solid var(--rule); padding-top: 18px; }
.metric b { font-family: var(--display-font); font-size: 80px; font-weight: 400; line-height: 1; letter-spacing: -.02em; font-variant-numeric: tabular-nums; white-space: nowrap; }
.metric span { margin-top: 12px; font-size: 20px; line-height: 1.25; color: var(--body); }
.step .when { font-size: 18px; line-height: 1.2; color: var(--body); }
.step .label { margin-top: 30px; }
.step .note { margin-top: 6px; font-size: 20px; line-height: 1.25; color: var(--body); }
.cols2 { column-gap: 44px; }
.cols2 .label { font-size: 25px; }
.cols2 .sub { margin-top: 8px; font-size: 25px; line-height: 1.24; }


/* table: small and tidy, ruled like the agenda */
.table table { margin-top: auto; margin-bottom: 18px; width: 100%; border-collapse: collapse; font-size: 22px; line-height: 1.25; letter-spacing: -.01em; }
.table th { text-align: left; font-size: 17px; font-weight: 400; color: var(--sub); padding: 0 16px 14px 0; border-bottom: 1px solid var(--rule); }
.table td { padding: 17px 16px 17px 0; border-bottom: 1px solid #E4E4E4; color: var(--sub); font-variant-numeric: tabular-nums; }
.table td:first-child { color: var(--ink); font-weight: 500; }

/* big number */
.big-number .value { font-family: var(--display-font); font-size: var(--size); font-weight: 400; line-height: .9; letter-spacing: -.035em; white-space: nowrap; }
.big-number .lead { margin-top: 8px; }
.big-number .label { margin-top: 9px; font-size: 25px; }

/* bullets: numbered, ruled rows in the right column */
.rows { list-style: none; display: flex; flex-direction: column; gap: 24px; padding-top: 6px; }
.rows li { display: flex; justify-content: space-between; align-items: baseline; gap: 24px; padding-bottom: 14px; border-bottom: 1px solid var(--rule); font-size: 23px; line-height: 1.25; letter-spacing: -.01em; }
.rows li .n { flex: none; font-size: 17px; color: var(--sub); font-variant-numeric: tabular-nums; }
.bullets .content { display: grid; grid-template-columns: minmax(0, 1fr) 607px; column-gap: 40px; align-items: start; }

/* team */
.people { margin-top: auto; display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); gap: var(--gap); }
.person { display: flex; flex-direction: column; min-width: 0; }
.person .pic { height: 250px; }
.person .label { margin-top: 16px; font-size: 21px; }
.person .sub { margin-top: 2px; font-size: 19px; }

/* full image */
.full .content { inset: 0; }
.full .media { border-radius: 0; }
.field { position: relative; background: #F4F4F4; display: grid; place-items: center; }
.phone { position: relative; width: 252px; height: 520px; border: 9px solid #222; border-radius: 46px; background-color: #FAFAFA; background-image: conic-gradient(#E9E9E9 25%, transparent 0 50%, #E9E9E9 0 75%, transparent 0); background-size: 48px 48px; background-position: 0 0; box-shadow: 0 0 0 2px #4A4A4A; }
.phone .island { position: absolute; left: 50%; top: 12px; width: 76px; height: 22px; margin-left: -38px; border-radius: 11px; background: #111; }
.full .cap { position: absolute; left: 43px; bottom: 38px; max-width: 900px; padding: 8px 14px; border-radius: 6px; background: #fff; font-size: 17px; line-height: 1.3; color: var(--ink); }

/* frame: the source's small header over a filled content area */
.framed .avn-body { margin-top: 34px; }
`
}

export const slides = {
  cover: (d, ctx) => glowPage(ctx, { cls: 'cover', glow: 'cover', label: d.eyebrow, number: false, body: `
    <h1 class="hero" style="--size:${heroSize(d.title, ctx.system.type.hero)}px">${ctx.esc(d.title)}</h1>
    ${d.subtitle ? `<p class="hero-sub">${ctx.esc(d.subtitle)}</p>` : ''}` }),

  agenda: (d, ctx) => page(ctx, { cls: 'agenda', label: d.title, body: `${title(d.title, ctx, ctx.system.type.title)}
    <ol class="parts">${d.items.map((item, i) => `<li><span>${ctx.esc(item)}</span><span class="part">Part ${i + 1}</span></li>`).join('')}</ol>` }),

  section: (d, ctx) => {
    const glows = ctx.system.sectionGlows
    const n = Number.parseInt(d.number, 10)
    const glow = glows[((Number.isFinite(n) ? n : 1) - 1 + glows.length) % glows.length]
    return glowPage(ctx, { cls: 'section', glow, label: `Part ${Number.isFinite(n) ? n : d.number}`, body: `
      <h2 class="hero" style="--size:${heroSize(d.title, ctx.system.type.section)}px">${ctx.esc(d.title)}</h2>
      ${d.subtitle ? `<p class="hero-sub">${ctx.esc(d.subtitle)}</p>` : ''}` })
  },

  statement: (d, ctx) => page(ctx, { cls: 'statement', label: d.attribution, body: `
    <p class="big" style="--size:${String(d.text).length > 110 ? 44 : 56}px">${ctx.esc(d.text)}</p>
    ${d.attribution ? `<p class="lead">${ctx.esc(d.attribution)}</p>` : ''}` }),

  text: (d, ctx) => page(ctx, { cls: 'split-page', label: d.eyebrow ?? d.title, body: `<div class="split">
    ${title(d.title, ctx, ctx.system.type.title)}<p class="lead">${ctx.esc(d.body)}</p></div>` }),

  points: (d, ctx) => page(ctx, { cls: 'points', label: d.title, body: `${title(d.title, ctx, ctx.system.type.title)}
    <div class="cards" style="--n:${d.items.length}">${d.items.map((item) => `<div class="card"><h3 class="label">${ctx.esc(item.title)}</h3><p class="sub">${ctx.esc(item.body)}</p></div>`).join('')}</div>` }),

  'image-text': (d, ctx) => page(ctx, { cls: 'image-text', label: d.title, body: `${picture(d.image, ctx, 'media')}
    ${head(d.title, d.body, ctx)}` }),

  metrics: (d, ctx) => page(ctx, { cls: 'metrics', label: d.title, body: `${title(d.title, ctx, ctx.system.type.title)}
    <div class="ruled" style="--n:${d.items.length}">${d.items.map((m) => `<div class="metric"><b>${ctx.esc(m.value)}</b><span>${ctx.esc(m.label)}</span></div>`).join('')}</div>` }),

  'two-column': (d, ctx) => page(ctx, { cls: 'two-column', label: d.title, body: `${title(d.title, ctx, ctx.system.type.title)}
    <div class="ruled cols2" style="--n:${d.columns.length}">${d.columns.map((c) => `<div><h3 class="label">${ctx.esc(c.title)}</h3><p class="sub">${ctx.esc(c.body)}</p></div>`).join('')}</div>` }),

  timeline: (d, ctx) => page(ctx, { cls: 'timeline', label: d.title, body: `${title(d.title, ctx, ctx.system.type.title)}
    <div class="ruled" style="--n:${d.steps.length}">${d.steps.map((s) => `<div class="step"><span class="when">${ctx.esc(s.when)}</span><h3 class="label">${ctx.esc(s.title)}</h3>${s.body ? `<p class="note">${ctx.esc(s.body)}</p>` : ''}</div>`).join('')}</div>` }),

  quote: (d, ctx) => page(ctx, { cls: 'quote', label: d.name, body: `
    <p class="big" style="--size:${String(d.text).length > 120 ? 40 : 50}px">“${ctx.esc(d.text)}”</p>
    <div class="by">${head(d.name, d.role, ctx)}</div>` }),

  table: (d, ctx) => page(ctx, { cls: 'table', label: d.title, body: `${title(d.title, ctx, ctx.system.type.title)}
    <table><thead><tr>${d.columns.map((c) => `<th>${ctx.esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${d.rows.map((r) => `<tr>${r.map((c) => `<td>${ctx.esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>` }),

  'big-number': (d, ctx) => page(ctx, { cls: 'big-number', label: d.label, body: `<div class="split">
    <b class="value" style="--size:${String(d.value).length > 4 ? 170 : 260}px">${ctx.esc(d.value)}</b>
    <div><h2 class="label">${ctx.esc(d.label)}</h2>${d.body ? `<p class="lead">${ctx.esc(d.body)}</p>` : ''}</div></div>` }),

  bullets: (d, ctx) => page(ctx, { cls: 'bullets', label: d.title, body: `${title(d.title, ctx, ctx.system.type.title)}
    <ol class="rows">${d.items.map((item, i) => `<li><span>${ctx.esc(item)}</span><span class="n">${pad(i + 1)}</span></li>`).join('')}</ol>` }),

  team: (d, ctx) => page(ctx, { cls: 'team', label: d.title, body: `${title(d.title, ctx, ctx.system.type.title)}
    <div class="people" style="--n:${d.people.length}">${d.people.map((p) => `<div class="person">${picture(p.image ?? { alt: p.name }, ctx, 'face')}
      <h3 class="label">${ctx.esc(p.name)}</h3><p class="sub">${ctx.esc(p.role)}</p></div>`).join('')}</div>` }),

  image: (d, ctx) => {
    const src = ctx.image(d.image)
    const media = src ? `<img class="media pic" src="${ctx.esc(src)}" alt="${ctx.esc(d.image.alt ?? '')}">` : phoneField(d.image?.alt, ctx)
    return `<section class="slide ms full"><div class="content">${media}</div>${d.caption ? `<p class="cap">${ctx.esc(d.caption)}</p>` : ''}</section>`
  },

  /** The titled content slide that `chart` and `custom` slides are drawn in: the small black label over a grey line. */
  frame: ({ title: t, eyebrow }, ctx, body) => page(ctx, { cls: 'framed', label: t ?? eyebrow, body: `${head(t, eyebrow, ctx)}${body}` }),

  closing: (d, ctx) => glowPage(ctx, { cls: 'closing', glow: 'violet', label: d.contact ?? d.subtitle, body: `
    <h2 class="hero" style="--size:${heroSize(d.title, ctx.system.type.hero)}px">${ctx.esc(d.title)}</h2>
    ${d.subtitle ? `<p class="hero-sub">${ctx.esc(d.subtitle)}</p>` : ''}${d.contact ? `<p class="hero-note">${ctx.esc(d.contact)}</p>` : ''}` }),
}
