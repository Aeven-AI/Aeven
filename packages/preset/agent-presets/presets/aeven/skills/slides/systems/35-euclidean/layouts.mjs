/**
 * Euclidean: warm cream slides with a quiet Source Serif set in sentence case, small bold
 * uppercase Source Sans labels in the top-left corner, brick-red quotes and a short red
 * underline, and thin warm-grey hairlines that split slides into a cream half and a paler
 * panel. Measured from the 16 frames of "Euclidean" (Figma Community, by Figma), scaled ×1.28
 * to 1280×720.
 */

/** The title of the section this slide sits in, or the deck title before the first section. */
function sectionName(ctx) {
  for (let i = ctx.index - 2; i >= 0; i--) {
    const slide = ctx.deck.slides[i]
    if (slide.kind === 'section') return slide.title
  }
  return ctx.deck.title ?? ''
}

/** The corner label: small bold uppercase muted type at the top left. */
const label = (text, ctx, cls = '') => (text ? `<span class="lbl ${cls}">${ctx.esc(text)}</span>` : '')

const vrule = '<i class="vrule" aria-hidden="true"></i>'
const underline = '<i class="uline" aria-hidden="true"></i>'

/** A user picture filling its slot, or the plain pale panel the source uses for image slots. */
function picture(image, ctx, cls) {
  const src = ctx.image(image)
  return src
    ? `<img class="${cls} pic" src="${ctx.esc(src)}" alt="${ctx.esc(image.alt)}">`
    : `<div class="${cls} pic placeholder" role="img" aria-label="${ctx.esc(image?.alt ?? '')}"></div>`
}

/** A quote block: tinted mark, serif quote text and an uppercase attribution, in red or blue. */
const quoteBlock = (text, by, ctx, tone = 'red') => `<figure class="q ${tone}"><span class="qmark" aria-hidden="true">“</span>
  <blockquote>${ctx.esc(text)}</blockquote><figcaption>— ${ctx.esc(by)}</figcaption></figure>`

/** Left half of a split slide: corner label, serif title and an optional muted description. */
const leftHalf = (lbl, title, body, ctx) => `<div class="side">${label(lbl, ctx)}<h2 class="t">${ctx.esc(title)}</h2>${body ? `<p class="desc">${ctx.esc(body)}</p>` : ''}</div>`

