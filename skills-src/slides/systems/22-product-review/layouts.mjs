/**
 * Product Review: one rounded panel per slide inside a thick frame, cream panel in a black frame,
 * black panel in a cream frame, or a panel the frame's own colour with a hairline edge. Spaced caps
 * meta (date, deck title, presenter) runs along the frame's top edge. Titles are a big grotesque
 * that mixes bold and light, sections carry a giant light number, item lists use black dots and
 * spaced bold caps, and image slots are checkerboard screens in drawn device frames.
 * Measured from the 16 frames of "Product Review" (Figma Community), scaled ×1.28.
 */

/** The frame's corner meta: date, deck title (or a slide's own centre text) and presenter. */
function meta(ctx, centre) {
  const { deck, esc } = ctx
  return `<header class="meta"><span>${esc(deck.date ?? '')}</span><span>${esc(centre ?? deck.title ?? '')}</span><span>${esc(deck.presenter ?? '')}</span></header>`
}

/**
 * One slide: the frame in `tone` with its meta and a single panel.
 * Tones: ink (cream panel, black frame), paper (black panel, cream frame),
 * night (black on black with a hairline), day (cream on cream with a hairline).
 */
const page = (ctx, tone, cls, panel, centre) =>
  `<section class="slide pr t-${tone} ${cls}">${meta(ctx, centre)}<div class="panel">${panel}</div></section>`

/** A user picture, or the checkerboard placeholder the source uses for empty image slots. */
function picture(image, ctx, cls) {
  const src = image && ctx.image(image)
  return src
    ? `<img class="${cls}" src="${ctx.esc(src)}" alt="${ctx.esc(image.alt ?? '')}">`
    : `<div class="${cls} checker" role="img" aria-label="${ctx.esc(image?.alt ?? '')}"></div>`
}

/** The laptop the source shows features on, with the picture on its screen. */
const laptop = (image, ctx) => `<div class="bleed"><div class="laptop"><div class="lid">${picture(image, ctx, 'screen')}<i class="notch"></i></div><i class="base"></i></div></div>`

/** A dot, caps heading and paragraph: the source's "First thing" item. */
const item = (title, body, ctx) => `<div class="item"><i class="dot"></i><div><h3 class="caps">${ctx.esc(title)}</h3><p>${ctx.esc(body)}</p></div></div>`

/** Display size for a giant light number by its length, so long values stay inside the panel. */
const giant = (value) => [560, 560, 440, 340, 280, 230][Math.min(String(value).length, 5)]

