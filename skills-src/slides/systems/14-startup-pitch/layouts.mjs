/**
 * Startup Pitch: a bright yellow cover with a huge neo-grotesque title and outlined pill tags,
 * light-grey content slides under a caps label and a black rule, large sentence-case headings,
 * outlined white cards, numbered circles, a full-bleed milestone line and a company/date pill
 * pair in the lower-left corner. Mid-grey section and statement slides.
 * Measured from the 16 thumbnails of "Startup Pitch" (Figma Community, by Figma), scaled ×1.28.
 */

/** Steps a font size down for long text so it stays inside its box. */
const fit = (text, size, chars, min) => Math.max(min, Math.min(size, Math.round(size * chars / Math.max(chars, String(text).length))))

/** The light checkerboard the source uses for empty picture frames. */
const checker = (ctx, cls, alt) => `<div class="${cls} checker" role="img" aria-label="${ctx.esc(alt ?? '')}"></div>`

/** A user picture, or the checkerboard frame when the slot has none. */
function picture(image, ctx, cls) {
  const src = ctx.image(image)
  return src ? `<img class="${cls}" src="${ctx.esc(src)}" alt="${ctx.esc(image.alt)}">` : checker(ctx, cls, image?.alt)
}

/** The caps label over the black rule that opens every content slide. */
const top = (label, ctx, cls = '') => `<header class="top ${cls}"><span class="label">${ctx.esc(label ?? '')}</span></header>`

/** The company / date pill pair in the lower-left corner. */
function meta(ctx) {
  const second = ctx.deck.date ?? `${String(ctx.index).padStart(2, '0')} / ${String(ctx.total).padStart(2, '0')}`
  return `<footer class="meta"><span class="pill solid">${ctx.esc(ctx.deck.title)}</span><span class="pill">${ctx.esc(second)}</span></footer>`
}

/** A sentence-case content heading. */
const heading = (text, ctx) => `<h2 class="h" style="font-size:${fit(text, 58, 44, 40)}px">${ctx.esc(text)}</h2>`

/** A light content slide: label, rule, heading, content, corner pills. */
const page = (cls, label, title, ctx, body) => `<section class="slide sp ${cls}">${top(label, ctx)}${title ? heading(title, ctx) : ''}${body}${meta(ctx)}</section>`

/** The yellow cover and closing: date tag, centred title, centred tag, corner tag. */
function yellow(cls, { title, middle, corner }, ctx) {
  const date = ctx.deck.date ? `<span class="tag date">${ctx.esc(ctx.deck.date)}</span>` : ''
  return `<section class="slide sp yellow ${cls}">${date}
    <div class="centre"><h1 class="display" style="font-size:${fit(title, 214, 13, 96)}px">${ctx.esc(title)}</h1>
    ${middle ? `<span class="tag mid">${ctx.esc(middle)}</span>` : ''}</div>
    ${corner ? `<span class="tag corner">${ctx.esc(corner)}</span>` : ''}</section>`
}

