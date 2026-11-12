/**
 * Design Portfolio: one deep green on off-white. Checkerboard stripe covers and dividers, 20px
 * green bars between rows, a centre hairline that splits slides in halves, huge monospaced caps
 * titles, big green pill labels, small label-left/content-right rows and three-part corner meta.
 * Measured from the 16 frames of "Design Portfolio" (Figma Community), geometry scaled ×1.28.
 */

/** Roboto Mono advance (0.6em) with the titles' -0.03em tracking. */
const ADVANCE = 0.57

/** Greedy word wrap at `cpl` characters per line. */
function wrap(words, cpl) {
  const lines = []
  let line = ''
  for (const word of words) {
    if (!line) line = word
    else if (line.length + 1 + word.length <= cpl) line += ` ${word}`
    else { lines.push(line); line = word }
  }
  if (line) lines.push(line)
  return lines
}

/** The largest monospaced title size (px) at which `text` fits `width` in `maxLines` lines. */
function fitMono(text, width, max, { lines = 1, min = 36 } = {}) {
  const words = String(text).split(/\s+/).filter(Boolean)
  for (let size = max; size > min; size -= 2) {
    const cpl = Math.floor(width / (ADVANCE * size))
    if (words.every((w) => w.length <= cpl) && wrap(words, cpl).length <= lines) return size
  }
  return min
}

/** A grotesque size (px) for the longest of `texts` on one line of `width`, between min and max. */
const fitText = (texts, width, max, min) => Math.max(min, Math.min(max, Math.floor(width / (0.5 * Math.max(...texts.map((t) => String(t).length), 1)))))

/** A title split in two lines at the word boundary that balances them (the cover's two bands). */
function twoLines(text) {
  const words = String(text).split(/\s+/).filter(Boolean)
  if (words.length < 2) return [words.join(' '), '']
  let best = [words.join(' '), '']
  let worst = Infinity
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ')
    const b = words.slice(i).join(' ')
    if (Math.max(a.length, b.length) < worst) { worst = Math.max(a.length, b.length); best = [a, b] }
  }
  return best
}

const num = (i) => String(i + 1).padStart(2, '0')

/** The three-part corner meta: presenter | date on the left half, caption and deck title on the right. */
function foot(ctx, caption) {
  const { deck } = ctx
  return `<footer class="foot"><div class="foot-l"><span>${ctx.esc(deck.presenter ?? '')}</span><span>${ctx.esc(deck.date ?? '')}</span></div>
    <div class="foot-r">${caption ? `<span class="foot-cap">${ctx.esc(caption)}</span>` : ''}<span>${ctx.esc(deck.title ?? '')}</span></div></footer>`
}

/** The source's empty-image look: a rounded frame with a faint transparency checker. */
const placeholder = (alt, ctx, cls = '') => `<div class="ph ${cls}" role="img" aria-label="${ctx.esc(alt ?? '')}"><i class="ph-frame"></i></div>`

/** A user picture filling its cell, or the placeholder. */
function picture(image, ctx, cls = '') {
  const src = image && ctx.image(image)
  return src
    ? `<img class="pic ${cls}" src="${ctx.esc(src)}" alt="${ctx.esc(image.alt ?? '')}">`
    : placeholder(image?.alt, ctx, cls)
}

/** The top title band: a monospaced caps title sitting on a hairline or a bar. */
function band(title, ctx, { rule = 'hair', eyebrow, width = 1252 } = {}) {
  const w = eyebrow ? width - 170 : width
  const size = fitMono(title, w, 140, { lines: 1, min: 72 })
  const two = size <= 72 ? fitMono(title, w, 66, { lines: 2, min: 40 }) : 0
  return `<header class="band">${title ? `<h2 class="disp${two ? ' two' : ''}" style="font-size:${two || size}px">${ctx.esc(title)}</h2>` : ''}
    ${eyebrow ? `<span class="band-tag">${ctx.esc(eyebrow)}</span>` : ''}</header><i class="${rule === 'bar' ? 'bar' : 'hair'}"></i>`
}

/** A label-left/content-right row (the "Client / Role / Timeline" rows of the case study). */
const row = (label, content, ctx, cls = '') => `<div class="row ${cls}"><span class="lbl">${label ? ctx.esc(label) : ''}</span>${content}</div>`