export function css(system) {
  const { surface, ink, accent, geometry } = system
  return `
:root { --page: ${surface.page}; --panel: ${surface.panel}; --card: ${surface.card}; --photo: ${surface.photo};
  --ink: ${ink.primary}; --muted: ${ink.muted}; --label: ${ink.label}; --on-photo: ${ink.onPhoto};
  --red: ${ink.red}; --red-mark: ${ink.redMark}; --blue: ${ink.blue}; --blue-text: ${ink.blueText}; --blue-mark: ${ink.blueMark}; --green: ${ink.green};
  --bar-red: ${accent.red}; --bar-blue: ${accent.blue}; --bar-yellow: ${accent.yellow}; --bar-green: ${accent.green};
  --rule: ${geometry.rule}; --m: ${geometry.margin}px; --lt: ${geometry.labelTop}px; --ul: ${geometry.underline}px; }
.slide { background: var(--page); color: var(--ink); font-size: 20px; line-height: 1.6; font-weight: 400; display: flex; flex-direction: column; padding: 0 var(--m); }
.lbl { position: absolute; left: var(--m); top: var(--lt); z-index: 2; font-size: 17px; font-weight: 600; line-height: 1; letter-spacing: .01em; text-transform: uppercase; color: var(--label); white-space: nowrap; }
.t { font-size: 41px; font-weight: 400; line-height: 55px; letter-spacing: -.006em; color: var(--ink); }
.desc { margin-top: 22px; font-size: 20px; line-height: 32px; color: var(--muted); }
.vrule { position: absolute; top: 0; bottom: 0; left: 50%; width: 1px; background: var(--rule); z-index: 1; }
.uline { display: block; flex: none; width: var(--ul); height: 2px; background: var(--red); }

/* Single column, left-aligned and vertically centred: cover, section, text, closing. */
.solo { justify-content: center; }
.solo .t, .solo .desc { max-width: 600px; }
.cover h1, .closing h2 { max-width: 1000px; font-size: 92px; font-weight: 400; line-height: 110px; letter-spacing: -.012em; color: var(--ink); }
.cover .uline, .closing .uline, .sectioned .uline { margin-top: 44px; }
.cover .sub, .closing .sub, .sectioned .sub { margin-top: 30px; max-width: 640px; font-size: 24px; line-height: 36px; color: var(--muted); }
.closing .contact { margin-top: 18px; font-size: 20px; font-weight: 600; line-height: 1.4; color: var(--red); }
.sectioned h2 { max-width: 960px; font-size: 72px; font-weight: 400; line-height: 88px; letter-spacing: -.01em; }
.statement { align-items: center; justify-content: center; text-align: center; }
.statement p { max-width: 960px; font-family: var(--display-font); font-size: 41px; line-height: 1.4; letter-spacing: -.006em; color: var(--red); text-wrap: balance; }

/* Two halves split by a hairline; the right half may be the paler panel. */
.split { padding: 0; display: grid; grid-template-columns: 1fr 1fr; }
.side { position: relative; display: flex; flex-direction: column; justify-content: center; padding: 0 var(--m); min-width: 0; }
.side.pale { background: var(--panel); }
.side.pale .placeholder { position: absolute; inset: 0; }
.pic { width: 100%; height: 100%; object-fit: cover; background: var(--panel); }
.side > .pic { position: absolute; inset: 0; }
.split .side:first-of-type { padding-right: 36px; }
.split .desc { max-width: 500px; }

.list { list-style: none; display: flex; flex-direction: column; gap: 30px; }
.list li { display: flex; gap: 8px; font-size: 26px; line-height: 1.3; color: var(--ink); }
.list .n { flex: none; min-width: 26px; font-variant-numeric: tabular-nums; }
.list .dash { flex: none; min-width: 26px; color: var(--red); }

.rows { position: relative; display: grid; grid-template-rows: repeat(var(--n), 1fr); padding: 0; }
.rows .row { position: relative; display: flex; flex-direction: column; justify-content: center; padding: 0 var(--m); }
.rows .row + .row { border-top: 1px solid var(--rule); }
.row .n { font-size: 17px; font-weight: 600; line-height: 1; letter-spacing: .01em; color: var(--red); font-variant-numeric: tabular-nums; }
.row b { margin-top: 14px; font-family: var(--display-font); font-size: 30px; font-weight: 400; line-height: 1.3; }
.row span { margin-top: 6px; font-size: 20px; line-height: 32px; color: var(--muted); }

.metrics { gap: 34px; }
.metric b { display: block; font-size: 60px; font-weight: 800; line-height: 1.05; letter-spacing: -.005em; color: var(--ink); font-variant-numeric: tabular-nums; }
.metric span { display: block; margin-top: 12px; font-size: 20px; line-height: 1.3; color: var(--muted); }
.bigv b { font-size: 240px; font-weight: 800; line-height: 1; letter-spacing: -.03em; color: var(--ink); }

/* Quotes: a tinted serif mark, the quote in a coloured serif, and an uppercase attribution. */
.q .qmark { display: block; height: 30px; font-family: var(--display-font); font-size: 72px; font-weight: 700; line-height: 64px; color: var(--red-mark); }
.q blockquote { margin-top: 24px; font-family: var(--display-font); font-size: 29px; line-height: 50px; color: var(--red); }
.q figcaption { margin-top: 20px; font-size: 17px; font-weight: 600; line-height: 1.3; letter-spacing: .01em; text-transform: uppercase; color: var(--red); }
.q.blue .qmark { color: var(--blue-mark); }
.q.blue blockquote, .q.blue figcaption { color: var(--blue-text); }
.quote { justify-content: center; padding-left: 246px; padding-right: 220px; }

/* Before and after panels. */
.duo { padding: 0; display: grid; grid-template-columns: 1fr 1fr; }
.duo .side { justify-content: flex-start; padding-top: 112px; padding-bottom: 66px; }
.duo .tag { font-size: 17px; font-weight: 600; line-height: 1; letter-spacing: .01em; text-transform: uppercase; }
.duo .side:nth-of-type(1) .tag { color: var(--blue); }
.duo .side:nth-of-type(2) .tag { color: var(--green); }
.duo .box { margin-top: 22px; flex: 1 1 auto; background: var(--panel); padding: 34px 36px; }
.duo .box p { font-family: var(--display-font); font-size: 30px; line-height: 44px; color: var(--ink); }

/* Titled full-width slides. */
.wide { padding-top: 124px; }
.wide .t { max-width: 900px; }
table { margin-top: 48px; width: 100%; border-collapse: collapse; }
th { text-align: left; padding: 0 20px 16px 0; font-size: 17px; font-weight: 600; line-height: 1; letter-spacing: .01em; text-transform: uppercase; color: var(--label); border-bottom: 1px solid var(--rule); }
td { padding: 20px 20px 20px 0; font-size: 24px; line-height: 1.35; color: var(--ink); border-bottom: 1px solid var(--rule); font-variant-numeric: tabular-nums; }
td:first-child { font-family: var(--display-font); }

/* Timeline as a gantt of coloured bars under a full-bleed hairline, as in the source. */
.timeline { padding-top: 124px; }
.tl { position: relative; margin-top: auto; margin-bottom: 80px; display: grid; grid-template-columns: repeat(var(--n), 1fr); column-gap: 13px; row-gap: 13px; }
.tl .rule { position: absolute; left: calc(var(--m) * -1); right: calc(var(--m) * -1); top: 39px; height: 2px; background: var(--rule); }
.tl .when { grid-row: 1; margin-bottom: 30px; font-size: 17px; font-weight: 600; line-height: 22px; letter-spacing: .01em; text-transform: uppercase; color: var(--ink); white-space: nowrap; }
.tl .bar { min-height: 49px; padding: 12px 14px; font-size: 18px; font-weight: 600; line-height: 25px; color: #fff; }
.tl .bar span { font-weight: 400; opacity: .82; }
.tl .bar.yellow { color: var(--ink); }

/* The titled content slide: a cream header band over the pale panel, as in the source's frames. */
.framed { padding: 0; }
.framed .band { position: relative; flex: none; padding: 106px var(--m) 28px; border-bottom: 1px solid var(--rule); }
.framed .band .t { font-size: 36px; line-height: 48px; }
.framed .panel { position: relative; flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; background: var(--panel); padding: 36px var(--m) 40px; }

.people { display: grid; grid-template-columns: repeat(var(--n), minmax(0, 264px)); gap: 28px; }
.person .face { display: block; width: 100%; aspect-ratio: 1; height: auto; object-fit: cover; background: var(--card); }
.person b { display: block; margin-top: 16px; font-family: var(--display-font); font-size: 24px; font-weight: 400; line-height: 1.3; }
.person span { display: block; margin-top: 2px; font-size: 18px; line-height: 1.4; color: var(--muted); }

/* A full-bleed picture, or the neutral grey field the source uses for one, under a pale label. */
.imagefull { padding: 0; background: var(--photo); }
.imagefull .pic { position: absolute; inset: 0; background: var(--photo); }
.imagefull .lbl { color: var(--on-photo); }
`
}

