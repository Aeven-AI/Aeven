/**
 * Eigengrau: near-black blue-grey slides in light IBM Plex Sans set small with wide space, a
 * small uppercase corner label on every slide, dashed hairlines that split the slide into dark
 * and slate panels, pale-blue quotes and pastel bars. Measured from the 16 frames of
 * "Eigengrau" (Figma Community, by Figma), scaled ×1.28 to 1280×720.
 */

/** The title of the section this slide sits in, or the deck title before the first section. */
function sectionName(ctx) {
  for (let i = ctx.index - 2; i >= 0; i--) {
    const slide = ctx.deck.slides[i]
    if (slide.kind === 'section') return slide.title
  }
  return ctx.deck.title ?? ''
}

/** The corner label: small uppercase muted type at the top left. */
const label = (text, ctx, cls = '') => (text ? `<span class="lbl ${cls}">${ctx.esc(text)}</span>` : '')

const vdash = '<i class="vdash" aria-hidden="true"></i>'

/** A user picture filling its slot, or the plain slate panel the source uses for image slots. */
function picture(image, ctx, cls) {
  const src = ctx.image(image)
  return src
    ? `<img class="${cls} pic" src="${ctx.esc(src)}" alt="${ctx.esc(image.alt)}">`
    : `<div class="${cls} pic placeholder" role="img" aria-label="${ctx.esc(image?.alt ?? '')}"></div>`
}

const quoteMark = '<span class="qmark" aria-hidden="true">“</span>'

/** Left half of a split slide: corner label, light title and an optional muted description. */
const leftHalf = (lbl, title, body, ctx) => `<div class="side">${label(lbl, ctx)}<h2 class="t">${ctx.esc(title)}</h2>${body ? `<p class="desc">${ctx.esc(body)}</p>` : ''}</div>`

