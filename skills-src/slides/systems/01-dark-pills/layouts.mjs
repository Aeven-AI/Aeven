/**
 * Dark Pills: navy surfaces, heavy condensed caps titles, small accent pill labels, "+" rows on
 * hairlines, light-grey stage slides with white caps, white quote cards on an accent offset.
 * Measured from the 24 frames of "Design Presentation Deck" (Figma Community).
 */

const plus = '<span class="plus" aria-hidden="true"></span>'

/** The glossy accent art used on the cover and as the image placeholder. */
const art = (extra = '') => `<div class="art ${extra}"><i></i><i></i><i></i></div>`

/** A user picture, or the art placeholder when the slot has none. */
function picture(image, ctx, cls) {
  const src = ctx.image(image)
  return src
    ? `<img class="${cls}" src="${ctx.esc(src)}" alt="${ctx.esc(image.alt)}">`
    : `<div class="${cls} placeholder" role="img" aria-label="${ctx.esc(image?.alt ?? '')}">${art()}</div>`
}

const pill = (text, ctx, tone = '') => `<span class="pill ${tone}">${ctx.esc(text)}</span>`

export function css(system) {
  const { surface, ink, accent } = system
  return `
:root { --page: ${surface.page}; --cover: ${surface.cover}; --stage: ${surface.light}; --card: ${surface.card};
  --ink: ${ink.primary}; --muted: ${ink.muted}; --on-stage: ${ink.onLight}; --accent: ${accent.primary};
  --art-a: ${accent.art[0]}; --art-b: ${accent.art[1]}; --hair: rgba(255,255,255,.14); --m: 52px; }
.slide { background: var(--page); color: var(--ink); padding: var(--m); display: flex; flex-direction: column; font-size: 17px; line-height: 1.45; }
.caps { font-weight: 800; text-transform: uppercase; letter-spacing: -.035em; line-height: .9; }
.title-xl { font-size: 96px; } .title-l { font-size: 76px; } .title-m { font-size: 56px; }
.mixed { font-weight: 600; letter-spacing: -.025em; line-height: 1.04; font-size: 46px; }
.muted { color: var(--muted); }
.pill { display: inline-flex; align-items: center; align-self: flex-start; height: 28px; padding: 0 14px; border-radius: 999px; background: var(--accent); color: #fff; font-size: 12px; font-weight: 600; white-space: nowrap; }
.pill.light { background: #fff; color: var(--accent); }
.plus { position: relative; flex: none; width: 12px; height: 12px; margin-top: 6px; }
.plus::before, .plus::after { content: ""; position: absolute; background: var(--accent); border-radius: 1px; }
.plus::before { left: 5px; top: 0; width: 2px; height: 12px; } .plus::after { top: 5px; left: 0; width: 12px; height: 2px; }
.rows { list-style: none; display: flex; flex-direction: column; }
.rows li { display: flex; gap: 14px; padding: 14px 0; border-top: 1px solid var(--hair); }
.rows li:first-child { border-top: 0; }
.row-tag { display: block; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); margin-bottom: 3px; }
.row-line { display: block; font-size: 17px; }

.art { position: absolute; inset: 0; background: radial-gradient(120% 90% at 85% 10%, var(--art-b) 0%, transparent 55%), linear-gradient(150deg, var(--cover) 10%, var(--art-a) 100%); overflow: hidden; }
.art i { position: absolute; border-radius: 50%; filter: blur(28px); opacity: .9; }
.art i:nth-child(1) { width: 70%; height: 120%; right: -18%; top: -40%; background: conic-gradient(from 200deg, transparent, var(--art-b), #c9c2ff 18%, var(--art-a) 30%, transparent 45%); transform: rotate(-24deg); }
.art i:nth-child(2) { width: 46%; height: 70%; right: 6%; bottom: -30%; background: radial-gradient(circle at 40% 40%, #ffffff55, var(--art-b) 35%, transparent 70%); }
.art i:nth-child(3) { width: 30%; height: 50%; right: 34%; top: -20%; background: radial-gradient(circle, #8a7dff66, transparent 70%); }

.cover { background: var(--cover); padding: 0; }
.cover .body { position: relative; margin-top: auto; padding: 0 var(--m) 64px; }
.cover h1 { display: inline; }
.cover .badge { display: inline-flex; vertical-align: top; margin: 14px 0 0 14px; height: 22px; padding: 0 8px; border-radius: 4px; background: var(--accent); color: #fff; font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; align-items: center; }
.cover .sub { margin-top: 14px; font-size: 22px; color: #d9dcf5; }

.stage { background: var(--stage); color: var(--on-stage); justify-content: space-between; }
.stage h2 { color: #fff; }
.stage p { max-width: 720px; font-size: 22px; line-height: 1.36; }

.agenda { display: grid; grid-template-columns: 1fr 1.1fr; gap: 64px; align-content: center; }
.agenda ol { list-style: none; counter-reset: a; }
.agenda li { counter-increment: a; display: flex; gap: 22px; align-items: baseline; padding: 16px 0; border-top: 1px solid var(--hair); font-size: 22px; }
.agenda li:first-child { border-top: 0; }
.agenda li::before { content: counter(a, decimal-leading-zero); font-size: 13px; font-weight: 700; color: var(--accent); font-variant-numeric: tabular-nums; }

.statement { justify-content: center; gap: 26px; }
.statement p { font-size: 54px; font-weight: 600; letter-spacing: -.03em; line-height: 1.06; max-width: 1040px; text-wrap: balance; }

.split { display: grid; grid-template-columns: 1fr 1fr; gap: 72px; align-content: center; }
.split .col { display: flex; flex-direction: column; gap: 18px; }
.bar { border-left: 2px solid var(--accent); padding-left: 20px; font-size: 20px; line-height: 1.5; color: #d6dae3; }

.head { display: flex; flex-direction: column; gap: 16px; }
.metrics-grid { margin-top: auto; display: grid; grid-template-columns: repeat(var(--n), 1fr); gap: 0; border-top: 1px solid var(--hair); }
.metric { padding: 28px 24px 0 0; display: flex; flex-direction: column; gap: 12px; }
.metric + .metric { padding-left: 24px; border-left: 1px solid var(--hair); }
.metric b { font-family: var(--display-font); font-size: 76px; font-weight: 800; letter-spacing: -.04em; line-height: .9; font-variant-numeric: tabular-nums; }
.metric span { display: flex; gap: 10px; font-size: 15px; color: var(--muted); }

.cols2 { margin-top: auto; display: grid; grid-template-columns: 1fr 1fr; gap: 56px; }
.cols2 .col { display: flex; flex-direction: column; gap: 16px; }
.cols2 p { display: flex; gap: 14px; font-size: 18px; color: #d6dae3; }

.timeline { margin-top: auto; margin-bottom: 18px; position: relative; display: grid; grid-template-columns: repeat(var(--n), 1fr); }
.timeline::before { content: ""; position: absolute; left: 0; right: 0; top: 50%; border-top: 1px solid var(--accent); }
.step { position: relative; display: flex; flex-direction: column; align-items: center; gap: 12px; }
.step .when { order: 2; position: relative; z-index: 1; height: 30px; min-width: 96px; padding: 0 16px; border-radius: 999px; background: var(--accent); color: #fff; font-size: 13px; font-weight: 600; display: flex; align-items: center; justify-content: center; }
.step .top { order: 1; height: 44px; display: flex; align-items: flex-end; font-size: 16px; font-weight: 600; text-align: center; }
.step .bottom { order: 3; height: 44px; font-size: 13px; color: var(--muted); text-align: center; max-width: 180px; }

.quote { align-items: center; justify-content: center; }
.qcard { width: 640px; background: #fff; color: #3a3f4a; padding: 34px 40px 36px; box-shadow: 10px 10px 0 var(--accent); display: flex; flex-direction: column; align-items: center; gap: 18px; text-align: center; }
.qcard p { font-size: 24px; line-height: 1.42; color: #2a2f3a; }
.qby { margin-top: 30px; font-size: 13px; color: var(--muted); text-decoration: underline; text-underline-offset: 3px; }

table { margin-top: auto; width: 100%; border-collapse: collapse; font-size: 18px; }
th { text-align: left; font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); padding: 0 0 14px; }
td { padding: 16px 0; border-top: 1px solid var(--hair); color: #d6dae3; font-variant-numeric: tabular-nums; }
td:first-child { color: var(--ink); font-weight: 600; }

.big { display: grid; grid-template-columns: auto 1fr; gap: 56px; align-items: center; }
.big b { font-family: var(--display-font); font-size: 300px; font-weight: 800; letter-spacing: -.06em; line-height: .78; color: var(--accent); }
.big .what { display: flex; flex-direction: column; gap: 16px; max-width: 460px; }

.people { margin-top: auto; display: grid; grid-template-columns: repeat(var(--n), 1fr); gap: 20px; }
.person { background: var(--card); border: 1px solid var(--hair); border-radius: 10px; padding: 18px; display: flex; flex-direction: column; gap: 14px; }
.avatar { position: relative; width: 100%; aspect-ratio: 1; border-radius: 8px; overflow: hidden; object-fit: cover; }
.avatar .initials { position: absolute; inset: 0; display: grid; place-items: center; font-family: var(--display-font); font-size: 44px; font-weight: 800; color: #fff; }
.person b { font-size: 18px; } .person span { font-size: 14px; color: var(--muted); }

.media { position: relative; border-radius: 10px; overflow: hidden; object-fit: cover; width: 100%; height: 100%; }
.image-text { display: grid; grid-template-columns: 1.15fr 1fr; gap: 56px; align-items: center; }
.image-text .media { height: 560px; }
.full { padding: 0; }
.full .media { border-radius: 0; }
.full .cap { position: absolute; left: var(--m); bottom: var(--m); }

.framed .avn-body { margin-top: 28px; }
.closing { align-items: center; justify-content: center; text-align: center; gap: 22px; }
.closing .contact { font-size: 15px; color: var(--muted); }
`
}