/** Bar colours of the timeline, in the order the source stacks them. */
const BARS = ['blue', 'yellow', 'red', 'green']

export const slides = {
  cover: (d, ctx) => `<section class="slide solo cover">${label([d.eyebrow, ctx.deck.date].filter(Boolean).join(' · '), ctx)}
    <h1>${ctx.esc(d.title)}</h1>${underline}${d.subtitle ? `<p class="sub">${ctx.esc(d.subtitle)}</p>` : ''}</section>`,

  agenda: (d, ctx) => `<section class="slide split">${vrule}${leftHalf('Agenda', d.title, '', ctx)}
    <div class="side"><ol class="list">${d.items.map((item, i) => `<li><span class="n">${i + 1}.</span><span>${ctx.esc(item)}</span></li>`).join('')}</ol></div></section>`,

  section: (d, ctx) => `<section class="slide solo sectioned">${label(`Section ${d.number}`, ctx)}<h2>${ctx.esc(d.title)}</h2>
    ${underline}${d.subtitle ? `<p class="sub">${ctx.esc(d.subtitle)}</p>` : ''}</section>`,

  statement: (d, ctx) => `<section class="slide statement">${label(d.attribution, ctx)}<p>${ctx.esc(d.text)}</p></section>`,

  text: (d, ctx) => `<section class="slide solo">${label(d.eyebrow ?? sectionName(ctx), ctx)}<h2 class="t">${ctx.esc(d.title)}</h2>
    <p class="desc">${ctx.esc(d.body)}</p></section>`,

  points: (d, ctx) => `<section class="slide split">${vrule}${leftHalf(sectionName(ctx), d.title, '', ctx)}
    <div class="rows" style="--n:${d.items.length}">${d.items.map((item, i) => `<div class="row"><span class="n">${i + 1}.</span><b>${ctx.esc(item.title)}</b><span>${ctx.esc(item.body)}</span></div>`).join('')}</div></section>`,

  'image-text': (d, ctx) => `<section class="slide split">${vrule}${leftHalf(sectionName(ctx), d.title, d.body, ctx)}
    <div class="side pale">${picture(d.image, ctx, 'media')}</div></section>`,

  metrics: (d, ctx) => `<section class="slide split">${vrule}${leftHalf(sectionName(ctx), d.title, '', ctx)}
    <div class="side metrics">${d.items.map((m) => `<div class="metric"><b>${ctx.esc(m.value)}</b><span>${ctx.esc(m.label)}</span></div>`).join('')}</div></section>`,

  'two-column': (d, ctx) => `<section class="slide duo">${vrule}${label(d.title, ctx)}${d.columns.map((c) => `<div class="side"><span class="tag">${ctx.esc(c.title)}</span>
    <div class="box"><p>${ctx.esc(c.body)}</p></div></div>`).join('')}</section>`,

  timeline: (d, ctx) => `<section class="slide timeline">${label(sectionName(ctx), ctx)}<h2 class="t">${ctx.esc(d.title)}</h2>
    <div class="tl" style="--n:${d.steps.length}">${d.steps.map((s, i) => `<span class="when" style="grid-column:${i + 1}">${ctx.esc(s.when)}</span>`).join('')}
    ${d.steps.map((s, i) => `<div class="bar ${BARS[i % BARS.length]}" style="grid-column:${i + 1} / span ${i < d.steps.length - 1 ? 2 : 1};grid-row:${2 + i};background:var(--bar-${BARS[i % BARS.length]})">${ctx.esc(s.title)}${s.body ? ` <span>· ${ctx.esc(s.body)}</span>` : ''}</div>`).join('')}
    <i class="rule" aria-hidden="true"></i></div></section>`,

  quote: (d, ctx) => `<section class="slide quote">${label(sectionName(ctx), ctx)}${quoteBlock(d.text, [d.name, d.role].filter(Boolean).join(', '), ctx)}</section>`,

  table: (d, ctx) => `<section class="slide wide">${label(sectionName(ctx), ctx)}<h2 class="t">${ctx.esc(d.title)}</h2>
    <table><thead><tr>${d.columns.map((c) => `<th>${ctx.esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${d.rows.map((r) => `<tr>${r.map((c) => `<td>${ctx.esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></section>`,

  'big-number': (d, ctx) => `<section class="slide split">${vrule}${leftHalf(sectionName(ctx), d.label, d.body, ctx)}
    <div class="side bigv"><b>${ctx.esc(d.value)}</b></div></section>`,

  bullets: (d, ctx) => `<section class="slide split">${vrule}${leftHalf(sectionName(ctx), d.title, '', ctx)}
    <div class="side"><ul class="list">${d.items.map((item) => `<li><span class="dash">—</span><span>${ctx.esc(item)}</span></li>`).join('')}</ul></div></section>`,

  team: (d, ctx) => slides.frame({ title: d.title }, ctx, `<div class="avn-body"><div class="people" style="--n:${d.people.length}">${d.people.map((p) => {
    const src = p.image && ctx.image(p.image)
    const face = src
      ? `<img class="face" src="${ctx.esc(src)}" alt="${ctx.esc(p.name)}">`
      : `<div class="face" role="img" aria-label="${ctx.esc(p.name)}"></div>`
    return `<div class="person">${face}<b>${ctx.esc(p.name)}</b><span>${ctx.esc(p.role)}</span></div>`
  }).join('')}</div></div>`),

  image: (d, ctx) => `<section class="slide imagefull">${picture(d.image, ctx, 'media')}${label(d.caption ?? sectionName(ctx), ctx)}</section>`,

  /** The titled content slide that `chart`, `custom` and `team` slides are drawn in. */
  frame: ({ title, eyebrow }, ctx, body) => `<section class="slide framed"><div class="band">${label(eyebrow ?? sectionName(ctx), ctx)}${title ? `<h2 class="t">${ctx.esc(title)}</h2>` : ''}</div>
    <div class="panel">${body}</div></section>`,

  closing: (d, ctx) => `<section class="slide solo closing">${label(ctx.deck.date, ctx)}<h2>${ctx.esc(d.title)}</h2>
    ${underline}${d.subtitle ? `<p class="sub">${ctx.esc(d.subtitle)}</p>` : ''}${d.contact ? `<p class="contact">${ctx.esc(d.contact)}</p>` : ''}</section>`,
}
