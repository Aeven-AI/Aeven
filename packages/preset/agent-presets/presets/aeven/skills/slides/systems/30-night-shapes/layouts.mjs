/**
 * Night Shapes: near-black slides, bold white grotesque titles with italic sub-lines, and flat
 * orange, royal-blue and yellow shapes (a four-lobe blob, a tilted square, grids of touching
 * circles, big discs) on black and on royal-blue panels. Company name and page number sit in the
 * bottom corners; thin white hairlines split compare slides.
 * Recreated from "Dark Themed Simple Slide Deck Presentation Template" by Geena (Figma Community).
 */

const pad2 = (n) => String(n).padStart(2, '0')

/** Four overlapping discs with a filled centre: the source's orange blob. */
const blob = (cls = '') => `<svg class="shape ${cls}" viewBox="0 0 200 200" aria-hidden="true"><g>
  <circle cx="56" cy="56" r="56"/><circle cx="144" cy="56" r="56"/><circle cx="56" cy="144" r="56"/><circle cx="144" cy="144" r="56"/><circle cx="100" cy="100" r="60"/></g></svg>`

/** The tilted square. */
const tilt = (cls = '') => `<svg class="shape ${cls}" viewBox="0 0 200 200" aria-hidden="true"><rect x="40" y="40" width="120" height="120" transform="rotate(32 100 100)"/></svg>`

/** The rising zig-zag arrow drawn as a blue stroke. */
const zigzag = (cls = '') => `<svg class="zig ${cls}" viewBox="0 0 120 90" aria-hidden="true"><polyline points="6,84 28,50 42,64 66,28 80,42 108,10"/><polyline points="88,10 108,10 108,30"/></svg>`

/**
 * A grid of touching circles: `rows` lists, per row, the column indexes that hold a circle.
 * Each cell is `size` px; the svg is positioned by the caller.
 */
function circleGrid(rows, size, cls = '') {
  const cols = Math.max(...rows.flat()) + 1
  const r = size / 2
  const discs = rows.flatMap((row, y) => row.map((x) => `<circle cx="${x * size + r}" cy="${y * size + r}" r="${r}"/>`)).join('')
  return `<svg class="grid ${cls}" width="${cols * size}" height="${rows.length * size}" viewBox="0 0 ${cols * size} ${rows.length * size}" aria-hidden="true">${discs}</svg>`
}

/** The cover's three traffic-light dots. */
const dots = '<div class="dots" aria-hidden="true"><i class="o"></i><i class="b"></i><i class="y"></i></div>'

/** Company name and page number in the bottom corners. */
const meta = (ctx, tone = '') => `<footer class="meta ${tone}"><span>${ctx.esc(ctx.deck.title)}</span><span>${pad2(ctx.index)}</span></footer>`

/** A user picture, or a royal-blue field with the system's shapes when the slot has none. */
function picture(image, ctx, cls, art = 'blob') {
  const src = ctx.image(image)
  if (src) return `<img class="${cls}" src="${ctx.esc(src)}" alt="${ctx.esc(image.alt)}">`
  const shapes = art === 'grid'
    ? `<span class="ph-disc"></span>${circleGrid([[1, 2], [0, 1, 2, 3], [1, 2, 3], [2]], 200, 'ph-grid')}`
    : `<span class="ph-disc"></span>${blob('ph-blob')}`
  return `<div class="${cls} ph ph-${art}" role="img" aria-label="${ctx.esc(image?.alt ?? '')}">${shapes}</div>`
}

const initials = (name) => name.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase()

