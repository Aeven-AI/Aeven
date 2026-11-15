/**
 * Research Readout: pastel blue, butter yellow, white and lavender pages set inside a hairline
 * margin frame (a left rail carrying the date and project name in vertical typewriter caps, and a
 * foot strip), typewriter caps corner labels, light grotesque titles, coloured outlined tag pills,
 * and rounded outlined pastel cards that rise from the baseline. Measured from the 16 frames of
 * "Research Readout" (Figma Community, by Figma).
 */

/** Tag pill fills in the source's order: orange, green, purple. */
const PILLS = ['var(--orange)', 'var(--green)', 'var(--purple)']
/** Pastel card fills, in the order the source's stat and quote cards use them. */
const CARDS = ['var(--yellow)', 'var(--lavender)', 'var(--grey)', 'var(--blue)', 'var(--peach)']
/** Full-colour panels for section slides and picture panels. */
const PANELS = ['var(--purple)', 'var(--green)', 'var(--orange)']

const pill = (text, ctx, fill = PILLS[0]) => `<span class="pill" style="--pc:${fill}">${ctx.esc(text)}</span>`

/** A user picture, or the rounded checkerboard card the source uses for empty image slots. */
function picture(image, ctx, cls) {
  const src = image && ctx.image(image)
  return src
    ? `<img class="${cls} pic" src="${ctx.esc(src)}" alt="${ctx.esc(image.alt ?? '')}">`
    : `<div class="${cls} pic checker" role="img" aria-label="${ctx.esc(image?.alt ?? '')}"></div>`
}

/** A rail slot holds about 26 mono caps; longer meta ends in an ellipsis so it stays in its slot. */
const fitRail = (text) => (text.length > 26 ? `${text.slice(0, 25).trimEnd()}…` : text)

/** The deck date and project name, set vertically in the left rail. */
function rail(ctx) {
  const { date, title } = ctx.deck
  return `${date ? `<div class="rail date"><span>${ctx.esc(fitRail(date))}</span></div>` : ''}${title ? `<div class="rail project"><span>${ctx.esc(fitRail(title))}</span></div>` : ''}`
}

/**
 * The page every slide sits on: the main field in `bg`, the rail and foot strips in `strip`, the
 * two frame hairlines, the rail meta and an optional typewriter corner label.
 */
function page(ctx, { cls = '', bg, strip = bg, label, foot }, inner) {
  return `<section class="slide rr ${cls}" style="--bg:${bg};--strip:${strip}">
    <div class="main">${label ? `<span class="label">${ctx.esc(label)}</span>` : ''}${inner}</div>
    <span class="vline"></span><span class="hline"></span>${rail(ctx)}
    ${foot ? `<span class="foot">${ctx.esc(foot)}</span>` : ''}</section>`
}