export function css(system) {
  const { surface, ink, accent, geometry } = system
  return `
:root { --page: ${surface.page}; --panel: ${surface.panel}; --ink: ${ink.primary}; --lav: ${ink.lavender}; --muted: ${ink.muted};
  --q: ${ink.quote}; --qmark: ${ink.quoteMark}; --deep: ${ink.deepBlue}; --blue: ${accent.blue}; --yellow: ${accent.yellow};
  --pink: ${accent.pink}; --mint: ${accent.mint}; --dash: ${geometry.dash}; --m: ${geometry.margin}px; --lt: ${geometry.labelTop}px; --d: ${geometry.dashLength}px; }
.slide { background: var(--page); color: var(--ink); font-size: 20px; line-height: 1.6; font-weight: 400; display: flex; flex-direction: column; padding: 0 var(--m); }
.lbl { position: absolute; left: var(--m); top: var(--lt); font-size: 17px; font-weight: 500; line-height: 1; letter-spacing: .005em; text-transform: uppercase; color: var(--muted); white-space: nowrap; }
.t { font-size: 42px; font-weight: 300; line-height: 55px; letter-spacing: -.004em; color: var(--ink); }
.desc { margin-top: 20px; font-size: 20px; line-height: 32px; color: var(--muted); }
.vdash { position: absolute; top: 0; bottom: 0; left: 50%; width: 1px; background: repeating-linear-gradient(to bottom, var(--dash) 0 var(--d), transparent var(--d) calc(var(--d) * 2)); z-index: 1; }
.hdash { position: absolute; left: 0; right: 0; height: 1px; background: repeating-linear-gradient(to right, var(--dash) 0 var(--d), transparent var(--d) calc(var(--d) * 2)); }

/* Centred single column: cover, statement, text, closing. */
.solo { justify-content: center; }
.solo .t, .solo .desc { max-width: 590px; }
.cover h1, .closing h2 { font-size: 97px; font-weight: 200; line-height: 1.12; letter-spacing: -.012em; color: var(--ink); }
.cover .sub, .closing .sub { margin-top: 2px; max-width: 800px; font-size: 38px; font-weight: 300; line-height: 56px; color: var(--lav); }
.closing .contact { margin-top: 26px; font-size: 20px; color: var(--muted); }
.statement { align-items: center; justify-content: center; text-align: center; }
.statement p { max-width: 1000px; font-size: 36px; font-weight: 300; line-height: 1.45; color: var(--lav); text-wrap: balance; }

/* Two halves split by a dashed hairline. */
.split { padding: 0; display: grid; grid-template-columns: 1fr 1fr; }
.side { position: relative; display: flex; flex-direction: column; justify-content: center; padding: 0 var(--m); min-width: 0; }
.side.slate { background: var(--panel); }
.side.slate .placeholder { position: absolute; inset: 0; }
.pic { width: 100%; height: 100%; object-fit: cover; background: var(--panel); }
.side > .pic { position: absolute; inset: 0; }

.list { list-style: none; display: flex; flex-direction: column; gap: 22px; }
.list li { display: flex; gap: 10px; font-size: 26px; line-height: 1.5; color: var(--ink); }
.list .n { flex: none; min-width: 26px; font-variant-numeric: tabular-nums; }
.list .dash { flex: none; color: var(--muted); }

.rows3 { position: relative; display: grid; grid-template-rows: repeat(var(--n), 1fr); padding: 0; }
.rows3 .row { position: relative; display: flex; flex-direction: column; justify-content: center; gap: 8px; padding: 0 var(--m); }
.rows3 .row + .row::before { content: ""; position: absolute; top: 0; left: 0; right: 0; height: 1px; background: repeating-linear-gradient(to right, var(--dash) 0 var(--d), transparent var(--d) calc(var(--d) * 2)); }
.row b { font-size: 26px; font-weight: 400; line-height: 1.4; }
.row span { font-size: 20px; line-height: 32px; color: var(--muted); }

.metrics { gap: 30px; }
.metric b { display: block; font-size: 60px; font-weight: 700; line-height: 1.1; letter-spacing: -.01em; color: #fff; font-variant-numeric: tabular-nums; }
.metric span { display: block; margin-top: 12px; font-size: 20px; line-height: 1.3; color: var(--muted); }
.bigv { align-items: center; }
.bigv b { font-size: 240px; font-weight: 700; line-height: 1; letter-spacing: -.03em; color: #fff; }

/* Quotes. */
.qmark { display: block; height: 42px; font-family: var(--font); font-size: 64px; font-weight: 700; line-height: 1; color: var(--qmark); }
.qtext { margin-top: 18px; font-size: 31px; line-height: 51px; color: var(--q); }
.qby { margin-top: 18px; font-size: 17px; font-weight: 600; line-height: 1.3; text-transform: uppercase; color: var(--q); }
.quote { justify-content: center; padding-left: 246px; padding-right: 220px; }

/* Before and after panels. */
.duo { padding: 0; display: grid; grid-template-columns: 1fr 1fr; }
.duo .side { justify-content: flex-start; padding-top: 128px; }
.duo .tag { font-size: 17px; font-weight: 500; line-height: 1; text-transform: uppercase; }
.duo .side:nth-of-type(1) .tag { color: var(--blue); }
.duo .side:nth-of-type(2) .tag { color: var(--mint); }
.duo .box { margin-top: 26px; height: 446px; background: var(--panel); padding: 34px 36px; }
.duo .box p { font-size: 30px; font-weight: 300; line-height: 44px; color: var(--lav); }

/* Titled full-width slides. */
.wide { padding-top: 128px; }
.wide .t { max-width: 900px; }
table { margin-top: 44px; width: 100%; border-collapse: collapse; }
th { text-align: left; padding: 0 20px 16px 0; font-size: 17px; font-weight: 500; line-height: 1; text-transform: uppercase; color: var(--muted); }
td { position: relative; padding: 18px 20px 18px 0; font-size: 24px; font-weight: 300; line-height: 1.4; color: var(--ink); font-variant-numeric: tabular-nums; }
td:first-child { color: var(--lav); }
tr td { background: repeating-linear-gradient(to right, var(--dash) 0 var(--d), transparent var(--d) calc(var(--d) * 2)) top left / 100% 1px no-repeat; }

.people { margin-top: 44px; display: grid; grid-template-columns: repeat(var(--n), 1fr); gap: 28px; }
.person .face { display: block; width: 100%; aspect-ratio: 1; height: auto; object-fit: cover; background: var(--panel); }
.person b { display: block; margin-top: 16px; font-size: 22px; font-weight: 400; line-height: 1.3; }
.person span { display: block; margin-top: 2px; font-size: 18px; line-height: 1.4; color: var(--muted); }

/* Timeline as overlapping pastel bars under a full-bleed rule. */
.timeline { padding-top: 128px; }
.tl { position: relative; margin-top: 156px; display: grid; grid-template-columns: repeat(calc(var(--n) + 1), 1fr); column-gap: 10px; row-gap: 14px; }
.tl .rule { position: absolute; left: calc(var(--m) * -1); right: calc(var(--m) * -1); top: 31px; height: 2px; background: var(--dash); }
.tl .when { grid-row: 1; margin-bottom: 31px; font-size: 17px; font-weight: 600; line-height: 1; text-transform: uppercase; color: var(--ink); white-space: nowrap; }
.tl .bar { min-height: 49px; padding: 12px 14px; font-size: 18px; font-weight: 500; line-height: 25px; color: var(--page); }
.tl .bar span { font-weight: 400; opacity: .78; }

/* The titled content slide: a dark header band over a slate panel, as in the source's frames. */
.framed { padding: 0; }
.framed .band { position: relative; flex: none; padding: 104px var(--m) 30px; }
.framed .band .t { font-size: 34px; line-height: 44px; }
.framed .panel { position: relative; flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; background: var(--panel); padding: 36px var(--m) 40px; }
.framed .hdash { top: 0; }

.imagefull { padding: 0; }
.imagefull .band { position: relative; flex: none; height: 122px; }
.imagefull .stage { position: relative; flex: 1 1 auto; }
.imagefull .hdash { top: 0; z-index: 1; }
.imagefull .pic { position: absolute; inset: 0; }

.sectioned { background: var(--panel); justify-content: center; }
.sectioned h2 { font-size: 72px; font-weight: 200; line-height: 1.15; max-width: 900px; }
.sectioned .sub { margin-top: 8px; font-size: 30px; font-weight: 300; line-height: 1.5; color: var(--lav); max-width: 800px; }
`
}

