/**
 * Chuckle: heavy condensed caps titles whose last word turns purple, orange or lime, a fat rounded
 * wordmark on tilted lime stickers, white frames with rounded notches cut over pictures, rounded
 * colour cards, and a white / purple / orange / lime slide rhythm.
 * Measured from the 12 slides of "Digital Agency Pitch Deck" (Figma Community).
 *
 * Fonts: `type.fonts.text` (body), `display` (condensed caps) and one `extra` family (the wordmark
 * face on stickers and the cover badge); the renderer embeds all of them.
 */

const words = (text) => String(text).trim().split(/\s+/)

/** A title with its last word in an accent colour (`hl` modifier class), as "OUR EXPERTISE". */
function toned(text, ctx, tone = 'purple') {
  const w = words(text)
  if (w.length < 2) return ctx.esc(text)
  return `${ctx.esc(w.slice(0, -1).join(' '))} <span class="hl ${tone}">${ctx.esc(w.at(-1))}</span>`
}

/** A title with its last word on a tilted lime sticker in the wordmark face, as "ABOUT CHUCKLE". */
function stickered(text, ctx) {
  const w = words(text)
  const last = `<span class="stk">${ctx.esc(w.at(-1))}</span>`
  return w.length < 2 ? last : `<span class="lead">${ctx.esc(w.slice(0, -1).join(' '))}</span>${last}`
}

/**
 * Statement text with tilted condensed-caps tags: the longest word on purple and the last word on
 * lime, as the "CREATIVE" and "JOY" tags of the vision slide. Trailing punctuation stays outside.
 */
function tagged(text, ctx) {
  const w = words(text)
  const bare = (s) => s.replace(/[.,;:!?…]+$/, '')
  const last = w.length - 1
  let longest = -1
  if (w.length >= 5) {
    for (let i = 0; i < last; i++) if (longest < 0 || bare(w[i]).length > bare(w[longest]).length) longest = i
  }
  return w.map((word, i) => {
    if (i !== last && i !== longest) return ctx.esc(word)
    const core = bare(word)
    const rest = word.slice(core.length)
    return `<span class="tag ${i === last ? 'lime' : 'purple'}">${ctx.esc(core)}</span>${ctx.esc(rest)}`
  }).join(' ')
}

/** The retro desk drawn as the picture placeholder: curtain folds, a desk, a grey monitor and a mug. */
const scene = (alt, ctx, cls) => `<div class="${cls} ph" role="img" aria-label="${ctx.esc(alt ?? '')}"><i class="ph-curtain"></i><i class="ph-desk"></i><i class="ph-crt"><i></i></i><i class="ph-kbd"></i><i class="ph-mug"></i></div>`

/** A user picture, or the desk placeholder when the slot has none. */
function picture(image, ctx, cls) {
  const src = ctx.image(image)
  return src
    ? `<img class="${cls}" src="${ctx.esc(src)}" alt="${ctx.esc(image.alt)}">`
    : scene(image?.alt, ctx, cls)
}

const CARD_TONES = ['purple', 'lime', 'orange', 'charcoal']

/** A portrait: the user's picture, or a neutral silhouette on an accent card. */
function portrait(person, ctx, i) {
  const src = person.image && ctx.image(person.image)
  const tone = CARD_TONES[i % CARD_TONES.length]
  return src
    ? `<img class="face" src="${ctx.esc(src)}" alt="${ctx.esc(person.name)}">`
    : `<div class="face fill-${tone}" role="img" aria-label="${ctx.esc(person.name)}"><i class="sil-head"></i><i class="sil-body"></i></div>`
}

/** A white notch tab cut into a picture frame at `corner` (tl, tr, bl, br), with its two rounded fillets. */
/** One rounded fillet: white outside a 30px circle in its corner, overlapping 2px into the white it meets. */
const fillet = (cls) => `<svg class="${cls}" viewBox="-2 -2 34 34" aria-hidden="true"><path d="M-2 0 H0 A30 30 0 0 0 30 30 V32 H-2 Z"/></svg>`
const notch = (corner, inner, cls = '') => `<div class="notch ${corner} ${cls}">${fillet('fa')}${fillet('fb')}${inner}</div>`