export function css(system) {
  const { surface: s, pill: p, ink, geometry: g } = system
  return `
:root { --blue: ${s.blue}; --yellow: ${s.yellow}; --white: ${s.white}; --lavender: ${s.lavender}; --grey: ${s.grey};
  --stone: ${s.stone}; --peach: ${s.peach}; --purple: ${p.purple}; --green: ${p.green}; --orange: ${p.orange};
  --ink: ${ink.primary}; --muted: ${ink.muted}; --hair: ${ink.rule}; --outline: ${ink.outline};
  --chk-a: ${s.checkerLight}; --chk-b: ${s.checkerDark}; --chk: ${g.checker}px;
  --strip-w: ${g.strip}px; --foot-h: ${g.foot}px; --inset: ${g.inset}px; --right: ${g.right}px; --r: ${g.radius}px;
  --mono: "${system.type.fonts.extra[0]}", ui-monospace, monospace; }
.rr { background: var(--strip); color: var(--ink); font-size: 20px; line-height: 1.3; }
.rr .main { position: absolute; left: var(--strip-w); top: 0; right: 0; bottom: var(--foot-h); background: var(--bg);
  display: flex; flex-direction: column; padding: 112px var(--right) 40px var(--inset); }
.rr .vline { position: absolute; left: var(--strip-w); top: 0; bottom: 0; width: 1px; background: var(--hair); z-index: 2; }
.rr .hline { position: absolute; left: 0; right: 0; bottom: var(--foot-h); height: 1px; background: var(--hair); z-index: 2; }
.rail { position: absolute; left: 0; width: var(--strip-w); height: 240px; display: flex; align-items: center; justify-content: center; }
.rail.date { top: 44px; } .rail.project { top: 379px; }
.rail span { writing-mode: vertical-rl; transform: rotate(180deg); white-space: nowrap; font-family: var(--mono); font-size: 13px; line-height: 1; letter-spacing: .05em; text-transform: uppercase; }
.label { position: absolute; left: 29px; top: 22px; font-family: var(--mono); font-size: 19px; line-height: 1.2; letter-spacing: .03em; text-transform: uppercase; }
.foot { position: absolute; right: var(--right); bottom: 0; height: var(--foot-h); display: flex; align-items: center; font-family: var(--mono); font-size: 14px; letter-spacing: .04em; text-transform: uppercase; }
.mono { font-family: var(--mono); }
.pill { display: inline-flex; align-items: center; align-self: flex-start; height: 40px; padding: 0 18px; border: 1.3px solid var(--ink); border-radius: 999px;
  background: var(--pc); font-family: var(--mono); font-size: 19px; letter-spacing: .03em; text-transform: uppercase; white-space: nowrap; }
.t-hero { font-size: 92px; letter-spacing: -.03em; line-height: 1.04; font-weight: 400; }
.t-title { font-size: 50px; letter-spacing: -.02em; line-height: 1.12; font-weight: 400; }
.t-lead { font-size: 40px; letter-spacing: -.02em; line-height: 1.14; font-weight: 400; }
.body { font-size: 21px; line-height: 1.32; }
.checker { background-color: var(--chk-a); background-image: conic-gradient(var(--chk-b) 25%, transparent 0 50%, var(--chk-b) 0 75%, transparent 0);
  background-size: calc(var(--chk) * 2) calc(var(--chk) * 2); }
.pic { display: block; border: 1.3px solid var(--outline); border-radius: var(--r); object-fit: cover; }
.card { border: 1.3px solid var(--outline); border-radius: var(--r); }
.rise { border: 1.3px solid var(--outline); border-bottom: 0; border-radius: var(--r) var(--r) 0 0; }

/* cover and closing: title block a little above centre, subtitle in typewriter type, name pill top right */
.cover .main { justify-content: center; padding-bottom: 110px; }
.cover .sub { margin-top: 30px; max-width: 470px; font-family: var(--mono); font-size: 19px; line-height: 1.16; }
.cover .who { position: absolute; top: 51px; right: var(--right); }
.cover .who.contact .pill { text-transform: none; letter-spacing: 0; }

.section .main { justify-content: center; padding-bottom: 90px; }
.section .sub { margin-top: 28px; max-width: 620px; font-family: var(--mono); font-size: 21px; line-height: 1.2; }

.agenda .grid { margin-top: 64px; display: grid; grid-template-columns: repeat(3, 1fr); column-gap: 60px; row-gap: 52px; }
.agenda .item { display: flex; flex-direction: column; gap: 18px; }
.agenda .item p { font-size: 32px; letter-spacing: -.015em; line-height: 1.15; }

.statement .main { justify-content: center; padding-bottom: 60px; }
.statement p { font-size: 92px; letter-spacing: -.03em; line-height: 1.1; max-width: 960px; text-wrap: balance; }

.text .t-title { max-width: 800px; }
.text .body { margin-top: 56px; max-width: 600px; }

.cols3 { margin-top: 20px; display: grid; grid-template-columns: repeat(3, 1fr); column-gap: 60px; }
.cols3 .col { display: flex; flex-direction: column; gap: 30px; }

.split .text-side { width: 520px; display: flex; flex-direction: column; }
.split .text-side .body { margin-top: 64px; }
.split .panel { position: absolute; left: 673px; top: 0; right: 0; bottom: 0; background: var(--panel); border-left: 1px solid var(--hair); display: grid; place-items: center; }
.split .panel .pic { width: 440px; height: 560px; }

.blocks { position: absolute; left: 0; right: 0; bottom: 0; height: 100%; display: flex; align-items: flex-end; }
.blocks .rise { flex: 1 1 0; margin-left: -1.3px; display: flex; flex-direction: column; justify-content: flex-end; padding: 0 16px 22px; background: var(--cf); }
.blocks .rise:first-child { margin-left: 0; }
.blocks b { font-size: 64px; font-weight: 400; letter-spacing: -.03em; line-height: 1; }
.blocks span { margin-top: 12px; font-size: 20px; line-height: 1.25; }

.duo .main { padding: 0; flex-direction: row; }
.duo .half { position: relative; display: flex; flex-direction: column; padding: 112px 50px 40px var(--inset); }
.duo .half.a { flex: 0 0 605px; background: var(--lavender); }
.duo .half.b { flex: 1 1 auto; background: var(--purple); border-left: 1px solid var(--hair); padding-left: 74px; padding-right: var(--right); }
.duo h3 { font-family: var(--font); font-size: 20px; font-weight: 700; letter-spacing: -.01em; }
.duo .half.a p { margin-top: 32px; font-size: 21px; line-height: 1.32; max-width: 450px; }
.duo .half.b p { margin-top: 40px; font-size: 48px; letter-spacing: -.02em; line-height: 1.14; }

.steps { position: absolute; left: 110px; right: 96px; top: 96px; bottom: 50px; display: flex; align-items: flex-end; gap: 18px; border-bottom: 1px solid var(--hair); }
.steps .rise { flex: 1 1 0; max-width: 230px; display: flex; flex-direction: column; justify-content: space-between; padding: 14px 14px 18px; background: var(--cf); }
.steps .when { font-size: 46px; letter-spacing: -.03em; line-height: 1.05; }
.steps h3 { font-family: var(--font); font-size: 20px; font-weight: 700; line-height: 1.2; }
.steps p { margin-top: 6px; font-size: 16px; line-height: 1.3; }

.quote .card { position: absolute; left: 41px; right: 38px; top: 36px; bottom: 36px; background: var(--yellow); padding: 40px 48px; display: flex; flex-direction: column; }
.quote blockquote { font-size: 56px; letter-spacing: -.025em; line-height: 1.12; max-width: 1000px; text-wrap: balance; }
.quote .by { margin-top: 30px; font-family: var(--mono); font-size: 21px; letter-spacing: .02em; }

.table table { margin-top: 26px; width: 100%; border-collapse: collapse; }
.table th { text-align: left; padding: 0 16px 22px 0; font-weight: 400; }
.table td { padding: 20px 16px 20px 0; border-top: 1px solid var(--hair); font-size: 23px; font-variant-numeric: tabular-nums; }
.table tbody tr:last-child td { border-bottom: 1px solid var(--hair); }
.table td:first-child { font-weight: 700; font-size: 20px; }

.big .main { flex-direction: row; align-items: center; padding-top: 60px; }
.big .slab { position: absolute; left: 0; bottom: 0; width: 560px; height: 560px; background: var(--lavender); padding: 30px 32px; }
.big .slab b { display: block; font-size: 240px; font-weight: 400; letter-spacing: -.05em; line-height: 1; }
.big .what { margin-left: 548px; display: flex; flex-direction: column; gap: 34px; max-width: 520px; }

.list .left { width: 560px; }
.list .divider { position: absolute; left: 748px; top: 0; bottom: 0; width: 1px; background: var(--hair); }
.list ul { position: absolute; left: 783px; right: var(--right); top: 140px; list-style: none; display: flex; flex-direction: column; gap: 22px; }
.list li { position: relative; padding-left: 26px; font-size: 24px; line-height: 1.3; }
.list li span.dot { position: absolute; left: 4px; top: 0; }

.team .people { position: absolute; left: 41px; right: 38px; top: 96px; bottom: 36px; display: grid; grid-template-columns: repeat(var(--n), 1fr); gap: 22px; }
.team .person { background: var(--cf); padding: 20px 20px 26px; display: flex; flex-direction: column; }
.team .person .pic { width: 100%; aspect-ratio: 1; border-radius: 18px; }
.team .person b { margin-top: auto; font-size: 26px; font-weight: 400; letter-spacing: -.015em; line-height: 1.15; }
.team .person span { margin-top: 8px; font-family: var(--mono); font-size: 16px; }

.full .main { padding: 0; }
.full .pic { position: absolute; left: 41px; right: 38px; top: 36px; bottom: 36px; width: calc(100% - 79px); height: calc(100% - 72px); }

.framed .main { padding-top: 96px; }
.framed .avn-body { margin-top: 28px; }
.framed .avn-caption { color: var(--muted); font-size: 17px; }
`
}