/** Checkerboard cells: the green alternates between the centre column and the side columns. */
function checker(cols, rows, center, cls) {
  const cells = []
  rows.forEach((_, r) => cols.forEach((_, c) => {
    const green = (r % 2 === 0) === (c === 1)
    cells.push(`<i class="${green ? 'g' : ''}" style="grid-area:${r + 1}/${c + 1}"></i>`)
  }))
  return `<div class="checker ${cls}" style="grid-template-columns:${cols.map((v) => `${v}px`).join(' ')};grid-template-rows:${rows.map((v) => `${v}px`).join(' ')}">${cells.join('')}${center}</div>`
}

/** The cover and closing: the full checkerboard, two title bands and a meta band between. */
function coverSlide(title, left, right, ctx, cls) {
  const { geometry } = ctx.system
  const [a, b] = twoLines(title)
  const size = fitMono(a.length > b.length ? a : b, 860, 158, { lines: 1, min: 64 })
  const t = (text, r) => `<div class="cv-title" style="grid-area:${r}/2"><h1 class="disp" style="font-size:${size}px">${ctx.esc(text)}</h1></div>`
  const meta = `<div class="cv-meta" style="grid-area:4/2"><span>${left ? ctx.esc(left) : ''}</span><span>${right ? ctx.esc(right) : ''}</span></div>`
  return `<section class="slide ${cls}">${checker(geometry.coverColumns, geometry.coverRows, `${t(a, 2)}${b ? t(b, 6) : ''}${meta}`, 'cv')}</section>`
}

