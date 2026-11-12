/**
 * Project Review: a business-review report deck. Grey pages under a centred, widely spaced caps
 * header and a heavy black rule; content sits in full-bleed cells split by hairlines; serif caps
 * carry statements and numerals; a hairline footer holds the deck name and date in the corners.
 * Cover, section and closing pages turn cream. Measured from the 14 frames of "Project Review"
 * (Figma Community, by Figma).
 */

const pad = (n) => String(n).padStart(2, '0')

/** Header size for a band title: long titles step down so they stay on one line. */
const bandSize = (text) => {
  const n = String(text ?? '').length
  return n > 40 ? 22 : n > 30 ? 27 : 34
}

/** The standard page: caps header band over the heavy rule, the content area, the corner meta footer. */
function page(ctx, { cls = '', band, body, footer = true }) {
  const { deck } = ctx
  const head = band ? `<header class="band" style="--band:${bandSize(band)}px"><h2>${ctx.esc(band)}</h2></header>` : ''
  const meta = footer
    ? `<footer class="meta"><span>${ctx.esc(deck.title)}</span><span>${ctx.esc(deck.date ?? '')}</span></footer>`
    : ''
  return `<section class="slide pr ${cls}${band ? '' : ' no-band'}">${head}<div class="content">${body}</div>${meta}</section>`
}

/** A cream title page: small caps line on top, serif caps title in the middle, a serif line over the closing hairline. */
function creamPage(ctx, { cls = '', top, title, sub, foot, level = 'h1' }) {
  return `<section class="slide pr cream ${cls}">
    <header class="band"><span class="top">${ctx.esc(top ?? '')}</span></header>
    <div class="centre"><${level} class="serif title-xl">${ctx.esc(title)}</${level}>${sub ? `<p class="sub">${ctx.esc(sub)}</p>` : ''}</div>
    <div class="foot"><span class="serif">${ctx.esc(foot ?? '')}</span></div></section>`
}

/** A user picture, or the source's checkerboard placeholder when the slot has none. */
function picture(image, ctx, cls) {
  const src = ctx.image(image)
  return src
    ? `<img class="${cls} pic" src="${ctx.esc(src)}" alt="${ctx.esc(image.alt)}">`
    : `<div class="${cls} pic checker" role="img" aria-label="${ctx.esc(image?.alt ?? '')}"></div>`
}