export function css(system) {
  const s = system.surface
  return `
:root { --yellow: ${s.yellow}; --light: ${s.light}; --mid: ${s.mid}; --bar: ${s.bar}; --card: ${s.card};
  --check-a: ${s.checkA}; --check-b: ${s.checkB}; --ink: #000; --line: 1.5px solid #000; --m: 24px; }
.sp { background: var(--light); color: var(--ink); padding: 0 var(--m); display: flex; flex-direction: column; font-size: 21px; line-height: 1.32; letter-spacing: 0; word-spacing: .06em; }
.sp h1, .sp h2, .sp h3 { text-wrap: pretty; }
.top { flex: none; height: 51px; display: flex; align-items: flex-end; padding-bottom: 6px; border-bottom: var(--line); }
.label { font-size: 20px; line-height: 1; text-transform: uppercase; letter-spacing: -.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.h { flex: none; margin-top: 26px; font-weight: 400; line-height: 1.12; letter-spacing: -.01em; max-width: 840px; }
.hero { font-weight: 400; line-height: 1.08; letter-spacing: -.02em; word-spacing: .04em; }
.meta { position: absolute; left: var(--m); bottom: 24px; display: flex; gap: 3px; }
.pill { display: inline-flex; align-items: center; height: 36px; padding: 0 20px; border: 1.3px solid #000; border-radius: 999px; font-size: 15px; line-height: 1; text-transform: uppercase; white-space: nowrap; max-width: 420px; overflow: hidden; text-overflow: ellipsis; }
.pill.solid { background: #000; color: #fff; }
.main { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; padding-bottom: 92px; }
.card { background: var(--card); border: 1.3px solid #000; border-radius: 15px; }
.checker { background-color: var(--check-a); background-image: conic-gradient(var(--check-b) 25%, transparent 0 50%, var(--check-b) 0 75%, transparent 0); background-size: 56px 56px; }
.circle { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 74px; height: 74px; border: 1.3px solid #000; border-radius: 50%; background: var(--card); font-size: 32px; line-height: 1; }
.caps { font-size: 16px; line-height: 1.2; text-transform: uppercase; letter-spacing: 0; }

/* yellow cover and closing */
.yellow { background: var(--yellow); align-items: center; justify-content: center; }
.yellow .centre { display: flex; flex-direction: column; align-items: center; gap: 34px; max-width: 1180px; text-align: center; }
.display { font-family: "Inter Tight", var(--display-font); font-weight: 400; line-height: .98; letter-spacing: -.015em; text-wrap: balance; }
.tag { display: inline-flex; align-items: center; justify-content: center; min-height: 58px; padding: 10px 30px; border: 1.3px solid #000; border-radius: 30px; background: var(--light); font-size: 21px; line-height: 1.25; text-align: center; }
.tag.date, .tag.corner { position: absolute; text-transform: uppercase; white-space: nowrap; }
.tag.date { left: 96px; top: 96px; }
.tag.corner { right: 22px; bottom: 22px; }
.tag.mid { max-width: 760px; text-wrap: balance; }

/* mid-grey section and statement */
.grey { background: var(--mid); }
.section .title { margin-top: 30px; font-weight: 400; line-height: .94; letter-spacing: -.025em; }
.section .sub { margin-top: 30px; font-size: 30px; line-height: 1.25; max-width: 900px; }
.statement .hero { margin-top: 30px; max-width: 1220px; }
.statement .tag { align-self: flex-end; margin: auto 0 112px; background: var(--light); }

/* text: hero heading plus a callout card */
.lead { flex: none; margin-top: 26px; max-width: 1200px; }
.callout { align-self: flex-end; width: 572px; margin-top: auto; padding: 30px 38px 32px; font-size: 22px; line-height: 1.38; }

/* agenda */
.agenda-list { list-style: none; margin: auto 0 0 auto; width: 640px; display: flex; flex-direction: column; gap: 16px; }
.agenda-list li { display: flex; align-items: center; gap: 24px; font-size: 36px; line-height: 1.15; }
.agenda-list .circle { width: 66px; height: 66px; font-size: 26px; }

/* points: numbered steps */
.steps { margin-top: 120px; display: grid; grid-template-columns: repeat(3, 1fr); }
.steps > div { padding: 0 48px; display: flex; flex-direction: column; gap: 18px; }
.steps h3 { margin-top: 10px; font-size: 30px; font-weight: 400; line-height: 1.15; letter-spacing: -.015em; }
.steps p { font-size: 21px; line-height: 1.3; max-width: 330px; }

/* image + text */
.image-text { padding-right: 0; flex-direction: row; gap: 14px; }
.image-text .left { flex: 0 0 608px; display: flex; flex-direction: column; }
.image-text .body { margin-top: 44px; max-width: 520px; font-size: 21px; line-height: 1.38; }
.image-text .frame { flex: 1; margin: 23px var(--m) 25px 0; border-radius: 15px; object-fit: cover; min-width: 0; }

/* metrics: outlined cards */
.metric-row { margin-top: auto; display: grid; grid-template-columns: repeat(var(--n), 1fr); gap: 15px; }
.metric { min-height: 250px; padding: 28px 30px 30px; display: flex; flex-direction: column; justify-content: space-between; gap: 24px; }
.metric b { font-weight: 400; font-size: 84px; line-height: 1; letter-spacing: -.035em; font-variant-numeric: tabular-nums; }
.metric span { font-size: 22px; line-height: 1.3; }

/* two columns */
.pair { margin-top: auto; display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
.pair .card { min-height: 250px; padding: 30px 34px; display: flex; flex-direction: column; gap: 14px; }
.pair h3 { font-size: 30px; font-weight: 400; line-height: 1.15; letter-spacing: -.015em; }
.pair p { font-size: 21px; line-height: 1.35; max-width: 470px; }

/* timeline: full-bleed line, dots, stubs, cards */
.timeline .main { justify-content: center; }
.track { position: relative; margin: 40px calc(-1 * var(--m)) 0; padding: 0 var(--m); display: grid; grid-template-columns: repeat(var(--n), 1fr); gap: 20px; }
.track::before { content: ""; position: absolute; left: 0; right: 0; top: 7px; border-top: var(--line); }
.stop { display: flex; flex-direction: column; align-items: center; }
.stop .dot { position: relative; width: 16px; height: 16px; border-radius: 50%; background: #000; }
.stop .stub { width: 1.5px; height: 32px; background: #000; }
.stop .card { align-self: stretch; min-height: 140px; padding: 24px 28px; display: flex; flex-direction: column; gap: 8px; }
.stop .when { font-size: 16px; text-transform: uppercase; }
.stop h3 { font-size: 26px; font-weight: 400; line-height: 1.15; letter-spacing: -.01em; }
.stop p { font-size: 20px; line-height: 1.3; }

/* quote */
.quote-card { flex: 1; margin-top: 28px; padding: 40px 120px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 44px; text-align: center; }
.quote-card p { font-size: 46px; line-height: 1.18; letter-spacing: -.02em; text-wrap: balance; }
.name-pill { display: inline-flex; align-items: center; height: 59px; padding: 0 26px; border: 1.3px solid #000; border-radius: 999px; background: var(--card); font-size: 22px; line-height: 1; white-space: nowrap; }

/* table */
.table-card { margin-top: auto; padding: 10px 34px 6px; }
.table-card table { width: 100%; border-collapse: collapse; }
.table-card th { text-align: left; font-weight: 400; font-size: 16px; text-transform: uppercase; padding: 18px 16px 14px 0; }
.table-card td { padding: 18px 16px 18px 0; border-top: 1.3px solid #000; font-size: 22px; line-height: 1.25; font-variant-numeric: tabular-nums; }

/* big number: one yellow bar on the full-width baseline */
.big .left { flex: none; display: flex; flex-direction: column; width: 720px; }
.big .top { width: 100%; }
.big .body { position: absolute; left: var(--m); bottom: 152px; max-width: 560px; font-size: 22px; line-height: 1.38; }
.big .barcol { position: absolute; right: var(--m); top: 93px; bottom: 127px; width: 440px; display: flex; justify-content: center; padding-top: 22px; background: var(--yellow); }
.big .barcol b { font-weight: 400; line-height: 1; letter-spacing: -.04em; white-space: nowrap; }
.big .axis { position: absolute; left: var(--m); right: var(--m); bottom: 126px; border-top: var(--line); }

/* bullets: heading plus a list card */
.bullets .main { flex-direction: row; gap: 40px; align-items: flex-end; }
.list-card { margin-left: auto; width: 700px; padding: 34px 44px; list-style: none; display: flex; flex-direction: column; gap: 14px; }
.list-card li { display: flex; align-items: baseline; gap: 18px; font-size: 30px; line-height: 1.25; }
.list-card i { flex: none; width: 13px; height: 13px; border-radius: 50%; background: #000; transform: translateY(-3px); }

/* team: photo frames with a name pill */
.people { flex: 1; margin-top: 21px; display: grid; grid-template-columns: repeat(var(--n), 1fr); gap: 15px; padding-bottom: 92px; }
.person { display: flex; flex-direction: column; gap: 18px; min-height: 0; }
.person .shot { position: relative; flex: 1; min-height: 0; border-radius: 6px; overflow: hidden; }
.person .shot img, .person .shot .checker { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.person .name-pill { position: absolute; left: 8px; bottom: 8px; max-width: calc(100% - 16px); overflow: hidden; text-overflow: ellipsis; }
.person .caps { text-align: center; }

/* image */
.full { padding: 23px var(--m) 25px; }
.full .frame { position: relative; flex: 1; border-radius: 15px; overflow: hidden; }
.full .frame img, .full .frame .checker { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.full .tag { position: absolute; left: 26px; bottom: 22px; max-width: 560px; justify-content: flex-start; text-align: left; text-transform: uppercase; background: var(--card); border-radius: 32px; }

/* frame for chart and custom */
.framed .avn-body { margin-top: 26px; margin-bottom: 92px; }
`
}