export function css(system) {
  const { green, paper, placeholder: ph, geometry: g } = system
  return `
:root { --g: ${green}; --paper: ${paper}; --ph-line: ${ph.border}; --ph-check: ${ph.check}; --bar: ${g.bar}px; --hair: ${g.hairline}px; --gut: ${g.gutter}px; --lblw: ${g.labelColumn}px; }
.slide { position: relative; background: var(--paper); color: var(--g); font-family: var(--font); font-size: 24px; line-height: 1.25; }
.disp { font-family: var(--display-font); font-weight: 400; text-transform: uppercase; letter-spacing: -.03em; word-spacing: -.22em; line-height: .78; white-space: nowrap; }
.bar { display: block; flex: none; height: var(--bar); background: var(--g); }
.hair { display: block; flex: none; height: var(--hair); background: var(--g); }
.vr { position: absolute; left: 639px; width: var(--hair); bottom: 0; background: var(--g); }
.lbl { font-size: 18px; line-height: 1.2; }

.foot { position: absolute; left: var(--gut); right: var(--gut); bottom: ${g.footerBottom}px; display: grid; grid-template-columns: 1fr 1fr; font-size: 15px; line-height: 1.2; font-weight: 500; }
.foot-l { display: flex; justify-content: space-between; padding-right: var(--gut); }
.foot-r { display: flex; justify-content: flex-end; gap: 48px; }
.foot-cap { max-width: 420px; white-space: nowrap; }

.checker { position: absolute; inset: 0; display: grid; }
.checker > i.g { background: var(--g); }
.cv-title { display: flex; align-items: center; justify-content: center; }
.cv-title .disp { position: relative; top: .04em; }
.cv-meta { display: grid; grid-template-columns: 460px 1fr; padding: 16px 38px 0; font-size: 17px; font-weight: 500; line-height: 1.25; }
.cv-meta span + span { max-width: 400px; }

.sec-title { display: flex; align-items: center; padding-left: 16px; }
.sec-title .disp { position: relative; top: .04em; }
.sec-mid { display: flex; flex-direction: column; justify-content: space-between; padding: 20px 18px 22px; color: var(--paper); }
.sec-mid .lbl { font-weight: 500; }
.sec-mid p { font-size: 26px; line-height: 1.25; max-width: 640px; }

.band { position: relative; height: ${g.titleBand}px; flex: none; }
.band .disp { position: absolute; left: 10px; bottom: 9px; }
.band .disp.two { white-space: normal; line-height: .92; right: var(--gut); }
.band-tag { position: absolute; right: var(--gut); top: 18px; font-size: 18px; }
.page { position: absolute; inset: 0 0 0 0; display: flex; flex-direction: column; }
.row { display: grid; grid-template-columns: var(--lblw) 1fr; align-items: start; padding: 18px var(--gut) 22px; }
.row .lbl { padding-top: 6px; }
.row.grow { flex: 1; padding-top: 26px; }

.pill { display: flex; align-items: center; justify-content: center; text-align: center; background: var(--g); color: var(--paper); border-radius: 999px; }
.pill .disp { white-space: normal; line-height: 1; }

.toc { position: absolute; inset: 0 0 60px; display: grid; grid-template-columns: 1fr 1fr; align-items: start; }
.toc-half { display: flex; flex-direction: column; }
.toc-half.r { padding-top: 58px; }
.toc .pill { height: 160px; margin: 30px 0 30px; }
.toc .row { min-height: 104px; padding-top: 14px; padding-bottom: 14px; }
.toc .row .lbl { padding-top: 10px; }
.toc-item { line-height: 1.02; letter-spacing: -.01em; padding-top: 4px; }

.sk { position: absolute; inset: 0 0 60px; display: flex; flex-direction: column; }
.sk-top { display: grid; grid-template-columns: 1fr 1fr; align-items: center; }
.sk-top .pill { height: 172px; }
.sk-col { display: flex; flex-direction: column; padding-top: 42px; }
.sk-row { display: grid; grid-template-columns: 1fr 1fr; min-height: 104px; align-items: center; }
.sk-cell { padding: 10px var(--gut) 10px 72px; line-height: 1.05; letter-spacing: -.01em; }
.sk-row .sk-cell + .sk-cell, .sk-col .sk-cell { padding-left: 83px; }
.sk-col .sk-cell { min-height: 92px; display: flex; align-items: center; }

.stmt { position: absolute; inset: 0 0 52px; display: flex; flex-direction: column; }
.stmt .pill { width: 830px; height: 150px; margin: 40px auto 0; }
.stmt-text { flex: 1; display: flex; align-items: center; justify-content: center; text-align: center; padding: 20px 80px; font-size: 52px; line-height: 1.12; letter-spacing: -.015em; text-wrap: balance; }
.stmt .hair { margin-top: 36px; }

.lead { font-size: 32px; line-height: 1.22; max-width: 960px; }
.para { font-size: 26px; line-height: 1.25; }
.big-name { font-size: 54px; line-height: 1.05; letter-spacing: -.015em; }

.cols { flex: 1; display: grid; grid-template-columns: repeat(var(--n), 1fr); min-height: 0; }
.col { position: relative; display: flex; flex-direction: column; padding: 18px var(--gut) 22px; }
.col + .col { border-left: var(--hair) solid var(--g); }
.col h3 { font-size: 44px; font-weight: 400; line-height: 1.08; letter-spacing: -.015em; margin-top: auto; }
.col p { margin-top: 18px; }
.metric { justify-content: flex-end; }
.metric b { font-family: var(--display-font); font-weight: 400; letter-spacing: -.03em; line-height: .8; white-space: nowrap; }
.metric span { font-size: 23px; margin-top: 18px; }

.halves { flex: 1; display: grid; grid-template-columns: 1fr 1fr; align-items: start; }
.halves > div { display: flex; flex-direction: column; }
.halves > div + div { border-left: var(--hair) solid var(--g); align-self: stretch; }

.when { font-family: var(--display-font); letter-spacing: -.03em; line-height: .8; font-size: 76px; }
.step-t { display: flex; align-items: center; gap: 12px; margin-top: auto; font-size: 34px; line-height: 1.1; }
.dot { flex: none; width: 18px; height: 18px; border-radius: 50%; background: var(--g); }
.step-b { margin-top: 12px; font-size: 23px; padding-left: 30px; }

.q { position: absolute; left: 422px; right: 0; top: 0; bottom: 73px; display: flex; flex-direction: column; }
.q .band { height: 160px; }
.q .band .disp { left: 8px; }
.q .pill { height: 140px; margin: 12px 14px 0 12px; }
.q .hair { margin-top: 22px; }
.q-text { flex: 1; display: flex; align-items: center; justify-content: center; text-align: center; padding: 10px 40px; font-size: 32px; line-height: 1.24; text-wrap: balance; }
.q-side { position: absolute; left: 0; top: 0; width: 422px; height: 627px; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: repeat(5, 1fr); border-right: var(--hair) solid var(--g); }
.q-side i:nth-child(4n + 1), .q-side i:nth-child(4n) { background: var(--g); }

table { width: 100%; border-collapse: collapse; table-layout: fixed; }
th { text-align: left; font-weight: 400; font-size: 18px; padding: 18px var(--gut) 14px; vertical-align: top; }
td { padding: 20px var(--gut) 22px; font-size: 30px; line-height: 1.1; vertical-align: top; border-top: var(--bar) solid var(--g); }
td:first-child { font-size: 18px; padding-top: 26px; }
th + th, td + td { border-left: var(--hair) solid var(--g); }
tbody tr:last-child td { border-bottom: var(--bar) solid var(--g); }

.bn { position: absolute; inset: 0 0 73px; display: grid; grid-template-columns: 760px 1fr; }
.bn-val { position: relative; display: flex; align-items: flex-end; padding: 0 var(--gut) 48px 6px; border-right: var(--hair) solid var(--g); }
.bn-val b { font-family: var(--display-font); font-weight: 400; letter-spacing: -.04em; line-height: .78; white-space: nowrap; }
.bn-what { display: flex; flex-direction: column; justify-content: flex-end; gap: 18px; padding: 0 var(--gut) 34px 24px; }
.bn-what h2 { font-size: 52px; font-weight: 400; line-height: 1.05; letter-spacing: -.015em; }
.bn-bar { position: absolute; left: 0; right: 0; top: 627px; }

.ph { position: relative; background: var(--paper); }
.ph-frame { position: absolute; inset: 14px; border: 1.5px solid var(--ph-line); border-radius: 10px;
  background-color: var(--paper); background-image: conic-gradient(var(--ph-check) 25%, transparent 0 50%, var(--ph-check) 0 75%, transparent 0); background-size: 28px 28px; background-position: center; }
.slide h3, .bn-what h2 { font-family: var(--font); }
.full-pic > * { position: absolute; inset: 0; }
.pic { display: block; width: 100%; height: 100%; object-fit: cover; }

.it-left { display: flex; flex-direction: column; border-right: var(--hair) solid var(--g); }
.it-title { flex: none; padding: 26px var(--gut) 26px 8px; }
.it-title .disp { white-space: normal; line-height: .82; }
.it-body { font-size: 34px; padding: 22px var(--gut) 30px 24px; }
.it-media { position: relative; flex: 1; min-height: 0; }
.it-media > * { position: absolute; inset: 0; }

.team .col { padding: 0; }
.team .face { position: relative; height: 304px; flex: none; }
.team .face > * { position: absolute; inset: 0; }
.team .who { padding: 16px var(--gut) 0; display: flex; flex-direction: column; gap: 8px; }
.team .who b { font-weight: 400; font-size: 36px; line-height: 1.05; letter-spacing: -.015em; }

.full-pic { position: absolute; left: 6px; right: 6px; top: 6px; height: 641px; }
.full-pic .ph-frame { inset: 80px 224px 46px; }

.framed .avn-body { margin: 22px var(--gut) 20px; }
`
}