export const slides = {
  cover: (d, ctx) => `<section class="slide solo cover">${label([d.eyebrow, ctx.deck.date].filter(Boolean).join(' · '), ctx)}
    <h1>${ctx.esc(d.title)}</h1>${d.subtitle ? `<p class="sub">${ctx.esc(d.subtitle)}</p>` : ''}</section>`,

  agenda: (d, ctx) => `<section class="slide split">${vdash}${leftHalf('Agenda', d.title, '', ctx)}
    <div class="side"><ol class="list">${d.items.map((item, i) => `<li><span class="n">${i + 1}.</span><span>${ctx.esc(item)}</span></li>`).join('')}</ol></div></section>`,

  section: (d, ctx) => `<section class="slide sectioned">${label(d.number, ctx)}<h2>${ctx.esc(d.title)}</h2>
    ${d.subtitle ? `<p class="sub">${ctx.esc(d.subtitle)}</p>` : ''}</section>`,

  statement: (d, ctx) => `<section class="slide statement">${label(d.attribution, ctx)}<p>${ctx.esc(d.text)}</p></section>`,

  text: (d, ctx) => `<section class="slide solo">${label(d.eyebrow ?? sectionName(ctx), ctx)}<h2 class="t">${ctx.esc(d.title)}</h2>
    <p class="desc">${ctx.esc(d.body)}</p></section>`,

  points: (d, ctx) => `<section class="slide split">${vdash}${leftHalf(sectionName(ctx), d.title, '', ctx)}
    <div class="rows3" style="--n:${d.items.length}">${d.items.map((item) => `<div class="row"><b>${ctx.esc(item.title)}</b><span>${ctx.esc(item.body)}</span></div>`).join('')}</div></section>`,

  'image-text': (d, ctx) => `<section class="slide split">${vdash}${leftHalf(sectionName(ctx), d.title, d.body, ctx)}
    <div class="side slate">${picture(d.image, ctx, 'media')}</div></section>`,

  metrics: (d, ctx) => `<section class="slide split">${vdash}${leftHalf(sectionName(ctx), d.title, '', ctx)}
    <div class="side metrics">${d.items.map((m) => `<div class="metric"><b>${ctx.esc(m.value)}</b><span>${ctx.esc(m.label)}</span></div>`).join('')}</div></section>`,

  'two-column': (d, ctx) => `<section class="slide duo">${vdash}${label(d.title, ctx)}${d.columns.map((c) => `<div class="side"><span class="tag">${ctx.esc(c.title)}</span>
    <div class="box"><p>${ctx.esc(c.body)}</p></div></div>`).join('')}</section>`,

  timeline: (d, ctx) => `<section class="slide timeline">${label(sectionName(ctx), ctx)}<h2 class="t">${ctx.esc(d.title)}</h2>
    <div class="tl" style="--n:${d.steps.length}">${d.steps.map((s, i) => `<span class="when" style="grid-column:${i + 1}">${ctx.esc(s.when)}</span>`).join('')}
    ${d.steps.map((s, i) => `<div class="bar" style="grid-column:${i + 1} / span 2;grid-row:${2 + (i % 2)};background:var(--avn-accent-${(i % ctx.system.palette.accents.length) + 1})">${ctx.esc(s.title)}${s.body ? ` <span>· ${ctx.esc(s.body)}</span>` : ''}</div>`).join('')}
    <i class="rule" aria-hidden="true"></i></div></section>`,

  quote: (d, ctx) => `<section class="slide quote">${label(sectionName(ctx), ctx)}${quoteMark}<p class="qtext">${ctx.esc(d.text)}</p>
    <span class="qby">—${ctx.esc(d.name)}${d.role ? `, ${ctx.esc(d.role)}` : ''}</span></section>`,

  table: (d, ctx) => `<section class="slide wide">${label(sectionName(ctx), ctx)}<h2 class="t">${ctx.esc(d.title)}</h2>
    <table><thead><tr>${d.columns.map((c) => `<th>${ctx.esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${d.rows.map((r) => `<tr>${r.map((c) => `<td>${ctx.esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></section>`,

  'big-number': (d, ctx) => `<section class="slide split">${vdash}${leftHalf(sectionName(ctx), d.label, d.body, ctx)}
    <div class="side bigv"><b>${ctx.esc(d.value)}</b></div></section>`,

  bullets: (d, ctx) => `<section class="slide split">${vdash}${leftHalf(sectionName(ctx), d.title, '', ctx)}
    <div class="side"><ul class="list">${d.items.map((item) => `<li><span class="dash">—</span><span>${ctx.esc(item)}</span></li>`).join('')}</ul></div></section>`,

  team: (d, ctx) => `<section class="slide wide">${label(sectionName(ctx), ctx)}<h2 class="t">${ctx.esc(d.title)}</h2>
    <div class="people" style="--n:${d.people.length}">${d.people.map((p) => {
      const src = p.image && ctx.image(p.image)
      const face = src
        ? `<img class="face" src="${ctx.esc(src)}" alt="${ctx.esc(p.name)}">`
        : `<div class="face" role="img" aria-label="${ctx.esc(p.name)}"></div>`
      return `<div class="person">${face}<b>${ctx.esc(p.name)}</b><span>${ctx.esc(p.role)}</span></div>`
    }).join('')}</div></section>`,

  image: (d, ctx) => `<section class="slide imagefull"><div class="band">${label(d.caption ?? sectionName(ctx), ctx)}</div>
    <div class="stage">${picture(d.image, ctx, 'media')}<i class="hdash" aria-hidden="true"></i></div></section>`,

  /** The titled content slide that `chart` and `custom` slides are drawn in. */
  frame: ({ title, eyebrow }, ctx, body) => `<section class="slide framed"><div class="band">${label(eyebrow ?? sectionName(ctx), ctx)}${title ? `<h2 class="t">${ctx.esc(title)}</h2>` : ''}</div>
    <div class="panel"><i class="hdash" aria-hidden="true"></i>${body}</div></section>`,

  closing: (d, ctx) => `<section class="slide solo closing">${label(ctx.deck.date, ctx)}<h2>${ctx.esc(d.title)}</h2>
    ${d.subtitle ? `<p class="sub">${ctx.esc(d.subtitle)}</p>` : ''}${d.contact ? `<p class="contact">${ctx.esc(d.contact)}</p>` : ''}</section>`,
}