export function css(system) {
  const { surface, ink, rule, geometry: g, type: t } = system
  return `
.pr { --page: ${surface.page}; --cream: ${surface.cream}; --ink: ${ink.primary}; --body: ${ink.body}; --muted: ${ink.muted};
  --heavy: ${rule.heavy}; --hair: ${rule.hair}; --chk-a: ${surface.placeholder[0]}; --chk-b: ${surface.placeholder[1]};
  --g: ${g.gutter}px; --label-font: "Space Grotesk", var(--font);
  background: var(--page); color: var(--ink); display: grid; grid-template-rows: ${g.band}px minmax(0, 1fr) ${g.footer}px;
  font-size: ${t.body}px; line-height: 1.42; }
.pr.no-band { grid-template-rows: minmax(0, 1fr) ${g.footer}px; }
.band { display: flex; align-items: center; justify-content: center; border-bottom: ${g.heavyRule}px solid var(--heavy); padding: 2px 48px 0; }
.band h2, .band .top { font-family: var(--label-font); font-size: var(--band, ${t.band}px); font-weight: 400; letter-spacing: .12em; text-transform: uppercase; line-height: 1; white-space: nowrap; }
.content { position: relative; min-height: 0; min-width: 0; display: flex; flex-direction: column; }
.meta { display: flex; justify-content: space-between; align-items: center; gap: 24px; padding: 0 var(--g); border-top: 1px solid var(--hair); font-size: ${t.meta}px; letter-spacing: .005em; text-transform: uppercase; white-space: nowrap; }

.serif { font-family: var(--display-font); font-weight: 400; text-transform: uppercase; letter-spacing: .015em; line-height: 1.02; }
.title-xl { font-size: 84px; line-height: 1; }
.title-l { font-size: 50px; }
.title-m { font-size: 42px; }
.label { font-family: var(--label-font); font-size: ${t.label}px; font-weight: 400; letter-spacing: .035em; text-transform: uppercase; line-height: 1.15; }
.tag { font-family: var(--label-font); font-size: 16px; font-weight: 700; letter-spacing: .03em; line-height: 1; }
.body { font-size: ${t.body}px; line-height: 1.42; color: var(--body); }
.fig { font-size: 140px; font-weight: 400; letter-spacing: -.01em; line-height: .92; font-variant-numeric: tabular-nums; white-space: nowrap; }

/* cells: full-bleed grid areas split by hairlines */
.cells { flex: 1 1 auto; min-height: 0; display: grid; }
.cells > * { min-width: 0; min-height: 0; }
.cols { grid-template-columns: repeat(var(--n), minmax(0, 1fr)); }
.cols > * + * { border-left: 1px solid var(--hair); }
.cell-head { display: flex; justify-content: space-between; align-items: center; gap: 16px; height: 78px; padding: 0 var(--g); border-bottom: 1px solid var(--hair); flex: none; }
.col { display: flex; flex-direction: column; }
.col .cell-body { flex: 1 1 auto; padding: 84px var(--g) 30px; display: flex; flex-direction: column; justify-content: flex-start; }

/* cream title pages: cover, section, closing */
.cream { background: var(--cream); grid-template-rows: ${g.band}px minmax(0, 1fr) 94px 47px; }
.cream .centre { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 22px; padding: 0 96px; text-align: center; }
.cream .sub { max-width: 720px; font-size: 22px; line-height: 1.4; color: var(--body); text-wrap: balance; }
.cream .foot { display: flex; align-items: flex-start; justify-content: center; border-bottom: 1px solid var(--hair); }
.cream .foot .serif { font-size: 40px; text-transform: none; }

/* statement and quote: serif caps centred in the content area */
.say { flex: 1 1 auto; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 30px; padding: 0 150px 24px; text-align: center; }
.say .serif { font-size: 52px; line-height: 1.04; text-wrap: balance; }
.say .by { font-family: var(--label-font); font-size: 18px; letter-spacing: .1em; text-transform: uppercase; }

/* agenda and timeline: numbered rows with a serif numeral column */
.rows { flex: 1 1 auto; display: grid; grid-template-rows: repeat(var(--n), minmax(0, 1fr)); }
.row { display: grid; grid-template-columns: var(--key, 106px) minmax(0, 1fr); align-items: stretch; }
.row + .row { border-top: 1px solid var(--hair); }
.row .key { display: flex; align-items: center; justify-content: center; border-right: 1px solid var(--hair); font-family: var(--display-font); font-size: 42px; line-height: 1; }
.row .val { display: flex; flex-direction: column; justify-content: center; gap: 6px; padding: 0 var(--g); }
.row .val .body { font-size: 22px; }
.tl .row .key { justify-content: flex-start; padding-left: var(--g); font-size: 50px; }

/* text and two-column */
.recap { display: flex; align-items: center; justify-content: center; padding: 30px 40px; text-align: center; }
.recap .serif { font-size: 50px; text-wrap: balance; }
.side { display: flex; align-items: center; padding: 30px 56px 30px 48px; }
.side .body { font-size: 24px; }

/* metrics: objective grid with big figures */
.mgrid { flex: 1 1 auto; display: grid; grid-template-columns: repeat(var(--c), minmax(0, 1fr)); grid-auto-rows: minmax(0, 1fr); }
.mcell { display: flex; flex-direction: column; padding: 22px var(--g) 26px; border-left: 1px solid var(--hair); border-top: 1px solid var(--hair); }
.mcell.first-col { border-left: 0; } .mcell.first-row { border-top: 0; }
.mcell .cell-top { display: flex; justify-content: space-between; gap: 16px; }
.mcell .fig { flex: 1 1 auto; display: flex; align-items: center; justify-content: center; }
.mgrid.c4 .fig { font-size: 112px; } .mgrid.c2 .fig { font-size: 118px; }

/* takeaways grid */
.tgrid { flex: 1 1 auto; display: grid; grid-template-columns: repeat(var(--c), minmax(0, 1fr)); grid-auto-rows: minmax(0, 1fr); }
.tcell { display: flex; flex-direction: column; align-items: center; gap: 26px; padding: 44px 30px 30px; text-align: center; border-left: 1px solid var(--hair); border-top: 1px solid var(--hair); }
.tcell.first-col { border-left: 0; } .tcell.first-row { border-top: 0; }
.tcell .body { font-size: 22px; text-wrap: balance; }

/* table */
.tbl { width: 100%; height: 100%; border-collapse: collapse; table-layout: fixed; }
.tbl th, .tbl td { text-align: left; padding: 0 var(--g); border-top: 1px solid var(--hair); }
.tbl th + th, .tbl td + td { border-left: 1px solid var(--hair); }
.tbl thead th { height: 78px; border-top: 0; font-family: var(--label-font); font-size: ${t.label}px; font-weight: 400; letter-spacing: .035em; text-transform: uppercase; }
.tbl td { font-size: 22px; color: var(--body); font-variant-numeric: tabular-nums; }
.tbl td:first-child { font-family: var(--label-font); font-weight: 700; font-size: 18px; letter-spacing: .03em; text-transform: uppercase; color: var(--ink); }

/* big number */
.bign { display: flex; align-items: center; justify-content: center; }
.bign .fig { font-size: 300px; letter-spacing: -.03em; line-height: .8; }

/* image-text, team, image: checkerboard placeholder from the source's empty picture frames */
.pic { display: block; width: 100%; height: 100%; object-fit: cover; }
.checker { background-color: var(--chk-b); background-image: conic-gradient(var(--chk-a) 25%, transparent 0 50%, var(--chk-a) 0 75%, transparent 0); background-size: 46px 46px; }
.it { grid-template-columns: 403px minmax(0, 1fr); }
.it .lead { display: flex; flex-direction: column; }
.it .lead .cell-head { height: 120px; }
.it .lead .cell-body { flex: 1 1 auto; display: flex; align-items: center; justify-content: center; padding: 30px 48px; text-align: center; }
.it .frame { padding: 32px; }
.team .person { display: flex; flex-direction: column; gap: 14px; padding: 22px var(--g) 26px; }
.team .person .pic { flex: 1 1 auto; height: auto; min-height: 0; }
.team .who { display: flex; justify-content: space-between; gap: 12px; flex: none; }
.team .who .tag { font-size: 17px; text-transform: uppercase; }
.team .person > .body { flex: none; font-size: 20px; }
.full { padding: 0; }
.full .pic { position: absolute; inset: 0; }
.full .meta .cap { text-transform: none; overflow: hidden; text-overflow: ellipsis; }

/* frame: chart and custom slides */
.framed .content { padding: 22px var(--g) 26px; gap: 16px; }
.framed .tag { flex: none; }
`
}

