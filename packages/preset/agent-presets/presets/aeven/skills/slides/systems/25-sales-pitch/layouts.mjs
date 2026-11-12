/**
 * Sales Pitch: black cover with a mint-over-green two-tone title and two mint corner dots; flat
 * grey, pale mint and green panels that split slides in half; DM Sans semibold headers top left
 * over light subtitles; round placeholders; a running "company / deck" footer in small caps.
 * Measured from the 15 ripped frames of "Sales Pitch" (Figma Community), scaled ×1.28.
 */

const upper = (text) => String(text ?? '').toUpperCase()

/** The checkered "drop your image here" field the source uses for every empty image slot. */
const placeholder = (cls, label, ctx) => `<div class="${cls} ph" role="img" aria-label="${ctx.esc(label ?? '')}"></div>`

/** A user picture, or the checkered placeholder when the slot has none. */
function picture(image, ctx, cls) {
  const src = ctx.image(image)
  return src
    ? `<img class="${cls}" src="${ctx.esc(src)}" alt="${ctx.esc(image?.alt ?? '')}">`
    : placeholder(cls, image?.alt, ctx)
}

/**
 * The running footer: presenter (company) on the left, deck title on the right. `span` picks
 * where the second label sits: `wide` at the source's 41% mark, `half` at the right edge of a
 * left half panel, `full` at the slide's right edge.
 */
function footer(ctx, span = 'wide', first) {
  const left = first ?? upper(ctx.deck.presenter)
  return `<footer class="ft ${span}"><span>${ctx.esc(left)}</span><span>${ctx.esc(upper(ctx.deck.title))}</span></footer>`
}

const header = (text, ctx) => (text ? `<h2 class="hd">${ctx.esc(text)}</h2>` : '')

/** The cover/closing title: the first half of the words in mint, the rest in green, on two lines. */
function twoTone(title, ctx) {
  const words = String(title).trim().split(/\s+/)
  const cut = Math.max(1, Math.floor(words.length / 2))
  const lines = words.length > 1 ? [words.slice(0, cut).join(' '), words.slice(cut).join(' ')] : [words[0]]
  const longest = Math.max(...lines.map((l) => l.length))
  const size = Math.round(Math.min(142, 1224 / (longest * 0.6)))
  return `<h1 class="tone" style="font-size:${size}px">${lines.map((l, i) => `<span class="${i ? 'g' : 'm'}">${ctx.esc(l)}</span>`).join('')}</h1>`
}

/** A display size that keeps the longest word of `text` inside `width` at the given ceiling. */
function fitWord(text, width, max, em = 0.6) {
  const longest = Math.max(...String(text).split(/\s+/).map((w) => w.length))
  return Math.round(Math.min(max, width / (longest * em)))
}

