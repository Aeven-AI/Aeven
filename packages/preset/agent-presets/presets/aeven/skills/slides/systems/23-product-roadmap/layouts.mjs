/**
 * Product Roadmap: a black cover and closing with a large white grotesk title set bottom-left,
 * warm cream content slides, black half-splits for the big insight and the big metric, titles
 * top-left over a right-hand column of numbered mono caps rows on grey hairlines, centred
 * condensed caps labels at the top of statement and spotlight slides, laptop mock-ups with a
 * checkerboard screen for pictures, and the team name and date in tiny mono caps in the bottom
 * corners of every slide. Measured from the 15 frames of Figma's "Product Roadmap" template.
 */

const pad2 = (n) => String(n).padStart(2, '0')

/**
 * A font size that keeps `text` within `lines` lines of `width` px, assuming an average advance of
 * `em` × size per character, clamped to [min, max].
 */
function fit(text, { width, lines, max, min, em = 0.52 }) {
  const str = String(text)
  const byLines = ((width * lines) / (Math.max(str.length, 1) * em)) * 0.88
  const word = Math.max(1, ...str.split(/\s+/).map((w) => w.length))
  const byWord = width / (word * em * 1.15)
  return Math.round(Math.max(min, Math.min(max, byLines, byWord)))
}

/** The corner meta: presenter bottom-left, date bottom-right, in tiny mono caps. */
const foot = (ctx) => `<div class="foot"><span class="fl">${ctx.esc(ctx.deck.presenter ?? '')}</span><span class="fr">${ctx.esc(ctx.deck.date ?? '')}</span></div>`

/** A centred condensed caps label at the top of a slide or panel. */
const label = (text, ctx) => (text ? `<p class="label">${ctx.esc(text)}</p>` : '')

/** A numbered mono caps header such as "01 FIRST POINT". */
const mono = (n, text, ctx) => `<h3 class="mono"><span>${pad2(n)}</span> ${ctx.esc(text)}</h3>`

/** A user picture, or the neutral checkerboard an empty screen shows. */
function screen(image, ctx, cls = 'screen') {
  const src = image && ctx.image(image)
  return src
    ? `<img class="${cls}" src="${ctx.esc(src)}" alt="${ctx.esc(image.alt ?? '')}">`
    : `<div class="${cls} checker" role="img" aria-label="${ctx.esc(image?.alt ?? '')}"></div>`
}

/** A laptop mock-up whose screen holds the picture. */
const laptop = (image, ctx, cls) => `<div class="laptop ${cls}"><div class="lid">${screen(image, ctx)}<i class="notch"></i></div><div class="base"><i></i></div></div>`

/** The left column of a content slide: title top-left, optional paragraph at the bottom. */
const lead = (title, body, ctx, size = 82) => `<div class="lead"><h2 class="title" style="font-size:${size}px">${ctx.esc(title)}</h2>${body ? `<p class="lead-body">${ctx.esc(body)}</p>` : ''}</div>`