export const slides = {
  cover: (d, ctx) => creamPage(ctx, { cls: 'cover', top: d.eyebrow ?? ctx.deck.presenter, title: d.title, sub: d.subtitle, foot: ctx.deck.date }),

  agenda: (d, ctx) => page(ctx, { cls: 'agenda', band: d.title,
    body: `<ol class="rows" style="--n:${d.items.length}">${d.items.map((item, i) => `<li class="row"><span class="key">${i + 1}</span><span class="val"><span class="body">${ctx.esc(item)}</span></span></li>`).join('')}</ol>` }),

  section: (d, ctx) => creamPage(ctx, { cls: 'section', top: d.number, title: d.title, foot: d.subtitle, level: 'h2' }),

  statement: (d, ctx) => page(ctx, { cls: 'statement', band: d.attribution ?? ctx.deck.title,
    body: `<div class="say"><p class="serif">${ctx.esc(d.text)}</p></div>` }),

  text: (d, ctx) => page(ctx, { band: d.eyebrow ?? ctx.deck.title,
    body: `<div class="cells cols" style="--n:2"><div class="recap"><h3 class="serif">${ctx.esc(d.title)}</h3></div>
      <div class="side"><p class="body">${ctx.esc(d.body)}</p></div></div>` }),

  points: (d, ctx) => page(ctx, { band: d.title,
    body: `<div class="cells cols" style="--n:${d.items.length}">${d.items.map((item, i) => `<div class="col">
      <div class="cell-head"><h3 class="label">${ctx.esc(item.title)}</h3><span class="label">${i + 1}</span></div>
      <div class="cell-body"><p class="body">${ctx.esc(item.body)}</p></div></div>`).join('')}</div>` }),

  'image-text': (d, ctx) => page(ctx, { band: d.title,
    body: `<div class="cells cols it" style="--n:2"><div class="lead"><div class="cell-head"><span class="label">Fig. ${pad(ctx.index)}</span></div>
      <div class="cell-body"><p class="body">${ctx.esc(d.body)}</p></div></div>
      <div class="frame">${picture(d.image, ctx, 'media')}</div></div>` }),

  metrics: (d, ctx) => {
    const c = d.items.length === 4 ? 2 : d.items.length
    return page(ctx, { band: d.title,
      body: `<div class="mgrid c${c}" style="--c:${c}">${d.items.map((m, i) => `<div class="mcell${i % c === 0 ? ' first-col' : ''}${i < c ? ' first-row' : ''}">
        <div class="cell-top"><span class="label">${ctx.esc(m.label)}</span><span class="label">${pad(i + 1)}</span></div>
        <b class="fig">${ctx.esc(m.value)}</b></div>`).join('')}</div>` })
  },

  'two-column': (d, ctx) => page(ctx, { band: d.title,
    body: `<div class="cells cols" style="--n:2">${d.columns.map((c) => `<div class="col">
      <div class="cell-head"><h3 class="label">${ctx.esc(c.title)}</h3></div>
      <div class="cell-body"><p class="body side-body">${ctx.esc(c.body)}</p></div></div>`).join('')}</div>` }),

  timeline: (d, ctx) => page(ctx, { cls: 'tl', band: d.title,
    body: `<ol class="rows" style="--n:${d.steps.length};--key:150px">${d.steps.map((s) => `<li class="row"><span class="key">${ctx.esc(s.when)}</span>
      <span class="val"><span class="label">${ctx.esc(s.title)}</span>${s.body ? `<span class="body">${ctx.esc(s.body)}</span>` : ''}</span></li>`).join('')}</ol>` }),

  quote: (d, ctx) => page(ctx, { cls: 'quote', band: d.name,
    body: `<div class="say"><p class="serif">“${ctx.esc(d.text)}”</p>${d.role ? `<span class="by">${ctx.esc(d.role)}</span>` : ''}</div>` }),

  table: (d, ctx) => page(ctx, { band: d.title,
    body: `<table class="tbl"><thead><tr>${d.columns.map((c) => `<th>${ctx.esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${d.rows.map((r) => `<tr>${r.map((c) => `<td>${ctx.esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>` }),

  'big-number': (d, ctx) => page(ctx, { band: d.label,
    body: d.body
      ? `<div class="cells cols" style="--n:2"><div class="bign"><b class="fig">${ctx.esc(d.value)}</b></div>
        <div class="recap"><p class="serif">${ctx.esc(d.body)}</p></div></div>`
      : `<div class="cells bign"><b class="fig">${ctx.esc(d.value)}</b></div>` }),

  bullets: (d, ctx) => {
    const n = d.items.length
    const c = n <= 3 ? n : Math.ceil(n / 2)
    return page(ctx, { band: d.title,
      body: `<div class="tgrid" style="--c:${c}">${d.items.map((item, i) => `<div class="tcell${i % c === 0 ? ' first-col' : ''}${i < c ? ' first-row' : ''}">
        <span class="tag">${pad(i + 1)}</span><p class="body">${ctx.esc(item)}</p></div>`).join('')}</div>` })
  },

  team: (d, ctx) => page(ctx, { cls: 'team', band: d.title,
    body: `<div class="cells cols" style="--n:${d.people.length}">${d.people.map((p, i) => `<div class="person">
      <div class="who"><b class="tag">${ctx.esc(p.name)}</b><span class="tag">${pad(i + 1)}</span></div>
      ${picture(p.image ?? { alt: p.name }, ctx, 'avatar')}
      <span class="body">${ctx.esc(p.role)}</span></div>`).join('')}</div>` }),

  image: (d, ctx) => `<section class="slide pr full no-band"><div class="content">${picture(d.image, ctx, 'media')}</div>
    <footer class="meta"><span class="cap">${ctx.esc(d.caption ?? ctx.deck.title)}</span><span>Fig. ${pad(ctx.index)}</span></footer></section>`,

  /** The titled content slide that `chart` and `custom` slides are drawn in. */
  frame: ({ title, eyebrow }, ctx, body) => page(ctx, { cls: 'framed', band: title ?? ctx.deck.title,
    body: `${eyebrow ? `<span class="tag">${ctx.esc(eyebrow)}</span>` : ''}${body}` }),

  closing: (d, ctx) => creamPage(ctx, { cls: 'closing', top: d.subtitle, title: d.title, foot: d.contact, level: 'h2' }),
}