export const slides = {
  cover: (d, ctx) => yellow('cover', { title: d.title, middle: d.subtitle, corner: d.eyebrow }, ctx),

  agenda: (d, ctx) => page('agenda', 'Contents', d.title, ctx,
    `<div class="main"><ol class="agenda-list">${d.items.map((item, i) => `<li><span class="circle">${i + 1}</span><span>${ctx.esc(item)}</span></li>`).join('')}</ol></div>`),

  section: (d, ctx) => `<section class="slide sp grey section">${top(d.number, ctx)}
    <h2 class="title" style="font-size:${fit(d.title, 200, 13, 110)}px">${ctx.esc(d.title)}</h2>
    ${d.subtitle ? `<p class="sub">${ctx.esc(d.subtitle)}</p>` : ''}${meta(ctx)}</section>`,

  statement: (d, ctx) => `<section class="slide sp grey statement">${top('', ctx)}
    <p class="hero" style="font-size:${fit(d.text, 108, 62, 64)}px">${ctx.esc(d.text)}</p>
    ${d.attribution ? `<span class="tag">${ctx.esc(d.attribution)}</span>` : ''}${meta(ctx)}</section>`,

  text: (d, ctx) => page('text', d.eyebrow ?? 'Overview', '', ctx,
    `<h2 class="hero lead" style="font-size:${fit(d.title, 104, 22, 58)}px">${ctx.esc(d.title)}</h2><div class="main"><p class="card callout">${ctx.esc(d.body)}</p></div>`),

  points: (d, ctx) => page('points', 'How it works', d.title, ctx,
    `<div class="main"><div class="steps">${d.items.map((item, i) => `<div><span class="circle">${i + 1}</span><h3>${ctx.esc(item.title)}</h3><p>${ctx.esc(item.body)}</p></div>`).join('')}</div></div>`),

  'image-text': (d, ctx) => `<section class="slide sp image-text"><div class="left">${top('Overview', ctx)}${heading(d.title, ctx)}
    <p class="body">${ctx.esc(d.body)}</p></div>${picture(d.image, ctx, 'frame')}${meta(ctx)}</section>`,

  metrics: (d, ctx) => page('metrics', 'Key numbers', d.title, ctx,
    `<div class="main"><div class="metric-row" style="--n:${d.items.length}">${d.items.map((m) => `<div class="card metric"><b>${ctx.esc(m.value)}</b><span>${ctx.esc(m.label)}</span></div>`).join('')}</div></div>`),

  'two-column': (d, ctx) => page('two-column', 'Compare', d.title, ctx,
    `<div class="main"><div class="pair">${d.columns.map((c) => `<div class="card"><h3>${ctx.esc(c.title)}</h3><p>${ctx.esc(c.body)}</p></div>`).join('')}</div></div>`),

  timeline: (d, ctx) => page('timeline', 'Milestones', d.title, ctx,
    `<div class="main"><div class="track" style="--n:${d.steps.length}">${d.steps.map((s) => `<div class="stop"><span class="dot"></span><span class="stub"></span>
      <div class="card"><span class="when">${ctx.esc(s.when)}</span><h3>${ctx.esc(s.title)}</h3>${s.body ? `<p>${ctx.esc(s.body)}</p>` : ''}</div></div>`).join('')}</div></div>`),

  quote: (d, ctx) => page('quote', 'Quotes', '', ctx,
    `<div class="main"><div class="card quote-card"><p>“${ctx.esc(d.text)}”</p>
      <span class="name-pill">${ctx.esc(d.name)}${d.role ? ` · ${ctx.esc(d.role)}` : ''}</span></div></div>`),

  table: (d, ctx) => page('table', 'Overview', d.title, ctx,
    `<div class="main"><div class="card table-card"><table><thead><tr>${d.columns.map((c) => `<th>${ctx.esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${d.rows.map((r) => `<tr>${r.map((c) => `<td>${ctx.esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`),

  'big-number': (d, ctx) => `<section class="slide sp big"><div class="left">${top('Highlight', ctx)}${heading(d.label, ctx)}</div>
    ${d.body ? `<p class="body">${ctx.esc(d.body)}</p>` : ''}
    <div class="barcol"><b style="font-size:${fit(d.value, 210, 3, 80)}px">${ctx.esc(d.value)}</b></div><div class="axis"></div>${meta(ctx)}</section>`,

  bullets: (d, ctx) => page('bullets', 'Summary', d.title, ctx,
    `<div class="main"><ul class="card list-card">${d.items.map((item) => `<li><i></i><span>${ctx.esc(item)}</span></li>`).join('')}</ul></div>`),

  team: (d, ctx) => `<section class="slide sp team">${top(d.title, ctx)}
    <div class="people" style="--n:${d.people.length}">${d.people.map((p) => {
      const src = p.image && ctx.image(p.image)
      const shot = src ? `<img src="${ctx.esc(src)}" alt="${ctx.esc(p.name)}">` : checker(ctx, '', p.name)
      return `<div class="person"><div class="shot">${shot}<span class="name-pill">${ctx.esc(p.name)}</span></div><span class="caps">${ctx.esc(p.role)}</span></div>`
    }).join('')}</div>${meta(ctx)}</section>`,

  image: (d, ctx) => `<section class="slide sp full"><div class="frame">${picture(d.image, ctx, '')}
    ${d.caption ? `<span class="tag">${ctx.esc(d.caption)}</span>` : ''}</div></section>`,

  /** The titled content slide that `chart` and `custom` slides are drawn in. */
  frame: ({ title, eyebrow }, ctx, body) => `<section class="slide sp framed">${top(eyebrow ?? '', ctx)}${title ? heading(title, ctx) : ''}${body}${meta(ctx)}</section>`,

  closing: (d, ctx) => yellow('closing', { title: d.title, middle: d.subtitle, corner: d.contact }, ctx),
}