export const slides = {
  cover: (d, ctx) => coverSlide(d.title, d.eyebrow, d.subtitle, ctx, 'cover'),

  agenda: (d, ctx) => {
    const left = d.items.slice(0, Math.floor(d.items.length / 2))
    const right = d.items.slice(left.length)
    const size = fitText(d.items, 400, 62, 44)
    const item = (text, i) => `<i class="bar"></i>${row(num(i), `<span class="toc-item" style="font-size:${size}px">${ctx.esc(text)}</span>`, ctx)}`
    const pillSize = fitMono(d.title, 560, 48, { lines: 2, min: 28 })
    return `<section class="slide agenda"><i class="vr" style="top:0"></i><div class="toc">
      <div class="toc-half"><div class="pill"><h2 class="disp" style="font-size:${pillSize}px">${ctx.esc(d.title)}</h2></div>${left.map((t, i) => item(t, i)).join('')}${left.length ? '<i class="bar"></i>' : ''}</div>
      <div class="toc-half r">${right.map((t, i) => item(t, i + left.length)).join('')}<i class="bar"></i></div></div>${foot(ctx)}</section>`
  },

  section: (d, ctx) => {
    const { geometry } = ctx.system
    const [a, b] = twoLines(d.title)
    const size = fitMono(a.length > b.length ? a : b, 790, 151, { lines: 1, min: 64 })
    const t = (text, r) => `<div class="sec-title" style="grid-area:${r}/2"><h2 class="disp" style="font-size:${size}px">${ctx.esc(text)}</h2></div>`
    const mid = `<div class="sec-mid" style="grid-area:3/2"><span class="lbl">${ctx.esc(d.number)}</span>${d.subtitle ? `<p>${ctx.esc(d.subtitle)}</p>` : ''}</div>`
    return `<section class="slide section">${checker(geometry.sectionColumns, geometry.sectionRows, `${t(a, 2)}${b ? t(b, 4) : ''}${mid}`, 'sec')}${foot(ctx)}</section>`
  },

  statement: (d, ctx) => `<section class="slide statement"><div class="stmt">
    ${d.attribution ? `<div class="pill"><span class="disp" style="font-size:${fitMono(d.attribution, 720, 44, { lines: 2, min: 26 })}px">${ctx.esc(d.attribution)}</span></div>` : ''}
    <i class="hair"></i><p class="stmt-text">${ctx.esc(d.text)}</p><i class="bar"></i></div>${foot(ctx)}</section>`,

  text: (d, ctx) => `<section class="slide text"><div class="page" style="bottom:73px">${band(d.title, ctx, { rule: 'bar' })}
    ${row(d.eyebrow, `<p class="lead" style="font-size:40px">${ctx.esc(d.body)}</p>`, ctx, 'grow')}<i class="bar"></i></div>${foot(ctx)}</section>`,

  points: (d, ctx) => `<section class="slide points"><div class="page" style="bottom:73px">${band(d.title, ctx)}
    <div class="cols" style="--n:${d.items.length}">${d.items.map((p, i) => `<div class="col"><span class="lbl">${num(i)}</span><h3>${ctx.esc(p.title)}</h3><p class="para">${ctx.esc(p.body)}</p></div>`).join('')}</div>
    <i class="bar"></i></div>${foot(ctx)}</section>`,

  'image-text': (d, ctx) => {
    const size = fitMono(d.title, 610, 128, { lines: 2, min: 40 })
    return `<section class="slide image-text"><div class="page" style="bottom:73px"><div class="halves" style="flex:1">
      <div class="it-left" style="align-self:stretch"><div class="it-title"><h2 class="disp" style="font-size:${size}px">${ctx.esc(d.title)}</h2></div>
        <div class="it-media">${picture(d.image, ctx)}</div></div>
      <div style="border-left:0"><i class="bar"></i><p class="lead it-body">${ctx.esc(d.body)}</p><i class="bar"></i></div>
    </div><i class="bar"></i></div>${foot(ctx)}</section>`
  },

  metrics: (d, ctx) => {
    const colW = 1280 / d.items.length
    const size = Math.min(150, Math.floor((colW - 40) / (ADVANCE * Math.max(...d.items.map((m) => String(m.value).length)))))
    return `<section class="slide metrics"><div class="page" style="bottom:73px">${band(d.title, ctx)}
      <div class="cols" style="--n:${d.items.length}">${d.items.map((m) => `<div class="col metric"><b style="font-size:${size}px">${ctx.esc(m.value)}</b><span>${ctx.esc(m.label)}</span></div>`).join('')}</div>
      <i class="bar"></i></div>${foot(ctx)}</section>`
  },

  'two-column': (d, ctx) => {
    const size = fitText(d.columns.map((c) => c.title), 390, 54, 34)
    return `<section class="slide two-column"><div class="page" style="bottom:52px">${band(d.title, ctx, { rule: 'bar' })}
      <div class="halves">${d.columns.map((c, i) => `<div>${row(num(i), `<span class="big-name" style="font-size:${size}px">${ctx.esc(c.title)}</span>`, ctx)}<i class="bar"></i>${row('', `<p class="para">${ctx.esc(c.body)}</p>`, ctx)}<i class="bar"></i></div>`).join('')}</div>
      </div>${foot(ctx)}</section>`
  },

  timeline: (d, ctx) => {
    const colW = 1280 / d.steps.length
    const size = Math.min(76, Math.floor((colW - 40) / (ADVANCE * Math.max(...d.steps.map((s) => String(s.when).length)))))
    return `<section class="slide timeline"><div class="page" style="bottom:73px">${band(d.title, ctx, { rule: 'bar' })}
      <div class="cols" style="--n:${d.steps.length}">${d.steps.map((s) => `<div class="col" style="padding-top:28px"><span class="when" style="font-size:${size}px">${ctx.esc(s.when)}</span>
        <span class="step-t"><i class="dot"></i>${ctx.esc(s.title)}</span>${s.body ? `<span class="step-b">${ctx.esc(s.body)}</span>` : ''}</div>`).join('')}</div>
      <i class="bar"></i></div>${foot(ctx)}</section>`
  },

  quote: (d, ctx) => {
    const size = fitMono(d.name, 830, 140, { lines: 1, min: 48 })
    const side = Array.from({ length: 10 }, () => '<i></i>').join('')
    return `<section class="slide quote"><div class="q-side">${side}</div><div class="q">
      <header class="band"><h2 class="disp" style="font-size:${size}px">${ctx.esc(d.name)}</h2></header>
      ${d.role ? `<div class="pill"><span class="disp" style="font-size:${fitMono(d.role, 700, 44, { lines: 2, min: 26 })}px">${ctx.esc(d.role)}</span></div>` : ''}
      <i class="hair"></i><p class="q-text">${ctx.esc(d.text)}</p><i class="bar"></i></div>${foot(ctx)}</section>`
  },

  table: (d, ctx) => `<section class="slide table"><div class="page">${band(d.title, ctx, { rule: 'bar' })}
    <table><colgroup><col style="width:${d.columns.length > 3 ? 226 : 300}px"></colgroup><thead><tr>${d.columns.map((c) => `<th>${ctx.esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${d.rows.map((r) => `<tr>${r.map((c) => `<td>${ctx.esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${foot(ctx)}</section>`,

  'big-number': (d, ctx) => {
    const size = Math.min(400, Math.floor(700 / (ADVANCE * String(d.value).length)))
    return `<section class="slide big-number"><div class="bn"><div class="bn-val"><b style="font-size:${size}px">${ctx.esc(d.value)}</b></div>
      <div class="bn-what"><h2>${ctx.esc(d.label)}</h2>${d.body ? `<p class="para">${ctx.esc(d.body)}</p>` : ''}</div></div>
      <i class="bar bn-bar"></i>${foot(ctx)}</section>`
  },

  bullets: (d, ctx) => {
    const top = d.items.slice(0, 2)
    const rest = d.items.slice(2)
    const size = fitText(d.items, 540, 54, 42)
    const cell = (t) => `<span class="sk-cell" style="font-size:${size}px">${ctx.esc(t)}</span>`
    const rows = []
    for (let i = 0; i < rest.length; i += 2) rows.push(`<i class="bar"></i><div class="sk-row">${cell(rest[i])}${rest[i + 1] ? cell(rest[i + 1]) : '<span></span>'}</div>`)
    const pillSize = fitMono(d.title, 560, 48, { lines: 2, min: 28 })
    return `<section class="slide bullets"><i class="vr" style="top:0"></i><div class="sk">
      <div class="sk-top"><div class="pill"><h2 class="disp" style="font-size:${pillSize}px">${ctx.esc(d.title)}</h2></div>
        <div class="sk-col">${top.map((t) => `<i class="bar"></i>${cell(t)}`).join('')}</div></div>
      ${rows.join('')}<i class="bar" style="margin-top:${rows.length ? 0 : 30}px"></i></div>${foot(ctx)}</section>`
  },

  team: (d, ctx) => `<section class="slide team"><div class="page" style="bottom:73px">${band(d.title, ctx)}
    <div class="cols" style="--n:${d.people.length}">${d.people.map((p) => `<div class="col"><div class="face">${picture(p.image ?? { alt: p.name }, ctx)}</div>
      <div class="who"><b>${ctx.esc(p.name)}</b><span class="lbl">${ctx.esc(p.role)}</span></div></div>`).join('')}</div>
    <i class="bar"></i></div>${foot(ctx)}</section>`,

  image: (d, ctx) => `<section class="slide image"><div class="full-pic">${picture(d.image, ctx)}</div>${foot(ctx, d.caption)}</section>`,

  /** The titled content slide that `chart` and `custom` slides are drawn in. */
  frame: ({ title, eyebrow }, ctx, body) => `<section class="slide framed"><div class="page" style="bottom:73px">${band(title ?? '', ctx, { eyebrow })}
    ${body}<i class="bar"></i></div>${foot(ctx)}</section>`,

  closing: (d, ctx) => coverSlide(d.title, d.subtitle, d.contact, ctx, 'closing'),
}