export function css(system) {
  const { surface: s, line, geometry: g } = system
  return `
.pr { --cream: ${s.cream}; --black: ${s.black}; --yellow: ${s.yellow}; --c1: ${s.checker[0]}; --c2: ${s.checker[1]};
  --top: ${g.frameTop}px; --side: ${g.frameSide}px; --r: ${g.radius}px; --display: ${g.display}px; --title: ${g.title}px;
  background: var(--frame); color: var(--fg); font-size: ${g.body}px; line-height: 1.43; letter-spacing: -.01em; }
.t-ink { --frame: var(--black); --frame-fg: var(--cream); --bg: var(--cream); --fg: var(--black); --edge: transparent; --rule: rgba(0,0,0,.28); --soft: #6B6860; }
.t-paper { --frame: var(--cream); --frame-fg: var(--black); --bg: var(--black); --fg: var(--cream); --edge: transparent; --rule: rgba(244,242,234,.3); --soft: #A9A69E; }
.t-night { --frame: var(--black); --frame-fg: var(--cream); --bg: var(--black); --fg: var(--cream); --edge: ${line.onBlack}; --rule: rgba(244,242,234,.3); --soft: #A9A69E; }
.t-day { --frame: var(--cream); --frame-fg: var(--black); --bg: var(--cream); --fg: var(--black); --edge: ${line.onCream}; --rule: rgba(0,0,0,.28); --soft: #6B6860; }
.t-white { --frame: ${s.white}; --frame-fg: var(--black); --bg: var(--cream); --fg: var(--black); --edge: transparent; --rule: rgba(0,0,0,.28); --soft: #6B6860; }

.meta { position: absolute; left: var(--side); right: var(--side); top: 0; height: var(--top); display: grid; grid-template-columns: 169px 1fr auto; align-items: center;
  color: var(--frame-fg); font-size: 14px; font-weight: 500; letter-spacing: .04em; text-transform: uppercase; line-height: 1; white-space: nowrap; }
.meta span { overflow: hidden; text-overflow: ellipsis; }
.panel { position: absolute; left: var(--side); right: var(--side); top: var(--top); bottom: var(--side); border-radius: var(--r);
  background: var(--bg); border: 1px solid var(--edge); display: flex; flex-direction: column; }

.bold { font-weight: 700; letter-spacing: -.02em; }
.light { font-weight: 300; letter-spacing: -.02em; }
.medium { font-weight: 500; letter-spacing: -.02em; }
.display { font-size: var(--display); line-height: 1.06; }
.title { font-size: var(--title); line-height: 1.04; font-weight: 300; letter-spacing: -.025em; max-width: 560px; }
.caps { font-size: 27px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; line-height: 1.15; }
.label { font-size: 15px; font-weight: 500; letter-spacing: .07em; text-transform: uppercase; line-height: 1.25; }
.soft { color: var(--soft); }

/* Big-title slides: cover, agenda, section, statement, quote, closing */
.hero .panel { padding: 96px 92px 64px; }
.cover h1 { max-width: 640px; }
.hero h1 + .sub, .hero h2 + .sub { margin-top: -22px; }
.sub.small { margin-top: 18px !important; font-size: 46px; line-height: 1.16; max-width: 920px; }
.hero .foot { margin-top: auto; font-size: 20px; }

.agenda .panel, .bullets .panel { display: grid; grid-template-columns: 557px 1fr; align-items: start; }
.agenda h2, .bullets h2 { font-weight: 500; letter-spacing: -.02em; }
.agenda ol, .bullets ul { list-style: none; padding-top: 4px; }
.agenda li { font-size: 46px; line-height: 51px; letter-spacing: -.035em; display: flex; }
.agenda li .n { flex: none; width: 56px; }
.bullets ul { display: flex; flex-direction: column; gap: 22px; padding-top: 14px; }
.bullets h2 { font-size: 84px; padding-right: 40px; }
.bullets li { display: flex; gap: 26px; font-size: 36px; line-height: 1.15; letter-spacing: -.03em; }
.bullets li .dot { margin-top: 13px; width: 16px; height: 16px; }

.section h2 { font-weight: 500; max-width: 600px; }
.section .sub { margin-top: 26px !important; font-size: 28px; font-weight: 300; max-width: 520px; }
.giant { position: absolute; right: 44px; bottom: 74px; font-weight: 300; line-height: .76; letter-spacing: -.04em; white-space: nowrap; }

.statement .panel { justify-content: center; padding-top: 64px; }
.statement .say { font-size: 80px; line-height: 1.06; max-width: 1080px; }

.quote .say { font-size: 56px; line-height: 1.1; max-width: 1020px; }
.quote .who { margin-top: auto; display: flex; flex-direction: column; gap: 10px; }
.quote .who span { font-size: 18px; }

/* Content slides: light title top left, content below */
.content .panel { padding: 42px 41px 41px; }
.head { display: flex; flex-direction: column; gap: 14px; }
.content .avn-body { margin-top: 28px; }

.text .panel { display: grid; grid-template-columns: 1fr 520px; gap: 64px; padding: 42px 64px 60px 41px; }
.text .title { font-size: 64px; }
.text .col { align-self: end; display: flex; flex-direction: column; gap: 16px; }
.text .col p { font-size: 20px; line-height: 1.5; }

.dot { flex: none; display: block; width: 26px; height: 26px; border-radius: 50%; background: currentColor; }
.item { display: flex; gap: 38px; }
.item .dot { margin-top: 1px; }
.item h3 { margin-bottom: 10px; font-family: var(--font); }
.item p { max-width: 384px; }

.split { background: var(--frame); }
.split .panel { right: auto; width: 388px; border: 1px solid var(--edge); justify-content: center; padding: 0 20px; }
.split .panel + .panel { left: 414px; right: var(--side); width: auto; }
.split.t-white .panel + .panel { background: var(--yellow); }
.split .title { font-size: 52px; }
.points .panel + .panel { padding: 0 0 0 232px; }
.points .items { display: flex; flex-direction: column; gap: 46px; }
.pairs .panel + .panel { padding: 0 72px; }
.pairs .items { display: grid; grid-template-columns: 1fr 1fr; gap: 56px; }
.pairs .item { gap: 24px; } .pairs .item p { font-size: 18px; }

.image-text .panel { padding: 42px 18px 41px; }
.image-text .title { max-width: 330px; }
.image-text .body { margin-top: auto; max-width: 340px; }
.checker { background: repeating-conic-gradient(var(--c1) 0 25%, var(--c2) 0 50%) 0 0 / var(--sq, 98px) var(--sq, 98px); }
.bleed { position: absolute; inset: 0; overflow: hidden; border-radius: inherit; }
.laptop { position: absolute; left: 484px; top: 40px; width: 820px; }
.lid { position: relative; height: 548px; background: #0B0B0B; border-radius: 24px 24px 0 0; padding: 18px 16px 0; }
.lid .screen { display: block; width: 100%; height: 510px; object-fit: cover; object-position: left center; border-bottom: 2px solid #2E2E2E; }
.notch { position: absolute; left: 50%; top: 18px; width: 96px; height: 18px; margin-left: -48px; background: #0B0B0B; border-radius: 0 0 7px 7px; }
.base { display: block; margin: 0 -84px; height: 24px; background: linear-gradient(#E6E6E6, #B9B9B9 55%, #8E8E8E); border-radius: 0 0 14px 14px / 0 0 12px 12px; }

.metrics .row, .team .row { flex: 1; display: grid; grid-template-columns: repeat(var(--n), 1fr); align-items: center; margin-top: -40px; }
.metrics .cell, .team .cell { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 18px; }
.metrics .cell b { font-size: 104px; font-weight: 300; letter-spacing: -.04em; line-height: 1; white-space: nowrap; }
.team .face { width: 124px; height: 124px; border-radius: 50%; object-fit: cover; --sq: 20px; --c1: #FBFAF7; --c2: #E3E1DA; }
.team .cell { gap: 0; } .team .cell .label { margin-top: 22px; } .team .cell span:last-child { margin-top: 6px; }

.timeline .steps { flex: 1; position: relative; display: grid; grid-template-columns: repeat(var(--n), 1fr); align-items: center; }
.step { position: relative; display: flex; flex-direction: column; padding-right: 24px; }
.step::before { content: ""; position: absolute; left: 0; right: 0; top: 112px; border-top: 1px solid currentColor; }
.step b { font-size: 64px; font-weight: 300; letter-spacing: -.03em; line-height: 1; height: 112px; display: flex; align-items: flex-end; padding-bottom: 30px; }
.step .dot { position: absolute; top: 106px; left: 0; width: 13px; height: 13px; }
.step .label { margin-top: 30px; }
.step span:last-child { margin-top: 8px; }

.table table { margin-top: 44px; width: 100%; border-collapse: collapse; }
.table th { text-align: left; padding: 0 16px 16px 0; font-size: 15px; font-weight: 600; letter-spacing: .07em; text-transform: uppercase; }
.table td { padding: 20px 16px 20px 0; border-top: 1px solid var(--rule); font-size: 22px; letter-spacing: -.02em; }
.table tr:last-child td { border-bottom: 1px solid var(--rule); }
.table td:first-child { font-weight: 600; }

.big .label-text { font-size: 80px; line-height: 1.06; font-weight: 500; letter-spacing: -.02em; max-width: 560px; }
.big p { margin-top: 26px; max-width: 460px; font-size: 22px; line-height: 1.4; font-weight: 300; }

.image .panel { bottom: var(--top); }
.image .media { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; border-radius: calc(var(--r) - 1px); }
.image .cap { position: absolute; left: var(--side); right: var(--side); bottom: 0; height: var(--top); display: flex; align-items: center;
  color: var(--frame-fg); font-size: 14px; font-weight: 500; letter-spacing: .04em; text-transform: uppercase; white-space: nowrap; overflow: hidden; }
`
}