export function css(system) {
  const { surface, ink, rule, geometry: g } = system
  return `
:root { --cream: ${surface.cream}; --black: ${surface.black}; --ck-a: ${surface.checker[0]}; --ck-b: ${surface.checker[1]};
  --ink: ${ink.primary}; --on-black: ${ink.onBlack}; --rule: ${rule}; --m: ${g.margin}px; --col: ${g.column}px;
  --mono: "JetBrains Mono", ui-monospace, monospace; --caps: "Inter Tight", Arial, sans-serif; }
.slide { background: var(--cream); color: var(--ink); font-size: 21px; line-height: 1.36; }
.dark { background: var(--black); color: var(--on-black); }

.foot { position: absolute; left: 27px; right: 27px; bottom: 9px; display: flex; justify-content: space-between; font-family: var(--mono); font-size: 12px; line-height: 1.2; text-transform: uppercase; letter-spacing: .02em; z-index: 3; }
.foot .fl, .foot .fr { color: var(--ink); }
.dark .foot .fl, .dark .foot .fr, .split-l .foot .fl, .split-r .foot .fr { color: var(--on-black); }

.label { font-family: var(--caps); font-size: 38px; font-weight: 400; line-height: 1.04; letter-spacing: -.025em; text-transform: uppercase; text-align: center; text-wrap: balance; }
.title { font-weight: 500; letter-spacing: -.012em; line-height: .91; }
.mono { font-family: var(--mono); font-size: 34px; font-weight: 400; line-height: 1.1; letter-spacing: .01em; text-transform: uppercase; }
.mono span { font-variant-numeric: tabular-nums; }

/* Content slides: title top-left, a right-hand column from x=557. */
.cols { display: grid; grid-template-columns: var(--col) 1fr; height: 100%; }
.lead { display: flex; flex-direction: column; justify-content: space-between; padding: 30px 40px 82px var(--m); }
.lead .title { font-size: 82px; }
.lead-body { max-width: 380px; font-size: 21px; line-height: 1.36; }
.right { padding: 26px var(--m) 28px 0; display: flex; flex-direction: column; min-height: 0; }

/* Ruled rows (points, agenda, text): hairline above each, one below the last. */
.rows { list-style: none; display: flex; flex-direction: column; flex: 1; border-bottom: 1px solid var(--rule); }
.rows li { flex: 1; border-top: 1px solid var(--rule); padding: 14px 0 18px; display: flex; flex-direction: column; gap: 6px; }
.rows .body-l { font-size: 30px; line-height: 1.3; max-width: 640px; margin-top: 8px; }
.rows p { font-size: 22px; line-height: 1.36; max-width: 540px; }

/* Ruled grid (bullets): two columns, hairlines between rows and a vertical rule. */
.grid { display: grid; grid-template-columns: 1fr 1fr; flex: 1; border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule); }
.grid .cell { padding: 14px 20px 18px 0; display: flex; flex-direction: column; gap: 8px; border-top: 1px solid var(--rule); }
.grid .cell:nth-child(-n+2) { border-top: 0; }
.grid .cell:nth-child(even) { padding-left: 18px; border-left: 1px solid var(--rule); }
.grid .cell p { font-size: 22px; line-height: 1.36; }
.right.bleed { padding-top: 0; padding-bottom: 0; }
.bleed .grid { margin-top: 26px; margin-bottom: 28px; }
.vline { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--rule); }

/* Metrics: value | detail rows filling the right side, hairlines between. */
.metrics .right { padding: 0 var(--m) 0 0; }
.mrow { flex: 1; display: grid; grid-template-columns: 1fr 252px; align-items: center; gap: 24px; border-top: 1px solid var(--rule); }
.mrow:first-child { border-top: 0; }
.mrow b { font-weight: 500; letter-spacing: -.03em; line-height: .9; white-space: nowrap; font-variant-numeric: tabular-nums; }
.mrow span { font-size: 34px; line-height: 1.04; letter-spacing: -.01em; }

/* Cover and closing: black, title bottom-left, label top centre. */
.cover { padding: 0; }
.cover .label { position: absolute; top: 30px; left: 200px; right: 200px; color: #fff; }
.cover h1, .cover h2 { position: absolute; left: var(--m); bottom: 30px; max-width: 820px; font-size: 132px; font-weight: 400; line-height: .94; letter-spacing: -.02em; color: #fff; }
.cover .aside { position: absolute; left: 905px; right: var(--m); bottom: 48px; font-size: 21px; line-height: 1.36; color: var(--on-black); }

/* Splits: black panel beside cream. */
.split { display: grid; height: 100%; }
.split .panel { position: relative; display: flex; flex-direction: column; min-width: 0; }
.panel.black { background: var(--black); color: var(--on-black); }
.panel .label { padding-top: 30px; }
.section-s { grid-template-columns: 812px 1fr; }
.section-s .black { padding: 30px var(--m) 82px; justify-content: space-between; }
.section-s .black .label { padding-top: 0; }
.section-s .num { font-family: var(--mono); font-size: 34px; letter-spacing: .01em; }
.section-s .black h2 { font-weight: 500; line-height: .96; letter-spacing: -.015em; }
.section-s .cream { padding: 365px var(--m) 0 10px; }
.section-s .cream p { max-width: 360px; }
.big-s { grid-template-columns: 546px 1fr; }
.big-s .cream { padding: 368px 120px 0 var(--m); }
.big-s .cream p { max-width: 360px; }
.big-s .black { padding: 0 var(--m) 54px 18px; justify-content: flex-end; }
.big-s .value { font-weight: 400; line-height: .8; letter-spacing: -.04em; white-space: nowrap; margin-bottom: 40px; }
.big-s .black h2 { font-weight: 500; line-height: .98; letter-spacing: -.015em; }

/* Statement and quote: big grotesk text on cream. */
.statement { padding: 30px var(--m) 60px; display: flex; flex-direction: column; }
.statement .text { margin-top: 62px; font-weight: 500; line-height: 1.12; letter-spacing: -.012em; max-width: 1060px; }
.quote { padding: 26px var(--m) 60px; }
.quote blockquote { font-weight: 500; line-height: 1.02; letter-spacing: -.015em; padding-left: .5em; max-width: 1180px; }
.quote .hang { display: inline-block; width: .5em; margin-left: -.5em; }
.quote .who { position: absolute; right: 214px; bottom: 54px; transform: translateX(50%); font-family: var(--mono); font-size: 12px; line-height: 1.25; text-transform: uppercase; text-align: center; }
.quote .who span { display: block; }

/* Banded slides (two-column, timeline, frame): centred label, a hairline at y=133, columns below. */
.band { display: flex; flex-direction: column; height: 100%; }
.band .top { position: relative; height: 133px; flex: none; border-bottom: 1px solid var(--rule); margin: 0 var(--m); display: flex; justify-content: center; padding-top: 30px; }
.band .top .label { max-width: 700px; }
.band .eyebrow { position: absolute; left: 0; top: 36px; font-family: var(--mono); font-size: 15px; letter-spacing: .02em; text-transform: uppercase; }
.band .colsN { flex: 1; display: grid; grid-template-columns: repeat(var(--n), 1fr); margin: 0 var(--m); }
.band .colsN > div { padding: 22px 22px 60px 0; display: flex; flex-direction: column; gap: 22px; }
.band .colsN > div + div { padding-left: 14px; border-left: 1px solid var(--rule); }
.band .colsN p { font-size: 21px; line-height: 1.36; max-width: 520px; }
.timeline .colsN > div { gap: 14px; }
.timeline .when { font-family: var(--mono); font-size: 52px; line-height: 1; letter-spacing: -.01em; text-transform: uppercase; }
.timeline h3:not(.mono) { font-size: 30px; font-weight: 500; line-height: 1.1; letter-spacing: -.01em; margin-top: 18px; }
.timeline .colsN p { font-size: 19px; }
.framed .avn-body { margin: 26px var(--m) 46px; }

/* Table: mono caps header, hairline rows filling the right column. */
.right table { flex: 1; width: 100%; border-collapse: collapse; border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule); }
.right th { font-family: var(--mono); font-size: 22px; font-weight: 400; letter-spacing: .01em; text-transform: uppercase; text-align: left; vertical-align: top; padding: 14px 12px 0 0; height: 1px; padding-bottom: 14px; }
.right td { font-size: 22px; vertical-align: top; padding: 14px 12px 14px 0; border-top: 1px solid var(--rule); font-variant-numeric: tabular-nums; }
.right td:first-child { font-family: var(--mono); font-size: 22px; text-transform: uppercase; }

/* Team: checkerboard portraits in ruled columns. */
.people { flex: 1; display: grid; grid-template-columns: repeat(var(--n), 1fr); border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule); }
.person { padding: 18px 14px; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.person + .person { border-left: 1px solid var(--rule); }
.portrait { width: 100%; aspect-ratio: 3 / 4; border-radius: 14px; object-fit: cover; margin-bottom: 14px; }
.person b { font-family: var(--mono); font-size: 18px; font-weight: 400; text-transform: uppercase; line-height: 1.2; }
.person span { font-size: 18px; line-height: 1.3; }

/* Pictures: laptop mock-up with a checkerboard screen. */
.checker { background-color: var(--ck-a); background-image: conic-gradient(var(--ck-b) 25%, transparent 0 50%, var(--ck-b) 0 75%, transparent 0); background-size: 92px 92px; }
.laptop { position: absolute; display: flex; flex-direction: column; align-items: center; }
.laptop .lid { position: relative; width: 100%; background: #0b0b0b; border-radius: 22px 22px 0 0; padding: 14px 14px 30px; box-shadow: 0 0 0 2px #c9c8c6; }
.laptop .screen { display: block; width: 100%; aspect-ratio: 1.55; object-fit: cover; border-radius: 6px 6px 0 0; }
.laptop .notch { position: absolute; left: 50%; top: 13px; width: 90px; height: 16px; margin-left: -45px; background: #0b0b0b; border-radius: 0 0 6px 6px; }
.laptop .base { position: relative; width: 120%; height: 18px; background: linear-gradient(#e7e7e6, #c4c4c3 55%, #8f8f8f); border-radius: 2px 2px 14px 14px / 2px 2px 10px 10px; }
.laptop .base i { position: absolute; left: 50%; top: 0; width: 18%; height: 6px; margin-left: -9%; background: linear-gradient(#cfcfce, #f1f1f0); border-radius: 0 0 8px 8px; }
.media-r .laptop { left: 557px; top: 83px; width: 800px; }
.spot .laptop { left: 258px; top: 138px; width: 764px; }
.spot.nolabel .laptop { top: 96px; }
.spot .label { position: absolute; top: 30px; left: 200px; right: 200px; }
`
}