export function css(system) {
  const s = system.surface
  return `
:root { --black: ${s.black}; --grey: ${s.grey}; --mint: ${s.mint}; --green: ${s.green}; --ck1: ${s.check[0]}; --ck2: ${s.check[1]}; --m: 28px; }
.slide { background: var(--grey); color: #000; font-size: 18px; line-height: 1.33; }
.slide.mint { background: var(--mint); }
.slide.green { background: var(--green); }
.slide.dark { background: var(--black); color: #fff; }

.hd { position: absolute; left: var(--m); top: 11px; font-size: 35px; font-weight: 600; letter-spacing: -.01em; line-height: 1.2; text-wrap: nowrap; max-width: 1080px; }
.lead { font-size: 46px; font-weight: 300; line-height: 1.2; letter-spacing: -.01em; }
.copy { font-size: 18px; line-height: 1.33; }

.ft { position: absolute; left: var(--m); bottom: 15px; display: flex; font-size: 15px; line-height: 1.2; text-transform: uppercase; }
.ft span { white-space: nowrap; }
.ft.wide span:first-child { width: 503px; }
.ft.half { width: 584px; justify-content: space-between; }
.ft.full { right: var(--m); justify-content: space-between; }

.ph { background: repeating-conic-gradient(var(--ck1) 0 25%, var(--ck2) 0 50%) 0 0 / 90px 90px; }
.ph.fine { background-size: 32px 32px; }
img.shot, img.face, img.fill { object-fit: cover; }

.panel { position: absolute; top: 0; bottom: 0; }
.panel.l { left: 0; width: 640px; } .panel.r { left: 640px; right: 0; }
.panel.grey { background: var(--grey); } .panel.mint { background: var(--mint); } .panel.green { background: var(--green); } .panel.dark { background: var(--black); color: #fff; }

/* cover and closing */
.tone { position: absolute; left: 26px; top: 6px; font-family: var(--display-font); font-weight: 600; line-height: 1.02; letter-spacing: -.012em; }
.tone span { display: block; white-space: nowrap; }
.tone .m { color: var(--mint); } .tone .g { color: var(--green); }
.meta { position: absolute; left: var(--m); bottom: 150px; font-size: 29px; font-weight: 300; line-height: 1.36; max-width: 1100px; }
.meta .cap { text-transform: uppercase; }
.dot { position: absolute; width: 66px; height: 66px; border-radius: 50%; background: var(--mint); bottom: 14px; }
.dot.a { left: 26px; } .dot.b { right: 27px; }

/* agenda */
.agenda-title { position: absolute; left: 26px; top: 6px; width: 600px; font-weight: 700; line-height: .92; letter-spacing: -.02em; }
.agenda-list { position: absolute; left: 640px; right: 0; top: 0; bottom: 0; display: flex; flex-direction: column; justify-content: center; align-items: center; list-style: none; font-size: 30px; font-weight: 300; line-height: 1.28; text-align: center; padding: 0 60px; }
.pin { position: absolute; right: 26px; width: 20px; height: 20px; border-radius: 50%; background: #000; }
.pin.t { top: 22px; } .pin.b { bottom: 25px; }

/* section */
.section .no { font-variant-numeric: tabular-nums; }
.section h1 { position: absolute; left: 24px; top: 128px; right: var(--m); font-weight: 700; line-height: .92; letter-spacing: -.02em; }
.section .lead { position: absolute; left: var(--m); bottom: 78px; max-width: 900px; }

/* statement */
.statement p { position: absolute; left: var(--m); top: 140px; max-width: 1060px; font-size: 68px; font-weight: 300; line-height: 1.16; letter-spacing: -.015em; text-wrap: balance; }

/* text, image-text, two-column: light subtitle + body */
.stack { position: absolute; left: var(--m); top: 143px; display: flex; flex-direction: column; gap: 36px; }
.stack .copy { max-width: 440px; }
.text .stack { max-width: 980px; }
.text .stack .copy { max-width: 780px; font-size: 24px; line-height: 1.3; }

/* points: Challenge #1/#2/#3 columns */
.cols { position: absolute; left: var(--m); right: var(--m); top: 214px; display: grid; grid-template-columns: repeat(var(--n), 1fr); gap: 52px; }
.cols h3 { font-size: 33px; font-weight: 300; line-height: 1.2; margin-bottom: 26px; }
.cols p { font-size: 24px; line-height: 1.3; }

/* image-text and two-column halves */
.frame-r { position: absolute; left: 704px; top: 150px; width: 512px; height: 384px; }
.half-col { position: absolute; top: 143px; left: var(--m); width: 540px; display: flex; flex-direction: column; gap: 32px; }
.panel.r .half-col { left: 64px; }
.half-col .copy { font-size: 22px; line-height: 1.33; max-width: 500px; }

/* metrics */
.figs { position: absolute; left: var(--m); right: var(--m); top: 250px; display: grid; grid-template-columns: repeat(var(--n), 1fr); gap: 24px; text-align: center; }
.figs b { display: block; font-size: 112px; font-weight: 600; line-height: 1.02; letter-spacing: -.03em; color: var(--mint); font-variant-numeric: tabular-nums; white-space: nowrap; }
.figs span { display: block; margin-top: 14px; font-size: 22px; font-weight: 300; line-height: 1.3; }

/* timeline */
.steps { position: absolute; left: var(--m); right: var(--m); top: 200px; display: grid; grid-template-columns: repeat(var(--n), 1fr); gap: 40px; }
.steps::before { content: ""; position: absolute; left: 0; right: 0; top: 86px; border-top: 1px solid #000; }
.step .when { display: block; height: 66px; font-size: 46px; font-weight: 300; line-height: 1.2; white-space: nowrap; }
.step i { position: relative; display: block; width: 20px; height: 20px; margin: 10px 0 26px; border-radius: 50%; background: #000; }
.step b { display: block; font-size: 26px; font-weight: 500; line-height: 1.25; }
.step p { margin-top: 8px; font-size: 18px; }

/* quote */
.quote blockquote { position: absolute; left: 44px; top: 14px; right: 40px; font-weight: 600; line-height: 1.0; letter-spacing: -.012em; color: var(--mint); text-wrap: balance; }
.quote .by { position: absolute; left: 774px; top: 495px; display: flex; align-items: center; gap: 18px; font-size: 29px; font-weight: 300; line-height: 1.3; color: var(--mint); }
.quote .face { flex: none; width: 64px; height: 64px; border-radius: 50%; }
.quote .face.ph { background-size: 16px 16px; }

/* table */
table { position: absolute; left: var(--m); right: var(--m); top: 150px; width: calc(100% - 56px); border-collapse: collapse; }
th { text-align: left; font-size: 15px; font-weight: 400; text-transform: uppercase; padding: 0 16px 14px 0; }
td { font-size: 26px; font-weight: 300; line-height: 1.25; padding: 18px 16px 18px 0; border-top: 1px solid #000; font-variant-numeric: tabular-nums; }
td:first-child { font-weight: 500; }

/* big number */
.big b { position: absolute; left: 0; width: 640px; top: 0; bottom: 0; display: flex; align-items: center; justify-content: center; font-weight: 600; letter-spacing: -.04em; line-height: 1; white-space: nowrap; }
.big .half-col { left: 704px; top: 0; bottom: 0; justify-content: center; width: 500px; }
.big .half-col .copy { color: #fff; }

/* bullets */
.list { position: absolute; left: var(--m); top: 143px; max-width: 1000px; list-style: none; display: flex; flex-direction: column; gap: 18px; }
.list li { display: flex; align-items: baseline; gap: 22px; font-size: 38px; font-weight: 300; line-height: 1.2; }
.list li::before { content: ""; flex: none; width: 16px; height: 16px; border-radius: 50%; background: #000; transform: translateY(-6px); }

/* team */
.people { position: absolute; left: var(--m); right: var(--m); top: 164px; display: grid; grid-template-columns: repeat(var(--n), 1fr); gap: 24px; justify-items: center; text-align: center; }
.people .face { width: 192px; height: 192px; border-radius: 50%; }
.people b, .people span { display: block; font-size: 15px; font-weight: 400; line-height: 1.33; text-transform: uppercase; }
.people b { margin-top: 30px; }

/* image */
.full .fill { position: absolute; left: 17px; right: 17px; top: 17px; bottom: 48px; width: calc(100% - 34px); height: calc(100% - 65px); }

/* frame (chart, custom) */
.framed .tag { position: absolute; right: var(--m); top: 24px; font-size: 15px; text-transform: uppercase; line-height: 1.2; }
.framed .area { position: absolute; left: var(--m); right: var(--m); top: 96px; bottom: 60px; display: flex; flex-direction: column; }
`
}