export function css(system) {
  const s = system.surface
  return `
:root { --night: ${s.night}; --black: ${s.black}; --blue: ${s.blue}; --orange: ${s.orange}; --yellow: ${s.yellow};
  --yellow-deep: ${s.yellowDeep}; --dot-yellow: ${s.dotYellow}; --hair: rgba(255,255,255,.55); --soft: rgba(255,255,255,.16);
  --text: rgba(255,255,255,.84); --mx: 72px; }
.slide { background: var(--night); color: #fff; font-size: 19px; line-height: 1.5; }
.slide.black { background: var(--black); }
.slide.blue { background: var(--blue); }
.slide.orange { background: var(--orange); }
.t { font-family: var(--display-font); font-weight: 700; letter-spacing: -.022em; line-height: 1.04; }
.t-xl { font-size: 128px; letter-spacing: -.03em; line-height: 1; }
.t-l { font-size: 88px; letter-spacing: -.03em; line-height: 1; }
.t-m { font-size: 52px; }
.t-s { font-size: 30px; letter-spacing: -.012em; line-height: 1.15; }
.it { font-family: var(--display-font); font-style: italic; font-weight: 400; }
.text { color: var(--text); font-size: 19px; line-height: 1.5; }
.eyebrow { font-family: var(--display-font); font-weight: 700; font-size: 15px; }
.pad { position: absolute; inset: 60px var(--mx) 84px; display: flex; flex-direction: column; }
.meta { position: absolute; left: 56px; right: 56px; bottom: 28px; display: flex; justify-content: space-between; font-size: 13px; line-height: 1.4; color: rgba(255,255,255,.86); }
.meta.dark { color: var(--night); }

.shape, .grid { position: absolute; display: block; }
.shape g, .shape rect, .grid circle { fill: currentColor; }
.c-o { color: var(--orange); } .c-b { color: var(--blue); } .c-y { color: var(--yellow); } .c-n { color: var(--night); }
.zig { display: block; width: 120px; height: 90px; fill: none; stroke: var(--blue); stroke-width: 5; stroke-linejoin: miter; stroke-linecap: butt; }
.disc { position: absolute; border-radius: 50%; }
.dots { display: flex; gap: 14px; }
.dots i { width: 46px; height: 46px; border-radius: 50%; }
.dots .o { background: var(--orange); } .dots .b { background: var(--blue); } .dots .y { background: var(--dot-yellow); }
.dot { flex: none; width: 18px; height: 18px; border-radius: 50%; background: var(--blue); }
.dot.o { background: var(--orange); } .dot.y { background: var(--yellow); } .dot.w { background: #fff; }

/* Cover and closing: a giant night disc over a royal-blue field holding the shapes. */
.stage { background: var(--blue); }
.stage .moon { position: absolute; width: 1160px; height: 1160px; left: -250px; top: -220px; border-radius: 50%; background: var(--night); box-shadow: 0 0 0 1.5px #000; }
.stage .inner { position: absolute; left: 76px; top: 0; bottom: 0; width: 790px; display: flex; flex-direction: column; justify-content: center; }
.stage .dots { margin-bottom: 52px; }
.stage .sub { margin-top: 34px; font-size: 32px; line-height: 1.24; max-width: 700px; }
.stage .by { position: absolute; left: 76px; bottom: 56px; font-size: 20px; line-height: 1.3; }
.cover .disc { width: 380px; height: 380px; right: -120px; top: -130px; background: var(--yellow); }
.cover .blob { width: 280px; height: 280px; right: 40px; bottom: -60px; }
.closing .disc { width: 400px; height: 400px; right: -110px; bottom: -170px; background: var(--yellow); }
.closing .blob { width: 260px; height: 260px; right: 30px; top: -60px; }
.closing .contact { font-family: var(--display-font); font-style: normal; }

/* Agenda: two yellow discs, centred title, a dotted vertical line of items. */
.agenda .d1 { width: 470px; height: 470px; left: -170px; top: 18px; background: var(--yellow-deep); }
.agenda .d2 { width: 470px; height: 470px; left: -120px; top: 330px; background: var(--yellow); opacity: .94; }
.agenda h2 { position: absolute; left: 380px; top: 0; bottom: 0; width: 360px; display: flex; align-items: center; }
.agenda ol { position: absolute; left: 790px; right: var(--mx); top: 40px; bottom: 70px; list-style: none; display: flex; flex-direction: column; justify-content: center; }
.agenda li { position: relative; display: flex; gap: 26px; align-items: flex-start; padding: 13px 0; }
.agenda li::before { content: ""; position: absolute; left: 8px; top: 0; bottom: 0; border-left: 1.5px solid var(--hair); }
.agenda li:first-child::before { top: 24px; } .agenda li:last-child::before { bottom: calc(100% - 24px); }
.agenda .dot { position: relative; margin-top: 6px; }
.agenda li b { display: block; font-family: var(--display-font); font-size: 24px; line-height: 1.2; letter-spacing: -.01em; }
.agenda li small { display: block; font-size: 14px; line-height: 1.4; color: var(--text); margin-top: 2px; }

/* Section: royal-blue panel, white title, a night square tilted off the right edge. */
.section .num { font-family: var(--display-font); font-weight: 700; font-size: 30px; line-height: 1; }
.section .tilt { width: 760px; height: 760px; right: -250px; top: -20px; }
.section .disc { width: 190px; height: 190px; right: 300px; bottom: 70px; background: var(--orange); }
.section h2 { margin-top: auto; max-width: 720px; }
.section .sub { margin-top: 22px; font-size: 30px; line-height: 1.25; max-width: 640px; }

/* Statement: a grid of touching orange circles bleeding off the left, the line on the right. */
.statement .grid { left: -112px; top: -70px; }
.statement .say { position: absolute; right: var(--mx); top: 0; bottom: 0; width: 500px; text-align: center; display: flex; flex-direction: column; justify-content: center; }
.statement .say p { font-family: var(--display-font); font-weight: 700; font-size: 52px; line-height: 1.08; letter-spacing: -.022em; text-wrap: balance; }
.statement .say span { display: block; margin-top: 22px; font-size: 24px; line-height: 1.3; }

/* Text: a full-width hairline across the upper third, the arrow, heading and paragraph below. */
.text-slide .rule { position: absolute; left: 0; right: 0; top: 232px; border-top: 1.5px solid var(--hair); }
.text-slide .eyebrow { position: absolute; left: var(--mx); bottom: 512px; font-size: 20px; line-height: 1.3; }
.text-slide .stack { position: absolute; left: var(--mx); right: var(--mx); top: 286px; bottom: 84px; display: flex; flex-direction: column; }
.text-slide .zig { width: 104px; height: 78px; }
.text-slide h2 { margin-top: 34px; font-size: 60px; max-width: 900px; }
.text-slide .text { margin-top: 20px; max-width: 780px; font-size: 22px; line-height: 1.5; }

/* Columns split by full-height hairlines, each with its shape above a centred heading. */
.cols { position: absolute; inset: 0; display: grid; grid-template-columns: repeat(var(--n), 1fr); }
.cols .col { position: relative; display: flex; flex-direction: column; align-items: center; text-align: center; padding: 0 48px; }
.cols .col + .col { border-left: 1.5px solid var(--hair); }
.cols .art { position: relative; flex: none; width: 100%; }
.cols .art .shape { left: 50%; top: 50%; transform: translate(-50%, -50%); }
.cols h3 { font-family: var(--display-font); font-weight: 700; letter-spacing: -.012em; line-height: 1.15; }
.compare .art { height: 300px; margin-top: 150px; }
.compare .art .shape { width: 270px; height: 270px; }
.compare h3 { margin-top: 44px; font-size: 34px; }
.compare .text { margin-top: 14px; max-width: 420px; }
.compare .head { position: absolute; left: var(--mx); top: 60px; z-index: 1; font-size: 30px; }
.points .art { height: 220px; margin-top: 210px; }
.points .art .shape { width: 190px; height: 190px; }
.points .art .ring { position: absolute; left: 50%; top: 50%; width: 170px; height: 170px; transform: translate(-50%, -50%); border-radius: 50%; background: var(--yellow); }
.points h3 { margin-top: 40px; font-size: 30px; }
.points .text { margin-top: 10px; }
.points .head { position: absolute; left: var(--mx); top: 60px; z-index: 1; font-size: 30px; }

/* Image and text: the picture held in a rounded frame on the left. */
.image-text .media { position: absolute; left: var(--mx); top: 60px; bottom: 84px; width: 560px; border-radius: 28px; overflow: hidden; object-fit: cover; }
.image-text .copy { position: absolute; left: 720px; right: var(--mx); top: 0; bottom: 0; display: flex; flex-direction: column; justify-content: center; }
.image-text .zig { width: 92px; height: 69px; margin-bottom: 36px; }
.image-text .text { margin-top: 22px; font-size: 21px; }
.ph { position: relative; background: var(--blue); overflow: hidden; }
.ph-disc { position: absolute; border-radius: 50%; background: var(--yellow); }
.ph-blob .ph-disc { width: 60%; aspect-ratio: 1; right: -22%; bottom: -14%; }
.ph-blob .ph-blob { color: var(--orange); width: 58%; height: auto; aspect-ratio: 1; left: 12%; top: 16%; }
.ph-grid .ph-disc { width: 480px; height: 480px; right: -120px; top: -160px; }
.ph-grid .ph-grid { color: var(--orange); left: -60px; bottom: -110px; }

/* Titled content slides. */
.head-l { flex: none; }
.metrics-row { margin-top: auto; display: grid; grid-template-columns: repeat(var(--n), 1fr); }
.metric { display: flex; flex-direction: column; gap: 18px; padding: 8px 24px 0 32px; }
.metric:first-child { padding-left: 0; }
.metric + .metric { border-left: 1.5px solid var(--hair); }
.metric b { font-family: var(--display-font); font-size: 88px; font-weight: 700; letter-spacing: -.04em; line-height: .95; font-variant-numeric: tabular-nums; }
.metric span { display: flex; gap: 12px; align-items: center; font-size: 18px; line-height: 1.35; color: var(--text); }
.metric .dot { width: 14px; height: 14px; }
.metrics .disc { width: 300px; height: 300px; right: -90px; top: -110px; background: var(--yellow); }

.timeline-row { margin-top: auto; margin-bottom: auto; position: relative; display: grid; grid-template-columns: repeat(var(--n), 1fr); gap: 24px; }
.timeline-row::before { content: ""; position: absolute; left: 0; right: 0; top: 71px; border-top: 1.5px solid var(--hair); }
.step { display: flex; flex-direction: column; }
.step .when { font-size: 22px; font-family: var(--display-font); font-style: italic; line-height: 1.3; height: 50px; }
.step .dot { position: relative; margin: 12px 0 26px; }
.step b { font-family: var(--display-font); font-size: 36px; letter-spacing: -.012em; line-height: 1.15; }
.step .desc { margin-top: 10px; font-size: 19px; line-height: 1.45; color: var(--text); max-width: 240px; }
.timeline .zig { position: absolute; right: var(--mx); top: 60px; }

.quote .tilt { width: 640px; height: 640px; right: -170px; top: 40px; }
.quote .words { position: absolute; left: var(--mx); top: 0; bottom: 0; width: 760px; display: flex; flex-direction: column; justify-content: center; }
.quote .words p { font-family: var(--display-font); font-weight: 700; font-size: 50px; line-height: 1.1; letter-spacing: -.022em; text-wrap: balance; }
.quote .by { margin-top: 36px; display: flex; flex-direction: column; gap: 4px; }
.quote .by b { font-family: var(--display-font); font-size: 24px; line-height: 1.25; }
.quote .by span { font-size: 22px; line-height: 1.3; color: var(--text); }

table { margin-top: auto; width: 100%; border-collapse: collapse; font-size: 20px; line-height: 1.35; }
th { text-align: left; font-family: var(--display-font); font-weight: 700; font-size: 22px; padding: 0 16px 18px 0; border-bottom: 1.5px solid var(--hair); }
td { padding: 20px 16px 20px 0; border-bottom: 1px solid var(--soft); color: var(--text); font-variant-numeric: tabular-nums; }
td:first-child { color: #fff; font-family: var(--display-font); font-weight: 700; }
td:first-child .dot { display: inline-block; vertical-align: middle; width: 12px; height: 12px; margin: -3px 14px 0 0; }

.big { color: var(--night); }
.big .disc { width: 560px; height: 560px; right: -150px; bottom: -230px; background: var(--night); }
.big .disc.y { width: 230px; height: 230px; right: 330px; bottom: -70px; background: var(--yellow); }
.big b { position: absolute; left: 64px; top: 30px; font-family: var(--display-font); font-size: 360px; font-weight: 700; letter-spacing: -.05em; line-height: 1; }
.big .what { position: absolute; left: var(--mx); bottom: 96px; width: 600px; }
.big .what p { margin-top: 14px; font-size: 24px; line-height: 1.38; color: var(--night); }

.bullets .split { position: absolute; inset: 60px var(--mx) 84px; display: grid; grid-template-columns: 1fr 1.25fr; gap: 72px; align-items: center; }
.bullets .left { display: flex; flex-direction: column; gap: 40px; }
.bullets ul { list-style: none; }
.bullets li { display: flex; gap: 22px; align-items: baseline; padding: 20px 0; border-top: 1.5px solid var(--hair); font-size: 24px; line-height: 1.35; }
.bullets li:last-child { border-bottom: 1.5px solid var(--hair); }
.bullets li .dot { position: relative; top: 1px; width: 14px; height: 14px; }

.people { margin-top: auto; display: grid; grid-template-columns: repeat(var(--n), 1fr); gap: 32px; }
.person { display: flex; flex-direction: column; align-items: flex-start; }
.avatar { position: relative; width: 200px; height: 200px; border-radius: 50%; overflow: hidden; object-fit: cover; display: grid; place-items: center; font-family: var(--display-font); font-weight: 700; font-size: 60px; letter-spacing: -.02em; line-height: 1; }
.avatar.o { background: var(--orange); } .avatar.b { background: var(--blue); } .avatar.y { background: var(--yellow); color: var(--night); }
.person b { margin-top: 26px; font-family: var(--display-font); font-size: 26px; line-height: 1.2; letter-spacing: -.01em; }
.person span { margin-top: 4px; font-size: 20px; line-height: 1.3; color: var(--text); }

.full .media { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.full .cap { position: absolute; left: 0; bottom: 64px; max-width: 760px; padding: 18px 32px 18px var(--mx); background: var(--night); font-size: 24px; line-height: 1.3; }

.framed .avn-body { margin-top: 32px; }
.framed .avn-caption { color: var(--text); font-family: var(--display-font); font-style: italic; font-size: 17px; }
`
}