export const slides = {
  cover: (d, ctx) => `<section class="slide cover">${art()}<div class="body">
    <h1 class="caps title-xl">${ctx.esc(d.title)}</h1>${d.eyebrow ? `<span class="badge">${ctx.esc(d.eyebrow)}</span>` : ''}
    ${d.subtitle ? `<p class="sub">${ctx.esc(d.subtitle)}</p>` : ''}</div></section>`,

  agenda: (d, ctx) => `<section class="slide agenda"><div class="head">${pill('Agenda', ctx)}<h2 class="caps title-l">${ctx.esc(d.title)}</h2></div>
    <ol>${d.items.map((item) => `<li>${ctx.esc(item)}</li>`).join('')}</ol></section>`,

  section: (d, ctx) => `<section class="slide stage"><h2 class="caps title-xl">${ctx.esc(d.title)}</h2>
    <p>${ctx.esc(d.subtitle ?? `Section ${d.number}`)}</p></section>`,

  statement: (d, ctx) => `<section class="slide statement">${d.attribution ? pill(d.attribution, ctx) : ''}<p>${ctx.esc(d.text)}</p></section>`,

  text: (d, ctx) => `<section class="slide split"><div class="col">${d.eyebrow ? pill(d.eyebrow, ctx) : ''}<h2 class="mixed">${ctx.esc(d.title)}</h2></div>
    <div class="col"><p class="bar">${ctx.esc(d.body)}</p></div></section>`,

  points: (d, ctx) => `<section class="slide split"><div class="col"><h2 class="caps title-m">${ctx.esc(d.title)}</h2></div>
    <div class="col">${pill('Key points', ctx, 'light')}<ul class="rows">${d.items.map((item) => `<li>${plus}<div><span class="row-tag">${ctx.esc(item.title)}</span><span class="row-line">${ctx.esc(item.body)}</span></div></li>`).join('')}</ul></div></section>`,

  'image-text': (d, ctx) => `<section class="slide image-text">${picture(d.image, ctx, 'media')}
    <div class="col head"><h2 class="mixed">${ctx.esc(d.title)}</h2><p class="bar">${ctx.esc(d.body)}</p></div></section>`,

  metrics: (d, ctx) => `<section class="slide"><div class="head">${pill('Key numbers', ctx)}<h2 class="caps title-m">${ctx.esc(d.title)}</h2></div>
    <div class="metrics-grid" style="--n:${d.items.length}">${d.items.map((m) => `<div class="metric"><b>${ctx.esc(m.value)}</b><span>${plus}${ctx.esc(m.label)}</span></div>`).join('')}</div></section>`,

  'two-column': (d, ctx) => `<section class="slide"><h2 class="mixed">${ctx.esc(d.title)}</h2>
    <div class="cols2">${d.columns.map((c) => `<div class="col">${pill(c.title, ctx, 'light')}<p>${plus}<span>${ctx.esc(c.body)}</span></p></div>`).join('')}</div></section>`,

  timeline: (d, ctx) => `<section class="slide"><div class="head">${pill('Milestones', ctx)}<h2 class="caps title-m">${ctx.esc(d.title)}</h2></div>
    <div class="timeline" style="--n:${d.steps.length}">${d.steps.map((s) => `<div class="step"><span class="top">${ctx.esc(s.title)}</span><span class="when">${ctx.esc(s.when)}</span><span class="bottom">${ctx.esc(s.body ?? '')}</span></div>`).join('')}</div></section>`,

  quote: (d, ctx) => `<section class="slide quote"><div class="qcard">${pill(d.role ?? d.name, ctx)}<p>${ctx.esc(d.text)}</p></div>
    <span class="qby">${ctx.esc(d.name)}${d.role ? `, ${ctx.esc(d.role)}` : ''}</span></section>`,

  table: (d, ctx) => `<section class="slide"><h2 class="caps title-m">${ctx.esc(d.title)}</h2>
    <table><thead><tr>${d.columns.map((c) => `<th>${ctx.esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${d.rows.map((r) => `<tr>${r.map((c) => `<td>${ctx.esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></section>`,

  'big-number': (d, ctx) => `<section class="slide big"><b>${ctx.esc(d.value)}</b>
    <div class="what"><h2 class="caps title-m">${ctx.esc(d.label)}</h2>${d.body ? `<p class="bar">${ctx.esc(d.body)}</p>` : ''}</div></section>`,

  bullets: (d, ctx) => `<section class="slide split"><div class="col">${pill('Summary', ctx)}<h2 class="mixed">${ctx.esc(d.title)}</h2></div>
    <ul class="rows">${d.items.map((item) => `<li>${plus}<span class="row-line">${ctx.esc(item)}</span></li>`).join('')}</ul></section>`,

  team: (d, ctx) => `<section class="slide"><h2 class="caps title-m">${ctx.esc(d.title)}</h2>
    <div class="people" style="--n:${d.people.length}">${d.people.map((p) => {
      const src = p.image && ctx.image(p.image)
      const face = src
        ? `<img class="avatar" src="${ctx.esc(src)}" alt="${ctx.esc(p.name)}">`
        : `<div class="avatar">${art()}<span class="initials">${ctx.esc(p.name.split(' ').map((w) => w[0]).join('').slice(0, 2))}</span></div>`
      return `<div class="person">${face}<b>${ctx.esc(p.name)}</b><span>${ctx.esc(p.role)}</span></div>`
    }).join('')}</div></section>`,

  image: (d, ctx) => `<section class="slide full">${picture(d.image, ctx, 'media')}${d.caption ? `<span class="cap">${pill(d.caption, ctx)}</span>` : ''}</section>`,

  /** The titled content slide that `chart` and `custom` slides are drawn in. */
  frame: ({ title, eyebrow }, ctx, body) => `<section class="slide framed"><div class="head">${eyebrow ? pill(eyebrow, ctx) : ''}${title ? `<h2 class="caps title-m">${ctx.esc(title)}</h2>` : ''}</div>${body}</section>`,

  closing: (d, ctx) => `<section class="slide closing">${d.subtitle ? pill(d.subtitle, ctx) : ''}<h2 class="caps title-xl">${ctx.esc(d.title)}</h2>
    ${d.contact ? `<span class="contact">${ctx.esc(d.contact)}</span>` : ''}</section>`,
}