export const slides = {
  cover: (d, ctx) => `<section class="slide dark cover">${twoTone(d.title, ctx)}
    <div class="meta">${d.eyebrow ? `<p class="cap">${ctx.esc(d.eyebrow)}</p>` : ''}${d.subtitle ? `<p>${ctx.esc(d.subtitle)}</p>` : ''}${ctx.deck.date ? `<p>${ctx.esc(ctx.deck.date)}</p>` : ''}</div>
    <i class="dot a"></i><i class="dot b"></i></section>`,

  agenda: (d, ctx) => `<section class="slide agenda"><div class="panel r mint"></div>
    <h1 class="agenda-title" style="font-size:${fitWord(d.title, 580, 146)}px">${ctx.esc(d.title)}</h1>
    <ol class="agenda-list">${d.items.map((item) => `<li>${ctx.esc(item)}</li>`).join('')}</ol>
    <i class="pin t"></i><i class="pin b"></i>${footer(ctx, 'half')}</section>`,

  section: (d, ctx) => `<section class="slide green section"><h2 class="hd no">${ctx.esc(d.number)}</h2>
    <h1 style="font-size:${fitWord(d.title, 1224, 146)}px">${ctx.esc(d.title)}</h1>
    ${d.subtitle ? `<p class="lead">${ctx.esc(d.subtitle)}</p>` : ''}${footer(ctx)}</section>`,

  statement: (d, ctx) => `<section class="slide dark statement">${header(d.attribution, ctx)}
    <p>${ctx.esc(d.text)}</p>${footer(ctx)}</section>`,

  text: (d, ctx) => `<section class="slide text">${header(d.eyebrow, ctx)}
    <div class="stack"><h3 class="lead">${ctx.esc(d.title)}</h3><p class="copy">${ctx.esc(d.body)}</p></div>${footer(ctx)}</section>`,

  points: (d, ctx) => `<section class="slide points">${header(d.title, ctx)}
    <div class="cols" style="--n:${d.items.length}">${d.items.map((item) => `<div><h3>${ctx.esc(item.title)}</h3><p>${ctx.esc(item.body)}</p></div>`).join('')}</div>${footer(ctx)}</section>`,

  'image-text': (d, ctx) => `<section class="slide image-text"><div class="panel r green"></div>
    <div class="half-col"><h3 class="lead">${ctx.esc(d.title)}</h3><p class="copy">${ctx.esc(d.body)}</p></div>
    ${picture(d.image, ctx, 'frame-r shot')}${footer(ctx, 'half')}</section>`,

  metrics: (d, ctx) => `<section class="slide dark metrics">${header(d.title, ctx)}
    <div class="figs" style="--n:${d.items.length}">${d.items.map((m) => `<div><b>${ctx.esc(m.value)}</b><span>${ctx.esc(m.label)}</span></div>`).join('')}</div>${footer(ctx)}</section>`,

  'two-column': (d, ctx) => `<section class="slide two-column">${header(d.title, ctx)}
    <div class="panel r green">${(() => { const c = d.columns[1]; return `<div class="half-col"><h3 class="lead">${ctx.esc(c.title)}</h3><p class="copy">${ctx.esc(c.body)}</p></div>` })()}</div>
    <div class="half-col"><h3 class="lead">${ctx.esc(d.columns[0].title)}</h3><p class="copy">${ctx.esc(d.columns[0].body)}</p></div>${footer(ctx, 'half')}</section>`,

  timeline: (d, ctx) => `<section class="slide mint timeline">${header(d.title, ctx)}
    <div class="steps" style="--n:${d.steps.length}">${d.steps.map((s) => `<div class="step"><span class="when">${ctx.esc(s.when)}</span><i></i><b>${ctx.esc(s.title)}</b>${s.body ? `<p>${ctx.esc(s.body)}</p>` : ''}</div>`).join('')}</div>${footer(ctx)}</section>`,

  quote: (d, ctx) => {
    const size = Math.round(Math.min(137, 0.92 * Math.sqrt(1008363 / d.text.length)))
    return `<section class="slide dark quote"><blockquote style="font-size:${size}px">“${ctx.esc(d.text)}”</blockquote>
    <div class="by">${placeholder('face', d.name, ctx)}<div><p>${ctx.esc(d.name)}</p>${d.role ? `<p>${ctx.esc(d.role)}</p>` : ''}</div></div>${footer(ctx)}</section>`
  },

  table: (d, ctx) => `<section class="slide table">${header(d.title, ctx)}
    <table><thead><tr>${d.columns.map((c) => `<th>${ctx.esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${d.rows.map((r) => `<tr>${r.map((c) => `<td>${ctx.esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>${footer(ctx)}</section>`,

  'big-number': (d, ctx) => `<section class="slide dark big"><div class="panel l green"></div>
    <b style="font-size:${Math.round(Math.min(300, 560 / (String(d.value).length * 0.62)))}px;color:#000">${ctx.esc(d.value)}</b>
    <div class="half-col"><h3 class="lead">${ctx.esc(d.label)}</h3>${d.body ? `<p class="copy">${ctx.esc(d.body)}</p>` : ''}</div>${footer(ctx, 'half')}</section>`,

  bullets: (d, ctx) => `<section class="slide mint bullets">${header(d.title, ctx)}
    <ul class="list">${d.items.map((item) => `<li>${ctx.esc(item)}</li>`).join('')}</ul>${footer(ctx)}</section>`,

  team: (d, ctx) => `<section class="slide mint team">${header(d.title, ctx)}
    <div class="people" style="--n:${d.people.length}">${d.people.map((p) => {
      const src = p.image && ctx.image(p.image)
      const face = src ? `<img class="face" src="${ctx.esc(src)}" alt="${ctx.esc(p.name)}">` : placeholder('face fine', p.name, ctx)
      return `<div>${face}<b>${ctx.esc(p.name)}</b><span>${ctx.esc(p.role)}</span></div>`
    }).join('')}</div>${footer(ctx)}</section>`,

  image: (d, ctx) => `<section class="slide dark full">${picture(d.image, ctx, 'fill')}${footer(ctx, 'full', d.caption ?? upper(ctx.deck.presenter))}</section>`,

  /** The titled content slide that `chart` and `custom` slides are drawn in. */
  frame: ({ title, eyebrow }, ctx, body) => `<section class="slide framed">${header(title, ctx)}${eyebrow ? `<span class="tag">${ctx.esc(eyebrow)}</span>` : ''}
    <div class="area">${body}</div>${footer(ctx)}</section>`,

  closing: (d, ctx) => `<section class="slide dark closing">${twoTone(d.title, ctx)}
    <div class="meta">${d.subtitle ? `<p class="cap">${ctx.esc(d.subtitle)}</p>` : ''}${d.contact ? `<p>${ctx.esc(d.contact)}</p>` : ''}</div>
    <i class="dot a"></i><i class="dot b"></i></section>`,
}