export const slides = {
  cover: (d, ctx) => page(ctx, { cls: 'cover', bg: 'var(--blue)', strip: 'var(--yellow)', label: d.eyebrow },
    `${ctx.deck.presenter ? `<span class="who">${pill(ctx.deck.presenter, ctx, 'var(--yellow)')}</span>` : ''}
    <h1 class="t-hero">${ctx.esc(d.title)}</h1>${d.subtitle ? `<p class="sub">${ctx.esc(d.subtitle)}</p>` : ''}`),

  agenda: (d, ctx) => page(ctx, { cls: 'agenda', bg: 'var(--yellow)' },
    `<h2 class="t-title">${ctx.esc(d.title)}</h2>
    <div class="grid">${d.items.map((item, i) => `<div class="item">${pill(String(i + 1).padStart(2, '0'), ctx, PILLS[i % 3])}<p>${ctx.esc(item)}</p></div>`).join('')}</div>`),

  section: (d, ctx) => page(ctx, { cls: 'section', bg: PANELS[(parseInt(d.number, 10) + 2 || 0) % 3], strip: 'var(--white)', label: d.number },
    `<h2 class="t-hero">${ctx.esc(d.title)}</h2>${d.subtitle ? `<p class="sub">${ctx.esc(d.subtitle)}</p>` : ''}`),

  statement: (d, ctx) => page(ctx, { cls: 'statement', bg: 'var(--yellow)', label: d.attribution },
    `<p>${ctx.esc(d.text)}</p>`),

  text: (d, ctx) => page(ctx, { cls: 'text', bg: 'var(--blue)', label: d.eyebrow },
    `<h2 class="t-title">${ctx.esc(d.title)}</h2><p class="body">${ctx.esc(d.body)}</p>`),

  points: (d, ctx) => page(ctx, { cls: 'points', bg: 'var(--white)', label: d.title },
    `<div class="cols3">${d.items.map((item, i) => `<div class="col">${pill(item.title, ctx, PILLS[i % 3])}<p class="t-lead">${ctx.esc(item.body)}</p></div>`).join('')}</div>`),

  'image-text': (d, ctx) => page(ctx, { cls: 'split', bg: 'var(--white)' },
    `<div class="text-side"><h2 class="t-title">${ctx.esc(d.title)}</h2><p class="body">${ctx.esc(d.body)}</p></div>
    <div class="panel" style="--panel:${PANELS[0]}">${picture(d.image, ctx, 'shot')}</div>`),

  metrics: (d, ctx) => {
    const heights = [55, 80, 40, 66]
    return page(ctx, { cls: 'metrics', bg: 'var(--yellow)', label: d.title },
      `<div class="blocks">${d.items.map((m, i) => `<div class="rise" style="height:${heights[i % 4]}%;--cf:${['var(--white)', 'var(--blue)', 'var(--lavender)', 'var(--peach)'][i % 4]}"><b>${ctx.esc(m.value)}</b><span>${ctx.esc(m.label)}</span></div>`).join('')}</div>`)
  },

  'two-column': (d, ctx) => {
    const [a, b] = d.columns
    return page(ctx, { cls: 'duo', bg: 'var(--lavender)', strip: 'var(--white)' },
      `<div class="half a"><span class="label">${ctx.esc(d.title)}</span><h3>${ctx.esc(a.title)}</h3><p>${ctx.esc(a.body)}</p></div>
      <div class="half b"><h3>${ctx.esc(b.title)}</h3><p>${ctx.esc(b.body)}</p></div>`)
  },

  timeline: (d, ctx) => {
    const n = d.steps.length
    return page(ctx, { cls: 'timeline', bg: 'var(--white)', label: d.title },
      `<div class="steps">${d.steps.map((s, i) => `<div class="rise" style="height:${Math.round(48 + (52 * i) / Math.max(1, n - 1))}%;--cf:${CARDS[i % CARDS.length]}">
        <span class="when">${ctx.esc(s.when)}</span><div><h3>${ctx.esc(s.title)}</h3>${s.body ? `<p>${ctx.esc(s.body)}</p>` : ''}</div></div>`).join('')}</div>`)
  },

  quote: (d, ctx) => page(ctx, { cls: 'quote', bg: 'var(--white)' },
    `<div class="card"><blockquote>“${ctx.esc(d.text)}”</blockquote><span class="by">${ctx.esc(d.name)}${d.role ? `, ${ctx.esc(d.role)}` : ''}</span></div>`),

  table: (d, ctx) => page(ctx, { cls: 'table', bg: 'var(--blue)', label: d.title },
    `<table><thead><tr>${d.columns.map((c, i) => `<th>${c ? pill(c, ctx, PILLS[(i + 2) % 3]) : ''}</th>`).join('')}</tr></thead>
    <tbody>${d.rows.map((r) => `<tr>${r.map((c) => `<td>${ctx.esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`),

  'big-number': (d, ctx) => page(ctx, { cls: 'big', bg: 'var(--yellow)' },
    `<div class="slab rise"><b>${ctx.esc(d.value)}</b></div>
    <div class="what"><h2 class="t-title">${ctx.esc(d.label)}</h2>${d.body ? `<p class="body">${ctx.esc(d.body)}</p>` : ''}</div>`),

  bullets: (d, ctx) => page(ctx, { cls: 'list', bg: 'var(--white)' },
    `<h2 class="t-title left">${ctx.esc(d.title)}</h2><span class="divider"></span>
    <ul>${d.items.map((item) => `<li><span class="dot">•</span>${ctx.esc(item)}</li>`).join('')}</ul>`),

  team: (d, ctx) => page(ctx, { cls: 'team', bg: 'var(--white)', label: d.title },
    `<div class="people" style="--n:${d.people.length}">${d.people.map((person, i) => `<div class="person card" style="--cf:${[CARDS[0], CARDS[3], CARDS[1], CARDS[2]][i % 4]}">
      ${picture(person.image ?? { alt: person.name }, ctx, 'face')}<b>${ctx.esc(person.name)}</b><span>${ctx.esc(person.role)}</span></div>`).join('')}</div>`),

  image: (d, ctx) => page(ctx, { cls: 'full', bg: 'var(--white)', foot: d.caption },
    picture(d.image, ctx, 'photo')),

  /** The titled content slide that `chart` and `custom` slides are drawn in. */
  frame: ({ title, eyebrow }, ctx, body) => page(ctx, { cls: 'framed', bg: 'var(--white)', label: eyebrow },
    `${title ? `<h2 class="t-title">${ctx.esc(title)}</h2>` : ''}${body}`),

  closing: (d, ctx) => page(ctx, { cls: 'cover', bg: 'var(--blue)', strip: 'var(--yellow)' },
    `${d.contact ? `<span class="who contact">${pill(d.contact, ctx, 'var(--purple)')}</span>` : ''}
    <h2 class="t-hero">${ctx.esc(d.title)}</h2>${d.subtitle ? `<p class="sub">${ctx.esc(d.subtitle)}</p>` : ''}`),
}