/** The three line icons of the expertise cards: an eye, stacked layers and a globe. */
const ICONS = [
  '<path d="M4 24 C12 12 36 12 44 24 C36 36 12 36 4 24 Z"/><circle cx="24" cy="24" r="7"/><circle cx="24" cy="24" r="2" fill="currentColor"/><path d="M24 4 V8 M12 7 L14 10.5 M36 7 L34 10.5 M24 40 V44 M12 41 L14 37.5 M36 41 L34 37.5"/>',
  '<rect x="6" y="18" width="20" height="22" rx="3"/><path d="M12 18 V13 Q12 11 14 11 H31 Q33 11 33 13 V31 Q33 33 31 33 H26"/><path d="M19 11 V7 Q19 5 21 5 H39 Q41 5 41 7 V24 Q41 26 39 26 H33"/>',
  '<circle cx="24" cy="24" r="18"/><ellipse cx="24" cy="24" rx="8" ry="18"/><path d="M6 24 H42 M9 14 H39 M9 34 H39"/>',
]
const icon = (i) => `<svg class="icon" viewBox="0 0 48 48" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[i % ICONS.length]}</svg>`

const pad2 = (n) => String(n).padStart(2, '0')

export function css(system) {
  const s = system.surface
  const k = system.ink
  return `
:root { --white: ${s.white}; --mist: ${s.mist}; --charcoal: ${s.charcoal}; --purple: ${s.purple}; --deep: ${s.deep};
  --orange: ${s.orange}; --lime: ${s.lime}; --ink: ${k.primary}; --muted: ${k.muted}; --rule: ${k.rule};
  --mark-font: "${system.type.fonts.extra[0]}", var(--display-font); --m: 67px; --r: 30px; }
.slide { background: var(--white); color: var(--ink); padding: var(--m); display: flex; flex-direction: column; font-size: 19px; line-height: 1.4; }
.cap { font-family: var(--display-font); font-weight: 800; text-transform: uppercase; line-height: .86; letter-spacing: .005em; }
.t-xl { font-size: 200px; } .t-l { font-size: 150px; } .t-m { font-size: 120px; } .t-s { font-size: 96px; }
.hl.purple { color: var(--purple); } .hl.orange { color: var(--orange); } .hl.lime { color: var(--lime); }
.on-purple { background: var(--purple); color: #fff; } .on-orange { background: var(--orange); color: #fff; } .on-lime { background: var(--lime); }
.fill-purple { background: var(--purple); color: #fff; } .fill-lime { background: var(--lime); color: var(--ink); }
.fill-orange { background: var(--orange); color: #fff; } .fill-charcoal { background: var(--charcoal); color: #fff; }
.fill-deep { background: var(--deep); color: #fff; } .fill-mist { background: var(--mist); }
.label { font-size: 19px; letter-spacing: .02em; text-transform: uppercase; }
.just { text-align: justify; }

/* stickers: the wordmark face on lime, and condensed caps tags on purple or lime */
.lead { display: block; }
.stk { display: inline-block; position: relative; z-index: 3; margin: .06em 0 0 -.18em; padding: .1em .26em .04em; border-radius: .2em; background: var(--lime); color: var(--purple); font-family: var(--mark-font); font-weight: 400; text-transform: uppercase; letter-spacing: 0; line-height: 1; transform: rotate(-4deg); transform-origin: 0 50%; }
.tag { display: inline-block; padding: .04em .14em 0; border-radius: .08em; line-height: .92; }
.tag.purple { background: var(--purple); color: #fff; transform: rotate(-3deg); }
.tag.lime { background: var(--lime); color: var(--ink); transform: rotate(-2deg); }

/* picture placeholder: the retro desk */
.ph { overflow: hidden; background: #1C2A66; }
.ph i { position: absolute; display: block; }
.ph-curtain { inset: 0 0 28% 0; background: repeating-linear-gradient(90deg, #15215a 0 2.5%, #2a3c86 5.5%, #15215a 8%); }
.ph-desk { left: 0; right: 0; bottom: 0; height: 28%; background: repeating-linear-gradient(177deg, rgba(0,0,0,.14) 0 2px, transparent 2px 13px), #5E3B25; }
.ph-crt { left: 33%; width: 30%; bottom: 20%; height: 52%; background: #C9C6BE; border-radius: 5% / 7%; box-shadow: inset -6px -8px 0 rgba(0,0,0,.08); }
.ph-crt i { inset: 9% 9% 20%; background: #141414; border-radius: 3%; }
.ph-kbd { left: 28%; width: 40%; bottom: 9%; height: 9%; background: repeating-linear-gradient(90deg, #B4B0A6 0 6px, #C9C6BE 6px 22px); border-radius: 6px; }
.ph-mug { right: 13%; width: 8%; bottom: 14%; height: 16%; background: var(--orange); border-radius: 0 0 22% 22%; box-shadow: inset -5px 0 0 rgba(0,0,0,.12); }

/* white frames over pictures: a ring and notch tabs with rounded fillets */
.bleed { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.ring { position: absolute; left: 102px; top: 96px; right: 102px; bottom: 98px; border-radius: var(--r); box-shadow: 0 0 0 32px var(--white), 0 0 0 600px transparent; pointer-events: none; }
.hole > .fill { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; border-radius: var(--r); }
.notch { position: absolute; z-index: 2; background: var(--white); }
.notch svg { position: absolute; width: 34px; height: 34px; fill: var(--white); }
.notch.bl { left: 0; bottom: 0; border-top-right-radius: var(--r); box-shadow: -6px 6px 0 6px var(--white); }
.notch.bl .fa { left: -2px; top: -32px; } .notch.bl .fb { right: -32px; bottom: -2px; }
.notch.tr { right: 0; top: 0; border-bottom-left-radius: var(--r); box-shadow: 6px -6px 0 6px var(--white); }
.notch.tr svg { transform: rotate(180deg); } .notch.tr .fa { left: -32px; top: -2px; } .notch.tr .fb { right: -2px; bottom: -32px; }
.notch.tl { left: 0; top: 0; border-bottom-right-radius: var(--r); box-shadow: -6px -6px 0 6px var(--white); }
.notch.tl svg { transform: rotate(90deg); } .notch.tl .fa { right: -32px; top: -2px; } .notch.tl .fb { left: -2px; bottom: -32px; }
.notch.br { right: 0; bottom: 0; border-top-left-radius: var(--r); box-shadow: 6px 6px 0 6px var(--white); }
.notch.br svg { transform: rotate(-90deg); } .notch.br .fa { left: -32px; bottom: -2px; } .notch.br .fb { right: -2px; top: -32px; }
.framed-pic { padding: 0; }
.framed-pic .holder { position: absolute; left: 102px; top: 96px; right: 102px; bottom: 98px; }

/* cover */
.cover .meta { position: absolute; left: 140px; top: 138px; z-index: 2; color: #fff; font-size: 14px; line-height: 1.35; }
.cover .notch.bl { display: flex; align-items: flex-end; gap: 36px; padding: 30px 40px 0 12px; max-width: 1000px; }
.cover h1 { font-size: 176px; line-height: .8; padding-top: 4px; max-width: 760px; }
.cover .sub { flex: 0 1 280px; min-width: 220px; font-size: 17px; line-height: 1.35; padding-bottom: 4px; }
.cover .notch.tr { padding: 12px 6px 16px 30px; }
.badge { display: block; font-family: var(--mark-font); font-size: 52px; line-height: 1; color: var(--orange); text-transform: uppercase; white-space: nowrap; }
.image .notch.bl { padding: 26px 44px 0 12px; max-width: 760px; }
.image .cap-line { font-size: 22px; line-height: 1.32; max-width: 620px; }

/* agenda and table: the grey panel with ruled rows */
.duo { display: grid; grid-template-columns: 1fr 1.25fr; gap: 56px; align-items: start; height: 100%; }
.panel { background: var(--mist); border-radius: var(--r); padding: 18px 48px; }
.rows { list-style: none; }
.rows li { display: grid; grid-template-columns: 110px 1fr; align-items: baseline; padding: 17px 0; border-top: 1.5px solid var(--rule); font-size: 24px; }
.rows li:first-child { border-top: 0; }
.rows .n { font-family: var(--display-font); font-weight: 800; font-size: 40px; line-height: 1; color: var(--orange); }
.agenda .duo { align-items: center; }

/* section and closing */
.section { justify-content: space-between; }
.section .num { font-family: var(--display-font); font-weight: 800; font-size: 120px; line-height: .8; color: var(--lime); }
.section.on-orange .num { color: var(--ink); }
.section h2 { font-size: 172px; }
.section .sub { font-size: 24px; max-width: 760px; }
.section .foot { display: flex; justify-content: space-between; align-items: flex-end; gap: 40px; }

/* statement */
.statement { align-items: center; justify-content: center; text-align: center; gap: 34px; }
.statement .label { font-size: 20px; }
.statement p { font-family: var(--display-font); font-weight: 800; text-transform: uppercase; font-size: 96px; line-height: 1; max-width: 1120px; text-wrap: balance; }

/* text */
.text .top { display: flex; flex-direction: column; gap: 22px; }
.eyebrow { font-size: 19px; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); }
.text h2 { font-size: 150px; }
.text .card { margin-top: auto; align-self: flex-end; width: 720px; padding: 40px 46px; border-radius: var(--r); background: var(--charcoal); color: #fff; font-size: 24px; line-height: 1.45; }

/* points: the expertise cards */
.points h2 { font-size: 150px; white-space: nowrap; }
.cards3 { margin-top: auto; display: grid; grid-template-columns: repeat(3, 1fr); gap: 34px; }
.card3 { background: var(--deep); border-radius: var(--r); padding: 36px 30px 40px; min-height: 300px; display: flex; flex-direction: column; gap: 14px; }
.icon { width: 52px; height: 52px; color: #fff; margin-bottom: 18px; }
.card3 b { font-weight: 400; font-size: 29px; line-height: 1.1; letter-spacing: .02em; text-transform: uppercase; }
.card3 p { font-size: 17px; line-height: 1.5; }

/* image-text */
.it .holder { position: absolute; left: 64px; top: 67px; right: 64px; bottom: 73px; }
.it .notch.tl { padding: 0 34px 18px 0; max-width: 640px; }
.it h2 { font-size: 112px; }
.it h2 .stk { font-size: 108px; margin-bottom: -150px; }
.it .notch.br { width: 540px; padding: 36px 0 0 44px; font-size: 19px; line-height: 1.45; }

/* metrics: the impact cards */
.metrics { padding: 0; }
.metrics h2 { position: absolute; left: 67px; top: 86px; font-size: 140px; max-width: 760px; }
.mcard { position: absolute; width: 274px; height: 275px; border-radius: var(--r); display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 24px; gap: 14px; }
.mcard b { font-family: var(--display-font); font-weight: 800; font-size: 128px; line-height: .8; }
.mcard span { font-size: 16px; line-height: 1.35; max-width: 220px; }
.mcard.outline { border: 1.5px solid #333; justify-content: flex-end; align-items: flex-start; text-align: left; }
.mcard.outline b { font-size: 96px; }

/* two-column */
.two h2 { font-size: 132px; }
.cols { margin-top: auto; display: grid; grid-template-columns: 1fr 1fr; gap: 34px; }
.col { border-radius: var(--r); padding: 38px 44px 42px; min-height: 260px; display: flex; flex-direction: column; gap: 18px; }
.col h3 { font-family: var(--display-font); font-weight: 800; text-transform: uppercase; font-size: 76px; line-height: .86; }
.col p { font-size: 21px; line-height: 1.45; max-width: 460px; }

/* timeline: the progress bars */
.timeline { padding: 0; }
.timeline h2 { position: absolute; left: 67px; top: 64px; font-size: 124px; max-width: 420px; }
.bars { position: absolute; left: 67px; right: 67px; bottom: 67px; top: 67px; display: flex; gap: 34px; align-items: flex-end; }
.bar { flex: 1 1 0; border-radius: var(--r); background: var(--deep); color: #fff; display: flex; flex-direction: column; justify-content: space-between; padding: 30px 26px 26px; }
.bar.last { background: var(--orange); }
.bar .hd { display: flex; align-items: flex-start; justify-content: center; gap: 14px; }
.bar .when { font-family: var(--display-font); font-weight: 800; font-size: 64px; line-height: .8; white-space: nowrap; }
.bar .what { font-size: 21px; line-height: 1.1; padding-top: 2px; }
.bar .ft { font-size: 16px; text-align: center; }

/* quote */
.quote { justify-content: space-between; }
.quote p { font-family: var(--display-font); font-weight: 800; text-transform: uppercase; font-size: 92px; line-height: .92; max-width: 1080px; text-wrap: balance; }
.quote .by { display: flex; align-items: baseline; gap: 18px; }
.quote .name { font-family: var(--display-font); font-weight: 800; text-transform: uppercase; font-size: 44px; line-height: 1; }
.quote .role { font-size: 20px; }

/* table */
.table h2 { font-size: 120px; }
.table .panel { margin-top: auto; padding: 14px 48px 10px; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; font-family: var(--display-font); font-weight: 800; font-size: 30px; text-transform: uppercase; padding: 12px 0 14px; }
td { padding: 18px 0; border-top: 1.5px solid var(--rule); font-size: 22px; }
td:first-child { font-weight: 700; }

/* big number */
.big { padding: 0; }
.big h2 { position: absolute; left: 67px; top: 64px; font-size: 128px; max-width: 760px; }
.big .note { position: absolute; left: 365px; top: 349px; width: 267px; height: 304px; border-radius: var(--r); padding: 28px; display: flex; align-items: flex-end; font-size: 17px; line-height: 1.45; text-align: center; }
.big .val { position: absolute; left: 659px; right: 67px; top: 349px; bottom: 67px; border-radius: var(--r); display: flex; align-items: center; justify-content: center; }
.big .val b { font-family: var(--display-font); font-weight: 800; font-size: 300px; line-height: .8; }

/* bullets */
.bullets h2 { font-size: 150px; }
.blist { margin-top: auto; list-style: none; display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.blist li { display: flex; align-items: center; gap: 22px; background: var(--white); border-radius: 22px; padding: 28px 32px; font-size: 25px; line-height: 1.3; }
.blist .n { font-family: var(--display-font); font-weight: 800; font-size: 44px; line-height: .8; color: var(--purple); }

/* team */
.team { align-items: center; }
.team h2 { font-size: 112px; letter-spacing: .03em; text-align: center; white-space: nowrap; }
.people { margin-top: auto; width: 100%; display: grid; grid-template-columns: repeat(var(--n), 1fr); gap: 34px; }
.person { display: flex; flex-direction: column; align-items: center; text-align: center; }
.face { position: relative; width: 100%; height: 300px; border-radius: var(--r); overflow: hidden; object-fit: cover; }
.face i { position: absolute; display: block; background: #D8D4CC; }
.sil-head { left: 50%; top: 18%; width: 30%; aspect-ratio: 1; transform: translateX(-50%); border-radius: 50%; }
.sil-body { left: 16%; right: 16%; bottom: -12%; height: 44%; border-radius: 48% 48% 0 0; background: #BFBAB0 !important; }
.person b { margin-top: 26px; font-weight: 400; font-size: 26px; line-height: 1.1; letter-spacing: .02em; text-transform: uppercase; }
.person span { margin-top: 6px; font-size: 19px; letter-spacing: .02em; text-transform: uppercase; color: var(--muted); }

/* frame for chart and custom */
.frame h2 { font-size: 100px; }
.frame .top { display: flex; flex-direction: column; gap: 16px; }
.frame .stage { margin-top: 30px; flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; background: var(--mist); border-radius: var(--r); padding: 28px 36px; }

/* closing */
.closing { align-items: center; justify-content: center; text-align: center; gap: 30px; }
.closing h2 { font-size: 200px; }
.closing .sub { font-size: 26px; }
.closing .tag { font-family: var(--display-font); font-weight: 800; font-size: 44px; text-transform: uppercase; }
`
}