const head = (title, ctx, eyebrow) => `<div class="head-l">${eyebrow ? `<p class="eyebrow">${ctx.esc(eyebrow)}</p>` : ''}${title ? `<h2 class="t t-m"${eyebrow ? ' style="margin-top:10px"' : ''}>${ctx.esc(title)}</h2>` : ''}</div>`

const tones = ['o', 'b', 'y']

export const slides = {
  cover: (d, ctx) => `<section class="slide stage cover"><span class="disc"></span>${blob('blob c-o')}<span class="moon"></span>
    <div class="inner">${dots}<h1 class="t t-xl">${ctx.esc(d.title)}</h1>${d.subtitle ? `<p class="it sub">${ctx.esc(d.subtitle)}</p>` : ''}</div>
    ${d.eyebrow ? `<p class="by">${ctx.esc(d.eyebrow)}</p>` : ''}</section>`,

  agenda: (d, ctx) => `<section class="slide agenda"><span class="disc d1"></span><span class="disc d2"></span>
    <h2 class="t t-l">${ctx.esc(d.title)}</h2>
    <ol>${d.items.map((item, i) => `<li><span class="dot${i === 0 ? ' o' : ''}"></span><div><b>${ctx.esc(item)}</b><small>${pad2(i + 1)}</small></div></li>`).join('')}</ol>${meta(ctx)}</section>`,

  section: (d, ctx) => `<section class="slide blue section">${tilt('tilt c-n')}<span class="disc"></span>
    <div class="pad"><span class="num">${ctx.esc(d.number)}</span><h2 class="t t-l">${ctx.esc(d.title)}</h2>${d.subtitle ? `<p class="it sub">${ctx.esc(d.subtitle)}</p>` : ''}</div>${meta(ctx)}</section>`,

  statement: (d, ctx) => `<section class="slide statement">${circleGrid([[1, 2, 3], [0, 1, 2, 3], [1, 2, 3], [2]], 196, 'c-o')}
    <div class="say"><p>${ctx.esc(d.text)}</p>${d.attribution ? `<span class="it">${ctx.esc(d.attribution)}</span>` : ''}</div>${meta(ctx)}</section>`,

  text: (d, ctx) => `<section class="slide text-slide">${d.eyebrow ? `<p class="eyebrow">${ctx.esc(d.eyebrow)}</p>` : ''}<span class="rule"></span>
    <div class="stack">${zigzag()}<h2 class="t t-m">${ctx.esc(d.title)}</h2><p class="text">${ctx.esc(d.body)}</p></div>${meta(ctx)}</section>`,

  points: (d, ctx) => {
    const art = [blob('c-o'), tilt('c-b'), '<span class="ring"></span>']
    return `<section class="slide points"><h2 class="t t-s head">${ctx.esc(d.title)}</h2><div class="cols" style="--n:${d.items.length}">${d.items.map((item, i) => `<div class="col"><div class="art">${art[i % 3]}</div>
      <h3>${ctx.esc(item.title)}</h3><p class="text">${ctx.esc(item.body)}</p></div>`).join('')}</div>${meta(ctx)}</section>`
  },

  'image-text': (d, ctx) => `<section class="slide black image-text">${picture(d.image, ctx, 'media')}
    <div class="copy">${zigzag()}<h2 class="t t-m">${ctx.esc(d.title)}</h2><p class="text">${ctx.esc(d.body)}</p></div>${meta(ctx)}</section>`,

  metrics: (d, ctx) => `<section class="slide metrics"><span class="disc"></span><div class="pad">${head(d.title, ctx)}
    <div class="metrics-row" style="--n:${d.items.length}">${d.items.map((m, i) => `<div class="metric"><b>${ctx.esc(m.value)}</b><span><i class="dot ${tones[i % 3]}"></i>${ctx.esc(m.label)}</span></div>`).join('')}</div></div>${meta(ctx)}</section>`,

  'two-column': (d, ctx) => `<section class="slide compare"><h2 class="t t-s head">${ctx.esc(d.title)}</h2><div class="cols" style="--n:2">${d.columns.map((c, i) => `<div class="col"><div class="art">${i % 2 ? tilt('c-b') : blob('c-o')}</div>
    <h3>${ctx.esc(c.title)}</h3><p class="text">${ctx.esc(c.body)}</p></div>`).join('')}</div>${meta(ctx)}</section>`,

  timeline: (d, ctx) => `<section class="slide timeline">${zigzag()}<div class="pad">${head(d.title, ctx)}
    <div class="timeline-row" style="--n:${d.steps.length}">${d.steps.map((s, i) => `<div class="step"><span class="when">${ctx.esc(s.when)}</span><span class="dot${i === 0 ? ' o' : ''}"></span><b>${ctx.esc(s.title)}</b>${s.body ? `<span class="desc">${ctx.esc(s.body)}</span>` : ''}</div>`).join('')}</div></div>${meta(ctx)}</section>`,

  quote: (d, ctx) => `<section class="slide black quote">${tilt('tilt c-b')}<div class="words"><p>${ctx.esc(d.text)}</p>
    <div class="by"><b>${ctx.esc(d.name)}</b>${d.role ? `<span class="it">${ctx.esc(d.role)}</span>` : ''}</div></div>${meta(ctx)}</section>`,

  table: (d, ctx) => `<section class="slide"><div class="pad">${head(d.title, ctx)}
    <table><thead><tr>${d.columns.map((c) => `<th>${ctx.esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${d.rows.map((r, i) => `<tr>${r.map((c, j) => `<td>${j === 0 ? `<i class="dot ${tones[i % 3]}"></i>` : ''}${ctx.esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${meta(ctx)}</section>`,

  'big-number': (d, ctx) => `<section class="slide orange big"><span class="disc"></span><span class="disc y"></span><b>${ctx.esc(d.value)}</b>
    <div class="what"><h2 class="t t-m">${ctx.esc(d.label)}</h2>${d.body ? `<p class="it">${ctx.esc(d.body)}</p>` : ''}</div>${meta(ctx, 'dark')}</section>`,

  bullets: (d, ctx) => `<section class="slide bullets"><div class="split"><div class="left">${zigzag()}<h2 class="t t-m">${ctx.esc(d.title)}</h2></div>
    <ul>${d.items.map((item, i) => `<li><i class="dot ${tones[i % 3]}"></i><span>${ctx.esc(item)}</span></li>`).join('')}</ul></div>${meta(ctx)}</section>`,

  team: (d, ctx) => `<section class="slide"><div class="pad">${head(d.title, ctx)}
    <div class="people" style="--n:${d.people.length}">${d.people.map((p, i) => {
      const src = p.image && ctx.image(p.image)
      const face = src
        ? `<img class="avatar" src="${ctx.esc(src)}" alt="${ctx.esc(p.name)}">`
        : `<div class="avatar ${tones[i % 3]}" role="img" aria-label="${ctx.esc(p.name)}">${ctx.esc(initials(p.name))}</div>`
      return `<div class="person">${face}<b>${ctx.esc(p.name)}</b><span class="it">${ctx.esc(p.role)}</span></div>`
    }).join('')}</div></div>${meta(ctx)}</section>`,

  image: (d, ctx) => `<section class="slide full">${picture(d.image, ctx, 'media', 'grid')}${d.caption ? `<p class="cap it">${ctx.esc(d.caption)}</p>` : ''}</section>`,

  /** The titled content slide that `chart` and `custom` slides are drawn in. */
  frame: ({ title, eyebrow }, ctx, body) => `<section class="slide framed"><div class="pad">${head(title, ctx, eyebrow)}${body}</div>${meta(ctx)}</section>`,

  closing: (d, ctx) => `<section class="slide stage closing"><span class="disc"></span>${blob('blob c-o')}<span class="moon"></span>
    <div class="inner">${dots}<h2 class="t t-xl">${ctx.esc(d.title)}</h2>${d.subtitle ? `<p class="it sub">${ctx.esc(d.subtitle)}</p>` : ''}</div>
    ${d.contact ? `<p class="by contact">${ctx.esc(d.contact)}</p>` : ''}</section>`,
}