export const slides = {
  cover: (d, ctx) => `<section class="slide dark cover">${label(d.eyebrow, ctx)}
    <h1>${ctx.esc(d.title)}</h1>${d.subtitle ? `<p class="aside">${ctx.esc(d.subtitle)}</p>` : ''}${foot(ctx)}</section>`,

  agenda: (d, ctx) => `<section class="slide"><div class="cols">${lead(d.title, '', ctx)}
    <div class="right"><ol class="rows">${d.items.map((item, i) => `<li>${mono(i + 1, item, ctx)}</li>`).join('')}</ol></div></div>${foot(ctx)}</section>`,

  section: (d, ctx) => `<section class="slide split-l"><div class="split section-s">
    <div class="panel black">${label(d.number, ctx)}<h2 style="font-size:${fit(d.title, { width: 750, lines: 3, max: 118, min: 64 })}px">${ctx.esc(d.title)}</h2></div>
    <div class="panel cream">${d.subtitle ? `<p>${ctx.esc(d.subtitle)}</p>` : ''}</div></div>${foot(ctx)}</section>`,

  statement: (d, ctx) => `<section class="slide statement">${label(d.attribution, ctx)}
    <p class="text" style="font-size:${fit(d.text, { width: 1060, lines: 5, max: 80, min: 46 })}px">${ctx.esc(d.text)}</p>${foot(ctx)}</section>`,

  text: (d, ctx) => `<section class="slide"><div class="cols">${lead(d.title, '', ctx)}
    <div class="right"><ol class="rows"><li>${d.eyebrow ? `<h3 class="mono">${ctx.esc(d.eyebrow)}</h3>` : ''}<p class="body-l">${ctx.esc(d.body)}</p></li></ol></div></div>${foot(ctx)}</section>`,

  points: (d, ctx) => `<section class="slide"><div class="cols">${lead(d.title, '', ctx)}
    <div class="right"><ol class="rows">${d.items.map((item, i) => `<li>${mono(i + 1, item.title, ctx)}<p>${ctx.esc(item.body)}</p></li>`).join('')}</ol></div></div>${foot(ctx)}</section>`,

  'image-text': (d, ctx) => `<section class="slide media-r"><div class="cols">${lead(d.title, d.body, ctx)}</div>${laptop(d.image, ctx, '')}${foot(ctx)}</section>`,

  metrics: (d, ctx) => {
    const longest = Math.max(...d.items.map((m) => String(m.value).length))
    const size = Math.round(Math.min(d.items.length > 3 ? 132 : 160, 400 / (longest * 0.6)))
    return `<section class="slide metrics"><div class="cols">${lead(d.title, '', ctx)}
    <div class="right">${d.items.map((m) => `<div class="mrow"><b style="font-size:${size}px">${ctx.esc(m.value)}</b><span>${ctx.esc(m.label)}</span></div>`).join('')}</div></div>${foot(ctx)}</section>`
  },

  'two-column': (d, ctx) => `<section class="slide"><div class="band"><div class="top">${label(d.title, ctx)}</div>
    <div class="colsN" style="--n:${d.columns.length}">${d.columns.map((c) => `<div><h3 class="mono">${ctx.esc(c.title)}</h3><p>${ctx.esc(c.body)}</p></div>`).join('')}</div></div>${foot(ctx)}</section>`,

  timeline: (d, ctx) => `<section class="slide timeline"><div class="band"><div class="top">${label(d.title, ctx)}</div>
    <div class="colsN" style="--n:${d.steps.length}">${d.steps.map((s) => `<div><span class="when">${ctx.esc(s.when)}</span><h3>${ctx.esc(s.title)}</h3>${s.body ? `<p>${ctx.esc(s.body)}</p>` : ''}</div>`).join('')}</div></div>${foot(ctx)}</section>`,

  quote: (d, ctx) => `<section class="slide quote"><blockquote style="font-size:${fit(d.text, { width: 1150, lines: 5, max: 100, min: 52 })}px"><span class="hang">“</span>${ctx.esc(d.text)}”</blockquote>
    <p class="who"><span>${ctx.esc(d.name)}</span>${d.role ? `<span>${ctx.esc(d.role)}</span>` : ''}</p>${foot(ctx)}</section>`,

  table: (d, ctx) => `<section class="slide"><div class="cols">${lead(d.title, '', ctx)}
    <div class="right"><table><thead><tr>${d.columns.map((c) => `<th>${ctx.esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${d.rows.map((r) => `<tr>${r.map((c) => `<td>${ctx.esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>${foot(ctx)}</section>`,

  'big-number': (d, ctx) => `<section class="slide split-r"><div class="split big-s">
    <div class="panel cream">${d.body ? `<p>${ctx.esc(d.body)}</p>` : ''}</div>
    <div class="panel black"><b class="value" style="font-size:${Math.round(Math.min(300, 640 / (String(d.value).length * 0.62)))}px">${ctx.esc(d.value)}</b>
    <h2 style="font-size:${fit(d.label, { width: 680, lines: 3, max: 78, min: 44 })}px">${ctx.esc(d.label)}</h2></div></div>${foot(ctx)}</section>`,

  bullets: (d, ctx) => `<section class="slide"><div class="cols">${lead(d.title, '', ctx)}
    <div class="right bleed"><div class="grid">${d.items.map((item, i) => `<div class="cell"><h3 class="mono">${pad2(i + 1)}</h3><p>${ctx.esc(item)}</p></div>`).join('')}</div></div></div>${foot(ctx)}</section>`,

  team: (d, ctx) => `<section class="slide"><div class="cols">${lead(d.title, '', ctx)}
    <div class="right"><div class="people" style="--n:${d.people.length}">${d.people.map((p) => `<div class="person">${screen(p.image, ctx, 'portrait')}<b>${ctx.esc(p.name)}</b><span>${ctx.esc(p.role)}</span></div>`).join('')}</div></div></div>${foot(ctx)}</section>`,

  image: (d, ctx) => `<section class="slide spot${d.caption ? '' : ' nolabel'}">${label(d.caption, ctx)}${laptop(d.image, ctx, '')}${foot(ctx)}</section>`,

  /** The titled content slide that `chart` and `custom` slides are drawn in. */
  frame: ({ title, eyebrow }, ctx, body) => `<section class="slide framed"><div class="band"><div class="top">${eyebrow ? `<span class="eyebrow">${ctx.esc(eyebrow)}</span>` : ''}${label(title, ctx)}</div>${body}</div>${foot(ctx)}</section>`,

  closing: (d, ctx) => `<section class="slide dark cover">${label(d.subtitle, ctx)}
    <h2>${ctx.esc(d.title)}</h2>${d.contact ? `<p class="aside">${ctx.esc(d.contact)}</p>` : ''}${foot(ctx)}</section>`,
}