/** The cover/closing title: bold line(s) over light line(s); a long light part drops to a smaller size. */
function mixed(tag, bold, light, ctx) {
  const lightCls = light && light.length > 28 ? 'sub small light' : 'sub display light'
  return `<${tag} class="display bold">${ctx.esc(bold)}</${tag}>${light ? `<p class="${lightCls}">${ctx.esc(light)}</p>` : ''}`
}

export const slides = {
  cover: (d, ctx) => page(ctx, 'ink', 'hero cover', mixed('h1', d.title, d.subtitle, ctx), d.eyebrow),

  agenda: (d, ctx) => page(ctx, 'night', 'hero agenda', `<h2 class="display">${ctx.esc(d.title)}</h2>
    <ol>${d.items.map((it, i) => `<li><span class="n">${i + 1}.</span><span>${ctx.esc(it)}</span></li>`).join('')}</ol>`),

  section: (d, ctx) => page(ctx, Number.parseInt(d.number, 10) % 2 === 0 ? 'paper' : 'ink', 'hero section',
    `<h2 class="display">${ctx.esc(d.title)}</h2>${d.subtitle ? `<p class="sub">${ctx.esc(d.subtitle)}</p>` : ''}
    <span class="giant" style="font-size:${giant(d.number)}px">${ctx.esc(d.number)}</span>`),

  statement: (d, ctx) => page(ctx, 'paper', 'hero statement',
    `${d.attribution ? `<p class="say bold">${ctx.esc(d.attribution)}</p>` : ''}<p class="say light">${ctx.esc(d.text)}</p>`),

  text: (d, ctx) => page(ctx, 'day', 'text', `<h2 class="title">${ctx.esc(d.title)}</h2>
    <div class="col">${d.eyebrow ? `<h3 class="caps">${ctx.esc(d.eyebrow)}</h3>` : ''}<p>${ctx.esc(d.body)}</p></div>`),

  points: (d, ctx) => `<section class="slide pr t-white split points">${meta(ctx)}<div class="panel"><h2 class="title">${ctx.esc(d.title)}</h2></div>
    <div class="panel"><div class="items">${d.items.map((it) => item(it.title, it.body, ctx)).join('')}</div></div></section>`,

  'image-text': (d, ctx) => page(ctx, 'day', 'image-text', `<h2 class="title">${ctx.esc(d.title)}</h2>
    <p class="body">${ctx.esc(d.body)}</p>${laptop(d.image, ctx)}`),

  metrics: (d, ctx) => page(ctx, 'day', 'content metrics', `<h2 class="title">${ctx.esc(d.title)}</h2>
    <div class="row" style="--n:${d.items.length}">${d.items.map((m) => `<div class="cell"><b>${ctx.esc(m.value)}</b><span class="label">${ctx.esc(m.label)}</span></div>`).join('')}</div>`),

  'two-column': (d, ctx) => `<section class="slide pr t-day split pairs">${meta(ctx)}<div class="panel"><h2 class="title">${ctx.esc(d.title)}</h2></div>
    <div class="panel"><div class="items">${d.columns.map((c) => item(c.title, c.body, ctx)).join('')}</div></div></section>`,

  timeline: (d, ctx) => page(ctx, 'night', 'content timeline', `<h2 class="title">${ctx.esc(d.title)}</h2>
    <div class="steps" style="--n:${d.steps.length}">${d.steps.map((s) => `<div class="step"><b>${ctx.esc(s.when)}</b><i class="dot"></i>
      <span class="label">${ctx.esc(s.title)}</span>${s.body ? `<span class="soft">${ctx.esc(s.body)}</span>` : ''}</div>`).join('')}</div>`),

  quote: (d, ctx) => page(ctx, 'ink', 'hero quote', `<p class="say light">“${ctx.esc(d.text)}”</p>
    <div class="who"><b class="caps">${ctx.esc(d.name)}</b>${d.role ? `<span>${ctx.esc(d.role)}</span>` : ''}</div>`),

  table: (d, ctx) => page(ctx, 'day', 'content table', `<h2 class="title">${ctx.esc(d.title)}</h2>
    <table><thead><tr>${d.columns.map((c) => `<th>${ctx.esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${d.rows.map((r) => `<tr>${r.map((c) => `<td>${ctx.esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`),

  'big-number': (d, ctx) => page(ctx, 'paper', 'hero big', `<h2 class="label-text">${ctx.esc(d.label)}</h2>${d.body ? `<p>${ctx.esc(d.body)}</p>` : ''}
    <span class="giant" style="font-size:${giant(d.value)}px">${ctx.esc(d.value)}</span>`),

  bullets: (d, ctx) => page(ctx, 'night', 'hero bullets', `<h2 class="display">${ctx.esc(d.title)}</h2>
    <ul>${d.items.map((it) => `<li><i class="dot"></i><span>${ctx.esc(it)}</span></li>`).join('')}</ul>`),

  team: (d, ctx) => page(ctx, 'day', 'content team', `<h2 class="title">${ctx.esc(d.title)}</h2>
    <div class="row" style="--n:${d.people.length}">${d.people.map((p) => `<div class="cell">${picture(p.image ?? { alt: p.name }, ctx, 'face')}
      <span class="label">${ctx.esc(p.name)}</span><span class="soft">${ctx.esc(p.role)}</span></div>`).join('')}</div>`),

  image: (d, ctx) => `<section class="slide pr t-ink image">${meta(ctx)}<div class="panel">${picture(d.image, ctx, 'media')}</div>
    ${d.caption ? `<p class="cap">${ctx.esc(d.caption)}</p>` : ''}</section>`,

  /** The titled content slide that `chart` and `custom` slides are drawn in. */
  frame: ({ title, eyebrow }, ctx, body) => page(ctx, 'day', 'content framed', `<div class="head">${eyebrow ? `<span class="label">${ctx.esc(eyebrow)}</span>` : ''}${title ? `<h2 class="title">${ctx.esc(title)}</h2>` : ''}</div>${body}`),

  closing: (d, ctx) => page(ctx, 'paper', 'hero closing', `${mixed('h2', d.title, d.subtitle, ctx)}${d.contact ? `<p class="foot">${ctx.esc(d.contact)}</p>` : ''}`),
}