export const slides = {
  cover: (d, ctx) => `<section class="slide cover framed-pic">${picture({ alt: d.title }, ctx, 'bleed')}<div class="ring"></div>
    <div class="holder">
      ${notch('tr', `<span class="badge">${ctx.esc(d.eyebrow ?? ctx.deck.presenter ?? '')}</span>`)}
      ${notch('bl', `<h1 class="cap">${ctx.esc(d.title)}</h1>${d.subtitle ? `<p class="sub">${ctx.esc(d.subtitle)}</p>` : ''}`)}
    </div>
    <div class="meta">${ctx.deck.presenter ? `<div>${ctx.esc(ctx.deck.presenter)}</div>` : ''}${ctx.deck.date ? `<div>${ctx.esc(ctx.deck.date)}</div>` : ''}</div></section>`,

  agenda: (d, ctx) => `<section class="slide agenda"><div class="duo"><h2 class="cap t-l">${toned(d.title, ctx, 'orange')}</h2>
    <div class="panel"><ol class="rows">${d.items.map((item, i) => `<li><span class="n">${pad2(i + 1)}</span><span>${ctx.esc(item)}</span></li>`).join('')}</ol></div></div></section>`,

  section: (d, ctx) => {
    const orange = parseInt(d.number, 10) % 2 === 0
    return `<section class="slide section ${orange ? 'on-orange' : 'on-purple'}"><span class="num">${ctx.esc(d.number)}</span>
    <div class="foot"><h2 class="cap">${toned(d.title, ctx, 'lime')}</h2></div>
    ${d.subtitle ? `<p class="sub">${ctx.esc(d.subtitle)}</p>` : ''}</section>`
  },

  statement: (d, ctx) => `<section class="slide statement on-orange">${d.attribution ? `<span class="label">${ctx.esc(d.attribution)}</span>` : ''}
    <p>${tagged(d.text, ctx)}</p></section>`,

  text: (d, ctx) => `<section class="slide text"><div class="top">${d.eyebrow ? `<span class="eyebrow">${ctx.esc(d.eyebrow)}</span>` : ''}
    <h2 class="cap">${toned(d.title, ctx, 'orange')}</h2></div><p class="card just">${ctx.esc(d.body)}</p></section>`,

  points: (d, ctx) => `<section class="slide points on-purple"><h2 class="cap">${toned(d.title, ctx, 'lime')}</h2>
    <div class="cards3">${d.items.map((item, i) => `<div class="card3">${icon(i)}<b>${ctx.esc(item.title)}</b><p>${ctx.esc(item.body)}</p></div>`).join('')}</div></section>`,

  'image-text': (d, ctx) => `<section class="slide it framed-pic"><div class="holder hole">${picture(d.image, ctx, 'fill')}
    ${notch('tl', `<h2 class="cap">${stickered(d.title, ctx)}</h2>`)}
    ${notch('br', `<p class="just">${ctx.esc(d.body)}</p>`)}</div></section>`,

  metrics: (d, ctx) => {
    const SLOTS = [
      ['left:938px;top:70px', 'fill-purple'],
      ['left:67px;top:378px', 'fill-orange'],
      ['left:630px;top:378px', 'outline'],
      ['left:938px;top:378px', 'fill-lime'],
    ]
    const slots = d.items.length === 3 ? [SLOTS[0], SLOTS[1], SLOTS[3]] : SLOTS
    return `<section class="slide metrics"><h2 class="cap">${toned(d.title, ctx, 'purple')}</h2>
    ${d.items.map((m, i) => `<div class="mcard ${slots[i][1]}" style="${slots[i][0]}"><b>${ctx.esc(m.value)}</b><span>${ctx.esc(m.label)}</span></div>`).join('')}</section>`
  },

  'two-column': (d, ctx) => `<section class="slide two"><h2 class="cap">${toned(d.title, ctx, 'purple')}</h2>
    <div class="cols">${d.columns.map((c, i) => `<div class="col ${i === 0 ? 'fill-charcoal' : 'fill-purple'}"><h3>${ctx.esc(c.title)}</h3><p>${ctx.esc(c.body)}</p></div>`).join('')}</div></section>`,

  timeline: (d, ctx) => {
    const n = d.steps.length
    return `<section class="slide timeline on-purple"><h2 class="cap">${ctx.esc(d.title)}</h2>
    <div class="bars">${d.steps.map((s, i) => `<div class="bar${i === n - 1 ? ' last' : ''}" style="height:${Math.round(42 + (58 * i) / Math.max(1, n - 1))}%">
      <div class="hd"><span class="when">${ctx.esc(s.when)}</span><span class="what">${ctx.esc(s.title)}</span></div>
      ${s.body ? `<span class="ft">${ctx.esc(s.body)}</span>` : ''}</div>`).join('')}</div></section>`
  },

  quote: (d, ctx) => `<section class="slide quote on-lime"><p>${ctx.esc(d.text)}</p>
    <div class="by"><span class="name">${ctx.esc(d.name)}</span>${d.role ? `<span class="role">${ctx.esc(d.role)}</span>` : ''}</div></section>`,

  table: (d, ctx) => `<section class="slide table"><h2 class="cap">${toned(d.title, ctx, 'orange')}</h2>
    <div class="panel"><table><thead><tr>${d.columns.map((c) => `<th>${ctx.esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${d.rows.map((r) => `<tr>${r.map((c) => `<td>${ctx.esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`,

  'big-number': (d, ctx) => `<section class="slide big on-lime"><h2 class="cap">${ctx.esc(d.label)}</h2>
    ${d.body ? `<p class="note fill-purple">${ctx.esc(d.body)}</p>` : ''}
    <div class="val fill-orange"><b>${ctx.esc(d.value)}</b></div></section>`,

  bullets: (d, ctx) => `<section class="slide bullets on-lime"><h2 class="cap">${ctx.esc(d.title)}</h2>
    <ul class="blist">${d.items.map((item, i) => `<li><span class="n">${pad2(i + 1)}</span><span>${ctx.esc(item)}</span></li>`).join('')}</ul></section>`,

  team: (d, ctx) => `<section class="slide team"><h2 class="cap">${toned(d.title, ctx, 'purple')}</h2>
    <div class="people" style="--n:${d.people.length}">${d.people.map((p, i) => `<div class="person">${portrait(p, ctx, i)}<b>${ctx.esc(p.name)}</b><span>${ctx.esc(p.role)}</span></div>`).join('')}</div></section>`,

  image: (d, ctx) => `<section class="slide image framed-pic">${picture(d.image, ctx, 'bleed')}<div class="ring"></div>
    ${d.caption ? `<div class="holder">${notch('bl', `<p class="cap-line">${ctx.esc(d.caption)}</p>`)}</div>` : ''}</section>`,

  /** The titled content slide that `chart` and `custom` slides are drawn in: the body sits on the grey panel. */
  frame: ({ title, eyebrow }, ctx, body) => `<section class="slide frame"><div class="top">${eyebrow ? `<span class="eyebrow">${ctx.esc(eyebrow)}</span>` : ''}
    ${title ? `<h2 class="cap">${toned(title, ctx, 'purple')}</h2>` : ''}</div><div class="stage">${body}</div></section>`,

  closing: (d, ctx) => `<section class="slide closing on-lime"><h2 class="cap">${ctx.esc(d.title)}</h2>
    ${d.subtitle ? `<p class="sub">${ctx.esc(d.subtitle)}</p>` : ''}${d.contact ? `<span class="tag purple">${ctx.esc(d.contact)}</span>` : ''}</section>`,
}
